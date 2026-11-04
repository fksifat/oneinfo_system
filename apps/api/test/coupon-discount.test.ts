import { expect, it } from "vitest";
import { couponDiscount } from "../../../packages/contracts/src/index.js";

it("rounds coupon discounts to whole taka without exceeding the subtotal", () => {
  expect(couponDiscount(49_499, 10)).toBe(4_900);
  expect(couponDiscount(49_500, 10)).toBe(5_000);
  expect(couponDiscount(49_900, 10)).toBe(5_000);
  expect(couponDiscount(49_999, 100)).toBe(49_900);
});
