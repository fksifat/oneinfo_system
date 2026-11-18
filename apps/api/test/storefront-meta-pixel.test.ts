import { afterEach, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { sendMetaPurchaseEvent } from "../src/domain/meta-conversions.js";

afterEach(() => {
  config.META_CONVERSIONS_API_TOKEN = undefined;
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("measures the consenting checkout once per step, without sending personal fields", async () => {
  const calls = vi.fn();
  const page = new EventTarget();
  const choice = Object.assign(new EventTarget(), { hidden: true, querySelector: () => ({ focus() {} }) });
  const settings = Object.assign(new EventTarget(), { hidden: true, focus() {} });
  const route = { hash: "#order-draft" };
  const session = new Map();
  vi.stubGlobal("window", Object.assign(page, { fbq: calls }));
  vi.stubGlobal("document", { querySelector: (selector: string) => selector === "#marketing-choice" ? choice : settings });
  vi.stubGlobal("location", route);
  vi.stubGlobal("sessionStorage", { getItem: session.get.bind(session), setItem: session.set.bind(session), removeItem: session.delete.bind(session) });
  vi.stubGlobal("localStorage", { getItem: () => "allow" });

  const { initializeStorefrontPixel, trackStorefront, trackCheckout, trackPaymentInfo, trackPurchase } = await import("../../../sites/storefront/meta-pixel.js");
  const items = [
    { productId: "one", variantId: "blue", quantity: 1, unitPriceMinor: 49900, customization: { name: "Private" } },
    { productId: "one", variantId: "blue", quantity: 2, unitPriceMinor: 49900 },
  ];
  trackCheckout(items);
  expect(calls).not.toHaveBeenCalled();
  initializeStorefrontPixel(() => {});
  trackCheckout(items);
  trackCheckout([...items].reverse());
  trackPaymentInfo("request", items);
  trackPaymentInfo("request", items);
  trackPurchase({ id: "order", status: "AWAITING_PAYMENT", totalMinor: 155700 }, items);
  const receipt = { id: "order", status: "RECEIVED", totalMinor: 155700 };
  trackPurchase(receipt, items);
  trackPurchase(receipt, items);
  route.hash = "#invoice/private-token";
  trackCheckout(items);
  trackPaymentInfo("other-request", items);
  trackPurchase({ ...receipt, id: "other-order" }, items);

  const events = calls.mock.calls.filter(call => call[0] === "trackSingle");
  expect(events.map(call => call[2])).toEqual(["PageView", "InitiateCheckout", "AddPaymentInfo", "Purchase"]);
  expect(events[1][3]).toMatchObject({ value: 1497, contents: [{ id: "one_blue", quantity: 3 }] });
  expect(events[3][3]).toMatchObject({ value: 1557, currency: "BDT", content_ids: ["one_blue"] });
  expect(events[3][4]).toEqual({ eventID: "oneinfo-order-order" });
  expect(events.every(call => typeof call[4]?.eventID === "string" && call[4].eventID.length > 0)).toBe(true);
  route.hash = "#product/oneinfo-essential";
  trackStorefront("AddToCart", { value: 499, currency: "BDT" });
  trackStorefront("AddToCart", { value: 499, currency: "BDT" });
  const addEvents = calls.mock.calls.filter(call => call[2] === "AddToCart");
  expect(addEvents).toHaveLength(2);
  expect(addEvents[0][4].eventID).not.toBe(addEvents[1][4].eventID);
  expect(JSON.stringify(events)).not.toContain("Private");
});

it("does not generate or send events without consent", async () => {
  const calls = vi.fn();
  const choice = Object.assign(new EventTarget(), { hidden: true, querySelector: () => ({ focus() {} }) });
  const settings = Object.assign(new EventTarget(), { hidden: true, focus() {} });
  const route = { hash: "#product/oneinfo-essential" };
  vi.stubGlobal("window", Object.assign(new EventTarget(), { fbq: calls }));
  vi.stubGlobal("document", { querySelector: (selector: string) => selector === "#marketing-choice" ? choice : settings });
  vi.stubGlobal("location", route);
  vi.stubGlobal("localStorage", { getItem: () => "decline" });
  const randomUUID = vi.fn();
  vi.stubGlobal("crypto", { randomUUID });
  const { initializeStorefrontPixel, trackStorefront } = await import("../../../sites/storefront/meta-pixel.js");
  initializeStorefrontPixel(() => {});
  expect(trackStorefront("AddToCart", {})).toBe(false);
  expect(randomUUID).not.toHaveBeenCalled();
  expect(calls).not.toHaveBeenCalled();
});

it("sends matching Purchase event_id and hashed customer data through Meta Conversions API", async () => {
  const fetchSpy = vi.fn(async () => Response.json({ events_received: 1 }));
  vi.stubGlobal("fetch", fetchSpy);
  config.META_CONVERSIONS_API_TOKEN = "test-capi-token";

  const sent = await sendMetaPurchaseEvent(
    {
      id: "order",
      createdAt: "2026-11-18T09:00:00.000Z",
      customer: { email: "Buyer@Example.com", phone: "01712-345678" },
      deliveryAddress: { district: "Dhaka" },
      items: [
        { productId: "one", variantId: "blue", quantity: 1, unitPriceMinor: 49900 },
        { productId: "one", variantId: "blue", quantity: 2, unitPriceMinor: 49900 },
      ],
    },
    155700,
    { ip: "203.0.113.10", userAgent: "Mozilla/5.0" },
  );

  expect(sent).toBe(true);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://graph.facebook.com/v21.0/1307488551509212/events");
  const body = JSON.parse(String(init.body));
  expect(body.data[0]).toMatchObject({
    event_name: "Purchase",
    event_id: "oneinfo-order-order",
    action_source: "website",
    custom_data: {
      value: 1557,
      currency: "BDT",
      content_ids: ["one_blue"],
      contents: [{ id: "one_blue", quantity: 3 }],
      num_items: 3,
    },
  });
  expect(JSON.stringify(body)).not.toContain("Buyer@Example.com");
  expect(JSON.stringify(body)).not.toContain("01712");
});
