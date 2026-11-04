import { expect, it } from "vitest";
import { BkashTransactionIdSchema, CodAdvanceSchema, paymentDueNow } from "@oneinfo/contracts";

it("quotes full bKash payment or a capped COD advance in minor units", () => {
  expect(paymentDueNow(55_900, "BKASH", 100)).toBe(55_900);
  expect(paymentDueNow(55_900, "COD", 100)).toBe(10_000);
  expect(paymentDueNow(55_900, "COD", 0)).toBe(0);
  expect(paymentDueNow(6_000, "COD", 100)).toBe(6_000);
  expect(CodAdvanceSchema.safeParse(100.5).success).toBe(false);
  expect(BkashTransactionIdSchema.parse(" abcd123456 ")).toBe("ABCD123456");
});
