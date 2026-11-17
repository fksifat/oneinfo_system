import { paymentMethodLabels, type StoreOrder } from "@oneinfo/contracts";
import { escapeEmailHtml as escapeHtml, renderOneinfoEmail, sendTransactionalEmail, transactionalEmailEnabled, usesBrevoSmtp } from "./transactional-email.js";
import { trackingUrl } from "./order-tracking.js";

export const confirmationEmailEnabled = transactionalEmailEnabled;
const money = (minor: number) => `BDT ${(minor / 100).toFixed(2)}`;
const trackingButton = (url?: string) => url ? `<p><a href="${escapeHtml(url)}">Track your order</a></p>` : "";

export async function sendOrderConfirmation(order: StoreOrder, created: boolean, retry = false): Promise<"accepted" | "failed" | undefined> {
  if (!confirmationEmailEnabled) return;
  // SMTP has no idempotency key. Only the request that inserted the order can send.
  if (usesBrevoSmtp && !created) return;
  // Resend holds idempotency keys for 24 hours. Old receipt replays must not send again.
  if (!retry && Date.now() - Date.parse(order.createdAt) >= 23 * 60 * 60 * 1000) return;
  const intro = "we’ve received your Oneinfo order.";
  const link = trackingUrl(order.id);
  const trackAction = link ? `<p style="margin:16px 0 0"><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 16px;background:#173a34;color:#fff;border-radius:7px;font-weight:bold;text-decoration:none">Track your order</a></p>` : "";
  const sent = await sendTransactionalEmail({
    to: order.customer.email,
    subject: "Your Oneinfo order confirmation",
    text: [`Hi ${order.customer.name}, ${intro}`, ...(link ? [`Track your order: ${link}`] : [])].join("\n\n"),
    html: renderOneinfoEmail({ customer: order.customer }, "ORDER RECEIVED", "Thanks for your order.", intro, "", trackAction),
    idempotencyKey: `oneinfo-order/${order.id}`,
  });
  return sent ? "accepted" : "failed";
}

export async function sendShippingEmail(order: Pick<StoreOrder, "id" | "customer" | "courierTrackingId">) {
  if (!order.courierTrackingId) return false;
  const intro = "your Oneinfo order is with the courier.";
  const tracking = `Courier tracking ID: ${order.courierTrackingId}`;
  const link = trackingUrl(order.id);
  return sendTransactionalEmail({ to: order.customer.email, subject: "Your Oneinfo order has shipped",
    text: [`Hi ${order.customer.name}, ${intro}`, `Order ID: ${order.id}`, tracking, ...(link ? [link] : [])].join("\n"),
    html: renderOneinfoEmail(order, "ORDER SHIPPED", "Your order has shipped.", intro, `<p>${escapeHtml(tracking)}</p>${trackingButton(link)}`),
    idempotencyKey: `oneinfo-order-shipped/${order.id}` });
}

export async function sendPaymentVerifiedEmail(order: Pick<StoreOrder, "id" | "customer" | "paymentMethod" | "paymentAmountMinor" | "totalMinor">) {
  const paid = order.paymentAmountMinor ?? 0;
  const remaining = Math.max(0, order.totalMinor - paid);
  const wallet = order.paymentMethod === "COD" ? "bKash" : paymentMethodLabels[order.paymentMethod];
  const intro = `we’ve verified your ${wallet} payment for your Oneinfo order.`;
  const details = [`Verified payment: ${money(paid)}`, `Order total: ${money(order.totalMinor)}`, remaining > 0
    ? `Remaining on delivery: ${money(remaining)}`
    : "Your order is paid in full."];
  return sendTransactionalEmail({
    to: order.customer.email,
    subject: `Your Oneinfo ${wallet} payment is verified`,
    text: [`Hi ${order.customer.name}, ${intro}`, `Order ID: ${order.id}`, ...details].join("\n"),
    html: renderOneinfoEmail(order, "PAYMENT VERIFIED", "Payment verified.", intro,
      `<div style="padding:14px;background:#f7f1e1;color:#121316;border-radius:10px">${details.map(escapeHtml).join("<br>")}</div>`),
    idempotencyKey: `oneinfo-payment-verified/${order.id}`,
  });
}
