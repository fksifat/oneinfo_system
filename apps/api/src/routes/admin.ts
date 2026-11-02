import type { FastifyPluginAsync } from "fastify";
import { count, desc, eq } from "drizzle-orm";
import { requireOperator } from "../auth.js";
import { db } from "../db/client.js";
import {
  auditLogs,
  cardBatches,
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
      db.select({ value: count() }).from(cards),
      db.select({ value: count() }).from(cardBatches),
      db.select({ value: count() }).from(productionStations),
      db.select({ value: count() }).from(productionJobs).where(eq(productionJobs.status, "QUEUED")),
      db.select({ value: count() }).from(qrArtifacts),
      db.select({ value: count() }).from(nfcEncodingAttempts),
    ]);
    const statusRows = await db
      .select({ status: cards.inventoryStatus, value: count() })
      .from(cards)
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

  app.get("/cards", async () => {
    const items = await db
      .select({ card: cards, profileName: customerProfiles.displayName })
      .from(cards)
      .leftJoin(customerProfiles, eq(customerProfiles.id, cards.profileId))
      .orderBy(desc(cards.createdAt))
      .limit(500);
    return { items, count: items.length };
  });

  app.get("/batches", async () => {
    const items = await db.select().from(cardBatches).orderBy(desc(cardBatches.createdAt)).limit(200);
    return { items, count: items.length };
  });

  app.get("/stations", async () => {
    const items = await db.select().from(productionStations).orderBy(desc(productionStations.createdAt)).limit(200);
    return { items, count: items.length };
  });

  app.post("/stations/:stationId/revoke", async (request) => {
    const operator = await requireOperator(request, ["SUPER_ADMIN"]);
    const { stationId } = request.params as { stationId: string };
    const [station] = await db
      .update(productionStations)
      .set({ status: "REVOKED", updatedAt: new Date() })
      .where(eq(productionStations.id, stationId))
      .returning();
    if (!station) throw Object.assign(new Error("Station not found"), { statusCode: 404 });
    await db.insert(auditLogs).values({
      actorId: operator.operatorId,
      action: "STATION_REVOKED",
      targetType: "production_station",
      targetId: stationId,
      requestId: request.id,
    });
    return station;
  });

  app.get("/audit-logs", async () => {
    const items = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(300);
    return { items, count: items.length };
  });
};
