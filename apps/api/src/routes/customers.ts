import { publicProfileAvailable } from "../domain/profile-visibility.js";
import { ensureProfileHandle } from "../domain/profile-handles.js";
import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ActivateCardSchema, ClaimCardSchema, CustomerLoginSchema, CustomerProfileSchema, CustomerSignupSchema, IssueActivationCodeSchema,
  profileModes, ProfileModesSchema, profileSources, ShareContactSchema } from "@oneinfo/contracts";
import { requireOperator } from "../auth.js";
import { db } from "../db/client.js";
import { auditLogs, cardActivationSecrets, cardBatches, cardEvents, cards, companies, companyEmployees, customerAccounts, customerContactLeads, customerProfiles, orderCardAllocations, orderActivationProfiles, profileActivity, profileLinks, storeOrders } from "../db/schema.js";
import { codeHash, hashPassword, issueClaimToken, issueOrderProfileClaimToken, issueCustomerToken, issueInvoiceClaimToken, matchesCode, readClaimToken, requireCustomer, verifyPassword } from "../domain/customer-auth.js";
import { readyCard, orderProfileClaimable, orderSecretHash, pendingOrderProfile } from "../domain/order-activation.js";
import { deliveredInvoice, invoiceActivationTarget, invoicePattern } from "../domain/order-invoice.js";
import { escapeEmailHtml, sendTransactionalEmail, transactionalEmailEnabled } from "../domain/transactional-email.js";
import { isManagedCardUrl } from "../domain/card-urls.js";
import { parseBody, sendCreated } from "../http.js";
import { publicProfileFields } from "./profiles.js";
import { allowAuthAttempt } from "../domain/auth-attempts.js";
import { lockPrintedStock } from "../domain/printed-stock.js";
import { config } from "../config.js";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const profileUpdateSchema = CustomerProfileSchema.extend({ profileMode: z.enum(profileModes).optional(), modeContent: ProfileModesSchema.optional() });
type ProfileInput = z.infer<typeof profileUpdateSchema>;
function fail(message: string, statusCode = 409): never { throw Object.assign(new Error(message), { statusCode }); }
const dummyPassword = hashPassword(randomBytes(32).toString("hex"));
const cardSlugSchema = z.object({ cardSlug: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) });
const contactOwner = or(eq(cards.customerAccountId, customerAccounts.id), eq(companies.ownerAccountId, customerAccounts.id));

