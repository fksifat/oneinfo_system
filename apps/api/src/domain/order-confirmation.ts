import type { StoreOrder } from "@oneinfo/contracts";
import { escapeEmailHtml as escapeHtml, renderOneinfoEmail, sendTransactionalEmail, transactionalEmailEnabled, usesBrevoSmtp } from "./transactional-email.js";
import { invoicePath, trackingUrl } from "./order-tracking.js";

export const confirmationEmailEnabled = transactionalEmailEnabled;
const money = (minor: number) => `BDT ${(minor / 100).toFixed(2)}`;
const trackingButton = (url?: string) => url ? `<p><a href="${escapeHtml(url)}">Track your order</a></p>` : "";

export async function sendOrderConfirmation(order: StoreOrder, created: boolean, retry = false): Promise<"accepted" | "failed" | undefined> {
  if (!confirmationEmailEnabled) return;
  // SMTP has no idempotency key. Only the request that inserted the order can send.
  if (usesBrevoSmtp && !created) return;
  // Resend holds idempotency keys for 24 hours. Old receipt replays must not send again.
  if (!retry && Date.now() - Date.parse(order.createdAt) >= 23 * 60 * 60 * 1000) return;
  const lines = order.items.map(item =>
    `${item.quantity} × ${item.name} — ${item.variantName}: ${money(item.quantity * item.unitPriceMinor)}`);
  const payment = order.paymentAmountMinor ?? 0;
  const totals: ReadonlyArray<readonly [string, string]> = [
    ["Items subtotal", money(order.subtotalMinor)],
    ...(order.couponCode ? [[`Coupon ${order.couponCode}`, `−${money(order.discountMinor)}`] as const] : []),
    ["Shipping", money(order.shippingMinor)],
    [payment > 0 ? "Order total" : "Total due on delivery", money(order.totalMinor)],
  ];
  const verified = order.paymentStatus === "VERIFIED" || Boolean(order.paymentVerifiedAt);
  const paymentNotes = payment > 0 ? [
    `${verified ? "Verified bKash payment" : "bKash payment pending verification"}: ${money(payment)}`,
    ...(order.totalMinor > payment ? [`${verified ? "Remaining on delivery" : "Remaining on delivery after verification"}: ${money(order.totalMinor - payment)}`] : []),
  ] : [];
  const paymentMethod = order.paymentMethod === "BKASH" ? "bKash" : "Cash on delivery";
  const link = trackingUrl(order.id);
  const invoice = link && order.invoiceNumber ? new URL(invoicePath(order.id), link).href : undefined;
  const text = [
    "Oneinfo received your order.",
    `Order ID: ${order.id}`,
    ...(order.invoiceNumber ? [`Invoice: ${order.invoiceNumber}`, order.activationMethod === "ORDER_SECRET" ? "Your package includes a private secret code for each card. Scan any supplied card and enter its code to set up your profile." : "Keep this invoice number. After delivery, scan the card and use it to request an activation email."] : []),
    "",
    ...lines,
    "",
    ...totals.map(([label, amount]) => `${label}: ${amount}`),
    ...paymentNotes,
    "",
    `Payment method: ${paymentMethod}`,
    ...(invoice ? [`View invoice: ${invoice}`] : []),
    ...(link ? [`Track your order: ${link}`] : []),
  ].join("\n");
  const sent = await sendTransactionalEmail({
    to: order.customer.email,
    subject: "Your Oneinfo order confirmation",
    text,
    html: renderOrderEmail(order, totals, paymentMethod, paymentNotes, link, invoice),
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
      `<div style="padding:14px;background:#f7f1e1;color:#121316;border-radius:10px">${details.map(escapeHtml).join("<br>")}</div>`),
    idempotencyKey: `oneinfo-payment-verified/${order.id}`,
  });
}

