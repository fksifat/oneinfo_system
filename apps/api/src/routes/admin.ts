import { adminPage } from "../domain/admin-page.js";
import type { FastifyPluginAsync } from "fastify";
import { and, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { parseBody } from "../http.js";
import { requireOperator } from "../auth.js";
import { db } from "../db/client.js";
import { productionBatchSummary } from "../domain/workflow.js";
import { printedStockAvailable } from "../domain/printed-stock.js";
import { attentionCounts, attentionTasks, taskStages } from "../domain/admin-work.js";
import { nfcUrlFromQr, qrUrl } from "../domain/card-urls.js";
import { printFinish } from "@oneinfo/contracts";
import {
  auditLogs,
  cardBatches,
  cardActivationSecrets,
  cards,
  customerProfiles,
  nfcEncodingAttempts,
  orderCardAllocations,
  productionJobs,
  productionStations,
  products,
  qrArtifacts,
  storeOrders,
} from "../db/schema.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request) => {
    await requireOperator(request, ["SUPER_ADMIN", "AUDITOR"]);
  });

  app.get("/overview", async () => {
    const attention = await attentionCounts();
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
    const [[printed], catalog] = await Promise.all([
      db.select({ value: count() }).from(cards).innerJoin(cardBatches, eq(cards.batchId, cardBatches.id)).where(printedStockAvailable()),
      db.select({ name: products.name, variants: products.variants }).from(products).where(eq(products.status, "PUBLISHED")),
    ]);
    const threshold = 5;
    const stockAlerts = catalog.flatMap(product => product.variants.flatMap(variant =>
      variant.available && variant.stockQuantity !== undefined && variant.stockQuantity <= threshold
        ? [{ name: `${product.name} · ${variant.name}`, remaining: variant.stockQuantity }] : []));
    if ((printed?.value ?? 0) <= threshold) stockAlerts.unshift({ name: "Printed QR stock", remaining: printed?.value ?? 0 });
    return {
      profiles: profileTotal[0]?.value ?? 0,
      cards: cardTotal[0]?.value ?? 0,
      batches: batchTotal[0]?.value ?? 0,
      stations: stationTotal[0]?.value ?? 0,
      pendingJobs: pendingJobs[0]?.value ?? 0,
      qrArtifacts: qrTotal[0]?.value ?? 0,
      nfcAttempts: nfcAttemptTotal[0]?.value ?? 0,
      inventory: Object.fromEntries(statusRows.map((row) => [row.status, row.value])),
      stockAlerts,
      attention,
    };
  });

  app.get("/tasks", async request => {
    const { stage, page } = parseBody(z.object({ stage: z.enum(taskStages).optional(), page: z.coerce.number().int().min(1).max(100000).default(1) }), request.query);
    return attentionTasks(stage, page);
  });

  app.post("/cards/lookup", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { value } = parseBody(z.object({ value: z.string().trim().min(1).max(2048) }), request.body);
    const slug = /^[A-Za-z0-9_-]{1,64}$/.test(value);
    const [item] = await db.select({ id: cards.id, publicSlug: cards.publicSlug, canonicalUrl: cards.canonicalUrl,
      inventoryStatus: cards.inventoryStatus, batchId: cards.batchId, batchCode: cardBatches.batchCode,
      orderId: orderCardAllocations.orderId, printConfirmedAt: cardBatches.printConfirmedAt })
      .from(cards).innerJoin(cardBatches, eq(cardBatches.id, cards.batchId))
      .leftJoin(orderCardAllocations, eq(orderCardAllocations.cardId, cards.id))
      .where(slug ? eq(cards.publicSlug, value) : eq(cards.canonicalUrl, nfcUrlFromQr(value))).limit(1);
    if (!item || (!slug && value !== item.canonicalUrl && value !== qrUrl(item.canonicalUrl))) {
      return reply.code(404).send({ message: "No card matches this QR link or card code." });
    }
    return item;
  });

  app.get("/activation-follow-up", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { page } = adminPage(request.query);
    const rows = await db.select({ cardId: cards.id, publicSlug: cards.publicSlug, orderId: storeOrders.id,
      customer: sql<string>`${storeOrders.customer}->>'name'`, deliveredAt: storeOrders.deliveredAt })
      .from(orderCardAllocations).innerJoin(cards, eq(cards.id, orderCardAllocations.cardId))
      .innerJoin(storeOrders, eq(storeOrders.id, orderCardAllocations.orderId))
      .where(and(isNotNull(storeOrders.deliveredAt), sql`${cards.profileId} is null and ${cards.customerAccountId} is null
        and ${cards.companyId} is null and ${cards.lifecycleStatus} not in ('SUSPENDED','RETIRED')`))
      .orderBy(desc(storeOrders.deliveredAt), desc(cards.id)).limit(51).offset((page - 1) * 50);
    return { items: rows.slice(0, 50), hasMore: rows.length > 50 };
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

  app.get("/batches", async request => {
    const { page, query } = adminPage(request.query);
    const rows = await db.select().from(cardBatches).where(and(isNotNull(cardBatches.printConfirmedAt), sql`position(lower(${query}) in lower(${cardBatches.batchCode} || ' ' || ${cardBatches.productVariantId})) > 0`)).orderBy(desc(cardBatches.createdAt), desc(cardBatches.id)).limit(101).offset((page - 1) * 100);
    const items = rows.slice(0, 100);
    const batchCards = items.length ? await db.select({ batchId: cards.batchId, qrStatus: cards.qrStatus, nfcStatus: cards.nfcStatus, qcStatus: cards.qcStatus })
      .from(cards).where(inArray(cards.batchId, items.map((batch) => batch.id))) : [];
    return { items: items.map((batch) => ({ ...batch, ...productionBatchSummary(batchCards.filter((card) => card.batchId === batch.id)) })), count: items.length, hasMore: rows.length > 100 };
  });

  app.get("/batches/:batchId/reprint", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { batchId } = parseBody(z.object({ batchId: z.uuid() }), request.params);
    const [batch] = await db.select({ code: cardBatches.batchCode, variant: cardBatches.productVariantId }).from(cardBatches)
      .where(and(eq(cardBatches.id, batchId), isNotNull(cardBatches.printConfirmedAt)));
    if (!batch) return reply.code(404).send({ message: "Only confirmed printed batches can be reprinted." });
    const rows = await db.select({ id: cards.id, slug: cards.publicSlug,
      imageData: sql<string | null>`(select image_data from ${qrArtifacts} where card_id = ${cards.id}
        and image_data is not null order by generated_at desc, id desc limit 1)`,
      line: orderCardAllocations.lineIndex, items: storeOrders.items })
      .from(cards).leftJoin(orderCardAllocations, eq(orderCardAllocations.cardId, cards.id))
      .leftJoin(storeOrders, eq(storeOrders.id, orderCardAllocations.orderId))
      .where(eq(cards.batchId, batchId)).orderBy(cards.createdAt, cards.id);
    const productIds = [...new Set(rows.flatMap(row => row.items?.[row.line ?? -1]?.productId ?? []))];
    const catalog = await db.select({ id: products.id, slug: products.slug, variants: products.variants }).from(products).where(sql`
      exists (select 1 from jsonb_array_elements(${products.variants}) v where v->>'id' = ${batch.variant})
      ${productIds.length ? sql`or ${inArray(products.id, productIds)}` : sql``}`);
    // Stock batches without a catalog variant were printed as QR labels.
    const batchProduct = catalog.find(product => product.variants.some(variant => variant.id === batch.variant));
    return { code: batch.code, items: rows.map(({ id, slug, imageData, line, items }) => {
      const orderLine = batch.code.startsWith("ORDER-") ? items?.[line ?? -1] : undefined;
      const product = orderLine ? catalog.find(item => item.id === orderLine.productId) : batchProduct;
      const variant = product?.variants.find(item => item.id === (orderLine?.variantId ?? batch.variant));
      const finish = printFinish(product?.slug ?? "", variant?.appearance);
      return { id, slug, imageData, finish, labelOnly: !batchProduct && !batch.code.startsWith("ORDER-") };
    }) };
  });

  app.get("/stations", async () => {
    const stations = await db.select({ id: productionStations.id, stationCode: productionStations.stationCode, name: productionStations.name,
      status: productionStations.status, lastSeenAt: productionStations.lastSeenAt, createdAt: productionStations.createdAt })
      .from(productionStations).orderBy(desc(productionStations.createdAt)).limit(200);
    const jobs = stations.length ? await db.select({ stationId: productionJobs.assignedStationId, type: productionJobs.type,
      status: productionJobs.status, batchId: productionJobs.batchId, cardId: cards.id, publicSlug: cards.publicSlug })
      .from(productionJobs).innerJoin(cards, eq(cards.id, productionJobs.cardId))
      .where(and(inArray(productionJobs.assignedStationId, stations.map(station => station.id)),
        inArray(productionJobs.status, ["CLAIMED", "RETRYABLE_FAILURE"]))).orderBy(desc(productionJobs.updatedAt)) : [];
    const items = stations.map(station => ({ ...station, online: station.status === "ACTIVE" &&
      Boolean(station.lastSeenAt && Date.now() - station.lastSeenAt.getTime() <= 30_000),
      currentJob: jobs.find(job => job.stationId === station.id) ?? null }));
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

  app.post("/stations/:stationId/recover-jobs", async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN"]);
    const { stationId } = parseBody(z.object({ stationId: z.uuid() }), request.params);
    return db.transaction(async tx => {
      const [station] = await tx.update(productionStations).set({ status: "REVOKED", updatedAt: new Date() }).where(eq(productionStations.id, stationId)).returning();
      if (!station) throw Object.assign(new Error("Station not found"), { statusCode: 404 });
      const recovered = await tx.update(productionJobs).set({ status: "QUEUED", assignedStationId: null, claimedBy: null, claimIdempotencyKey: null, claimedAt: null, leaseExpiresAt: null, updatedAt: new Date() })
        .where(and(eq(productionJobs.assignedStationId, stationId), inArray(productionJobs.status, ["QUEUED", "CLAIMED", "RETRYABLE_FAILURE"]))).returning({ id: productionJobs.id });
      await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: "STATION_JOBS_RECOVERED", targetType: "production_station", targetId: stationId, metadata: { jobIds: recovered.map(job => job.id) } });
      return { recovered: recovered.length };
    });
  });

  app.get("/audit-logs", async request => {
    const { page, query } = adminPage(request.query);
    const items = await db.select().from(auditLogs).where(sql`position(lower(${query}) in lower(${auditLogs.action} || ' ' || ${auditLogs.targetType} || ' ' || ${auditLogs.targetId})) > 0`).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(101).offset((page - 1) * 100);
    return { items: items.slice(0, 100), hasMore: items.length > 100 };
  });
};
