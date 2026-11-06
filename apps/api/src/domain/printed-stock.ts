import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { managedCardBases } from "./card-urls.js";
import { auditLogs, cardActivationSecrets, cardBatches, cardEvents, cards, orderCardAllocations, storeOrders } from "../db/schema.js";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function allocationSummary(required: number, assigned: number) {
  return { required, assigned, pending: Math.max(0, required - assigned),
    status: assigned >= required ? "ASSIGNED" as const : assigned ? "PARTIAL" as const : "AWAITING_QR" as const };
}

export async function lockPrintedStock(tx: Transaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('oneinfo-printed-qr-stock', 0))`);
}

export function printedStockAvailable() {
  return and(isNotNull(cardBatches.printConfirmedAt), eq(cards.qrStatus, "GENERATED"), isNull(cards.profileId), isNull(cards.companyId),
    sql`${cards.canonicalUrl} in (${sql.join(managedCardBases().map(base => sql`${base} || '/' || ${cards.publicSlug}`), sql`, `)})`,
    inArray(cards.inventoryStatus, ["NOT_READY", "SALEABLE"]), inArray(cards.lifecycleStatus, ["IN_PRODUCTION", "QC_PASSED"]),
    inArray(cards.qcStatus, ["PENDING", "PASSED"]),
    sql`not exists (select 1 from ${cardActivationSecrets} s where s.card_id = ${cards.id})`,
    sql`not exists (select 1 from ${orderCardAllocations} a where a.card_id = ${cards.id})`);
}

export async function allocatePendingOrders(tx: Transaction) {
  await lockPrintedStock(tx);
  const waiting = await tx.select().from(storeOrders).where(sql`
    ${storeOrders.cancelledAt} is null and not ${storeOrders.awaitingPayment} and
    (select count(*) from ${orderCardAllocations} a where a.order_id = ${storeOrders.id}) <
    (select coalesce(sum((item->>'quantity')::integer), 0) from jsonb_array_elements(${storeOrders.items}) item)
  `).orderBy(asc(storeOrders.createdAt), asc(storeOrders.id)).for("update");
  let allocated = 0;
  for (const order of waiting) {
    const existing = await tx.select().from(orderCardAllocations).where(eq(orderCardAllocations.orderId, order.id));
    const slots: { lineIndex: number; unitIndex: number }[] = [];
    order.items.forEach((line, lineIndex) => {
      for (let unitIndex = 0; unitIndex < line.quantity; unitIndex++) {
        if (!existing.some((item) => item.lineIndex === lineIndex && item.unitIndex === unitIndex)) slots.push({ lineIndex, unitIndex });
      }
    });
    if (!slots.length) continue;
    // shortcut: batches contain generic QR stock; add catalog variant matching when physical finishes are tracked per batch.
    const available = await tx.select({ card: cards }).from(cards)
      .innerJoin(cardBatches, eq(cardBatches.id, cards.batchId))
      .where(printedStockAvailable())
      .orderBy(asc(cardBatches.printConfirmedAt), asc(cards.createdAt), asc(cards.id)).limit(slots.length).for("update");
    if (!available.length) break;
    for (let index = 0; index < available.length; index++) {
      const card = available[index]!.card;
      await tx.insert(orderCardAllocations).values({ orderId: order.id, cardId: card.id, ...slots[index]! });
      await tx.update(cards).set({ inventoryStatus: "RESERVED", updatedAt: new Date() }).where(eq(cards.id, card.id));
      await tx.insert(cardEvents).values({ cardId: card.id, eventType: "ORDER_QR_ASSIGNED", previousState: card.inventoryStatus,
        newState: "RESERVED", metadata: { orderId: order.id, ...slots[index]! } });
      await tx.insert(auditLogs).values({ action: "ORDER_QR_ASSIGNED", targetType: "store_order", targetId: order.id,
        metadata: { cardId: card.id } });
      allocated++;
    }
  }
  return allocated;
}
