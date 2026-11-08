import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { decryptOrderCode, encryptOrderCode, orderSecretHash } from "../src/domain/order-activation.js";
import { issueOrderProfileClaimToken, readClaimToken } from "../src/domain/customer-auth.js";

it("encrypts printable order codes with authentication and independent nonces", () => {
  const code = "ABCDEF0123456789ABCD";
  const first = encryptOrderCode(code), second = encryptOrderCode(code);
  expect(first).not.toBe(second);
  expect(first).not.toContain(code);
  expect(decryptOrderCode(first)).toBe(code);
  expect(orderSecretHash(code)).toMatch(/^[a-f0-9]{64}$/);
  const tampered = Buffer.from(first, "base64");
  tampered[15] = tampered[15]! ^ 1;
  expect(() => decryptOrderCode(tampered.toString("base64"))).toThrow();
});

it("binds the short-lived activation token to both the scanned card and temporary profile", async () => {
  const cardId = randomUUID(), orderProfileId = randomUUID();
  expect(await readClaimToken(await issueOrderProfileClaimToken(cardId, orderProfileId))).toEqual({ cardId, orderProfileId });
  await expect(readClaimToken(await issueOrderProfileClaimToken(cardId, "invalid"))).rejects.toMatchObject({ statusCode: 401 });
});
