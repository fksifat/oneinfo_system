import { config } from "../config.js";
import { createHash } from "node:crypto";
import { escapeEmailHtml, renderOneinfoEmail, sendTransactionalEmail } from "./transactional-email.js";

export async function sendReviewInvitation(order: { id: string; customer: { name: string; email: string } }, token: string): Promise<boolean> {
  if (!config.STOREFRONT_URL || !/^https?:\/\//.test(config.STOREFRONT_URL)) return false;
  const link = `${config.STOREFRONT_URL.replace(/\/+$/, "")}/#review/${encodeURIComponent(token)}`;
  return sendTransactionalEmail({
    to: order.customer.email,
    subject: "Your Oneinfo order was delivered",
    text: `Your order ${order.id} has been delivered. You can review the products you purchased here:\n\n${link}\n\nThis private link is for your order only.`,
    html: renderOneinfoEmail(order, "ORDER DELIVERED", "Your order was delivered.", "your Oneinfo order has arrived.", `
      <p style="margin:0 0 16px">How was your experience with your Oneinfo card?</p>
      <a href="${escapeEmailHtml(link)}" style="display:inline-block;background:#112b2b;color:#ffffff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Review your card</a>
      <p style="margin:14px 0 0;color:#526460;font-size:13px">This private link is for your order only.</p>`),
    idempotencyKey: `oneinfo-review/${order.id}/${createHash("sha256").update(token).digest("hex")}`,
  });
}
