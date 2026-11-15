import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from "node:crypto";
import { NfcProtectionKeySchema } from "@oneinfo/contracts";
import { config } from "../config.js";

const key = createHash("sha256").update(`oneinfo-nfc-protection:${config.JWT_SECRET}`).digest();

export async function resolveNfcKey(input: { password?: string | undefined; keyHex?: string | undefined }): Promise<string> {
  if (input.keyHex !== undefined) return NfcProtectionKeySchema.parse(input.keyHex);
  const password = input.password;
  if (password === undefined) throw new Error("Missing NFC protection password");
  // Stable across cards/workstations; no station ID, card UID or mutable JWT secret in the derivation.
  const bytes = await new Promise<Buffer>((resolve, reject) => scrypt(password, "oneinfo-mifare-classic-password-v1", 6,
    { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }, (error, bytes) => error ? reject(error) : resolve(bytes)));
  return NfcProtectionKeySchema.parse(bytes.toString("hex"));
}

export function encryptNfcKey(value: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64");
}

export function decryptNfcKey(value: string): string {
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}
