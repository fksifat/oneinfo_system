import { variantPrice, variantPriceForBranding, variantRegularPriceForBranding, discountPercent, productMedia, productGallery, resolveProductImageUrl, resolveProductModelUrl, checkoutDeliveryZone, shippingZoneLabels, ShippingRatesSchema, CouponCodeSchema, couponDiscount, PostalCodeSchema, CodAdvanceSchema, defaultCodAdvanceTaka, PaymentMethodSchema, BkashTransactionIdSchema, paymentDueNow } from "@oneinfo/contracts";
import { addCartVariant, reconcileCartItems, productRoute, PREMIUM_PRESETS, SURFACE_COLORS, ACCENT_COLORS, isColorLight, defaultCustomization, renderSurfaceMotifSvg, renderBackMotifSvg, renderQrSvg, renderAriseLogoSvg } from "./catalog.js";
import { initializeNfcDeck } from "./nfc-deck.mjs";
import { initializeHero3D, initializeCardPreviews } from "./hero-3d.mjs";
import logoUrl from "./assets/oneinfo-logo.svg";
import ariseLogoUrl from "./assets/arise-studio-logo.png";

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

      const textScale = ((custom.textSize || 14) / 14).toFixed(3);
      const nameFontSize = `${(1.125 * (custom.textSize || 14) / 14).toFixed(3)}rem`;
      const subFontSize = `${(0.65 * (custom.textSize || 14) / 14).toFixed(3)}rem`;
      const logoScale = ((custom.logoSize || 100) / 100).toFixed(2);
      const iconScale = ((custom.iconSize || 100) / 100).toFixed(2);
      const qrScale = ((custom.qrSize || 100) / 100).toFixed(2);

      const ep = custom.elementPositions || {};
      const activeExtras = (custom.extraLines || []).filter(l => l && l.trim());
      const numExtras = activeExtras.length;

      const logoStyle = ep.logo ? `left:${ep.logo.x}%; top:${ep.logo.y}%; --scale:${logoScale};` : `--scale:${logoScale};`;
      const signStyle = ep.sign ? `left:${ep.sign.x}%; top:${ep.sign.y}%; --scale:${iconScale};` : `--scale:${iconScale};`;

      const namePos = ep.name || custom.customPos;
      let nameStyle = namePos ? `left:${namePos.x}%; top:${namePos.y}%;` : "";
      if (!namePos) {
        if (custom.layout === "reverse") {
          nameStyle = "top:20px; bottom:auto;";
        } else {
          nameStyle = `bottom:${42 + numExtras * 16}px;`;
        }
      }

      const titlePos = ep.title;
      let titleStyle = titlePos ? `left:${titlePos.x}%; top:${titlePos.y}%;` : "";
      if (!titlePos) {
        if (custom.layout === "reverse") {
          titleStyle = "top:44px; bottom:auto;";
        } else {
          titleStyle = `bottom:${22 + numExtras * 16}px;`;
        }
      }

      const logoPosClass = ep.logo ? "pos-custom" : `pos-${escapeHtml(custom.layout || 'left')}`;
      const signPosClass = ep.sign ? "pos-custom" : `pos-${escapeHtml(custom.layout || 'left')}`;
      const namePosClass = namePos ? "pos-custom" : `pos-${escapeHtml(custom.layout || 'left')}`;
      const titlePosClass = titlePos ? "pos-custom" : `pos-${escapeHtml(custom.layout || 'left')}`;

      const frontIllustration = `<div class="mini-product-card ${v.appearance}-card customizable-card ${layoutClass} ${motifClass} ${luminanceClass} card-view-front" style="background:${surfaceBg}; --card-accent:${cardAccent};" data-card-face="front" data-interactive-card="${escapeHtml(p.id)}">
        ${renderSurfaceMotifSvg(custom.surfaceMotif, custom.accentColor)}
        ${custom.layout === "column" ? `<div class="card-side-column-bar" aria-hidden="true"></div>` : ""}
        ${custom.layout === "header" ? `<div class="card-header-banner" aria-hidden="true"></div>` : ""}

        <div class="card-drag-item card-element-logo ${logoPosClass}" style="${logoStyle}" data-drag-element="logo" data-product-id="${escapeHtml(p.id)}">
          ${(custom.logoPreviewUrl || custom.logoUrl) ? `
            <img class="mini-product-logo custom-user-logo" src="${escapeHtml(mediaUrl(custom.logoPreviewUrl || custom.logoUrl))}" alt="Custom logo" />
          ` : `
            <span class="card-logo-placeholder" style="color:${escapeHtml(custom.accentColor)};">YOUR LOGO</span>
          `}
        </div>

        <div class="card-drag-item card-element-nfc ${signPosClass}" style="color:${escapeHtml(custom.accentColor)}; ${signStyle}" data-drag-element="sign" data-product-id="${escapeHtml(p.id)}">
          <span class="card-nfc-wave" aria-hidden="true" style="color:inherit;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9a5 5 0 0 1 0 6"/><path d="M10 6a9 9 0 0 1 0 12"/><path d="M14 3a13 13 0 0 1 0 18"/></svg>
          </span>
        </div>

        <div class="card-drag-item card-element-name ${namePosClass} font-${escapeHtml(custom.font)}" style="${nameStyle}" data-drag-element="name" data-product-id="${escapeHtml(p.id)}">
          <strong class="card-custom-name ${!custom.name ? "is-placeholder" : ""}" style="font-size:${nameFontSize};">${escapeHtml(custom.name || "Your Name")}</strong>
        </div>

        <div class="card-drag-item card-element-title ${titlePosClass} font-${escapeHtml(custom.font)}" style="${titleStyle}" data-drag-element="title" data-product-id="${escapeHtml(p.id)}">
          <span class="card-custom-title ${!custom.title && numExtras === 0 ? "is-placeholder" : ""}" style="color:${escapeHtml(custom.accentColor)}; font-size:${subFontSize};">${escapeHtml(custom.title || (numExtras > 0 ? "" : "Your Title / Role"))}</span>
        </div>

        ${(custom.extraLines || []).map((line, idx) => {
          if (!line || !line.trim()) return "";
          const extraKey = `extra-${idx}`;
          const extraPos = ep[extraKey];
          const extraPosClass = extraPos ? "pos-custom" : `pos-${escapeHtml(custom.layout || 'left')} pos-extra-${idx}`;
          let extraStyle = extraPos ? `left:${extraPos.x}%; top:${extraPos.y}%;` : "";
          if (!extraPos) {
            if (custom.layout === "reverse") {
              extraStyle = `top:${60 + idx * 16}px; bottom:auto;`;
            } else {
              extraStyle = `bottom:${22 + (numExtras - 1 - idx) * 16}px;`;
            }
          }
          return `
            <div class="card-drag-item card-element-extra ${extraPosClass} font-${escapeHtml(custom.font)}" style="${extraStyle}" data-drag-element="${extraKey}" data-extra-index="${idx}" data-product-id="${escapeHtml(p.id)}">
              <span class="card-custom-extra-line" style="color:${escapeHtml(custom.accentColor)}; font-size:${subFontSize};">${escapeHtml(line.trim())}</span>
            </div>
          `;
        }).join("")}

        ${(custom.dividerLines || []).map((line, idx) => {
          const dividerKey = `divider-${idx}`;
          const dividerPos = ep[dividerKey];
          const isVert = line.orientation === "vertical";
          const len = line.length || (isVert ? 60 : 100);
          const dividerStyle = dividerPos
            ? `left:${dividerPos.x}%; top:${dividerPos.y}%; --divider-len:${len}px;`
            : `left:50%; top:${50 + idx * 12}%; --divider-len:${len}px;`;
          return `
            <div class="card-drag-item card-element-divider divider-${escapeHtml(line.orientation || 'horizontal')} ${line.style === 'dashed' ? 'is-dashed' : ''} pos-custom" style="${dividerStyle} color:${escapeHtml(custom.accentColor)};" data-drag-element="${dividerKey}" data-divider-index="${idx}" data-product-id="${escapeHtml(p.id)}"></div>
          `;
        }).join("")}
      </div>`;

      const backQrPos = ep["back-qr"];
      const backQrStyle = backQrPos ? `left:${backQrPos.x}%; top:${backQrPos.y}%; --scale:${qrScale};` : `--scale:${qrScale};`;
      const backQrClass = backQrPos ? "pos-custom" : "";

      const backIllustration = `<div class="mini-product-card ${v.appearance}-card customizable-card ${luminanceClass} card-view-back" style="background:${surfaceBg}; --card-accent:${cardAccent};" data-card-face="back" data-interactive-card="${escapeHtml(p.id)}">
        ${renderBackMotifSvg(custom.surfaceMotif, custom.accentColor)}
        <div class="card-drag-item card-back-center-qr ${backQrClass}" style="${backQrStyle}" data-drag-element="back-qr" data-product-id="${escapeHtml(p.id)}">
          <div class="card-qr-wrap ${escapeHtml(custom.backQrStyle || 'minimal')}">
            ${renderQrSvg(custom.accentColor, custom.backQrStyle || 'minimal')}
          </div>
          ${(custom.backSubtitle && custom.backSubtitle.trim()) ? `<span class="card-back-subtitle" style="color:${escapeHtml(custom.accentColor)};">${escapeHtml(custom.backSubtitle.trim())}</span>` : ""}
        </div>
        <div class="card-back-footer" style="${custom.hasOneinfoLogo !== false ? '' : 'display:none;'}">
          ${custom.hasOneinfoLogo !== false ? `
            <img class="mini-product-logo card-back-oneinfo-logo" src="${logoUrl}" alt="Oneinfo logo" />
            ${renderAriseLogoSvg()}
          ` : `<!-- Brand labeling omitted (Without Oneinfo Logo edition) -->`}
        </div>
      </div>`;

      const standardIllustration = `<div class="mini-product-card ${v.appearance}-card" style="background:${surfaceBg};">
        <div class="card-header-row">
          <img class="mini-product-logo" src="${logoUrl}" alt="Oneinfo logo" />
          <span class="card-nfc-wave" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9a5 5 0 0 1 0 6"/><path d="M10 6a9 9 0 0 1 0 12"/><path d="M14 3a13 13 0 0 1 0 18"/></svg>
          </span>
        </div>
        <strong>${escapeHtml(p.name)}</strong>
      </div>`;

      return `<article class="product ${detail ? "detail-product" : ""} ${p.featured ? "featured" : ""}" data-id="${escapeHtml(p.id)}">
        ${detail ? `<div class="product-gallery">` : ""}
        ${isCustomizable ? `
          <div class="product-art custom-stage-unified ${p.featured ? 'has-badge' : ''}">
            <div class="product-badges">
              ${p.featured ? `<span class="feature-badge">${escapeHtml(p.badge || "Featured")}</span>` : ""}
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
        ${!isCustomizable ? `<div class="product-colours"><div class="colour-caption"><span>${detail ? 'Colour. <span>Choose your finish.</span>' : `Colour: <strong>${escapeHtml(v.name)}</strong>`}</span>${detail ? "" : `<span>${p.variants.length} ${p.variants.length === 1 ? "option" : "options"}</span>`}</div><div class="colour-options" role="group" aria-label="${escapeHtml(p.name)} colours">${p.variants.map(option => `<button type="button" class="colour-swatch ${!option.available ? "unavailable" : ""}" style="--swatch:${escapeHtml(option.colorHex)}" data-variant="${escapeHtml(option.id)}" aria-label="${escapeHtml(option.name)}${option.available ? "" : " — unavailable"}" aria-pressed="${option.id === v.id}" title="${escapeHtml(option.name)}${option.available ? "" : " — unavailable"}"><span aria-hidden="true"></span>${detail ? `<b>${escapeHtml(option.name)}${!option.available ? '<small>Unavailable</small>' : ''}</b>` : ''}</button>`).join("")}</div></div>` : ""}
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
            <button type="button" class="studio-tab-btn ${activeStudioTab === 'style' ? 'is-active' : ''}" data-studio-tab="style" role="tab" aria-selected="${activeStudioTab === 'style'}">
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
                <small>Laser-engraved onto card</small>
              </div>
              <div class="custom-fields-stack">
                <div class="custom-field">
                  <label for="custom-name-${escapeHtml(p.id)}"><span>Cardholder Name</span><small class="char-count" id="name-count-${escapeHtml(p.id)}">${(custom.name || "").length}/25</small></label>
                  <input id="custom-name-${escapeHtml(p.id)}" type="text" maxlength="25" placeholder="e.g. Avery Morgan" value="${escapeHtml(custom.name || "")}" data-custom-input="name" autocomplete="name" />
                </div>
                <div class="custom-field">
                  <label for="custom-title-${escapeHtml(p.id)}"><span>Designation / Title <small>(optional)</small></span><small class="char-count" id="title-count-${escapeHtml(p.id)}">${(custom.title || "").length}/35</small></label>
                  <input id="custom-title-${escapeHtml(p.id)}" type="text" maxlength="35" placeholder="e.g. Managing Director" value="${escapeHtml(custom.title || "")}" data-custom-input="title" />
                </div>
                ${(custom.extraLines || []).map((line, idx) => `
                  <div class="custom-field extra-field-row">
                    <label for="custom-extra-${escapeHtml(p.id)}-${idx}">
                      <span>Line ${idx + 3}: Info <small>(optional)</small></span>
                      <span style="display:flex;align-items:center;gap:8px;">
                        <small class="char-count" id="extra-count-${escapeHtml(p.id)}-${idx}">${(line || "").length}/35</small>
                        <button type="button" class="remove-line-btn" data-custom-action="remove-extra-line" data-line-index="${idx}">Remove</button>
                      </span>
                    </label>
                    <input id="custom-extra-${escapeHtml(p.id)}-${idx}" type="text" maxlength="35" placeholder="${idx === 0 ? 'e.g. Acme Corporation' : 'e.g. Department or Note'}" value="${escapeHtml(line || "")}" data-custom-extra-line="${idx}" />
                  </div>
                `).join("")}
                ${(!custom.extraLines || custom.extraLines.length < 4) ? `
                  <button type="button" class="add-extra-field-btn" data-custom-action="add-extra-line">+ Add Line (Company, Dept, etc.)</button>
                ` : ""}
              </div>
            </div>

            <div class="customizer-section">
              <div class="customizer-section-title">
                <span>Typography & Text Size</span>
                <small>Scale font or drag anywhere on card</small>
              </div>
              <div class="customizer-pills" role="radiogroup" aria-label="Typography style" style="margin-bottom: 12px;">
                <button type="button" class="customizer-pill ${custom.font === 'sans' ? 'is-selected' : ''}" data-custom-set="font" data-value="sans" aria-checked="${custom.font === 'sans'}" role="radio"><span class="font-sample" style="font-family: inherit; font-weight: 700;">Aa</span> Modern Sans</button>
                <button type="button" class="customizer-pill ${custom.font === 'serif' ? 'is-selected' : ''}" data-custom-set="font" data-value="serif" aria-checked="${custom.font === 'serif'}" role="radio"><span class="font-sample" style="font-family: Georgia, serif; font-style: italic; font-weight: 700;">Aa</span> Luxury Serif</button>
                <button type="button" class="customizer-pill ${custom.font === 'mono' ? 'is-selected' : ''}" data-custom-set="font" data-value="mono" aria-checked="${custom.font === 'mono'}" role="radio"><span class="font-sample" style="font-family: monospace; font-weight: 700;">Aa</span> Minimal Mono</button>
              </div>
              <div class="text-size-control-wrap">
                <div class="text-size-toolbar-row">
                  <div class="toolbar-label-group">
                    <strong>Text Size Scale</strong>
                    <span class="toolbar-hint">Scale cardholder name and details</span>
                  </div>
                  <div class="font-size-stepper" role="group" aria-label="Text Size Stepper">
                    <button type="button" class="size-step-btn" data-custom-text-size-step="-2" title="Smaller text (A-)" aria-label="Smaller text">A-</button>
                    <span class="size-display-val" id="text-size-val-${escapeHtml(p.id)}">${custom.textSize || 14} pt</span>
                    <button type="button" class="size-step-btn" data-custom-text-size-step="2" title="Larger text (A+)" aria-label="Larger text">A+</button>
                  </div>
                </div>
                <div class="size-preset-pills" role="radiogroup" aria-label="Text size presets">
                  <button type="button" class="size-pill ${(custom.textSize || 14) === 10 ? 'is-selected' : ''}" data-custom-text-size="10">Small (10 pt)</button>
                  <button type="button" class="size-pill ${(custom.textSize || 14) === 14 ? 'is-selected' : ''}" data-custom-text-size="14">Regular (14 pt)</button>
                  <button type="button" class="size-pill ${(custom.textSize || 14) === 18 ? 'is-selected' : ''}" data-custom-text-size="18">Large (18 pt)</button>
                </div>
              </div>
            </div>

            <div class="customizer-section">
              <div class="customizer-section-title">
                <span>Upload Logo (Company or Personal)</span>
                <small>Laser-engraved onto card front</small>
              </div>
              <div class="custom-logo-zone">
                ${(custom.logoPreviewUrl || custom.logoUrl) ? `
                  <div class="logo-preview-active">
                    <img class="logo-thumb" src="${escapeHtml(mediaUrl(custom.logoPreviewUrl || custom.logoUrl))}" alt="Uploaded logo" />
                    <div class="logo-meta">
                      <strong>${escapeHtml(custom.logoFileName || "Custom logo uploaded")}</strong>
                      <small>Position or resize below</small>
                    </div>
                    <button type="button" class="remove-logo-btn" data-custom-action="remove-logo" aria-label="Remove custom logo">Remove ✕</button>
                  </div>
                ` : `
                  <div class="logo-dropzone" data-custom-dropzone>
                    <input type="file" id="logo-file-${escapeHtml(p.id)}" accept="image/png, image/jpeg, image/svg+xml, image/webp" data-custom-file="logo" class="logo-file-input visually-hidden" />
                    <label for="logo-file-${escapeHtml(p.id)}" class="logo-dropzone-label">
                      <svg class="logo-upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      <span class="logo-dropzone-cta"><strong>Upload Company or Personal Logo</strong></span>
                      <small class="logo-dropzone-hint">SVG, transparent PNG, JPEG, WebP (up to 5 MB)</small>
                    </label>
                  </div>
                `}
                <div class="text-size-control-wrap" style="margin-top: 10px;">
                  <div class="text-size-toolbar-row">
                    <div class="toolbar-label-group">
                      <strong>Logo Size</strong>
                      <span class="toolbar-hint">Scale logo on card or drag to position</span>
                    </div>
                    <div class="font-size-stepper" role="group" aria-label="Logo Size Stepper">
                      <button type="button" class="size-step-btn" data-custom-logo-size-step="-15" title="Smaller logo (-)" aria-label="Smaller logo">-</button>
                      <span class="size-display-val" id="logo-size-val-${escapeHtml(p.id)}">${custom.logoSize || 100}%</span>
                      <button type="button" class="size-step-btn" data-custom-logo-size-step="15" title="Larger logo (+)" aria-label="Larger logo">+</button>
                    </div>
                  </div>
                  <div class="size-preset-pills" role="radiogroup" aria-label="Logo size presets">
                    <button type="button" class="size-pill ${(custom.logoSize || 100) === 75 ? 'is-selected' : ''}" data-custom-logo-size="75">Small (75%)</button>
                    <button type="button" class="size-pill ${(custom.logoSize || 100) === 100 ? 'is-selected' : ''}" data-custom-logo-size="100">Default (100%)</button>
                    <button type="button" class="size-pill ${(custom.logoSize || 100) === 130 ? 'is-selected' : ''}" data-custom-logo-size="130">Large (130%)</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- TAB 2: THEMES & COLORS -->
          <div class="studio-tab-pane" id="studio-pane-style" ${activeStudioTab !== 'style' ? 'hidden' : ''}>
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
                <small>Contactless indicator sizing</small>
              </div>
              <div class="text-size-control-wrap">
                <div class="text-size-toolbar-row">
                  <div class="toolbar-label-group">
                    <strong>NFC Icon Size</strong>
                    <span class="toolbar-hint">Scale contactless icon or drag on card</span>
                  </div>
                  <div class="font-size-stepper" role="group" aria-label="NFC Icon Size Stepper">
                    <button type="button" class="size-step-btn" data-custom-icon-size-step="-15" title="Smaller icon (-)" aria-label="Smaller icon">-</button>
                    <span class="size-display-val" id="icon-size-val-${escapeHtml(p.id)}">${custom.iconSize || 100}%</span>
                    <button type="button" class="size-step-btn" data-custom-icon-size-step="15" title="Larger icon (+)" aria-label="Larger icon">+</button>
                  </div>
                </div>
                <div class="size-preset-pills" role="radiogroup" aria-label="NFC icon size presets">
                  <button type="button" class="size-pill ${(custom.iconSize || 100) === 75 ? 'is-selected' : ''}" data-custom-icon-size="75">Small (75%)</button>
                  <button type="button" class="size-pill ${(custom.iconSize || 100) === 100 ? 'is-selected' : ''}" data-custom-icon-size="100">Default (100%)</button>
                  <button type="button" class="size-pill ${(custom.iconSize || 100) === 125 ? 'is-selected' : ''}" data-custom-icon-size="125">Large (125%)</button>
                </div>
              </div>
            </div>

            <div class="customizer-section">
              <div class="divider-manager-wrap">
                <div class="toolbar-label-group">
                  <strong>Divider Lines (HR & Vertical)</strong>
                  <span class="toolbar-hint">Add divider lines, change length/style, or drag anywhere on card</span>
                </div>
                <div class="divider-add-actions">
                  <button type="button" class="divider-add-btn" data-custom-action="add-divider-line" data-divider-orient="horizontal" ${((custom.dividerLines || []).length >= 4) ? 'disabled' : ''}>+ Add Horizontal Line (HR)</button>
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
                <span>Back Side Configuration (NFC & QR)</span>
                <small>Reverse face details & QR inlay</small>
              </div>
              <div class="custom-fields-stack">
                <div class="custom-field">
                  <label for="custom-back-sub-${escapeHtml(p.id)}"><span>Website / Subline <small>(optional)</small></span><small class="char-count" id="back-sub-count-${escapeHtml(p.id)}">${(custom.backSubtitle || "").length}/40</small></label>
                  <input id="custom-back-sub-${escapeHtml(p.id)}" type="text" maxlength="40" placeholder="e.g. oneinfo.me/username or website.com" value="${escapeHtml(custom.backSubtitle || "")}" data-custom-input="backSubtitle" />
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
              <div class="text-size-control-wrap" style="margin-top: 10px;">
                <div class="text-size-toolbar-row">
                  <div class="toolbar-label-group">
                    <strong>QR Code Size</strong>
                    <span class="toolbar-hint">Scale QR inlay or drag to position</span>
                  </div>
                  <div class="font-size-stepper" role="group" aria-label="QR Code Size Stepper">
                    <button type="button" class="size-step-btn" data-custom-qr-size-step="-10" title="Smaller QR (-)" aria-label="Smaller QR">-</button>
                    <span class="size-display-val" id="qr-size-val-${escapeHtml(p.id)}">${custom.qrSize || 100}%</span>
                    <button type="button" class="size-step-btn" data-custom-qr-size-step="10" title="Larger QR (+)" aria-label="Larger QR">+</button>
                  </div>
                </div>
                <div class="size-preset-pills" role="radiogroup" aria-label="QR code size presets">
                  <button type="button" class="size-pill ${(custom.qrSize || 100) === 80 ? 'is-selected' : ''}" data-custom-qr-size="80">Small (80%)</button>
                  <button type="button" class="size-pill ${(custom.qrSize || 100) === 100 ? 'is-selected' : ''}" data-custom-qr-size="100">Standard (100%)</button>
                  <button type="button" class="size-pill ${(custom.qrSize || 100) === 125 ? 'is-selected' : ''}" data-custom-qr-size="125">Large (125%)</button>
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
    const savedToken = /^\/#track\/([a-zA-Z0-9_.-]+)$/.exec(lastReceipt?.trackingPath ?? "")?.[1] ?? "";
    const token = rawToken || savedToken;
    activeTrackingToken = token;
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
    } catch (error) { if (activeTrackingToken === token && !silent) content.textContent = error.message || "Tracking is temporarily unavailable."; }
  }
  window.setInterval(() => { if (activeTrackingToken && !document.hidden && (location.hash === "#track" || location.hash.startsWith("#track/"))) void renderTracking(activeTrackingToken, true); }, 5000);

  function renderRoute(focus = false) {
    const order = location.hash === "#order-draft";
    const payment = location.hash === "#arisepay";
    const reviewToken = location.hash.startsWith("#review/") ? location.hash.slice(8) : "";
    const trackingPage = location.hash === "#track" || location.hash.startsWith("#track/");
    const trackingToken = location.hash.startsWith("#track/") ? location.hash.slice(7) : "";
    const route = productRoute(location.hash);
    document.body.classList.toggle("product-page", Boolean(route));
    const page = order ? "order-draft" : payment ? "arisepay" : reviewToken ? "review-portal" : trackingPage ? "tracking-portal" : route ? "product-detail" : "";
    $$("#main > section").forEach(section => {
      section.hidden = page ? section.id !== page : ["order-draft", "arisepay", "product-detail", "review-portal", "tracking-portal"].includes(section.id);
    });
    if (reviewToken) { document.title = "Your review | Oneinfo"; void renderReviewPortal(reviewToken); return; }
    if (trackingPage) { document.title = "Track your order | Oneinfo"; void renderTracking(trackingToken); if (focus) $("#tracking-portal-title").focus(); return; }
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
      const scale = (custom.textSize || 14) / 14;
      const nameSize = `${(1.125 * scale).toFixed(3)}rem`;
      const subSize = `${(0.65 * scale).toFixed(3)}rem`;

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
        const logoScale = ((custom.logoSize || 100) / 100).toFixed(2);
        logoEl.style.setProperty("--scale", logoScale);
        if (ep.logo) {
          logoEl.className = "card-drag-item card-element-logo pos-custom";
          logoEl.style.left = `${ep.logo.x}%`;
          logoEl.style.top = `${ep.logo.y}%`;
          logoEl.style.transform = `translate(-50%, -50%) scale(${logoScale})`;
        } else {
          logoEl.className = `card-drag-item card-element-logo pos-${custom.layout || 'left'}`;
          logoEl.style.left = ""; logoEl.style.top = "";
          logoEl.style.transform = (custom.layout === "center" || custom.layout === "header")
            ? `translateX(-50%) scale(${logoScale})`
            : `scale(${logoScale})`;
        }
      }

      // 2. NFC wave sign element
      const nfcEl = frontCard.querySelector(".card-element-nfc");
      if (nfcEl) {
        const iconScale = ((custom.iconSize || 100) / 100).toFixed(2);
        nfcEl.style.setProperty("--scale", iconScale);
        nfcEl.style.color = custom.accentColor;
        if (ep.sign) {
          nfcEl.className = "card-drag-item card-element-nfc pos-custom";
          nfcEl.style.left = `${ep.sign.x}%`;
          nfcEl.style.top = `${ep.sign.y}%`;
          nfcEl.style.transform = `translate(-50%, -50%) scale(${iconScale})`;
        } else {
          nfcEl.className = `card-drag-item card-element-nfc pos-${custom.layout || 'left'}`;
          nfcEl.style.left = ""; nfcEl.style.top = "";
          nfcEl.style.transform = `scale(${iconScale})`;
        }
      }

      // 3. Name element
      const nameBox = frontCard.querySelector(".card-element-name");
      const nameEl = frontCard.querySelector(".card-custom-name");
      const activeExtras = (custom.extraLines || []).filter(l => l && l.trim());
      const numExtras = activeExtras.length;

      if (nameBox) {
        const namePos = ep.name || custom.customPos;
        if (namePos) {
          nameBox.className = `card-drag-item card-element-name pos-custom font-${custom.font || 'sans'}`;
          nameBox.style.left = `${namePos.x}%`;
          nameBox.style.top = `${namePos.y}%`;
          nameBox.style.bottom = "auto";
          nameBox.style.right = "auto";
          nameBox.style.transform = "translate(-50%, -50%)";
        } else {
          nameBox.className = `card-drag-item card-element-name pos-${custom.layout || 'left'} font-${custom.font || 'sans'}`;
          nameBox.style.left = "";
          nameBox.style.top = custom.layout === "reverse" ? "20px" : "";
          nameBox.style.bottom = custom.layout === "reverse" ? "auto" : `${42 + numExtras * 16}px`;
          nameBox.style.right = "";
          nameBox.style.transform = "";
        }
      }
      if (nameEl) {
        nameEl.textContent = custom.name ? custom.name.trim() : "Your Name";
        nameEl.classList.toggle("is-placeholder", !custom.name);
        nameEl.style.fontSize = nameSize;
      }

      // 4. Title element (independent draggable line)
      const legacyDetails = frontCard.querySelector(".card-element-details");
      if (legacyDetails) legacyDetails.remove();

      let titleBox = frontCard.querySelector(".card-element-title");
      if (!titleBox) {
        titleBox = document.createElement("div");
        titleBox.className = `card-drag-item card-element-title pos-${custom.layout || 'left'} font-${custom.font || 'sans'}`;
        titleBox.setAttribute("data-drag-element", "title");
        titleBox.setAttribute("data-product-id", productId);
        titleBox.innerHTML = `<span class="card-custom-title" style="color:${custom.accentColor}; font-size:${subSize};"></span>`;
        frontCard.appendChild(titleBox);
      }
      const titleEl = titleBox.querySelector(".card-custom-title");
      const titlePos = ep.title;
      if (titlePos) {
        titleBox.className = `card-drag-item card-element-title pos-custom font-${custom.font || 'sans'}`;
        titleBox.style.left = `${titlePos.x}%`;
        titleBox.style.top = `${titlePos.y}%`;
        titleBox.style.bottom = "auto";
        titleBox.style.right = "auto";
        titleBox.style.transform = "translate(-50%, -50%)";
      } else {
        titleBox.className = `card-drag-item card-element-title pos-${custom.layout || 'left'} font-${custom.font || 'sans'}`;
        titleBox.style.left = "";
        titleBox.style.top = custom.layout === "reverse" ? "44px" : "";
        titleBox.style.bottom = custom.layout === "reverse" ? "auto" : `${22 + numExtras * 16}px`;
        titleBox.style.right = "";
        titleBox.style.transform = "";
      }
      if (titleEl) {
        titleEl.textContent = custom.title ? custom.title.trim() : (numExtras > 0 ? "" : "Your Title / Role");
        titleEl.classList.toggle("is-placeholder", !custom.title && numExtras === 0);
        titleEl.style.color = custom.accentColor;
        titleEl.style.fontSize = subSize;
      }

      // 5. Extra Lines elements (each line is an independent draggable element)
      frontCard.querySelectorAll(".card-element-extra").forEach(el => el.remove());
      if (Array.isArray(custom.extraLines)) {
        custom.extraLines.forEach((line, idx) => {
          if (!line || !line.trim()) return;
          const extraKey = `extra-${idx}`;
          const extraPos = ep[extraKey];
          const div = document.createElement("div");
          div.setAttribute("data-drag-element", extraKey);
          div.setAttribute("data-product-id", productId);
          div.setAttribute("data-extra-index", String(idx));
          if (extraPos) {
            div.className = `card-drag-item card-element-extra pos-custom font-${custom.font || 'sans'}`;
            div.style.left = `${extraPos.x}%`;
            div.style.top = `${extraPos.y}%`;
            div.style.bottom = "auto";
            div.style.right = "auto";
            div.style.transform = "translate(-50%, -50%)";
          } else {
            div.className = `card-drag-item card-element-extra pos-${custom.layout || 'left'} pos-extra-${idx} font-${custom.font || 'sans'}`;
            if (custom.layout === "reverse") {
              div.style.top = `${60 + idx * 16}px`;
              div.style.bottom = "auto";
            } else {
              div.style.bottom = `${22 + (numExtras - 1 - idx) * 16}px`;
              div.style.top = "";
            }
          }
          const span = document.createElement("span");
          span.className = "card-custom-extra-line";
          span.style.color = custom.accentColor;
          span.style.fontSize = subSize;
          span.textContent = line.trim();
          div.appendChild(span);
          frontCard.appendChild(div);
        });
      }

      // 6. Divider Lines (Horizontal HR & Vertical)
      frontCard.querySelectorAll(".card-element-divider").forEach(el => el.remove());
      if (Array.isArray(custom.dividerLines)) {
        custom.dividerLines.forEach((line, idx) => {
          const dividerKey = `divider-${idx}`;
          const dividerPos = ep[dividerKey];
          const isVert = line.orientation === "vertical";
          const len = line.length || (isVert ? 60 : 100);
          const div = document.createElement("div");
          div.setAttribute("data-drag-element", dividerKey);
          div.setAttribute("data-divider-index", String(idx));
          div.setAttribute("data-product-id", productId);
          div.className = `card-drag-item card-element-divider divider-${line.orientation || 'horizontal'} ${line.style === 'dashed' ? 'is-dashed' : ''} pos-custom`;
          div.style.setProperty("--divider-len", `${len}px`);
          div.style.color = custom.accentColor;
          if (dividerPos) {
            div.style.left = `${dividerPos.x}%`;
            div.style.top = `${dividerPos.y}%`;
            div.style.transform = "translate(-50%, -50%)";
          } else {
            div.style.left = "50%";
            div.style.top = `${50 + idx * 12}%`;
            div.style.transform = "translate(-50%, -50%)";
          }
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
      const qrScale = ((custom.qrSize || 100) / 100).toFixed(2);
      if (qrCenter) {
        qrCenter.style.setProperty("--scale", qrScale);
        if (backQrPos) {
          qrCenter.className = "card-drag-item card-back-center-qr pos-custom";
          qrCenter.style.left = `${backQrPos.x}%`;
          qrCenter.style.top = `${backQrPos.y}%`;
          qrCenter.style.transform = `translate(-50%, -50%) scale(${qrScale})`;
        } else {
          qrCenter.className = "card-drag-item card-back-center-qr";
          qrCenter.style.left = "";
          qrCenter.style.top = "";
          qrCenter.style.transform = `translate(-50%, -50%) scale(${qrScale})`;
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
      const tabName = tabBtn.dataset.studioTab;
      activeStudioTab = tabName;
      if (studio) {
        studio.querySelectorAll(".studio-tab-btn").forEach(b => {
          const isAct = b.dataset.studioTab === tabName;
          b.classList.toggle("is-active", isAct);
          b.setAttribute("aria-selected", String(isAct));
        });
        studio.querySelectorAll(".studio-tab-pane").forEach(pane => {
          pane.hidden = (pane.id !== `studio-pane-${tabName}`);
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
    const stepBtn = event.target.closest("[data-custom-text-size-step]");
    if (stepBtn) {
      const studio = stepBtn.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
      if (!productId) return;
      const delta = parseInt(stepBtn.dataset.customTextSizeStep, 10);
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      let size = (current.textSize || 14) + delta;
      if (size < 8) size = 8;
      if (size > 24) size = 24;
      current.textSize = size;
      productCustomizations.set(productId, current);
      const valEl = $(`#text-size-val-${productId}`);
      if (valEl) valEl.textContent = `${size} pt`;
      studio.querySelectorAll(".size-pill").forEach(p => {
        p.classList.toggle("is-selected", parseInt(p.dataset.customTextSize, 10) === size);
      });
      syncCustomCardPreview(productId);
      return;
    }
    const sizePill = event.target.closest("[data-custom-text-size]");
    if (sizePill) {
      const studio = sizePill.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
      if (!productId) return;
      const size = parseInt(sizePill.dataset.customTextSize, 10);
      if (isNaN(size)) return;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      current.textSize = size;
      productCustomizations.set(productId, current);
      const valEl = $(`#text-size-val-${productId}`);
      if (valEl) valEl.textContent = `${size} pt`;
      studio.querySelectorAll(".size-pill[data-custom-text-size]").forEach(p => {
        p.classList.toggle("is-selected", p === sizePill);
      });
      syncCustomCardPreview(productId);
      return;
    }
    const iconStepBtn = event.target.closest("[data-custom-icon-size-step]");
    if (iconStepBtn) {
      const studio = iconStepBtn.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
      if (!productId) return;
      const delta = parseInt(iconStepBtn.dataset.customIconSizeStep, 10);
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      let size = (current.iconSize || 100) + delta;
      if (size < 50) size = 50;
      if (size > 200) size = 200;
      current.iconSize = size;
      productCustomizations.set(productId, current);
      const valEl = $(`#icon-size-val-${productId}`);
      if (valEl) valEl.textContent = `${size}%`;
      studio.querySelectorAll("[data-custom-icon-size]").forEach(p => {
        p.classList.toggle("is-selected", parseInt(p.dataset.customIconSize, 10) === size);
      });
      syncCustomCardPreview(productId);
      return;
    }
    const iconSizePill = event.target.closest("[data-custom-icon-size]");
    if (iconSizePill) {
      const studio = iconSizePill.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
      if (!productId) return;
      const size = parseInt(iconSizePill.dataset.customIconSize, 10);
      if (isNaN(size)) return;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      current.iconSize = size;
      productCustomizations.set(productId, current);
      const valEl = $(`#icon-size-val-${productId}`);
      if (valEl) valEl.textContent = `${size}%`;
      studio.querySelectorAll("[data-custom-icon-size]").forEach(p => {
        p.classList.toggle("is-selected", p === iconSizePill);
      });
      syncCustomCardPreview(productId);
      return;
    }
    const logoStepBtn = event.target.closest("[data-custom-logo-size-step]");
    if (logoStepBtn) {
      const studio = logoStepBtn.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
      if (!productId) return;
      const delta = parseInt(logoStepBtn.dataset.customLogoSizeStep, 10);
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      let size = (current.logoSize || 100) + delta;
      if (size < 40) size = 40;
      if (size > 200) size = 200;
      current.logoSize = size;
      productCustomizations.set(productId, current);
      const valEl = $(`#logo-size-val-${productId}`);
      if (valEl) valEl.textContent = `${size}%`;
      studio.querySelectorAll("[data-custom-logo-size]").forEach(p => {
        p.classList.toggle("is-selected", parseInt(p.dataset.customLogoSize, 10) === size);
      });
      syncCustomCardPreview(productId);
      return;
    }
    const logoSizePill = event.target.closest("[data-custom-logo-size]");
    if (logoSizePill) {
      const studio = logoSizePill.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
      if (!productId) return;
      const size = parseInt(logoSizePill.dataset.customLogoSize, 10);
      if (isNaN(size)) return;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      current.logoSize = size;
      productCustomizations.set(productId, current);
      const valEl = $(`#logo-size-val-${productId}`);
      if (valEl) valEl.textContent = `${size}%`;
      studio.querySelectorAll("[data-custom-logo-size]").forEach(p => {
        p.classList.toggle("is-selected", p === logoSizePill);
      });
      syncCustomCardPreview(productId);
      return;
    }
    const qrStepBtn = event.target.closest("[data-custom-qr-size-step]");
    if (qrStepBtn) {
      const studio = qrStepBtn.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
      if (!productId) return;
      const delta = parseInt(qrStepBtn.dataset.customQrSizeStep, 10);
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      let size = (current.qrSize || 100) + delta;
      if (size < 50) size = 50;
      if (size > 180) size = 180;
      current.qrSize = size;
      productCustomizations.set(productId, current);
      const valEl = $(`#qr-size-val-${productId}`);
      if (valEl) valEl.textContent = `${size}%`;
      studio.querySelectorAll("[data-custom-qr-size]").forEach(p => {
        p.classList.toggle("is-selected", parseInt(p.dataset.customQrSize, 10) === size);
      });
      syncCustomCardPreview(productId);
      return;
    }
    const qrSizePill = event.target.closest("[data-custom-qr-size]");
    if (qrSizePill) {
      const studio = qrSizePill.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
      if (!productId) return;
      const size = parseInt(qrSizePill.dataset.customQrSize, 10);
      if (isNaN(size)) return;
      const current = productCustomizations.get(productId) ?? defaultCustomization("01");
      current.qrSize = size;
      productCustomizations.set(productId, current);
      const valEl = $(`#qr-size-val-${productId}`);
      if (valEl) valEl.textContent = `${size}%`;
      studio.querySelectorAll("[data-custom-qr-size]").forEach(p => {
        p.classList.toggle("is-selected", p === qrSizePill);
      });
      syncCustomCardPreview(productId);
      return;
    }
    const addDividerBtn = event.target.closest("[data-custom-action='add-divider-line']");
    if (addDividerBtn) {
      const studio = addDividerBtn.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
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
      const studio = removeDividerBtn.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
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
      const studio = toggleOrientBtn.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
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
      const studio = toggleStyleBtn.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
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
      const studio = stepLenBtn.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
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
      const studio = pill.closest(".card-customizer-studio");
      const productId = studio?.dataset.productId;
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
      if (prop === "surfaceMotif" || prop === "surfaceColor" || prop === "accentColor" || prop === "layout") {
        current.presetId = undefined;
        studio.querySelectorAll(".preset-chip").forEach(chip => {
          chip.classList.remove("is-selected");
          chip.setAttribute("aria-checked", "false");
        });
      }
      productCustomizations.set(productId, current);

      const group = pill.closest(".customizer-pills, .color-swatches-grid");
      group?.querySelectorAll(".customizer-pill, .palette-swatch").forEach(p => {
        const isMatch = p === pill;
        p.classList.toggle("is-selected", isMatch);
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
        customization = {
          name: draft.name.trim(),
          title: (draft.title || "").trim(),
          extraLines: (draft.extraLines || []).map(l => (l || "").trim()).filter(Boolean),
          textSize: draft.textSize || 14,
          logoSize: draft.logoSize || 100,
          iconSize: draft.iconSize || 100,
          qrSize: draft.qrSize || 100,
          dividerLines: (draft.dividerLines || []),
          brandingMode: draft.brandingMode || "with-logo",
          hasOneinfoLogo: hasLogo,
          ...(draft.customPos ? { customPos: draft.customPos } : {}),
          ...(draft.elementPositions && Object.keys(draft.elementPositions).length ? { elementPositions: draft.elementPositions } : {}),
          layout: draft.layout || "left",
          surfaceMotif: draft.surfaceMotif || "facets",
          surfaceColor: draft.surfaceColor || "#0a0b0d",
          accentColor: draft.accentColor || "#d8b26e",
          font: draft.font || "sans",
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
    if (!fileInput || !fileInput.files || !fileInput.files[0]) return;
    const studio = fileInput.closest(".card-customizer-studio");
    const productId = studio?.dataset.productId;
    if (productId) processCustomLogoFile(fileInput.files[0], productId);
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
  document.addEventListener("mousedown", event => {
    const dragItem = event.target.closest("[data-drag-element]");
    if (!dragItem) return;
    const cardFace = dragItem.closest("[data-interactive-card]");
    const productId = cardFace?.dataset.interactiveCard;
    const elKey = dragItem.dataset.dragElement;
    if (!cardFace || !productId || !elKey) return;

    activeDragItem = { dragItem, cardFace, productId, elKey };
    dragItem.classList.add("is-dragging");
    event.preventDefault();
  });

  document.addEventListener("mousemove", event => {
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
    dragItem.style.left = `${xPercent}%`;
    dragItem.style.top = `${yPercent}%`;
    dragItem.style.bottom = "auto";
    dragItem.style.right = "auto";
    const scale = dragItem.style.getPropertyValue("--scale");
    dragItem.style.transform = scale ? `translate(-50%, -50%) scale(${scale})` : "translate(-50%, -50%)";

    const current = productCustomizations.get(productId) ?? defaultCustomization("01");
    if (!current.elementPositions) current.elementPositions = {};
    current.elementPositions[elKey] = { x: xPercent, y: yPercent };
    productCustomizations.set(productId, current);
  });

  document.addEventListener("mouseup", () => {
    if (!activeDragItem) return;
    activeDragItem.dragItem.classList.remove("is-dragging");
    activeDragItem = null;
  });

  document.addEventListener("touchstart", event => {
    const dragItem = event.target.closest("[data-drag-element]");
    if (!dragItem) return;
    const cardFace = dragItem.closest("[data-interactive-card]");
    const productId = cardFace?.dataset.interactiveCard;
    const elKey = dragItem.dataset.dragElement;
    if (!cardFace || !productId || !elKey) return;

    activeDragItem = { dragItem, cardFace, productId, elKey };
    dragItem.classList.add("is-dragging");
  }, { passive: true });

  document.addEventListener("touchmove", event => {
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
    dragItem.style.left = `${xPercent}%`;
    dragItem.style.top = `${yPercent}%`;
    dragItem.style.bottom = "auto";
    dragItem.style.right = "auto";
    const scale = dragItem.style.getPropertyValue("--scale");
    dragItem.style.transform = scale ? `translate(-50%, -50%) scale(${scale})` : "translate(-50%, -50%)";

    const current = productCustomizations.get(productId) ?? defaultCustomization("01");
    if (!current.elementPositions) current.elementPositions = {};
    current.elementPositions[elKey] = { x: xPercent, y: yPercent };
    productCustomizations.set(productId, current);
  }, { passive: true });

  document.addEventListener("touchend", () => {
    if (!activeDragItem) return;
    activeDragItem.dragItem.classList.remove("is-dragging");
    activeDragItem = null;
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
