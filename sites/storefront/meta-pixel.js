import { catalogVariantId } from "@oneinfo/contracts";

const pixelId = "1307488551509212";
const consentKey = "oneinfo.marketing-consent";
const checkoutKey = "oneinfo.marketing-checkout";
const privateRoute = () => /^#(?:track|invoice|review)(?:\/|$)/i.test(location.hash);
let enabled = false;
let active = false;
const tracked = new Map();

export function trackStorefront(event, details, options) {
  if (!active || privateRoute()) return false;
  try {
    window.fbq("trackSingle", pixelId, event, details, options);
    return true;
  } catch { return false; }
}

export function catalogEventDetails(items, totalMinor) {
  const counts = new Map();
  let subtotal = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const { productId, variantId, quantity, unitPriceMinor } = item ?? {};
    if (typeof productId !== "string" || typeof variantId !== "string" || !productId || !variantId || !Number.isInteger(quantity) || quantity < 1) continue;
    const id = catalogVariantId(productId, variantId);
    counts.set(id, (counts.get(id) ?? 0) + quantity);
    if (Number.isSafeInteger(unitPriceMinor)) subtotal += unitPriceMinor * quantity;
  }
  const content_ids = [...counts.keys()].sort();
  const contents = content_ids.map(id => ({ id, quantity: counts.get(id) }));
  return { content_ids, content_type: "product", contents,
    num_items: contents.reduce((sum, item) => sum + item.quantity, 0), currency: "BDT", value: (totalMinor ?? subtotal) / 100 };
}

function trackOnce(key, marker, event, details, options) {
  if (tracked.get(key) === marker) return;
  try { if (sessionStorage.getItem(key) === marker) return; } catch { /* Keep in-memory deduplication. */ }
  if (!trackStorefront(event, details, options)) return;
  tracked.set(key, marker);
  try { sessionStorage.setItem(key, marker); } catch { /* Keep in-memory deduplication. */ }
}

export function trackCheckout(items) {
  if (!active || privateRoute() || !items.length) return;
  const details = catalogEventDetails(items);
  trackOnce(checkoutKey, JSON.stringify([details.contents, details.value]), "InitiateCheckout", details);
}

export function trackPaymentInfo(requestId, items) {
  if (!active || privateRoute() || !requestId) return;
  trackOnce(`oneinfo.marketing-payment.${requestId}`, "1", "AddPaymentInfo", catalogEventDetails(items));
}

export function trackPurchase({ id, status, totalMinor }, items) {
  if (!id || !["RECEIVED", "PROCESSING", "SHIPPED", "DELIVERED"].includes(status) || !Number.isSafeInteger(totalMinor) || totalMinor < 0) return;
  tracked.delete(checkoutKey);
  try { sessionStorage.removeItem(checkoutKey); } catch { /* Keep in-memory deduplication. */ }
  if (!active || privateRoute()) return;
  trackOnce(`oneinfo.marketing-purchase.${id}`, "1", "Purchase", catalogEventDetails(items, totalMinor), { eventID: `oneinfo-order-${id}` });
}

function updatePixel() {
  const next = enabled && !privateRoute();
  if (next === active) return;
  active = next;
  if (!window.fbq && active) {
    const queue = (...args) => queue.callMethod ? queue.callMethod(...args) : queue.queue.push(args);
    queue.push = queue;
    queue.loaded = true;
    queue.version = "2.0";
    queue.queue = [];
    window.fbq = window._fbq = queue;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.append(script);
    window.fbq("set", "autoConfig", false, pixelId);
    window.fbq("init", pixelId);
  }
  window.fbq("consent", active ? "grant" : "revoke");
  if (active) trackStorefront("PageView", {});
  return active;
}

export function initializeStorefrontPixel(onEnable) {
  const panel = document.querySelector("#marketing-choice");
  const settings = document.querySelector("#marketing-settings");
  let saved;
  try { saved = localStorage.getItem(consentKey); } catch { /* Tracking requires a stored choice. */ }
  enabled = saved === "allow";
  settings.hidden = false;
  panel.hidden = Boolean(saved) || privateRoute();
  settings.addEventListener("click", () => {
    panel.hidden = false;
    panel.querySelector("button").focus();
  });
  panel.addEventListener("click", event => {
    const choice = event.target.closest("button[data-marketing]")?.dataset.marketing;
    if (!choice) return;
    try { localStorage.setItem(consentKey, choice); }
    catch { if (choice === "allow") return; }
    saved = choice;
    enabled = choice === "allow";
    panel.hidden = true;
    settings.focus({ preventScroll: true });
    if (updatePixel()) onEnable();
  });
  window.addEventListener("hashchange", () => {
    if (privateRoute()) panel.hidden = true;
    else if (!saved) panel.hidden = false;
    if (updatePixel()) onEnable();
  });
  window.addEventListener("storage", event => {
    if (event.key !== consentKey) return;
    saved = event.newValue;
    enabled = saved === "allow";
    panel.hidden = Boolean(saved) || privateRoute();
    if (updatePixel()) onEnable();
  });
  updatePixel();
}
