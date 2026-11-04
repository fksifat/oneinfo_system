import { config } from "../config.js";
import { createHash } from "node:crypto";

export async function sendReviewInvitation(order: { id: string; email: string }, token: string): Promise<boolean> {
  if (!config.RESEND_API_KEY || !config.ORDER_EMAIL_FROM || !config.STOREFRONT_URL) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `oneinfo-review/${order.id}/${createHash("sha256").update(token).digest("hex")}` },
      body: JSON.stringify({ from: config.ORDER_EMAIL_FROM, to: [order.email], subject: "Share your Oneinfo card experience", text: `Your order has been delivered. You can review the products you purchased here:\n\n${config.STOREFRONT_URL}/#review/${token}\n\nThis private link is for your order only.` }),
      signal: AbortSignal.timeout(4500),
    });
    return response.ok;
  } catch { return false; }
}
