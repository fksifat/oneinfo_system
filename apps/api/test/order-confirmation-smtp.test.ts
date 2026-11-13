import { expect, it, vi } from "vitest";
import type { StoreOrder } from "@oneinfo/contracts";
import nodemailer from "nodemailer";
import { sendOrderConfirmation, sendPaymentVerifiedEmail } from "../src/domain/order-confirmation.js";
import { sendReviewInvitation } from "../src/domain/review-invitation.js";

const sendMail = vi.hoisted(() => vi.fn());
vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn(() => ({ sendMail })) } }));
vi.mock("../src/config.js", () => ({
  config: {
    BREVO_SMTP_USER: "login@smtp-brevo.com", BREVO_SMTP_KEY: "test-key",
    ORDER_EMAIL_FROM: "Oneinfo <no-reply@example.com>", STOREFRONT_URL: "https://www.oneinfo.online/",
    JWT_SECRET: "fixture-secret-for-order-tracking-tests",
  },
}));

it("sends an inline logo and escaped receipt once, with an accurate pending payment status", async () => {
  sendMail.mockResolvedValue({ accepted: ["buyer@example.com"] });
  const order: StoreOrder = {
    id: "00000000-0000-4000-8000-000000000001", createdAt: new Date().toISOString(), paymentMethod: "COD",
    paymentAmountMinor: 10000, paymentStatus: "PENDING_VERIFICATION", status: "RECEIVED",
    customer: { name: "<Buyer & Co>", email: "buyer@example.com", phone: "01700000000", note: "" },
    deliveryAddress: { district: "Dhaka", addressLine: "House 12 <West>" },
    items: [{ productId: "p", variantId: "v", name: "Essential & Co", variantName: "White", quantity: 1, unitPriceMinor: 49900 }],
    shippingZone: "subDhaka", subtotalMinor: 49900, shippingMinor: 10000, totalMinor: 54910,
    couponCode: "SAVE10", discountMinor: 4990, invoiceNumber: "20261113-ABC123", activationMethod: "ORDER_SECRET",
  };

  expect(await sendOrderConfirmation(order, true)).toBe("accepted");
  expect(await sendOrderConfirmation(order, false)).toBeUndefined();
  expect(sendMail).toHaveBeenCalledTimes(1);
  expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
    host: "smtp-relay.brevo.com", port: 587, requireTLS: true,
  }));
  const message = sendMail.mock.calls[0]![0];
  expect(message.to).toEqual([{ address: "buyer@example.com", name: "" }]);
  expect(message.attachments[0]).toMatchObject({ cid: "oneinfo-logo@oneinfo.online", contentType: "image/png" });
  expect(message.attachments[0].content.subarray(0, 8)).toEqual(Buffer.from("89504e470d0a1a0a", "hex"));
  expect(message.html).toContain('src="cid:oneinfo-logo@oneinfo.online"');
  expect(message.html).toContain("&lt;Buyer &amp; Co&gt;");
  expect(message.html).toContain("Essential &amp; Co");
  expect(message.html).toContain("House 12 &lt;West&gt;");
  expect(message.html).toContain("bKash payment pending verification: BDT 100.00");
  expect(message.html).toContain('bgcolor="#173a34"');
  expect(message.html).toContain("Set up your card after delivery");
  expect(message.html).toContain("20261113-ABC123");
  expect(message.text).toContain("Remaining on delivery after verification: BDT 449.10");
  expect(message.html).toMatch(/href="https:\/\/www\.oneinfo\.online\/#track\/00000000-0000-4000-8000-000000000001\.[a-zA-Z0-9_-]{43}"/);
  expect(message.html).toMatch(/href="https:\/\/www\.oneinfo\.online\/#invoice\/00000000-0000-4000-8000-000000000001\.[a-zA-Z0-9_-]{43}"/);
  expect(message.html.indexOf("Track your order")).toBeLessThan(message.html.indexOf("Order summary"));
  expect(await sendOrderConfirmation({ ...order, paymentStatus: "VERIFIED" }, true, true)).toBe("accepted");
  const verified = sendMail.mock.lastCall![0];
  expect(verified.html).toContain("Verified bKash payment: BDT 100.00");
  expect(verified.text).toContain("Remaining on delivery: BDT 449.10");
  sendMail.mockRejectedValueOnce(new Error("SMTP unavailable"));
  expect(await sendOrderConfirmation(order, true)).toBe("failed");
});

it("sends branded payment and delivery updates with the correct amounts and private link", async () => {
  sendMail.mockClear().mockResolvedValue({ accepted: ["buyer@example.com"] });
  const order = { id: "test-order", customer: { name: "Buyer", email: "buyer@example.com", phone: "01700000000", note: "" }, totalMinor: 135000, paymentAmountMinor: 10000 };
  expect(await sendPaymentVerifiedEmail(order)).toBe(true);
  expect(await sendPaymentVerifiedEmail({ ...order, paymentAmountMinor: order.totalMinor })).toBe(true);
  expect(await sendReviewInvitation(order, "private-token")).toBe(true);

  const [advance, paidInFull, delivered] = sendMail.mock.calls.map(([message]) => message);
  expect(advance.text).toContain("Verified payment: BDT 100.00");
  expect(advance.text).toContain("Remaining on delivery: BDT 1250.00");
  expect(paidInFull.text).toContain("Your order is paid in full.");
  expect(delivered.html).toContain('href="https://www.oneinfo.online/#review/private-token"');
  for (const message of [advance, paidInFull, delivered]) {
    expect(message.html).toContain('src="cid:oneinfo-logo@oneinfo.online"');
    expect(message.to).toEqual([{ address: "buyer@example.com", name: "" }]);
  }
});
