import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { initializeNfcDeck } from "../sites/storefront/nfc-deck.mjs";
import { initializeHero3D, initializeCardPreviews } from "../sites/storefront/hero-3d.mjs";
import {
  addCartVariant, reconcileCartItems,
  PREMIUM_PRESETS, SURFACE_COLORS, ACCENT_COLORS,
  isColorLight, defaultCustomization, renderSurfaceMotifSvg,
  renderBackMotifSvg, renderQrSvg,
} from "../sites/storefront/catalog.js";
import { ProductCustomizationSchema } from "@oneinfo/contracts";

const source = readFileSync(new URL("../sites/oneinfo-storefront/dist/app.js", import.meta.url), "utf8");

function render(savedCart) {
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      textContent: "", innerHTML: "", hidden: false,
      setAttribute() {}, addEventListener() {}, querySelectorAll: () => [],
    });
    return elements.get(selector);
  };
  const document = {
    querySelector: element,
    querySelectorAll: (selector) => selector === ".product" ? [{ dataset: { product: "Oneinfo Classic", price: "1000" } }] : [],
    addEventListener() {},
  };
  runInNewContext(source, { document, window: {}, Intl, localStorage: { getItem: () => JSON.stringify(savedCart) } });
  return elements;
}

test("restored cart rejects injected quantities and invalid saved data", () => {
  for (const value of [{ invalid: true }, [{ name: "Oneinfo Classic", quantity: '<img src=x onerror="alert(1)">', price: 1 }], [null]]) {
    assert.equal(render(value).get(".cart-items").innerHTML, "");
  }
});

test("restored cart uses catalog prices rather than saved prices", () => {
  const elements = render([{ name: "Oneinfo Classic", quantity: 2, price: 1 }]);
  assert.equal(elements.get(".cart-count").textContent, "2");
  assert.match(elements.get(".cart-items").innerHTML, /1,000/);
});

test("NFC deck switches the visible explanation and accessible selected state", () => {
  const modes = ["tap", "scan"];
  const buttons = modes.map(mode => ({
    dataset: { deckMode: mode },
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { assert.equal(name, "click"); this.click = handler; },
  }));
  const panels = modes.map(mode => ({ dataset: { deckPanel: mode }, hidden: mode !== "tap" }));
  const root = { dataset: { mode: "tap" }, querySelectorAll: selector => selector === "[data-deck-mode]" ? buttons : panels };
  initializeNfcDeck(root);
  for (const mode of ["scan", "tap"]) {
    buttons[modes.indexOf(mode)].click();
    assert.equal(root.dataset.mode, mode);
    assert.deepEqual(panels.filter(panel => !panel.hidden).map(panel => panel.dataset.deckPanel), [mode]);
    assert.deepEqual(buttons.filter(button => button.attributes["aria-pressed"] === "true").map(button => button.dataset.deckMode), [mode]);
  }
});

