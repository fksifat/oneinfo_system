import type { FastifyPluginAsync } from "fastify";
import { and, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { parseBody } from "../http.js";
import { requireOperator } from "../auth.js";
import { db } from "../db/client.js";
import { productionBatchSummary } from "../domain/workflow.js";
import {
  auditLogs,
  cardBatches,
  cardActivationSecrets,
  cards,
  customerProfiles,
  nfcEncodingAttempts,
  productionJobs,
  productionStations,
  qrArtifacts,
} from "../db/schema.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request) => {
    await requireOperator(request, ["SUPER_ADMIN", "AUDITOR"]);
  });

  app.get("/overview", async () => {
    const [profileTotal, cardTotal, batchTotal, stationTotal, pendingJobs, qrTotal, nfcAttemptTotal] = await Promise.all([
      db.select({ value: count() }).from(customerProfiles),
      db.select({ value: count() }).from(cards).innerJoin(cardBatches, eq(cards.batchId, cardBatches.id)).where(isNotNull(cardBatches.printConfirmedAt)),
      db.select({ value: count() }).from(cardBatches).where(isNotNull(cardBatches.printConfirmedAt)),
      db.select({ value: count() }).from(productionStations).where(eq(productionStations.status, "ACTIVE")),
      db.select({ value: count() }).from(productionJobs).innerJoin(cardBatches, eq(productionJobs.batchId, cardBatches.id))
        .where(and(isNotNull(cardBatches.printConfirmedAt), inArray(productionJobs.status, ["QUEUED", "CLAIMED", "RETRYABLE_FAILURE"]))),
      db.select({ value: count() }).from(qrArtifacts).innerJoin(cards, eq(qrArtifacts.cardId, cards.id))
        .innerJoin(cardBatches, eq(cards.batchId, cardBatches.id)).where(isNotNull(cardBatches.printConfirmedAt)),
      db.select({ value: count() }).from(nfcEncodingAttempts).innerJoin(cards, eq(nfcEncodingAttempts.cardId, cards.id))
        .innerJoin(cardBatches, eq(cards.batchId, cardBatches.id)).where(isNotNull(cardBatches.printConfirmedAt)),
    ]);
    const statusRows = await db
      .select({ status: cards.inventoryStatus, value: count() })
      .from(cards)
      .innerJoin(cardBatches, eq(cards.batchId, cardBatches.id)).where(isNotNull(cardBatches.printConfirmedAt))
      .groupBy(cards.inventoryStatus);
    return {
      profiles: profileTotal[0]?.value ?? 0,
      cards: cardTotal[0]?.value ?? 0,
      batches: batchTotal[0]?.value ?? 0,
      stations: stationTotal[0]?.value ?? 0,
      pendingJobs: pendingJobs[0]?.value ?? 0,
      qrArtifacts: qrTotal[0]?.value ?? 0,
      nfcAttempts: nfcAttemptTotal[0]?.value ?? 0,
      inventory: Object.fromEntries(statusRows.map((row) => [row.status, row.value])),
    };
  });

  app.get("/cards", async (request) => {
    const { beforeId } = parseBody(z.object({ beforeId: z.uuid().optional() }), request.query);
    const before = db.select({ createdAt: cards.createdAt, id: cards.id }).from(cards).where(eq(cards.id, beforeId ?? ""));
    const items = await db
      .select({ card: cards, profileName: customerProfiles.displayName, activationCodeIssuedAt: cardActivationSecrets.issuedAt,
        imageData: sql<string | null>`(select image_data from ${qrArtifacts} where card_id = ${cards.id} and image_data is not null order by generated_at desc limit 1)` })
      .from(cards)
      .innerJoin(cardBatches, eq(cards.batchId, cardBatches.id))
      .leftJoin(customerProfiles, eq(customerProfiles.id, cards.profileId))
      .leftJoin(cardActivationSecrets, eq(cardActivationSecrets.cardId, cards.id))
      .where(and(isNotNull(cardBatches.printConfirmedAt), beforeId ? sql`(${cards.createdAt}, ${cards.id}) < (${before})` : undefined))
      .orderBy(desc(cards.createdAt), desc(cards.id))
      .limit(101);
    return { items: items.slice(0, 100), count: Math.min(items.length, 100), hasMore: items.length > 100 };
  });

  app.get("/batches", async () => {
    const items = await db.select().from(cardBatches).where(isNotNull(cardBatches.printConfirmedAt)).orderBy(desc(cardBatches.createdAt)).limit(200);
    const batchCards = items.length ? await db.select({ batchId: cards.batchId, qrStatus: cards.qrStatus, nfcStatus: cards.nfcStatus, qcStatus: cards.qcStatus })
      .from(cards).where(inArray(cards.batchId, items.map((batch) => batch.id))) : [];
    return { items: items.map((batch) => ({ ...batch, ...productionBatchSummary(batchCards.filter((card) => card.batchId === batch.id)) })), count: items.length };
  });

  app.get("/stations", async () => {
    const items = await db.select({ id: productionStations.id, stationCode: productionStations.stationCode, name: productionStations.name,
      status: productionStations.status, lastSeenAt: productionStations.lastSeenAt, createdAt: productionStations.createdAt })
      .from(productionStations).orderBy(desc(productionStations.createdAt)).limit(200);
    return { items, count: items.length };
  });

  app.post("/stations/:stationId/revoke", async (request) => {
    const operator = await requireOperator(request, ["SUPER_ADMIN"]);
    const { stationId } = request.params as { stationId: string };
    const station = await db.transaction(async (tx) => {
      const [station] = await tx
        .update(productionStations)
        .set({ status: "REVOKED", updatedAt: new Date() })
        .where(eq(productionStations.id, stationId))
        .returning();
      if (!station) throw Object.assign(new Error("Station not found"), { statusCode: 404 });
      await tx.insert(auditLogs).values({
        actorId: operator.operatorId,
        action: "STATION_REVOKED",
        targetType: "production_station",
        targetId: stationId,
        requestId: request.id,
      });
      return station;
    });
    const { credentialHash: _credentialHash, ...safeStation } = station;
    return safeStation;
  });

  app.get("/audit-logs", async () => {
    const items = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(300);
    return { items, count: items.length };
  });
};
