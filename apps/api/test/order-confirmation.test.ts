import { afterEach, expect, it, vi } from "vitest";
import type { StoreOrder } from "@oneinfo/contracts";
import { sendOrderConfirmation } from "../src/domain/order-confirmation.js";

vi.mock("../src/config.js", () => ({
  config: { RESEND_API_KEY: "test-key", ORDER_EMAIL_FROM: "Oneinfo <orders@example.com>", STOREFRONT_URL: "https://oneinfo.example", JWT_SECRET: "email-test-secret" },
}));
afterEach(() => vi.unstubAllGlobals());

it("sends the order breakdown with a stable email key and skips old replays", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", send);
  const order: StoreOrder = {
    id: "test-order", createdAt: new Date().toISOString(), paymentMethod: "COD", status: "RECEIVED",
    customer: { name: "Test buyer", email: "buyer@example.com", phone: "01700000000", note: "" },
    deliveryAddress: { district: "Dhaka", addressLine: "Savar" },
    items: [{ productId: "p", variantId: "v", name: "Essential", variantName: "White", quantity: 1, unitPriceMinor: 49900 }],
    shippingZone: "subDhaka", subtotalMinor: 49900, shippingMinor: 10000, totalMinor: 54910,
    couponCode: "SAVE10", discountMinor: 4990, invoiceNumber: "20261113-ABC123",
  };
  expect(await sendOrderConfirmation(order, false)).toBe("accepted");
  const [url, request] = send.mock.calls[0]!;
  expect(url).toBe("https://api.resend.com/emails");
  expect(request.headers["Idempotency-Key"]).toBe("oneinfo-order/test-order");
  expect(JSON.parse(request.body)).toMatchObject({ to: ["buyer@example.com"], text: expect.stringContaining("Total due on delivery: BDT 549.10") });
  expect(JSON.parse(request.body).text).toContain("View invoice: https://oneinfo.example/#invoice/test-order.");
  expect(await sendOrderConfirmation({ ...order, createdAt: "2025-01-01T00:00:00.000Z" }, false)).toBeUndefined();
  expect(send).toHaveBeenCalledTimes(1);
});
