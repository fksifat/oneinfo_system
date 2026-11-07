import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { initializeNfcDeck } from "../sites/storefront/nfc-deck.mjs";
import { initializeHero3D } from "../sites/storefront/hero-3d.mjs";

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
  const modes = ["tap", "scan", "link"];
  const buttons = modes.map(mode => ({
    dataset: { deckMode: mode },
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { assert.equal(name, "click"); this.click = handler; },
  }));
  const panels = modes.map(mode => ({ dataset: { deckPanel: mode }, hidden: mode !== "tap" }));
  const root = { dataset: { mode: "tap" }, querySelectorAll: selector => selector === "[data-deck-mode]" ? buttons : panels };
  initializeNfcDeck(root);
  for (const mode of ["scan", "link", "tap"]) {
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

test("hero 3D stage toggles card variants and orbit orientation", () => {
  const viewer = { src: "/assets/cards-final/black.glb", cameraOrbit: "25deg 75deg 105%" };
  const title = { textContent: "" };
  const desc = { textContent: "" };
  const flipBtn = { addEventListener(evt, handler) { this.click = handler; } };
  const buttons = ["black", "light"].map(variant => ({
    dataset: { cardVariant: variant },
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { this.click = handler; },
  }));

  const root = {
    dataset: {},
    querySelector(selector) {
      if (selector === "#hero-model-viewer") return viewer;
      if (selector === "#hero-card-title") return title;
      if (selector === "#hero-card-desc") return desc;
      if (selector === "#hero-flip-btn") return flipBtn;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-card-variant]") return buttons;
      return [];
    },
  };

  initializeHero3D(root);
  buttons[1].click(); // switch to light
  assert.equal(root.dataset.heroActive, "light");
  assert.equal(viewer.src, "/assets/cards-final/light.glb");
  assert.equal(title.textContent, "Minimalist Light Card");
  assert.equal(buttons[1].attributes["aria-pressed"], "true");

  flipBtn.click(); // flip to inspect back
  assert.equal(viewer.cameraOrbit, "205deg 75deg 105%");
  flipBtn.click(); // flip back
  assert.equal(viewer.cameraOrbit, "25deg 75deg 105%");
});
