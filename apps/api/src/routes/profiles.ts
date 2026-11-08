import { lockPrintedStock } from "../domain/printed-stock.js";
import { adminPage } from "../domain/admin-page.js";
import { ensureProfileHandle } from "../domain/profile-handles.js";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AssignCardSchema, contactVcard, CreateProfileSchema, UpdateProfileSchema } from "@oneinfo/contracts";
import { and, asc, eq, getTableColumns, inArray, isNull, isNotNull, or, sql } from "drizzle-orm";
import { requireOperator } from "../auth.js";
import { db } from "../db/client.js";
import { auditLogs, cardBatches, customerAccounts, companyEmployees, cardActivationSecrets, cardEvents, cards, customerProfiles, orderCardAllocations, orderActivationProfiles, profileLinks } from "../db/schema.js";
import { parseBody, sendCreated } from "../http.js";

export const publicProfileFields = {
  id: customerProfiles.id, handle: customerProfiles.handle, publicSlug: customerProfiles.publicSlug, displayName: customerProfiles.displayName,
  headline: customerProfiles.headline, company: customerProfiles.company, bio: customerProfiles.bio,
  phone: customerProfiles.phone, email: customerProfiles.email, website: customerProfiles.website,
  avatarUrl: customerProfiles.avatarUrl, theme: customerProfiles.theme, profileMode: customerProfiles.profileMode, modeContent: customerProfiles.modeContent,
};

async function profileWithLinks(profileId: string) {
  const [profile] = await db.select().from(customerProfiles).where(eq(customerProfiles.id, profileId)).limit(1);
  if (!profile) throw Object.assign(new Error("Profile not found"), { statusCode: 404 });
  const links = await db
    .select()
    .from(profileLinks)
    .where(eq(profileLinks.profileId, profileId))
    .orderBy(asc(profileLinks.sortOrder));
  const assignedCards = await db.select().from(cards).where(eq(cards.profileId, profileId));
  const [pending] = await db.select({ id: orderActivationProfiles.id }).from(orderActivationProfiles)
    .where(and(eq(orderActivationProfiles.profileId, profileId), isNull(orderActivationProfiles.redeemedAt)));
  return { ...profile, temporary: Boolean(pending), links, cards: assignedCards };
}