function liveRecipient(tx: Transaction, cardSlug: string) {
  return tx.select({ accountId: customerAccounts.id, profileId: customerProfiles.id, mode: customerProfiles.profileMode,
    content: customerProfiles.modeContent, recipientName: customerProfiles.displayName, companyId: cards.companyId }).from(cards)
    .innerJoin(cardBatches, eq(cards.batchId, cardBatches.id))
    .leftJoin(companies, eq(cards.companyId, companies.id))
    .innerJoin(customerAccounts, contactOwner)
    .innerJoin(customerProfiles, eq(cards.profileId, customerProfiles.id))
    .where(and(eq(cards.publicSlug, cardSlug), eq(cards.lifecycleStatus, "ACTIVATED"), eq(cards.qcStatus, "PASSED"),
      isNotNull(cardBatches.printConfirmedAt), eq(customerAccounts.active, true), publicProfileAvailable()))
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

async function invoiceOrderId(tx: Transaction, cardId: string) {
  const [row] = await tx.select({ id: storeOrders.id }).from(orderCardAllocations)
    .innerJoin(storeOrders, eq(storeOrders.id, orderCardAllocations.orderId))
    .where(and(eq(orderCardAllocations.cardId, cardId), isNotNull(storeOrders.invoiceNumber)));
  return row?.id;
}

async function claimable(tx: Transaction, token: Awaited<ReturnType<typeof readClaimToken>>, email: string) {
  if (token.orderProfileId) return orderProfileClaimable(tx, token.cardId, token.orderProfileId);
  if (token.orderId) {
    const [order] = await tx.select().from(storeOrders).where(eq(storeOrders.id, token.orderId)).for("update");
    if (!order || !deliveredInvoice(order) || await invoiceOrderId(tx, token.cardId) !== order.id) {
      fail("Activation is no longer valid. Scan the delivered card and request a new email link.", 401);
    }
    if (order.customer.email.toLowerCase() !== email.toLowerCase()) fail("Use the email address from your order to activate this card.", 403);
    const card = await readyCard(tx, token.cardId);
    if (card.profileId || card.lifecycleStatus !== "QC_PASSED" || card.qrStatus !== "GENERATED" || card.nfcStatus !== "WRITTEN" ||
      !["RESERVED", "DISPATCHED"].includes(card.inventoryStatus) || !isManagedCardUrl(card.canonicalUrl, card.publicSlug)) {
      fail("This card is not ready for invoice activation.");
    }
    return card;
  }
  const card = await readyCard(tx, token.cardId);
  if (await invoiceOrderId(tx, card.id)) fail("This card requires invoice activation.", 403);
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

async function finishClaim(tx: Transaction, card: typeof cards.$inferSelect, account: typeof customerAccounts.$inferSelect, requestId: string,
  profileId = account.profileId, orderProfileId?: string) {
  let inventoryStatus: "RESERVED" | "DISPATCHED" = card.inventoryStatus === "DISPATCHED" ? "DISPATCHED" : "RESERVED";
  if (orderProfileId) {
    const entry = await pendingOrderProfile(tx, orderProfileId);
    if (entry.order.shippedAt || entry.order.deliveredAt) inventoryStatus = "DISPATCHED";
    await tx.insert(orderCardAllocations).values({ orderId: entry.order.id, cardId: card.id, lineIndex: entry.slot.lineIndex, unitIndex: entry.slot.unitIndex });
    await tx.update(orderActivationProfiles).set({ cardId: card.id, redeemedAt: new Date(), encryptedCode: null }).where(eq(orderActivationProfiles.id, orderProfileId));
  }
  await tx.update(cards).set({ customerAccountId: account.id, profileId, claimedAt: new Date(),
    lifecycleStatus: "ACTIVATED", inventoryStatus, updatedAt: new Date() }).where(eq(cards.id, card.id));
  await tx.update(cardActivationSecrets).set({ codeHash: null, redeemedAt: new Date() }).where(eq(cardActivationSecrets.cardId, card.id));
  await tx.insert(cardEvents).values({ cardId: card.id, actorId: account.id, eventType: "CUSTOMER_CARD_CLAIMED", previousState: card.lifecycleStatus,
    newState: "ACTIVATED", metadata: { customerAccountId: account.id, profileId, previousProfileId: card.profileId } });
  await tx.insert(auditLogs).values({ actorId: account.id, action: "CUSTOMER_CARD_CLAIMED", targetType: "card", targetId: card.id, requestId,
    metadata: { customerAccountId: account.id, profileId } });
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
      await lockPrintedStock(tx);
      const card = await readyCard(tx, cardId);
      if (await invoiceOrderId(tx, cardId)) fail("Invoice cards are activated through the order email.");
      const target = new URL(card.canonicalUrl);
      if (target.pathname !== `/c/${card.publicSlug}` || (target.search && target.search !== "?source=nfc") || target.hash) fail("Client activation requires a generated Oneinfo /c/card-id link. Custom external QR links open their own destination.");
      const [existing] = await tx.select().from(cardActivationSecrets).where(eq(cardActivationSecrets.cardId, cardId));
      if (existing && !input.replaceExisting) fail("A code was already issued. Explicitly replace it only if the old code was lost; the old code will stop working.");
      if (card.inventoryStatus === "SALEABLE") await tx.update(cards).set({ inventoryStatus: "RESERVED", updatedAt: new Date() }).where(eq(cards.id, cardId));
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
    const [row] = await db.select({ card: cards, confirmed: cardBatches.printConfirmedAt, ownerActive: customerAccounts.active,
      legacyCode: cardActivationSecrets.cardId }).from(cards)
      .innerJoin(cardBatches, eq(cards.batchId, cardBatches.id))
      .leftJoin(companies, eq(cards.companyId, companies.id))
      .leftJoin(customerAccounts, contactOwner)
      .leftJoin(cardActivationSecrets, and(eq(cardActivationSecrets.cardId, cards.id), isNotNull(cardActivationSecrets.codeHash)))
      .where(eq(cards.publicSlug, cardSlug)).limit(1);
    if (!row) fail("Card not found", 404);
    const { card } = row;
    if (!row.confirmed || card.qcStatus !== "PASSED" || !["QC_PASSED", "ACTIVATED"].includes(card.lifecycleStatus)) return { status: "UNAVAILABLE" };
    if (card.profileId && card.lifecycleStatus === "ACTIVATED") {
      const [profile] = await db.select(publicProfileFields).from(customerProfiles).where(and(eq(customerProfiles.id, card.profileId), publicProfileAvailable()));
      if (profile) {
        const links = await db.select({ id: profileLinks.id, label: profileLinks.label, url: profileLinks.url, sortOrder: profileLinks.sortOrder })
          .from(profileLinks).where(and(eq(profileLinks.profileId, profile.id), eq(profileLinks.active, true))).orderBy(asc(profileLinks.sortOrder));
        return { status: "PROFILE", profile, links, canShareContact: row.ownerActive === true, crmEnabled: Boolean(config.CRM_LEAD_WEBHOOK_URL) };
      }
    }
    if (card.profileId && card.lifecycleStatus === "ACTIVATED") return { status: "UNAVAILABLE" };
    const [allocated] = await db.select({ orderId: storeOrders.id }).from(orderCardAllocations)
      .innerJoin(storeOrders, eq(storeOrders.id, orderCardAllocations.orderId)).where(eq(orderCardAllocations.cardId, card.id));
    return { status: card.customerAccountId || card.companyId ? "UNAVAILABLE" : "ACTIVATION_REQUIRED",
      publicSlug: card.publicSlug, activationMethod: row.legacyCode || !allocated ? "SECRET" : "INVOICE" };
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
      .where(and(companyId ? inArray(profileId, teamProfiles) : or(eq(profileId, account.profileId), inArray(profileId, db.select({ id: cards.profileId }).from(cards).where(eq(cards.customerAccountId, account.id)))), gte(day, earliest))).groupBy(mode, campaign, source, event)
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

  app.post("/cards/:cardSlug/invoice-activation", { bodyLimit: 1024 }, async (request, reply) => {
    await limit(request);
    reply.header("Cache-Control", "no-store");
    const { cardSlug } = parseBody(cardSlugSchema, request.params);
    const { invoiceNumber } = parseBody(z.object({ invoiceNumber: z.string().trim().toUpperCase().regex(invoicePattern) }), request.body);
    if (!transactionalEmailEnabled || !config.STOREFRONT_URL) fail("Activation email is temporarily unavailable. Please try again later.", 503);
    const entry = await invoiceActivationTarget(and(eq(storeOrders.invoiceNumber, invoiceNumber), eq(cards.publicSlug, cardSlug)));
    const generic = { message: "If this invoice matches the delivered card, a verification link will be sent to the order email. The link expires in 15 minutes." };
    if (!entry) return generic;
    if (!await allowAuthAttempt(`invoice-mail:${entry.order.id}:${entry.card.id}`, 3, 60 * 60_000) ||
      !await allowAuthAttempt(`invoice-mail:${entry.order.id}`, 15, 60 * 60_000)) return generic;
    const claimToken = await issueInvoiceClaimToken(entry.card.id, entry.order.id);
    const url = new URL(`/c/${encodeURIComponent(cardSlug)}`, config.STOREFRONT_URL);
    url.hash = `invoice-claim/${claimToken}`;
    const sent = await sendTransactionalEmail({ to: entry.order.customer.email, subject: "Activate your Oneinfo card",
      text: `Confirm activation for invoice ${invoiceNumber}: ${url.href}\nThe link expires in 15 minutes.`,
      html: `<p>Confirm activation for invoice ${invoiceNumber}.</p><p><a href="${escapeEmailHtml(url.href)}">Continue activation</a></p><p>The link expires in 15 minutes.</p>`,
      idempotencyKey: `oneinfo-invoice-claim/${randomUUID()}` });
    if (!sent) request.log.warn({ cardId: entry.card.id }, "Invoice activation email was not accepted");
    return generic;
  });

  app.post("/cards/:cardSlug/invoice-claim", { bodyLimit: 4096 }, async (request, reply) => {
    await limit(request);
    reply.header("Cache-Control", "no-store");
    const { cardSlug } = parseBody(cardSlugSchema, request.params);
    const { claimToken } = parseBody(z.object({ claimToken: z.string().max(2048) }), request.body);
    const claim = await readClaimToken(claimToken);
    if (!claim.orderId) fail("Invalid activation link.", 401);
    const entry = await invoiceActivationTarget(and(eq(storeOrders.id, claim.orderId), eq(cards.id, claim.cardId), eq(cards.publicSlug, cardSlug)));
    if (!entry) fail("Activation link is unavailable. Scan the delivered card and request a new link.", 401);
    return { email: entry.order.customer.email };
  });

  app.post("/cards/:cardSlug/activate", async (request, reply) => {
    await limit(request);
    const { cardSlug } = request.params as { cardSlug: string };
    const { secretCode } = parseBody(ActivateCardSchema, request.body);
    const [card] = await db.select().from(cards).where(eq(cards.publicSlug, cardSlug)).limit(1);
    if (!card) fail("Invalid secret code or card unavailable.", 403);
    const token = await db.transaction(async tx => {
      await lockPrintedStock(tx);
      const [slot] = await tx.select().from(orderActivationProfiles).where(eq(orderActivationProfiles.codeHash, orderSecretHash(secretCode)));
      if (slot) {
        await orderProfileClaimable(tx, card.id, slot.id);
        return issueOrderProfileClaimToken(card.id, slot.id);
      }
      await readyCard(tx, card.id);
      if (await invoiceOrderId(tx, card.id)) fail("This card requires invoice activation.", 403);
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
      await lockPrintedStock(tx);
      const card = await claimable(tx, claim, input.email);
      const { links: _, ...fields } = input.profile;
      const profileId = claim.orderProfileId
        ? (await pendingOrderProfile(tx, claim.orderProfileId)).slot.profileId
        : (await tx.insert(customerProfiles).values({ ...fields, publicSlug: `client-${randomBytes(9).toString("hex")}`, published: false }).returning())[0]!.id;
      await ensureProfileHandle(tx, profileId, input.profile.displayName);
      const [created] = await tx.insert(customerAccounts).values({ email: input.email, passwordHash, profileId,
        ...(claim.orderId ? { emailVerifiedAt: new Date() } : {}) })
        .onConflictDoNothing({ target: customerAccounts.email }).returning();
      if (!created) fail("This email already has an account. Sign in instead.");
      await saveProfile(tx, created.profileId, input.profile);
      await finishClaim(tx, card, created, request.id, profileId, claim.orderProfileId);
      return created;
    });
    reply.header("Cache-Control", "no-store");
    return sendCreated(reply, { accessToken: await issueCustomerToken(account.id, account.authVersion), email: account.email });
  });

  app.post("/login", async (request, reply) => {
    await limit(request);
    const input = parseBody(CustomerLoginSchema, request.body);
    const [account] = await db.select().from(customerAccounts).where(eq(customerAccounts.email, input.email));
    const valid = await verifyPassword(input.password, account?.passwordHash ?? await dummyPassword);
    if (!account?.active || !valid) fail("Email or password is incorrect.", 401);
    reply.header("Cache-Control", "no-store");
    return { accessToken: await issueCustomerToken(account.id, account.authVersion), email: account.email };
  });

  async function ownedProfile(request: FastifyRequest, account: typeof customerAccounts.$inferSelect) {
    const { cardSlug } = parseBody(z.object({ cardSlug: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional() }), request.query);
    if (!cardSlug) return account.profileId;
    const [card] = await db.select().from(cards).where(and(eq(cards.publicSlug, cardSlug), eq(cards.customerAccountId, account.id)));
    if (!card?.profileId) fail("Your account does not own this card.", 403);
    return card.profileId;
  }

  app.get("/me", async (request, reply) => {
    const account = await requireCustomer(request);
    reply.header("Cache-Control", "no-store");
    const profileId = await ownedProfile(request, account);
    const [profile] = await db.select(publicProfileFields).from(customerProfiles).where(eq(customerProfiles.id, profileId));
    const links = await db.select().from(profileLinks).where(eq(profileLinks.profileId, profileId)).orderBy(asc(profileLinks.sortOrder));
    const owned = await db.select({ id: cards.id, publicSlug: cards.publicSlug, canonicalUrl: cards.canonicalUrl }).from(cards).where(eq(cards.customerAccountId, account.id));
    return { email: account.email, emailVerified: Boolean(account.emailVerifiedAt), profile: { ...profile, links }, cards: owned };
  });

  app.patch("/me/profile", async request => {
    const account = await requireCustomer(request);
    const profile = parseBody(profileUpdateSchema, request.body);
    const profileId = await ownedProfile(request, account);
    await db.transaction(async tx => {
      await saveProfile(tx, profileId, profile);
      await tx.insert(auditLogs).values({ actorId: account.id, action: "CUSTOMER_PROFILE_UPDATED", targetType: "customer_profile", targetId: profileId, requestId: request.id });
    });
    return { saved: true };
  });

  app.post("/claim", async request => {
    const account = await requireCustomer(request);
    const input = parseBody(ClaimCardSchema.extend({ profile: profileUpdateSchema }), request.body);
    const token = await readClaimToken(input.claimToken);
    await db.transaction(async tx => {
      await lockPrintedStock(tx);
      const card = await claimable(tx, token, account.email);
      if (token.orderId && !account.emailVerifiedAt) await tx.update(customerAccounts).set({ emailVerifiedAt: new Date() }).where(eq(customerAccounts.id, account.id));
      const profileId = token.orderProfileId ? (await pendingOrderProfile(tx, token.orderProfileId)).slot.profileId : account.profileId;
      await ensureProfileHandle(tx, profileId, input.profile.displayName);
      await saveProfile(tx, profileId, input.profile);
      await finishClaim(tx, card, account, request.id, profileId, token.orderProfileId);
    });
    return { claimed: true };
  });
};
