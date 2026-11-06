import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ActivateCardSchema, ClaimCardSchema, CustomerLoginSchema, CustomerProfileSchema, CustomerSignupSchema, IssueActivationCodeSchema,
  profileModes, ProfileModesSchema, profileSources, ShareContactSchema } from "@oneinfo/contracts";
import { requireOperator } from "../auth.js";
import { db } from "../db/client.js";
import { auditLogs, cardActivationSecrets, cardBatches, cardEvents, cards, companies, companyEmployees, customerAccounts, customerContactLeads, customerProfiles, profileActivity, profileLinks } from "../db/schema.js";
import { codeHash, hashPassword, issueClaimToken, issueCustomerToken, matchesCode, readClaimToken, requireCustomer, verifyPassword } from "../domain/customer-auth.js";
import { parseBody, sendCreated } from "../http.js";
import { publicProfileFields } from "./profiles.js";
import { allowAuthAttempt } from "../domain/auth-attempts.js";
import { config } from "../config.js";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const profileUpdateSchema = CustomerProfileSchema.extend({ profileMode: z.enum(profileModes).optional(), modeContent: ProfileModesSchema.optional() });
type ProfileInput = z.infer<typeof profileUpdateSchema>;
function fail(message: string, statusCode = 409): never { throw Object.assign(new Error(message), { statusCode }); }
const dummyPassword = hashPassword(randomBytes(32).toString("hex"));
const cardSlugSchema = z.object({ cardSlug: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) });
const contactOwner = or(and(eq(cards.customerAccountId, customerAccounts.id), eq(cards.profileId, customerAccounts.profileId)), eq(companies.ownerAccountId, customerAccounts.id));

function liveRecipient(tx: Transaction, cardSlug: string) {
  return tx.select({ accountId: customerAccounts.id, profileId: customerProfiles.id, mode: customerProfiles.profileMode,
    content: customerProfiles.modeContent, recipientName: customerProfiles.displayName, companyId: cards.companyId }).from(cards)
    .innerJoin(cardBatches, eq(cards.batchId, cardBatches.id))
    .leftJoin(companies, eq(cards.companyId, companies.id))
    .innerJoin(customerAccounts, contactOwner)
    .innerJoin(customerProfiles, eq(cards.profileId, customerProfiles.id))
    .where(and(eq(cards.publicSlug, cardSlug), eq(cards.lifecycleStatus, "ACTIVATED"), eq(cards.qcStatus, "PASSED"),
      isNotNull(cardBatches.printConfirmedAt), eq(customerAccounts.active, true), eq(customerProfiles.published, true)))
    .limit(1).for("share", { of: cards });
}

async function recordActivity(tx: Transaction, recipient: Awaited<ReturnType<typeof liveRecipient>>[number], source: typeof profileSources[number], event: string) {
  const { profileId, mode, content } = recipient;
  const day = new Date().toISOString().slice(0, 10);
  const campaign = mode === "EVENT" ? content.EVENT?.title ?? "" : "";
  await tx.insert(profileActivity).values({ profileId, day, mode, campaign, source, event }).onConflictDoUpdate({
    target: [profileActivity.profileId, profileActivity.day, profileActivity.mode, profileActivity.campaign, profileActivity.source, profileActivity.event],
    set: { total: sql`${profileActivity.total} + 1` },
  });
}

async function readyCard(tx: Transaction, cardId: string) {
  const [card] = await tx.select().from(cards).where(eq(cards.id, cardId)).for("update");
  if (!card) fail("Card not found", 404);
  const [batch] = await tx.select().from(cardBatches).where(eq(cardBatches.id, card.batchId));
  if (card.customerAccountId || card.companyId || !batch?.printConfirmedAt || card.qcStatus !== "PASSED" || !["QC_PASSED", "ACTIVATED"].includes(card.lifecycleStatus)) {
    fail("This card is already claimed or is not ready for activation.");
  }
  if (card.profileId) {
    const [profile] = await tx.select().from(customerProfiles).where(eq(customerProfiles.id, card.profileId));
    if (profile?.published) fail("This card already has a published owner profile.");
  }
  return card;
}

