import { expect, it } from "vitest";
import { ActivateCardSchema, CustomerEmailSchema, CustomerSignupSchema } from "@oneinfo/contracts";
import { hashPassword, issueClaimToken, issueCustomerToken, readClaimToken, verifyPassword } from "../src/domain/customer-auth.js";
import { SignJWT } from "jose";
import { config } from "../src/config.js";

it("hashes passwords with independent salts and verifies without storing plaintext", async () => {
  const password = "a secure customer password";
  const first = await hashPassword(password), second = await hashPassword(password);
  expect(first).not.toContain(password);
  expect(first).not.toBe(second);
  expect(await verifyPassword(password, first)).toBe(true);
  expect(await verifyPassword("wrong password", first)).toBe(false);
  expect(await verifyPassword(password, "invalid")).toBe(false);
});

it("keeps customer login tokens separate from card activation tokens", async () => {
  const cardId = crypto.randomUUID(), version = crypto.randomUUID();
  expect(await readClaimToken(await issueClaimToken(cardId, version))).toEqual({ cardId, version });
  await expect(readClaimToken(await issueCustomerToken(cardId))).rejects.toMatchObject({ statusCode: 401 });
  await expect(readClaimToken("invalid-token")).rejects.toMatchObject({ statusCode: 401 });
  await expect(readClaimToken(await issueClaimToken("invalid-card-id", version))).rejects.toMatchObject({ statusCode: 401 });
  const expired = await new SignJWT({ version }).setProtectedHeader({ alg: "HS256" }).setIssuer("oneinfo-customer-api")
    .setAudience("oneinfo-card-claim").setSubject(cardId).setExpirationTime(1).sign(new TextEncoder().encode(config.JWT_SECRET));
  await expect(readClaimToken(expired)).rejects.toMatchObject({ statusCode: 401 });
});

it("normalizes secret codes and account emails and validates public details", () => {
  expect(ActivateCardSchema.parse({ secretCode: "abcd-0123-abcd-0123-abcd" }).secretCode).toBe("ABCD0123ABCD0123ABCD");
  expect(CustomerEmailSchema.parse(" Client@Example.com ")).toBe("client@example.com");
  expect(CustomerSignupSchema.safeParse({ claimToken: "x", email: "client@example.com", password: "short", profile: { displayName: "Test" } }).success).toBe(false);
});