function renderOrderEmail(order: StoreOrder, totals: ReadonlyArray<readonly [string, string]>, paymentMethod: string, paymentNotes: string[], tracking?: string, invoice?: string) {
  const items = order.items.map(item => `<tr>
    <td valign="top" style="padding:14px 0;border-top:1px solid #e4e8e4;overflow-wrap:anywhere"><strong>${escapeHtml(item.name)}</strong><br>
      <span style="color:#526460;font-size:13px">${escapeHtml(item.variantName)} · Qty ${item.quantity}</span></td>
    <td align="right" valign="top" style="padding:14px 0 14px 8px;border-top:1px solid #e4e8e4;white-space:nowrap;font-size:14px;font-weight:bold">${money(item.quantity * item.unitPriceMinor)}</td>
  </tr>`).join("");
  const amounts = totals.slice(0, -1).map(([label, value]) => `<tr>
    <td style="padding:5px 0;color:#526460">${escapeHtml(label)}</td>
    <td align="right" style="padding:5px 0 5px 8px;white-space:nowrap">${escapeHtml(value)}</td>
  </tr>`).join("");
  const total = totals.at(-1);
  const address = [order.deliveryAddress.addressLine, order.deliveryAddress.district, order.deliveryAddress.postalCode].filter(Boolean).join(", ");
  const trackAction = tracking ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:20px 0 0">
    <tr><td bgcolor="#173a34" style="border-radius:7px"><a href="${escapeHtml(tracking)}" style="display:inline-block;padding:11px 19px;border:1px solid #173a34;border-radius:7px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none">Track your order</a></td></tr>
  </table>` : "";
  return renderOneinfoEmail(order, "ORDER RECEIVED", "Thanks for your order.", "we’ve received your Oneinfo order.", `
  ${order.invoiceNumber ? `<p style="margin:0 0 22px;color:#526460;font-size:13px">Invoice number<br>
    <strong style="color:#121316;font-size:15px">${escapeHtml(order.invoiceNumber)}</strong>${invoice ? ` &nbsp; <a href="${escapeHtml(invoice)}" style="display:inline-block;padding:4px 0;color:#173a34;font-weight:bold;text-decoration:underline">View invoice</a>` : ""}</p>` : ""}
  <h2 style="margin:0 0 10px;color:#173a34;font-size:19px">Order summary</h2>
  <table aria-label="Order items" width="100%" cellspacing="0" cellpadding="0">${items}</table>
  <table aria-label="Order totals" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e4e8e4;margin:0 0 18px;font-size:14px">
    ${amounts}
    ${total ? `<tr><th scope="row" align="left" bgcolor="#eef4ef" style="padding:11px 9px;color:#173a34">${escapeHtml(total[0])}</th>
      <td align="right" bgcolor="#eef4ef" style="padding:11px 9px;color:#173a34;font-size:16px;font-weight:bold;white-space:nowrap">${escapeHtml(total[1])}</td></tr>` : ""}
  </table>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr><td bgcolor="#f7f2e6" style="padding:14px 15px;border-left:3px solid #c8a165;font-size:14px">
      <strong>${escapeHtml(paymentMethod)}</strong>
      <p style="margin:4px 0 0;color:#433e33">${paymentNotes.length ? paymentNotes.map(escapeHtml).join("<br>") : "Pay the total when your order arrives."}</p>
    </td></tr>
  </table>
  <h2 style="margin:22px 0 5px;color:#173a34;font-size:17px">Delivery address</h2>
  <p style="margin:0;color:#3d4e47;overflow-wrap:anywhere">${escapeHtml(address)}</p>
  ${order.invoiceNumber ? `<h2 style="margin:22px 0 5px;color:#173a34;font-size:17px">Set up your card after delivery</h2>
  <p style="margin:0;color:#3d4e47">${order.activationMethod === "ORDER_SECRET" ? "Tap or scan your card and enter the private code included in your package." : "Scan your card and enter the invoice number to request an activation email."}</p>` : ""}`, trackAction);
}
