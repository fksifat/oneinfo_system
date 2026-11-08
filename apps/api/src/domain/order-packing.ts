import { and, eq, inArray, or } from "drizzle-orm";
import type { db } from "../db/client.js";
import { cardActivationSecrets, cardBatches, cards, orderCardAllocations, storeOrders } from "../db/schema.js";
import { isManagedCardUrl, nfcUrlFromQr, qrUrl } from "./card-urls.js";
import { reserveCardForOrder } from "./printed-stock.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Order = typeof storeOrders.$inferSelect;
const conflict = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 409 }); };
const quantity = (order: Order) => order.items.reduce((total, item) => total + item.quantity, 0);

export function packedCards(tx: Tx, id: string) {
  return tx.select({ card: cards, printed: cardBatches.printConfirmedAt }).from(orderCardAllocations)
    .innerJoin(cards, eq(cards.id, orderCardAllocations.cardId)).innerJoin(cardBatches, eq(cardBatches.id, cards.batchId))
    .where(eq(orderCardAllocations.orderId, id)).orderBy(cards.id).for("update", { of: cards });
}

function invoiceReady({ card, printed }: Awaited<ReturnType<typeof packedCards>>[number]) {
  return printed && card.qrStatus === "GENERATED" && card.nfcStatus === "WRITTEN" && card.qcStatus === "PASSED" &&
    card.lifecycleStatus === "QC_PASSED" && !card.profileId && !card.customerAccountId && !card.companyId &&
    isManagedCardUrl(card.canonicalUrl, card.publicSlug);
}

export async function assertInvoicePacked(tx: Tx, order: Order) {
  if (order.activationMethod === "ORDER_SECRET") {
    if (!order.packedAt) conflict("Confirm the package and include a secret code for each card first.");
    return;
  }
  if (!order.invoiceNumber || order.deliveredAt) return;
  const packed = await packedCards(tx, order.id);
  if (packed.length !== quantity(order) || packed.some(item => !invoiceReady(item) || item.card.inventoryStatus !== "RESERVED")) {
    conflict("Scan and confirm all ready stock cards in the packing checklist first.");
  }
}

export async function packInvoiceOrder(tx: Tx, order: Order, scans: string[], replace?: string[]) {
  if (scans.length !== quantity(order)) conflict("Scan exactly one card per ordered unit, in order-item sequence.");
  const packed = await packedCards(tx, order.id);
  const currentIds = packed.map(item => item.card.id).sort();
  const scanned = await tx.select({ card: cards, printed: cardBatches.printConfirmedAt, variant: cardBatches.productVariantId,
    orderId: orderCardAllocations.orderId, secret: cardActivationSecrets.cardId }).from(cards)
    .innerJoin(cardBatches, eq(cardBatches.id, cards.batchId))
    .leftJoin(orderCardAllocations, eq(orderCardAllocations.cardId, cards.id))
    .leftJoin(cardActivationSecrets, eq(cardActivationSecrets.cardId, cards.id))
    .where(or(inArray(cards.publicSlug, scans), inArray(cards.canonicalUrl, scans.map(nfcUrlFromQr))))
    .orderBy(cards.id).for("update", { of: cards });
  const byScan = new Map(scanned.flatMap(item => [item.card.publicSlug, qrUrl(item.card.canonicalUrl)].map(code => [code, item] as const)));
  const picked = scans.map(code => byScan.get(code));
  const ids = new Set(picked.map(item => item?.card.id));
  if (ids.size !== scans.length || picked.some(item => !item || !invoiceReady(item) || item.secret ||
    (item.orderId === order.id ? item.card.inventoryStatus !== "RESERVED" : item.orderId || item.card.inventoryStatus !== "SALEABLE"))) {
    conflict("Each scan must be a different, inactive, print-confirmed and QC-passed Oneinfo card available for this order.");
  }
  if (currentIds.length && currentIds.every(id => ids.has(id))) return { checked: scans.length, cardIds: currentIds };
  if (currentIds.length && (replace?.length !== currentIds.length || [...replace].sort().some((id, i) => id !== currentIds[i]))) {
    conflict("These cards were already packed. Refresh before replacing the packed cards.");
  }
  const slots = order.items.flatMap((line, lineIndex) => Array.from({ length: line.quantity }, (_, unitIndex) => ({ lineIndex, unitIndex, variantId: line.variantId })));
  // shortcut: generic batches rely on a manual finish check until physical SKU metadata is available.
  if (picked.some((item, index) => item!.variant !== "ONEINFO-NFC-CARD" && item!.variant !== slots[index]!.variantId)) {
    conflict("A scanned card belongs to a different variant. Scan the cards in the order-item sequence.");
  }
  if (packed.length) {
    if (packed.some(({ card }) => card.customerAccountId || card.profileId || card.companyId || card.inventoryStatus === "DISPATCHED")) {
      conflict("A previously packed card was issued. Contact an administrator before repacking.");
    }
    await tx.delete(orderCardAllocations).where(eq(orderCardAllocations.orderId, order.id));
    for (const item of packed.filter(({ card }) => !ids.has(card.id))) {
      await tx.update(cards).set({ inventoryStatus: invoiceReady(item) ? "SALEABLE" : "NOT_READY", updatedAt: new Date() })
        .where(and(eq(cards.id, item.card.id), eq(cards.inventoryStatus, "RESERVED")));
    }
  }
  for (const [i, { lineIndex, unitIndex }] of slots.entries()) {
    await reserveCardForOrder(tx, order.id, picked[i]!.card, { lineIndex, unitIndex });
  }
  return { checked: scans.length, cardIds: picked.map(item => item!.card.id) };
}