test("storefront uses defined SVG icons instead of decorative Unicode symbols", () => {
  const files = ["index.html", "app.js", "styles.css", "home.css"].map(name =>
    readFileSync(new URL(`../sites/storefront/${name}`, import.meta.url), "utf8"));
  for (const content of files) assert.doesNotMatch(content, /[\p{Emoji_Presentation}\uFE0F⌁▷▦◎＋↻↗←✓×−▶★☆]/u);
  const sprite = readFileSync(new URL("../sites/storefront/public/assets/icons.svg", import.meta.url), "utf8");
  const symbols = new Set([...sprite.matchAll(/<symbol id="([a-z-]+)"/g)].map(match => match[1]));
  const references = [...files.join("\n").matchAll(/icons\.svg#([a-z-]+)|icon\("([a-z-]+)"\)/g)];
  assert.ok(references.length > 20);
  for (const match of references) assert.ok(symbols.has(match[1] ?? match[2]), `Undefined icon: ${match[0]}`);
});

function eventTarget(extra = {}) {
  return { ...extra, events: {}, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(event, handler) { this.events[event] = handler; }, emit(event) { this.events[event]?.(); } };
}
function heroFixture(reduced = false) {
  const media = eventTarget({ matches: reduced });
  let visibility;
  const doc = eventTarget({ hidden: false, defaultView: { matchMedia: () => media,
    IntersectionObserver: class { constructor(callback) { visibility = callback; } observe() {} } } });
  const viewer = eventTarget({ src: "/assets/cards-final/black.glb", resetTurntableRotation() { this.reset = true; } });
  const elements = Object.fromEntries(["#hero-card-title", "#hero-card-desc", ".hero-poster", ".hero-fallback", "#hero-flip-btn", "#hero-motion-btn", ".hero-model-status"].map(id => [id, eventTarget({ textContent: "" })]));
  elements["#hero-model-viewer"] = viewer;
  const buttons = ["black", "light"].map(name => eventTarget({ dataset: { cardVariant: name } }));
  const root = { ownerDocument: doc, dataset: { heroActive: "black" }, querySelector: id => elements[id], querySelectorAll: () => buttons };
  initializeHero3D(root);
  return { root, doc, media, viewer, buttons, elements, visible: value => visibility([{ isIntersecting: value }]) };
}

test("3D motion pauses offscreen, in a hidden tab, on interaction and for reduced motion", () => {
  const f = heroFixture();
  const toggle = f.elements["#hero-motion-btn"];
  assert.equal(f.viewer.autoRotate, false);
  f.viewer.emit("load"); f.visible(true);
  assert.equal(f.viewer.autoRotate, true);
  f.visible(false); assert.equal(f.viewer.autoRotate, false);
  f.visible(true); f.doc.hidden = true; f.doc.emit("visibilitychange");
  assert.equal(f.viewer.autoRotate, false);
  f.doc.hidden = false; f.doc.emit("visibilitychange");
  assert.equal(f.viewer.autoRotate, true);
  f.viewer.emit("pointerdown"); assert.equal(f.viewer.autoRotate, false);
  toggle.emit("click"); assert.equal(f.viewer.autoRotate, true);
  toggle.emit("click"); assert.equal(f.viewer.autoRotate, false);
  f.media.matches = true; f.media.emit("change");
  assert.equal(f.viewer.autoRotate, false);
  assert.equal(f.viewer.interpolationDecay, 0);
  assert.equal(toggle.disabled, true);
  const reduced = heroFixture(true); reduced.viewer.emit("load"); reduced.visible(true);
  assert.equal(reduced.viewer.autoRotate, false);
});

test("finish changes update model and poster; flips stop rotation; failures have a still fallback", () => {
  const f = heroFixture(); f.buttons[1].emit("click");
  assert.equal(f.root.dataset.heroActive, "light");
  assert.equal(f.viewer.src, "/assets/cards-final/light.glb");
  assert.equal(f.elements["#hero-card-title"].textContent, "Minimalist Light");
  assert.match(f.elements[".hero-poster"].src, /light-studio-final.webp$/);
  assert.equal(f.buttons[1].attributes["aria-pressed"], "true");
  f.viewer.emit("load"); f.visible(true);
  f.elements["#hero-flip-btn"].emit("click");
  assert.equal(f.viewer.cameraOrbit, "205deg 75deg 105%");
  assert.equal(f.viewer.autoRotate, false); assert.equal(f.viewer.reset, true);
  f.elements["#hero-flip-btn"].emit("click");
  assert.equal(f.viewer.cameraOrbit, "25deg 75deg 105%");
  f.viewer.emit("error");
  assert.equal(f.elements[".hero-fallback"].hidden, false);
  assert.equal(f.elements["#hero-flip-btn"].disabled, true);
  f.buttons[0].emit("click"); assert.equal(f.root.dataset.modelState, "loading");
  f.viewer.emit("load"); assert.equal(f.elements[".hero-fallback"].hidden, true);
  assert.equal(f.elements["#hero-flip-btn"].disabled, false);
});

test("design previews turn both ways with accessible state and labels", () => {
  const button = eventTarget(); const hint = { lastChild: { textContent: " Turn card" } };
  const card = { dataset: { preview: "front" }, querySelector: selector => selector === "button" ? button : selector === "h3" ? { textContent: "Your professional introduction" } : hint };
  initializeCardPreviews({ querySelectorAll: () => [card] });
  button.emit("click"); assert.equal(card.dataset.preview, "back");
  assert.equal(button.attributes["aria-pressed"], "true"); assert.match(button.attributes["aria-label"], /^Show front/);
  button.emit("click"); assert.equal(card.dataset.preview, "front");
  assert.equal(hint.lastChild.textContent, " Turn card");
});

test("storefront copy omits chip specifications and production details", () => {
  for (const name of ["index.html", "app.js", "hero-3d.mjs"]) {
    const text = readFileSync(new URL(`../sites/storefront/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /NTAG\d+|13\.56|MHz|contactless chip|optical QR|Hardware verified|Identity allocated|Workstation prep|Free lifetime/i);
  }
});

test("customized card variations are stored, differentiated, and reconciled in cart", () => {
  const product = { id: "p1", name: "Oneinfo Signature", customizable: true };
  const variant = { id: "v1", name: "Soft-Touch Black", colorHex: "#0a201f", available: true, priceMinor: 179000, salePriceMinor: null };
  const custom1 = { name: "Avery Morgan", title: "Managing Director", position: "bottom-left", font: "sans" };
  const custom2 = { name: "Farhan Karim", title: "Design Lead", position: "bottom-center", font: "serif" };

  let cart = [];
  cart = addCartVariant(cart, product, variant, 1, custom1);
  assert.equal(cart.length, 1);
  assert.deepEqual(cart[0].customization, custom1);

  // Adding same product and variant with a DIFFERENT customization adds a separate cart item
  cart = addCartVariant(cart, product, variant, 2, custom2);
  assert.equal(cart.length, 2);
  assert.equal(cart[0].quantity, 1);
  assert.equal(cart[1].quantity, 2);
  assert.deepEqual(cart[1].customization, custom2);

  // Adding with the same customization increments existing item quantity
  cart = addCartVariant(cart, product, variant, 1, custom1);
  assert.equal(cart.length, 2);
  assert.equal(cart[0].quantity, 2);

  // Reconciling cart maintains customization metadata
  const catalog = [{ ...product, variants: [variant] }];
  const reconciled = reconcileCartItems(cart, catalog);
  assert.equal(reconciled.length, 2);
  assert.deepEqual(reconciled[0].customization, custom1);
  assert.deepEqual(reconciled[1].customization, custom2);
});

test("customizer presets and vector surface motifs cover all 10 premium designs", () => {
  assert.equal(PREMIUM_PRESETS.length, 10);
  assert.equal(PREMIUM_PRESETS[0].id, "01");
  assert.equal(PREMIUM_PRESETS[9].id, "10");

  const defaultSetup = defaultCustomization("01");
  assert.equal(defaultSetup.layout, "left");
  assert.equal(defaultSetup.surfaceMotif, "facets");
  assert.equal(defaultSetup.surfaceColor, "#0a0b0d");
  assert.equal(defaultSetup.accentColor, "#d8b26e");

  // Verify all 5 surface motifs produce expected vector overlays
  for (const motif of ["facets", "contour", "architectural", "inlay"]) {
    const svg = renderSurfaceMotifSvg(motif, "#d8b26e");
    assert.match(svg, /<svg class="card-surface-motif/);
    assert.match(svg, /#d8b26e/);
  }
  assert.equal(renderSurfaceMotifSvg("minimal", "#d8b26e"), "");

  // Verify luminance check
  assert.equal(isColorLight("#0a0b0d"), false);
  assert.equal(isColorLight("#0a121e"), false);
  assert.equal(isColorLight("#0d1f18"), false);
  assert.equal(isColorLight("#1f0a12"), false);
  assert.equal(isColorLight("#f7f5f0"), true);

  // Verify full customization object cart differentiation
  const product = { id: "p1", name: "Oneinfo Signature", customizable: true };
  const variant = { id: "v1", name: "Soft-Touch Black", colorHex: "#0a201f", available: true, priceMinor: 179000, salePriceMinor: null };
  const customFacets = {
    name: "Avery Morgan",
    title: "Managing Director",
    presetId: "01",
    layout: "left",
    surfaceMotif: "facets",
    surfaceColor: "#0a0b0d",
    accentColor: "#d8b26e",
    font: "sans",
  };
  const customContour = {
    name: "Avery Morgan",
    title: "Managing Director",
    presetId: "02",
    layout: "right",
    surfaceMotif: "contour",
    surfaceColor: "#0a121e",
    accentColor: "#e2e8f0",
    font: "serif",
  };

  let cart = [];
  cart = addCartVariant(cart, product, variant, 1, customFacets);
  cart = addCartVariant(cart, product, variant, 1, customContour);
  assert.equal(cart.length, 2);
  assert.equal(cart[0].customization.surfaceMotif, "facets");
  assert.equal(cart[1].customization.surfaceMotif, "contour");
  assert.equal(cart[0].customization.surfaceColor, "#0a0b0d");
  assert.equal(cart[1].customization.surfaceColor, "#0a121e");
});

test("two-sided card customization supports front/back vector motifs, QR styles, and contract validation", () => {
  // Test back motifs for all 4 pattern styles
  for (const motif of ["facets", "contour", "architectural", "inlay"]) {
    const svg = renderBackMotifSvg(motif, "#c5a059");
    assert.match(svg, /<svg class="card-surface-motif/);
    assert.match(svg, /motif-\w+-back/);
    assert.match(svg, /#c5a059/);
  }
  assert.equal(renderBackMotifSvg("minimal", "#c5a059"), "");

  // Test vector QR svg rendering for all styles
  const qrFramed = renderQrSvg("#d8b26e", "framed");
  assert.match(qrFramed, /class="card-qr-svg qr-style-framed"/);
  assert.match(qrFramed, /stroke="#d8b26e"/);

  const qrBadge = renderQrSvg("#e2e8f0", "badge");
  assert.match(qrBadge, /qr-style-badge/);
  assert.match(qrBadge, /stroke-dasharray="4 2"/);

  const qrMinimal = renderQrSvg("#c5a059", "minimal");
  assert.match(qrMinimal, /qr-style-minimal/);

  // Validate complete two-sided customization with ProductCustomizationSchema
  const customTwoSided = {
    name: "Avery Morgan",
    title: "Managing Director",
    presetId: "01",
    layout: "left",
    surfaceMotif: "facets",
    surfaceColor: "#0a0b0d",
    accentColor: "#d8b26e",
    font: "sans",
    finish: "matte",
    backQrStyle: "framed",
    backSubtitle: "oneinfo.me/avery",
  };
  const parsed = ProductCustomizationSchema.parse(customTwoSided);
  assert.equal(parsed.name, "Avery Morgan");
  assert.equal(parsed.backQrStyle, "framed");
  assert.equal(parsed.backSubtitle, "oneinfo.me/avery");

  // Reconcile two-sided customization in cart
  const product = { id: "p1", name: "Oneinfo Signature", customizable: true };
  const variant = { id: "v1", name: "Soft-Touch Black", colorHex: "#0a201f", available: true, priceMinor: 179000, salePriceMinor: null };
  const cart = addCartVariant([], product, variant, 1, parsed);
  assert.equal(cart[0].customization.backQrStyle, "framed");
  assert.equal(cart[0].customization.backSubtitle, "oneinfo.me/avery");
});
