import type { StoreOrder } from "@oneinfo/contracts";
import { config } from "../config.js";

export const confirmationEmailEnabled = Boolean(config.RESEND_API_KEY && config.ORDER_EMAIL_FROM);
const money = (minor: number) => `BDT ${(minor / 100).toFixed(2)}`;

export async function sendOrderConfirmation(order: StoreOrder): Promise<"accepted" | "failed" | undefined> {
  if (!confirmationEmailEnabled) return;
  // Resend holds idempotency keys for 24 hours. Old receipt replays must not send again.
  if (Date.now() - Date.parse(order.createdAt) >= 23 * 60 * 60 * 1000) return;
  const lines = order.items.map(item =>
    `${item.quantity} × ${item.name} — ${item.variantName}: ${money(item.quantity * item.unitPriceMinor)}`);
  const payment = order.paymentAmountMinor ?? 0;
  const text = [
    "Oneinfo received your order.",
    `Order ID: ${order.id}`,
    "",
    ...lines,
    "",
    `Items subtotal: ${money(order.subtotalMinor)}`,
    ...(order.couponCode ? [`Coupon ${order.couponCode}: −${money(order.discountMinor)}`] : []),
    `Shipping: ${money(order.shippingMinor)}`,
    ...(payment > 0 ? [
      `Order total: ${money(order.totalMinor)}`,
      `bKash payment pending verification: ${money(payment)}`,
      ...(order.totalMinor > payment ? [`Remaining on delivery after verification: ${money(order.totalMinor - payment)}`] : []),
    ] : [`Total due on delivery: ${money(order.totalMinor)}`]),
    "",
    `Payment method: ${order.paymentMethod === "BKASH" ? "bKash" : "Cash on delivery"}`,
  ].join("\n");
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `oneinfo-order/${order.id}`,
      },
      body: JSON.stringify({
        from: config.ORDER_EMAIL_FROM,
        to: [order.customer.email],
        subject: "Your Oneinfo order confirmation",
        text,
      }),
      signal: AbortSignal.timeout(4500),
    });
    return response.ok ? "accepted" : "failed";
  } catch {
    return "failed";
  }
}
