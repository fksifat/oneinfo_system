import { createHmac, timingSafeEqual } from "node:crypto";
import type { OrderTracking } from "@oneinfo/contracts";
import { config } from "../config.js";
import type { storeOrders } from "../db/schema.js";

function signature(orderId: string) {
  return createHmac("sha256", config.JWT_SECRET).update(`oneinfo-order-tracking:${orderId}`).digest("base64url");
}

export const trackingPath = (orderId: string) => `/#track/${orderId}.${signature(orderId)}`;
export const invoicePath = (orderId: string) => `/#invoice/${orderId}.${signature(orderId)}`;
export const trackingUrl = (orderId: string) => config.STOREFRONT_URL ? new URL(trackingPath(orderId), config.STOREFRONT_URL).href : undefined;

export function trackingOrderId(token: string) {
  const match = /^([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.([a-zA-Z0-9_-]{43})$/.exec(token);
  if (!match) return;
  const [, id, mac] = match;
  if (id && mac && timingSafeEqual(Buffer.from(mac), Buffer.from(signature(id)))) return id;
}

export function orderTracking(order: typeof storeOrders.$inferSelect): OrderTracking {
  return {
    invoiceNumber: order.invoiceNumber, activationMethod: order.activationMethod, packedAt: order.packedAt?.toISOString() ?? null,
    status: order.cancelledAt ? "CANCELLED" : order.awaitingPayment ? "AWAITING_PAYMENT" : order.deliveredAt ? "DELIVERED" : order.shippedAt ? "SHIPPED" : order.processingAt ? "PROCESSING" : "RECEIVED",
    createdAt: order.createdAt.toISOString(), paymentVerifiedAt: order.paymentVerifiedAt?.toISOString() ?? null, processingAt: order.processingAt?.toISOString() ?? null,
    shippedAt: order.shippedAt?.toISOString() ?? null, deliveredAt: order.deliveredAt?.toISOString() ?? null,
    courierTrackingId: order.courierTrackingId, cancelledAt: order.cancelledAt?.toISOString() ?? null, cancellationReason: order.cancellationReason,
  };
}
