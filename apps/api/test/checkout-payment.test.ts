import { expect, it } from "vitest";
import { TransactionIdSchema, PaymentSenderNumberSchema, CodAdvanceSchema, CheckoutWalletsSchema, defaultCheckoutWallets, paymentDueNow } from "@oneinfo/contracts";

it("quotes full mobile wallet payment or a capped COD advance in minor units", () => {
  expect(paymentDueNow(55_900, "BKASH", 100)).toBe(55_900);
  expect(paymentDueNow(55_900, "ROCKET", 100)).toBe(55_900);
  expect(paymentDueNow(55_900, "NAGAD", 0)).toBe(55_900);
  expect(paymentDueNow(55_900, "COD", 100)).toBe(10_000);
  expect(paymentDueNow(55_900, "COD", 0)).toBe(0);
  expect(paymentDueNow(6_000, "COD", 100)).toBe(6_000);
  expect(CodAdvanceSchema.safeParse(100.5).success).toBe(false);
  expect(TransactionIdSchema.parse(" abcd123456 ")).toBe("ABCD123456");
  expect(PaymentSenderNumberSchema.safeParse("01900000001").success).toBe(true);
  expect(PaymentSenderNumberSchema.safeParse("0190000").success).toBe(false);
});

it("requires a receiving number before enabling Nagad", () => {
  expect(CheckoutWalletsSchema.parse(defaultCheckoutWallets).NAGAD.enabled).toBe(false);
  const wallets = { ...defaultCheckoutWallets, NAGAD: { enabled: true, number: "" } };
  expect(CheckoutWalletsSchema.safeParse(wallets).success).toBe(false);
  expect(CheckoutWalletsSchema.parse({ ...wallets, NAGAD: { enabled: true, number: " 01900000001 " } }).NAGAD.number).toBe("01900000001");
});

it("supports toggling COD advance off for inside Dhaka", () => {
  expect(paymentDueNow(55_900, "COD", 100, { zone: "insideDhaka", codAdvanceInsideDhaka: false })).toBe(0);
  expect(paymentDueNow(55_900, "COD", 100, { zone: "insideDhaka", codAdvanceInsideDhaka: true })).toBe(10_000);
  expect(paymentDueNow(55_900, "COD", 100, { zone: "subDhaka", codAdvanceInsideDhaka: false })).toBe(10_000);
  expect(paymentDueNow(55_900, "COD", 100, { zone: "outsideDhaka", codAdvanceInsideDhaka: false })).toBe(10_000);
  expect(paymentDueNow(55_900, "BKASH", 100, { zone: "insideDhaka", codAdvanceInsideDhaka: false })).toBe(55_900);
});
