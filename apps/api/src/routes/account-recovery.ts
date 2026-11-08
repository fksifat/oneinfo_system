import { ensureProfileHandle } from "../domain/profile-handles.js";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { CustomerSignupSchema } from "@oneinfo/contracts";
import { db } from "../db/client.js";
import { accountTokens, auditLogs, companies, customerAccounts, customerProfiles } from "../db/schema.js";
import { accountTokenHash, createAccountLink, sendAccountLink } from "../domain/account-tokens.js";
import { allowAuthAttempt } from "../domain/auth-attempts.js";
import { hashPassword, requireCustomer, verifyPassword } from "../domain/customer-auth.js";
import { parseBody } from "../http.js";

const email = z.email().max(254).transform(value => value.toLowerCase());
const password = CustomerSignupSchema.shape.password;
const tokenInput = z.object({ token: z.string().regex(/^[\w-]{43}$/) });
const fail = (message: string, statusCode = 400): never => { throw Object.assign(new Error(message), { statusCode }); };

async function lockAccount(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], email: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'oneinfo-account:' + email}, 0))`);
}

export const accountRecoveryRoutes: FastifyPluginAsync = async app => {
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!await allowAuthAttempt(`account:${request.ip}`, 20, 5 * 60_000)) fail("Too many attempts. Please wait five minutes.", 429);
  });

  app.post("/request-reset", async request => {
    const input = parseBody(z.object({ email }), request.body);
    if (await allowAuthAttempt(`reset-email:${input.email}`, 3, 3600_000)) {
      const [account] = await db.select().from(customerAccounts).where(and(eq(customerAccounts.email, input.email), eq(customerAccounts.active, true)));
      if (account) await sendAccountLink(account.email, "reset", await createAccountLink(account.email, "reset"));
    }
    return { message: "If this email has an active account, a password reset link will arrive shortly. Check spam too." };
  });

  app.post("/me/verify-email", async request => {
    const account = await requireCustomer(request);
    if (account.emailVerifiedAt) return { message: "Your email is already verified." };
    if (!await allowAuthAttempt(`verify-email:${account.id}`, 3, 3600_000)) fail("Wait an hour before requesting another email.", 429);
    const sent = await sendAccountLink(account.email, "verify", await createAccountLink(account.email, "verify"));
    return { message: sent ? "Verification email sent. Check your inbox." : "Email could not be sent. Please try again later." };
  });

  app.post("/account-link", async request => {
    const { token } = parseBody(tokenInput, request.body);
    const [link] = await db.select().from(accountTokens).where(eq(accountTokens.tokenHash, accountTokenHash(token)));
    if (!link || link.usedAt || link.expiresAt <= new Date()) throw fail("This link expired or was already used. Request a new one.");
    return { purpose: link.purpose, email: link.email, companyName: link.details.name };
  });

  app.post("/account-link/complete", async request => {
    const input = parseBody(tokenInput.extend({ password: password.optional(), displayName: z.string().trim().min(2).max(120).optional() }), request.body);
    const [candidate] = await db.select({ email: accountTokens.email }).from(accountTokens).where(eq(accountTokens.tokenHash, accountTokenHash(input.token)));
    const accountEmail = candidate?.email ?? fail("This link expired or was already used. Request a new one.");
    const passwordHash = input.password ? await hashPassword(input.password) : undefined;
    await db.transaction(async tx => {
      // Serialize an account before locking its reset tokens, including concurrent links for the same email.
      await lockAccount(tx, accountEmail);
      const [link] = await tx.select().from(accountTokens).where(eq(accountTokens.tokenHash, accountTokenHash(input.token))).for("update");
      if (!link || link.usedAt || link.expiresAt <= new Date()) throw fail("This link expired or was already used. Request a new one.");
      const [account] = await tx.select().from(customerAccounts).where(eq(customerAccounts.email, link.email)).for("update");
      if (link.purpose === "invite") {
        if (!passwordHash || !input.displayName) throw fail("Enter your name and a new password.");
        if (account) throw fail("An account already exists. Sign in and ask Admin to create your workspace.", 409);
        const [profile] = await tx.insert(customerProfiles).values({ publicSlug: `client-${randomBytes(12).toString("hex")}`, displayName: input.displayName, published: false }).returning();
        await ensureProfileHandle(tx, profile!.id, input.displayName);
        const [owner] = await tx.insert(customerAccounts).values({ email: link.email, passwordHash, profileId: profile!.id, emailVerifiedAt: new Date() }).returning();
        await tx.insert(companies).values({ name: link.details.name!, ownerAccountId: owner!.id, domain: link.details.domain || null });
      } else {
        if (!account || !account.active) throw fail("This account is unavailable.");
        if (link.purpose === "reset" && !passwordHash) throw fail("Enter your new password.");
        await tx.update(customerAccounts).set({ emailVerifiedAt: new Date(), ...(link.purpose === "reset" ? { passwordHash, authVersion: account.authVersion + 1 } : {}) }).where(eq(customerAccounts.id, account.id));
        if (link.purpose === "reset") await tx.update(accountTokens).set({ usedAt: new Date() }).where(and(eq(accountTokens.email, link.email), eq(accountTokens.purpose, "reset"), isNull(accountTokens.usedAt)));
      }
      await tx.update(accountTokens).set({ usedAt: new Date() }).where(eq(accountTokens.tokenHash, link.tokenHash));
      await tx.insert(auditLogs).values({ action: `CUSTOMER_ACCOUNT_${link.purpose.toUpperCase()}`, targetType: "customer_account", targetId: account?.id ?? "invited", metadata: {} });
    });
    return { message: "Account updated. You can now sign in." };
  });

  app.post("/me/password", async request => {
    const account = await requireCustomer(request);
    const input = parseBody(z.object({ currentPassword: z.string().max(200), password }), request.body);
    if (!await verifyPassword(input.currentPassword, account.passwordHash)) fail("Your current password is incorrect.", 403);
    const passwordHash = await hashPassword(input.password);
    await db.transaction(async tx => {
      await lockAccount(tx, account.email);
      const changed = await tx.update(customerAccounts).set({ passwordHash, authVersion: sql`${customerAccounts.authVersion} + 1` })
        .where(and(eq(customerAccounts.id, account.id), eq(customerAccounts.passwordHash, account.passwordHash))).returning();
      if (!changed.length) fail("Your password changed elsewhere. Sign in again.", 409);
      await tx.update(accountTokens).set({ usedAt: new Date() }).where(and(eq(accountTokens.email, account.email), eq(accountTokens.purpose, "reset"), isNull(accountTokens.usedAt)));
    });
    return { message: "Password changed. Sign in again on your devices." };
  });
};
