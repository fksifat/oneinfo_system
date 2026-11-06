import type { FastifyPluginAsync } from "fastify";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireOperator } from "../auth.js";
import { db } from "../db/client.js";
import { auditLogs, cardActivationSecrets, cardBatches, cardEvents, cards, orderCardAllocations } from "../db/schema.js";
import { parseBody } from "../http.js";
import { config } from "../config.js";

export const cardRoutes: FastifyPluginAsync = async (app) => {
  app.get("/:cardId/history", async (request, reply) => {
    await requireOperator(request);
    reply.header("Cache-Control", "no-store");
    const { cardId } = parseBody(z.object({ cardId: z.uuid() }), request.params);
    const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
    if (!card) throw Object.assign(new Error("Card not found"), { statusCode: 404 });
    const events = await db
      .select()
      .from(cardEvents)
      .where(eq(cardEvents.cardId, cardId))
      .orderBy(asc(cardEvents.createdAt));
    const [batch] = await db.select({ batchCode: cardBatches.batchCode, printConfirmedAt: cardBatches.printConfirmedAt }).from(cardBatches).where(eq(cardBatches.id, card.batchId));
    const [activation] = await db.select({ issuedAt: cardActivationSecrets.issuedAt, redeemedAt: cardActivationSecrets.redeemedAt })
      .from(cardActivationSecrets).where(eq(cardActivationSecrets.cardId, cardId));
    return { card, events, batch, activation };
  });

  app.post("/:cardId/disable", async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN", "INVENTORY_MANAGER"]);
    const { cardId } = parseBody(z.object({ cardId: z.uuid() }), request.params);
    return db.transaction(async tx => {
      const [card] = await tx.select().from(cards).where(eq(cards.id, cardId)).for("update");
      if (!card?.profileId || !["ACTIVATED", "SUSPENDED", "RETIRED"].includes(card.lifecycleStatus)) {
        throw Object.assign(new Error("Only an assigned card can be disabled."), { statusCode: 409 });
      }
      if (card.lifecycleStatus === "RETIRED") return { disabled: true };
      await tx.update(cards).set({ lifecycleStatus: "RETIRED", updatedAt: new Date() }).where(eq(cards.id, cardId));
      await tx.insert(cardEvents).values({ cardId, actorId: actor.operatorId, eventType: "CARD_DISABLED", previousState: card.lifecycleStatus, newState: "RETIRED" });
      await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: "CARD_DISABLED", targetType: "card", targetId: cardId, requestId: request.id });
      return { disabled: true };
    });
  });

  app.post("/:cardId/replace", async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN", "INVENTORY_MANAGER"]);
    const { cardId } = parseBody(z.object({ cardId: z.uuid() }), request.params);
    const { replacementSlug } = parseBody(z.object({ replacementSlug: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,64}$/) }), request.body);
    return db.transaction(async tx => {
      const [candidate] = await tx.select({ id: cards.id }).from(cards).where(eq(cards.publicSlug, replacementSlug));
      const locked = candidate ? await tx.select().from(cards).where(inArray(cards.id, [cardId, candidate.id])).orderBy(asc(cards.id)).for("update") : [];
      const old = locked.find(card => card.id === cardId), next = locked.find(card => card.id === candidate?.id && card.id !== cardId);
      if (!old?.profileId || !["ACTIVATED", "SUSPENDED", "RETIRED"].includes(old.lifecycleStatus) || !next || next.profileId || next.customerAccountId || next.companyId ||
        next.qcStatus !== "PASSED" || next.lifecycleStatus !== "QC_PASSED" || next.inventoryStatus !== "SALEABLE" ||
        next.canonicalUrl !== `${config.PUBLIC_CARD_BASE_URL.replace(/\/$/, "")}/${next.publicSlug}`) {
        throw Object.assign(new Error("Choose an active or suspended card and a different, unassigned QC-passed Oneinfo card."), { statusCode: 409 });
      }
      const [batch] = await tx.select({ confirmed: cardBatches.printConfirmedAt }).from(cardBatches).where(eq(cardBatches.id, next.batchId));
      const [allocated] = await tx.select({ id: orderCardAllocations.id }).from(orderCardAllocations).where(eq(orderCardAllocations.cardId, next.id));
      const [issued] = await tx.select({ id: cardActivationSecrets.cardId }).from(cardActivationSecrets).where(and(eq(cardActivationSecrets.cardId, next.id)));
      if (!batch?.confirmed || allocated || issued) throw Object.assign(new Error("The replacement must be confirmed stock without an issued activation code or order allocation."), { statusCode: 409 });
      const now = new Date();
      await tx.update(cards).set({ lifecycleStatus: "REPLACED", updatedAt: now }).where(eq(cards.id, old.id));
      await tx.update(cards).set({ profileId: old.profileId, customerAccountId: old.customerAccountId, companyId: old.companyId, claimedAt: old.customerAccountId ? now : null,
        lifecycleStatus: "ACTIVATED", inventoryStatus: "RESERVED", updatedAt: now }).where(eq(cards.id, next.id));
      await tx.insert(cardEvents).values([
        { cardId: old.id, actorId: actor.operatorId, eventType: "CARD_REPLACED", previousState: old.lifecycleStatus, newState: "REPLACED", metadata: { replacementSlug } },
        { cardId: next.id, actorId: actor.operatorId, eventType: "REPLACEMENT_ACTIVATED", previousState: next.lifecycleStatus, newState: "ACTIVATED", metadata: { previousSlug: old.publicSlug } },
      ]);
      await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: "CARD_REPLACED", targetType: "card", targetId: old.id,
        requestId: request.id, metadata: { replacementCardId: next.id } });
      return { replacementSlug };
    });
  });
};
