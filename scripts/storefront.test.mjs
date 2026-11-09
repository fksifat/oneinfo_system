import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { initializeNfcDeck } from "../sites/storefront/nfc-deck.mjs";
import { initializeHero3D, initializeCardPreviews } from "../sites/storefront/hero-3d.mjs";

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
