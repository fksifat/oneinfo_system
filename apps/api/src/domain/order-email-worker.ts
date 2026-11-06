import { createHash, createHmac } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { StoreOrder } from "@oneinfo/contracts";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { orderEmails, storeOrders, storeReviewInvites } from "../db/schema.js";
import { confirmationEmailEnabled, sendOrderConfirmation, sendPaymentVerifiedEmail, sendShippingEmail } from "./order-confirmation.js";
import { attemptOrderEmail, type OrderEmailKind } from "./order-email-history.js";
import { orderTracking } from "./order-tracking.js";
import { sendReviewInvitation } from "./review-invitation.js";

export const reviewToken = (id: string) => createHmac("sha256", config.JWT_SECRET).update(`oneinfo-review:${id}`).digest("base64url");
export const reviewTokenHash = (id: string) => createHash("sha256").update(reviewToken(id)).digest("hex");

export async function dispatchOrderEmail(id: string, kind: OrderEmailKind, retry = false) {
  if (!confirmationEmailEnabled) return;
  return attemptOrderEmail(id, kind, async () => {
    const [order] = await db.select().from(storeOrders).where(eq(storeOrders.id, id));
    if (!order || order.cancelledAt || order.awaitingPayment) return false;
    const data = { ...order, ...orderTracking(order), totalMinor: order.subtotalMinor + order.shippingMinor - order.discountMinor } as unknown as StoreOrder;
    if (kind === "confirmation") return await sendOrderConfirmation(data, true, true) === "accepted";
    if (kind === "payment") return Boolean(order.paymentVerifiedAt) && await sendPaymentVerifiedEmail(data);
    if (kind === "shipping") return Boolean(order.shippedAt) && await sendShippingEmail(data);
    if (!order.deliveredAt) return false;
    const [invite] = await db.select().from(storeReviewInvites).where(eq(storeReviewInvites.orderId, id));
    if (invite?.sentAt) return true;
    if (invite?.tokenHash !== reviewTokenHash(id)) return false;
    const sent = await sendReviewInvitation(order, reviewToken(id));
    if (sent) await db.update(storeReviewInvites).set({ sentAt: new Date() }).where(eq(storeReviewInvites.orderId, id));
    return sent;
  }, retry ? "retry" : "initial");
}

export async function drainOrderEmails() {
  if (!confirmationEmailEnabled) return;
  // SMTP cannot prove whether a crashed send was accepted. An operator must retry it.
  await db.update(orderEmails).set({ status: "failed", claimId: null, updatedAt: new Date() })
    .where(and(eq(orderEmails.status, "sending"), lt(orderEmails.updatedAt, new Date(Date.now() - 10 * 60_000))));
  const pending = await db.select().from(orderEmails).where(eq(orderEmails.status, "pending")).orderBy(orderEmails.updatedAt).limit(20);
  for (const item of pending) await dispatchOrderEmail(item.orderId, item.kind);
}
