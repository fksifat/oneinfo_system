import { describe, expect, it } from "vitest";
import { CreateBatchSchema, CreateProfileSchema, NfcAttemptSchema, NfcBridgeResultSchema, NfcUtilitySchema } from "@oneinfo/contracts";

describe("trust boundary validation", () => {
  it("requires explicit confirmation before erasing a tag", () => {
    expect(NfcUtilitySchema.safeParse({ operation: "ERASE" }).success).toBe(false);
    expect(NfcUtilitySchema.safeParse({ operation: "ERASE", overwriteConfirmed: false }).success).toBe(false);
    expect(NfcUtilitySchema.parse({ operation: "ERASE", overwriteConfirmed: true })).toEqual({ operation: "ERASE", overwriteConfirmed: true });
  });
  it("requires explicit overwrite consent and safe utility data without altering plain text", () => {
    expect(NfcUtilitySchema.safeParse({ operation: "READ" }).success).toBe(true);
    expect(NfcUtilitySchema.safeParse({ operation: "WRITE", recordType: "URL", value: "https://example.com" }).success).toBe(false);
    expect(NfcUtilitySchema.safeParse({ operation: "WRITE", recordType: "URL", value: "javascript:alert(1)", overwriteConfirmed: true }).success).toBe(false);
    expect(NfcUtilitySchema.safeParse({ operation: "WRITE", recordType: "TEXT", value: "  ", overwriteConfirmed: true }).success).toBe(false);
    const note = "  বাংলা NFC test\nSecond line  ";
    expect(NfcUtilitySchema.parse({ operation: "WRITE", recordType: "TEXT", value: note, overwriteConfirmed: true })).toMatchObject({ value: note });
  });
  it("requires one distinct safe link per imported card", () => {
    const batch = { batchCode: "BULK-TEST", productVariantId: "CARD", quantity: 2 };
    expect(CreateBatchSchema.safeParse({ ...batch, links: ["https://example.com/a", "https://example.com/b"] }).success).toBe(true);
    expect(CreateBatchSchema.safeParse({ ...batch, links: ["https://example.com/a"] }).success).toBe(false);
    expect(CreateBatchSchema.safeParse({ ...batch, links: ["https://example.com/a", "https://example.com/a"] }).success).toBe(false);
  });
  it("rejects successful NFC results whose read-back does not match", () => {
    expect(NfcAttemptSchema.safeParse({ idempotencyKey: crypto.randomUUID(), result: "SUCCEEDED",
      expectedUrlHash: "a".repeat(64), readbackUrlHash: "b".repeat(64) }).success).toBe(false);
    expect(NfcBridgeResultSchema.safeParse({ result: "SUCCEEDED", expectedUrl: "https://oneinfo.example/a",
      readbackUrl: "https://oneinfo.example/b" }).success).toBe(false);
  });

  it("rejects executable profile URLs and overlong phone numbers", () => {
    const profile = { publicSlug: "client", displayName: "Test Client" };
    for (const url of ["javascript:alert(1)", "data:text/html,hello", "file:///etc/passwd"]) {
      expect(CreateProfileSchema.safeParse({ ...profile, website: url }).success).toBe(false);
      expect(CreateProfileSchema.safeParse({ ...profile, links: [{ label: "Link", url }] }).success).toBe(false);
    }
    expect(CreateProfileSchema.safeParse({ ...profile, phone: "1".repeat(41) }).success).toBe(false);
    expect(CreateProfileSchema.safeParse({ ...profile, website: "https://example.com", phone: "+880123456789" }).success).toBe(true);
  });
});
