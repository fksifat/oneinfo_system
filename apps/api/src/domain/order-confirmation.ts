import type { StoreOrder } from "@oneinfo/contracts";
import { escapeEmailHtml as escapeHtml, renderOneinfoEmail, sendTransactionalEmail, transactionalEmailEnabled, usesBrevoSmtp } from "./transactional-email.js";

export const confirmationEmailEnabled = transactionalEmailEnabled;
const money = (minor: number) => `BDT ${(minor / 100).toFixed(2)}`;

export async function sendOrderConfirmation(order: StoreOrder, created: boolean): Promise<"accepted" | "failed" | undefined> {
  if (!confirmationEmailEnabled) return;
  // SMTP has no idempotency key. Only the request that inserted the order can send.
  if (usesBrevoSmtp && !created) return;
  // Resend holds idempotency keys for 24 hours. Old receipt replays must not send again.
  if (Date.now() - Date.parse(order.createdAt) >= 23 * 60 * 60 * 1000) return;
  const lines = order.items.map(item =>
    `${item.quantity} × ${item.name} — ${item.variantName}: ${money(item.quantity * item.unitPriceMinor)}`);
  const payment = order.paymentAmountMinor ?? 0;
  const totals: ReadonlyArray<readonly [string, string]> = [
    ["Items subtotal", money(order.subtotalMinor)],
    ...(order.couponCode ? [[`Coupon ${order.couponCode}`, `−${money(order.discountMinor)}`] as const] : []),
    ["Shipping", money(order.shippingMinor)],
    [payment > 0 ? "Order total" : "Total due on delivery", money(order.totalMinor)],
  ];
  const paymentNotes = payment > 0 ? [
    `bKash payment pending verification: ${money(payment)}`,
    ...(order.totalMinor > payment ? [`Remaining on delivery after verification: ${money(order.totalMinor - payment)}`] : []),
  ] : [];
  const paymentMethod = order.paymentMethod === "BKASH" ? "bKash" : "Cash on delivery";
  const text = [
    "Oneinfo received your order.",
    `Order ID: ${order.id}`,
    "",
    ...lines,
    "",
    ...totals.map(([label, amount]) => `${label}: ${amount}`),
    ...paymentNotes,
    "",
    `Payment method: ${paymentMethod}`,
  ].join("\n");
  const sent = await sendTransactionalEmail({
    to: order.customer.email,
    subject: "Your Oneinfo order confirmation",
    text,
    html: renderOrderEmail(order, totals, paymentMethod, paymentNotes),
    idempotencyKey: `oneinfo-order/${order.id}`,
  });
  return sent ? "accepted" : "failed";
}

export async function sendPaymentVerifiedEmail(order: Pick<StoreOrder, "id" | "customer" | "paymentAmountMinor" | "totalMinor">) {
  const paid = order.paymentAmountMinor ?? 0;
  const remaining = Math.max(0, order.totalMinor - paid);
  const intro = "we’ve verified your bKash payment for your Oneinfo order.";
  const details = [`Verified payment: ${money(paid)}`, `Order total: ${money(order.totalMinor)}`, remaining > 0
    ? `Remaining on delivery: ${money(remaining)}`
    : "Your order is paid in full."];
  return sendTransactionalEmail({
    to: order.customer.email,
    subject: "Your Oneinfo bKash payment is verified",
    text: [`Hi ${order.customer.name}, ${intro}`, `Order ID: ${order.id}`, ...details].join("\n"),
    html: renderOneinfoEmail(order, "PAYMENT VERIFIED", "Payment verified.", intro,
      `<div style="padding:14px;background:#d7f4dd;border-radius:10px">${details.map(escapeHtml).join("<br>")}</div>`),
    idempotencyKey: `oneinfo-payment-verified/${order.id}`,
  });
}

function renderOrderEmail(order: StoreOrder, totals: ReadonlyArray<readonly [string, string]>, paymentMethod: string, paymentNotes: string[]) {
  const items = order.items.map(item => `<tr>
    <td style="padding:12px 0;border-bottom:1px solid #e2e8df"><strong>${escapeHtml(item.name)}</strong><br>
      <span style="color:#526460">${escapeHtml(item.variantName)} · Qty ${item.quantity}</span></td>
    <td align="right" style="padding:12px 0 12px 8px;border-bottom:1px solid #e2e8df;white-space:nowrap">${money(item.quantity * item.unitPriceMinor)}</td>
  </tr>`).join("");
  const amounts = totals.map(([label, value], index) => `<tr style="${index === totals.length - 1 ? "font-weight:bold;font-size:17px" : ""}">
    <td style="padding:5px 0">${escapeHtml(label)}</td>
    <td align="right" style="padding:5px 0 5px 8px;white-space:nowrap">${value}</td>
  </tr>`).join("");
  const address = [order.deliveryAddress.addressLine, order.deliveryAddress.district, order.deliveryAddress.postalCode].filter(Boolean).join(", ");
  return renderOneinfoEmail(order, "ORDER RECEIVED", "Thanks for your order.", "we’ve received your Oneinfo order.", `
  <h2 style="margin:0;font-size:19px">Order summary</h2>
  <table aria-label="Order items" width="100%" cellspacing="0" cellpadding="0">${items}</table>
  <table aria-label="Order totals" width="100%" cellspacing="0" cellpadding="0" style="margin:12px 0 18px">${amounts}</table>
  <div style="padding:14px;background:#d7f4dd;border-radius:10px">
    <strong>${paymentMethod}</strong><br>
    ${paymentNotes.length ? paymentNotes.join("<br>") : "Pay the total when your order arrives."}
  </div>
  <h2 style="margin:20px 0 4px;font-size:17px">Delivery address</h2>
  <p style="margin:0;overflow-wrap:anywhere">${escapeHtml(address)}</p>`);
}
