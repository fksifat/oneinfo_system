const pixelId = "1307488551509212";
const consentKey = "oneinfo.marketing-consent";
const privateRoute = () => /^#(?:track|invoice|review)(?:\/|$)/i.test(location.hash);
let enabled = false;
let active = false;

export function trackStorefront(event, details, options) {
  if (!active || privateRoute()) return false;
  try {
    window.fbq("trackSingle", pixelId, event, details, options);
    return true;
  } catch { return false; }
}

export function trackPurchase({ id, status, totalMinor }) {
  if (!active || privateRoute() || !id || status !== "RECEIVED" || !Number.isSafeInteger(totalMinor) || totalMinor < 0) return;
  const key = `oneinfo.marketing-purchase.${id}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch { /* Meta also gets the stable event ID. */ }
  trackStorefront("Purchase", { currency: "BDT", value: totalMinor / 100 }, { eventID: `oneinfo-order-${id}` });
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
    updatePixel();
    if (active) onEnable();
  });
  window.addEventListener("hashchange", () => {
    if (privateRoute()) panel.hidden = true;
    else if (!saved) panel.hidden = false;
    updatePixel();
  });
  window.addEventListener("storage", event => {
    if (event.key !== consentKey) return;
    saved = event.newValue;
    enabled = saved === "allow";
    panel.hidden = Boolean(saved) || privateRoute();
    updatePixel();
  });
  updatePixel();
}