async function claimable(tx: Transaction, token: Awaited<ReturnType<typeof readClaimToken>>) {
  const card = await readyCard(tx, token.cardId);
  const [secret] = await tx.select().from(cardActivationSecrets).where(eq(cardActivationSecrets.cardId, card.id)).for("update");
  if (!secret?.codeHash || secret.redeemedAt || secret.version !== token.version) fail("Activation is no longer valid. Scan the card and enter its current secret code again.", 401);
  return card;
}

async function saveProfile(tx: Transaction, profileId: string, input: ProfileInput) {
  const { links, ...fields } = input;
  await tx.update(customerProfiles).set({ ...fields, published: true, updatedAt: new Date() }).where(eq(customerProfiles.id, profileId));
  await tx.delete(profileLinks).where(eq(profileLinks.profileId, profileId));
  if (links.length) await tx.insert(profileLinks).values(links.map(link => ({ ...link, profileId })));
}

async function finishClaim(tx: Transaction, card: typeof cards.$inferSelect, account: typeof customerAccounts.$inferSelect, requestId: string) {
  await tx.update(cards).set({ customerAccountId: account.id, profileId: account.profileId, claimedAt: new Date(),
    lifecycleStatus: "ACTIVATED", inventoryStatus: card.inventoryStatus === "DISPATCHED" ? "DISPATCHED" : "RESERVED", updatedAt: new Date() }).where(eq(cards.id, card.id));
  await tx.update(cardActivationSecrets).set({ codeHash: null, redeemedAt: new Date() }).where(eq(cardActivationSecrets.cardId, card.id));
  await tx.insert(cardEvents).values({ cardId: card.id, actorId: account.id, eventType: "CUSTOMER_CARD_CLAIMED", previousState: card.lifecycleStatus,
    newState: "ACTIVATED", metadata: { customerAccountId: account.id, profileId: account.profileId, previousProfileId: card.profileId } });
  await tx.insert(auditLogs).values({ actorId: account.id, action: "CUSTOMER_CARD_CLAIMED", targetType: "card", targetId: card.id, requestId,
    metadata: { customerAccountId: account.id, profileId: account.profileId } });
}

