import { readFile } from "node:fs/promises";
import nodemailer from "nodemailer";
import { config } from "../config.js";

const smtp = config.BREVO_SMTP_USER && config.BREVO_SMTP_KEY ? nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  requireTLS: true,
  auth: { user: config.BREVO_SMTP_USER, pass: config.BREVO_SMTP_KEY },
  connectionTimeout: 4500,
  greetingTimeout: 4500,
  socketTimeout: 4500,
}) : undefined;

export const usesBrevoSmtp = Boolean(smtp);
export const transactionalEmailEnabled = Boolean((smtp || config.RESEND_API_KEY) && config.ORDER_EMAIL_FROM);
const logoCid = "oneinfo-logo@oneinfo.online";
export const escapeEmailHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export async function sendTransactionalEmail({ to, subject, text, html, idempotencyKey }: {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}): Promise<boolean> {
  if (!transactionalEmailEnabled || !config.ORDER_EMAIL_FROM) return false;
  try {
    if (smtp) {
      const logo = await readFile(new URL("../../assets/oneinfo-email-logo.png", import.meta.url));
      const sent = await smtp.sendMail({
        from: config.ORDER_EMAIL_FROM, to: [{ address: to, name: "" }], subject, text, html,
        attachments: [{ filename: "oneinfo-logo.png", content: logo, cid: logoCid, contentType: "image/png" }],
      });
      return sent.accepted.length > 0;
    }
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ from: config.ORDER_EMAIL_FROM, to: [to], subject, text }),
      signal: AbortSignal.timeout(4500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function renderOneinfoEmail(order: { id: string; customer: { name: string } }, status: string, title: string, intro: string, body: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeEmailHtml(title)}</title></head>
<body style="margin:0;background:#f9f8f5;color:#121316;font:15px/1.5 Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f9f8f5">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;background:#ffffff;border:1px solid #e2ddd3;border-radius:18px">
<tr><td style="padding:26px 24px;background:#f9f8f5;border-bottom:1px solid #e2ddd3">
  <img src="cid:${logoCid}" alt="Oneinfo" width="128" height="39" style="display:block;border:0">
  <p style="margin:22px 0 6px;color:#c8a165;font-size:12px;font-weight:bold;letter-spacing:1px">${escapeEmailHtml(status)}</p>
  <h1 style="margin:0;font-size:30px;line-height:1.15">${escapeEmailHtml(title)}</h1>
  <p style="margin:12px 0 0">Hi ${escapeEmailHtml(order.customer.name)}, ${escapeEmailHtml(intro)}</p>
</td></tr>
<tr><td style="padding:24px">
  <p style="margin:0 0 20px;color:#6b675e;font-size:13px;overflow-wrap:anywhere">Order ID<br><strong style="color:#121316">${escapeEmailHtml(order.id)}</strong></p>
  ${body}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e2ddd3;color:#6b675e;font-size:13px">
  Oneinfo · <a href="https://www.oneinfo.online" style="color:#c8a165">oneinfo.online</a>
</td></tr>
</table></td></tr></table></body></html>`;
}