export const profileRoutes: FastifyPluginAsync = async (app) => {
  app.get("/handle/:handle", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { handle } = request.params as { handle: string };
    if (!/^[a-zA-Z0-9]{1,64}$/.test(handle)) return reply.code(404).send({ message: "Profile not found" });
    const [profile] = await db.select(publicProfileFields).from(customerProfiles)
      .where(and(sql`lower(${customerProfiles.handle}) = lower(${handle})`, eq(customerProfiles.published, true)));
    if (!profile) return reply.code(404).send({ message: "Profile not found" });
    const linked = await db.select({ publicSlug: cards.publicSlug, lifecycleStatus: cards.lifecycleStatus, qcStatus: cards.qcStatus, confirmed: cardBatches.printConfirmedAt }).from(cards)
      .innerJoin(cardBatches, eq(cardBatches.id, cards.batchId)).where(eq(cards.profileId, profile.id)).orderBy(asc(cards.createdAt), asc(cards.id));
    const active = linked.find(card => card.lifecycleStatus === "ACTIVATED" && card.qcStatus === "PASSED" && card.confirmed);
    if (linked.length && !active) return reply.code(404).send({ message: "Profile unavailable" });
    const [owner] = await db.select({ active: customerAccounts.active }).from(customerAccounts).where(or(eq(customerAccounts.profileId, profile.id), inArray(customerAccounts.id, db.select({ id: cards.customerAccountId }).from(cards).where(eq(cards.profileId, profile.id)))));
    if (owner && !owner.active) return reply.code(404).send({ message: "Profile unavailable" });
    const links = await db.select({ id: profileLinks.id, label: profileLinks.label, url: profileLinks.url, sortOrder: profileLinks.sortOrder }).from(profileLinks)
      .where(and(eq(profileLinks.profileId, profile.id), eq(profileLinks.active, true))).orderBy(asc(profileLinks.sortOrder));
    return { profile, links, cardSlug: active?.publicSlug ?? null };
  });

  app.get("/public/:slug/contact.vcf", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const [profile] = await db.select(publicProfileFields).from(customerProfiles)
      .where(and(eq(customerProfiles.publicSlug, slug), eq(customerProfiles.published, true))).limit(1);
    if (!profile) throw Object.assign(new Error("Published profile not found"), { statusCode: 404 });
    return reply.header("Cache-Control", "no-store").header("Content-Disposition", "inline; filename=contact.vcf")
      .type("text/vcard; charset=utf-8").send(contactVcard(profile));
  });

  app.get("/public/:slug", async (request) => {
    const { slug } = request.params as { slug: string };
    const [profile] = await db
      .select(publicProfileFields)
      .from(customerProfiles)
      .where(and(eq(customerProfiles.publicSlug, slug), eq(customerProfiles.published, true)))
      .limit(1);
    if (!profile) throw Object.assign(new Error("Published profile not found"), { statusCode: 404 });
    const links = await db
      .select({ id: profileLinks.id, label: profileLinks.label, url: profileLinks.url, sortOrder: profileLinks.sortOrder })
      .from(profileLinks)
      .where(and(eq(profileLinks.profileId, profile.id), eq(profileLinks.active, true)))
      .orderBy(asc(profileLinks.sortOrder));
    return { profile, links };
  });

  app.get("/card/:cardSlug", async (request) => {
    const { cardSlug } = request.params as { cardSlug: string };
    const [result] = await db
      .select({ profile: publicProfileFields, card: { publicSlug: cards.publicSlug, canonicalUrl: cards.canonicalUrl } })
      .from(cards)
      .innerJoin(customerProfiles, eq(customerProfiles.id, cards.profileId))
      .where(and(eq(cards.publicSlug, cardSlug), eq(cards.lifecycleStatus, "ACTIVATED"), eq(customerProfiles.published, true)))
      .limit(1);
    if (!result) throw Object.assign(new Error("Active card profile not found"), { statusCode: 404 });
    const links = await db
      .select({ id: profileLinks.id, label: profileLinks.label, url: profileLinks.url, sortOrder: profileLinks.sortOrder })
      .from(profileLinks)
      .where(and(eq(profileLinks.profileId, result.profile.id), eq(profileLinks.active, true)))
      .orderBy(asc(profileLinks.sortOrder));
    return { ...result, links };
  });

  app.get("/", async (request) => {
    await requireOperator(request, ["SUPER_ADMIN", "AUDITOR"]);
    const { page, query } = adminPage(request.query);
    const { visibility } = parseBody(z.object({ visibility: z.literal("draft").optional() }), request.query);
    const profiles = await db.select({ ...getTableColumns(customerProfiles), temporary: sql<boolean>`exists (select 1 from ${orderActivationProfiles} p where p.profile_id = ${customerProfiles.id} and p.redeemed_at is null)` }).from(customerProfiles).where(and(visibility ? eq(customerProfiles.published, false) : undefined,
      sql`position(lower(${query}) in lower(${customerProfiles.displayName} || ' ' || ${customerProfiles.company} || ' ' || ${customerProfiles.publicSlug} || ' ' || coalesce(${customerProfiles.handle}, '') || ' ' || ${customerProfiles.email})) > 0`))
      .orderBy(asc(customerProfiles.displayName), asc(customerProfiles.id)).limit(101).offset((page - 1) * 100);
    return { items: profiles.slice(0, 100), hasMore: profiles.length > 100 };
  });

  app.get("/:profileId", async (request) => {
    await requireOperator(request, ["SUPER_ADMIN", "AUDITOR"]);
    const { profileId } = request.params as { profileId: string };
    return profileWithLinks(profileId);
  });

  app.post("/", async (request, reply) => {
    const operator = await requireOperator(request, ["SUPER_ADMIN"]);
    const input = parseBody(CreateProfileSchema, request.body);
    const { links, ...profileData } = input;
    const profile = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(customerProfiles)
        .values({ ...profileData, ownerOperatorId: operator.operatorId })
        .returning();
      if (!created) throw new Error("Profile could not be created");
      await ensureProfileHandle(tx, created.id, created.displayName);
      if (links.length) {
        await tx.insert(profileLinks).values(links.map((link) => ({ ...link, profileId: created.id })));
      }
      await tx.insert(auditLogs).values({
        actorId: operator.operatorId,
        action: "PROFILE_CREATED",
        targetType: "customer_profile",
        targetId: created.id,
        requestId: request.id,
      });
      return created;
    });
    return sendCreated(reply, { ...(await profileWithLinks(profile.id)) });
  });

  app.patch("/:profileId", async (request) => {
    const operator = await requireOperator(request, ["SUPER_ADMIN"]);
    const { profileId } = request.params as { profileId: string };
    const parsed = parseBody(UpdateProfileSchema, request.body);
    // Zod defaults belong to creation; a PATCH must only update supplied fields.
    const input = Object.fromEntries(Object.entries(parsed).filter(([key]) => Object.hasOwn(request.body as object, key))) as typeof parsed;
    const { links, ...profileData } = input;
    const [existing] = await db.select().from(customerProfiles).where(eq(customerProfiles.id, profileId)).limit(1);
    if (!existing) throw Object.assign(new Error("Profile not found"), { statusCode: 404 });

    await db.transaction(async (tx) => {
      await lockPrintedStock(tx);
      const [pending] = await tx.select().from(orderActivationProfiles).where(and(eq(orderActivationProfiles.profileId, profileId), isNull(orderActivationProfiles.redeemedAt)));
      if (pending && profileData.published) throw Object.assign(new Error("The client must activate this temporary profile with their secret code first."), { statusCode: 409 });
      if (Object.keys(profileData).length) {
        await tx.update(customerProfiles).set({ ...profileData, updatedAt: new Date() }).where(eq(customerProfiles.id, profileId));
      }
      if (links) {
        await tx.delete(profileLinks).where(eq(profileLinks.profileId, profileId));
        if (links.length) await tx.insert(profileLinks).values(links.map((link) => ({ ...link, profileId })));
      }
      await tx.insert(auditLogs).values({
        actorId: operator.operatorId,
        action: "PROFILE_UPDATED",
        targetType: "customer_profile",
        targetId: profileId,
        requestId: request.id,
        metadata: { published: profileData.published ?? existing.published },
      });
    });
    return profileWithLinks(profileId);
  });

  app.post("/:profileId/assign-card", async (request) => {
    const operator = await requireOperator(request, ["SUPER_ADMIN", "INVENTORY_MANAGER"]);
    const { profileId } = request.params as { profileId: string };
    const input = parseBody(AssignCardSchema, request.body);
    const [profile] = await db.select().from(customerProfiles).where(eq(customerProfiles.id, profileId)).limit(1);
    const [card] = await db.select().from(cards).where(eq(cards.id, input.cardId)).limit(1);
    if (!profile || !card) throw Object.assign(new Error("Profile or card not found"), { statusCode: 404 });
    if (card.qcStatus !== "PASSED") {
      throw Object.assign(new Error("Only QC-passed cards can be assigned to a client profile"), { statusCode: 409 });
    }

    await db.transaction(async (tx) => {
      await lockPrintedStock(tx);
      const [pending] = await tx.select().from(orderActivationProfiles).where(and(eq(orderActivationProfiles.profileId, profileId), isNull(orderActivationProfiles.redeemedAt)));
      if (pending) throw Object.assign(new Error("Use the order secret code to activate this temporary profile."), { statusCode: 409 });
      const [current] = await tx.select().from(cards).where(eq(cards.id, card.id)).for("update");
      const [activation] = await tx.select().from(cardActivationSecrets).where(eq(cardActivationSecrets.cardId, card.id));
      if (current?.customerAccountId || current?.companyId || activation) throw Object.assign(new Error("This card uses client or company activation. Use its assigned workflow."), { statusCode: 409 });
      if (current?.profileId === profileId && current.lifecycleStatus === "ACTIVATED") return;
      const [allocation] = await tx.select({ id: orderCardAllocations.id }).from(orderCardAllocations).where(eq(orderCardAllocations.cardId, card.id)).limit(1);
      const [batch] = await tx.select({ confirmed: cardBatches.printConfirmedAt }).from(cardBatches).where(eq(cardBatches.id, card.batchId)).limit(1);
      if (allocation || !batch?.confirmed || current?.inventoryStatus !== "SALEABLE") throw Object.assign(new Error("Use confirmed, unreserved stock. Cards reserved for orders must use client activation."), { statusCode: 409 });
      const [assigned] = await tx.update(cards).set({ profileId, lifecycleStatus: "ACTIVATED", inventoryStatus: "RESERVED", updatedAt: new Date() })
        .where(and(eq(cards.id, card.id), isNull(cards.profileId), eq(cards.qcStatus, "PASSED"), eq(cards.lifecycleStatus, "QC_PASSED"))).returning();
      if (!assigned) throw Object.assign(new Error("Card is already assigned or is not available for activation"), { statusCode: 409 });
      await tx.insert(cardEvents).values({
        cardId: card.id,
        eventType: "PROFILE_ASSIGNED",
        previousState: card.lifecycleStatus,
        newState: "ACTIVATED",
        actorId: operator.operatorId,
        metadata: { profileId },
      });
      await tx.insert(auditLogs).values({
        actorId: operator.operatorId,
        action: "CARD_ASSIGNED_TO_PROFILE",
        targetType: "card",
        targetId: card.id,
        requestId: request.id,
        metadata: { profileId },
      });
    });
    return profileWithLinks(profileId);
  });
};
