import { confirmPrintedBatch, createProductionBatch, generateCardQr } from "../domain/batch-print.js";
import type { FastifyPluginAsync } from "fastify";
import { ConfirmBatchPrintSchema, CreateBatchSchema, GenerateBatchQrSchema } from "@oneinfo/contracts";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { requireOperator, requireStation } from "../auth.js";
import { db } from "../db/client.js";
import { cardBatches, cardEvents, cards, productionJobs, qrArtifacts, cardVerifications, nfcEncodingAttempts } from "../db/schema.js";
import { productionBatchSummary, verificationSummary } from "../domain/workflow.js";
import { parseBody, sendCreated } from "../http.js";
import { allocatePendingOrders, lockPrintedStock } from "../domain/printed-stock.js";
import { z } from "zod";
import { deleteProductionStock } from "../domain/delete-production-stock.js";
import { forgetProductionCards } from "./local-nfc.js";

async function latestWrites(batchId: string) {
  const writes = await db.select({ cardId: nfcEncodingAttempts.cardId, attemptedAt: nfcEncodingAttempts.attemptedAt }).from(nfcEncodingAttempts)
    .innerJoin(cards, eq(cards.id, nfcEncodingAttempts.cardId)).where(and(eq(cards.batchId, batchId), eq(nfcEncodingAttempts.result, "SUCCEEDED")))
    .orderBy(desc(nfcEncodingAttempts.attemptedAt));
  return (cardId: string) => writes.find((write) => write.cardId === cardId)?.attemptedAt;
}

async function checkedPrints(batchId: string) {
  const checks = await db.select({ cardId: cardEvents.cardId }).from(cardEvents).innerJoin(cards, eq(cards.id, cardEvents.cardId))
    .where(and(eq(cards.batchId, batchId), eq(cardEvents.eventType, "PRINT_QR_CHECKED")));
  return new Set(checks.map((check) => check.cardId));
}

