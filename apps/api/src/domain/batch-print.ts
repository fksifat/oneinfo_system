import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { CreateBatchSchema } from "@oneinfo/contracts";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { productionQrImage, qrGeneratorVersion } from "./qr-image.js";
import type { z } from "zod";
import { config } from "../config.js";
import type { db } from "../db/client.js";
import { auditLogs, cardBatches, cardEvents, cards, productionJobs, qrArtifacts } from "../db/schema.js";
import { qrUrl } from "./card-urls.js";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function createProductionBatch(tx: Transaction, input: z.infer<typeof CreateBatchSchema>, actorId: string, requestId: string) {
  const batchId = randomUUID();
  const [batch] = await tx
    .insert(cardBatches)
    .values({
      id: batchId,
      batchCode: input.batchCode,
      productVariantId: input.productVariantId,
      plannedQuantity: input.quantity,
      createdBy: actorId,
    })
    .returning();

  const batchCards = Array.from({ length: input.quantity }, (_, index) => {
    const publicSlug = randomBytes(9).toString("base64url");
    const canonicalUrl = input.links?.[index] ?? `${config.PUBLIC_CARD_BASE_URL.replace(/\/$/, "")}/${publicSlug}?source=nfc`;
    return { id: randomUUID(), batchId, publicSlug, canonicalUrl };
  });
  await tx.insert(cards).values(batchCards);
  await tx.insert(productionJobs).values(batchCards.flatMap(card =>
    (["QR_GENERATION", "NFC_ENCODING", "QUALITY_CONTROL"] as const).map(type => ({ batchId, cardId: card.id, type }))));
  await tx.insert(cardEvents).values(batchCards.map((card, index) => ({
      cardId: card.id,
      eventType: "CARD_CREATED",
      newState: "CREATED",
      actorId,
      metadata: { batchId, sequence: index + 1 },
  })));

  await tx.insert(auditLogs).values({
    actorId,
    action: "BATCH_CREATED",
    targetType: "card_batch",
    targetId: batchId,
    requestId,
    metadata: { quantity: input.quantity },
  });
  return batch;
}

export async function generateCardQr(tx: Transaction, card: typeof cards.$inferSelect, actorId: string, stationId?: string) {
  const [job] = await tx.select().from(productionJobs)
    .where(and(eq(productionJobs.cardId, card.id), eq(productionJobs.type, "QR_GENERATION"))).for("update");
  if (!job || job.status === "CANCELLED" || (job.assignedStationId && job.assignedStationId !== stationId && job.status !== "COMPLETED")) {
    throw Object.assign(new Error(`QR job for ${card.publicSlug} is not available to this station`), { statusCode: 409 });
  }
  const [existing] = await tx.select().from(qrArtifacts).where(eq(qrArtifacts.jobId, job.id)).orderBy(desc(qrArtifacts.generatedAt)).limit(1);
  if (existing?.imageData && existing.generatorVersion === qrGeneratorVersion) return { imageData: existing.imageData, generated: false };
  const imageData = productionQrImage(qrUrl(card.canonicalUrl));
  const imageBytes = Buffer.from(imageData.split(",")[1]!, "base64");
  const checksum = createHash("sha256").update(imageBytes).digest("hex");
  const artifact = { imageData, checksumSha256: checksum, format: "PNG", width: 512, height: 512,
    generatorVersion: qrGeneratorVersion, storageKey: `postgres://${card.id}/qr.png` };
  if (existing && !existing.imageData) await tx.update(qrArtifacts).set(artifact).where(eq(qrArtifacts.id, existing.id));
  else await tx.insert(qrArtifacts).values({ ...artifact, jobId: job.id, cardId: card.id, idempotencyKey: randomUUID() });
  if (job.status !== "COMPLETED") {
    await tx.update(productionJobs).set({ status: "COMPLETED", assignedStationId: stationId ?? null, claimedBy: actorId,
      completedAt: new Date(), updatedAt: new Date() }).where(eq(productionJobs.id, job.id));
    await tx.update(cards).set({ qrStatus: "GENERATED", lifecycleStatus: "IN_PRODUCTION", updatedAt: new Date() }).where(eq(cards.id, card.id));
    await tx.insert(cardEvents).values({ cardId: card.id, eventType: "QR_GENERATED", previousState: card.qrStatus, newState: "GENERATED",
      actorId, stationId, metadata: { checksumSha256: checksum, format: "PNG" } });
  }
  return { imageData, generated: true };
}

export async function confirmPrintedBatch(tx: Transaction, batchId: string, actorId: string, requestId: string, stationId?: string) {
  const [batch] = await tx.select().from(cardBatches).where(eq(cardBatches.id, batchId)).for("update");
  if (!batch) throw Object.assign(new Error("Batch not found"), { statusCode: 404 });
  if (!batch.printConfirmedAt) {
    const batchCards = await tx.select().from(cards).where(eq(cards.batchId, batchId));
    const images = await tx.select({ cardId: qrArtifacts.cardId }).from(qrArtifacts).innerJoin(cards, eq(cards.id, qrArtifacts.cardId))
      .where(and(eq(cards.batchId, batchId), isNotNull(qrArtifacts.imageData)));
    if (batchCards.length !== batch.plannedQuantity || batchCards.some((card) => card.qrStatus !== "GENERATED" || !images.some((image) => image.cardId === card.id))) {
      throw Object.assign(new Error("Generate every QR image before confirming the printed batch"), { statusCode: 409 });
    }
    await tx.update(cardBatches).set({ printConfirmedAt: new Date(), printConfirmedBy: actorId }).where(eq(cardBatches.id, batchId));
    await tx.insert(auditLogs).values({ actorId, stationId, action: "BATCH_PRINT_CONFIRMED",
      targetType: "card_batch", targetId: batchId, requestId, metadata: { quantity: batchCards.length } });
  }
  return Boolean(batch.printConfirmedAt);
}
