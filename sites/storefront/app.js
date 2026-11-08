import { variantPrice, discountPercent, productMedia, productGallery, resolveProductImageUrl, resolveProductModelUrl, checkoutDeliveryZone, shippingZoneLabels, ShippingRatesSchema, CouponCodeSchema, couponDiscount, PostalCodeSchema, CodAdvanceSchema, defaultCodAdvanceTaka, PaymentMethodSchema, BkashTransactionIdSchema, paymentDueNow } from "@oneinfo/contracts";
import { addCartVariant, reconcileCartItems, productRoute } from "./catalog.js";
import { initializeNfcDeck } from "./nfc-deck.mjs";
import { initializeHero3D, initializeCardPreviews } from "./hero-3d.mjs";
import logoUrl from "./assets/oneinfo-logo.svg";

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
        cart = cart.filter((item) => item.id !== id || item.variantId !== itemElement.dataset.variantId);
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
      return `
          <div class="cart-item" data-id="${escapeHtml(item.id)}" data-variant-id="${escapeHtml(item.variantId)}">
            <div class="cart-item-art" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18m-14 5h4"/></svg>
              ${cover ? `<img src="${escapeHtml(imageSource(cover))}" alt="" referrerpolicy="no-referrer">` : ""}
            </div>
            <div class="cart-item-info">
              <strong>${escapeHtml(item.name)}</strong>
              <span>${escapeHtml(item.variantName)}</span>
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
      const percent = discountPercent(v);
      const sale = v.salePriceMinor !== null;
      const quantity = quantities.get(p.id) ?? 1;
      const illustration = `<div class="mini-product-card ${v.appearance}-card" style="background:${escapeHtml(v.colorHex)}"><img class="mini-product-logo" src="${logoUrl}" alt="" /><strong>${escapeHtml(p.name)}</strong></div>`;
      return `<article class="product ${detail ? "detail-product" : ""} ${p.featured ? "featured" : ""}" data-id="${escapeHtml(p.id)}">
        ${detail ? `<div class="product-gallery">` : ""}<div class="product-art art-${v.appearance} ${hasMedia ? "has-image" : ""}">
          <div class="product-badges">${p.featured ? `<span class="feature-badge">${escapeHtml(p.badge || "Featured")}</span>` : ""}${!detail && sale ? `<span class="discount-badge">${percent > 0 ? `${percent}% OFF` : "ON SALE"}</span>` : ""}</div>
          ${illustration}${imageUrl ? `<img class="catalog-image" draggable="false" src="${escapeHtml(imageSource(imageUrl))}" alt="${escapeHtml(p.name)} — ${escapeHtml(v.name)} — ${escapeHtml(item?.label || "Product image")}" loading="lazy" referrerpolicy="no-referrer" />` : ""}<span class="finish-label">${escapeHtml(v.finish)}</span>
          ${detail && item?.type === "video" ? (drivePreview ? `<iframe class="gallery-video" src="${escapeHtml(drivePreview)}" title="${escapeHtml(item.label || p.name + ' video')}" allowfullscreen referrerpolicy="no-referrer"></iframe>` : `<video class="gallery-video" controls playsinline preload="metadata" ${item.poster ? `poster="${escapeHtml(imageSource(item.poster))}"` : ""} src="${escapeHtml(mediaUrl(item.url))}" aria-label="${escapeHtml(item.label || p.name + ' video')}"></video>`) : ""}
          ${detail && media.length ? `<p class="gallery-error" role="status" hidden>Media could not load. Choose another item or check the URL.</p>` : ""}

        </div>
        ${thumbnails.length ? `<div class="gallery-items" role="group" aria-label="Product media">${thumbnails.map(({variant,media:m,index:i}) => `<button class="gallery-item ${variant.id === v.id ? "selected-colour" : ""}" type="button" data-media="${i}" data-media-variant="${escapeHtml(variant.id)}" aria-pressed="${variant.id === v.id && active === i}" aria-label="${escapeHtml(variant.name + ' — ' + (m.label || (m.type === 'video' ? 'Video' : 'Image') + ' ' + (i+1)))}">${m.type === 'image' ? `<img src="${escapeHtml(imageSource(m.url))}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<span>${icon("play")}</span>`}</button>`).join("")}</div>` : ""}
        ${model ? `<section class="gallery-model-card" aria-label="Interactive 3D view">
          <header><h2>3D View</h2><span>${escapeHtml(model.variant.name)}</span></header>
          <div class="gallery-model-stage" data-appearance="${escapeHtml(model.variant.appearance)}">
            <model-viewer class="gallery-model" src="${escapeHtml(modelSource(model.media.url))}" alt="${escapeHtml(p.name + " — " + model.variant.name + " 3D model")}" camera-controls camera-orbit="0deg 85deg 105%" interaction-prompt="none" touch-action="none" min-camera-orbit="auto 0deg auto" max-camera-orbit="auto 180deg auto" disable-pan></model-viewer>
            <p class="gallery-model-instruction">Drag or swipe to rotate</p>
          </div>
          <p class="gallery-model-error" role="status" hidden>3D model could not load.</p>
          ${models.length > 1 ? `<div class="gallery-model-actions" role="group" aria-label="3D views">${models.map(entry => `<button class="gallery-model-button" type="button" data-media="${entry.index}" data-media-variant="${escapeHtml(entry.variant.id)}" aria-pressed="${entry === model}">${escapeHtml(entry.media.label || entry.variant.name)}</button>`).join("")}</div>` : ""}
        </section>` : ""}
        ${detail ? `</div><div class="product-details-copy">` : ""}
        <div class="product-info"><div>${!detail && p.subtitle ? `<p>${escapeHtml(p.subtitle)}</p>` : ""}${detail ? `<h1 id="product-title" tabindex="-1">${escapeHtml(p.name)}</h1>` : `<h3><a class="product-link" href="#product/${encodeURIComponent(p.slug)}?colour=${encodeURIComponent(v.id)}">${escapeHtml(p.name)}</a></h3>`}</div><div class="product-price"><strong>${money.format(variantPrice(v) / 100)}</strong>${sale ? `<del aria-label="Regular price ${money.format(v.priceMinor / 100)}">${money.format(v.priceMinor / 100)}</del>` : ""}${detail && sale ? `<span class="purchase-saving">Save ${money.format((v.priceMinor - variantPrice(v)) / 100)}</span>` : ''}</div></div>
        <div class="product-colours"><div class="colour-caption"><span>${detail ? 'Colour. <span>Choose your finish.</span>' : `Colour: <strong>${escapeHtml(v.name)}</strong>`}</span>${detail ? "" : `<span>${p.variants.length} ${p.variants.length === 1 ? "option" : "options"}</span>`}</div><div class="colour-options" role="group" aria-label="${escapeHtml(p.name)} colours">${p.variants.map(option => `<button type="button" class="colour-swatch ${!option.available ? "unavailable" : ""}" style="--swatch:${escapeHtml(option.colorHex)}" data-variant="${escapeHtml(option.id)}" aria-label="${escapeHtml(option.name)}${option.available ? "" : " — unavailable"}" aria-pressed="${option.id === v.id}" title="${escapeHtml(option.name)}${option.available ? "" : " — unavailable"}"><span aria-hidden="true"></span>${detail ? `<b>${escapeHtml(option.name)}${!option.available ? '<small>Unavailable</small>' : ''}</b>` : ''}</button>`).join("")}</div></div>
        ${detail ? `<div class="purchase-actions"><div class="purchase-quantity-row"><span id="purchase-quantity-label">Quantity</span><div class="quantity-control" role="group" aria-labelledby="purchase-quantity-label"><button type="button" data-quantity-step="-1" aria-label="Decrease quantity" ${quantity === 1 ? 'disabled' : ''}>${icon("minus")}</button><output class="purchase-quantity" aria-live="polite">${quantity}</output><button type="button" data-quantity-step="1" aria-label="Increase quantity" ${quantity === 99 ? 'disabled' : ''}>${icon("plus")}</button></div></div><div class="purchase-total"><span>Total</span><strong>${money.format(variantPrice(v) * quantity / 100)}</strong></div><button class="button add-to-cart" type="button" ${!catalogReady || !v.available || addingToCart ? "disabled" : ""}>${addingToCart ? 'Adding…' : v.available ? 'Add to cart' : 'Unavailable in this colour'}</button></div>
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
      toast(`${quantity} x ${product.name} · ${variant.name} added to cart`);
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