export const batchRoutes: FastifyPluginAsync = async (app) => {
  for (const path of ["/:batchId", "/:batchId/cards/:cardId"]) app.delete(path, async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN", "INVENTORY_MANAGER"]);
    const { batchId, cardId } = parseBody(z.object({ batchId: z.uuid(), cardId: z.uuid().optional() }), request.params);
    const { confirmation } = parseBody(z.object({ confirmation: z.string().min(1).max(64) }), request.body);
    const result = await deleteProductionStock(batchId, cardId, confirmation, actor.operatorId, request.id);
    try { forgetProductionCards(result.cardIds); }
    catch { request.log.warn("Deleted stock; NFC state cleanup could not be saved"); }
    return { deleted: result.deleted, batchId, batchDeleted: result.batchDeleted };
  });

  app.post("/", async (request, reply) => {
    const operator = await requireOperator(request, ["SUPER_ADMIN"]);
    const input = parseBody(CreateBatchSchema, request.body);
    const result = await db.transaction(tx => createProductionBatch(tx, input, operator.operatorId, request.id));

    return sendCreated(reply, result);
  });

  app.get("/", async (request) => {
    await requireOperator(request);
    const items = await db.select().from(cardBatches).orderBy(desc(cardBatches.createdAt)).limit(200);
    const batchCards = items.length ? await db.select({ batchId: cards.batchId, qrStatus: cards.qrStatus, nfcStatus: cards.nfcStatus, qcStatus: cards.qcStatus })
      .from(cards).where(inArray(cards.batchId, items.map((batch) => batch.id))) : [];
    return { items: items.map((batch) => ({ ...batch, ...productionBatchSummary(batchCards.filter((card) => card.batchId === batch.id)) })) };
  });

  app.post("/:batchId/generate-qr", async (request) => {
    const operator = await requireOperator(request, ["SUPER_ADMIN", "PRODUCTION_OPERATOR"]);
    const station = await requireStation(request);
    const { batchId } = request.params as { batchId: string };
    const input = parseBody(GenerateBatchQrSchema, request.body ?? {});
    const batchCards = await db.select().from(cards).where(and(eq(cards.batchId, batchId), input.cardId ? eq(cards.id, input.cardId) : undefined));
    if (!batchCards.length) throw Object.assign(new Error("Batch or card not found"), { statusCode: 404 });
    let generated = 0;
    for (const card of batchCards) {
      const result = await db.transaction(tx => generateCardQr(tx, card, operator.operatorId, station.stationId));
      if (result.generated) generated++;
    }
    return { generated, total: batchCards.length };
  });

  app.post("/:batchId/confirm-print", async (request) => {
    const operator = await requireOperator(request, ["SUPER_ADMIN", "PRODUCTION_OPERATOR"]);
    const station = await requireStation(request);
    parseBody(ConfirmBatchPrintSchema, request.body);
    const { batchId } = request.params as { batchId: string };
    return db.transaction(async (tx) => {
      await lockPrintedStock(tx);
      const replayed = await confirmPrintedBatch(tx, batchId, operator.operatorId, request.id, station.stationId);
      const assigned = await allocatePendingOrders(tx);
      return { confirmed: true, assigned, replayed };
    });
  });

  app.get("/:batchId", async (request) => {
    await requireOperator(request);
    const { batchId } = request.params as { batchId: string };
    const [batch] = await db.select().from(cardBatches).where(eq(cardBatches.id, batchId)).limit(1);
    if (!batch) throw Object.assign(new Error("Batch not found"), { statusCode: 404 });
    const batchCards = await db.select().from(cards).where(eq(cards.batchId, batchId)).orderBy(asc(cards.createdAt), asc(cards.publicSlug));
    const jobs = await db.select().from(productionJobs).where(eq(productionJobs.batchId, batchId));
    const artifacts = await db.select({ cardId: qrArtifacts.cardId, imageData: qrArtifacts.imageData, generatedAt: qrArtifacts.generatedAt })
      .from(qrArtifacts).innerJoin(cards, eq(cards.id, qrArtifacts.cardId)).where(eq(cards.batchId, batchId)).orderBy(desc(qrArtifacts.generatedAt));
    const checks = await db.select({ verification: cardVerifications }).from(cardVerifications)
      .innerJoin(cards, eq(cards.id, cardVerifications.cardId)).where(eq(cards.batchId, batchId)).orderBy(desc(cardVerifications.createdAt));
    const writtenAt = await latestWrites(batchId);
    const prints = await checkedPrints(batchId);
    return { ...batch, ...productionBatchSummary(batchCards), cards: batchCards.map((card) => ({ ...card,
      printChecked: prints.has(card.id),
      imageData: artifacts.find((artifact) => artifact.cardId === card.id && artifact.imageData)?.imageData ?? null,
      verification: verificationSummary(checks.filter((row) => row.verification.cardId === card.id).map((row) => row.verification), writtenAt(card.id)),
      jobs: jobs.filter((job) => job.cardId === card.id),
    })) };
  });

  app.get("/:batchId/verification-status", async (request) => {
    await requireOperator(request);
    const { batchId } = request.params as { batchId: string };
    const [batch] = await db.select({ id: cardBatches.id, printConfirmedAt: cardBatches.printConfirmedAt }).from(cardBatches).where(eq(cardBatches.id, batchId)).limit(1);
    if (!batch) throw Object.assign(new Error("Batch not found"), { statusCode: 404 });
    const batchCards = await db.select({ id: cards.id, qrStatus: cards.qrStatus, nfcStatus: cards.nfcStatus, qcStatus: cards.qcStatus })
      .from(cards).where(eq(cards.batchId, batchId));
    const checks = await db.select({ verification: cardVerifications }).from(cardVerifications)
      .innerJoin(cards, eq(cards.id, cardVerifications.cardId)).where(eq(cards.batchId, batchId));
    const writtenAt = await latestWrites(batchId);
    const prints = await checkedPrints(batchId);
    return { printConfirmedAt: batch.printConfirmedAt, items: batchCards.map((card) => ({ ...card,
      printChecked: prints.has(card.id),
      verification: verificationSummary(checks.filter((row) => row.verification.cardId === card.id).map((row) => row.verification), writtenAt(card.id)),
    })) };
  });
};
