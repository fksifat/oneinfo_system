import { variantPrice, variantPriceForBranding, variantRegularPriceForBranding, discountPercent, productMedia, productGallery, resolveProductImageUrl, resolveProductModelUrl, checkoutDeliveryZone, shippingZoneLabels, ShippingRatesSchema, CouponCodeSchema, couponDiscount, PostalCodeSchema, CodAdvanceSchema, defaultCodAdvanceTaka, PaymentMethodSchema, BkashTransactionIdSchema, paymentDueNow } from "@oneinfo/contracts";
import { addCartVariant, reconcileCartItems, productRoute, PREMIUM_PRESETS, SURFACE_COLORS, ACCENT_COLORS, isColorLight, defaultCustomization, renderSurfaceMotifSvg, renderBackMotifSvg, renderQrSvg, renderAriseLogoSvg } from "./catalog.js";
import { initializeNfcDeck } from "./nfc-deck.mjs";
import { initializeHero3D, initializeCardPreviews } from "./hero-3d.mjs";
import logoUrl from "./assets/oneinfo-logo.svg";
import ariseLogoUrl from "./assets/arise-studio-logo.png";
import { invoiceMarkup } from "./invoice.ts";
import "./invoice.css";

(function () {
  "use strict";

  initializeNfcDeck(document.querySelector(".nfc-deck"));
  initializeHero3D(document.querySelector("#hero-3d"));
  initializeCardPreviews(document.querySelector(".card-showcase"));

  const icon = name => `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="/assets/icons.svg#${name}"></use></svg>`;
  const money = new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT", currencyDisplay: "narrowSymbol", minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const storageKey = "oneinfo.storefront.cart";
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001";
  function driveVideoPreview(url) {
    const match = /^https:\/\/drive\.google\.com\/file\/d\/([\w-]+)(?:\/(?:view|preview))?\/?(?:[?#]|$)/.exec(url);
    if (!match) return null;
    const preview = new URL(`https://drive.google.com/file/d/${match[1]}/preview`);
    const resourceKey = new URL(url).searchParams.get("resourcekey");
    if (resourceKey) preview.searchParams.set("resourcekey", resourceKey);
    return preview.href;
  }
  const mediaUrl = path => path.startsWith("/api/v1/product-media/") ? new URL(path, apiUrl).href : path;
  const imageSource = path => mediaUrl(resolveProductImageUrl(path));
  const modelSource = path => mediaUrl(resolveProductModelUrl(path));
  function variantCover(variant) {
    const cover = productMedia(variant).find(m => (m.type === "image" && m.url) || (m.type === "video" && m.poster));
    return cover?.type === "image" ? cover.url : cover?.poster;
  }
  let products = [];
  const selectedVariants = new Map();
  const selectedMedia = new Map();
  const selectedModels = new Map();
  const productCustomizations = new Map();
  let activeStudioTab = "details";
  let selectedElementId = "name";
  const quantities = new Map();
  let addingToCart = false;
  let catalogReady = false;
  let catalogFailed = false;
  let catalogRequest = null;
  const draftKey = "oneinfo.storefront.orderDraft";
  const teamDraftKey = "oneinfo.storefront.teamDraft";
  let cart = load(storageKey, []);
  if (!Array.isArray(cart)) cart = [];
  cart = cart.filter(item => item && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 99);
  let lastFocused = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function load(key, fallback, session = false) {
    try {
      const value = JSON.parse((session ? sessionStorage : localStorage).getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function toast(message) {
    const element = $(".toast");
    element.textContent = message;
    element.classList.add("show");
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => element.classList.remove("show"), 2200);
  }

  function updateBodyLock() {
    const anyOpen = $(".cart-drawer.open, .modal.open");
    document.body.classList.toggle("no-scroll", Boolean(anyOpen));
  }

  function openCart() {
    lastFocused = document.activeElement;
    const drawer = $("#cart-drawer");
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    $(".cart-trigger").setAttribute("aria-expanded", "true");
    updateBodyLock();
    window.setTimeout(() => $(".cart-close").focus(), 80);
  }

  function closeCart() {
    const drawer = $("#cart-drawer");
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    $(".cart-trigger").setAttribute("aria-expanded", "false");
    updateBodyLock();
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
  }

  function openModal(id) {
    lastFocused = document.activeElement;
    const modal = $(`#${id}`);
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    updateBodyLock();
    window.setTimeout(() => $(".modal-close", modal)?.focus(), 80);
  }

  function closeModal(modal) {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    updateBodyLock();
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
  }

  function renderCart() {
    $(".checkout-trigger").disabled = !catalogReady || !cart.length;
    const count = cart.reduce((total, item) => total + item.quantity, 0);
    const total = cart.reduce((sum, item) => sum + item.priceMinor * item.quantity / 100, 0);
    const countElement = $(".cart-count");
    countElement.textContent = String(count);
    countElement.setAttribute("aria-label", `${count} ${count === 1 ? "item" : "items"}`);

    const items = $(".cart-items");
    items.hidden = count === 0;
    $(".cart-item-count").textContent = `${count} ${count === 1 ? "card" : "cards"}`;
    renderCartItems(items, true);

    $(".cart-empty").hidden = cart.length > 0;
    $(".cart-summary").hidden = cart.length === 0;
    $(".cart-total").textContent = money.format(total);
    if (location.hash === "#order-draft") renderOrder();

    $$(".remove-item", items).forEach((button) => {
      button.addEventListener("click", () => {
        const itemElement = button.closest(".cart-item");
        const id = itemElement?.dataset.id;
        const variantId = itemElement?.dataset.variantId;
        const customKey = itemElement?.dataset.customKey || "";
        cart = cart.filter((item) => !(item.id === id && item.variantId === variantId && (item.customization ? JSON.stringify(item.customization) : "") === customKey));
        save(storageKey, cart);
        renderCart();
        toast("Removed from cart");
      });
    });
  }

  function renderCartItems(items, removable = false) {
    items.innerHTML = cart.map(item => {
      const variant = products.find(p => p.id === item.id)?.variants.find(v => v.id === item.variantId);
      const cover = variant && variantCover(variant);
      const customKey = item.customization ? JSON.stringify(item.customization) : "";
      return `
          <div class="cart-item" data-id="${escapeHtml(item.id)}" data-variant-id="${escapeHtml(item.variantId)}" data-custom-key="${escapeHtml(customKey)}">
            <div class="cart-item-art" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18m-14 5h4"/></svg>
              ${cover ? `<img src="${escapeHtml(imageSource(cover))}" alt="" referrerpolicy="no-referrer">` : ""}
            </div>
            <div class="cart-item-info">
              <strong>${escapeHtml(item.name)}</strong>
              <span>${escapeHtml(item.variantName)}</span>
              ${item.customization ? `<span class="cart-custom-badge">Custom: <strong>${escapeHtml(item.customization.name)}</strong>${item.customization.title ? ` · ${escapeHtml(item.customization.title)}` : ""}${item.customization.extraLines && item.customization.extraLines.length ? ` · ${item.customization.extraLines.map(l => escapeHtml(l)).join(" · ")}` : ""}${item.customization.textSize && item.customization.textSize !== 14 ? ` (${item.customization.textSize}pt)` : ""}${item.customization.logoUrl ? ` · <span class="cart-custom-logo-tag">Logo attached</span>` : ""}<small style="display:block; opacity:0.85; margin-top:2px; font-weight:500;">${escapeHtml(String(item.customization.layout || item.customization.position || "left").replace("-", " "))} · ${escapeHtml(item.customization.surfaceMotif || "facets")} · ${escapeHtml(item.customization.font || "sans")}${item.customization.companyName ? ` · ${escapeHtml(item.customization.companyName)}` : ""}<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${escapeHtml(item.customization.surfaceColor || '#0a0b0d')}; vertical-align:middle; margin:0 2px 0 4px; border:1px solid #777;"></span><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${escapeHtml(item.customization.accentColor || '#d8b26e')}; vertical-align:middle; border:1px solid #777;"></span></small></span>` : ""}
              <span>Qty ${item.quantity}</span>
            </div>
            <div class="cart-item-actions">
              ${removable ? `<button class="remove-item" type="button" aria-label="Remove ${escapeHtml(item.name)} ${escapeHtml(item.variantName)}">${icon("close")}</button>` : ""}
              <strong>${money.format(item.priceMinor * item.quantity / 100)}</strong>
            </div>
          </div>`;
    }).join("");
    $$(".cart-item-art img", items).forEach(img => {
      if (img.complete && img.naturalWidth === 0) img.remove();
      else img.addEventListener("error", () => img.remove(), { once:true });
    });

  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function reconcileCart() {
    const before = JSON.stringify(cart);
    cart = reconcileCartItems(cart, products);
    save(storageKey, cart);
    renderCart();
    if (before !== JSON.stringify(cart)) toast("Cart updated to the latest products and prices");
  }

  function renderProducts() {
    const focused = document.activeElement;
    const focusedProduct = focused?.closest(".product-grid .product")?.dataset.id;
    const focusedVariant = focused?.dataset.variant;
    const focusedLink = focused?.classList.contains("product-link");
    $(".product-grid").innerHTML = products.map(p => productMarkup(p)).join("");
    renderRoute();
    if (focusedProduct) {
      const card = $$(".product-grid .product").find(el => el.dataset.id === focusedProduct);
      const target = !card ? null : focusedVariant ? $$(".colour-swatch", card).find(el => el.dataset.variant === focusedVariant) : focusedLink ? $(".product-link", card) : null;
      target?.focus({ preventScroll: true });
    }
    watchImages();
  }

  function watchImages() {
    $$(".catalog-image, .gallery-item img").forEach(img => {
      const handleError = () => {
        if (img.closest(".gallery-item")) {
          const fallback = document.createElement("span");
          fallback.textContent = "Unavailable";
          fallback.setAttribute("aria-hidden", "true");
          img.replaceWith(fallback);
          return;
        }
        const art = img.closest(".product-art");
        art?.classList.remove("has-image");
        const error = art?.querySelector(".gallery-error");
        if (error) error.hidden = false;
        img.remove();
      };
      if (img.complete && img.naturalWidth === 0) handleError();
      else img.addEventListener("error", handleError, { once:true });
    });
  }

  function getElementStyle(custom, elKey) {
    if (!custom) return { font: "sans", size: 14, rotate: 0, bold: false, italic: false };
    const ep = custom.elementPositions || {};
    const pos = ep[elKey] || (elKey === "name" ? custom.customPos : null) || {};
    const defaultTextSize = custom.textSize || 14;
    let size = pos.size;
    let font = pos.font || custom.font || "sans";
    let rotate = Number(pos.rotate !== undefined ? pos.rotate : (elKey === "name" ? (custom.customPos?.rotate || 0) : 0)) || 0;
    let bold = pos.bold !== undefined ? Boolean(pos.bold) : (elKey === "name" ? (custom.bold !== undefined ? custom.bold : true) : Boolean(custom.bold));
    let italic = pos.italic !== undefined ? Boolean(pos.italic) : Boolean(custom.italic);

    if (size === undefined || size === null) {
      if (elKey === "name") size = defaultTextSize;
      else if (elKey === "title") size = Math.max(8, Math.round(defaultTextSize * 0.75));
      else if (elKey.startsWith("extra-")) size = Math.max(8, Math.round(defaultTextSize * 0.75));
      else if (elKey === "logo") size = custom.logoSize || 100;
      else if (elKey === "sign") size = custom.iconSize || 100;
      else if (elKey === "back-qr") size = custom.qrSize || 100;
      else size = 100;
    }

    return { font, size: Number(size), rotate, bold, italic, x: pos.x, y: pos.y };
  }

  function renderQuickInspectorMarkup(productId) {
    const custom = productCustomizations.get(productId) ?? defaultCustomization("01");
    const elKey = selectedElementId;
    if (!elKey) {
      return `
        <div class="card-quick-inspector is-idle" data-product-id="${escapeHtml(productId)}">
          <span class="quick-inspector-hint">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 15l6 6m-11-4a7 7 0 110-14 7 7 0 010 14z"/></svg>
            Click any element on the card to adjust size, font & angle
          </span>
        </div>
      `;
    }

    const st = getElementStyle(custom, elKey);
    let title = "Name";
    let isText = false;
    let isLogo = false;
    let isSign = false;
    let isDivider = false;
    let isQr = false;
    let dividerIdx = 0;

    if (elKey === "name") {
      title = "Name";
      isText = true;
    } else if (elKey === "title") {
      title = "Title";
      isText = true;
    } else if (elKey.startsWith("extra-")) {
      dividerIdx = parseInt(elKey.replace("extra-", ""), 10);
      title = `Line ${dividerIdx + 3}`;
      isText = true;
    } else if (elKey === "logo") {
      title = "Logo";
      isLogo = true;
    } else if (elKey === "sign") {
      title = "NFC Wave";
      isSign = true;
    } else if (elKey.startsWith("divider-")) {
      dividerIdx = parseInt(elKey.replace("divider-", ""), 10);
      title = `Line ${dividerIdx + 1}`;
      isDivider = true;
    } else if (elKey === "back-qr") {
      title = "QR Code";
      isQr = true;
    }

    return `
      <div class="card-quick-inspector is-active compact-prop-row" data-inspector-element="${escapeHtml(elKey)}" data-product-id="${escapeHtml(productId)}">
        <div class="inspector-badge">
          <span class="inspector-badge-dot"></span>
          <strong>${escapeHtml(title)}</strong>
        </div>

        <div class="inspector-divider"></div>

        ${isText ? `
          <div class="inspector-font-select-wrap">
            <select class="inspector-font-select" data-custom-font-select="${escapeHtml(elKey)}" aria-label="Font family">
              <option value="sans" ${st.font === "sans" ? "selected" : ""}>Sans</option>
              <option value="serif" ${st.font === "serif" ? "selected" : ""}>Serif</option>
              <option value="mono" ${st.font === "mono" ? "selected" : ""}>Mono</option>
            </select>
            <svg class="select-chevron" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
          </div>

          <div class="inspector-style-group" role="group" aria-label="Text formatting">
            <button type="button" class="inspector-style-btn ${st.bold ? 'is-active' : ''}" data-custom-toggle-style="bold" data-target-element="${escapeHtml(elKey)}" title="Bold" aria-pressed="${st.bold ? 'true' : 'false'}">B</button>
            <button type="button" class="inspector-style-btn ${st.italic ? 'is-active' : ''}" data-custom-toggle-style="italic" data-target-element="${escapeHtml(elKey)}" title="Italic" aria-pressed="${st.italic ? 'true' : 'false'}"><em>I</em></button>
          </div>

          <div class="inspector-divider"></div>

          <div class="font-size-stepper" role="group" aria-label="Font size">
            <button type="button" class="size-step-btn" data-custom-element-size-step="-1" data-target-element="${escapeHtml(elKey)}" title="Smaller text">A-</button>
            <div class="rot-input-wrap">
              <input type="number" class="rot-input-field" data-custom-element-size-input="${escapeHtml(elKey)}" data-custom-text-size-input value="${st.size}" min="7" max="32" step="1" aria-label="Font size" />
              <span class="rot-input-unit">pt</span>
            </div>
            <button type="button" class="size-step-btn" data-custom-element-size-step="1" data-target-element="${escapeHtml(elKey)}" title="Larger text">A+</button>
          </div>
        ` : ""}

        ${isLogo ? `
          <div class="font-size-stepper" role="group" aria-label="Logo size">
            <button type="button" class="size-step-btn" data-custom-element-size-step="-10" data-target-element="logo" title="Smaller logo">-</button>
            <div class="rot-input-wrap">
              <input type="number" class="rot-input-field" data-custom-element-size-input="logo" value="${st.size}" min="30" max="250" step="5" aria-label="Logo size" />
              <span class="rot-input-unit">%</span>
            </div>
            <button type="button" class="size-step-btn" data-custom-element-size-step="10" data-target-element="logo" title="Larger logo">+</button>
          </div>
        ` : ""}

        ${isSign ? `
          <div class="font-size-stepper" role="group" aria-label="Icon size">
            <button type="button" class="size-step-btn" data-custom-element-size-step="-10" data-target-element="sign" title="Smaller icon">-</button>
            <div class="rot-input-wrap">
              <input type="number" class="rot-input-field" data-custom-element-size-input="sign" value="${st.size}" min="30" max="250" step="5" aria-label="Icon size" />
              <span class="rot-input-unit">%</span>
            </div>
            <button type="button" class="size-step-btn" data-custom-element-size-step="10" data-target-element="sign" title="Larger icon">+</button>
          </div>
        ` : ""}

        ${isDivider ? `
          <div class="inspector-group">
            <button type="button" class="inspector-btn ${custom.dividerLines?.[dividerIdx]?.style === 'dashed' ? 'is-active' : ''}" data-custom-action="toggle-divider-style" data-divider-index="${dividerIdx}">${custom.dividerLines?.[dividerIdx]?.style === 'dashed' ? 'Dashed' : 'Solid'}</button>
            <button type="button" class="inspector-btn" data-custom-action="toggle-divider-orient" data-divider-index="${dividerIdx}">${custom.dividerLines?.[dividerIdx]?.orientation === 'vertical' ? 'Vertical' : 'Horizontal'}</button>
          </div>

          <div class="inspector-divider"></div>

          <div class="font-size-stepper" title="Line length">
            <button type="button" class="size-step-btn" data-custom-action="step-divider-len" data-divider-index="${dividerIdx}" data-step="-20" title="Shorter line">-</button>
            <span class="size-display-val" style="min-width:38px;font-size:0.75rem;">${custom.dividerLines?.[dividerIdx]?.length || (custom.dividerLines?.[dividerIdx]?.orientation === 'vertical' ? 60 : 100)}px</span>
            <button type="button" class="size-step-btn" data-custom-action="step-divider-len" data-divider-index="${dividerIdx}" data-step="20" title="Longer line">+</button>
          </div>
        ` : ""}

        ${isQr ? `
          <div class="inspector-group">
            <button type="button" class="inspector-btn ${custom.backQrStyle === 'minimal' ? 'is-active' : ''}" data-custom-set="backQrStyle" data-value="minimal">Clean</button>
            <button type="button" class="inspector-btn ${custom.backQrStyle === 'framed' ? 'is-active' : ''}" data-custom-set="backQrStyle" data-value="framed">Framed</button>
            <button type="button" class="inspector-btn ${custom.backQrStyle === 'badge' ? 'is-active' : ''}" data-custom-set="backQrStyle" data-value="badge">Badge</button>
          </div>

          <div class="inspector-divider"></div>

          <div class="font-size-stepper" role="group" aria-label="QR size">
            <button type="button" class="size-step-btn" data-custom-element-size-step="-10" data-target-element="back-qr" title="Smaller QR">-</button>
            <div class="rot-input-wrap">
              <input type="number" class="rot-input-field" data-custom-element-size-input="back-qr" value="${st.size}" min="30" max="250" step="5" aria-label="QR size" />
              <span class="rot-input-unit">%</span>
            </div>
            <button type="button" class="size-step-btn" data-custom-element-size-step="10" data-target-element="back-qr" title="Larger QR">+</button>
          </div>
        ` : ""}

        <div class="inspector-divider"></div>

        <div class="font-size-stepper" role="group" aria-label="Angle">
          <button type="button" class="size-step-btn" data-custom-rot-step="-15" data-rot-target="${escapeHtml(elKey)}" title="Rotate -15°">-</button>
          <div class="rot-input-wrap">
            <input type="number" class="rot-input-field" id="inspector-rot-input-${escapeHtml(productId)}" data-custom-rot-input="${escapeHtml(elKey)}" value="${st.rotate}" min="-360" max="360" step="15" aria-label="Rotation angle" />
            <span class="rot-input-unit">°</span>
          </div>
          <button type="button" class="size-step-btn" data-custom-rot-step="15" data-rot-target="${escapeHtml(elKey)}" title="Rotate +15°">+</button>
        </div>

        <button type="button" class="inspector-close-btn" data-custom-action="deselect-element" title="Deselect" aria-label="Deselect">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    `;
  }

  function renderElementPropToolbar() {
    return "";
  }

  function productMarkup(p, detail = false) {
      const v = p.variants.find(v => v.id === selectedVariants.get(p.id)) ?? p.variants.find(v => v.available) ?? p.variants[0];
      selectedVariants.set(p.id, v.id);
      const media = productMedia(v);
      const preferred = detail ? Math.min(selectedMedia.get(v.id) ?? v.defaultMediaIndex ?? 0, Math.max(0, media.length - 1)) : 0;
      const isGalleryMedia = m => m.type === "image" || m.type === "video";
      const active = media[preferred] && isGalleryMedia(media[preferred]) ? preferred : media.findIndex(isGalleryMedia);
      const item = media[active];
      const gallery = detail ? productGallery(p.variants, {...v, showAllColourMedia:true}) : [];
      const thumbnails = gallery.filter(({media}) => isGalleryMedia(media));
      const models = gallery.filter(({media}) => media.type === "model");
      const selectedModel = selectedModels.get(p.id);
      const model = models.find(({variant,media}) => variant.id === selectedModel?.variantId && media.id === selectedModel.mediaId)
        ?? models.find(({variant,index}) => variant.id === v.id && index === preferred)
        ?? models.find(({variant}) => variant.id === v.id) ?? models[0];
      const imageUrl = !detail ? variantCover(v) : item?.type === "image" ? item.url : "";
      const drivePreview = detail && item?.type === "video" ? driveVideoPreview(item.url) : null;
      const hasMedia = imageUrl || (detail && item?.type === "video");
      const quantity = quantities.get(p.id) ?? 1;
      const custom = productCustomizations.get(p.id) ?? defaultCustomization("01");
      const isCustomizable = detail && p.customizable;
      const hasLogo = !p.customizable || (custom.hasOneinfoLogo !== false && custom.brandingMode !== "without-logo");
      const activePrice = p.customizable ? variantPriceForBranding(v, hasLogo) : variantPrice(v);
      const activeRegular = p.customizable ? variantRegularPriceForBranding(v, hasLogo) : v.priceMinor;
      const sale = activePrice < activeRegular;
      const percent = activeRegular > 0 && sale ? Math.floor((activeRegular - activePrice) * 100 / activeRegular) : 0;
      const priceWithLogo = variantPriceForBranding(v, true);
      const regWithLogo = variantRegularPriceForBranding(v, true);
      const priceWithoutLogo = variantPriceForBranding(v, false);
      const regWithoutLogo = variantRegularPriceForBranding(v, false);
      const isLight = isCustomizable ? isColorLight(custom.surfaceColor) : (v.appearance === "light");
      const surfaceBg = isCustomizable ? escapeHtml(custom.surfaceColor) : escapeHtml(v.colorHex);
      const cardAccent = isCustomizable ? escapeHtml(custom.accentColor) : 'var(--accent)';
      const layoutClass = isCustomizable ? `layout-${escapeHtml(custom.layout || 'left')}` : "";
      const motifClass = isCustomizable ? `motif-${escapeHtml(custom.surfaceMotif || 'facets')}` : "";
      const luminanceClass = isLight ? "is-light-surface light-card" : "dark-card";

      const ep = custom.elementPositions || {};
      const activeExtras = (custom.extraLines || []).filter(l => l && l.trim());
      const numExtras = activeExtras.length;

      const stName = getElementStyle(custom, "name");
      const stTitle = getElementStyle(custom, "title");
      const stLogo = getElementStyle(custom, "logo");
      const stSign = getElementStyle(custom, "sign");
      const stQr = getElementStyle(custom, "back-qr");

      const nameFontSize = `${(1.125 * stName.size / 14).toFixed(3)}rem`;
      const titleFontSize = `${(0.65 * stTitle.size / 14).toFixed(3)}rem`;
      const logoScale = (stLogo.size / 100).toFixed(2);
      const iconScale = (stSign.size / 100).toFixed(2);
      const qrScale = (stQr.size / 100).toFixed(2);

      const logoRot = stLogo.rotate;
      const signRot = stSign.rotate;
      const nameRot = stName.rotate;
      const titleRot = stTitle.rotate;
      const logoPos = (ep.logo && ep.logo.x != null && ep.logo.y != null) ? ep.logo : null;
      const signPos = (ep.sign && ep.sign.x != null && ep.sign.y != null) ? ep.sign : null;
      const namePos = (ep.name && ep.name.x != null && ep.name.y != null) ? ep.name : ((custom.customPos && custom.customPos.x != null && custom.customPos.y != null) ? custom.customPos : null);
      const titlePos = (ep.title && ep.title.x != null && ep.title.y != null) ? ep.title : null;
      const backQrPos = (ep["back-qr"] && ep["back-qr"].x != null && ep["back-qr"].y != null) ? ep["back-qr"] : null;
      const qrRot = stQr.rotate;

      const logoStyle = logoPos ? `left:${logoPos.x}%; top:${logoPos.y}%; --scale:${logoScale}; --rot:${logoRot}deg;` : `--scale:${logoScale}; --rot:${logoRot}deg;`;
      const signStyle = signPos ? `left:${signPos.x}%; top:${signPos.y}%; --scale:${iconScale}; --rot:${signRot}deg;` : `--scale:${iconScale}; --rot:${signRot}deg;`;

      let nameStyle = namePos ? `left:${namePos.x}%; top:${namePos.y}%; --rot:${nameRot}deg;` : `--rot:${nameRot}deg;`;
      if (!namePos) {
        if (custom.layout === "reverse") {
          nameStyle = `top:20px; bottom:auto; --rot:${nameRot}deg;`;
        } else {
          nameStyle = `bottom:${48 + numExtras * 18}px; --rot:${nameRot}deg;`;
        }
      }

      let titleStyle = titlePos ? `left:${titlePos.x}%; top:${titlePos.y}%; --rot:${titleRot}deg;` : `--rot:${titleRot}deg;`;
      if (!titlePos) {
        if (custom.layout === "reverse") {
          titleStyle = `top:46px; bottom:auto; --rot:${titleRot}deg;`;
        } else {
          titleStyle = `bottom:${20 + numExtras * 18}px; --rot:${titleRot}deg;`;
        }
      }

      const logoPosClass = logoPos ? "pos-custom" : `pos-${escapeHtml(custom.layout || 'left')}`;
      const signPosClass = signPos ? "pos-custom" : `pos-${escapeHtml(custom.layout || 'left')}`;
      const namePosClass = namePos ? "pos-custom" : `pos-${escapeHtml(custom.layout || 'left')}`;
      const titlePosClass = titlePos ? "pos-custom" : `pos-${escapeHtml(custom.layout || 'left')}`;

      const isLogoNearTop = !logoPos || logoPos.y < 24;
      const isSignNearTop = !signPos || signPos.y < 24;
      const isNameNearTop = namePos ? namePos.y < 24 : custom.layout === "reverse";
      const isTitleNearTop = titlePos ? titlePos.y < 24 : false;

      const renderRotateHandle = (key) => `
        <span class="corner-pin pin-tl" aria-hidden="true"></span>
        <span class="corner-pin pin-tr" aria-hidden="true"></span>
        <span class="corner-pin pin-bl" aria-hidden="true"></span>
        <span class="corner-pin pin-br" aria-hidden="true"></span>
        <button type="button" class="element-rotate-handle" data-rotate-handle="${escapeHtml(key)}" title="Click to rotate 90°, or drag to rotate freely" aria-label="Rotate element">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
        </button>
      `;

      const frontIllustration = `<div class="mini-product-card ${v.appearance}-card customizable-card ${layoutClass} ${motifClass} ${luminanceClass} card-view-front" style="background:${surfaceBg}; --card-accent:${cardAccent};" data-card-face="front" data-interactive-card="${escapeHtml(p.id)}">
        ${renderSurfaceMotifSvg(custom.surfaceMotif, custom.accentColor)}
        ${custom.layout === "column" ? `<div class="card-side-column-bar" aria-hidden="true"></div>` : ""}
        ${custom.layout === "header" ? `<div class="card-header-banner" aria-hidden="true"></div>` : ""}

        <div class="card-drag-item card-element-logo ${logoPosClass} ${isLogoNearTop ? 'is-near-top' : ''} ${selectedElementId === 'logo' ? 'is-selected' : ''}" style="${logoStyle}" data-drag-element="logo" data-product-id="${escapeHtml(p.id)}">
          ${(custom.logoPreviewUrl || custom.logoUrl) ? `
            <img class="mini-product-logo custom-user-logo" src="${escapeHtml(mediaUrl(custom.logoPreviewUrl || custom.logoUrl))}" alt="Custom logo" />
          ` : `
            <span class="card-logo-placeholder" style="color:${escapeHtml(custom.accentColor)};">YOUR LOGO</span>
          `}
          ${renderRotateHandle("logo")}
        </div>

        <div class="card-drag-item card-element-nfc ${signPosClass} ${isSignNearTop ? 'is-near-top' : ''} ${selectedElementId === 'sign' ? 'is-selected' : ''}" style="color:${escapeHtml(custom.accentColor)}; ${signStyle}" data-drag-element="sign" data-product-id="${escapeHtml(p.id)}">
          <span class="card-nfc-wave" aria-hidden="true" style="color:inherit;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9a5 5 0 0 1 0 6"/><path d="M10 6a9 9 0 0 1 0 12"/><path d="M14 3a13 13 0 0 1 0 18"/></svg>
          </span>
          ${renderRotateHandle("sign")}
        </div>

        <div class="card-drag-item card-element-name ${namePosClass} ${isNameNearTop ? 'is-near-top' : ''} font-${escapeHtml(stName.font)} ${selectedElementId === 'name' ? 'is-selected' : ''}" style="${nameStyle}" data-drag-element="name" data-product-id="${escapeHtml(p.id)}">
          <strong class="card-custom-name ${!custom.name ? "is-placeholder" : ""} ${stName.bold ? "is-bold" : "is-not-bold"} ${stName.italic ? "is-italic" : ""}" style="font-size:${nameFontSize}; font-weight:${stName.bold ? 700 : 400}; font-style:${stName.italic ? 'italic' : 'normal'};">${escapeHtml(custom.name || "Your Name")}</strong>
          ${renderRotateHandle("name")}
        </div>

        <div class="card-drag-item card-element-title ${titlePosClass} ${isTitleNearTop ? 'is-near-top' : ''} font-${escapeHtml(stTitle.font)} ${selectedElementId === 'title' ? 'is-selected' : ''}" style="${titleStyle}" data-drag-element="title" data-product-id="${escapeHtml(p.id)}">
          <span class="card-custom-title ${!custom.title && numExtras === 0 ? "is-placeholder" : ""} ${stTitle.bold ? "is-bold" : "is-not-bold"} ${stTitle.italic ? "is-italic" : ""}" style="color:${escapeHtml(custom.accentColor)}; font-size:${titleFontSize}; font-weight:${stTitle.bold ? 700 : 400}; font-style:${stTitle.italic ? 'italic' : 'normal'};">${escapeHtml(custom.title || (numExtras > 0 ? "" : "Your Title / Role"))}</span>
          ${renderRotateHandle("title")}
        </div>

        ${(custom.extraLines || []).map((line, idx) => {
          if (!line || !line.trim()) return "";
          const extraKey = `extra-${idx}`;
          const stExtra = getElementStyle(custom, extraKey);
          const extraPos = ep[extraKey];
          const extraRot = stExtra.rotate;
          const extraFontSize = `${(0.65 * stExtra.size / 14).toFixed(3)}rem`;
          const extraPosClass = extraPos ? "pos-custom" : `pos-${escapeHtml(custom.layout || 'left')} pos-extra-${idx}`;
          let extraStyle = extraPos ? `left:${extraPos.x}%; top:${extraPos.y}%; --rot:${extraRot}deg;` : `--rot:${extraRot}deg;`;
          if (!extraPos) {
            if (custom.layout === "reverse") {
              extraStyle = `top:${60 + idx * 16}px; bottom:auto; --rot:${extraRot}deg;`;
            } else {
              extraStyle = `bottom:${22 + (numExtras - 1 - idx) * 16}px; --rot:${extraRot}deg;`;
            }
          }
          return `
            <div class="card-drag-item card-element-extra ${extraPosClass} font-${escapeHtml(stExtra.font)} ${selectedElementId === extraKey ? 'is-selected' : ''}" style="${extraStyle}" data-drag-element="${extraKey}" data-extra-index="${idx}" data-product-id="${escapeHtml(p.id)}">
              <span class="card-custom-extra-line ${stExtra.bold ? 'is-bold' : 'is-not-bold'} ${stExtra.italic ? 'is-italic' : ''}" style="color:${escapeHtml(custom.accentColor)}; font-size:${extraFontSize}; font-weight:${stExtra.bold ? 700 : 400}; font-style:${stExtra.italic ? 'italic' : 'normal'};">${escapeHtml(line.trim())}</span>
              ${renderRotateHandle(extraKey)}
            </div>
          `;
        }).join("")}

        ${(custom.dividerLines || []).map((line, idx) => {
          const dividerKey = `divider-${idx}`;
          const dividerPos = ep[dividerKey];
          const divRot = dividerPos?.rotate || 0;
          const isVert = line.orientation === "vertical";
          const len = line.length || (isVert ? 60 : 100);
          const dividerStyle = dividerPos
            ? `left:${dividerPos.x}%; top:${dividerPos.y}%; --divider-len:${len}px; --rot:${divRot}deg;`
            : `left:50%; top:${50 + idx * 12}%; --divider-len:${len}px; --rot:${divRot}deg;`;
          return `
            <div class="card-drag-item card-element-divider divider-${escapeHtml(line.orientation || 'horizontal')} ${line.style === 'dashed' ? 'is-dashed' : ''} pos-custom ${selectedElementId === dividerKey ? 'is-selected' : ''}" style="${dividerStyle} color:${escapeHtml(custom.accentColor)};" data-drag-element="${dividerKey}" data-divider-index="${idx}" data-product-id="${escapeHtml(p.id)}">
              ${renderRotateHandle(dividerKey)}
            </div>
          `;
        }).join("")}
      </div>`;

      const backQrStyle = backQrPos ? `left:${backQrPos.x}%; top:${backQrPos.y}%; --scale:${qrScale}; --rot:${qrRot}deg;` : `--scale:${qrScale}; --rot:${qrRot}deg;`;
      const backQrClass = backQrPos ? "pos-custom" : "";

      const backIllustration = `<div class="mini-product-card ${v.appearance}-card customizable-card ${luminanceClass} card-view-back" style="background:${surfaceBg}; --card-accent:${cardAccent};" data-card-face="back" data-interactive-card="${escapeHtml(p.id)}">
        ${renderBackMotifSvg(custom.surfaceMotif, custom.accentColor)}
        <div class="card-drag-item card-back-center-qr ${backQrClass} ${selectedElementId === 'back-qr' ? 'is-selected' : ''}" style="${backQrStyle}" data-drag-element="back-qr" data-product-id="${escapeHtml(p.id)}">
          <div class="card-qr-wrap ${escapeHtml(custom.backQrStyle || 'minimal')}">
            ${renderQrSvg(custom.accentColor, custom.backQrStyle || 'minimal')}
          </div>
          ${(custom.backSubtitle && custom.backSubtitle.trim()) ? `<span class="card-back-subtitle" style="color:${escapeHtml(custom.accentColor)};">${escapeHtml(custom.backSubtitle.trim())}</span>` : ""}
          ${renderRotateHandle("back-qr")}
        </div>
        <div class="card-back-footer" style="${custom.hasOneinfoLogo !== false ? '' : 'display:none;'}">
          ${custom.hasOneinfoLogo !== false ? `
            <img class="mini-product-logo card-back-oneinfo-logo" src="${logoUrl}" alt="Oneinfo logo" />
            ${renderAriseLogoSvg()}
          ` : `<!-- Brand labeling omitted (Without Oneinfo Logo edition) -->`}
        </div>
      </div>`;

      const standardIllustration = p.customizable ? `
        <div class="mini-product-card ${v.appearance}-card is-catalog-card" style="background:#0a0b0d; --card-accent:#d8b26e;" aria-label="${escapeHtml(p.name)} bespoke preview">
          ${renderSurfaceMotifSvg("facets", "#d8b26e")}
          <div class="card-header-row">
            <span class="card-logo-placeholder" style="color:#d8b26e; font-size:0.72rem; letter-spacing:0.12em; font-weight:700;">YOUR LOGO</span>
            <span class="card-nfc-wave" aria-hidden="true" style="color:#d8b26e;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9a5 5 0 0 1 0 6"/><path d="M10 6a9 9 0 0 1 0 12"/><path d="M14 3a13 13 0 0 1 0 18"/></svg>
            </span>
          </div>
          <div class="card-catalog-holder-details">
            <strong class="card-custom-name" style="color:#f7eed8; font-size:0.95rem; font-weight:700; letter-spacing:-0.015em;">Your Name</strong>
            <span class="card-custom-title" style="color:#d8b26e; font-size:0.56rem; font-weight:600; letter-spacing:0.08em; text-transform:uppercase;">Custom Edition</span>
          </div>
        </div>
      ` : `
        <div class="mini-product-card ${v.appearance}-card" style="background:${surfaceBg};">
          <div class="card-header-row">
            <img class="mini-product-logo" src="${logoUrl}" alt="Oneinfo logo" />
            <span class="card-nfc-wave" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9a5 5 0 0 1 0 6"/><path d="M10 6a9 9 0 0 1 0 12"/><path d="M14 3a13 13 0 0 1 0 18"/></svg>
            </span>
          </div>
          <strong>${escapeHtml(p.name)}</strong>
        </div>
      `;

      return `<article class="product ${detail ? "detail-product" : ""} ${p.featured ? "featured" : ""}" data-id="${escapeHtml(p.id)}">
        ${detail ? `<div class="product-gallery">` : ""}
        ${isCustomizable ? `
          <div class="product-art custom-stage-unified ${p.featured ? 'has-badge' : ''}">
            <div class="product-badges">
              ${p.featured ? `<span class="feature-badge">${escapeHtml(p.badge || "Featured")}</span>` : ""}
            </div>

            <div class="stage-inspector-wrap" id="stage-inspector-wrap-${escapeHtml(p.id)}">
              ${renderQuickInspectorMarkup(p.id)}
            </div>

            <div class="custom-card-face-block">
              <div class="custom-face-label-row">
                <span class="custom-face-tag">Front Face</span>
              </div>
              ${frontIllustration}
            </div>

            <div class="custom-card-face-divider" aria-hidden="true"></div>

            <div class="custom-card-face-block">
              <div class="custom-face-label-row">
                <span class="custom-face-tag">Back Face</span>
              </div>
              ${backIllustration}
            </div>
          </div>
        ` : `
          <div class="product-art art-${v.appearance} ${hasMedia ? "has-image" : ""}">
            <div class="product-badges">${p.featured ? `<span class="feature-badge">${escapeHtml(p.badge || "Featured")}</span>` : ""}${!detail && sale ? `<span class="discount-badge">${percent > 0 ? `${percent}% OFF` : "ON SALE"}</span>` : ""}</div>
            ${standardIllustration}${imageUrl ? `<img class="catalog-image" draggable="false" src="${escapeHtml(imageSource(imageUrl))}" alt="${escapeHtml(p.name)} — ${escapeHtml(v.name)} — ${escapeHtml(item?.label || "Product image")}" loading="lazy" referrerpolicy="no-referrer" />` : ""}<span class="finish-label">${escapeHtml(v.finish)}</span>
            ${detail && item?.type === "video" ? (drivePreview ? `<iframe class="gallery-video" src="${escapeHtml(drivePreview)}" title="${escapeHtml(item.label || p.name + ' video')}" allowfullscreen referrerpolicy="no-referrer"></iframe>` : `<video class="gallery-video" controls playsinline preload="metadata" ${item.poster ? `poster="${escapeHtml(imageSource(item.poster))}"` : ""} src="${escapeHtml(mediaUrl(item.url))}" aria-label="${escapeHtml(item.label || p.name + ' video')}"></video>`) : ""}
            ${detail && media.length ? `<p class="gallery-error" role="status" hidden>Media could not load. Choose another item or check the URL.</p>` : ""}
          </div>
        `}
        ${thumbnails.length && !isCustomizable ? `<div class="gallery-items" role="group" aria-label="Product media">${thumbnails.map(({variant,media:m,index:i}) => `<button class="gallery-item ${variant.id === v.id ? "selected-colour" : ""}" type="button" data-media="${i}" data-media-variant="${escapeHtml(variant.id)}" aria-pressed="${variant.id === v.id && active === i}" aria-label="${escapeHtml(variant.name + ' — ' + (m.label || (m.type === 'video' ? 'Video' : 'Image') + ' ' + (i+1)))}">${m.type === 'image' ? `<img src="${escapeHtml(imageSource(m.url))}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<span>${icon("play")}</span>`}</button>`).join("")}</div>` : ""}
        ${model && !isCustomizable ? `<section class="gallery-model-card" aria-label="Interactive 3D view">
          <header><h2>3D View</h2><span>${escapeHtml(model.variant.name)}</span></header>
          <div class="gallery-model-stage" data-appearance="${escapeHtml(model.variant.appearance)}">
            <model-viewer class="gallery-model" src="${escapeHtml(modelSource(model.media.url))}" alt="${escapeHtml(p.name + " — " + model.variant.name + " 3D model")}" camera-controls camera-orbit="0deg 85deg 105%" interaction-prompt="none" touch-action="none" min-camera-orbit="auto 0deg auto" max-camera-orbit="auto 180deg auto" disable-pan></model-viewer>
            <p class="gallery-model-instruction">Drag or swipe to rotate</p>
          </div>
          <p class="gallery-model-error" role="status" hidden>3D model could not load.</p>
          ${models.length > 1 ? `<div class="gallery-model-actions" role="group" aria-label="3D views">${models.map(entry => `<button class="gallery-model-button" type="button" data-media="${entry.index}" data-media-variant="${escapeHtml(entry.variant.id)}" aria-pressed="${entry === model}">${escapeHtml(entry.media.label || entry.variant.name)}</button>`).join("")}</div>` : ""}
        </section>` : ""}
        ${detail ? `</div><div class="product-details-copy">` : ""}
        <div class="product-info"><div>${!detail && p.subtitle ? `<p>${escapeHtml(p.subtitle)}</p>` : ""}${detail ? `<h1 id="product-title" tabindex="-1">${escapeHtml(p.name)}</h1>` : `<h3><a class="product-link" href="#product/${encodeURIComponent(p.slug)}?colour=${encodeURIComponent(v.id)}">${escapeHtml(p.name)}</a></h3>`}</div><div class="product-price"><strong>${money.format(activePrice / 100)}</strong>${sale ? `<del aria-label="Regular price ${money.format(activeRegular / 100)}">${money.format(activeRegular / 100)}</del>` : ""}${detail && sale ? `<span class="purchase-saving">Save ${money.format((activeRegular - activePrice) / 100)}</span>` : ''}</div></div>
        ${!isCustomizable ? `
          <div class="product-colours">
            <div class="colour-caption">
              <span>${detail ? 'Colour. <span>Choose your finish.</span>' : (p.customizable ? 'Colour: <strong>Limitless</strong>' : `Colour: <strong>${escapeHtml(v.name)}</strong>`)}</span>
              ${detail ? "" : (p.customizable ? `
                <span class="infinity-option-wrap" title="Limitless customizable themes & finishes">
                  ${icon("infinity")}
                  <span>options</span>
                </span>
              ` : `<span>${p.variants.length} ${p.variants.length === 1 ? "option" : "options"}</span>`)}
            </div>
            ${p.customizable && !detail ? `
              <div class="colour-options is-limitless-palette" role="group" aria-label="${escapeHtml(p.name)} customizable themes">
                <a href="#product/${encodeURIComponent(p.slug)}?colour=${encodeURIComponent(v.id)}" class="colour-swatch is-limitless-swatch" aria-label="Limitless finishes — customize your own" title="Limitless Themes & Finishes">
                  <span class="swatch-conic-glow" aria-hidden="true"></span>
                </a>
                <a href="#product/${encodeURIComponent(p.slug)}?colour=${encodeURIComponent(v.id)}" class="colour-swatch is-mini-preview" style="--swatch:#0a0b0d" title="Obsidian Black"></a>
                <a href="#product/${encodeURIComponent(p.slug)}?colour=${encodeURIComponent(v.id)}" class="colour-swatch is-mini-preview" style="--swatch:#d8b26e" title="Champagne Gold"></a>
                <a href="#product/${encodeURIComponent(p.slug)}?colour=${encodeURIComponent(v.id)}" class="colour-swatch is-mini-preview" style="--swatch:#f4efe6" title="Satin Frost"></a>
                <a href="#product/${encodeURIComponent(p.slug)}?colour=${encodeURIComponent(v.id)}" class="colour-swatch is-mini-preview" style="--swatch:#182232" title="Royal Navy"></a>
              </div>
            ` : `
              <div class="colour-options" role="group" aria-label="${escapeHtml(p.name)} colours">${p.variants.map(option => `<button type="button" class="colour-swatch ${!option.available ? "unavailable" : ""}" style="--swatch:${escapeHtml(option.colorHex)}" data-variant="${escapeHtml(option.id)}" aria-label="${escapeHtml(option.name)}${option.available ? "" : " — unavailable"}" aria-pressed="${option.id === v.id}" title="${escapeHtml(option.name)}${option.available ? "" : " — unavailable"}"><span aria-hidden="true"></span>${detail ? `<b>${escapeHtml(option.name)}${!option.available ? '<small>Unavailable</small>' : ''}</b>` : ''}</button>`).join("")}</div>
            `}
          </div>
        ` : ""}
        ${detail && p.customizable ? `
        <section class="card-customizer-studio" data-product-id="${escapeHtml(p.id)}" aria-label="Card personalization">
          <div class="customizer-header">
            <h3>Personalise your card</h3>
            <span class="customizer-badge-free">Included free</span>
          </div>

          <!-- Top Branding Selector (With Oneinfo Logo vs Without Oneinfo Logo) -->
          <div class="branding-selector" role="radiogroup" aria-label="Card branding option">
            <button type="button" class="branding-btn ${hasLogo ? 'is-selected' : ''}" data-custom-branding="with-logo" role="radio" aria-checked="${hasLogo}">
              <span class="branding-btn-radio"></span>
              <div class="branding-btn-content">
                <span class="branding-btn-name">With Oneinfo Logo</span>
                <span class="branding-btn-price">${priceWithLogo < regWithLogo ? `<del>${money.format(regWithLogo / 100)}</del>` : ''}<strong>${money.format(priceWithLogo / 100)}</strong></span>
              </div>
            </button>

            <button type="button" class="branding-btn ${!hasLogo ? 'is-selected' : ''}" data-custom-branding="without-logo" role="radio" aria-checked="${!hasLogo}">
              <span class="branding-btn-radio"></span>
              <div class="branding-btn-content">
                <span class="branding-btn-name">Without Oneinfo Logo</span>
                <span class="branding-btn-price">${priceWithoutLogo < regWithoutLogo ? `<del>${money.format(regWithoutLogo / 100)}</del>` : ''}<strong>${money.format(priceWithoutLogo / 100)}</strong></span>
              </div>
            </button>
          </div>

          <!-- 2. Studio Tabs Navigation -->
          <div class="studio-tabs-nav" role="tablist" aria-label="Studio Configuration Tabs">
            <button type="button" class="studio-tab-btn ${activeStudioTab === 'details' ? 'is-active' : ''}" data-studio-tab="details" role="tab" aria-selected="${activeStudioTab === 'details'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <span>Details</span>
            </button>
            <button type="button" class="studio-tab-btn ${(activeStudioTab === 'themes' || activeStudioTab === 'style') ? 'is-active' : ''}" data-studio-tab="themes" role="tab" aria-selected="${activeStudioTab === 'themes' || activeStudioTab === 'style'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/></svg>
              <span>Themes</span>
            </button>
            <button type="button" class="studio-tab-btn ${activeStudioTab === 'layout' ? 'is-active' : ''}" data-studio-tab="layout" role="tab" aria-selected="${activeStudioTab === 'layout'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
              <span>Layout</span>
            </button>
          </div>

          <!-- TAB 1: DETAILS & LOGO -->
          <div class="studio-tab-pane" id="studio-pane-details" ${activeStudioTab !== 'details' ? 'hidden' : ''}>
            <div class="customizer-section" style="padding-top:0; border-top:none;">
              <div class="customizer-section-title">
                <span>Cardholder Details</span>
              </div>
              <div class="custom-fields-stack">
                <div class="custom-field">
                  <label for="custom-name-${escapeHtml(p.id)}"><span>Cardholder Name</span></label>
                  <input id="custom-name-${escapeHtml(p.id)}" type="text" maxlength="25" placeholder="Avery Morgan" value="${escapeHtml(custom.name || "")}" data-custom-input="name" autocomplete="name" />
                </div>
                <div class="custom-field">
                  <label for="custom-title-${escapeHtml(p.id)}"><span>Designation / Title</span></label>
                  <input id="custom-title-${escapeHtml(p.id)}" type="text" maxlength="35" placeholder="Managing Director" value="${escapeHtml(custom.title || "")}" data-custom-input="title" />
                </div>
                ${(custom.extraLines || []).map((line, idx) => `
                  <div class="custom-field extra-field-row">
                    <label for="custom-extra-${escapeHtml(p.id)}-${idx}">
                      <span>Line ${idx + 3}</span>
                      <button type="button" class="remove-line-btn" data-custom-action="remove-extra-line" data-line-index="${idx}">Remove ✕</button>
                    </label>
                    <input id="custom-extra-${escapeHtml(p.id)}-${idx}" type="text" maxlength="35" placeholder="${idx === 0 ? 'Company or Brand' : 'Department or Note'}" value="${escapeHtml(line || "")}" data-custom-extra-line="${idx}" />
                  </div>
                `).join("")}
                ${(!custom.extraLines || custom.extraLines.length < 4) ? `
                  <button type="button" class="add-extra-field-btn" data-custom-action="add-extra-line">+ Add Line</button>
                ` : ""}
              </div>
            </div>

            <div class="customizer-section">
              <div class="customizer-section-title">
                <span>Upload Logo</span>
              </div>
              <div class="custom-logo-zone">
                ${(custom.logoPreviewUrl || custom.logoUrl) ? `
                  <div class="logo-preview-active">
                    <img class="logo-thumb" src="${escapeHtml(mediaUrl(custom.logoPreviewUrl || custom.logoUrl))}" alt="Uploaded logo" />
                    <div class="logo-meta">
                      <strong>${escapeHtml(custom.logoFileName || "Custom logo uploaded")}</strong>
                    </div>
                    <button type="button" class="remove-logo-btn" data-custom-action="remove-logo" aria-label="Remove custom logo">Remove ✕</button>
                  </div>
                ` : `
                  <div class="logo-dropzone" data-custom-dropzone>
                    <input type="file" id="logo-file-${escapeHtml(p.id)}" accept="image/png, image/jpeg, image/svg+xml, image/webp" data-custom-file="logo" class="logo-file-input visually-hidden" />
                    <label for="logo-file-${escapeHtml(p.id)}" class="logo-dropzone-label">
                      <svg class="logo-upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      <span class="logo-dropzone-cta"><strong>Upload Company or Personal Logo</strong></span>
                      <small class="logo-dropzone-hint">SVG, transparent PNG, JPEG, WebP</small>
                    </label>
                  </div>
                `}
              </div>
            </div>
          </div>

          <!-- TAB 2: THEMES & COLORS -->
          <div class="studio-tab-pane" id="studio-pane-themes" ${(activeStudioTab !== 'themes' && activeStudioTab !== 'style') ? 'hidden' : ''}>
            <div class="customizer-section" style="padding-top:0; border-top:none;">
              <div class="customizer-section-title">
                <span>Quick Presets (10 Premium Editions)</span>
                <small>1-click apply matching design</small>
              </div>
              <div class="preset-chips-scroll" role="radiogroup" aria-label="10 Premium Presets">
                ${PREMIUM_PRESETS.map(preset => `
                  <button type="button" class="preset-chip ${custom.presetId === preset.id ? "is-selected" : ""}" data-custom-preset="${preset.id}" aria-checked="${custom.presetId === preset.id}" role="radio" title="${escapeHtml(preset.subtitle)}">
                    <span class="preset-swatches">
                      <span class="preset-swatch-base" style="background:${preset.surfaceColor};"></span>
                      <span class="preset-swatch-accent" style="background:${preset.accentColor};"></span>
                    </span>
                    <span class="preset-chip-text">
                      <strong>${escapeHtml(preset.name)}</strong>
                      <small>${escapeHtml(preset.label)}</small>
                    </span>
                  </button>
                `).join("")}
              </div>
            </div>

            <div class="customizer-section">
              <div class="customizer-section-title">
                <span>Surface Area & Texture Motif</span>
                <small>Decorative vector inlay</small>
              </div>
              <div class="customizer-pills" role="radiogroup" aria-label="Surface motif">
                <button type="button" class="customizer-pill ${custom.surfaceMotif === 'facets' ? 'is-selected' : ''}" data-custom-set="surfaceMotif" data-value="facets" role="radio" aria-checked="${custom.surfaceMotif === 'facets'}"><span class="motif-mini-icon facets-icon"></span> Layered Facets</button>
                <button type="button" class="customizer-pill ${custom.surfaceMotif === 'contour' ? 'is-selected' : ''}" data-custom-set="surfaceMotif" data-value="contour" role="radio" aria-checked="${custom.surfaceMotif === 'contour'}"><span class="motif-mini-icon contour-icon"></span> Contour Engraving</button>
                <button type="button" class="customizer-pill ${custom.surfaceMotif === 'architectural' ? 'is-selected' : ''}" data-custom-set="surfaceMotif" data-value="architectural" role="radio" aria-checked="${custom.surfaceMotif === 'architectural'}"><span class="motif-mini-icon architectural-icon"></span> Architectural Corner</button>
                <button type="button" class="customizer-pill ${custom.surfaceMotif === 'inlay' ? 'is-selected' : ''}" data-custom-set="surfaceMotif" data-value="inlay" role="radio" aria-checked="${custom.surfaceMotif === 'inlay'}"><span class="motif-mini-icon inlay-icon"></span> Diagonal Inlay</button>
                <button type="button" class="customizer-pill ${custom.surfaceMotif === 'minimal' ? 'is-selected' : ''}" data-custom-set="surfaceMotif" data-value="minimal" role="radio" aria-checked="${custom.surfaceMotif === 'minimal'}"><span class="motif-mini-icon minimal-icon"></span> Clean Minimal</button>
              </div>
            </div>

            <div class="customizer-section">
              <div class="color-config-cols">
                <div class="color-picker-group">
                  <div class="customizer-section-title">
                    <span>Surface Base Colour</span>
                    <small id="surface-color-name-${escapeHtml(p.id)}">${escapeHtml(SURFACE_COLORS.find(c => c.hex.toLowerCase() === custom.surfaceColor.toLowerCase())?.name || custom.surfaceColor)}</small>
                  </div>
                  <div class="color-swatches-grid" role="radiogroup" aria-label="Surface base colour">
                    ${SURFACE_COLORS.map(c => `
                      <button type="button" class="palette-swatch ${custom.surfaceColor.toLowerCase() === c.hex.toLowerCase() ? 'is-selected' : ''}" data-custom-set="surfaceColor" data-value="${c.hex}" style="--swatch-color:${c.hex};" title="${escapeHtml(c.name)} (${c.hex})" aria-label="${escapeHtml(c.name)}" role="radio" aria-checked="${custom.surfaceColor.toLowerCase() === c.hex.toLowerCase()}"><span class="swatch-indicator"></span></button>
                    `).join("")}
                    <label class="palette-swatch custom-hex-swatch" title="Pick custom base colour" style="--swatch-color:${escapeHtml(custom.surfaceColor)};">
                      <input type="color" value="${escapeHtml(custom.surfaceColor)}" data-custom-color="surfaceColor" aria-label="Custom surface colour" />
                      <span class="custom-icon" aria-hidden="true">+</span>
                    </label>
                  </div>
                </div>

                <div class="color-picker-group">
                  <div class="customizer-section-title">
                    <span>Foil & Accent Colour</span>
                    <small id="accent-color-name-${escapeHtml(p.id)}">${escapeHtml(ACCENT_COLORS.find(c => c.hex.toLowerCase() === custom.accentColor.toLowerCase())?.name || custom.accentColor)}</small>
                  </div>
                  <div class="color-swatches-grid" role="radiogroup" aria-label="Foil inlay accent colour">
                    ${ACCENT_COLORS.map(c => `
                      <button type="button" class="palette-swatch ${custom.accentColor.toLowerCase() === c.hex.toLowerCase() ? 'is-selected' : ''}" data-custom-set="accentColor" data-value="${c.hex}" style="--swatch-color:${c.hex};" title="${escapeHtml(c.name)} (${c.hex})" aria-label="${escapeHtml(c.name)}" role="radio" aria-checked="${custom.accentColor.toLowerCase() === c.hex.toLowerCase()}"><span class="swatch-indicator"></span></button>
                    `).join("")}
                    <label class="palette-swatch custom-hex-swatch" title="Pick custom foil colour" style="--swatch-color:${escapeHtml(custom.accentColor)};">
                      <input type="color" value="${escapeHtml(custom.accentColor)}" data-custom-color="accentColor" aria-label="Custom accent colour" />
                      <span class="custom-icon" aria-hidden="true">+</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- TAB 3: LAYOUT & EXTRAS -->
          <div class="studio-tab-pane" id="studio-pane-layout" ${activeStudioTab !== 'layout' ? 'hidden' : ''}>
            <div class="customizer-section" style="padding-top:0; border-top:none;">
              <div class="customizer-section-title">
                <span>Layout & Placement</span>
                <small>10 Design Layouts</small>
              </div>
              <div class="customizer-pills" role="radiogroup" aria-label="Layout placement">
                <button type="button" class="customizer-pill ${custom.layout === 'left' ? 'is-selected' : ''}" data-custom-set="layout" data-value="left" role="radio" aria-checked="${custom.layout === 'left'}"><span class="pill-dot"></span> Classic Left</button>
                <button type="button" class="customizer-pill ${custom.layout === 'center' ? 'is-selected' : ''}" data-custom-set="layout" data-value="center" role="radio" aria-checked="${custom.layout === 'center'}"><span class="pill-dot"></span> Centered Stack</button>
                <button type="button" class="customizer-pill ${custom.layout === 'right' ? 'is-selected' : ''}" data-custom-set="layout" data-value="right" role="radio" aria-checked="${custom.layout === 'right'}"><span class="pill-dot"></span> Right Aligned</button>
                <button type="button" class="customizer-pill ${custom.layout === 'reverse' ? 'is-selected' : ''}" data-custom-set="layout" data-value="reverse" role="radio" aria-checked="${custom.layout === 'reverse'}"><span class="pill-dot"></span> Reverse Stack</button>
                <button type="button" class="customizer-pill ${custom.layout === 'split-logo-left' ? 'is-selected' : ''}" data-custom-set="layout" data-value="split-logo-left" role="radio" aria-checked="${custom.layout === 'split-logo-left'}"><span class="pill-dot"></span> Logo Left / Name Right</button>
                <button type="button" class="customizer-pill ${custom.layout === 'split-logo-right' ? 'is-selected' : ''}" data-custom-set="layout" data-value="split-logo-right" role="radio" aria-checked="${custom.layout === 'split-logo-right'}"><span class="pill-dot"></span> Name Left / Logo Right</button>
                <button type="button" class="customizer-pill ${custom.layout === 'diagonal' ? 'is-selected' : ''}" data-custom-set="layout" data-value="diagonal" role="radio" aria-checked="${custom.layout === 'diagonal'}"><span class="pill-dot"></span> Diagonal Corners</button>
                <button type="button" class="customizer-pill ${custom.layout === 'column' ? 'is-selected' : ''}" data-custom-set="layout" data-value="column" role="radio" aria-checked="${custom.layout === 'column'}"><span class="pill-dot"></span> Side Column</button>
                <button type="button" class="customizer-pill ${custom.layout === 'header' ? 'is-selected' : ''}" data-custom-set="layout" data-value="header" role="radio" aria-checked="${custom.layout === 'header'}"><span class="pill-dot"></span> Header Bar</button>
              </div>
            </div>

            <div class="customizer-section">
              <div class="customizer-section-title">
                <span>NFC Contactless Wave Icon</span>
                <small>Tap or drag on card to position</small>
              </div>
              <div class="customizer-pills" role="radiogroup" aria-label="NFC Wave placement">
                <button type="button" class="customizer-pill ${(!ep.sign || (ep.sign.x > 50 && ep.sign.y < 50)) ? 'is-selected' : ''}" data-custom-nfc-pos="tr" role="radio"><span class="pill-dot"></span> Top Right</button>
                <button type="button" class="customizer-pill ${(ep.sign && ep.sign.x <= 50 && ep.sign.y < 50) ? 'is-selected' : ''}" data-custom-nfc-pos="tl" role="radio"><span class="pill-dot"></span> Top Left</button>
                <button type="button" class="customizer-pill ${(ep.sign && ep.sign.x <= 50 && ep.sign.y >= 50) ? 'is-selected' : ''}" data-custom-nfc-pos="bl" role="radio"><span class="pill-dot"></span> Bottom Left</button>
                <button type="button" class="customizer-pill ${(ep.sign && ep.sign.x > 50 && ep.sign.y >= 50) ? 'is-selected' : ''}" data-custom-nfc-pos="br" role="radio"><span class="pill-dot"></span> Bottom Right</button>
              </div>
              <div class="font-size-stepper" role="group" aria-label="NFC Wave Size" style="margin-top: 6px; width: fit-content;">
                <button type="button" class="size-step-btn" data-custom-element-size-step="-10" data-target-element="sign" title="Smaller icon">-</button>
                <div class="rot-input-wrap">
                  <input type="number" class="rot-input-field" data-custom-element-size-input="sign" value="${stSign.size}" min="30" max="250" step="5" aria-label="NFC Wave size" />
                  <span class="rot-input-unit">%</span>
                </div>
                <button type="button" class="size-step-btn" data-custom-element-size-step="10" data-target-element="sign" title="Larger icon">+</button>
              </div>
            </div>

            <div class="customizer-section">
              <div class="divider-manager-wrap">
                <div class="toolbar-label-group">
                  <strong>Divider Lines</strong>
                </div>
                <div class="divider-add-actions">
                  <button type="button" class="divider-add-btn" data-custom-action="add-divider-line" data-divider-orient="horizontal" ${((custom.dividerLines || []).length >= 4) ? 'disabled' : ''}>+ Add Horizontal Line</button>
                  <button type="button" class="divider-add-btn" data-custom-action="add-divider-line" data-divider-orient="vertical" ${((custom.dividerLines || []).length >= 4) ? 'disabled' : ''}>+ Add Vertical Line</button>
                </div>
                ${(custom.dividerLines || []).map((line, idx) => `
                  <div class="divider-line-item">
                    <div class="divider-line-header">
                      <span>Line ${idx + 1} (${line.orientation === 'vertical' ? 'Vertical' : 'Horizontal'})</span>
                      <button type="button" class="remove-line-btn" data-custom-action="remove-divider-line" data-divider-index="${idx}">Remove ✕</button>
                    </div>
                    <div class="divider-line-controls">
                      <button type="button" class="divider-chip-btn" data-custom-action="toggle-divider-orient" data-divider-index="${idx}">${line.orientation === 'vertical' ? 'Make Horizontal' : 'Make Vertical'}</button>
                      <button type="button" class="divider-chip-btn ${line.style === 'dashed' ? 'is-active' : ''}" data-custom-action="toggle-divider-style" data-divider-index="${idx}">${line.style === 'dashed' ? 'Dashed' : 'Solid'}</button>
                      
                      <div class="font-size-stepper" title="Rotate Line">
                        <button type="button" class="size-step-btn" data-custom-rot-step="-15" data-rot-target="divider-${idx}" title="Rotate -15°">-</button>
                        <div class="rot-input-wrap">
                          <input type="number" class="rot-input-field" id="rot-input-divider-${idx}-${escapeHtml(p.id)}" data-custom-rot-input="divider-${idx}" value="${ep[`divider-${idx}`]?.rotate || 0}" min="-360" max="360" step="15" aria-label="Divider rotation degrees" />
                          <span class="rot-input-unit">°</span>
                        </div>
                        <button type="button" class="size-step-btn" data-custom-rot-step="15" data-rot-target="divider-${idx}" title="Rotate +15°">+</button>
                      </div>

                      <div class="font-size-stepper" style="margin-left:auto;">
                        <button type="button" class="size-step-btn" data-custom-action="step-divider-len" data-divider-index="${idx}" data-step="-20" title="Shorter line">-</button>
                        <span class="size-display-val" style="min-width:44px;font-size:0.75rem;">${line.length || (line.orientation === 'vertical' ? 60 : 100)}px</span>
                        <button type="button" class="size-step-btn" data-custom-action="step-divider-len" data-divider-index="${idx}" data-step="20" title="Longer line">+</button>
                      </div>
                    </div>
                  </div>
                `).join("")}
              </div>
            </div>

            <div class="customizer-section">
              <div class="customizer-section-title">
                <span>Back Side Details</span>
              </div>
              <div class="custom-fields-stack">
                <div class="custom-field">
                  <label for="custom-back-sub-${escapeHtml(p.id)}"><span>Website / Subline</span></label>
                  <input id="custom-back-sub-${escapeHtml(p.id)}" type="text" maxlength="40" placeholder="oneinfo.me/username or website.com" value="${escapeHtml(custom.backSubtitle || "")}" data-custom-input="backSubtitle" />
                </div>
              </div>
              <div style="margin-top: 10px;">
                <label style="font-size:0.78rem;font-weight:600;display:block;margin-bottom:6px;">QR Inlay Style</label>
                <div class="customizer-pills" role="radiogroup" aria-label="QR Inlay style">
                  <button type="button" class="customizer-pill ${custom.backQrStyle === 'minimal' ? 'is-selected' : ''}" data-custom-set="backQrStyle" data-value="minimal" role="radio" aria-checked="${custom.backQrStyle === 'minimal'}"><span class="pill-dot"></span> Clean Minimal (Official)</button>
                  <button type="button" class="customizer-pill ${custom.backQrStyle === 'framed' ? 'is-selected' : ''}" data-custom-set="backQrStyle" data-value="framed" role="radio" aria-checked="${custom.backQrStyle === 'framed'}"><span class="pill-dot"></span> Foil Framed</button>
                  <button type="button" class="customizer-pill ${custom.backQrStyle === 'badge' ? 'is-selected' : ''}" data-custom-set="backQrStyle" data-value="badge" role="radio" aria-checked="${custom.backQrStyle === 'badge'}"><span class="pill-dot"></span> Dashed Badge</button>
                </div>
              </div>
            </div>
          </div>
        </section>` : ""}
        ${detail ? `<div class="purchase-actions"><div class="purchase-quantity-row"><span id="purchase-quantity-label">Quantity</span><div class="quantity-control" role="group" aria-labelledby="purchase-quantity-label"><button type="button" data-quantity-step="-1" aria-label="Decrease quantity" ${quantity === 1 ? 'disabled' : ''}>${icon("minus")}</button><output class="purchase-quantity" aria-live="polite">${quantity}</output><button type="button" data-quantity-step="1" aria-label="Increase quantity" ${quantity === 99 ? 'disabled' : ''}>${icon("plus")}</button></div></div><div class="purchase-total"><span>Total</span><strong>${money.format(activePrice * quantity / 100)}</strong></div><button class="button add-to-cart" type="button" ${!catalogReady || !v.available || addingToCart ? "disabled" : ""}>${addingToCart ? 'Adding…' : v.available ? 'Add to cart' : 'Unavailable in this colour'}</button></div>
        <div class="purchase-information">${p.description || p.features.length ? `<details class="purchase-disclosure" data-disclosure="product"><summary>Product details<span aria-hidden="true">${icon("plus")}</span></summary><div>${p.description ? `<p>${escapeHtml(p.description)}</p>` : ''}${p.features.length ? `<ul>${p.features.map(f => `<li>${escapeHtml(f)}</li>`).join("")}</ul>` : ''}</div></details>` : ''}${!p.warrantyIsDemo && p.warranty?.trim() ? `<details class="purchase-disclosure" data-disclosure="warranty"><summary>Warranty<span aria-hidden="true">${icon("plus")}</span></summary><div><p>${escapeHtml(p.warranty)}</p></div></details>` : ''}<details class="purchase-disclosure" data-disclosure="ordering"><summary>Ordering & delivery<span aria-hidden="true">${icon("plus")}</span></summary><div><p>See your delivery charge at checkout. Pay by cash when your order arrives.</p></div></details><a class="purchase-team-link" href="#teams"><span>Ordering for a team?<small>Explore team options</small></span><span aria-hidden="true">${icon("arrow-up-right")}</span></a></div></div>` : ""}</article>`;
  }

  function reviewsMarkup(product) {
    return `<section class="product-reviews" aria-labelledby="product-reviews-title">
      <div class="review-overview">
        <div>
          <h2 id="product-reviews-title">Customer reviews</h2>
          <p class="review-summary" data-review-summary>Loading reviews…</p>
        </div>
        <aside class="review-eligibility">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 22s7-3.5 7-10V5l-7-3-7 3v7c0 6.5 7 10 7 10Z"/><path d="m9 12 2 2 4-4"/></svg>
          <div><h3>Verified buyers</h3><p>After delivery, buyers receive a private link to review this card.</p></div>
        </aside>
      </div>
      <div class="review-list" data-review-list></div>
    </section>`;
  }

  async function loadProductReviews(product, host) {
    const summary = $(`[data-review-summary]`, host), list = $(`[data-review-list]`, host);
    try {
      const response = await fetch(`${apiUrl}/api/v1/reviews/products/${encodeURIComponent(product.slug)}`, { signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error("Reviews unavailable");
      const data = await response.json();
      summary.textContent = data.count ? `${data.average.toFixed(1)} out of 5 · ${data.count} ${data.count === 1 ? "review" : "reviews"}` : "No public reviews yet for this finish. Verified cardholders receive an invitation after delivery.";
      list.innerHTML = data.items.length
        ? data.items.map(review => `<article class="review-card"><div class="review-stars" aria-label="${review.rating} out of 5 stars">${icon("star-filled").repeat(review.rating)}${icon("star").repeat(5-review.rating)}</div><h3>${escapeHtml(review.title)}</h3><p>${escapeHtml(review.body)}</p><small>${escapeHtml(review.displayName)} · Verified buyer · ${new Date(review.createdAt).toLocaleDateString("en-BD")}</small></article>`).join("")
        : `<p class="review-empty">No reviews published yet. Every review comes from a confirmed, delivered order.</p>`;
    } catch { summary.textContent = "Reviews could not load. Please try again later."; }
  }

  async function renderReviewPortal(token) {
    const host = $("#review-portal");
    host.hidden = false;
    host.innerHTML = `<a class="back-to-products" href="#products">${icon("arrow-left")} Back to cards</a><div class="review-portal-card"><p class="eyebrow">VERIFIED PURCHASE</p><h1 id="review-portal-title">Your Oneinfo review</h1><p class="review-portal-lead">Share your experience with products from your delivered order. Edits return to moderation before publishing.</p><div data-review-portal-content role="status">Checking your private review link…</div></div>`;
    const content = $(`[data-review-portal-content]`, host);
    try {
      const response = await fetch(`${apiUrl}/api/v1/reviews/portal`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({token}), signal:AbortSignal.timeout(7000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message || "This review link is invalid or has expired.");
      content.innerHTML = data.products.map(product => `<article class="review-form-card" data-product-id="${escapeHtml(product.id)}"><h2>${escapeHtml(product.name)}</h2>${product.review ? `<p class="review-state">Your review is ${product.review.status.toLowerCase()}.</p>` : ""}<form class="buyer-review-form"><label>Your name<input name="displayName" maxlength="60" required value="${escapeHtml(product.review?.displayName || "")}"></label><label>Rating<select name="rating" required>${[5,4,3,2,1].map(value=>`<option value="${value}" ${product.review?.rating === value ? "selected" : ""}>${value} ${value === 1 ? "star" : "stars"}</option>`).join("")}</select></label><label>Review title<input name="title" maxlength="100" required value="${escapeHtml(product.review?.title || "")}"></label><label>Your review<textarea name="body" minlength="5" maxlength="1200" required>${escapeHtml(product.review?.body || "")}</textarea></label><button class="button" type="submit">${product.review ? "Save changes" : "Submit review"}</button>${product.review ? `<button class="plain-link review-delete" type="button">Delete review</button>` : ""}<p class="review-form-message" role="status"></p></form></article>`).join("") || "<p>This order has no products available to review.</p>";
      content.querySelectorAll(".buyer-review-form").forEach(form => form.addEventListener("submit", async event => {
        event.preventDefault(); const formData = new FormData(form), productId = form.closest("[data-product-id]").dataset.productId, message = $(".review-form-message", form), button = $("button[type=submit]", form); button.disabled = true;
        try { const result = await fetch(`${apiUrl}/api/v1/reviews/portal/reviews`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({token, productId, displayName:formData.get("displayName"), rating:Number(formData.get("rating")), title:formData.get("title"), body:formData.get("body")}) }); const payload=await result.json(); if(!result.ok) throw new Error(payload.message || "Could not save review."); message.textContent="Thanks. Your review is awaiting approval."; }
        catch(error) { message.textContent=error.message || "Could not save review."; } finally { button.disabled=false; }
      }));
      content.querySelectorAll(".review-delete").forEach(button => button.addEventListener("click", async () => { const form=button.closest("form"), productId=button.closest("[data-product-id]").dataset.productId, message=$(".review-form-message",form); if(!window.confirm("Delete your review?")) return; button.disabled=true; try { const res=await fetch(`${apiUrl}/api/v1/reviews/portal/reviews`,{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({token,productId})}); if(!res.ok) throw new Error("Could not delete review."); message.textContent="Review deleted."; form.reset(); } catch(error){message.textContent=error.message;} finally{button.disabled=false;} }));
    } catch (error) { content.textContent = error.message || "This private review link could not be verified."; }
  }

  function watchModel(viewer) {
    const error = $(".gallery-model-error", viewer.closest(".gallery-model-card"));
    const showError = () => { error.hidden = false; };
    viewer.addEventListener("error", showError);
    void import("@google/model-viewer").catch(showError);
  }

  const arrowSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15m-5-5 5 5-5 5"/></svg>`;
  function trackingPipelineMarkup(order, preview = false) {
    const cards = order.cards ?? { total: 1, qrGenerated: 0, nfcWritten: 0, qcPassed: 0 };
    const total = Math.max(1, cards.total || 1);
    const pastProcessing = Boolean(order.processingAt || order.shippedAt || order.deliveredAt);
    const pastShipped = Boolean(order.shippedAt || order.deliveredAt);
    const isDelivered = Boolean(order.deliveredAt) || order.status === "DELIVERED";
    const isCancelled = order.status === "CANCELLED";
    const isConfirmed = order.status !== "AWAITING_PAYMENT" && !isCancelled;
    const qrReady = isConfirmed && (order.activationMethod === "ORDER_SECRET" ? Boolean(order.packedAt) : (cards.qrGenerated >= total || (!order.invoiceNumber && pastProcessing)));
    const qcReady = isConfirmed && (order.activationMethod === "ORDER_SECRET" ? Boolean(order.packedAt) : cards.qcPassed >= total || pastShipped);
    const fmt = date => date ? escapeHtml(new Date(date).toLocaleString("en-BD", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" })) : "";
    const stages = [
      ["Received", "Order placed", isConfirmed, fmt(order.createdAt) || "Awaiting order", order.paymentVerifiedAt ? "Payment verified" : "Order confirmed"],
      [order.invoiceNumber ? "Cards packed" : "Card prepared", order.invoiceNumber ? "Ready for you" : "Your card is taking shape", qrReady, `${qrReady ? total : cards.qrGenerated}/${total} ${order.invoiceNumber ? "packed" : "cards prepared"}`, order.activationMethod === "ORDER_SECRET" ? "Linked to your profile when you activate" : order.invoiceNumber ? "Prepared for your order" : "Prepared for your profile"],
      ["Quality checked", "Checked before dispatch", qcReady, `${qcReady ? total : cards.qcPassed}/${total} cards checked`, "Sharing and card quality reviewed"],
      ["Processing", order.invoiceNumber ? "Preparing dispatch" : "Packed for dispatch", pastProcessing, fmt(order.processingAt) || "Getting ready to ship", order.activationMethod === "ORDER_SECRET" ? "Secret code included per card" : order.invoiceNumber ? "Activate by invoice after delivery" : "Packed with setup instructions"],
      ["Shipped", "Handed to courier", pastShipped, fmt(order.shippedAt) || "Courier handoff", order.courierTrackingId ? `ID: ${escapeHtml(order.courierTrackingId)}` : "Nationwide delivery"],
      ["Delivered", "In client’s hands", isDelivered, fmt(order.deliveredAt) || "Final handoff", isDelivered ? "Ready to tap & activate" : "Reaching your address"],
    ];
    const activeIndex = stages.findIndex(s => !s[2]);
    const doneCount = stages.filter(s => s[2]).length;
    const status = { AWAITING_PAYMENT: "Awaiting payment", CANCELLED: "Cancelled", RECEIVED: "Received", PROCESSING: "Processing", SHIPPED: "Shipped", DELIVERED: "Delivered" }[order.status];
    return `${preview ? `<p class="tracking-preview-banner">Sample live journey · Paste your private tracking link above to follow your order.</p>` : `<div class="tracking-summary"><p>Current status <strong class="tracking-status-badge" data-status="${escapeHtml(order.status)}">${escapeHtml(status || "Unavailable")}</strong></p><span class="tracking-progress-count">${doneCount}/6 stages complete</span></div>`}
      <div class="tracking-bar" aria-hidden="true"><span style="width:${Math.round(doneCount / 6 * 100)}%"></span></div>
      ${order.invoiceNumber ? `<p class="tracking-courier">Invoice number <strong>${escapeHtml(order.invoiceNumber)}</strong></p>` : ""}
      ${order.cancellationReason ? `<p class="tracking-cancel">${escapeHtml(order.cancellationReason)}</p>` : ""}
      ${order.courierTrackingId ? `<p class="tracking-courier">Courier tracking ID <strong>${escapeHtml(order.courierTrackingId)}</strong></p>` : ""}
      <ol class="tracking-flow">${stages.map(([title, sub, done, meta, note], i) => {
        const state = isCancelled && !done ? "cancelled" : done ? "done" : i === activeIndex ? "current" : "upcoming";
        return `<li class="tracking-node" data-state="${state}">
          <div class="tracking-node-card">
            <div class="tracking-node-top"><span class="tracking-step-badge">${done ? icon("check") : `0${i + 1}`}</span><small>${escapeHtml(sub)}</small></div>
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(note)}</p>
            <span class="tracking-meta">${meta}</span>
          </div>
          ${i < stages.length - 1 ? `<span class="tracking-arrow ${done ? "is-done" : state === "current" ? "is-active" : ""}" aria-hidden="true">${arrowSvg}</span>` : ""}
        </li>`;
      }).join("")}</ol>`;
  }

  let activeTrackingToken = "";
  async function renderTracking(rawToken, silent = false) {
    const content = $("[data-tracking-content]");
    const invoice = $(".tracking-invoice");
    const savedToken = /^\/#track\/([a-zA-Z0-9_.-]+)$/.exec(lastReceipt?.trackingPath ?? "")?.[1] ?? "";
    const token = rawToken || savedToken;
    activeTrackingToken = token;
    if (!silent) invoice.hidden = true;
    if (!token) {
      content.innerHTML = `<form class="tracking-lookup-form"><label>Your private tracking link<input name="token" placeholder="Paste the tracking link from your email" required /></label><button class="button button-primary" type="submit">Track order</button></form>${trackingPipelineMarkup({ status: "RECEIVED", createdAt: new Date().toISOString(), cards: { total: 1, qrGenerated: 1, nfcWritten: 0, qcPassed: 0 } }, true)}`;
      $(".tracking-lookup-form", content)?.addEventListener("submit", event => {
        event.preventDefault();
        const input = event.currentTarget.elements.token.value.trim().split("#track/").pop().replace(/^\/+/, "");
        if (input) location.hash = `track/${input}`;
      });
      return;
    }
    if (!silent) content.textContent = "Loading your order status…";
    try {
      const response = await fetch(`${apiUrl}/api/v1/orders/tracking`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }), signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error(response.status === 404 ? "This private tracking link is invalid." : "Tracking is temporarily unavailable.");
      const order = await response.json();
      if (activeTrackingToken !== token) return;
      content.innerHTML = trackingPipelineMarkup(order);
      invoice.hidden = !order.invoiceNumber;
      if (order.invoiceNumber) invoice.href = `/#invoice/${encodeURIComponent(token)}`;
    } catch (error) { if (activeTrackingToken === token && !silent) content.textContent = error.message || "Tracking is temporarily unavailable."; }
  }
  window.setInterval(() => { if (activeTrackingToken && !document.hidden && (location.hash === "#track" || location.hash.startsWith("#track/"))) void renderTracking(activeTrackingToken, true); }, 5000);

  async function renderInvoice(token, focus) {
    const status = $(".invoice-status");
    const content = $("[data-invoice-content]");
    const print = $(".invoice-print");
    $(".invoice-tracking").href = `/#track/${encodeURIComponent(token)}`;
    status.textContent = "Loading invoice…";
    content.hidden = print.hidden = true;
    try {
      const response = await fetch(`${apiUrl}/api/v1/orders/invoice`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }), signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error(response.status === 404 ? "This invoice is unavailable. Check your order tracking link." : "Could not load the invoice. Reload the page to try again.");
      const order = await response.json();
      if (location.hash !== `#invoice/${token}`) return;
      content.innerHTML = invoiceMarkup(order);
      document.title = `Invoice ${order.invoiceNumber} | Oneinfo`;
      status.textContent = "";
      content.hidden = print.hidden = false;
      if (focus) $("#invoice-title").focus();
    } catch (error) {
      if (location.hash === `#invoice/${token}`) status.textContent = error.message;
    }
  }
  $(".invoice-print").addEventListener("click", () => window.print());

  function renderRoute(focus = false) {
    const order = location.hash === "#order-draft";
    const payment = location.hash === "#arisepay";
    const reviewToken = location.hash.startsWith("#review/") ? location.hash.slice(8) : "";
    const trackingPage = location.hash === "#track" || location.hash.startsWith("#track/");
    const trackingToken = location.hash.startsWith("#track/") ? location.hash.slice(7) : "";
    const invoicePage = location.hash.startsWith("#invoice/");
    const route = productRoute(location.hash);
    document.body.classList.toggle("product-page", Boolean(route));
    const page = order ? "order-draft" : payment ? "arisepay" : reviewToken ? "review-portal" : trackingPage ? "tracking-portal" : invoicePage ? "invoice-portal" : route ? "product-detail" : "";
    $$("#main > section").forEach(section => {
      section.hidden = page ? section.id !== page : ["order-draft", "arisepay", "product-detail", "review-portal", "tracking-portal", "invoice-portal"].includes(section.id);
    });
    if (reviewToken) { document.title = "Your review | Oneinfo"; void renderReviewPortal(reviewToken); return; }
    if (trackingPage) { document.title = "Track your order | Oneinfo"; void renderTracking(trackingToken); if (focus) $("#tracking-portal-title").focus(); return; }
    if (invoicePage) { document.title = "Invoice | Oneinfo"; void renderInvoice(location.hash.slice(9), focus); return; }
    if (payment) {
      if (pendingOrder) {
        location.replace("#order-draft");
        return;
      }
      document.title = "ArisePay | Oneinfo";
      renderArisepay();
      if (focus) {
        $("#arisepay-title").focus({ preventScroll: true });
        $("#arisepay").scrollIntoView({ behavior: "instant" });
      }
      return;
    }
    if (order) {
      document.title = "Checkout | Oneinfo";
      renderOrder();
      if (focus || !shippingRates) void refreshShippingRates();
      if (focus) {
        const heading = $(".order-saved").hidden ? $("#order-title") : $(".order-saved h2");
        heading.focus({preventScroll:true});
        $("#order-draft").scrollIntoView({behavior:"instant"});
      }
      return;
    }
    if (!route) {
      document.title = "Oneinfo Smart Business Cards";
      if (focus && location.hash === "#top") window.scrollTo({ top: 0, behavior: "instant" });
      else if (focus) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior:"instant" });
      return;
    }
    const product = products.find(p => p.slug === route.slug);
    const host = $("#product-detail");
    if (route.variantId && product?.variants.some(v => v.id === route.variantId)) selectedVariants.set(product.id, route.variantId);
    const focused = document.activeElement;
    const variant = focused?.closest("#product-detail") ? focused.dataset.variant : null;
    const mediaVariantFocused = focused?.dataset.mediaVariant;
    const mediaFocused = focused?.closest("#product-detail") ? focused.dataset.media : null;
    const addFocused = focused?.closest("#product-detail") && focused.classList.contains("add-to-cart");
    const quantityFocused = focused?.closest("#product-detail") ? focused.dataset.quantityStep : null;
    const openDisclosures = new Map($$(".purchase-disclosure", host).map(el => [el.dataset.disclosure, el.open]));
    host.innerHTML = `<a class="back-to-products" href="#products">${icon("arrow-left")} Back to cards</a>` + (product ? productMarkup(product, true) + reviewsMarkup(product) : `<div class="product-missing"><h1 id="product-title" tabindex="-1">${catalogReady ? "This card is no longer available" : "Loading product…"}</h1><p>${catalogReady ? "Explore the collection to find another card." : "Fetching the latest product details."}</p></div>`);
    if (product) void loadProductReviews(product, host);
    if (!catalogReady && catalogFailed) host.insertAdjacentHTML("beforeend", '<p role="status">Product information is unavailable. <button type="button" class="detail-retry">Retry</button></p>');
    document.title = product ? `${product.name} | Oneinfo` : "Product | Oneinfo";
    watchImages();
    $$(".purchase-disclosure", host).forEach(el => { el.open = openDisclosures.get(el.dataset.disclosure) ?? false; });
    const strip = $(".gallery-items", host);
    const activeThumb = strip && $("[aria-pressed=true]", strip);
    if (activeThumb) {
      const itemRect = activeThumb.getBoundingClientRect();
      const stripRect = strip.getBoundingClientRect();
      if (itemRect.right > stripRect.right) strip.scrollLeft += itemRect.right - stripRect.right + 4;
      else if (itemRect.left < stripRect.left) strip.scrollLeft -= stripRect.left - itemRect.left + 4;
    }
    const model = $(".gallery-model", host);
    if (model) watchModel(model);
    $("video.gallery-video", host)?.addEventListener("error", () => { $(".gallery-error", host).hidden = false; }, {once:true});
    if (focus) { $("#product-title")?.focus({ preventScroll:true }); host.scrollIntoView({ behavior:"instant" }); }
    else if (variant) $$(".colour-swatch", host).find(el => el.dataset.variant === variant)?.focus({preventScroll:true});
    else if (mediaFocused !== undefined && mediaFocused !== null) $$("button[data-media-variant]", host).find(el => el.dataset.media === mediaFocused && el.dataset.mediaVariant === mediaVariantFocused)?.focus({preventScroll:true});
    else if (addFocused) $(".add-to-cart", host)?.focus({preventScroll:true});
    else if (quantityFocused) $$("[data-quantity-step]", host).find(el => el.dataset.quantityStep === quantityFocused && !el.disabled)?.focus({preventScroll:true});
  }
  window.addEventListener("hashchange", () => renderRoute(true));

  function loadProducts() {
    if (!catalogRequest) catalogRequest = fetchProducts().finally(() => { catalogRequest = null; });
    return catalogRequest;
  }

  async function fetchProducts() {
    try {
      const response = await fetch(`${apiUrl}/api/v1/products/public`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("Catalog unavailable");
      const data = await response.json();
      if (!Array.isArray(data.items)) throw new Error("Invalid catalog");
      const changed = JSON.stringify(products) !== JSON.stringify(data.items) || !catalogReady;
      products = data.items;
      catalogReady = true;
      catalogFailed = false;
      if (changed) renderProducts();
      $("#catalog-status").textContent = products.length ? "" : "New cards are coming soon.";
      $("#catalog-retry").hidden = true;
      catalogReady = true;
      reconcileCart();
      $(".checkout-trigger").disabled = cart.length === 0;
      return true;
    } catch {
      catalogReady = false;
      catalogFailed = true;
      $("#catalog-status").textContent = "We couldn’t refresh the collection. Please retry.";
      $("#catalog-retry").hidden = false;
      $(".checkout-trigger").disabled = true;
      $$(".add-to-cart").forEach(button => { button.disabled = true; });
      renderRoute();
      return false;
    }
  }
  $("#catalog-retry").addEventListener("click", () => void loadProducts());

  function ensureRotateHandle(el, key) {
    if (!el || !key) return;
    if (!el.querySelector(".corner-pin")) {
      el.insertAdjacentHTML("afterbegin", `
        <span class="corner-pin pin-tl" aria-hidden="true"></span>
        <span class="corner-pin pin-tr" aria-hidden="true"></span>
        <span class="corner-pin pin-bl" aria-hidden="true"></span>
        <span class="corner-pin pin-br" aria-hidden="true"></span>
      `);
    }
    if (!el.querySelector(".element-rotate-handle")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "element-rotate-handle";
      btn.dataset.rotateHandle = key;
      btn.title = "Click to rotate 90°, or drag to rotate freely";
      btn.setAttribute("aria-label", "Rotate element");
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>`;
      el.appendChild(btn);
    }
  }

  function syncCustomCardPreview(productId) {
    const custom = productCustomizations.get(productId) ?? defaultCustomization("01");
    const light = isColorLight(custom.surfaceColor);

    // 1. Update Front Card (Top)
    const frontCard = $("#product-detail .card-view-front");
    if (frontCard) {
      frontCard.style.background = custom.surfaceColor;
      frontCard.style.setProperty("--card-accent", custom.accentColor);
      frontCard.classList.toggle("is-light-surface", light);
      frontCard.classList.toggle("light-card", light);
      frontCard.classList.toggle("dark-card", !light);

      frontCard.className = frontCard.className
        .replace(/\blayout-\S+/g, "")
        .replace(/\bmotif-\S+/g, "")
        .trim() + ` layout-${custom.layout || 'left'} motif-${custom.surfaceMotif || 'facets'}`;

      const existingMotif = frontCard.querySelector(".card-surface-motif");
      const nextMotifHtml = renderSurfaceMotifSvg(custom.surfaceMotif, custom.accentColor);
      if (existingMotif) {
        if (nextMotifHtml) existingMotif.outerHTML = nextMotifHtml;
        else existingMotif.remove();
      } else if (nextMotifHtml) {
        frontCard.insertAdjacentHTML("afterbegin", nextMotifHtml);
      }

      const colBar = frontCard.querySelector(".card-side-column-bar");
      if (custom.layout === "column") {
        if (!colBar) frontCard.insertAdjacentHTML("afterbegin", `<div class="card-side-column-bar" aria-hidden="true"></div>`);
      } else if (colBar) {
        colBar.remove();
      }

      const headerBanner = frontCard.querySelector(".card-header-banner");
      if (custom.layout === "header") {
        if (!headerBanner) frontCard.insertAdjacentHTML("afterbegin", `<div class="card-header-banner" aria-hidden="true"></div>`);
      } else if (headerBanner) {
        headerBanner.remove();
      }

      const ep = custom.elementPositions || {};
      const stName = getElementStyle(custom, "name");
      const stTitle = getElementStyle(custom, "title");
      const stLogo = getElementStyle(custom, "logo");
      const stSign = getElementStyle(custom, "sign");
      const nameSize = `${(1.125 * stName.size / 14).toFixed(3)}rem`;
      const titleSize = `${(0.65 * stTitle.size / 14).toFixed(3)}rem`;

      // 1. Logo element (Customer Logo or "YOUR LOGO" text placeholder)
      const logoEl = frontCard.querySelector(".card-element-logo");
      if (logoEl) {
        logoEl.style.display = "";
        const activeLogo = custom.logoPreviewUrl || custom.logoUrl;
        let logoImg = logoEl.querySelector(".mini-product-logo");
        let logoPlaceholder = logoEl.querySelector(".card-logo-placeholder");

        if (activeLogo) {
          if (logoPlaceholder) logoPlaceholder.remove();
          if (!logoImg) {
            logoImg = document.createElement("img");
            logoEl.appendChild(logoImg);
          }
          logoImg.className = "mini-product-logo custom-user-logo";
          logoImg.src = mediaUrl(activeLogo);
          logoImg.alt = "Custom logo";
          logoImg.style.display = "";
        } else {
          if (logoImg) logoImg.remove();
          if (!logoPlaceholder) {
            logoPlaceholder = document.createElement("span");
            logoPlaceholder.className = "card-logo-placeholder";
            logoPlaceholder.textContent = "YOUR LOGO";
            logoEl.appendChild(logoPlaceholder);
          }
          logoPlaceholder.style.display = "";
          logoPlaceholder.style.color = custom.accentColor;
        }
        const logoScale = ((stLogo.size || 100) / 100).toFixed(2);
        const logoRot = stLogo.rotate || 0;
        logoEl.style.setProperty("--scale", logoScale);
        logoEl.style.setProperty("--rot", `${logoRot}deg`);
        ensureRotateHandle(logoEl, "logo");
        if (ep.logo && ep.logo.x != null && ep.logo.y != null) {
          logoEl.className = "card-drag-item card-element-logo pos-custom";
          logoEl.style.left = `${ep.logo.x}%`;
          logoEl.style.top = `${ep.logo.y}%`;
          logoEl.style.transform = `translate(-50%, -50%) scale(${logoScale}) rotate(${logoRot}deg)`;
        } else {
          logoEl.className = `card-drag-item card-element-logo pos-${custom.layout || 'left'}`;
          logoEl.style.left = ""; logoEl.style.top = "";
          logoEl.style.transform = (custom.layout === "center" || custom.layout === "header")
            ? `translateX(-50%) scale(${logoScale}) rotate(${logoRot}deg)`
            : `scale(${logoScale}) rotate(${logoRot}deg)`;
        }
      }

      // 2. NFC wave sign element
      const nfcEl = frontCard.querySelector(".card-element-nfc");
      if (nfcEl) {
        const iconScale = ((stSign.size || 100) / 100).toFixed(2);
        const signRot = stSign.rotate || 0;
        nfcEl.style.setProperty("--scale", iconScale);
        nfcEl.style.setProperty("--rot", `${signRot}deg`);
        nfcEl.style.color = custom.accentColor;
        ensureRotateHandle(nfcEl, "sign");
        if (ep.sign && ep.sign.x != null && ep.sign.y != null) {
          nfcEl.className = "card-drag-item card-element-nfc pos-custom";
          nfcEl.style.left = `${ep.sign.x}%`;
          nfcEl.style.top = `${ep.sign.y}%`;
          nfcEl.style.transform = `translate(-50%, -50%) scale(${iconScale}) rotate(${signRot}deg)`;
        } else {
          nfcEl.className = `card-drag-item card-element-nfc pos-${custom.layout || 'left'}`;
          nfcEl.style.left = ""; nfcEl.style.top = "";
          nfcEl.style.transform = `scale(${iconScale}) rotate(${signRot}deg)`;
        }
      }

      // 3. Name element
      const nameBox = frontCard.querySelector(".card-element-name");
      const nameEl = frontCard.querySelector(".card-custom-name");
      const activeExtras = (custom.extraLines || []).filter(l => l && l.trim());
      const numExtras = activeExtras.length;

      if (nameBox) {
        const namePos = (ep.name && ep.name.x != null && ep.name.y != null) ? ep.name : ((custom.customPos && custom.customPos.x != null && custom.customPos.y != null) ? custom.customPos : null);
        const nameRot = stName.rotate || 0;
        nameBox.style.setProperty("--rot", `${nameRot}deg`);
        ensureRotateHandle(nameBox, "name");
        if (namePos) {
          nameBox.className = `card-drag-item card-element-name pos-custom font-${stName.font || 'sans'}`;
          nameBox.style.left = `${namePos.x}%`;
          nameBox.style.top = `${namePos.y}%`;
          nameBox.style.bottom = "auto";
          nameBox.style.right = "auto";
          nameBox.style.transform = `translate(-50%, -50%) rotate(${nameRot}deg)`;
        } else {
          nameBox.className = `card-drag-item card-element-name pos-${custom.layout || 'left'} font-${stName.font || 'sans'}`;
          nameBox.style.left = "";
          nameBox.style.top = custom.layout === "reverse" ? "20px" : "";
          nameBox.style.bottom = custom.layout === "reverse" ? "auto" : `${48 + numExtras * 18}px`;
          nameBox.style.right = "";
          nameBox.style.transform = `rotate(${nameRot}deg)`;
        }
      }
      if (nameEl) {
        nameEl.textContent = custom.name ? custom.name.trim() : "Your Name";
        nameEl.classList.toggle("is-placeholder", !custom.name);
        nameEl.classList.toggle("is-bold", Boolean(stName.bold));
        nameEl.classList.toggle("is-not-bold", !stName.bold);
        nameEl.classList.toggle("is-italic", Boolean(stName.italic));
        nameEl.style.fontSize = nameSize;
        nameEl.style.fontWeight = stName.bold ? "700" : "400";
        nameEl.style.fontStyle = stName.italic ? "italic" : "normal";
      }

      // 4. Title element (independent draggable line)
      const legacyDetails = frontCard.querySelector(".card-element-details");
      if (legacyDetails) legacyDetails.remove();

      let titleBox = frontCard.querySelector(".card-element-title");
      if (!titleBox) {
        titleBox = document.createElement("div");
        titleBox.className = `card-drag-item card-element-title pos-${custom.layout || 'left'} font-${stTitle.font || 'sans'}`;
        titleBox.setAttribute("data-drag-element", "title");
        titleBox.setAttribute("data-product-id", productId);
        titleBox.innerHTML = `<span class="card-custom-title" style="color:${custom.accentColor}; font-size:${titleSize};"></span>`;
        frontCard.appendChild(titleBox);
      }
      const titleRot = stTitle.rotate || 0;
      titleBox.style.setProperty("--rot", `${titleRot}deg`);
      ensureRotateHandle(titleBox, "title");
      const titleEl = titleBox.querySelector(".card-custom-title");
      const titlePos = (ep.title && ep.title.x != null && ep.title.y != null) ? ep.title : null;
      if (titlePos) {
        titleBox.className = `card-drag-item card-element-title pos-custom font-${stTitle.font || 'sans'}`;
        titleBox.style.left = `${titlePos.x}%`;
        titleBox.style.top = `${titlePos.y}%`;
        titleBox.style.bottom = "auto";
        titleBox.style.right = "auto";
        titleBox.style.transform = `translate(-50%, -50%) rotate(${titleRot}deg)`;
      } else {
        titleBox.className = `card-drag-item card-element-title pos-${custom.layout || 'left'} font-${stTitle.font || 'sans'}`;
        titleBox.style.left = "";
        titleBox.style.top = custom.layout === "reverse" ? "46px" : "";
        titleBox.style.bottom = custom.layout === "reverse" ? "auto" : `${20 + numExtras * 18}px`;
        titleBox.style.right = "";
        titleBox.style.transform = `rotate(${titleRot}deg)`;
      }
      if (titleEl) {
        titleEl.textContent = custom.title ? custom.title.trim() : (numExtras > 0 ? "" : "Your Title / Role");
        titleEl.classList.toggle("is-placeholder", !custom.title && numExtras === 0);
        titleEl.classList.toggle("is-bold", Boolean(stTitle.bold));
        titleEl.classList.toggle("is-not-bold", !stTitle.bold);
        titleEl.classList.toggle("is-italic", Boolean(stTitle.italic));
        titleEl.style.color = custom.accentColor;
        titleEl.style.fontSize = titleSize;
        titleEl.style.fontWeight = stTitle.bold ? "700" : "400";
        titleEl.style.fontStyle = stTitle.italic ? "italic" : "normal";
      }

      // 5. Extra Lines elements (each line is an independent draggable element)
      frontCard.querySelectorAll(".card-element-extra").forEach(el => el.remove());
      if (Array.isArray(custom.extraLines)) {
        custom.extraLines.forEach((line, idx) => {
          if (!line || !line.trim()) return;
          const extraKey = `extra-${idx}`;
          const stExtra = getElementStyle(custom, extraKey);
          const extraPos = ep[extraKey];
          const extraRot = stExtra.rotate || 0;
          const extraSize = `${(0.65 * stExtra.size / 14).toFixed(3)}rem`;
          const div = document.createElement("div");
          div.setAttribute("data-drag-element", extraKey);
          div.setAttribute("data-product-id", productId);
          div.setAttribute("data-extra-index", String(idx));
          div.style.setProperty("--rot", `${extraRot}deg`);
          if (extraPos) {
            div.className = `card-drag-item card-element-extra pos-custom font-${stExtra.font || 'sans'}`;
            div.style.left = `${extraPos.x}%`;
            div.style.top = `${extraPos.y}%`;
            div.style.bottom = "auto";
            div.style.right = "auto";
            div.style.transform = `translate(-50%, -50%) rotate(${extraRot}deg)`;
          } else {
            div.className = `card-drag-item card-element-extra pos-${custom.layout || 'left'} pos-extra-${idx} font-${stExtra.font || 'sans'}`;
            if (custom.layout === "reverse") {
              div.style.top = `${60 + idx * 16}px`;
              div.style.bottom = "auto";
            } else {
              div.style.bottom = `${22 + (numExtras - 1 - idx) * 16}px`;
              div.style.top = "";
            }
            div.style.transform = `rotate(${extraRot}deg)`;
          }
          const span = document.createElement("span");
          span.className = `card-custom-extra-line ${stExtra.bold ? 'is-bold' : 'is-not-bold'} ${stExtra.italic ? 'is-italic' : ''}`;
          span.style.color = custom.accentColor;
          span.style.fontSize = extraSize;
          span.style.fontWeight = stExtra.bold ? "700" : "400";
          span.style.fontStyle = stExtra.italic ? "italic" : "normal";
          span.textContent = line.trim();
          div.appendChild(span);
          ensureRotateHandle(div, extraKey);
          frontCard.appendChild(div);
        });
      }

      // 6. Divider Lines (Horizontal HR & Vertical)
      frontCard.querySelectorAll(".card-element-divider").forEach(el => el.remove());
      if (Array.isArray(custom.dividerLines)) {
        custom.dividerLines.forEach((line, idx) => {
          const dividerKey = `divider-${idx}`;
          const dividerPos = ep[dividerKey];
          const divRot = dividerPos?.rotate || 0;
          const isVert = line.orientation === "vertical";
          const len = line.length || (isVert ? 60 : 100);
          const div = document.createElement("div");
          div.setAttribute("data-drag-element", dividerKey);
          div.setAttribute("data-divider-index", String(idx));
          div.setAttribute("data-product-id", productId);
          div.className = `card-drag-item card-element-divider divider-${line.orientation || 'horizontal'} ${line.style === 'dashed' ? 'is-dashed' : ''} pos-custom`;
          div.style.setProperty("--divider-len", `${len}px`);
          div.style.setProperty("--rot", `${divRot}deg`);
          div.style.color = custom.accentColor;
          if (dividerPos) {
            div.style.left = `${dividerPos.x}%`;
            div.style.top = `${dividerPos.y}%`;
            div.style.transform = `translate(-50%, -50%) rotate(${divRot}deg)`;
          } else {
            div.style.left = "50%";
            div.style.top = `${50 + idx * 12}%`;
            div.style.transform = `translate(-50%, -50%) rotate(${divRot}deg)`;
          }
          ensureRotateHandle(div, dividerKey);
          frontCard.appendChild(div);
        });
      }
    }

    // 2. Update Back Card (Bottom)
    const backCard = $("#product-detail .card-view-back");
    if (backCard) {
      backCard.style.background = custom.surfaceColor;
      backCard.style.setProperty("--card-accent", custom.accentColor);
      backCard.classList.toggle("is-light-surface", light);
      backCard.classList.toggle("light-card", light);
      backCard.classList.toggle("dark-card", !light);

      const existingBackMotif = backCard.querySelector(".card-surface-motif");
      const nextBackMotifHtml = renderBackMotifSvg(custom.surfaceMotif, custom.accentColor);
      if (existingBackMotif) {
        if (nextBackMotifHtml) existingBackMotif.outerHTML = nextBackMotifHtml;
        else existingBackMotif.remove();
      } else if (nextBackMotifHtml) {
        backCard.insertAdjacentHTML("afterbegin", nextBackMotifHtml);
      }

      const backWave = backCard.querySelector(".card-nfc-wave");
      if (backWave) backWave.style.color = custom.accentColor;

      const qrCenter = backCard.querySelector(".card-back-center-qr");
      const backQrPos = ep["back-qr"];
      const stQr = getElementStyle(custom, "back-qr");
      const qrScale = ((stQr.size || 100) / 100).toFixed(2);
      const qrRot = stQr.rotate || 0;
      if (qrCenter) {
        qrCenter.style.setProperty("--scale", qrScale);
        qrCenter.style.setProperty("--rot", `${qrRot}deg`);
        ensureRotateHandle(qrCenter, "back-qr");
        if (backQrPos && backQrPos.x != null && backQrPos.y != null) {
          qrCenter.className = "card-drag-item card-back-center-qr pos-custom";
          qrCenter.style.left = `${backQrPos.x}%`;
          qrCenter.style.top = `${backQrPos.y}%`;
          qrCenter.style.transform = `translate(-50%, -50%) scale(${qrScale}) rotate(${qrRot}deg)`;
        } else {
          qrCenter.className = "card-drag-item card-back-center-qr";
          qrCenter.style.left = "";
          qrCenter.style.top = "";
          qrCenter.style.transform = `translate(-50%, -50%) scale(${qrScale}) rotate(${qrRot}deg)`;
        }

        let subEl = qrCenter.querySelector(".card-back-subtitle");
        if (custom.backSubtitle && custom.backSubtitle.trim()) {
          if (!subEl) {
            subEl = document.createElement("span");
            subEl.className = "card-back-subtitle";
            qrCenter.appendChild(subEl);
          }
          subEl.style.color = custom.accentColor;
          subEl.textContent = custom.backSubtitle.trim();
        } else if (subEl) {
          subEl.remove();
        }
      }

      const qrWrap = backCard.querySelector(".card-qr-wrap");
      if (qrWrap) {
        qrWrap.className = `card-qr-wrap ${custom.backQrStyle || 'minimal'}`;
        qrWrap.innerHTML = renderQrSvg(custom.accentColor, custom.backQrStyle || 'minimal');
      }

      const backFooter = backCard.querySelector(".card-back-footer");
      if (backFooter) {
        backFooter.style.display = custom.hasOneinfoLogo !== false ? "flex" : "none";
      }
    }

    // Update toolbar inputs and states in studio
    const studio = $(`#product-detail .card-customizer-studio[data-product-id="${productId}"]`);
    if (studio) {
      studio.querySelectorAll(".element-prop-toolbar").forEach(tb => {
        const tbElKey = tb.dataset.toolbarElement;
        if (!tbElKey) return;
        const st = getElementStyle(custom, tbElKey);
        tb.classList.toggle("is-focused", Boolean(selectedElementId && tbElKey === selectedElementId));
        tb.querySelectorAll(".prop-font-btn").forEach(btn => {
          btn.classList.toggle("is-active", btn.dataset.customElementFont === st.font);
        });
        const sizeInp = tb.querySelector("[data-custom-element-size-input]");
        if (sizeInp && document.activeElement !== sizeInp) sizeInp.value = String(st.size);
        const rotInp = tb.querySelector("[data-custom-rot-input]");
        if (rotInp && document.activeElement !== rotInp) rotInp.value = String(st.rotate);
      });
    }

    // 3. Update element selection and on-canvas Quick Inspector
    const stageRoot = document.querySelector(`[data-interactive-card="${productId}"]`)?.closest(".product-art") || document;
    stageRoot.querySelectorAll(".card-drag-item").forEach(item => {
      const isTarget = selectedElementId && item.dataset.dragElement === selectedElementId;
      item.classList.toggle("is-selected", Boolean(isTarget));
    });
    const inspectorWrap = document.getElementById(`stage-inspector-wrap-${productId}`);
    if (inspectorWrap) {
      const activeInp = document.activeElement;
      const isInteractingInspector = activeInp && inspectorWrap.contains(activeInp) && (activeInp.tagName === "INPUT" || activeInp.tagName === "SELECT");
      if (!isInteractingInspector) {
        inspectorWrap.innerHTML = renderQuickInspectorMarkup(productId);
      } else {
        const st = getElementStyle(custom, selectedElementId);
        const rotInp = inspectorWrap.querySelector(`[data-custom-rot-input]`);
        if (rotInp && rotInp !== activeInp) rotInp.value = String(st.rotate);
        const sizeInp = inspectorWrap.querySelector(`[data-custom-element-size-input]`);
        if (sizeInp && sizeInp !== activeInp) sizeInp.value = String(st.size);
        const fontSel = inspectorWrap.querySelector(`[data-custom-font-select]`);
        if (fontSel && fontSel !== activeInp) fontSel.value = st.font;
      }
    }
  }

  function switchStudioTab(rawTabName, productId) {
    const tabName = rawTabName === "style" ? "themes" : rawTabName;
    activeStudioTab = tabName;
    const studio = document.querySelector(`.card-customizer-studio[data-product-id="${productId}"]`);
    if (studio) {
      studio.querySelectorAll(".studio-tab-btn").forEach(b => {
        const bTab = b.dataset.studioTab === "style" ? "themes" : b.dataset.studioTab;
        const isAct = bTab === tabName;
        b.classList.toggle("is-active", isAct);
        b.setAttribute("aria-selected", String(isAct));
      });
      studio.querySelectorAll(".studio-tab-pane").forEach(pane => {
        const isMatch = pane.id === `studio-pane-${tabName}` || (tabName === "themes" && pane.id === "studio-pane-style");
        pane.hidden = !isMatch;
      });
    }
  }

  function selectElement(elKey, productId) {
    selectedElementId = elKey;
    const stageRoot = document.querySelector(`[data-interactive-card="${productId}"]`)?.closest(".product-art") || document;
    stageRoot.querySelectorAll(".card-drag-item").forEach(item => {
      const isTarget = elKey && item.dataset.dragElement === elKey;
      item.classList.toggle("is-selected", Boolean(isTarget));
    });
    const inspectorWrap = document.getElementById(`stage-inspector-wrap-${productId}`);
    if (inspectorWrap) {
      inspectorWrap.innerHTML = renderQuickInspectorMarkup(productId);
    }
    const studio = document.querySelector(`.card-customizer-studio[data-product-id="${productId}"]`);
    if (studio) {
      studio.querySelectorAll(".element-prop-toolbar").forEach(tb => {
        tb.classList.toggle("is-focused", Boolean(elKey && tb.dataset.toolbarElement === elKey));
      });
      if (elKey) {
        if (elKey === "sign" || elKey.startsWith("divider-") || elKey === "back-qr") {
          switchStudioTab("layout", productId);
        } else if (elKey === "logo" || elKey === "name" || elKey === "title" || elKey.startsWith("extra-")) {
          switchStudioTab("details", productId);
        }
      }
    }
  }

  function applyPreset(productId, presetId) {
    const preset = PREMIUM_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    const current = productCustomizations.get(productId) ?? defaultCustomization(presetId);
    current.presetId = preset.id;
    current.layout = preset.layout;
    current.surfaceMotif = preset.motif;
    current.surfaceColor = preset.surfaceColor;
    current.accentColor = preset.accentColor;
    current.position = preset.layout;
    current.customPos = null;
    current.elementPositions = {};
    productCustomizations.set(productId, current);

    const studio = $(`[data-product-id="${productId}"].card-customizer-studio`);
    if (studio) {
      studio.querySelectorAll(".preset-chip").forEach(chip => {
        const match = chip.dataset.customPreset === preset.id;
        chip.classList.toggle("is-selected", match);
        chip.setAttribute("aria-checked", String(match));
      });
      studio.querySelectorAll('[data-custom-set="surfaceMotif"]').forEach(btn => {
        const match = btn.dataset.value === preset.motif;
        btn.classList.toggle("is-selected", match);
        btn.setAttribute("aria-checked", String(match));
      });
      studio.querySelectorAll('[data-custom-set="surfaceColor"]').forEach(btn => {
        const match = btn.dataset.value.toLowerCase() === preset.surfaceColor.toLowerCase();
        btn.classList.toggle("is-selected", match);
        btn.setAttribute("aria-checked", String(match));
      });
      studio.querySelectorAll('[data-custom-set="accentColor"]').forEach(btn => {
        const match = btn.dataset.value.toLowerCase() === preset.accentColor.toLowerCase();
        btn.classList.toggle("is-selected", match);
        btn.setAttribute("aria-checked", String(match));
      });
      studio.querySelectorAll('[data-custom-set="layout"]').forEach(btn => {
        const match = btn.dataset.value === preset.layout;
        btn.classList.toggle("is-selected", match);
        btn.setAttribute("aria-checked", String(match));
      });
      const sLabel = $(`#surface-color-name-${productId}`);
      if (sLabel) sLabel.textContent = SURFACE_COLORS.find(c => c.hex.toLowerCase() === preset.surfaceColor.toLowerCase())?.name || preset.surfaceColor;
      const aLabel = $(`#accent-color-name-${productId}`);
      if (aLabel) aLabel.textContent = ACCENT_COLORS.find(c => c.hex.toLowerCase() === preset.accentColor.toLowerCase())?.name || preset.accentColor;
    }
    syncCustomCardPreview(productId);
  }

  async function handleProductClick(event) {
    if (event.target.closest(".detail-retry")) { void loadProducts(); return; }
    const artItem = event.target.closest(".product-grid .product-art");
    if (artItem && !event.target.closest("button, a")) {
      const pEl = artItem.closest(".product");
      const link = pEl?.querySelector(".product-link");
      if (link) {
        link.click();
        return;
      }
    }
    const quantityButton = event.target.closest("[data-quantity-step]");
    if (quantityButton && !quantityButton.disabled) {
      const id = quantityButton.closest(".product").dataset.id;
      quantities.set(id, Math.min(99, Math.max(1, (quantities.get(id) ?? 1) + Number(quantityButton.dataset.quantityStep))));
      renderRoute(); return;
    }
    const mediaButton = event.target.closest("button[data-media-variant]");
    if (mediaButton) {
      const productId = mediaButton.closest(".product").dataset.id;
      const variantId = mediaButton.dataset.mediaVariant;
      const product = products.find(p=>p.id === productId);
      if (!product) return;
      if (mediaButton.classList.contains("gallery-model-button")) {
        const variant = product.variants.find(v => v.id === variantId);
        const model = variant && productMedia(variant)[Number(mediaButton.dataset.media)];
        if (model?.type !== "model") return;

        selectedModels.set(productId, { variantId, mediaId:model.id });
        const card = mediaButton.closest(".gallery-model-card");
        const viewer = $(".gallery-model", card);
        $(".gallery-model-error", card).hidden = true;
        $("header > span", card).textContent = variant.name;
        $(".gallery-model-stage", card).dataset.appearance = variant.appearance;
        const nextViewer = viewer.cloneNode(false);
        nextViewer.setAttribute("alt", `${product.name} — ${variant.name} 3D model`);
        nextViewer.setAttribute("src", modelSource(model.url));
        viewer.replaceWith(nextViewer);
        watchModel(nextViewer);
        $$(".gallery-model-button", card).forEach(button => button.setAttribute("aria-pressed", String(button === mediaButton)));
        return;
      }
      selectedVariants.set(productId, variantId);
      history.replaceState(null, "", `#product/${encodeURIComponent(product.slug)}?colour=${encodeURIComponent(variantId)}`);
      selectedMedia.set(variantId, Number(mediaButton.dataset.media));
      renderRoute(); return;
    }
    const brandingBtn = event.target.closest("[data-custom-branding]");
    if (brandingBtn) {
      const studio = brandingBtn.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
      if (!productId) return;
      const mode = brandingBtn.dataset.customBranding;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      current.brandingMode = mode;
      current.hasOneinfoLogo = (mode !== "without-logo");
      productCustomizations.set(productId, current);
      renderRoute();
      syncCustomCardPreview(productId);
      return;
    }
    const tabBtn = event.target.closest("[data-studio-tab]");
    if (tabBtn) {
      const studio = tabBtn.closest(".card-customizer-studio");
      const rawTab = tabBtn.dataset.studioTab;
      const tabName = rawTab === "style" ? "themes" : rawTab;
      activeStudioTab = tabName;
      if (studio) {
        studio.querySelectorAll(".studio-tab-btn").forEach(b => {
          const bTab = b.dataset.studioTab === "style" ? "themes" : b.dataset.studioTab;
          const isAct = bTab === tabName;
          b.classList.toggle("is-active", isAct);
          b.setAttribute("aria-selected", String(isAct));
        });
        studio.querySelectorAll(".studio-tab-pane").forEach(pane => {
          const isMatch = pane.id === `studio-pane-${tabName}` || (tabName === "themes" && pane.id === "studio-pane-style");
          pane.hidden = !isMatch;
        });
      }
      return;
    }
    const presetBtn = event.target.closest("[data-custom-preset]");
    if (presetBtn) {
      const studio = presetBtn.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
      if (productId) applyPreset(productId, presetBtn.dataset.customPreset);
      return;
    }
    const removeLogoBtn = event.target.closest("[data-custom-action='remove-logo']");
    if (removeLogoBtn) {
      const studio = removeLogoBtn.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
      if (!productId) return;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      current.logoUrl = "";
      current.logoPreviewUrl = "";
      current.logoFileName = "";
      productCustomizations.set(productId, current);
      renderRoute();
      syncCustomCardPreview(productId);
      return;
    }
    const addLineBtn = event.target.closest("[data-custom-action='add-extra-line']");
    if (addLineBtn) {
      const studio = addLineBtn.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
      if (!productId) return;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (!Array.isArray(current.extraLines)) current.extraLines = [];
      if (current.extraLines.length >= 4) {
        toast("You can add up to 4 additional lines.");
        return;
      }
      current.extraLines.push("");
      if (current.extraLines.length >= 2 && (!current.textSize || current.textSize > 12)) {
        current.textSize = 12;
      }
      productCustomizations.set(productId, current);
      renderRoute();
      syncCustomCardPreview(productId);
      const newIdx = current.extraLines.length - 1;
      const newInput = $(`#custom-extra-${productId}-${newIdx}`);
      newInput?.focus();
      return;
    }
    const removeLineBtn = event.target.closest("[data-custom-action='remove-extra-line']");
    if (removeLineBtn) {
      const studio = removeLineBtn.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
      if (!productId) return;
      const lineIdx = parseInt(removeLineBtn.dataset.lineIndex, 10);
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (Array.isArray(current.extraLines) && !isNaN(lineIdx)) {
        current.extraLines.splice(lineIdx, 1);
        productCustomizations.set(productId, current);
        renderRoute();
        syncCustomCardPreview(productId);
      }
      return;
    }
    const deselectBtn = event.target.closest("[data-custom-action='deselect-element']");
    if (deselectBtn) {
      const container = deselectBtn.closest(".card-quick-inspector, .card-customizer-studio, .product");
      const productId = container?.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (productId) selectElement(null, productId);
      return;
    }
    const toggleTextStyleBtn = event.target.closest("[data-custom-toggle-style]");
    if (toggleTextStyleBtn) {
      const container = toggleTextStyleBtn.closest(".card-customizer-studio, .card-quick-inspector, .element-prop-toolbar, .product");
      const productId = container?.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (!productId) return;
      const targetKey = toggleTextStyleBtn.dataset.targetElement || selectedElementId || "name";
      const styleType = toggleTextStyleBtn.dataset.customToggleStyle; // "bold" or "italic"
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      const st = getElementStyle(current, targetKey);
      const nextVal = !st[styleType];

      if (!current.elementPositions) current.elementPositions = {};
      if (!current.elementPositions[targetKey]) {
        current.elementPositions[targetKey] = {
          rotate: st.rotate,
          size: st.size,
          font: st.font,
          bold: styleType === "bold" ? nextVal : st.bold,
          italic: styleType === "italic" ? nextVal : st.italic,
        };
      } else {
        current.elementPositions[targetKey][styleType] = nextVal;
      }
      if (targetKey === "name") {
        current[styleType] = nextVal;
      }

      toggleTextStyleBtn.classList.toggle("is-active", nextVal);
      toggleTextStyleBtn.setAttribute("aria-pressed", String(nextVal));

      productCustomizations.set(productId, current);
      syncCustomCardPreview(productId);
      return;
    }
    const elemFontBtn = event.target.closest("[data-custom-element-font]");
    if (elemFontBtn) {
      const container = elemFontBtn.closest(".card-customizer-studio, .card-quick-inspector, .element-prop-toolbar, .product");
      const productId = container?.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (!productId) return;
      const targetKey = elemFontBtn.dataset.targetElement || selectedElementId || "name";
      const fontVal = elemFontBtn.dataset.customElementFont;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (!current.elementPositions) current.elementPositions = {};
      if (!current.elementPositions[targetKey]) {
        current.elementPositions[targetKey] = { rotate: 0, font: fontVal };
      } else {
        current.elementPositions[targetKey].font = fontVal;
      }
      if (targetKey === "name") {
        current.font = fontVal;
      }
      productCustomizations.set(productId, current);
      syncCustomCardPreview(productId);
      return;
    }
    const elemSizeStepBtn = event.target.closest("[data-custom-element-size-step]");
    if (elemSizeStepBtn) {
      const container = elemSizeStepBtn.closest(".card-customizer-studio, .card-quick-inspector, .element-prop-toolbar, .product");
      const productId = container?.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (!productId) return;
      const targetKey = elemSizeStepBtn.dataset.targetElement || selectedElementId || "name";
      const delta = parseInt(elemSizeStepBtn.dataset.customElementSizeStep, 10) || 1;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      const st = getElementStyle(current, targetKey);
      const isText = targetKey === "name" || targetKey === "title" || targetKey.startsWith("extra-");
      const minVal = isText ? 7 : 30;
      const maxVal = isText ? 32 : 250;
      let newSize = Math.max(minVal, Math.min(maxVal, st.size + delta));
      if (!current.elementPositions) current.elementPositions = {};
      if (!current.elementPositions[targetKey]) {
        current.elementPositions[targetKey] = { rotate: st.rotate, size: newSize, font: st.font, bold: st.bold, italic: st.italic };
      } else {
        current.elementPositions[targetKey].size = newSize;
      }
      if (targetKey === "name") {
        current.textSize = newSize;
      }
      productCustomizations.set(productId, current);
      syncCustomCardPreview(productId);
      return;
    }
    const propToolbar = event.target.closest(".element-prop-toolbar");
    if (propToolbar && propToolbar.dataset.toolbarElement && !event.target.closest("button, input")) {
      const productId = propToolbar.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (productId && selectedElementId !== propToolbar.dataset.toolbarElement) {
        selectElement(propToolbar.dataset.toolbarElement, productId);
      }
    }
    const stepBtn = event.target.closest("[data-custom-text-size-step]");
    if (stepBtn) {
      const container = stepBtn.closest(".card-customizer-studio, .card-quick-inspector, .product");
      const productId = container?.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (!productId) return;
      const delta = parseInt(stepBtn.dataset.customTextSizeStep, 10);
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      let size = (current.textSize || 14) + delta;
      if (size < 8) size = 8;
      if (size > 28) size = 28;
      current.textSize = size;
      productCustomizations.set(productId, current);
      const studio = document.querySelector(`.card-customizer-studio[data-product-id="${productId}"]`);
      const inputEl = studio?.querySelector(`#text-size-input-${productId}`) || studio?.querySelector("[data-custom-text-size-input]");
      if (inputEl) inputEl.value = String(size);
      const valEl = $(`#text-size-val-${productId}`);
      if (valEl) valEl.textContent = `${size} pt`;
      syncCustomCardPreview(productId);
      return;
    }
    const sizePill = event.target.closest("[data-custom-text-size]");
    if (sizePill) {
      const studio = sizePill.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (!productId) return;
      const size = parseInt(sizePill.dataset.customTextSize, 10);
      if (isNaN(size)) return;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      current.textSize = size;
      productCustomizations.set(productId, current);
      const inputEl = studio.querySelector(`#text-size-input-${productId}`) || studio.querySelector("[data-custom-text-size-input]");
      if (inputEl) inputEl.value = String(size);
      const valEl = $(`#text-size-val-${productId}`);
      if (valEl) valEl.textContent = `${size} pt`;
      syncCustomCardPreview(productId);
      return;
    }
    const iconStepBtn = event.target.closest("[data-custom-icon-size-step]");
    if (iconStepBtn) {
      const container = iconStepBtn.closest(".card-customizer-studio, .card-quick-inspector, .product");
      const productId = container?.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (!productId) return;
      const delta = parseInt(iconStepBtn.dataset.customIconSizeStep, 10);
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      let size = (current.iconSize || 100) + delta;
      if (size < 40) size = 40;
      if (size > 220) size = 220;
      current.iconSize = size;
      productCustomizations.set(productId, current);
      const studio = document.querySelector(`.card-customizer-studio[data-product-id="${productId}"]`);
      const inputEl = studio?.querySelector(`#icon-size-input-${productId}`) || studio?.querySelector("[data-custom-icon-size-input]");
      if (inputEl) inputEl.value = String(size);
      const valEl = $(`#icon-size-val-${productId}`);
      if (valEl) valEl.textContent = `${size}%`;
      syncCustomCardPreview(productId);
      return;
    }
    const iconSizePill = event.target.closest("[data-custom-icon-size]");
    if (iconSizePill) {
      const container = iconSizePill.closest(".card-customizer-studio, .card-quick-inspector, .product");
      const productId = container?.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (!productId) return;
      const size = parseInt(iconSizePill.dataset.customIconSize, 10);
      if (isNaN(size)) return;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      current.iconSize = size;
      productCustomizations.set(productId, current);
      const studio = document.querySelector(`.card-customizer-studio[data-product-id="${productId}"]`);
      const inputEl = studio?.querySelector(`#icon-size-input-${productId}`) || studio?.querySelector("[data-custom-icon-size-input]");
      if (inputEl) inputEl.value = String(size);
      const valEl = $(`#icon-size-val-${productId}`);
      if (valEl) valEl.textContent = `${size}%`;
      syncCustomCardPreview(productId);
      return;
    }
    const logoStepBtn = event.target.closest("[data-custom-logo-size-step]");
    if (logoStepBtn) {
      const container = logoStepBtn.closest(".card-customizer-studio, .card-quick-inspector, .product");
      const productId = container?.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (!productId) return;
      const delta = parseInt(logoStepBtn.dataset.customLogoSizeStep, 10);
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      let size = (current.logoSize || 100) + delta;
      if (size < 40) size = 40;
      if (size > 220) size = 220;
      current.logoSize = size;
      productCustomizations.set(productId, current);
      const studio = document.querySelector(`.card-customizer-studio[data-product-id="${productId}"]`);
      const inputEl = studio?.querySelector(`#logo-size-input-${productId}`) || studio?.querySelector("[data-custom-logo-size-input]");
      if (inputEl) inputEl.value = String(size);
      const valEl = $(`#logo-size-val-${productId}`);
      if (valEl) valEl.textContent = `${size}%`;
      syncCustomCardPreview(productId);
      return;
    }
    const logoSizePill = event.target.closest("[data-custom-logo-size]");
    if (logoSizePill) {
      const container = logoSizePill.closest(".card-customizer-studio, .card-quick-inspector, .product");
      const productId = container?.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (!productId) return;
      const size = parseInt(logoSizePill.dataset.customLogoSize, 10);
      if (isNaN(size)) return;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      current.logoSize = size;
      productCustomizations.set(productId, current);
      const studio = document.querySelector(`.card-customizer-studio[data-product-id="${productId}"]`);
      const inputEl = studio?.querySelector(`#logo-size-input-${productId}`) || studio?.querySelector("[data-custom-logo-size-input]");
      if (inputEl) inputEl.value = String(size);
      const valEl = $(`#logo-size-val-${productId}`);
      if (valEl) valEl.textContent = `${size}%`;
      syncCustomCardPreview(productId);
      return;
    }
    const qrStepBtn = event.target.closest("[data-custom-qr-size-step]");
    if (qrStepBtn) {
      const container = qrStepBtn.closest(".card-customizer-studio, .card-quick-inspector, .product");
      const productId = container?.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (!productId) return;
      const delta = parseInt(qrStepBtn.dataset.customQrSizeStep, 10);
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      let size = (current.qrSize || 100) + delta;
      if (size < 40) size = 40;
      if (size > 200) size = 200;
      current.qrSize = size;
      productCustomizations.set(productId, current);
      const studio = document.querySelector(`.card-customizer-studio[data-product-id="${productId}"]`);
      const inputEl = studio?.querySelector(`#qr-size-input-${productId}`) || studio?.querySelector("[data-custom-qr-size-input]");
      if (inputEl) inputEl.value = String(size);
      const valEl = $(`#qr-size-val-${productId}`);
      if (valEl) valEl.textContent = `${size}%`;
      syncCustomCardPreview(productId);
      return;
    }
    const qrSizePill = event.target.closest("[data-custom-qr-size]");
    if (qrSizePill) {
      const container = qrSizePill.closest(".card-customizer-studio, .card-quick-inspector, .product");
      const productId = container?.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (!productId) return;
      const size = parseInt(qrSizePill.dataset.customQrSize, 10);
      if (isNaN(size)) return;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      current.qrSize = size;
      productCustomizations.set(productId, current);
      const studio = document.querySelector(`.card-customizer-studio[data-product-id="${productId}"]`);
      const inputEl = studio?.querySelector(`#qr-size-input-${productId}`) || studio?.querySelector("[data-custom-qr-size-input]");
      if (inputEl) inputEl.value = String(size);
      const valEl = $(`#qr-size-val-${productId}`);
      if (valEl) valEl.textContent = `${size}%`;
      syncCustomCardPreview(productId);
      return;
    }
    const rotStepBtn = event.target.closest("[data-custom-rot-step]");
    if (rotStepBtn) {
      const container = rotStepBtn.closest(".card-customizer-studio, .card-quick-inspector, .element-prop-toolbar, .product");
      const productId = container?.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (!productId) return;
      const delta = parseInt(rotStepBtn.dataset.customRotStep, 10) || 15;
      const targetKey = rotStepBtn.dataset.rotTarget || selectedElementId || "name";
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (!current.elementPositions) current.elementPositions = {};
      const oldRot = current.elementPositions[targetKey]?.rotate || (targetKey === "name" ? (current.customPos?.rotate || 0) : 0);
      let newRot = Math.round((oldRot + delta) % 360);
      if (newRot < 0) newRot += 360;
      if (!current.elementPositions[targetKey]) {
        current.elementPositions[targetKey] = { rotate: newRot };
      } else {
        current.elementPositions[targetKey].rotate = newRot;
      }
      productCustomizations.set(productId, current);
      const inspectorRotInp = document.getElementById(`inspector-rot-input-${productId}`) || document.querySelector(`[data-custom-rot-input="${targetKey}"]`);
      if (inspectorRotInp) inspectorRotInp.value = String(newRot);
      const studio = document.querySelector(`.card-customizer-studio[data-product-id="${productId}"]`);
      const inputEl = studio?.querySelector(`#rot-input-${targetKey}-${productId}`);
      if (inputEl) inputEl.value = String(newRot);
      if (studio) {
        studio.querySelectorAll(`[data-custom-rot-pill='${targetKey}']`).forEach(p => {
          p.classList.toggle("is-selected", parseInt(p.dataset.rot, 10) === newRot);
        });
      }
      syncCustomCardPreview(productId);
      return;
    }
    const nfcPosBtn = event.target.closest("[data-custom-nfc-pos]");
    if (nfcPosBtn) {
      const container = nfcPosBtn.closest(".card-customizer-studio, .product");
      const productId = container?.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (!productId) return;
      const posCode = nfcPosBtn.dataset.customNfcPos;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (!current.elementPositions) current.elementPositions = {};
      const signRot = current.elementPositions.sign?.rotate || 0;
      const signSize = current.elementPositions.sign?.size || current.iconSize || 100;
      let pos = { x: 88, y: 15 };
      if (posCode === "tl") pos = { x: 12, y: 15 };
      else if (posCode === "bl") pos = { x: 12, y: 85 };
      else if (posCode === "br") pos = { x: 88, y: 85 };
      current.elementPositions.sign = { ...pos, rotate: signRot, size: signSize };
      productCustomizations.set(productId, current);
      syncCustomCardPreview(productId);
      return;
    }
    const rotPill = event.target.closest("[data-custom-rot-pill]");
    if (rotPill) {
      const container = rotPill.closest(".card-customizer-studio, .card-quick-inspector");
      const productId = container?.dataset.productId;
      if (!productId) return;
      const targetKey = rotPill.dataset.customRotPill;
      const rotVal = parseInt(rotPill.dataset.rot, 10) || 0;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (!current.elementPositions) current.elementPositions = {};
      if (!current.elementPositions[targetKey]) {
        current.elementPositions[targetKey] = { rotate: rotVal };
      } else {
        current.elementPositions[targetKey].rotate = rotVal;
      }
      productCustomizations.set(productId, current);
      const studio = document.querySelector(`.card-customizer-studio[data-product-id="${productId}"]`);
      const inputEl = studio?.querySelector(`#rot-input-${targetKey}-${productId}`);
      if (inputEl) inputEl.value = String(rotVal);
      if (studio) {
        studio.querySelectorAll(`[data-custom-rot-pill='${targetKey}']`).forEach(p => {
          p.classList.toggle("is-selected", p === rotPill);
        });
      }
      syncCustomCardPreview(productId);
      return;
    }
    const rotateToolbarBtn = event.target.closest("[data-custom-rotate-btn]");
    if (rotateToolbarBtn) {
      const container = rotateToolbarBtn.closest(".card-customizer-studio, .card-quick-inspector");
      const productId = container?.dataset.productId;
      if (!productId) return;
      const elKey = rotateToolbarBtn.dataset.customRotateBtn;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (!current.elementPositions) current.elementPositions = {};
      const oldRot = current.elementPositions[elKey]?.rotate || 0;
      const nextRot = (oldRot + 90) % 360;
      if (!current.elementPositions[elKey]) {
        current.elementPositions[elKey] = { rotate: nextRot };
      } else {
        current.elementPositions[elKey].rotate = nextRot;
      }
      productCustomizations.set(productId, current);
      syncCustomCardPreview(productId);
      return;
    }
    const addDividerBtn = event.target.closest("[data-custom-action='add-divider-line']");
    if (addDividerBtn) {
      const container = addDividerBtn.closest(".card-customizer-studio, .card-quick-inspector");
      const productId = container?.dataset.productId;
      if (!productId) return;
      const orient = addDividerBtn.dataset.dividerOrient === "vertical" ? "vertical" : "horizontal";
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (!Array.isArray(current.dividerLines)) current.dividerLines = [];
      if (current.dividerLines.length < 4) {
        current.dividerLines.push({
          orientation: orient,
          length: orient === "vertical" ? 60 : 100,
          style: "solid",
        });
        productCustomizations.set(productId, current);
        renderRoute();
        syncCustomCardPreview(productId);
      }
      return;
    }
    const removeDividerBtn = event.target.closest("[data-custom-action='remove-divider-line']");
    if (removeDividerBtn) {
      const container = removeDividerBtn.closest(".card-customizer-studio, .card-quick-inspector");
      const productId = container?.dataset.productId;
      if (!productId) return;
      const idx = parseInt(removeDividerBtn.dataset.dividerIndex, 10);
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (Array.isArray(current.dividerLines) && !isNaN(idx)) {
        current.dividerLines.splice(idx, 1);
        if (current.elementPositions) {
          delete current.elementPositions[`divider-${idx}`];
        }
        productCustomizations.set(productId, current);
        renderRoute();
        syncCustomCardPreview(productId);
      }
      return;
    }
    const toggleOrientBtn = event.target.closest("[data-custom-action='toggle-divider-orient']");
    if (toggleOrientBtn) {
      const container = toggleOrientBtn.closest(".card-customizer-studio, .card-quick-inspector");
      const productId = container?.dataset.productId;
      if (!productId) return;
      const idx = parseInt(toggleOrientBtn.dataset.dividerIndex, 10);
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (Array.isArray(current.dividerLines) && current.dividerLines[idx]) {
        const line = current.dividerLines[idx];
        line.orientation = line.orientation === "vertical" ? "horizontal" : "vertical";
        if (line.orientation === "vertical" && line.length > 140) line.length = 70;
        productCustomizations.set(productId, current);
        renderRoute();
        syncCustomCardPreview(productId);
      }
      return;
    }
    const toggleStyleBtn = event.target.closest("[data-custom-action='toggle-divider-style']");
    if (toggleStyleBtn) {
      const container = toggleStyleBtn.closest(".card-customizer-studio, .card-quick-inspector");
      const productId = container?.dataset.productId;
      if (!productId) return;
      const idx = parseInt(toggleStyleBtn.dataset.dividerIndex, 10);
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (Array.isArray(current.dividerLines) && current.dividerLines[idx]) {
        const line = current.dividerLines[idx];
        line.style = line.style === "dashed" ? "solid" : "dashed";
        productCustomizations.set(productId, current);
        renderRoute();
        syncCustomCardPreview(productId);
      }
      return;
    }
    const stepLenBtn = event.target.closest("[data-custom-action='step-divider-len']");
    if (stepLenBtn) {
      const container = stepLenBtn.closest(".card-customizer-studio, .card-quick-inspector");
      const productId = container?.dataset.productId;
      if (!productId) return;
      const idx = parseInt(stepLenBtn.dataset.dividerIndex, 10);
      const step = parseInt(stepLenBtn.dataset.step, 10);
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (Array.isArray(current.dividerLines) && current.dividerLines[idx]) {
        const line = current.dividerLines[idx];
        const isVert = line.orientation === "vertical";
        const minLen = 20;
        const maxLen = isVert ? 160 : 300;
        let newLen = (line.length || (isVert ? 60 : 100)) + step;
        if (newLen < minLen) newLen = minLen;
        if (newLen > maxLen) newLen = maxLen;
        line.length = newLen;
        productCustomizations.set(productId, current);
        renderRoute();
        syncCustomCardPreview(productId);
      }
      return;
    }
    const pill = event.target.closest("[data-custom-set]");
    if (pill) {
      const container = pill.closest(".card-customizer-studio, .card-quick-inspector");
      const productId = container?.dataset.productId;
      if (!productId) return;
      const prop = pill.dataset.customSet;
      const val = pill.dataset.value;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      current[prop] = val;
      if (prop === "layout") {
        current.position = val;
        current.customPos = null;
        current.elementPositions = {};
      }
      const studio = document.querySelector(`.card-customizer-studio[data-product-id="${productId}"]`);
      if (studio && (prop === "surfaceMotif" || prop === "surfaceColor" || prop === "accentColor" || prop === "layout")) {
        current.presetId = undefined;
        studio.querySelectorAll(".preset-chip").forEach(chip => {
          chip.classList.remove("is-selected");
          chip.setAttribute("aria-checked", "false");
        });
      }
      productCustomizations.set(productId, current);

      const group = pill.closest(".customizer-pills, .color-swatches-grid, .inspector-group");
      group?.querySelectorAll(".customizer-pill, .palette-swatch, .inspector-btn").forEach(p => {
        const isMatch = p === pill;
        p.classList.toggle("is-selected", isMatch);
        p.classList.toggle("is-active", isMatch);
        p.setAttribute("aria-checked", String(isMatch));
      });

      if (prop === "surfaceColor") {
        const label = $(`#surface-color-name-${productId}`);
        if (label) label.textContent = SURFACE_COLORS.find(c => c.hex.toLowerCase() === val.toLowerCase())?.name || val;
      } else if (prop === "accentColor") {
        const label = $(`#accent-color-name-${productId}`);
        if (label) label.textContent = ACCENT_COLORS.find(c => c.hex.toLowerCase() === val.toLowerCase())?.name || val;
      }

      syncCustomCardPreview(productId);
      return;
    }
    const swatch = event.target.closest(".colour-swatch");
    if (swatch && catalogReady) {
      const id = swatch.closest(".product").dataset.id;
      selectedVariants.set(id, swatch.dataset.variant);
      selectedMedia.delete(swatch.dataset.variant);
      if (swatch.closest("#product-detail")) {
        const p = products.find(p => p.id === id);
        history.replaceState(null, "", `#product/${encodeURIComponent(p.slug)}?colour=${encodeURIComponent(swatch.dataset.variant)}`);
      }
      renderProducts(); return;
    }
    const button = event.target.closest(".add-to-cart");
    if (!button || button.disabled || !catalogReady || addingToCart) return;
    const productId = button.closest(".product").dataset.id;
    const variantId = selectedVariants.get(productId);
    const before = products.find(p => p.id === productId)?.variants.find(v => v.id === variantId);
    const quantity = quantities.get(productId) ?? 1;
    addingToCart = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true"); button.textContent = "Adding…";
    try {
      if (!await loadProducts()) { toast("Please retry loading this product."); return; }
      const product = products.find(p => p.id === productId);
      const variant = product?.variants.find(v => v.id === variantId);
      if (!variant?.available) { toast("This colour is no longer available."); return; }
      const draft = productCustomizations.get(productId) ?? defaultCustomization("01");
      const hasLogo = !product.customizable || (draft.hasOneinfoLogo !== false && draft.brandingMode !== "without-logo");
      const expectedBefore = product.customizable ? variantPriceForBranding(before, hasLogo) : variantPrice(before);
      const expectedVariant = product.customizable ? variantPriceForBranding(variant, hasLogo) : variantPrice(variant);
      if (!before || expectedBefore !== expectedVariant) { toast("The price changed. Please review it before adding to cart."); return; }

      let customization = null;
      if (product.customizable) {
        if (!draft.name || !draft.name.trim()) {
          toast("Please enter your cardholder name to personalize your card.");
          $(`#custom-name-${productId}`)?.focus();
          addingToCart = false;
          button.disabled = false;
          button.removeAttribute("aria-busy");
          button.textContent = "Add to cart";
          return;
        }
        const stName = getElementStyle(draft, "name");
        customization = {
          name: draft.name.trim(),
          title: (draft.title || "").trim(),
          extraLines: (draft.extraLines || []).map(l => (l || "").trim()).filter(Boolean),
          textSize: stName.size || draft.textSize || 14,
          logoSize: draft.logoSize || 100,
          iconSize: draft.iconSize || 100,
          qrSize: draft.qrSize || 100,
          dividerLines: (draft.dividerLines || []),
          brandingMode: draft.brandingMode || "with-logo",
          hasOneinfoLogo: hasLogo,
          bold: stName.bold,
          italic: stName.italic,
          font: stName.font || draft.font || "sans",
          ...(draft.customPos ? { customPos: draft.customPos } : {}),
          ...(draft.elementPositions && Object.keys(draft.elementPositions).length ? { elementPositions: draft.elementPositions } : {}),
          layout: draft.layout || "left",
          surfaceMotif: draft.surfaceMotif || "facets",
          surfaceColor: draft.surfaceColor || "#0a0b0d",
          accentColor: draft.accentColor || "#d8b26e",
          finish: draft.finish || "matte",
          backQrStyle: draft.backQrStyle || "minimal",
          backSubtitle: (draft.backSubtitle || "").trim(),
          ...(draft.logoUrl ? { logoUrl: draft.logoUrl } : {}),
          ...(draft.logoStyle ? { logoStyle: draft.logoStyle } : {}),
          ...(draft.companyName ? { companyName: draft.companyName.trim() } : {}),
          ...(draft.presetId ? { presetId: draft.presetId } : {}),
          position: draft.layout || draft.position || "left",
        };
      }

      const nextCart = addCartVariant(cart, product, variant, quantity, customization);
      save(storageKey, nextCart); cart = nextCart; renderCart();
      toast(`${quantity} x ${product.name} · ${variant.name}${customization ? ` (${customization.name})` : ""} added to cart`);
    } catch (error) { toast(error instanceof RangeError ? error.message : "Could not save the cart. Please try again."); }
    finally { addingToCart = false; renderRoute(); }
  }
  $(".product-grid").addEventListener("click", event => void handleProductClick(event));
  $("#product-detail").addEventListener("click", event => void handleProductClick(event));
  $("#product-detail").addEventListener("input", event => {
    const fontSelect = event.target.closest("[data-custom-font-select]");
    if (fontSelect) {
      const container = fontSelect.closest(".card-customizer-studio, .card-quick-inspector, .element-prop-toolbar, .product");
      const productId = container?.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (!productId) return;
      const targetKey = fontSelect.dataset.customFontSelect || selectedElementId || "name";
      const fontVal = fontSelect.value;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (!current.elementPositions) current.elementPositions = {};
      if (!current.elementPositions[targetKey]) {
        current.elementPositions[targetKey] = { rotate: 0, font: fontVal };
      } else {
        current.elementPositions[targetKey].font = fontVal;
      }
      if (targetKey === "name") {
        current.font = fontVal;
      }
      productCustomizations.set(productId, current);
      syncCustomCardPreview(productId);
      return;
    }
    const elemSizeInput = event.target.closest("[data-custom-element-size-input]");
    if (elemSizeInput) {
      const container = elemSizeInput.closest(".card-customizer-studio, .card-quick-inspector, .element-prop-toolbar, .product");
      const productId = container?.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (!productId) return;
      const targetKey = elemSizeInput.dataset.customElementSizeInput;
      let val = parseInt(elemSizeInput.value, 10);
      if (isNaN(val)) return;
      const isText = targetKey === "name" || targetKey === "title" || targetKey.startsWith("extra-");
      const minVal = isText ? 6 : 20;
      const maxVal = isText ? 36 : 300;
      const clamped = Math.max(minVal, Math.min(maxVal, val));
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (!current.elementPositions) current.elementPositions = {};
      if (!current.elementPositions[targetKey]) {
        current.elementPositions[targetKey] = { rotate: 0, size: clamped };
      } else {
        current.elementPositions[targetKey].size = clamped;
      }
      if (targetKey === "name") {
        current.textSize = clamped;
      }
      productCustomizations.set(productId, current);
      syncCustomCardPreview(productId);
      return;
    }
    const rotInput = event.target.closest("[data-custom-rot-input]");
    if (rotInput) {
      const container = rotInput.closest(".card-customizer-studio, .card-quick-inspector, .element-prop-toolbar, .product");
      const productId = container?.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (!productId) return;
      const targetKey = rotInput.dataset.customRotInput;
      let val = parseInt(rotInput.value, 10);
      if (isNaN(val)) val = 0;
      val = ((val % 360) + 360) % 360;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (!current.elementPositions) current.elementPositions = {};
      if (!current.elementPositions[targetKey]) {
        current.elementPositions[targetKey] = { rotate: val };
      } else {
        current.elementPositions[targetKey].rotate = val;
      }
      productCustomizations.set(productId, current);
      const studio = document.querySelector(`.card-customizer-studio[data-product-id="${productId}"]`);
      if (studio) {
        studio.querySelectorAll(`[data-custom-rot-pill='${targetKey}']`).forEach(p => {
          p.classList.toggle("is-selected", parseInt(p.dataset.rot, 10) === val);
        });
      }
      syncCustomCardPreview(productId);
      return;
    }
    const textSizeInput = event.target.closest("[data-custom-text-size-input]");
    if (textSizeInput) {
      const container = textSizeInput.closest(".card-customizer-studio, .card-quick-inspector");
      const productId = container?.dataset.productId;
      if (!productId) return;
      let val = parseInt(textSizeInput.value, 10);
      if (isNaN(val)) val = 14;
      if (val < 6) val = 6;
      if (val > 48) val = 48;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      current.textSize = val;
      productCustomizations.set(productId, current);
      syncCustomCardPreview(productId);
      return;
    }
    const logoSizeInput = event.target.closest("[data-custom-logo-size-input]");
    if (logoSizeInput) {
      const container = logoSizeInput.closest(".card-customizer-studio, .card-quick-inspector");
      const productId = container?.dataset.productId;
      if (!productId) return;
      let val = parseInt(logoSizeInput.value, 10);
      if (isNaN(val)) val = 100;
      if (val < 20) val = 20;
      if (val > 300) val = 300;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      current.logoSize = val;
      productCustomizations.set(productId, current);
      syncCustomCardPreview(productId);
      return;
    }
    const iconSizeInput = event.target.closest("[data-custom-icon-size-input]");
    if (iconSizeInput) {
      const container = iconSizeInput.closest(".card-customizer-studio, .card-quick-inspector");
      const productId = container?.dataset.productId;
      if (!productId) return;
      let val = parseInt(iconSizeInput.value, 10);
      if (isNaN(val)) val = 100;
      if (val < 20) val = 20;
      if (val > 300) val = 300;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      current.iconSize = val;
      productCustomizations.set(productId, current);
      syncCustomCardPreview(productId);
      return;
    }
    const qrSizeInput = event.target.closest("[data-custom-qr-size-input]");
    if (qrSizeInput) {
      const container = qrSizeInput.closest(".card-customizer-studio, .card-quick-inspector");
      const productId = container?.dataset.productId;
      if (!productId) return;
      let val = parseInt(qrSizeInput.value, 10);
      if (isNaN(val)) val = 100;
      if (val < 20) val = 20;
      if (val > 300) val = 300;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      current.qrSize = val;
      productCustomizations.set(productId, current);
      syncCustomCardPreview(productId);
      return;
    }
    const colorInput = event.target.closest("[data-custom-color]");
    if (colorInput) {
      const studio = colorInput.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
      if (!productId) return;
      const prop = colorInput.dataset.customColor;
      const val = colorInput.value;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      current[prop] = val;
      current.presetId = undefined;
      productCustomizations.set(productId, current);

      colorInput.closest(".custom-hex-swatch")?.style.setProperty("--swatch-color", val);
      const group = colorInput.closest(".color-swatches-grid");
      group?.querySelectorAll(".palette-swatch").forEach(s => s.classList.remove("is-selected"));
      colorInput.closest(".custom-hex-swatch")?.classList.add("is-selected");

      const label = $(`#${prop === "surfaceColor" ? "surface" : "accent"}-color-name-${productId}`);
      if (label) label.textContent = val.toUpperCase();

      syncCustomCardPreview(productId);
      return;
    }
    const extraInput = event.target.closest("[data-custom-extra-line]");
    if (extraInput) {
      const studio = extraInput.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
      if (!productId) return;
      const lineIdx = parseInt(extraInput.dataset.customExtraLine, 10);
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (!Array.isArray(current.extraLines)) current.extraLines = [];
      current.extraLines[lineIdx] = extraInput.value;
      productCustomizations.set(productId, current);

      const countEl = $(`#extra-count-${productId}-${lineIdx}`);
      if (countEl) countEl.textContent = `${extraInput.value.length}/35`;

      syncCustomCardPreview(productId);
      return;
    }
    const input = event.target.closest("[data-custom-input]");
    if (!input) return;
    const studio = input.closest(".card-customizer-studio");
    const productId = studio?.dataset.productId;
    if (!productId) return;
    const field = input.dataset.customInput;
    const current = productCustomizations.get(productId) ?? defaultCustomization("01");
    current[field] = input.value;
    productCustomizations.set(productId, current);

    if (field === "name") {
      const nameEl = $("#product-detail .card-view-front .card-custom-name");
      const countEl = $(`#name-count-${productId}`);
      if (nameEl) {
        nameEl.textContent = input.value.trim() || "Your Name";
        nameEl.classList.toggle("is-placeholder", !input.value.trim());
      }
      if (countEl) countEl.textContent = `${input.value.length}/25`;
    } else if (field === "title") {
      const titleEl = $("#product-detail .card-view-front .card-custom-title");
      const countEl = $(`#title-count-${productId}`);
      if (titleEl) {
        titleEl.textContent = input.value.trim() || "Your Title / Role";
        titleEl.classList.toggle("is-placeholder", !input.value.trim());
      }
      if (countEl) countEl.textContent = `${input.value.length}/35`;
    } else if (field === "backSubtitle") {
      const backSubEl = $("#product-detail .card-view-back .card-back-subtitle");
      const countEl = $(`#back-sub-count-${productId}`);
      const val = input.value.trim() || "oneinfo.me";
      if (backSubEl) backSubEl.textContent = val;
      if (countEl) countEl.textContent = `${input.value.length}/80`;
    } else if (field === "companyName") {
      const logoEl = $("#product-detail .card-view-front .custom-user-logo");
      if (logoEl) logoEl.alt = `${input.value.trim() || current.name || 'Company'} logo`;
    }
    syncCustomCardPreview(productId);
  });

  $("#product-detail").addEventListener("focusin", event => {
    const pId = event.target.closest(".product")?.dataset.id;
    if (!pId) return;
    const nameInp = event.target.closest("[data-custom-input='name']");
    const titleInp = event.target.closest("[data-custom-input='title']");
    const extraInp = event.target.closest("[data-custom-extra-line]");
    const toolbar = event.target.closest(".element-prop-toolbar");

    if (nameInp) selectElement("name", pId);
    else if (titleInp) selectElement("title", pId);
    else if (extraInp) selectElement(`extra-${extraInp.dataset.customExtraLine}`, pId);
    else if (toolbar?.dataset.toolbarElement) selectElement(toolbar.dataset.toolbarElement, pId);
  });

  function processCustomLogoFile(file, productId) {
    if (!file || !productId) return;
    if (file.size > 5 * 1024 * 1024) {
      toast("Logo file is too large. Please choose an image under 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target?.result;
      if (!dataUrl || typeof dataUrl !== "string") return;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      current.logoPreviewUrl = dataUrl;
      current.logoUrl = dataUrl;
      current.logoFileName = file.name;
      productCustomizations.set(productId, current);
      renderRoute();
      syncCustomCardPreview(productId);

      // Upload to API in background to obtain clean media URL
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      fetch(`${apiUrl}/api/v1/product-media/custom-logo/${ext}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.url) {
            const updated = productCustomizations.get(productId) ?? current;
            updated.logoPreviewUrl = dataUrl;
            updated.logoUrl = data.url;
            productCustomizations.set(productId, updated);
          }
        })
        .catch(() => {});
    };
    reader.readAsDataURL(file);
  }

  $("#product-detail").addEventListener("change", event => {
    const fileInput = event.target.closest("[data-custom-file='logo']");
    if (fileInput && fileInput.files && fileInput.files[0]) {
      const studio = fileInput.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
      if (productId) processCustomLogoFile(fileInput.files[0], productId);
      return;
    }

    const fontSelect = event.target.closest("[data-custom-font-select]");
    if (fontSelect) {
      const container = fontSelect.closest(".card-customizer-studio, .card-quick-inspector, .element-prop-toolbar, .product");
      const productId = container?.dataset.productId || $("#product-detail .product")?.dataset.id;
      if (!productId) return;
      const targetKey = fontSelect.dataset.customFontSelect || selectedElementId || "name";
      const fontVal = fontSelect.value;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (!current.elementPositions) current.elementPositions = {};
      if (!current.elementPositions[targetKey]) {
        current.elementPositions[targetKey] = { rotate: 0, font: fontVal };
      } else {
        current.elementPositions[targetKey].font = fontVal;
      }
      if (targetKey === "name") {
        current.font = fontVal;
      }
      productCustomizations.set(productId, current);
      syncCustomCardPreview(productId);
      return;
    }
  });

  $("#product-detail").addEventListener("dragover", event => {
    const dropzone = event.target.closest("[data-custom-dropzone]");
    if (dropzone) {
      event.preventDefault();
      dropzone.classList.add("is-dragover");
    }
  });
  $("#product-detail").addEventListener("dragleave", event => {
    const dropzone = event.target.closest("[data-custom-dropzone]");
    if (dropzone) dropzone.classList.remove("is-dragover");
  });
  $("#product-detail").addEventListener("drop", event => {
    const dropzone = event.target.closest("[data-custom-dropzone]");
    if (!dropzone) return;
    event.preventDefault();
    dropzone.classList.remove("is-dragover");
    const file = event.dataTransfer?.files?.[0];
    const studio = dropzone.closest(".card-customizer-studio");
    const productId = studio?.dataset.productId;
    if (file && productId) processCustomLogoFile(file, productId);
  });

  let activeDragItem = null;
  let activeRotateItem = null;

  document.addEventListener("mousedown", event => {
    const rotateHandle = event.target.closest("[data-rotate-handle]");
    if (rotateHandle) {
      const dragItem = rotateHandle.closest("[data-drag-element]");
      const cardFace = dragItem?.closest("[data-interactive-card]");
      const productId = cardFace?.dataset.interactiveCard;
      const elKey = rotateHandle.dataset.rotateHandle || dragItem?.dataset.dragElement;
      if (!dragItem || !cardFace || !productId || !elKey) return;

      selectElement(elKey, productId);

      const rect = dragItem.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      const startRot = current.elementPositions?.[elKey]?.rotate || 0;
      const startMouseAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX) * (180 / Math.PI);

      activeRotateItem = {
        dragItem,
        cardFace,
        productId,
        elKey,
        centerX,
        centerY,
        startRot,
        startMouseAngle,
        startX: event.clientX,
        startY: event.clientY,
        hasMoved: false,
      };
      dragItem.classList.add("is-rotating");
      event.preventDefault();
      return;
    }

    const dragItem = event.target.closest("[data-drag-element]");
    if (dragItem) {
      const cardFace = dragItem.closest("[data-interactive-card]");
      const productId = cardFace?.dataset.interactiveCard;
      const elKey = dragItem.dataset.dragElement;
      if (cardFace && productId && elKey) {
        selectElement(elKey, productId);
        activeDragItem = { dragItem, cardFace, productId, elKey };
        dragItem.classList.add("is-dragging");
        event.preventDefault();
        return;
      }
    }

    const cardFace = event.target.closest("[data-interactive-card]");
    if (cardFace && !event.target.closest(".card-quick-inspector") && !event.target.closest(".card-customizer-studio")) {
      const productId = cardFace.dataset.interactiveCard;
      if (productId) selectElement(null, productId);
    }
  });

  document.addEventListener("mousemove", event => {
    if (activeRotateItem) {
      const { dragItem, productId, elKey, centerX, centerY, startRot, startMouseAngle, startX, startY } = activeRotateItem;
      const dist = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (dist > 4) activeRotateItem.hasMoved = true;

      const currentMouseAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX) * (180 / Math.PI);
      const angleDiff = currentMouseAngle - startMouseAngle;
      let angle = Math.round((startRot + angleDiff) % 360);
      if (angle < 0) angle += 360;

      // 15° snap with 4° snap window
      const snap = 15;
      const rem = angle % snap;
      if (rem < 4) angle -= rem;
      else if (rem > snap - 4) angle += (snap - rem);
      angle = (angle + 360) % 360;

      dragItem.style.setProperty("--rot", `${angle}deg`);
      const scale = dragItem.style.getPropertyValue("--scale");
      const baseTransform = dragItem.classList.contains("pos-custom") ? "translate(-50%, -50%)" : "";
      dragItem.style.transform = scale
        ? `${baseTransform} scale(${scale}) rotate(${angle}deg)`.trim()
        : `${baseTransform} rotate(${angle}deg)`.trim();

      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (!current.elementPositions) current.elementPositions = {};
      if (!current.elementPositions[elKey]) {
        current.elementPositions[elKey] = { rotate: angle };
      } else {
        current.elementPositions[elKey].rotate = angle;
      }
      productCustomizations.set(productId, current);

      const inspectorRotInp = document.getElementById(`inspector-rot-input-${productId}`) || document.querySelector(`[data-custom-rot-input="${elKey}"]`);
      if (inspectorRotInp && document.activeElement !== inspectorRotInp) inspectorRotInp.value = String(angle);
      const inputEl = document.getElementById(`rot-input-${elKey}-${productId}`);
      if (inputEl && document.activeElement !== inputEl) inputEl.value = String(angle);
      const studio = document.querySelector(`.card-customizer-studio[data-product-id="${productId}"]`);
      if (studio) {
        studio.querySelectorAll(`[data-custom-rot-pill='${elKey}']`).forEach(p => {
          p.classList.toggle("is-selected", parseInt(p.dataset.rot, 10) === angle);
        });
      }
      return;
    }

    if (!activeDragItem) return;
    const { dragItem, cardFace, productId, elKey } = activeDragItem;
    const rect = cardFace.getBoundingClientRect();

    const halfW = ((dragItem.offsetWidth || 24) / 2 / rect.width) * 100;
    const halfH = ((dragItem.offsetHeight || 24) / 2 / rect.height) * 100;
    const minX = Math.max(1, Math.min(15, Math.round(halfW)));
    const maxX = Math.min(98, Math.max(minX, Math.round(101 - halfW)));
    const minY = Math.max(1, Math.min(15, Math.round(halfH)));
    const maxY = Math.min(98, Math.max(minY, Math.round(101 - halfH)));

    const rawX = Math.round(((event.clientX - rect.left) / rect.width) * 100);
    const rawY = Math.round(((event.clientY - rect.top) / rect.height) * 100);
    const xPercent = Math.min(maxX, Math.max(minX, rawX));
    const yPercent = Math.min(maxY, Math.max(minY, rawY));

    dragItem.className = dragItem.className.replace(/\bpos-\S+/g, "").trim() + " pos-custom is-dragging";
    dragItem.classList.toggle("is-near-top", yPercent < 24);
    dragItem.style.left = `${xPercent}%`;
    dragItem.style.top = `${yPercent}%`;
    dragItem.style.bottom = "auto";
    dragItem.style.right = "auto";
    const scale = dragItem.style.getPropertyValue("--scale");
    const rot = dragItem.style.getPropertyValue("--rot") || "0deg";
    dragItem.style.transform = scale
      ? `translate(-50%, -50%) scale(${scale}) rotate(${rot})`
      : `translate(-50%, -50%) rotate(${rot})`;

    const current = productCustomizations.get(productId) ?? defaultCustomization("01");
    if (!current.elementPositions) current.elementPositions = {};
    const existing = current.elementPositions[elKey] || {};
    current.elementPositions[elKey] = { ...existing, x: xPercent, y: yPercent, rotate: existing.rotate || 0 };
    productCustomizations.set(productId, current);
  });

  document.addEventListener("mouseup", () => {
    if (activeRotateItem) {
      const { dragItem, productId, elKey, startRot, hasMoved } = activeRotateItem;
      dragItem.classList.remove("is-rotating");
      if (!hasMoved) {
        const nextAngle = (startRot + 90) % 360;
        dragItem.style.setProperty("--rot", `${nextAngle}deg`);
        const scale = dragItem.style.getPropertyValue("--scale");
        const baseTransform = dragItem.classList.contains("pos-custom") ? "translate(-50%, -50%)" : "";
        dragItem.style.transform = scale
          ? `${baseTransform} scale(${scale}) rotate(${nextAngle}deg)`.trim()
          : `${baseTransform} rotate(${nextAngle}deg)`.trim();
        const current = productCustomizations.get(productId) ?? defaultCustomization("01");
        if (!current.elementPositions) current.elementPositions = {};
        if (!current.elementPositions[elKey]) {
          current.elementPositions[elKey] = { rotate: nextAngle };
        } else {
          current.elementPositions[elKey].rotate = nextAngle;
        }
        productCustomizations.set(productId, current);

        const inspectorRotInp = document.getElementById(`inspector-rot-input-${productId}`) || document.querySelector(`[data-custom-rot-input="${elKey}"]`);
        if (inspectorRotInp && document.activeElement !== inspectorRotInp) inspectorRotInp.value = String(nextAngle);
        const inputEl = document.getElementById(`rot-input-${elKey}-${productId}`);
        if (inputEl && document.activeElement !== inputEl) inputEl.value = String(nextAngle);
        const studio = document.querySelector(`.card-customizer-studio[data-product-id="${productId}"]`);
        if (studio) {
          studio.querySelectorAll(`[data-custom-rot-pill='${elKey}']`).forEach(p => {
            p.classList.toggle("is-selected", parseInt(p.dataset.rot, 10) === nextAngle);
          });
        }
      }
      activeRotateItem = null;
      syncCustomCardPreview(productId);
    }
    if (activeDragItem) {
      const { dragItem, productId } = activeDragItem;
      dragItem.classList.remove("is-dragging");
      activeDragItem = null;
      syncCustomCardPreview(productId);
    }
  });

  document.addEventListener("touchstart", event => {
    const rotateHandle = event.target.closest("[data-rotate-handle]");
    if (rotateHandle && event.touches[0]) {
      const touch = event.touches[0];
      const dragItem = rotateHandle.closest("[data-drag-element]");
      const cardFace = dragItem?.closest("[data-interactive-card]");
      const productId = cardFace?.dataset.interactiveCard;
      const elKey = rotateHandle.dataset.rotateHandle || dragItem?.dataset.dragElement;
      if (!dragItem || !cardFace || !productId || !elKey) return;

      selectElement(elKey, productId);

      const rect = dragItem.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      const startRot = current.elementPositions?.[elKey]?.rotate || 0;
      const startMouseAngle = Math.atan2(touch.clientY - centerY, touch.clientX - centerX) * (180 / Math.PI);

      activeRotateItem = {
        dragItem,
        cardFace,
        productId,
        elKey,
        centerX,
        centerY,
        startRot,
        startMouseAngle,
        startX: touch.clientX,
        startY: touch.clientY,
        hasMoved: false,
      };
      dragItem.classList.add("is-rotating");
      return;
    }

    const dragItem = event.target.closest("[data-drag-element]");
    if (dragItem) {
      const cardFace = dragItem.closest("[data-interactive-card]");
      const productId = cardFace?.dataset.interactiveCard;
      const elKey = dragItem.dataset.dragElement;
      if (cardFace && productId && elKey) {
        selectElement(elKey, productId);
        activeDragItem = { dragItem, cardFace, productId, elKey };
        dragItem.classList.add("is-dragging");
        return;
      }
    }

    const cardFace = event.target.closest("[data-interactive-card]");
    if (cardFace && !event.target.closest(".card-quick-inspector") && !event.target.closest(".card-customizer-studio")) {
      const productId = cardFace.dataset.interactiveCard;
      if (productId) selectElement(null, productId);
    }
  }, { passive: true });

  document.addEventListener("touchmove", event => {
    if (activeRotateItem && event.touches[0]) {
      const touch = event.touches[0];
      const { dragItem, productId, elKey, centerX, centerY, startRot, startMouseAngle, startX, startY } = activeRotateItem;
      const dist = Math.hypot(touch.clientX - startX, touch.clientY - startY);
      if (dist > 4) activeRotateItem.hasMoved = true;

      const currentMouseAngle = Math.atan2(touch.clientY - centerY, touch.clientX - centerX) * (180 / Math.PI);
      const angleDiff = currentMouseAngle - startMouseAngle;
      let angle = Math.round((startRot + angleDiff) % 360);
      if (angle < 0) angle += 360;

      const snap = 15;
      const rem = angle % snap;
      if (rem < 4) angle -= rem;
      else if (rem > snap - 4) angle += (snap - rem);
      angle = (angle + 360) % 360;

      dragItem.style.setProperty("--rot", `${angle}deg`);
      const scale = dragItem.style.getPropertyValue("--scale");
      const baseTransform = dragItem.classList.contains("pos-custom") ? "translate(-50%, -50%)" : "";
      dragItem.style.transform = scale
        ? `${baseTransform} scale(${scale}) rotate(${angle}deg)`.trim()
        : `${baseTransform} rotate(${angle}deg)`.trim();

      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      if (!current.elementPositions) current.elementPositions = {};
      if (!current.elementPositions[elKey]) {
        current.elementPositions[elKey] = { rotate: angle };
      } else {
        current.elementPositions[elKey].rotate = angle;
      }
      productCustomizations.set(productId, current);

      const inspectorRotInp = document.getElementById(`inspector-rot-input-${productId}`) || document.querySelector(`[data-custom-rot-input="${elKey}"]`);
      if (inspectorRotInp && document.activeElement !== inspectorRotInp) inspectorRotInp.value = String(angle);
      const inputEl = document.getElementById(`rot-input-${elKey}-${productId}`);
      if (inputEl && document.activeElement !== inputEl) inputEl.value = String(angle);
      const studio = document.querySelector(`.card-customizer-studio[data-product-id="${productId}"]`);
      if (studio) {
        studio.querySelectorAll(`[data-custom-rot-pill='${elKey}']`).forEach(p => {
          p.classList.toggle("is-selected", parseInt(p.dataset.rot, 10) === angle);
        });
      }
      return;
    }

    if (!activeDragItem || !event.touches[0]) return;
    const { dragItem, cardFace, productId, elKey } = activeDragItem;
    const touch = event.touches[0];
    const rect = cardFace.getBoundingClientRect();

    const halfW = ((dragItem.offsetWidth || 24) / 2 / rect.width) * 100;
    const halfH = ((dragItem.offsetHeight || 24) / 2 / rect.height) * 100;
    const minX = Math.max(1, Math.min(15, Math.round(halfW)));
    const maxX = Math.min(98, Math.max(minX, Math.round(101 - halfW)));
    const minY = Math.max(1, Math.min(15, Math.round(halfH)));
    const maxY = Math.min(98, Math.max(minY, Math.round(101 - halfH)));

    const rawX = Math.round(((touch.clientX - rect.left) / rect.width) * 100);
    const rawY = Math.round(((touch.clientY - rect.top) / rect.height) * 100);
    const xPercent = Math.min(maxX, Math.max(minX, rawX));
    const yPercent = Math.min(maxY, Math.max(minY, rawY));

    dragItem.className = dragItem.className.replace(/\bpos-\S+/g, "").trim() + " pos-custom is-dragging";
    dragItem.classList.toggle("is-near-top", yPercent < 24);
    dragItem.style.left = `${xPercent}%`;
    dragItem.style.top = `${yPercent}%`;
    dragItem.style.bottom = "auto";
    dragItem.style.right = "auto";
    const scale = dragItem.style.getPropertyValue("--scale");
    const rot = dragItem.style.getPropertyValue("--rot") || "0deg";
    dragItem.style.transform = scale
      ? `translate(-50%, -50%) scale(${scale}) rotate(${rot})`
      : `translate(-50%, -50%) rotate(${rot})`;

    const current = productCustomizations.get(productId) ?? defaultCustomization("01");
    if (!current.elementPositions) current.elementPositions = {};
    const existing = current.elementPositions[elKey] || {};
    current.elementPositions[elKey] = { ...existing, x: xPercent, y: yPercent, rotate: existing.rotate || 0 };
    productCustomizations.set(productId, current);
  }, { passive: true });

  document.addEventListener("touchend", () => {
    if (activeRotateItem) {
      const { dragItem, productId, elKey, startRot, hasMoved } = activeRotateItem;
      dragItem.classList.remove("is-rotating");
      if (!hasMoved) {
        const nextAngle = (startRot + 90) % 360;
        dragItem.style.setProperty("--rot", `${nextAngle}deg`);
        const scale = dragItem.style.getPropertyValue("--scale");
        const baseTransform = dragItem.classList.contains("pos-custom") ? "translate(-50%, -50%)" : "";
        dragItem.style.transform = scale
          ? `${baseTransform} scale(${scale}) rotate(${nextAngle}deg)`.trim()
          : `${baseTransform} rotate(${nextAngle}deg)`.trim();
        const current = productCustomizations.get(productId) ?? defaultCustomization("01");
        if (!current.elementPositions) current.elementPositions = {};
        if (!current.elementPositions[elKey]) {
          current.elementPositions[elKey] = { rotate: nextAngle };
        } else {
          current.elementPositions[elKey].rotate = nextAngle;
        }
        productCustomizations.set(productId, current);

        const inspectorRotInp = document.getElementById(`inspector-rot-input-${productId}`) || document.querySelector(`[data-custom-rot-input="${elKey}"]`);
        if (inspectorRotInp && document.activeElement !== inspectorRotInp) inspectorRotInp.value = String(nextAngle);
        const inputEl = document.getElementById(`rot-input-${elKey}-${productId}`);
        if (inputEl && document.activeElement !== inputEl) inputEl.value = String(nextAngle);
        const studio = document.querySelector(`.card-customizer-studio[data-product-id="${productId}"]`);
        if (studio) {
          studio.querySelectorAll(`[data-custom-rot-pill='${elKey}']`).forEach(p => {
            p.classList.toggle("is-selected", parseInt(p.dataset.rot, 10) === nextAngle);
          });
        }
      }
      activeRotateItem = null;
      syncCustomCardPreview(productId);
    }
    if (activeDragItem) {
      const { dragItem, productId } = activeDragItem;
      dragItem.classList.remove("is-dragging");
      activeDragItem = null;
      syncCustomCardPreview(productId);
    }
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void loadProducts(); });
  window.setInterval(() => { if (!document.hidden && !$(".modal.open")) void loadProducts(); }, 30000);

  $(".cart-trigger").addEventListener("click", openCart);
  $(".cart-close").addEventListener("click", closeCart);
  $(".drawer-backdrop").addEventListener("click", closeCart);
  $(".cart-shop").addEventListener("click", () => {
    closeCart();
    if (location.hash === "#products") $("#products").scrollIntoView({ behavior: "smooth" });
    else location.hash = "products";
  });
  $(".checkout-trigger").addEventListener("click", async () => {
    const previousCart = JSON.stringify(cart);
    if (!await loadProducts() || !cart.length) return;
    if (JSON.stringify(cart) !== previousCart) { toast("Your cart changed. Please review it before continuing."); return; }
    closeCart();
    showNewReceipt = false;
    if (location.hash === "#order-draft") renderOrder();
    else location.hash = "order-draft";
  });

  $$(".modal").forEach((modal) => {
    $(".modal-backdrop", modal).addEventListener("click", () => closeModal(modal));
    $$(".modal-close, .modal-close-button", modal).forEach((button) => button.addEventListener("click", () => closeModal(modal)));
  });

  $(".demo-trigger").addEventListener("click", () => openModal("experience-modal"));
  $(".demo-phone").addEventListener("click", (event) => {
    const phone = event.currentTarget;
    $("b", phone).textContent = "Profile opened";
    $("small", phone).textContent = "Connected with Oneinfo";
    phone.classList.remove("tapped");
    requestAnimationFrame(() => phone.classList.add("tapped"));
  });
  $(".team-trigger").addEventListener("click", () => openModal("team-modal"));
  $(".policy-trigger").addEventListener("click", () => toast("Delivery charges and payment options are shown at checkout."));

  function formToObject(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function renderOrder() {
    const showReceipt = Boolean(lastReceipt && (showNewReceipt || (catalogReady && !cart.length)));
    $(".order-recovery").hidden = !pendingOrder;
    $(".order-saved").hidden = !showReceipt || Boolean(pendingOrder);
    const hasItems = !showReceipt && !pendingOrder && catalogReady && cart.length > 0;
    $(".order-layout").hidden = !hasItems;
    $(".order-unavailable").hidden = hasItems || showReceipt || Boolean(pendingOrder);
    if (pendingOrder || showReceipt) return;
    $(".order-retry").hidden = !catalogFailed;
    $(".order-browse").hidden = !catalogReady;
    if (!hasItems) {
      $(".order-availability").textContent = catalogFailed ? "We couldn’t check your cart. Please try again."
        : catalogReady ? "Your cart is empty. Choose a card to get started." : "Checking your cart…";
      return;
    }
    renderCartItems($(".order-items"));
    const subtotal = cart.reduce((total, item) => total + item.priceMinor * item.quantity, 0);
    $(".order-total").textContent = money.format(subtotal / 100);
    renderDelivery();
  }

  const orderForm = $("#order-form");
  const orderSubmit = $(".order-submit");
  const orderMessage = $("#order-message");
  const arisepayForm = $("#arisepay-form");
  const arisepayError = $("#arisepay-error");
  const arisepaySubmit = $('button[type="submit"]', arisepayForm);
  const arisepayKey = "oneinfo.storefront.arisepay";
  const pendingOrderKey = "oneinfo.storefront.pendingOrder";
  const receiptKey = "oneinfo.storefront.lastReceipt";
  let pendingOrder = load(pendingOrderKey, null);
  let lastReceipt = load(receiptKey, null);
  let showNewReceipt = false;
  let shippingRates;
  let paymentSettings;
  let shippingRequest;
  let shippingFailed = false;
  let placingOrder = false;
  let arisepayDraft = load(arisepayKey, null, true);
  let appliedCoupon = arisepayDraft?.coupon ?? null;
  let applyingCoupon = false;
  const savedDraft = pendingOrder ?? arisepayDraft?.request ?? load(draftKey, {});
  const savedFields = { ...savedDraft.customer, ...savedDraft.deliveryAddress };
  // Older drafts stored the area separately.
  savedFields.addressLine = [savedFields.addressLine, savedFields.area]
    .filter(value => typeof value === "string" && value.trim()).join(", ");
  for (const field of $$("input, textarea, select", orderForm)) {
    if (typeof savedFields[field.name] === "string") field.value = savedFields[field.name];
  }

  if (savedDraft.payment) {
    orderForm.elements.paymentMethod.value = savedDraft.payment.method;
  }
  if (appliedCoupon) {
    $(".order-coupon-toggle").hidden = true;
    $("#order-coupon-form").hidden = false;
    $("#order-coupon-code").value = appliedCoupon.code;
    $(".order-coupon-status").textContent = `${appliedCoupon.code} applied (${appliedCoupon.percent}% off items).`;
  }

  function renderArisepay() {
    arisepayForm.hidden = !arisepayDraft?.reserved;
    $(".arisepay-unavailable").hidden = Boolean(arisepayDraft?.reserved);
    if (!arisepayDraft?.reserved) return;
    const { payment } = arisepayDraft.request;
    $(".arisepay-amount-label").textContent = payment.method === "COD" ? "COD advance" : "Amount to pay";
    $(".arisepay-amount").textContent = money.format(payment.amountMinor / 100);
    $(".arisepay-number").textContent = arisepayDraft.bkashNumber;
  }

  function clearArisepayDraft() {
    if (!arisepayDraft) return;
    arisepayDraft = null;
    sessionStorage.removeItem(arisepayKey);
    arisepayForm.reset();
    arisepayError.hidden = true;
    arisepayForm.elements.transactionId.removeAttribute("aria-invalid");
  }

  function showReceiptDetails() {
    if (!lastReceipt) return;
    $(".order-receipt-id").textContent = lastReceipt.id;
    $(".order-receipt-invoice").hidden = !lastReceipt.invoiceNumber;
    $(".order-receipt-invoice dd").textContent = lastReceipt.invoiceNumber ?? "";
    $(".order-receipt-activation").hidden = !lastReceipt.invoiceNumber;
    $(".order-receipt-activation").textContent = lastReceipt.activationMethod === "ORDER_SECRET"
      ? "Your package includes a private secret code for each card. Tap or scan your card, enter its code, then create an account or sign in and save your profile."
      : "Keep your invoice number. After delivery, tap or scan your card to activate it with your order email.";
    const tracking = $(".order-receipt-tracking");
    const trackingPath = typeof lastReceipt.trackingPath === "string" && /^\/#track\/[a-zA-Z0-9_.-]+$/.test(lastReceipt.trackingPath) ? lastReceipt.trackingPath : "";
    tracking.hidden = !trackingPath;
    tracking.href = trackingPath;
    const invoice = $(".order-receipt-document");
    const invoicePath = typeof lastReceipt.invoicePath === "string" && /^\/#invoice\/[a-zA-Z0-9_.-]+$/.test(lastReceipt.invoicePath) ? lastReceipt.invoicePath : "";
    invoice.hidden = !invoicePath;
    if (invoicePath) invoice.href = invoicePath;
    const emailStatus = $(".order-receipt-email");
    emailStatus.hidden = !lastReceipt.confirmationEmail;
    emailStatus.textContent = lastReceipt.confirmationEmail === "accepted"
      ? "Your order details were sent to your email address." : "Email confirmation couldn’t be sent. Keep your order ID for reference.";
    $(".order-receipt-shipping").textContent = money.format(lastReceipt.shippingMinor / 100);
    $(".order-receipt-coupon").hidden = !lastReceipt.couponCode;
    $(".order-receipt-coupon dd").textContent = lastReceipt.couponCode
      ? `${lastReceipt.couponCode} · -${money.format(lastReceipt.discountMinor / 100)}` : "";
    $(".order-receipt-total").textContent = money.format(lastReceipt.totalMinor / 100);
    const advance = lastReceipt.paymentAmountMinor ?? 0;
    const pending = lastReceipt.paymentStatus === "PENDING_VERIFICATION";
    $(".order-receipt-payment").textContent = pending ? "We’ll verify your bKash payment before processing your order."
      : lastReceipt.totalMinor > advance ? "Pay the remaining amount when your order is delivered." : "Keep your order ID for reference.";
    $(".order-receipt-advance").hidden = !advance;
    $(".order-receipt-advance dd").textContent = `${money.format(advance / 100)} · ${pending ? "Pending verification" : "Verified"}`;
    $(".order-receipt-balance").hidden = lastReceipt.totalMinor <= advance;
    $(".order-receipt-balance dt").textContent = pending ? "Remaining on delivery after verification" : "Amount due on delivery";
    $(".order-receipt-balance dd").textContent = money.format((lastReceipt.totalMinor - advance) / 100);
  }
  showReceiptDetails();

  function renderDelivery() {
    const { district, addressLine } = orderForm.elements;
    const zone = checkoutDeliveryZone(district.value, addressLine.value);
    const fee = zone && shippingRates?.[zone];
    const subtotal = cart.reduce((total, item) => total + item.priceMinor * item.quantity, 0);
    const discount = appliedCoupon ? couponDiscount(subtotal, appliedCoupon.percent) : 0;
    $(".order-discount").hidden = !appliedCoupon;
    $(".order-discount strong").textContent = `-${money.format(discount / 100)}`;
    $(".order-remove-coupon").hidden = !appliedCoupon;
    $(".order-shipping-zone").textContent = zone ? ` (${shippingZoneLabels[zone]})` : "";
    $(".order-shipping-price").textContent = !zone ? "–"
      : shippingFailed ? "Couldn’t load rates"
      : fee === undefined ? "Checking rates…" : money.format(fee / 100);
    $(".order-refresh-rates").hidden = !zone || !shippingFailed;
    const total = subtotal + (fee ?? 0) - discount;
    const method = orderForm.elements.paymentMethod.value;
    const dueNow = paymentSettings && typeof fee === "number" && !applyingCoupon
      ? paymentDueNow(total, method, paymentSettings.codAdvanceTaka) : null;
    $(".order-payable span").textContent = typeof fee !== "number" ? "Total before shipping"
      : dueNow === 0 && method === "COD" ? "Total due on delivery" : "Order total";
    $(".order-payable strong").textContent = money.format(total / 100);
    const codAdvanceTaka = paymentSettings?.codAdvanceTaka ?? defaultCodAdvanceTaka;
    const codAdvance = typeof fee === "number" ? paymentDueNow(total, "COD", codAdvanceTaka) / 100 : codAdvanceTaka;
    $(".order-cod-advance").textContent = codAdvance > 0 ? `Pay ${money.format(codAdvance)} to confirm order` : "";
    const needsPayment = dueNow > 0;
    orderSubmit.textContent = needsPayment ? "Pay" : "Place order";
    $(".order-due-now").hidden = !needsPayment;
    $(".order-due-now span").textContent = method === "BKASH" ? "Pay now with ArisePay" : "Pay now";
    $(".order-due-now strong").textContent = money.format(dueNow / 100);
    $(".order-due-delivery").hidden = !needsPayment || method !== "COD" || dueNow === total;
    $(".order-due-delivery strong").textContent = money.format((total - dueNow) / 100);
  }

  function refreshShippingRates() {
    if (shippingRequest) return shippingRequest;
    shippingRequest = (async () => {
      try {
        const response = await fetch(`${apiUrl}/api/v1/orders/shipping`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error("Shipping rates unavailable");
        const checkout = await response.json();
        shippingRates = ShippingRatesSchema.parse(checkout.rates);
        if (typeof checkout.bkashNumber !== "string" || !/^01\d{9}$/.test(checkout.bkashNumber)) throw new Error("Invalid bKash number");
        paymentSettings = { bkashNumber: checkout.bkashNumber, codAdvanceTaka: CodAdvanceSchema.parse(checkout.codAdvanceTaka) };
        $("#order-email-hint").textContent = checkout.confirmationEmailEnabled
          ? "We’ll email your order details to this address." : "We use this email for your order details.";
        shippingFailed = false;
      } catch {
        shippingRates = paymentSettings = undefined;
        shippingFailed = true;
      } finally {
        shippingRequest = undefined;
        if (location.hash === "#order-draft") renderDelivery();
      }
    })();
    return shippingRequest;
  }

  function checkoutItems(items) {
    return items.map(item => ({
      productId: item.id, variantId: item.variantId, quantity: item.quantity, unitPriceMinor: item.priceMinor,
      ...(item.customization ? { customization: item.customization } : {}),
    }));
  }

  async function submitOrder() {
    if (placingOrder || !pendingOrder) return;
    placingOrder = true;
    const request = pendingOrder;
    const retryButton = $(".order-resume");
    orderSubmit.disabled = retryButton.disabled = arisepaySubmit.disabled = true;
    retryButton.textContent = "Checking order…";
    try {
      const response = await fetch(`${apiUrl}/api/v1/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(12000),
      });
      const result = await response.json();
      if (!response.ok) {
        if (request.payment?.transactionId) {
          if (location.hash === "#arisepay") location.replace("#order-draft");
          renderOrder();
          $(".order-recovery p").textContent = `${result.message || "We could not confirm your order."} Your transaction reference is saved. Do not pay again. Contact Oneinfo if retry does not work.`;
          return;
        }
        if (response.status === 400 || response.status === 409) {
          localStorage.removeItem(pendingOrderKey);
          pendingOrder = null;
          if (location.hash === "#arisepay") location.replace("#order-draft");
          clearArisepayDraft();
          if (/coupon/i.test(result.message || "")) {
            appliedCoupon = null;
            $(".order-coupon-status").textContent = "Apply a valid coupon to see the discount.";
          }
          await Promise.all([loadProducts(), refreshShippingRates()]);
          renderOrder();
          setOrderMessage(result.message || "Review your details and try again.");
          return;
        }
        throw new Error("Confirmation unavailable");
      }
      if (!result.id || !Number.isSafeInteger(result.totalMinor)) throw new Error("Invalid order receipt");
      save(receiptKey, result);
      if (JSON.stringify(checkoutItems(load(storageKey, []))) === JSON.stringify(request.items)) {
        save(storageKey, []);
        cart = [];
      }
      localStorage.removeItem(pendingOrderKey);
      pendingOrder = null;
      clearArisepayDraft();
      appliedCoupon = null;
      $(".order-coupon").reset();
      $(".order-coupon-status").textContent = "";
      lastReceipt = result;
      showNewReceipt = true;
      showReceiptDetails();
      renderCart();
      if (location.hash === "#arisepay") location.replace("#order-draft");
      else if (location.hash === "#order-draft") $(".order-saved h2").focus();
      else toast("Order received");
    } catch {
      if (location.hash === "#arisepay") location.replace("#order-draft");
      else if (location.hash === "#order-draft") {
        renderOrder();
        retryButton.focus();
      }
    } finally {
      placingOrder = false;
      orderSubmit.disabled = retryButton.disabled = arisepaySubmit.disabled = false;
      retryButton.textContent = "Retry order";
      if (!pendingOrder) renderDelivery();
    }
  }

  function setOrderMessage(message, field) {
    const previousField = $('[aria-invalid="true"]', orderForm);
    previousField?.removeAttribute("aria-invalid");
    if (previousField) {
      const descriptions = (previousField.getAttribute("aria-describedby") ?? "").split(" ").filter(id => id && id !== orderMessage.id);
      if (descriptions.length) previousField.setAttribute("aria-describedby", descriptions.join(" "));
      else previousField.removeAttribute("aria-describedby");
    }
    $(".order-field-error", orderForm)?.remove();
    orderMessage.textContent = message;
    orderMessage.hidden = !message;
    orderMessage.classList.toggle("order-message-announcement", Boolean(field));
    if (field) {
      const inlineError = document.createElement("span");
      inlineError.className = "order-field-error";
      inlineError.setAttribute("aria-hidden", "true");
      inlineError.textContent = message;
      field.after(inlineError);
      field.setAttribute("aria-invalid", "true");
      field.setAttribute("aria-describedby", [field.getAttribute("aria-describedby"), orderMessage.id].filter(Boolean).join(" "));
      field.focus();
    }
  }

  $(".order-edit-cart").addEventListener("click", openCart);
  $(".skip-link").addEventListener("click", event => {
    if (location.hash === "#arisepay") {
      event.preventDefault();
      $("#arisepay-title").focus();
      return;
    }
    if (location.hash !== "#order-draft") return;
    event.preventDefault();
    $("#order-title").focus();
  });
  $(".order-retry").addEventListener("click", () => void loadProducts());
  $(".order-refresh-rates").addEventListener("click", () => void refreshShippingRates());
  for (const help of $$(".order-field-help", orderForm)) {
    const button = $(".order-help-icon", help);
    button.addEventListener("click", () => {
      const opened = help.classList.toggle("is-open");
      help.classList.toggle("is-dismissed", !opened);
    });
    help.addEventListener("pointerleave", () => help.classList.remove("is-dismissed"));
    button.addEventListener("blur", () => help.classList.remove("is-open", "is-dismissed"));
  }
  const retryShipping = () => {
    if (location.hash === "#order-draft" && !shippingRates) void refreshShippingRates();
  };
  window.addEventListener("online", retryShipping);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) retryShipping(); });
  $(".order-coupon-toggle").addEventListener("click", event => {
    event.currentTarget.hidden = true;
    $("#order-coupon-form").hidden = false;
    $("#order-coupon-code").focus();
  });
  $(".order-coupon").addEventListener("submit", async event => {
    event.preventDefault();
    if (applyingCoupon || placingOrder) return;
    const form = event.currentTarget;
    const status = $(".order-coupon-status");
    const code = CouponCodeSchema.safeParse(form.elements.code.value);
    if (!code.success) {
      status.textContent = "Enter a valid coupon code.";
      return;
    }
    const button = $('[type="submit"]', form);
    applyingCoupon = button.disabled = true;
    renderDelivery();
    status.textContent = "Checking coupon…";
    try {
      const response = await fetch(`${apiUrl}/api/v1/orders/coupon`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.data }), signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        status.textContent = response.status === 404 ? "This coupon is invalid or inactive." : "Couldn’t check your coupon. Try again.";
        return;
      }
      appliedCoupon = await response.json();
      form.elements.code.value = appliedCoupon.code;
      status.textContent = `${appliedCoupon.code} applied (${appliedCoupon.percent}% off items).`;
      renderDelivery();
    } catch {
      status.textContent = "Couldn’t check your coupon. Try again.";
    } finally {
      applyingCoupon = button.disabled = false;
      renderDelivery();
    }
  });
  $(".order-remove-coupon").addEventListener("click", () => {
    if (placingOrder || applyingCoupon) return;
    appliedCoupon = null;
    $(".order-coupon").reset();
    $(".order-coupon-status").textContent = "";
    renderDelivery();
  });
  $(".order-resume").addEventListener("click", () => void submitOrder());
  orderForm.addEventListener("input", event => {
    setOrderMessage("");
    if (["district", "addressLine", "paymentMethod"].includes(event.target.name)) renderDelivery();
  });
  async function placeOrder(request, onStorageError) {
    try {
      save(pendingOrderKey, request);
      pendingOrder = request;
    } catch {
      onStorageError("Allow browser storage and try again.");
      return;
    }
    setOrderMessage("");
    orderSubmit.textContent = "Placing order…";
    await submitOrder();
  }

  arisepayForm.addEventListener("input", () => {
    arisepayError.hidden = true;
    arisepayForm.elements.transactionId.removeAttribute("aria-invalid");
  });
  arisepayForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!arisepayDraft?.reserved || placingOrder || pendingOrder) return;
    const field = arisepayForm.elements.transactionId;
    const showError = message => {
      arisepayError.textContent = message;
      arisepayError.hidden = false;
    };
    const transaction = BkashTransactionIdSchema.safeParse(field.value);
    if (!transaction.success) {
      field.setAttribute("aria-invalid", "true");
      showError("Enter a valid bKash transaction ID.");
      field.focus();
      return;
    }
    const { request } = arisepayDraft;
    await placeOrder({ ...request, payment: { ...request.payment, transactionId: transaction.data } }, showError);
  });

  orderForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (orderSubmit.disabled || !cart.length) return;
    if (applyingCoupon) return setOrderMessage("Wait for the coupon check before placing your order.");
    const fields = Object.fromEntries(Object.entries(formToObject(orderForm)).map(([key, value]) => [key, value.trim()]));
    const { addressLine, district, postalCode, paymentMethod, ...customer } = fields;
    const method = PaymentMethodSchema.safeParse(paymentMethod);
    if (!method.success) return setOrderMessage("Choose a payment method.");
    if (!customer.name) return setOrderMessage("Enter your full name.", orderForm.elements.name);
    if (!/^\+?[\d(). -]+$/.test(customer.phone) || !/^\d{7,15}$/.test(customer.phone.replace(/\D/g, ""))) {
      return setOrderMessage("Enter a valid mobile number.", orderForm.elements.phone);
    }
    if (!customer.email) return setOrderMessage("Enter your email address.", orderForm.elements.email);
    if (!orderForm.elements.email.validity.valid) return setOrderMessage("Enter a valid email address.", orderForm.elements.email);
    if (!addressLine) return setOrderMessage("Enter your full address.", orderForm.elements.addressLine);
    if (!district) return setOrderMessage("Enter your district.", orderForm.elements.district);
    const postal = PostalCodeSchema.optional().safeParse(postalCode || undefined);
    if (!postal.success) return setOrderMessage("Enter a 4-digit postal code.", orderForm.elements.postalCode);
    const zone = checkoutDeliveryZone(district, addressLine);
    if (!zone) return;
    if (!shippingRates || !paymentSettings) return setOrderMessage("Wait for checkout details or retry loading them.");
    if (cart.length > 50) return setOrderMessage("You can order up to 50 different card options at a time.");

    const request = { requestId: crypto.randomUUID(), customer, deliveryAddress: { addressLine, district, postalCode: postal.data },
      shippingMinor: shippingRates[zone], items: checkoutItems(cart) };
    const subtotal = cart.reduce((total, item) => total + item.priceMinor * item.quantity, 0);
    const discount = appliedCoupon ? couponDiscount(subtotal, appliedCoupon.percent) : 0;
    if (appliedCoupon) request.coupon = { code: appliedCoupon.code, discountMinor: discount };
    const amountMinor = paymentDueNow(subtotal + request.shippingMinor - discount, method.data, paymentSettings.codAdvanceTaka);
    request.payment = { method: method.data, amountMinor };
    if (amountMinor > 0) {
      const previous = arisepayDraft?.request;
      if (previous && JSON.stringify({ ...previous, requestId: "" }) === JSON.stringify({ ...request, requestId: "" })) request.requestId = previous.requestId;
      const draft = { request, bkashNumber: paymentSettings.bkashNumber, coupon: appliedCoupon, reserved: false };
      try {
        sessionStorage.setItem(arisepayKey, JSON.stringify(draft));
      } catch {
        return setOrderMessage("Allow browser storage and try again.");
      }
      arisepayDraft = draft;
      placingOrder = orderSubmit.disabled = true;
      setOrderMessage("Checking stock and reserving your order before payment…");
      try {
        const response = await fetch(`${apiUrl}/api/v1/orders/reserve`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(12000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Could not reserve your order. Try again before paying.");
        if (!result.id || result.status !== "AWAITING_PAYMENT") throw new Error("Could not confirm the reservation. Do not pay; contact Oneinfo.");
        draft.reserved = true;
        sessionStorage.setItem(arisepayKey, JSON.stringify(draft));
      } catch (error) {
        setOrderMessage(error instanceof Error ? error.message : "Could not reserve your order. Try again before paying.");
        return;
      } finally { placingOrder = orderSubmit.disabled = false; }
      arisepayForm.reset();
      arisepayError.hidden = true;
      arisepayForm.elements.transactionId.removeAttribute("aria-invalid");
      location.hash = "arisepay";
      return;
    }
    await placeOrder(request, setOrderMessage);
  });

  $("#team-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget, button = $('button[type="submit"]', form), status = $("#team-status");
    if (button.disabled) return;
    button.disabled = true; status.textContent = "Sending your enquiry…";
    try {
      const input = formToObject(form), previous = load(teamDraftKey, null);
      const requestId = previous?.requestId && JSON.stringify(previous.request) === JSON.stringify(input) ? previous.requestId : crypto.randomUUID();
      save(teamDraftKey, { request: input, requestId });
      const response = await fetch(`${apiUrl}/api/v1/company/enquiries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, requestId }), signal: AbortSignal.timeout(12000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not send. Try again.");
      localStorage.removeItem(teamDraftKey);
      form.hidden = true; status.textContent = "";
      $(".order-success", form.parentElement).hidden = false;
    } catch (error) { status.textContent = error.message || "Could not send. Your details are saved; try again."; }
    finally { button.disabled = false; }
  });

  const menuTrigger = $(".menu-trigger");
  const mobileMenu = $("#mobile-menu");
  function setMobileMenu(open) {
    menuTrigger.setAttribute("aria-expanded", String(open));
    menuTrigger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    mobileMenu.hidden = !open;
  }
  menuTrigger.addEventListener("click", () => setMobileMenu(mobileMenu.hidden));
  $$("a", mobileMenu).forEach(link => link.addEventListener("click", () => setMobileMenu(false)));

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const help = $(".order-field-help.is-open, .order-field-help:hover, .order-field-help:focus-within", orderForm);
    if (help && !help.classList.contains("is-dismissed")) {
      help.classList.remove("is-open");
      help.classList.add("is-dismissed");
      return;
    }
    const modal = $(".modal.open");
    if (modal) closeModal(modal);
    else if ($(".cart-drawer.open")) closeCart();
    else if (!mobileMenu.hidden) { setMobileMenu(false); menuTrigger.focus(); }
  });

  $("#year").textContent = String(new Date().getFullYear());
  $(".checkout-trigger").disabled = true;
  renderRoute();
  void loadProducts();
})();
