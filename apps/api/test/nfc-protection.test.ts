import { expect, it } from "vitest";
import { NfcProtectionSchema, SaveNfcProtectionPasswordSchema } from "@oneinfo/contracts";
import { encryptNfcKey, decryptNfcKey, resolveNfcKey } from "../src/domain/nfc-protection.js";

it("validates private Classic keys and explicit acknowledgement", () => {
  const input = { cardId: crypto.randomUUID(), operation: "PROTECT", keyHex: "49c26785a1fe", confirmed: true };
  expect(NfcProtectionSchema.parse(input).keyHex).toBe("49C26785A1FE");
  for (const keyHex of ["FFFFFFFFFFFF", "000000000000", "A0A1A2A3A4A5", "D3F7D3F7D3F7", "1234", "not-a-password"]) {
    expect(NfcProtectionSchema.safeParse({ ...input, keyHex }).success).toBe(false);
  }
  expect(NfcProtectionSchema.safeParse({ ...input, confirmed: false }).success).toBe(false);
});

it("accepts exactly one custom, legacy or saved password source", () => {
  const base = { cardId: crypto.randomUUID(), operation: "PROTECT", confirmed: true };
  expect(NfcProtectionSchema.safeParse({ ...base, password: "My shared NFC password" }).success).toBe(true);
  expect(NfcProtectionSchema.safeParse({ ...base, useSavedPassword: true }).success).toBe(true);
  for (const extra of [{}, { password: "short" }, { password: "        " }, { password: "a".repeat(129) },
    { useSavedPassword: true, password: "My shared NFC password" }, { password: "My shared NFC password", keyHex: "49C26785A1FE" }]) {
    expect(NfcProtectionSchema.safeParse({ ...base, ...extra }).success).toBe(false);
  }
  expect(SaveNfcProtectionPasswordSchema.safeParse({ password: "My shared NFC password", confirmed: true }).success).toBe(true);
  expect(SaveNfcProtectionPasswordSchema.safeParse({ password: "My shared NFC password", confirmed: false }).success).toBe(false);
});

it("derives the same hardware key for the same custom password while preserving legacy keys", async () => {
  const password = "Shared password বাংলা 2026";
  const first = await resolveNfcKey({ password });
  expect(first).toBe("E2B7C0A44677");
  expect(await resolveNfcKey({ password })).toBe(first);
  expect(await resolveNfcKey({ password: password + "different" })).not.toBe(first);
  expect(await resolveNfcKey({ keyHex: "49c26785a1fe" })).toBe("49C26785A1FE");
  expect(await resolveNfcKey({ password: "49C26785A1FE" })).not.toBe("49C26785A1FE");
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
