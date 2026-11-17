import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { initializeNfcDeck } from "../sites/storefront/nfc-deck.mjs";
import { initializeHero3D, initializeCardPreviews } from "../sites/storefront/hero-3d.mjs";
import {
  addCartVariant, reconcileCartItems, remainingVariantStock,
  PREMIUM_PRESETS, SURFACE_COLORS, ACCENT_COLORS,
  isColorLight, defaultCustomization, renderSurfaceMotifSvg,
  renderBackMotifSvg, renderQrSvg,
} from "../sites/storefront/catalog.js";
import { renderCardDesign, getElementStyle } from "../sites/storefront/card-design.js";
import { CustomerProfileSchema, ProductCustomizationSchema, PROFILE_BIO_MAX_LENGTH } from "@oneinfo/contracts";

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

test("tracked stock limits the whole colour across personalised cart lines", () => {
  const product = { id: "p1", name: "Test card" };
  const variant = { id: "v1", name: "Glacier", available: true, priceMinor: 50000, orderQuantityLimit: 3 };
  const another = { ...variant, id: "v2", name: "Midnight" };
  const cart = addCartVariant([], product, variant, 2, { name: "Buyer 1" });
  assert.equal(remainingVariantStock(cart, product.id, variant), 1);
  assert.equal(remainingVariantStock(cart, product.id, another), 3);
  assert.throws(() => addCartVariant(cart, product, variant, 2, { name: "Buyer 2" }), /Only 1 more/);
  const full = addCartVariant(cart, product, variant, 1, { name: "Buyer 2" });
  assert.equal(remainingVariantStock(full, product.id, variant), 0);
  assert.throws(() => addCartVariant(full, product, variant, 1), /already in your cart/);

  const reduced = reconcileCartItems(full, [{ ...product, variants: [{ ...variant, orderQuantityLimit: 1 }] }]);
  assert.deepEqual(reduced.map(item => item.quantity), [1]);
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

test("customization supports resizing logo, icon, qr and adding divider lines (horizontal and vertical)", () => {
  const customSizing = {
    name: "Nazmul Hossain",
    title: "Lead Engineer",
    textSize: 16,
    logoSize: 120,
    iconSize: 90,
    qrSize: 110,
    dividerLines: [
      { orientation: "horizontal", length: 120, style: "solid" },
      { orientation: "vertical", length: 50, style: "dashed" },
    ],
    elementPositions: {
      "divider-0": { x: 50, y: 55 },
      "divider-1": { x: 40, y: 70 },
      logo: { x: 25, y: 20 },
      sign: { x: 85, y: 20 },
    },
  };
  const parsed = ProductCustomizationSchema.parse(customSizing);
  assert.equal(parsed.logoSize, 120);
  assert.equal(parsed.iconSize, 90);
  assert.equal(parsed.qrSize, 110);
  assert.equal(parsed.dividerLines.length, 2);
  assert.equal(parsed.dividerLines[0].orientation, "horizontal");
  assert.equal(parsed.dividerLines[0].length, 120);
  assert.equal(parsed.dividerLines[0].style, "solid");
  assert.equal(parsed.dividerLines[1].orientation, "vertical");
  assert.equal(parsed.dividerLines[1].style, "dashed");
  assert.equal(parsed.elementPositions["divider-0"].x, 50);

  const product = { id: "p1", name: "Oneinfo Card", customizable: true };
  const variant = { id: "v1", name: "Gold", colorHex: "#d8b26e", available: true, priceMinor: 200000, salePriceMinor: null };
  const cart = addCartVariant([], product, variant, 1, parsed);
  assert.equal(cart[0].customization.logoSize, 120);
  assert.equal(cart[0].customization.iconSize, 90);
  assert.equal(cart[0].customization.qrSize, 110);
  assert.equal(cart[0].customization.dividerLines.length, 2);
});

test("customization supports With Oneinfo Logo vs Without Oneinfo Logo with admin pricing control", () => {
  const withLogoCustom = {
    name: "Nazmul Hossain",
    brandingMode: "with-logo",
    hasOneinfoLogo: true,
  };
  const withoutLogoCustom = {
    name: "Nazmul Hossain",
    brandingMode: "without-logo",
    hasOneinfoLogo: false,
  };

  const parsedWith = ProductCustomizationSchema.parse(withLogoCustom);
  assert.equal(parsedWith.brandingMode, "with-logo");
  assert.equal(parsedWith.hasOneinfoLogo, true);

  const parsedWithout = ProductCustomizationSchema.parse(withoutLogoCustom);
  assert.equal(parsedWithout.brandingMode, "without-logo");
  assert.equal(parsedWithout.hasOneinfoLogo, false);

  const product = { id: "p1", name: "Oneinfo Card", customizable: true };
  const variant = {
    id: "v1",
    name: "Obsidian",
    colorHex: "#0a0b0d",
    available: true,
    priceMinor: 149900,
    salePriceMinor: null,
    withoutLogoPriceMinor: 199900,
    withoutLogoSalePriceMinor: 189900,
  };

  // With logo: regular/sale price
  const cartWith = addCartVariant([], product, variant, 1, parsedWith);
  assert.equal(cartWith[0].priceMinor, 149900);

  // Without logo: admin controlled withoutLogoSalePriceMinor
  const cartWithout = addCartVariant([], product, variant, 1, parsedWithout);
  assert.equal(cartWithout[0].priceMinor, 189900);

  // Reconcile cart keeps branding pricing
  const reconciled = reconcileCartItems([...cartWith, ...cartWithout], [{ ...product, variants: [variant] }]);
  assert.equal(reconciled.length, 2);
  assert.equal(reconciled[0].priceMinor, 149900);
  assert.equal(reconciled[1].priceMinor, 189900);

  // Storefront markup & brand labeling contract:
  // 1. Front card displays "YOUR LOGO" text placeholder when customer hasn't uploaded logo
  const appSrc = readFileSync("sites/storefront/app.js", "utf8");
  assert.match(appSrc, /card-logo-placeholder.*YOUR LOGO/s);
  // 2. Back footer brand labeling is hidden when hasOneinfoLogo is false
  assert.match(readFileSync("sites/storefront/card-design.js", "utf8"), /card-back-footer.*custom\.hasOneinfoLogo !== false/s);

  // 3. EPS print generator contract
  const epsSrc = readFileSync("apps/control-center/src/eps-generator.ts", "utf8");
  assert.match(epsSrc, /\(YOUR LOGO\) show/);
  assert.match(epsSrc, /custom\.hasOneinfoLogo !== false[\s\S]*\(ONEINFO\) show[\s\S]*\(By AriseStudio\) show/);
});

test("draggable card elements support rotation interactively, in admin preview, and in EPS vector export", () => {
  const customWithRotation = {
    ...defaultCustomization("01"),
    name: "Avery Morgan",
    elementPositions: {
      logo: { x: 25, y: 20, rotate: 90 },
      sign: { x: 85, y: 18, rotate: 180 },
      name: { x: 30, y: 65, rotate: 45 },
      "divider-0": { x: 50, y: 50, rotate: 270 },
      "back-qr": { x: 50, y: 50, rotate: 90 },
    },
  };

  const parsed = ProductCustomizationSchema.parse(customWithRotation);
  assert.equal(parsed.elementPositions.logo.rotate, 90);
  assert.equal(parsed.elementPositions.sign.rotate, 180);
  assert.equal(parsed.elementPositions.name.rotate, 45);
  assert.equal(parsed.elementPositions["divider-0"].rotate, 270);
  assert.equal(parsed.elementPositions["back-qr"].rotate, 90);

  // Storefront UI contains rotate handles, compact dual bars, and editable inputs
  const appSrc = readFileSync("sites/storefront/app.js", "utf8");
  assert.match(appSrc, /data-rotate-handle/);
  assert.match(appSrc, /data-custom-rot-step/);
  assert.match(appSrc, /data-custom-rot-input/);
  assert.match(appSrc, /data-custom-text-size-input/);
  assert.match(appSrc, /compact-prop-row/);
  assert.match(appSrc, /activeRotateItem/);

  // CSS contains rotation transform, rotate handle styling, and compact property row
  const cssSrc = readFileSync("sites/storefront/home.css", "utf8");
  assert.match(cssSrc, /\.element-rotate-handle/);
  assert.match(cssSrc, /\.compact-prop-row/);
  assert.match(cssSrc, /rotate\(var\(--rot, 0deg\)\)/);

  const sharedSource = readFileSync("sites/storefront/card-design.js", "utf8");
  for (const key of ["logo", "sign", "name", "back-qr"]) {
    const custom = { name: "Rotated card", elementPositions: { [key]: { x: 40, y: 50, rotate: 35 } } };
    assert.match(renderCardDesign(custom, { face: key === "back-qr" ? "back" : "front" }), /--rot:35deg/);
  }
  assert.match(sharedSource, /getElementStyle/);

  // EPS generator contains PostScript rotation transformations
  const epsSrc = readFileSync("apps/control-center/src/eps-generator.ts", "utf8");
  assert.match(epsSrc, /-\$\{logoRot\} rotate/);
  assert.match(epsSrc, /-\$\{signRot\} rotate/);
  assert.match(epsSrc, /-\$\{nameRot\} rotate/);
  assert.match(epsSrc, /-\$\{qrRot\} rotate/);
});

test("customization quick inspector supports font dropdown, bold and italic text styles across storefront, admin and EPS generator", () => {
  // Contract schema supports bold and italic flags
  const parsed = ProductCustomizationSchema.parse({
    presetId: "01",
    name: "Avery Morgan",
    bold: false,
    italic: true,
    elementPositions: {
      name: { x: 45, y: 55, size: 16, font: "serif", bold: true, italic: false },
      title: { x: 45, y: 68, size: 10, font: "mono", bold: false, italic: true },
      "extra-0": { x: 45, y: 78, size: 9, font: "sans", bold: true, italic: true },
    },
  });
  assert.equal(parsed.bold, false);
  assert.equal(parsed.italic, true);
  assert.equal(parsed.elementPositions.name.bold, true);
  assert.equal(parsed.elementPositions.title.italic, true);
  assert.equal(parsed.elementPositions["extra-0"].bold, true);
  assert.equal(parsed.elementPositions["extra-0"].italic, true);

  // Storefront UI contains font dropdown, B/I toggles, and proper event handling
  const appSrc = readFileSync("sites/storefront/app.js", "utf8");
  assert.match(appSrc, /data-custom-font-select/);
  assert.match(appSrc, /data-custom-toggle-style/);
  assert.match(appSrc, /inspector-font-select/);
  assert.match(appSrc, /inspector-style-group/);
  assert.match(appSrc, /inspector-style-btn/);

  // CSS contains styles for font dropdown, B/I buttons, and font weight/style overrides
  const cssSrc = readFileSync("sites/storefront/home.css", "utf8");
  assert.match(cssSrc, /\.inspector-font-select-wrap/);
  assert.match(cssSrc, /\.inspector-style-group/);
  assert.match(cssSrc, /\.inspector-style-btn/);
  assert.match(cssSrc, /\.card-custom-name\.is-not-bold/);
  assert.match(cssSrc, /\.card-custom-name\.is-bold/);
  assert.match(cssSrc, /\.is-italic/);

  assert.deepEqual(
    ["name", "title", "extra-0"].map(key => {
      const { bold, italic, font, size } = getElementStyle(parsed, key);
      return { bold, italic, font, size };
    }),
    [
      { bold: true, italic: false, font: "serif", size: 16 },
      { bold: false, italic: true, font: "mono", size: 10 },
      { bold: true, italic: true, font: "sans", size: 9 },
    ],
  );

  // EPS generator supports PostScript font variants (Bold, Oblique, Italic)
  const epsSrc = readFileSync("apps/control-center/src/eps-generator.ts", "utf8");
  assert.match(epsSrc, /Times-BoldItalic/);
  assert.match(epsSrc, /Helvetica-BoldOblique/);
  assert.match(epsSrc, /Courier-BoldOblique/);
});

test("customizable product in catalog grid shows Limitless color, infinity options icon, and signature card preview", () => {
  const appSrc = readFileSync("sites/storefront/app.js", "utf8");
  assert.match(appSrc, /Colour: <strong>Limitless<\/strong>/);
  assert.match(appSrc, /infinity-option-wrap/);
  assert.match(appSrc, /is-limitless-palette/);
  assert.match(appSrc, /is-limitless-swatch/);
  assert.match(appSrc, /is-catalog-card/);

  const cssSrc = readFileSync("sites/storefront/home.css", "utf8");
  assert.match(cssSrc, /\.infinity-option-wrap/);
  assert.match(cssSrc, /\.is-limitless-palette/);
  assert.match(cssSrc, /\.is-limitless-swatch/);
  assert.match(cssSrc, /\.is-catalog-card/);

  const iconsSrc = readFileSync("sites/storefront/public/assets/icons.svg", "utf8");
  assert.match(iconsSrc, /id="infinity"/);
});

test("admin card preview and storefront accurately reflect exact design, custom element positions, and media URLs", () => {
  const adminSrc = readFileSync("apps/control-center/src/AdminCardPreview.tsx", "utf8");
  assert.match(adminSrc, /renderCardDesign/);
  assert.match(adminSrc, /observeCardDesigns/);
  assert.match(adminSrc, /productMediaUrl\(custom.logoUrl/);

  const ordersSrc = readFileSync("apps/control-center/src/Orders.tsx", "utf8");
  assert.match(ordersSrc, /productMediaUrl\(item\.customization\.logoUrl\)/);

  const apiSrc = readFileSync("apps/control-center/src/api.ts", "utf8");
  assert.match(apiSrc, /export function productMediaUrl/);

  const appSrc = readFileSync("sites/storefront/app.js", "utf8");
  assert.doesNotMatch(appSrc, /\{ x: 50, y: 50/);
  assert.match(appSrc, /renderCardDesign/);
  assert.match(appSrc, /observeCardDesigns/);
  const design = ProductCustomizationSchema.parse({
    name: "Centered card", layout: "column", extraLines: ["", "Second line"],
    elementStyles: { title: { size: 12, italic: true } },
    elementPositions: { name: { x: 0, y: 50, rotate: 35 }, "extra-1": { x: 50, y: 80 }, logo: { rotate: 10 } },
  });
  assert.match(renderCardDesign(design, { face: "front" }), /left:0%; top:50%; --rot:35deg/);
  assert.match(renderCardDesign(design, { face: "front" }), /data-design-element="extra-1"/);
  assert.doesNotMatch(renderCardDesign(design, { face: "front" }), /undefined%/);
  assert.equal(getElementStyle(design, "title").size, 12);
  assert.equal(getElementStyle(design, "title").italic, true);
  assert.match(renderCardDesign({ name: '"><script>evil()</script>' }, { face: "front" }), /&lt;script&gt;/);
  assert.doesNotMatch(renderCardDesign({ name: "Card", accentColor: '#fff"><script>' }, { face: "front" }), /<script>/);

});

test("storefront supports product category filter pills and admin category assignment", () => {
  const indexHtml = readFileSync("sites/storefront/index.html", "utf8");
  assert.match(indexHtml, /class="product-category-filters"/);

  const appSrc = readFileSync("sites/storefront/app.js", "utf8");
  assert.match(appSrc, /function productCategory/);
  assert.match(appSrc, /function renderCategoryFilters/);
  assert.match(appSrc, /category-pill/);

  const homeCss = readFileSync("sites/storefront/home.css", "utf8");
  assert.match(homeCss, /\.product-category-filters/);
  assert.match(homeCss, /\.category-pill/);

  const productsAdminSrc = readFileSync("apps/control-center/src/Products.tsx", "utf8");
  assert.match(productsAdminSrc, /placeholder="e\.g\. Essential, Signature, Metal Card"/);
  assert.match(productsAdminSrc, /catalog-category-pill/);
});

test("stock management and out-of-stock indicators across storefront and admin", () => {
  const appSrc = readFileSync("sites/storefront/app.js", "utf8");
  assert.match(appSrc, /out-of-stock-badge/);
  assert.match(appSrc, /out-of-stock-tag/);
  assert.match(appSrc, /product-stock-notice/);
  assert.match(appSrc, /This card is currently out of stock/);

  const homeCss = readFileSync("sites/storefront/home.css", "utf8");
  assert.match(homeCss, /\.out-of-stock-badge/);
  assert.match(homeCss, /\.out-of-stock-tag/);
  assert.match(homeCss, /\.product-stock-notice/);

  const catalogJs = readFileSync("sites/storefront/catalog.js", "utf8");
  assert.match(catalogJs, /This card is currently out of stock/);

  const iconsSrc = readFileSync("sites/storefront/public/assets/icons.svg", "utf8");
  assert.match(iconsSrc, /id="alert-circle"/);

  const productsAdminSrc = readFileSync("apps/control-center/src/Products.tsx", "utf8");
  assert.match(productsAdminSrc, /is-out-of-stock/);
  assert.match(productsAdminSrc, /Stock quantity \(pcs\)/);
  assert.match(productsAdminSrc, /variant-heading-stock/);
  assert.match(productsAdminSrc, /stock-status-pill/);
});

test("single colour variant omits '1 option' text and places swatch icon on right", () => {
  const appSrc = readFileSync("sites/storefront/app.js", "utf8");
  assert.match(appSrc, /is-single-option-swatch/);
  assert.match(appSrc, /is-single-colour/);
  assert.doesNotMatch(appSrc, /1 option/);

  const homeCss = readFileSync("sites/storefront/home.css", "utf8");
  assert.match(homeCss, /\.is-single-option-swatch/);
});

test("original card design renders flat physical card with centered Oneinfo logo and dynamic admin color", () => {
  const appSrc = readFileSync("sites/storefront/app.js", "utf8");
  assert.match(appSrc, /is-essential-card/);
  assert.match(appSrc, /card-center-logo/);
  assert.doesNotMatch(appSrc, /card-surface-glare/);

  const homeCss = readFileSync("sites/storefront/home.css", "utf8");
  assert.match(homeCss, /\.product-grid \.product-art\s*\{[^}]*background:\s*#ffffff/);
  assert.match(homeCss, /\.product-art \.mini-product-card\.is-essential-card/);
  assert.match(homeCss, /\.mini-product-card\.is-essential-card \.card-center-logo/);
  assert.match(homeCss, /transform:\s*none/);

  const adminSrc = readFileSync("apps/control-center/src/Products.tsx", "utf8");
  assert.doesNotMatch(adminSrc, /card-mini-chip/);
  assert.doesNotMatch(adminSrc, /card-mini-glare/);
  assert.match(adminSrc, /card-mini-center-logo/);
  assert.match(adminSrc, /original-card-art/);
  assert.match(adminSrc, /card-preview-center-logo/);

  const adminCss = readFileSync("apps/control-center/src/styles.css", "utf8");
  assert.match(adminCss, /\.catalog-card-visual\s*\{[^}]*background-color:\s*#ffffff/);
});

test("recover account password screen matches luxury portal auth design and omits back to sign in", () => {
  const accountAccessSrc = readFileSync("apps/control-center/src/AccountAccess.tsx", "utf8");
  assert.match(accountAccessSrc, /card-portal-auth/);
  assert.match(accountAccessSrc, /portal-auth-card/);
  assert.match(accountAccessSrc, /portal-brand-logo-centered/);
  assert.match(accountAccessSrc, /portal-btn-submit/);
  assert.match(accountAccessSrc, /portal-auth-input/);
  assert.match(accountAccessSrc, /Back to card/);
  assert.match(accountAccessSrc, /Powered by AriseStudio/);
  assert.doesNotMatch(accountAccessSrc, /Back to sign in/i);
});

test("customer profile social links omit box background, render authentic brand icons, allow custom website label, and themes are cohesive", () => {
  const profileViewSrc = readFileSync("apps/control-center/src/ProfileView.tsx", "utf8");
  assert.match(profileViewSrc, /websiteLabel = profile\.modeContent\?\.websiteLabel\?\.trim\(\) \|\| "Official Website"/);
  assert.match(profileViewSrc, /#25D366/); // WhatsApp official color
  assert.match(profileViewSrc, /#1877F2/); // Facebook official color
  assert.match(profileViewSrc, /igIconGrad/); // Instagram official gradient
  assert.match(profileViewSrc, /#0A66C2/); // LinkedIn official color
  assert.match(profileViewSrc, /coverWire-/); // Theme-dynamic cover wire
  assert.match(profileViewSrc, /coverShine-/); // Theme-dynamic cover shine

  const cardPortalSrc = readFileSync("apps/control-center/src/CardPortal.tsx", "utf8");
  assert.match(cardPortalSrc, /PRESET_PLATFORMS/);
  assert.match(cardPortalSrc, /Website \/ Other/);

  const stylesCss = readFileSync("apps/control-center/src/styles.css", "utf8");
  assert.match(stylesCss, /\.social-card-icon\s*\{[^}]*background:\s*transparent !important/);
  assert.match(stylesCss, /\.social-card-icon\s*\{[^}]*border:\s*none !important/);
  assert.match(stylesCss, /--profile-accent-gradient/);
  assert.match(stylesCss, /--profile-accent-border/);
  assert.match(stylesCss, /--profile-accent-glow/);
});

test("customer profile simplifies Save Contact button, makes share button compact, filters WhatsApp from social links, and uses authentic official vector SVGs", () => {
  const profileViewSrc = readFileSync("apps/control-center/src/ProfileView.tsx", "utf8");
  // Clean Save Contact text and no subtext
  assert.match(profileViewSrc, /<span className="cta-primary">Save Contact<\/span>/);
  assert.doesNotMatch(profileViewSrc, /Direct download to phone address book/);
  assert.doesNotMatch(profileViewSrc, /Save to Contacts/);

  // WhatsApp excluded from social & web links grid
  assert.match(profileViewSrc, /socialLinks\s*\.filter\(\(link\)\s*=>\s*detectSocialBrand\(link\.url,\s*link\.label\)\.kind\s*!==\s*"whatsapp"\)/);

  // Authentic brand vector paths
  assert.match(profileViewSrc, /M20\.447 20\.452h-3\.554v-5\.569/); // Official LinkedIn path
  assert.match(profileViewSrc, /M12 \.297c-6\.63 0-12 5\.373/); // Official GitHub Octocat path
  assert.match(profileViewSrc, /igIconGrad/); // Official Instagram gradient
  assert.match(profileViewSrc, /rect x="5\.5" y="5\.5"/); // Official Instagram camera rect

  // Compact share button styles
  const stylesCss = readFileSync("apps/control-center/src/styles.css", "utf8");
  assert.match(stylesCss, /\.profile-save-cta-wrapper\s*\{[^}]*display:\s*flex;\s*align-items:\s*center;\s*gap:\s*10px;/);
  assert.match(stylesCss, /flex:\s*0 0 48px !important;\s*width:\s*48px !important;\s*height:\s*48px !important;/);
});

test("quick connect action row uses authentic real SVGs for Call, Email, WhatsApp, and Address label", () => {
  const profileViewSrc = readFileSync("apps/control-center/src/ProfileView.tsx", "utf8");
  // Label updated to Address
  assert.match(profileViewSrc, /<span className="action-text">Address<\/span>/);
  assert.doesNotMatch(profileViewSrc, /<span className="action-text">Map<\/span>/);

  // Real WhatsApp SVG with speech bubble, enlarged handset and balanced size
  assert.match(profileViewSrc, /M380\.9 97\.1C339 55\.1 283\.2 32 223\.9 32/);
  assert.match(profileViewSrc, /scale\(1\.25\)/);

  const stylesCss = readFileSync("apps/control-center/src/styles.css", "utf8");
  assert.match(stylesCss, /\.action-icon\.action-wa svg\s*\{[^}]*width:\s*clamp\(21px,\s*5\.2vw,\s*23px\);/);

  // Real Phone handset SVG
  assert.match(profileViewSrc, /M164\.9 24\.6c-7\.7-18\.6-28-28\.5/);

  // Real Email envelope SVG
  assert.match(profileViewSrc, /M48 64C21\.5 64 0 85\.5 0 112/);

  // Real Address location dot SVG
  assert.match(profileViewSrc, /M215\.7 499\.2C267 435 384 279\.4/);
});

test("exchange contact details card is clean, has modern centered icon, and omits extra subtitle and checkbox", () => {
  const profileViewSrc = readFileSync("apps/control-center/src/ProfileView.tsx", "utf8");
  // Only Exchange Contact Details title remains, subtitle is removed
  assert.match(profileViewSrc, /Exchange Contact Details/);
  assert.doesNotMatch(profileViewSrc, /Send your contact information to this cardholder/);

  // Checkbox text is removed
  assert.doesNotMatch(profileViewSrc, /Share these details with the cardholder so they can follow up/);

  // ContactExchangeIcon uses clean contact card SVG
  assert.match(profileViewSrc, /<rect x="3" y="3" width="18" height="18" rx="4"/);
});

test("profile editor supports WhatsApp number toggle: asks if same as phone, syncs and disables field when same, and enables custom number when toggled off", () => {
  const cardPortalSrc = readFileSync("apps/control-center/src/CardPortal.tsx", "utf8");
  assert.match(cardPortalSrc, /aria-label="Use public phone for WhatsApp"/);
  assert.match(cardPortalSrc, /className="studio-switch"/);
  assert.match(cardPortalSrc, /className="studio-slider round"/);
  assert.match(cardPortalSrc, /isWaSameAsPhone/);
  assert.match(cardPortalSrc, /disabled=\{isWaSameAsPhone\}/);
  assert.match(cardPortalSrc, /WhatsApp number/);
  assert.match(cardPortalSrc, /whatsappSameAsPhone/);

  const profileViewSrc = readFileSync("apps/control-center/src/ProfileView.tsx", "utf8");
  assert.match(profileViewSrc, /profile\.modeContent\?\.whatsappSameAsPhone === false && profile\.modeContent\?\.whatsapp/);
  assert.match(profileViewSrc, /https:\/\/wa\.me\/\${cleanWaPhone}/);

  const stylesCss = readFileSync("apps/control-center/src/styles.css", "utf8");
  assert.match(stylesCss, /\.studio-whatsapp-card/);
  assert.match(stylesCss, /\.studio-switch/);
  assert.match(stylesCss, /\.studio-slider/);
  assert.match(stylesCss, /background-color:\s*#25d366/);
});

test("platform picker removes WhatsApp from presets, uses real SVGs, cleans link formatting, and fixes popover overflow", () => {
  const cardPortalSrc = readFileSync("apps/control-center/src/CardPortal.tsx", "utf8");
  // WhatsApp is omitted from PRESET_PLATFORMS
  assert.doesNotMatch(cardPortalSrc, /\{\s*id:\s*"whatsapp",\s*label:\s*"WhatsApp"/);
  assert.match(cardPortalSrc, /\{\s*id:\s*"facebook",\s*label:\s*"Facebook"/);
  assert.match(cardPortalSrc, /\{\s*id:\s*"instagram",\s*label:\s*"Instagram"/);

  // Link sanitizer strips empty links so safeParse does not throw
  assert.match(cardPortalSrc, /sanitizedLinks/);
  assert.match(cardPortalSrc, /filter\(link => Boolean\(link\.label && link\.url && \/\^https\?:/);

  // Size props are passed to SocialBrandIcon
  assert.match(cardPortalSrc, /SocialBrandIcon kind=\{brand\.kind\} size=\{22\}/);
  assert.match(cardPortalSrc, /SocialBrandIcon kind=\{p\.id\} size=\{20\}/);

  const stylesCss = readFileSync("apps/control-center/src/styles.css", "utf8");
  // Popover uses vertical column layout avoiding clipping
  assert.match(stylesCss, /\.platform-popover-grid\s*\{[^}]*display:\s*flex;\s*flex-direction:\s*column;/);
  assert.match(stylesCss, /\.popover-item-icon svg\s*\{[^}]*width:\s*100% !important;/);
  assert.match(stylesCss, /\.platform-trigger-badge svg\s*\{[^}]*width:\s*100% !important;/);
});

test("profile editor keeps save button floating on screen with glassmorphic sticky dock", () => {
  const cardPortalSrc = readFileSync("apps/control-center/src/CardPortal.tsx", "utf8");
  // Save buttons include SvgCheckIcon and accessible label
  assert.match(cardPortalSrc, /<button type="submit" className="studio-save-button"[^>]*>\s*<SvgCheckIcon size=\{16\} \/>/);

  const stylesCss = readFileSync("apps/control-center/src/styles.css", "utf8");
  // Studio save action is sticky floating at viewport bottom with blur and shadow
  assert.match(stylesCss, /\.studio-save-action\s*\{[^}]*position:\s*sticky;/);
  assert.match(stylesCss, /\.studio-save-action\s*\{[^}]*bottom:\s*max\(16px/);
  assert.match(stylesCss, /\.studio-save-action\s*\{[^}]*backdrop-filter:\s*blur/);
  assert.match(stylesCss, /\.studio-save-action\s*\{[^}]*z-index:\s*95;/);
  assert.match(stylesCss, /\.studio-sticky-preview\s*\{[^}]*position:\s*sticky;\s*top:\s*24px;/);

  // Portal container uses overflow-x: clip so position: sticky is not broken
  assert.match(stylesCss, /\.card-portal\.card-portal-studio\s*\{[^}]*overflow-x:\s*clip;/);
});

test("profile photo editor supports interactive crop, zoom resize, rotation and framing like social media", () => {
  const profilePhotoSrc = readFileSync("apps/control-center/src/ProfilePhoto.tsx", "utf8");
  // Supports PhotoCropperModal with zoom, pan, rotate and canvas export
  assert.match(profilePhotoSrc, /export function PhotoCropperModal/);
  assert.match(profilePhotoSrc, /setZoom/);
  assert.match(profilePhotoSrc, /setPan/);
  assert.match(profilePhotoSrc, /setRotation/);
  assert.match(profilePhotoSrc, /handlePointerDown/);
  assert.match(profilePhotoSrc, /handleWheel/);
  assert.match(profilePhotoSrc, /ctx\.drawImage/);
  assert.match(profilePhotoSrc, /photo-btn-adjust/);

  const stylesCss = readFileSync("apps/control-center/src/styles.css", "utf8");
  // Includes FB-style circular aperture mask, viewport, slider and controls
  assert.match(stylesCss, /\.photo-crop-backdrop/);
  assert.match(stylesCss, /\.photo-crop-modal/);
  assert.match(stylesCss, /\.photo-crop-mask-circle/);
  assert.match(stylesCss, /\.photo-crop-range/);
  assert.match(stylesCss, /\.photo-btn-adjust/);
});

test("profile editor supports compact tabs, inline WhatsApp toggle next to phone label, and dedicated Map / Address field", () => {
  const cardPortalSrc = readFileSync("apps/control-center/src/CardPortal.tsx", "utf8");
  assert.match(cardPortalSrc, /className="studio-inline-wa-toggle"/);
  assert.match(cardPortalSrc, /Same as phone/);
  assert.match(cardPortalSrc, /Address or map link/);
  assert.match(cardPortalSrc, /Street address or Google Maps URL/);
  assert.match(cardPortalSrc, /studio-tab-preview-only/);
  assert.match(cardPortalSrc, /isWaSameAsPhone \? profile\.phone/);

  const profileViewSrc = readFileSync("apps/control-center/src/ProfileView.tsx", "utf8");
  assert.match(profileViewSrc, /profile\.modeContent\?\.mapUrl\?\.trim\(\)\s*\|\|\s*profile\.modeContent\?\.address\?\.trim\(\)/);

  const stylesCss = readFileSync("apps/control-center/src/styles.css", "utf8");
  assert.match(stylesCss, /\.studio-inline-wa-toggle/);
  assert.match(stylesCss, /\.studio-field-label-row/);
  assert.match(stylesCss, /\.studio-mobile-tabs\s*\{[^}]*max-width:\s*440px/);
  assert.match(stylesCss, /\.studio-form-grid input\.is-synced-disabled/);
});

test("social links editor uses a desktop table and compact mobile rows", () => {
  const cardPortalSrc = readFileSync("apps/control-center/src/CardPortal.tsx", "utf8");
  assert.match(cardPortalSrc, /studio-link-single-row/);
  assert.match(cardPortalSrc, /studio-links-table-header/);
  assert.match(cardPortalSrc, /studio-link-label-col/);
  assert.match(cardPortalSrc, /studio-link-url-col/);
  assert.match(cardPortalSrc, /studio-card-legend/);
  assert.match(cardPortalSrc, /studio-legend-icon/);
  assert.match(cardPortalSrc, /SvgGlobeIcon/);
  assert.match(cardPortalSrc, /SvgUserIcon/);
  assert.match(cardPortalSrc, /studio-mobile-field-tag/);
  assert.match(cardPortalSrc, /htmlFor="studio-field-phone"/);

  const stylesCss = readFileSync("apps/control-center/src/styles.css", "utf8");
  assert.match(stylesCss, /\.studio-links-table-header\s*\{[^}]*grid-template-columns/);
  assert.match(stylesCss, /\.studio-link-item\s*\{[^}]*grid-template-columns:\s*minmax\(125px/);
  assert.match(stylesCss, /\.studio-card-legend/);
  assert.match(stylesCss, /\.studio-legend-icon/);
  assert.match(stylesCss, /\.studio-field-label-row\s*\{[^}]*min-height:\s*26px/);
  assert.match(stylesCss, /\.studio-link-item \.studio-btn-remove\s*\{[^}]*width:\s*38px/);
  assert.match(stylesCss, /\.studio-link-item\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*[\d.]+fr\)\s+minmax\(0,\s*[\d.]+fr\)\s+44px/);
  assert.match(stylesCss, /\.studio-link-label-col\s*\{\s*grid-column:\s*span 2/);
  assert.match(stylesCss, /\.studio-link-url-col\s*\{\s*grid-column:\s*span 2/);
});

test("profile saves paragraph breaks and saved website display order", () => {
  const profile = { displayName: "Example Owner", website: "https://example.com" };
  const bio = "First paragraph.\n\n" + "Additional profile details. ".repeat(25).trimEnd();
  const saved = CustomerProfileSchema.parse({ ...profile, bio, modeContent: { websiteSortOrder: 12 } });
  assert.equal(saved.bio, bio);
  assert.equal(saved.modeContent.websiteSortOrder, 12);
  assert.equal(CustomerProfileSchema.parse(profile).modeContent.websiteSortOrder, undefined);
  assert.equal(CustomerProfileSchema.safeParse({ ...saved, bio: "x".repeat(PROFILE_BIO_MAX_LENGTH + 1) }).success, false);
  assert.equal(CustomerProfileSchema.safeParse({ ...saved, modeContent: { websiteSortOrder: 13 } }).success, false);
});

test("profile preserves typed About text and keeps optional section headings", () => {
  const bio = "  First line\n\nIndented  words\n";
  const body = "  Line one\n\nLine  two\n";
  const saved = CustomerProfileSchema.parse({
    displayName: "Example Owner",
    bio,
    modeContent: {
      aboutSections: [
        { heading: "  Research interests  ", body },
        { body: "Section without a heading" },
        { heading: " ", body: "\n  " },
      ],
    },
  });
  assert.equal(saved.bio, bio);
  assert.deepEqual(saved.modeContent.aboutSections, [
    { heading: "Research interests", body },
    { heading: "", body: "Section without a heading" },
  ]);
  assert.equal(CustomerProfileSchema.parse({ displayName: "Existing Owner", bio }).modeContent.aboutSections, undefined);
});

test("profile photo expands in lightbox on click and editor supports custom cover photo", () => {
  // Schema validates modeContent.coverUrl
  const valid = CustomerProfileSchema.parse({
    displayName: "Cover Owner",
    modeContent: { coverUrl: "https://example.com/cover.jpg" },
  });
  assert.equal(valid.modeContent?.coverUrl, "https://example.com/cover.jpg");
  assert.equal(CustomerProfileSchema.safeParse({ displayName: "Cover Owner", modeContent: { coverUrl: "invalid-url" } }).success, false);

  // ProfileView supports lightbox for avatar & cover, and custom cover rendering
  const profileViewSrc = readFileSync("apps/control-center/src/ProfileView.tsx", "utf8");
  assert.match(profileViewSrc, /profile-lightbox-overlay/);
  assert.match(profileViewSrc, /profile-lightbox-close/);
  assert.match(profileViewSrc, /cover-custom-image/);
  assert.match(profileViewSrc, /is-clickable/);

  // CardPortal includes CoverPhotoEditor
  const cardPortalSrc = readFileSync("apps/control-center/src/CardPortal.tsx", "utf8");
  assert.match(cardPortalSrc, /CoverPhotoEditor/);
  assert.match(cardPortalSrc, /coverUrl/);

  // CoverPhotoEditor exists and has upload/remove controls
  const coverEditorSrc = readFileSync("apps/control-center/src/CoverPhotoEditor.tsx", "utf8");
  assert.match(coverEditorSrc, /export function CoverPhotoEditor/);
  assert.match(coverEditorSrc, /handleFileChange/);
  assert.match(coverEditorSrc, /handleRemove/);
});

test("account security card has luxury UI, omits native accordion details, and supports password visibility toggles", () => {
  const accountAccessSrc = readFileSync("apps/control-center/src/AccountAccess.tsx", "utf8");
  assert.doesNotMatch(accountAccessSrc, /<details><summary>Account security/);
  assert.match(accountAccessSrc, /account-security-settings/);
  assert.match(accountAccessSrc, /security-status-block/);
  assert.match(accountAccessSrc, /security-pill is-verified/);
  assert.match(accountAccessSrc, /security-pill is-unverified/);
  assert.match(accountAccessSrc, /security-toggle-eye/);
  assert.match(accountAccessSrc, /showCurrentPassword/);
  assert.match(accountAccessSrc, /showNewPassword/);
  assert.match(accountAccessSrc, /security-submit-btn/);

  const stylesCss = readFileSync("apps/control-center/src/styles.css", "utf8");
  assert.match(stylesCss, /\.account-security-settings\s*\{/);
  assert.match(stylesCss, /\.security-status-block\s*\{/);
  assert.match(stylesCss, /\.security-pill\.is-verified\s*\{/);
  assert.match(stylesCss, /\.security-submit-btn\s*\{/);
  assert.match(stylesCss, /\.security-fields-grid\s*\{/);
});

test("profile themes include Royal Sapphire and Titanium Noir with clean isolated studio cards and high contrast text", () => {
  // Contracts validation includes new professional themes
  assert.equal(CustomerProfileSchema.parse({ displayName: "Sapphire Lead", theme: "SAPPHIRE" }).theme, "SAPPHIRE");
  assert.equal(CustomerProfileSchema.parse({ displayName: "Titanium Lead", theme: "TITANIUM" }).theme, "TITANIUM");

  // CardPortal renders all 5 themes with dedicated banners and accessible select
  const cardPortalSrc = readFileSync("apps/control-center/src/CardPortal.tsx", "utf8");
  assert.match(cardPortalSrc, /Royal Sapphire/);
  assert.match(cardPortalSrc, /Titanium Noir/);
  assert.match(cardPortalSrc, /SAPPHIRE/);
  assert.match(cardPortalSrc, /TITANIUM/);
  assert.match(cardPortalSrc, /theme-banner-\$\{theme\.id\.toLowerCase\(\)\}/);

  // ProfileView supports dynamic wire styling for both new themes
  const profileViewSrc = readFileSync("apps/control-center/src/ProfileView.tsx", "utf8");
  assert.match(profileViewSrc, /themeUpper === "SAPPHIRE"/);
  assert.match(profileViewSrc, /themeUpper === "TITANIUM"/);

  // Stylesheet includes scoped variables and isolated tile covers without leaky rules
  const stylesCss = readFileSync("apps/control-center/src/styles.css", "utf8");
  assert.match(stylesCss, /\.profile-page\.theme-sapphire\s*\{/);
  assert.match(stylesCss, /\.profile-page\.theme-titanium\s*\{/);
  assert.match(stylesCss, /\.theme-banner-sapphire\s*\{/);
  assert.match(stylesCss, /\.theme-banner-titanium\s*\{/);
  assert.match(stylesCss, /\.tile-cover\.theme-ivory\s*\{/);
  assert.doesNotMatch(stylesCss, /^\.theme-ivory\s*\{[^}]*!important/m);
});

test("shared contacts and profile analytics have luxury UI, contact cards, quick connect pills, and mobile optimization", () => {
  const cardPortalSrc = readFileSync("apps/control-center/src/CardPortal.tsx", "utf8");
  // Check contact card components & helpers
  assert.match(cardPortalSrc, /lead-contact-card/);
  assert.match(cardPortalSrc, /lead-contact-avatar/);
  assert.match(cardPortalSrc, /lead-channels-row/);
  assert.match(cardPortalSrc, /lead-channel-pill/);
  assert.match(cardPortalSrc, /lead-channel-whatsapp/);
  assert.match(cardPortalSrc, /lead-whatsapp-icon-btn/);
  assert.match(cardPortalSrc, /lead-contact-pills/);
  assert.match(cardPortalSrc, /lead-meta-row/);
  assert.match(cardPortalSrc, /lead-btn-delete/);
  assert.match(cardPortalSrc, /contacts-sub-nav/);
  assert.match(cardPortalSrc, /contacts-sub-tab-btn/);
  assert.match(cardPortalSrc, /analytics-stat-grid/);
  assert.match(cardPortalSrc, /analytics-stat-tile/);
  assert.match(cardPortalSrc, /analytics-stat-row/);
  assert.match(cardPortalSrc, /analytics-stat-source-badge/);
  assert.match(cardPortalSrc, /analytics-controls-row/);
  assert.match(cardPortalSrc, /analytics-select-box/);
  // Redundant "Shared via" text removed as requested for professional luxury look
  assert.doesNotMatch(cardPortalSrc, /Shared via /);
  // Quick link chips removed as requested
  assert.doesNotMatch(cardPortalSrc, /analytics-quick-links-row/);

  // Check customer contact lead deletion endpoint in API
  const customerRoutesSrc = readFileSync("apps/api/src/routes/customers.ts", "utf8");
  assert.match(customerRoutesSrc, /app\.delete\("\/me\/contact-leads\/:id"/);

  // Check CSS styles for shared contacts & profile analytics
  const stylesCss = readFileSync("apps/control-center/src/styles.css", "utf8");
  assert.match(stylesCss, /\.contacts-sub-nav\s*\{/);
  assert.match(stylesCss, /\.contacts-sub-tab-btn\s*\{/);
  assert.match(stylesCss, /\.lead-contact-card\s*\{/);
  assert.match(stylesCss, /\.lead-channels-row\s*\{/);
  assert.match(stylesCss, /\.lead-channel-pill\s*\{/);
  assert.match(stylesCss, /\.lead-whatsapp-icon-btn\s*\{/);
  assert.match(stylesCss, /\.lead-btn-delete\s*\{/);
  assert.match(stylesCss, /\.analytics-stat-grid\s*\{/);
  assert.match(stylesCss, /\.analytics-stat-tile\s*\{/);
  assert.match(stylesCss, /\.analytics-controls-row\s*\{/);
  assert.match(stylesCss, /\.analytics-select-box\s*\{/);
  assert.match(stylesCss, /\.analytics-stat-source-badge\s*\{/);
});

test("storefront checkout payment section directly displays payment instructions, copyable wallet number, COD advance, and responsive luxury UI", () => {
  const indexHtml = readFileSync("sites/storefront/index.html", "utf8");
  const appJs = readFileSync("sites/storefront/app.js", "utf8");
  const stylesCss = readFileSync("sites/storefront/styles.css", "utf8");

  // Payment options structure & badges
  assert.match(indexHtml, /class="order-payment-options"/);
  assert.match(indexHtml, /class="order-payment-guide"/);
  assert.match(indexHtml, /class="order-payment-wallet-box"/);
  assert.match(indexHtml, /data-wallet="bkash"/);
  assert.match(indexHtml, /data-wallet="rocket"/);
  assert.match(indexHtml, /class="order-payment-copy-btn"/);
  assert.match(indexHtml, /class="order-payment-inputs-grid"/);
  assert.match(indexHtml, /order-payment-cod-mark/);

  // app.js handles direct payment guide, COD advance requirement, copy button, and seamless reservation on submit
  assert.match(appJs, /order-payment-guide-title/);
  assert.match(appJs, /order-payment-wallet-number/);
  assert.match(appJs, /order-wallet-num-bkash/);
  assert.match(appJs, /order-wallet-num-rocket/);
  assert.match(appJs, /order-payment-copy-btn/);
  assert.match(appJs, /advance required/);
  assert.match(appJs, /transactionField\.value\.toUpperCase\(\)/);

  // Responsive styling
  assert.match(stylesCss, /\.order-payment-options\s*\{[^}]*grid-template-columns:\s*repeat\(3/);
  assert.match(stylesCss, /@media\s*\(max-width:\s*640px\)\s*\{[^}]*\.order-payment-options/);
  assert.match(stylesCss, /\.order-payment-guide\s*\{/);
  assert.match(stylesCss, /\.order-payment-copy-btn\s*\{/);
});
