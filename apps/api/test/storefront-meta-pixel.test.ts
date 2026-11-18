import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

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
