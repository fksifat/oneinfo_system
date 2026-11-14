import { expect, it } from "vitest";
import { NfcProtectionSchema } from "@oneinfo/contracts";
import { encryptNfcKey, decryptNfcKey } from "../src/domain/nfc-protection.js";

it("validates private Classic keys and explicit acknowledgement", () => {
  const input = { cardId: crypto.randomUUID(), operation: "PROTECT", keyHex: "49c26785a1fe", confirmed: true };
  expect(NfcProtectionSchema.parse(input).keyHex).toBe("49C26785A1FE");
  for (const keyHex of ["FFFFFFFFFFFF", "000000000000", "A0A1A2A3A4A5", "D3F7D3F7D3F7", "1234", "not-a-password"]) {
    expect(NfcProtectionSchema.safeParse({ ...input, keyHex }).success).toBe(false);
  }
  expect(NfcProtectionSchema.safeParse({ ...input, confirmed: false }).success).toBe(false);
});

it("encrypts pending hardware keys with authenticated encryption and fresh nonces", () => {
  const password = "49C26785A1FE";
  const encrypted = encryptNfcKey(password);
  expect(decryptNfcKey(encrypted)).toBe(password);
  expect(encrypted).not.toBe(encryptNfcKey(password));
  expect(Buffer.from(encrypted, "base64").includes(Buffer.from(password))).toBe(false);
  const damaged = Buffer.from(encrypted, "base64"); damaged[28] = damaged[28]! ^ 1;
  expect(() => decryptNfcKey(damaged.toString("base64"))).toThrow();
});
