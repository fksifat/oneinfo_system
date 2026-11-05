import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { ActivateCardSchema, ClaimCardSchema, CustomerLoginSchema, CustomerProfileSchema, CustomerSignupSchema, IssueActivationCodeSchema } from "@oneinfo/contracts";
import { requireOperator } from "../auth.js";
import { db } from "../db/client.js";
import { auditLogs, cardActivationSecrets, cardBatches, cardEvents, cards, customerAccounts, customerProfiles, profileLinks } from "../db/schema.js";
import { codeHash, hashPassword, issueClaimToken, issueCustomerToken, matchesCode, readClaimToken, requireCustomer, verifyPassword } from "../domain/customer-auth.js";
import { parseBody, sendCreated } from "../http.js";
import { publicProfileFields } from "./profiles.js";
import { allowAuthAttempt } from "../domain/auth-attempts.js";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ProfileInput = z.infer<typeof CustomerProfileSchema>;
function fail(message: string, statusCode = 409): never { throw Object.assign(new Error(message), { statusCode }); }
const dummyPassword = hashPassword(randomBytes(32).toString("hex"));

async function readyCard(tx: Transaction, cardId: string) {
  const [card] = await tx.select().from(cards).where(eq(cards.id, cardId)).for("update");
  if (!card) fail("Card not found", 404);
  const [batch] = await tx.select().from(cardBatches).where(eq(cardBatches.id, card.batchId));
  if (card.customerAccountId || !batch?.printConfirmedAt || card.qcStatus !== "PASSED" || !["QC_PASSED", "ACTIVATED"].includes(card.lifecycleStatus)) {
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
    const [row] = await db.select({ card: cards, confirmed: cardBatches.printConfirmedAt }).from(cards)
      .innerJoin(cardBatches, eq(cards.batchId, cardBatches.id)).where(eq(cards.publicSlug, cardSlug)).limit(1);
    if (!row) fail("Card not found", 404);
    const { card } = row;
    if (!row.confirmed || card.qcStatus !== "PASSED" || !["QC_PASSED", "ACTIVATED"].includes(card.lifecycleStatus)) return { status: "UNAVAILABLE" };
    if (card.profileId && card.lifecycleStatus === "ACTIVATED") {
      const [profile] = await db.select(publicProfileFields).from(customerProfiles).where(and(eq(customerProfiles.id, card.profileId), eq(customerProfiles.published, true)));
      if (profile) {
        const links = await db.select({ id: profileLinks.id, label: profileLinks.label, url: profileLinks.url, sortOrder: profileLinks.sortOrder })
          .from(profileLinks).where(and(eq(profileLinks.profileId, profile.id), eq(profileLinks.active, true))).orderBy(asc(profileLinks.sortOrder));
        return { status: "PROFILE", profile, links };
      }
    }
    return { status: card.customerAccountId ? "UNAVAILABLE" : "ACTIVATION_REQUIRED", publicSlug: card.publicSlug };
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
    const profile = parseBody(CustomerProfileSchema, request.body);
    await db.transaction(async tx => {
      await saveProfile(tx, account.profileId, profile);
      await tx.insert(auditLogs).values({ actorId: account.id, action: "CUSTOMER_PROFILE_UPDATED", targetType: "customer_profile", targetId: account.profileId, requestId: request.id });
    });
    return { saved: true };
  });

  app.post("/claim", async request => {
    const account = await requireCustomer(request);
    const input = parseBody(ClaimCardSchema, request.body);
    const token = await readClaimToken(input.claimToken);
    await db.transaction(async tx => {
      const card = await claimable(tx, token);
      await saveProfile(tx, account.profileId, input.profile);
      await finishClaim(tx, card, account, request.id);
    });
    return { claimed: true };
  });
};