export const customerRoutes: FastifyPluginAsync = async app => {
  async function limit(request: FastifyRequest) {
    if (!await allowAuthAttempt(`customer:${request.ip}:${request.routeOptions.url}`, 20, 5 * 60_000)) fail("Too many attempts. Please wait five minutes before trying again.", 429);
  }

  app.post("/cards/:cardId/activation-code", async (request, reply) => {
    const operator = await requireOperator(request, ["SUPER_ADMIN", "INVENTORY_MANAGER"]);
    const { cardId } = parseBody(z.object({ cardId: z.uuid() }), request.params);
    const input = parseBody(IssueActivationCodeSchema, request.body ?? {});
    const code = randomBytes(10).toString("hex").toUpperCase();
    const result = await db.transaction(async tx => {
      const card = await readyCard(tx, cardId);
      const target = new URL(card.canonicalUrl);
      if (target.pathname !== `/c/${card.publicSlug}` || target.search || target.hash) fail("Client activation requires a generated Oneinfo /c/card-id link. Custom external QR links open their own destination.");
      const [existing] = await tx.select().from(cardActivationSecrets).where(eq(cardActivationSecrets.cardId, cardId));
      if (existing && !input.replaceExisting) fail("A code was already issued. Explicitly replace it only if the old code was lost; the old code will stop working.");
      const values = { codeHash: codeHash(cardId, code), version: randomUUID(), issuedBy: operator.operatorId, issuedAt: new Date(), redeemedAt: null };
      await tx.insert(cardActivationSecrets).values({ cardId, ...values }).onConflictDoUpdate({ target: cardActivationSecrets.cardId, set: values });
      await tx.insert(auditLogs).values({ actorId: operator.operatorId, action: existing ? "ACTIVATION_CODE_REPLACED" : "ACTIVATION_CODE_ISSUED",
        targetType: "card", targetId: cardId, requestId: request.id });
      return { cardId, publicSlug: card.publicSlug, canonicalUrl: card.canonicalUrl, secretCode: code.match(/.{4}/g)!.join("-") };
    });
    reply.header("Cache-Control", "no-store");
    return sendCreated(reply, result);
  });

  app.get("/cards/:cardSlug", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { cardSlug } = request.params as { cardSlug: string };
    const [row] = await db.select({ card: cards, confirmed: cardBatches.printConfirmedAt, ownerActive: customerAccounts.active }).from(cards)
      .innerJoin(cardBatches, eq(cards.batchId, cardBatches.id))
      .leftJoin(companies, eq(cards.companyId, companies.id))
      .leftJoin(customerAccounts, contactOwner)
      .where(eq(cards.publicSlug, cardSlug)).limit(1);
    if (!row) fail("Card not found", 404);
    const { card } = row;
    if (!row.confirmed || card.qcStatus !== "PASSED" || !["QC_PASSED", "ACTIVATED"].includes(card.lifecycleStatus)) return { status: "UNAVAILABLE" };
    if (card.profileId && card.lifecycleStatus === "ACTIVATED") {
      const [profile] = await db.select(publicProfileFields).from(customerProfiles).where(and(eq(customerProfiles.id, card.profileId), eq(customerProfiles.published, true)));
      if (profile) {
        const links = await db.select({ id: profileLinks.id, label: profileLinks.label, url: profileLinks.url, sortOrder: profileLinks.sortOrder })
          .from(profileLinks).where(and(eq(profileLinks.profileId, profile.id), eq(profileLinks.active, true))).orderBy(asc(profileLinks.sortOrder));
        return { status: "PROFILE", profile, links, canShareContact: row.ownerActive === true, crmEnabled: Boolean(config.CRM_LEAD_WEBHOOK_URL) };
      }
    }
    return { status: card.customerAccountId || card.companyId ? "UNAVAILABLE" : "ACTIVATION_REQUIRED", publicSlug: card.publicSlug };
  });

  app.post("/cards/:cardSlug/contact-leads", { bodyLimit: 8192 }, async (request, reply) => {
    const { cardSlug } = parseBody(cardSlugSchema, request.params);
    const { consent: _, source, ...contact } = parseBody(ShareContactSchema, request.body);
    await limit(request);
    await db.transaction(async tx => {
      const [recipient] = await liveRecipient(tx, cardSlug);
      if (!recipient) fail("This card cannot receive contact details.", 404);
      const [lead] = await tx.insert(customerContactLeads).values({ ...contact, crmAllowed: Boolean(config.CRM_LEAD_WEBHOOK_URL && contact.crmAllowed),
        accountId: recipient.accountId, recipientName: recipient.recipientName, companyId: recipient.companyId })
        .onConflictDoNothing({ target: [customerContactLeads.accountId, customerContactLeads.requestId] }).returning({ id: customerContactLeads.id });
      if (lead) await recordActivity(tx, recipient, source, "LEAD");
    });
    return sendCreated(reply, { sent: true });
  });

  app.post("/cards/:cardSlug/activity", { bodyLimit: 1024 }, async (request, reply) => {
    const { cardSlug } = parseBody(cardSlugSchema, request.params);
    const input = parseBody(z.object({ source: z.enum(profileSources), event: z.enum(["VIEW", "SAVE", "LINK"]), linkId: z.uuid().optional() }), request.body);
    if (!await allowAuthAttempt(`activity:${request.ip}:${cardSlug}`, 100, 60_000)) return reply.code(429).send();
    await db.transaction(async tx => {
      const [recipient] = await liveRecipient(tx, cardSlug);
      if (!recipient) return;
      let event: string = input.event;
      if (input.event === "LINK" && input.linkId) {
        const [link] = await tx.select({ label: profileLinks.label }).from(profileLinks).where(and(eq(profileLinks.id, input.linkId), eq(profileLinks.profileId, recipient.profileId), eq(profileLinks.active, true)));
        if (!link) return;
        event = `LINK:${link.label}`;
      }
      await recordActivity(tx, recipient, input.source, event);
    });
    return reply.code(204).send();
  });

  app.get("/me/activity", async (request, reply) => {
    const account = await requireCustomer(request);
    const { companyId } = parseBody(z.object({ companyId: z.uuid().optional() }), request.query);
    reply.header("Cache-Control", "no-store");
    const earliest = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);
    const { profileId, mode, campaign, source, event, day, total } = profileActivity;
    const teamProfiles = db.select({ id: companyEmployees.profileId }).from(companyEmployees)
      .innerJoin(companies, eq(companyEmployees.companyId, companies.id))
      .where(and(eq(companies.id, companyId ?? ""), eq(companies.ownerAccountId, account.id)));
    const items = await db.select({ mode, campaign, source, event, total: sql<number>`sum(${total})::int` }).from(profileActivity)
      .where(and(companyId ? inArray(profileId, teamProfiles) : eq(profileId, account.profileId), gte(day, earliest))).groupBy(mode, campaign, source, event)
      .orderBy(desc(sql`sum(${total})`)).limit(500);
    return { items: items.map(row => ({ ...row, label: row.event.startsWith("LINK:") ? row.event.slice(5) : null })) };
  });

  app.get("/me/contact-leads", async (request, reply) => {
    const account = await requireCustomer(request);
    const { before, companyId } = parseBody(z.object({ before: z.uuid().optional(), companyId: z.uuid().optional() }), request.query);
    reply.header("Cache-Control", "no-store");
    const leads = customerContactLeads;
    const scope = and(eq(leads.accountId, account.id), companyId ? eq(leads.companyId, companyId) : isNull(leads.companyId));
    const cursor = db.select({ createdAt: leads.createdAt, id: leads.id }).from(leads)
      .where(and(scope, eq(leads.id, before ?? "")));
    const items = await db.select({ id: leads.id, name: leads.name, email: leads.email, phone: leads.phone,
      message: leads.message, createdAt: leads.createdAt, forwardedAt: leads.forwardedAt, crmAllowed: leads.crmAllowed, recipientName: leads.recipientName }).from(leads)
      .where(and(scope, before ? sql`(${leads.createdAt}, ${leads.id}) < (${cursor})` : undefined))
      .orderBy(desc(leads.createdAt), desc(leads.id)).limit(51);
    const page = items.slice(0, 50);
    return { items: page, nextCursor: items.length > page.length ? page.at(-1)?.id : null, crmEnabled: Boolean(config.CRM_LEAD_WEBHOOK_URL) };
  });

  app.post("/me/contact-leads/:id/crm", async request => {
    const account = await requireCustomer(request);
    const { id } = parseBody(z.object({ id: z.uuid() }), request.params);
    const url = config.CRM_LEAD_WEBHOOK_URL;
    if (!url) fail("CRM forwarding is not configured.", 503);
    return db.transaction(async tx => {
      const [lead] = await tx.select().from(customerContactLeads).where(and(eq(customerContactLeads.id, id), eq(customerContactLeads.accountId, account.id))).for("update");
      if (!lead) fail("Contact not found.", 404);
      if (!lead.crmAllowed) fail("This visitor shared their details for the inbox only.", 403);
      if (lead.forwardedAt) return { forwardedAt: lead.forwardedAt.toISOString() };
      const { name, email, phone, message, createdAt, companyId, recipientName } = lead;
      const result = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(4500),
        headers: { "content-type": "application/json", "idempotency-key": id,
          ...(config.CRM_LEAD_WEBHOOK_TOKEN ? { authorization: `Bearer ${config.CRM_LEAD_WEBHOOK_TOKEN}` } : {}) },
        body: JSON.stringify({ id, accountId: account.id, companyId, recipientName, name, email, phone, message, createdAt }) }).catch(() => undefined);
      if (!result?.ok) fail("The CRM did not accept this contact. Please try again.", 502);
      const forwardedAt = new Date();
      await tx.update(customerContactLeads).set({ forwardedAt }).where(eq(customerContactLeads.id, id));
      return { forwardedAt: forwardedAt.toISOString() };
    });
  });

  app.post("/cards/:cardSlug/activate", async (request, reply) => {
    await limit(request);
    const { cardSlug } = request.params as { cardSlug: string };
    const { secretCode } = parseBody(ActivateCardSchema, request.body);
    const [card] = await db.select().from(cards).where(eq(cards.publicSlug, cardSlug)).limit(1);
    if (!card) fail("Invalid secret code or card unavailable.", 403);
    const token = await db.transaction(async tx => {
      await readyCard(tx, card.id);
      const [secret] = await tx.select().from(cardActivationSecrets).where(eq(cardActivationSecrets.cardId, card.id));
      if (!secret?.codeHash || secret.redeemedAt || !matchesCode(card.id, secretCode, secret.codeHash)) fail("Invalid secret code or card unavailable.", 403);
      return issueClaimToken(card.id, secret.version);
    });
    reply.header("Cache-Control", "no-store");
    return { claimToken: token, expiresInSeconds: 900 };
  });

  app.post("/signup", async (request, reply) => {
    await limit(request);
    const input = parseBody(CustomerSignupSchema, request.body);
    const claim = await readClaimToken(input.claimToken);
    const passwordHash = await hashPassword(input.password);
    const account = await db.transaction(async tx => {
      const card = await claimable(tx, claim);
      const { links: _, ...fields } = input.profile;
      const [profile] = await tx.insert(customerProfiles).values({ ...fields, publicSlug: `client-${randomBytes(9).toString("hex")}`, published: false }).returning();
      const [created] = await tx.insert(customerAccounts).values({ email: input.email, passwordHash, profileId: profile!.id })
        .onConflictDoNothing({ target: customerAccounts.email }).returning();
      if (!created) fail("This email already has an account. Sign in instead.");
      await saveProfile(tx, created.profileId, input.profile);
      await finishClaim(tx, card, created, request.id);
      return created;
    });
    reply.header("Cache-Control", "no-store");
    return sendCreated(reply, { accessToken: await issueCustomerToken(account.id), email: account.email });
  });

  app.post("/login", async (request, reply) => {
    await limit(request);
    const input = parseBody(CustomerLoginSchema, request.body);
    const [account] = await db.select().from(customerAccounts).where(eq(customerAccounts.email, input.email));
    const valid = await verifyPassword(input.password, account?.passwordHash ?? await dummyPassword);
    if (!account?.active || !valid) fail("Email or password is incorrect.", 401);
    reply.header("Cache-Control", "no-store");
    return { accessToken: await issueCustomerToken(account.id), email: account.email };
  });

  app.get("/me", async (request, reply) => {
    const account = await requireCustomer(request);
    reply.header("Cache-Control", "no-store");
    const [profile] = await db.select(publicProfileFields).from(customerProfiles).where(eq(customerProfiles.id, account.profileId));
    const links = await db.select().from(profileLinks).where(eq(profileLinks.profileId, account.profileId)).orderBy(asc(profileLinks.sortOrder));
    const owned = await db.select({ id: cards.id, publicSlug: cards.publicSlug, canonicalUrl: cards.canonicalUrl }).from(cards).where(eq(cards.customerAccountId, account.id));
    return { email: account.email, profile: { ...profile, links }, cards: owned };
  });

  app.patch("/me/profile", async request => {
    const account = await requireCustomer(request);
    const profile = parseBody(profileUpdateSchema, request.body);
    await db.transaction(async tx => {
      await saveProfile(tx, account.profileId, profile);
      await tx.insert(auditLogs).values({ actorId: account.id, action: "CUSTOMER_PROFILE_UPDATED", targetType: "customer_profile", targetId: account.profileId, requestId: request.id });
    });
    return { saved: true };
  });

  app.post("/claim", async request => {
    const account = await requireCustomer(request);
    const input = parseBody(ClaimCardSchema.extend({ profile: profileUpdateSchema }), request.body);
    const token = await readClaimToken(input.claimToken);
    await db.transaction(async tx => {
      const card = await claimable(tx, token);
      await saveProfile(tx, account.profileId, input.profile);
      await finishClaim(tx, card, account, request.id);
    });
    return { claimed: true };
  });
};
