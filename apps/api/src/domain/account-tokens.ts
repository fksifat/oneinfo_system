import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { accountTokens } from "../db/schema.js";
import { config } from "../config.js";
import { sendTransactionalEmail, escapeEmailHtml } from "./transactional-email.js";

export const accountTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export async function createAccountLink(email: string, purpose: "verify" | "reset" | "invite", details: Record<string, string> = {}) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(accountTokens).values({ tokenHash: accountTokenHash(token), email, purpose, details,
    expiresAt: new Date(Date.now() + (purpose === "invite" ? 72 : 1) * 3600_000) });
  return { token, path: `/team#account/${token}` };
}

export async function sendAccountLink(email: string, purpose: "verify" | "reset" | "invite", link: Awaited<ReturnType<typeof createAccountLink>>) {
  if (!config.STOREFRONT_URL) return false;
  const url = new URL(link.path, config.STOREFRONT_URL).href;
  const expiry = purpose === "invite" ? "72 hours" : "one hour";
  const title = purpose === "invite" ? "Create your Oneinfo company account" : purpose === "reset" ? "Reset your Oneinfo password" : "Verify your Oneinfo email";
  const accepted = await sendTransactionalEmail({ to: email, subject: title,
    text: `${title}\n${url}\nThis link expires in ${expiry}. Ignore this message if you did not request it.`,
    html: `<p>${title}</p><p><a href="${escapeEmailHtml(url)}">Continue securely</a></p><p>This link expires in ${expiry}.</p>`,
    idempotencyKey: `oneinfo-account/${accountTokenHash(link.token)}` });
  if (!accepted) await db.delete(accountTokens).where(eq(accountTokens.tokenHash, accountTokenHash(link.token)));
  return accepted;
}
