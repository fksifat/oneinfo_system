import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { auditLogs, cardActivationSecrets, cardBatches, cardEvents, cards, cardVerifications, nfcEncodingAttempts,
  orderCardAllocations, productionJobs, qrArtifacts, qualityChecks } from "../db/schema.js";
import { lockPrintedStock } from "./printed-stock.js";

export async function deleteProductionStock(batchId: string, cardId: string | undefined, confirmation: string, actorId: string, requestId: string) {
  return db.transaction(async tx => {
    await lockPrintedStock(tx);
    const [batch] = await tx.select().from(cardBatches).where(eq(cardBatches.id, batchId)).for("update");
    if (!batch) throw Object.assign(new Error("Batch not found"), { statusCode: 404 });
    const condition = and(eq(cards.batchId, batchId), cardId ? eq(cards.id, cardId) : undefined);
    const targets = await tx.select({ id: cards.id }).from(cards).where(condition);
    if (cardId && !targets.length) throw Object.assign(new Error("Card not found in this batch"), { statusCode: 404 });
    let ids = targets.map(card => card.id);
    // Lock jobs before cards, matching generation/result handlers and preventing an in-flight write from racing deletion.
    const jobs = ids.length ? await tx.select().from(productionJobs).where(inArray(productionJobs.cardId, ids)).orderBy(asc(productionJobs.id)).for("update") : [];
    const selected = ids.length ? await tx.select().from(cards).where(inArray(cards.id, ids)).orderBy(asc(cards.id)).for("update") : [];
    if (confirmation !== (cardId ? selected[0]!.publicSlug : batch.batchCode)) {
      throw Object.assign(new Error("Type the exact batch code or card ID to confirm deletion."), { statusCode: 400 });
    }
    const allocated = ids.length ? await tx.select({ cardId: orderCardAllocations.cardId }).from(orderCardAllocations).where(inArray(orderCardAllocations.cardId, ids)) : [];
    const protectedIds = new Set(allocated.map(row => row.cardId));
    for (const card of selected) {
      if (card.profileId || card.customerAccountId || card.companyId || card.claimedAt ||
        ["RESERVED", "DISPATCHED"].includes(card.inventoryStatus) || ["ACTIVATED", "SUSPENDED", "REPLACED", "RETIRED"].includes(card.lifecycleStatus)) protectedIds.add(card.id);
    }
    if (cardId && protectedIds.has(cardId)) {
      throw Object.assign(new Error("Cannot delete assigned or reserved cards."), { statusCode: 409 });
    }
    if (cardId && jobs.some(job => job.status === "CLAIMED")) {
      throw Object.assign(new Error("A card has a claimed production job. Finish the NFC/QC operation before deleting it."), { statusCode: 409 });
    }
    for (const job of jobs) if (job.status === "CLAIMED") protectedIds.add(job.cardId);
    ids = ids.filter(id => !protectedIds.has(id));
    const skipped = selected.length - ids.length;
    if (selected.length && !ids.length) throw Object.assign(new Error("No unused cards can be deleted. All remaining cards are assigned, reserved or have a claimed production job."), { statusCode: 409 });
    if (ids.length) {
      await tx.delete(qrArtifacts).where(inArray(qrArtifacts.cardId, ids));
      await tx.delete(nfcEncodingAttempts).where(inArray(nfcEncodingAttempts.cardId, ids));
      await tx.delete(qualityChecks).where(inArray(qualityChecks.cardId, ids));
      await tx.delete(cardVerifications).where(inArray(cardVerifications.cardId, ids));
      await tx.delete(cardEvents).where(inArray(cardEvents.cardId, ids));
      await tx.delete(cardActivationSecrets).where(inArray(cardActivationSecrets.cardId, ids));
      await tx.delete(productionJobs).where(inArray(productionJobs.cardId, ids));
      await tx.delete(cards).where(inArray(cards.id, ids));
    }
    const [remaining] = await tx.select({ total: sql<number>`count(*)::int` }).from(cards).where(eq(cards.batchId, batchId));
    const batchDeleted = remaining!.total === 0;
    if (batchDeleted) await tx.delete(cardBatches).where(eq(cardBatches.id, batchId));
    else await tx.update(cardBatches).set({ plannedQuantity: remaining!.total, updatedAt: new Date() }).where(eq(cardBatches.id, batchId));
    await tx.insert(auditLogs).values({ actorId, action: cardId ? "PRODUCTION_CARD_DELETED" : batchDeleted ? "PRODUCTION_BATCH_DELETED" : "PRODUCTION_BATCH_STOCK_DELETED",
      targetType: cardId ? "card" : "card_batch", targetId: cardId ?? batchId, requestId,
      metadata: { batchId, batchCode: batch.batchCode, batchDeleted, skipped, deleted: selected.filter(card => ids.includes(card.id)).map(card => ({ id: card.id, publicSlug: card.publicSlug })) } });
    return { deleted: ids.length, skipped, batchId, batchDeleted, cardIds: ids };
  });
}
