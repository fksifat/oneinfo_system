import { variantPrice, discountPercent, productMedia, productGallery, resolveProductImageUrl } from "@oneinfo/contracts";
import { addCartVariant, reconcileCartItems, productRoute } from "./catalog.js";

(function () {
  "use strict";

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
  let products = [];
  const selectedVariants = new Map();
  const selectedMedia = new Map();
  const selectedModels = new Map();
  const quantities = new Map();
  let addingToCart = false;
  let catalogReady = false;
  let catalogRequest = null;
  const draftKey = "oneinfo.storefront.orderDraft";
  const teamDraftKey = "oneinfo.storefront.teamDraft";
  let cart = load(storageKey, []);
  if (!Array.isArray(cart)) cart = [];
  cart = cart.filter(item => item && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 99);
  let lastFocused = null;
  let checkoutCartSnapshot = "";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function load(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
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
    if (id === "order-modal") checkoutCartSnapshot = JSON.stringify(cart);
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
    items.innerHTML = cart
      .map(
        (item) => `
          <div class="cart-item" data-id="${escapeHtml(item.id)}" data-variant-id="${escapeHtml(item.variantId)}">
            <div class="cart-item-art" style="background:${escapeHtml(item.colorHex)}"></div>
            <div class="cart-item-info">
              <strong>${escapeHtml(item.name)}</strong>
              <span>${escapeHtml(item.variantName)} · ${money.format(item.priceMinor / 100)} · Qty ${item.quantity}</span>
            </div>
            <button class="remove-item" type="button" aria-label="Remove ${escapeHtml(item.name)} ${escapeHtml(item.variantName)}">×</button>
          </div>`,
      )
      .join("");

    $(".cart-empty").hidden = cart.length > 0;
    $(".cart-summary").hidden = cart.length === 0;
    $(".cart-total").textContent = money.format(total);

    $$(".remove-item", items).forEach((button) => {
      button.addEventListener("click", () => {
        const itemElement = button.closest(".cart-item");
        const id = itemElement?.dataset.id;
        cart = cart.filter((item) => item.id !== id || item.variantId !== itemElement.dataset.variantId);
        save(storageKey, cart);
        renderCart();
        toast("Removed from cart");
      });
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
      const cover = media.find(m => m.type === "image" || (m.type === "video" && m.poster));
      const coverUrl = cover?.type === "image" ? cover.url : cover?.poster;
      const imageUrl = !detail ? coverUrl : item?.type === "image" ? item.url : "";
      const drivePreview = detail && item?.type === "video" ? driveVideoPreview(item.url) : null;
      const hasMedia = imageUrl || (detail && item?.type === "video");
      const percent = discountPercent(v);
      const sale = v.salePriceMinor !== null;
      const quantity = quantities.get(p.id) ?? 1;
      const illustration = `<div class="mini-product-card ${v.appearance}-card" style="background:${escapeHtml(v.colorHex)}"><span>ONEINFO</span><strong>YOUR NAME</strong><small>SMART BUSINESS CARD</small></div>`;
      return `<article class="product ${detail ? "detail-product" : ""} ${p.featured ? "featured" : ""}" data-id="${escapeHtml(p.id)}">
        ${detail ? `<div class="product-gallery">` : ""}<div class="product-art art-${v.appearance} ${hasMedia ? "has-image" : ""}">
          <div class="product-badges">${p.featured ? `<span class="feature-badge">${escapeHtml(p.badge || "Featured")}</span>` : ""}${!detail && sale ? `<span class="discount-badge">${percent > 0 ? `${percent}% OFF` : "ON SALE"}</span>` : ""}</div>
          ${illustration}${imageUrl ? `<img class="catalog-image" draggable="false" src="${escapeHtml(imageSource(imageUrl))}" alt="${escapeHtml(p.name)} — ${escapeHtml(v.name)} — ${escapeHtml(item?.label || "Product image")}" loading="lazy" referrerpolicy="no-referrer" />` : ""}<span class="finish-label">${escapeHtml(v.finish)}</span>
          ${detail && item?.type === "video" ? (drivePreview ? `<iframe class="gallery-video" src="${escapeHtml(drivePreview)}" title="${escapeHtml(item.label || p.name + ' video')}" allowfullscreen referrerpolicy="no-referrer"></iframe>` : `<video class="gallery-video" controls playsinline preload="metadata" ${item.poster ? `poster="${escapeHtml(imageSource(item.poster))}"` : ""} src="${escapeHtml(mediaUrl(item.url))}" aria-label="${escapeHtml(item.label || p.name + ' video')}"></video>`) : ""}
          ${detail && media.length ? `<p class="gallery-error" role="status" hidden>Media could not load. Choose another item or check the URL.</p>` : ""}

        </div>
        ${thumbnails.length ? `<div class="gallery-items" role="group" aria-label="Product media">${thumbnails.map(({variant,media:m,index:i}) => `<button class="gallery-item ${variant.id === v.id ? "selected-colour" : ""}" type="button" data-media="${i}" data-media-variant="${escapeHtml(variant.id)}" aria-pressed="${variant.id === v.id && active === i}" aria-label="${escapeHtml(variant.name + ' — ' + (m.label || (m.type === 'video' ? 'Video' : 'Image') + ' ' + (i+1)))}">${m.type === 'image' ? `<img src="${escapeHtml(imageSource(m.url))}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : '<span>▶</span>'}</button>`).join("")}</div>` : ""}
        ${model ? `<section class="gallery-model-card" aria-label="Interactive 3D view">
          <header><h2>3D View</h2><span>${escapeHtml(model.variant.name)}</span></header>
          <div class="gallery-model-stage" data-appearance="${escapeHtml(model.variant.appearance)}">
            <model-viewer class="gallery-model" src="${escapeHtml(model.media.url)}" alt="${escapeHtml(p.name + " — " + model.variant.name + " 3D model")}" camera-controls camera-orbit="0deg 85deg 105%" interaction-prompt="none" touch-action="none" min-camera-orbit="auto 0deg auto" max-camera-orbit="auto 180deg auto" disable-pan></model-viewer>
            <p class="gallery-model-instruction">Drag or swipe to rotate</p>
          </div>
          <p class="gallery-model-error" role="status" hidden>3D model could not load.</p>
          ${models.length > 1 ? `<div class="gallery-model-actions" role="group" aria-label="3D views">${models.map(entry => `<button class="gallery-model-button" type="button" data-media="${entry.index}" data-media-variant="${escapeHtml(entry.variant.id)}" aria-pressed="${entry === model}">${escapeHtml(entry.media.label || entry.variant.name)}</button>`).join("")}</div>` : ""}
        </section>` : ""}
        ${detail ? `</div><div class="product-details-copy">` : ""}
        <div class="product-info"><div>${!detail && p.subtitle ? `<p>${escapeHtml(p.subtitle)}</p>` : ""}${detail ? `<h1 id="product-title" tabindex="-1">${escapeHtml(p.name)}</h1>` : `<h3><a class="product-link" href="#product/${encodeURIComponent(p.slug)}?colour=${encodeURIComponent(v.id)}">${escapeHtml(p.name)}</a></h3>`}</div><div class="product-price"><strong>${money.format(variantPrice(v) / 100)}</strong>${sale ? `<del aria-label="Regular price ${money.format(v.priceMinor / 100)}">${money.format(v.priceMinor / 100)}</del>` : ""}${detail && sale ? `<span class="purchase-saving">Save ${money.format((v.priceMinor - variantPrice(v)) / 100)}</span>` : ''}</div></div>
        <div class="product-colours"><div class="colour-caption"><span>${detail ? 'Colour. <span>Choose your finish.</span>' : `Colour: <strong>${escapeHtml(v.name)}</strong>`}</span>${detail ? "" : `<span>${p.variants.length} ${p.variants.length === 1 ? "option" : "options"}</span>`}</div><div class="colour-options" role="group" aria-label="${escapeHtml(p.name)} colours">${p.variants.map(option => `<button type="button" class="colour-swatch ${!option.available ? "unavailable" : ""}" style="--swatch:${escapeHtml(option.colorHex)}" data-variant="${escapeHtml(option.id)}" aria-label="${escapeHtml(option.name)}${option.available ? "" : " — unavailable"}" aria-pressed="${option.id === v.id}" title="${escapeHtml(option.name)}${option.available ? "" : " — unavailable"}"><span aria-hidden="true"></span>${detail ? `<b>${escapeHtml(option.name)}${!option.available ? '<small>Unavailable</small>' : ''}</b>` : ''}</button>`).join("")}</div></div>
        ${detail ? `<div class="purchase-actions"><div class="purchase-quantity-row"><span id="purchase-quantity-label">Quantity</span><div class="quantity-control" role="group" aria-labelledby="purchase-quantity-label"><button type="button" data-quantity-step="-1" aria-label="Decrease quantity" ${quantity === 1 ? 'disabled' : ''}>−</button><output class="purchase-quantity" aria-live="polite">${quantity}</output><button type="button" data-quantity-step="1" aria-label="Increase quantity" ${quantity === 99 ? 'disabled' : ''}>+</button></div></div><div class="purchase-total"><span>Total</span><strong>${money.format(variantPrice(v) * quantity / 100)}</strong></div><button class="button add-to-cart" type="button" ${!catalogReady || !v.available || addingToCart ? "disabled" : ""}>${addingToCart ? 'Adding…' : v.available ? 'Add to cart' : 'Unavailable in this colour'}</button></div>
        <div class="purchase-information">${p.description || p.features.length ? `<details class="purchase-disclosure" data-disclosure="product"><summary>Product details<span aria-hidden="true">+</span></summary><div>${p.description ? `<p>${escapeHtml(p.description)}</p>` : ''}${p.features.length ? `<ul>${p.features.map(f => `<li>${escapeHtml(f)}</li>`).join("")}</ul>` : ''}</div></details>` : ''}${!p.warrantyIsDemo && p.warranty?.trim() ? `<details class="purchase-disclosure" data-disclosure="warranty"><summary>Warranty<span aria-hidden="true">+</span></summary><div><p>${escapeHtml(p.warranty)}</p></div></details>` : ''}<details class="purchase-disclosure" data-disclosure="ordering"><summary>Ordering & delivery<span aria-hidden="true">+</span></summary><div><p>This preview saves an order draft on your device. Delivery and payment are confirmed separately.</p></div></details><a class="purchase-team-link" href="#teams"><span>Ordering for a team?<small>Explore team options</small></span><span aria-hidden="true">↗</span></a></div></div>` : ""}</article>`;
  }

  function reviewsMarkup() {
    return `<section class="product-reviews" aria-labelledby="product-reviews-title">
      <div class="review-overview">
        <div>
          <h2 id="product-reviews-title">Customer reviews</h2>
          <p>No verified reviews yet.</p>
        </div>
        <aside class="review-eligibility">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 22s7-3.5 7-10V5l-7-3-7 3v7c0 6.5 7 10 7 10Z"/><path d="m9 12 2 2 4-4"/></svg>
          <div><h3>Verified buyers only</h3><p>Review submissions are currently unavailable.</p></div>
        </aside>
      </div>
    </section>`;
  }

  function watchModel(viewer) {
    const error = $(".gallery-model-error", viewer.closest(".gallery-model-card"));
    const showError = () => { error.hidden = false; };
    viewer.addEventListener("error", showError);
    void import("@google/model-viewer").catch(showError);
  }

  function renderRoute(focus = false) {
    const route = productRoute(location.hash);
    document.body.classList.toggle("product-page", Boolean(route));
    $$("#main > section").forEach(section => { section.hidden = route ? section.id !== "product-detail" : section.id === "product-detail"; });
    if (!route) {
      document.title = "Oneinfo Smart Business Cards";
      if (focus) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior:"instant" });
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
    host.innerHTML = `<a class="back-to-products" href="#products">← Back to cards</a>` + (product ? productMarkup(product, true) + reviewsMarkup() : `<div class="product-missing"><h1 id="product-title" tabindex="-1">${catalogReady ? "This card is no longer available" : "Loading product…"}</h1><p>${catalogReady ? "Explore the collection to find another card." : "Fetching the latest product details."}</p></div>`);
    if (!catalogReady) host.insertAdjacentHTML("beforeend", '<p role="status">Product information is unavailable. <button type="button" class="detail-retry">Retry</button></p>');
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
      if (changed) renderProducts();
      $("#catalog-status").textContent = products.length ? "" : "New cards are coming soon.";
      $("#catalog-retry").hidden = true;
      catalogReady = true;
      reconcileCart();
      $(".checkout-trigger").disabled = cart.length === 0;
      return true;
    } catch {
      catalogReady = false;
      $("#catalog-status").textContent = "We couldn’t refresh the collection. Please retry.";
      $("#catalog-retry").hidden = false;
      $(".checkout-trigger").disabled = true;
      $$(".add-to-cart").forEach(button => { button.disabled = true; });
      renderRoute();
      return false;
    }
  }
  $("#catalog-retry").addEventListener("click", () => void loadProducts());
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
        nextViewer.setAttribute("src", model.url);
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
      if (!before || variantPrice(before) !== variantPrice(variant)) { toast("The price changed. Please review it before adding to cart."); return; }
      const nextCart = addCartVariant(cart, product, variant, quantity);
      save(storageKey, nextCart); cart = nextCart; renderCart();
      toast(`${quantity} × ${product.name} · ${variant.name} added to cart`);
    } catch (error) { toast(error instanceof RangeError ? error.message : "Could not save the cart. Please try again."); }
    finally { addingToCart = false; renderRoute(); }
  }
  $(".product-grid").addEventListener("click", event => void handleProductClick(event));
  $("#product-detail").addEventListener("click", event => void handleProductClick(event));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void loadProducts(); });
  window.setInterval(() => { if (!document.hidden && !$(".modal.open")) void loadProducts(); }, 30000);

  $(".cart-trigger").addEventListener("click", openCart);
  $(".cart-close").addEventListener("click", closeCart);
  $(".drawer-backdrop").addEventListener("click", closeCart);
  $(".cart-shop").addEventListener("click", () => {
    closeCart();
    $("#products").scrollIntoView({ behavior: "smooth" });
  });
  $(".checkout-trigger").addEventListener("click", async () => {
    const previousCart = JSON.stringify(cart);
    if (!await loadProducts() || !cart.length) return;
    if (JSON.stringify(cart) !== previousCart) { toast("Your cart changed. Please review it before continuing."); return; }
    closeCart();
    openModal("order-modal");
  });

  $$(".modal").forEach((modal) => {
    $(".modal-backdrop", modal).addEventListener("click", () => closeModal(modal));
    $$(".modal-close, .modal-close-button", modal).forEach((button) => button.addEventListener("click", () => closeModal(modal)));
  });

  $(".demo-trigger").addEventListener("click", () => openModal("experience-modal"));
  $(".demo-phone").addEventListener("click", (event) => {
    event.currentTarget.classList.remove("tapped");
    requestAnimationFrame(() => event.currentTarget.classList.add("tapped"));
  });
  $(".team-trigger").addEventListener("click", () => openModal("team-modal"));
  $(".contact-trigger").addEventListener("click", () => openModal("order-modal"));
  $(".policy-trigger").addEventListener("click", () => toast("Pricing and order channels must be confirmed before launch"));

  function formToObject(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  $("#order-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const previousCart = checkoutCartSnapshot;
    if (!await loadProducts() || !cart.length) { toast("Please check your cart before saving."); return; }
    if (JSON.stringify(cart) !== previousCart) { closeModal($("#order-modal")); openCart(); toast("Your cart changed. Please review it before continuing."); return; }
    save(draftKey, { customer: formToObject(form), cart, savedAt: new Date().toISOString() });
    form.hidden = true;
    $(".order-success", form.parentElement).hidden = false;
    toast("Order draft saved locally");
  });

  $("#team-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    save(teamDraftKey, { request: formToObject(form), savedAt: new Date().toISOString() });
    form.hidden = true;
    $(".order-success", form.parentElement).hidden = false;
    toast("Team request saved locally");
  });

  const menuTrigger = $(".menu-trigger");
  const mobileMenu = $("#mobile-menu");
  menuTrigger.addEventListener("click", () => {
    const open = menuTrigger.getAttribute("aria-expanded") === "true";
    menuTrigger.setAttribute("aria-expanded", String(!open));
    mobileMenu.hidden = open;
  });
  $$("a", mobileMenu).forEach((link) => link.addEventListener("click", () => {
    mobileMenu.hidden = true;
    menuTrigger.setAttribute("aria-expanded", "false");
  }));

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const modal = $(".modal.open");
    if (modal) closeModal(modal);
    else if ($(".cart-drawer.open")) closeCart();
  });

  const observer = "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        }),
        { threshold: 0.12 },
      )
    : null;

  $$(".reveal").forEach((element) => {
    if (observer) observer.observe(element);
    else element.classList.add("visible");
  });

  $("#year").textContent = String(new Date().getFullYear());
  $(".checkout-trigger").disabled = true;
  renderRoute();
  void loadProducts();
})();
