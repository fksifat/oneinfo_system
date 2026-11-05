import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { ConfirmBatchPrintSchema, CreateBatchSchema, GenerateBatchQrSchema } from "@oneinfo/contracts";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import QRCode from "qrcode";
import { config } from "../config.js";
import { requireOperator, requireStation } from "../auth.js";
import { db } from "../db/client.js";
import { auditLogs, cardBatches, cardEvents, cards, productionJobs, qrArtifacts, cardVerifications, nfcEncodingAttempts } from "../db/schema.js";
import { productionBatchSummary, verificationSummary } from "../domain/workflow.js";
import { parseBody, sendCreated } from "../http.js";
import { allocatePendingOrders, lockPrintedStock } from "../domain/printed-stock.js";

function makePublicSlug(): string {
  return randomBytes(9).toString("base64url");
}

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
  app.post("/", async (request, reply) => {
    const operator = await requireOperator(request, ["SUPER_ADMIN"]);
    const input = parseBody(CreateBatchSchema, request.body);
    const batchId = randomUUID();

    const result = await db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(cardBatches)
        .values({
          id: batchId,
          batchCode: input.batchCode,
          productVariantId: input.productVariantId,
          plannedQuantity: input.quantity,
          createdBy: operator.operatorId,
        })
        .returning();

      for (let index = 0; index < input.quantity; index += 1) {
        const cardId = randomUUID();
        const publicSlug = makePublicSlug();
        const canonicalUrl = input.links?.[index] ?? `${config.PUBLIC_CARD_BASE_URL.replace(/\/$/, "")}/${publicSlug}`;
        await tx.insert(cards).values({ id: cardId, batchId, publicSlug, canonicalUrl });
        await tx.insert(productionJobs).values([
          { batchId, cardId, type: "QR_GENERATION" },
          { batchId, cardId, type: "NFC_ENCODING" },
          { batchId, cardId, type: "QUALITY_CONTROL" },
        ]);
        await tx.insert(cardEvents).values({
          cardId,
          eventType: "CARD_CREATED",
          newState: "CREATED",
          actorId: operator.operatorId,
          metadata: { batchId, sequence: index + 1 },
        });
      }

      await tx.insert(auditLogs).values({
        actorId: operator.operatorId,
        action: "BATCH_CREATED",
        targetType: "card_batch",
        targetId: batchId,
        requestId: request.id,
        metadata: { quantity: input.quantity },
      });
      return batch;
    });

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
      const imageData = await QRCode.toDataURL(card.canonicalUrl, { errorCorrectionLevel: "H", margin: 4, width: 512 });
      const imageBytes = Buffer.from(imageData.split(",")[1]!, "base64");
      const checksum = createHash("sha256").update(imageBytes).digest("hex");
      await db.transaction(async (tx) => {
        const [job] = await tx.select().from(productionJobs)
          .where(and(eq(productionJobs.cardId, card.id), eq(productionJobs.type, "QR_GENERATION"))).for("update");
        if (!job || job.status === "CANCELLED" || (job.assignedStationId && job.assignedStationId !== station.stationId && job.status !== "COMPLETED")) {
          throw Object.assign(new Error(`QR job for ${card.publicSlug} is not available to this station`), { statusCode: 409 });
        }
        const [existing] = await tx.select().from(qrArtifacts).where(eq(qrArtifacts.jobId, job.id)).orderBy(desc(qrArtifacts.generatedAt)).limit(1);
        if (existing?.imageData) return;
        const artifact = { imageData, checksumSha256: checksum, format: "PNG", width: 512, height: 512,
          generatorVersion: "qrcode-js/1.5.4", storageKey: `postgres://${card.id}/qr.png` };
        if (existing) await tx.update(qrArtifacts).set(artifact).where(eq(qrArtifacts.id, existing.id));
        else await tx.insert(qrArtifacts).values({ ...artifact, jobId: job.id, cardId: card.id, idempotencyKey: randomUUID() });
        if (job.status !== "COMPLETED") {
          await tx.update(productionJobs).set({ status: "COMPLETED", assignedStationId: station.stationId, claimedBy: operator.operatorId,
            completedAt: new Date(), updatedAt: new Date() }).where(eq(productionJobs.id, job.id));
          await tx.update(cards).set({ qrStatus: "GENERATED", lifecycleStatus: "IN_PRODUCTION", updatedAt: new Date() }).where(eq(cards.id, card.id));
          await tx.insert(cardEvents).values({ cardId: card.id, eventType: "QR_GENERATED", previousState: card.qrStatus, newState: "GENERATED",
            actorId: operator.operatorId, stationId: station.stationId, metadata: { checksumSha256: checksum, format: "PNG" } });
        }
        generated++;
      });
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
      const [batch] = await tx.select().from(cardBatches).where(eq(cardBatches.id, batchId)).for("update");
      if (!batch) throw Object.assign(new Error("Batch not found"), { statusCode: 404 });
      if (!batch.printConfirmedAt) {
        const batchCards = await tx.select().from(cards).where(eq(cards.batchId, batchId));
        const images = await tx.select({ cardId: qrArtifacts.cardId }).from(qrArtifacts).innerJoin(cards, eq(cards.id, qrArtifacts.cardId))
          .where(and(eq(cards.batchId, batchId), isNotNull(qrArtifacts.imageData)));
        if (batchCards.length !== batch.plannedQuantity || batchCards.some((card) => card.qrStatus !== "GENERATED" || !images.some((image) => image.cardId === card.id))) {
          throw Object.assign(new Error("Generate every QR image before confirming the printed batch"), { statusCode: 409 });
        }
        await tx.update(cardBatches).set({ printConfirmedAt: new Date(), printConfirmedBy: operator.operatorId }).where(eq(cardBatches.id, batchId));
        await tx.insert(auditLogs).values({ actorId: operator.operatorId, stationId: station.stationId, action: "BATCH_PRINT_CONFIRMED",
          targetType: "card_batch", targetId: batchId, requestId: request.id, metadata: { quantity: batchCards.length } });
      }
      const assigned = await allocatePendingOrders(tx);
      return { confirmed: true, assigned, replayed: Boolean(batch.printConfirmedAt) };
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
