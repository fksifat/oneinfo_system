import { randomInt } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";
import { cardBatches, cards, orderCardAllocations, storeOrders } from "../db/schema.js";
import { isManagedCardUrl } from "./card-urls.js";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const dhakaDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" });
export const invoicePattern = /^[0-9]{8}-[A-Z0-9]{6}$/;

export function deliveredInvoice(order: typeof storeOrders.$inferSelect) {
  return Boolean(order.invoiceNumber && order.deliveredAt && !order.awaitingPayment && !order.cancelledAt &&
    (!order.paymentAmountMinor || order.paymentVerifiedAt));
}

export async function invoiceActivationTarget(filter: SQL | undefined) {
  const [entry] = await db.select({ order: storeOrders, card: cards }).from(storeOrders)
    .innerJoin(orderCardAllocations, eq(orderCardAllocations.orderId, storeOrders.id))
    .innerJoin(cards, eq(cards.id, orderCardAllocations.cardId)).innerJoin(cardBatches, eq(cardBatches.id, cards.batchId))
    .where(and(filter, isNull(cards.customerAccountId), isNull(cards.profileId), isNull(cards.companyId),
      eq(cards.lifecycleStatus, "QC_PASSED"), eq(cards.qrStatus, "GENERATED"), eq(cards.qcStatus, "PASSED"), eq(cards.nfcStatus, "WRITTEN"),
      inArray(cards.inventoryStatus, ["RESERVED", "DISPATCHED"]),
      isNotNull(cardBatches.printConfirmedAt))).limit(1);
  if (entry && deliveredInvoice(entry.order) && isManagedCardUrl(entry.card.canonicalUrl, entry.card.publicSlug)) return entry;
}

// Checkout holds the printed-stock transaction lock until the invoice is saved.
export async function nextInvoiceNumber(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], now = new Date()) {
  const parts = Object.fromEntries(dhakaDate.formatToParts(now).map(part => [part.type, part.value]));
  const date = `${parts.year}${parts.month}${parts.day}`;
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
    const invoice = `${date}-${code}`;
    const [existing] = await tx.select({ id: storeOrders.id }).from(storeOrders).where(eq(storeOrders.invoiceNumber, invoice));
    if (!existing) return invoice;
  }
  throw new Error("Could not issue an invoice number. Retry the order.");
}
