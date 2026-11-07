import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify } from "jose";
import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { customerAccounts } from "../db/schema.js";
import { z } from "zod";

const derive = promisify(scrypt);
const key = new TextEncoder().encode(config.JWT_SECRET);
const issuer = "oneinfo-customer-api";

export function codeHash(cardId: string, code: string) {
  return createHash("sha256").update(`${cardId}:${code}`).digest("hex");
}

export function matchesCode(cardId: string, code: string, expected: string) {
  return timingSafeEqual(Buffer.from(codeHash(cardId, code), "hex"), Buffer.from(expected, "hex"));
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, hash] = encoded.split(":");
  if (algorithm !== "scrypt" || !salt || !hash || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const actual = await derive(password, salt, 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(hash, "hex"));
}

export function issueClaimToken(cardId: string, version: string) {
  return new SignJWT({ version }).setProtectedHeader({ alg: "HS256" }).setIssuer(issuer)
    .setAudience("oneinfo-card-claim").setSubject(cardId).setIssuedAt().setExpirationTime("15m").sign(key);
}

export function issueInvoiceClaimToken(cardId: string, orderId: string) {
  return new SignJWT({ orderId }).setProtectedHeader({ alg: "HS256" }).setIssuer(issuer)
    .setAudience("oneinfo-card-claim").setSubject(cardId).setIssuedAt().setExpirationTime("15m").sign(key);
}

export async function readClaimToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, key, { issuer, audience: "oneinfo-card-claim", algorithms: ["HS256"] });
    const cardId = z.uuid().parse(payload.sub);
    return payload.orderId ? { cardId, orderId: z.uuid().parse(payload.orderId) }
      : { cardId, version: z.uuid().parse(payload.version) };
  } catch {
    throw Object.assign(new Error("Activation expired. Scan your card and start activation again."), { statusCode: 401 });
  }
}

export function issueCustomerToken(customerId: string, version = 0) {
  return new SignJWT({ version }).setProtectedHeader({ alg: "HS256" }).setIssuer(issuer)
    .setAudience("oneinfo-customer").setSubject(customerId).setIssuedAt().setExpirationTime("8h").sign(key);
}

export async function requireCustomer(request: FastifyRequest) {
  let accountId: string;
  let tokenVersion = 0;
  try {
    const token = request.headers.authorization?.replace(/^Bearer /, "");
    if (!token) throw new Error("Missing token");
    const { payload } = await jwtVerify(token, key, { issuer, audience: "oneinfo-customer", algorithms: ["HS256"] });
    accountId = z.uuid().parse(payload.sub);
    tokenVersion = (payload.version as number) ?? 0;
  } catch {
    throw Object.assign(new Error("Please sign in to your customer account."), { statusCode: 401 });
  }
  const [account] = await db.select().from(customerAccounts).where(eq(customerAccounts.id, accountId)).limit(1);
  if (!account?.active || account.authVersion !== tokenVersion) throw Object.assign(new Error("Please sign in to your customer account."), { statusCode: 401 });
  return account;
}
