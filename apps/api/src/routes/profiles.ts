import type { FastifyPluginAsync } from "fastify";
import { AssignCardSchema, contactVcard, CreateProfileSchema, UpdateProfileSchema } from "@oneinfo/contracts";
import { and, asc, eq, isNull } from "drizzle-orm";
import { requireOperator } from "../auth.js";
import { db } from "../db/client.js";
import { auditLogs, cardActivationSecrets, cardBatches, cardEvents, cards, customerProfiles, orderCardAllocations, profileLinks } from "../db/schema.js";
import { parseBody, sendCreated } from "../http.js";

export const publicProfileFields = {
  id: customerProfiles.id, publicSlug: customerProfiles.publicSlug, displayName: customerProfiles.displayName,
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
  return { ...profile, links, cards: assignedCards };
}

export const profileRoutes: FastifyPluginAsync = async (app) => {
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
    const profiles = await db.select().from(customerProfiles).orderBy(asc(customerProfiles.displayName)).limit(500);
    return { items: profiles, count: profiles.length };
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
    const input = parseBody(UpdateProfileSchema, request.body);
    const { links, ...profileData } = input;
    const [existing] = await db.select().from(customerProfiles).where(eq(customerProfiles.id, profileId)).limit(1);
    if (!existing) throw Object.assign(new Error("Profile not found"), { statusCode: 404 });

    await db.transaction(async (tx) => {
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
