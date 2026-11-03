import { variantPrice, discountPercent, productMedia, productGallery } from "@oneinfo/contracts";
import { reconcileCartItems, productRoute, spinFrame } from "./catalog.js";

(function () {
  "use strict";

  const money = new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT", minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const storageKey = "oneinfo.storefront.cart";
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001";
  let products = [];
  const selectedVariants = new Map();
  const selectedMedia = new Map();
  const spinFrames = new Map();
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
    $$(".catalog-image").forEach(img => img.addEventListener("error", () => { img.closest(".product-art")?.classList.remove("has-image"); img.remove(); const error = $(".gallery-error", $("#product-detail")); if (error) error.hidden = false; }, { once: true }));
  }

  function productMarkup(p, detail = false) {
      const v = p.variants.find(v => v.id === selectedVariants.get(p.id)) ?? p.variants.find(v => v.available) ?? p.variants[0];
      selectedVariants.set(p.id, v.id);
      const media = productMedia(v);
      const active = detail ? Math.min(selectedMedia.get(v.id) ?? v.defaultMediaIndex ?? 0, Math.max(0, media.length - 1)) : 0;
      const item = media[active];
      const gallery = productGallery(p.variants, v);
      const cover = media.find(m => m.type === "image" || (m.type === "video" && m.poster) || m.type === "spin");
      const coverUrl = cover?.type === "image" ? cover.url : cover?.type === "video" ? cover.poster : cover?.frames[0];
      const frame = item?.type === "spin" ? Math.min(spinFrames.get(item.id) ?? 0, item.frames.length - 1) : 0;
      const imageUrl = !detail ? coverUrl : item?.type === "image" ? item.url : item?.type === "spin" ? item.frames[frame] : "";
      const hasMedia = imageUrl || (detail && item?.type === "video");
      const percent = discountPercent(v);
      const sale = v.salePriceMinor !== null;
      const illustration = `<div class="mini-product-card ${v.appearance}-card" style="background:${escapeHtml(v.colorHex)}"><span>ONEINFO</span><strong>YOUR NAME</strong><small>SMART BUSINESS CARD</small></div>`;
      return `<article class="product ${detail ? "detail-product" : ""} ${p.featured ? "featured" : ""}" data-id="${escapeHtml(p.id)}">
        ${detail ? `<div class="product-gallery">` : ""}<div class="product-art art-${v.appearance} ${hasMedia ? "has-image" : ""}">
          <div class="product-badges">${p.featured ? `<span class="feature-badge">${escapeHtml(p.badge || "Featured")}</span>` : ""}${sale ? `<span class="discount-badge">${percent > 0 ? `${percent}% OFF` : "ON SALE"}</span>` : ""}</div>
          ${illustration}${imageUrl ? `<img class="catalog-image ${detail && item?.type === "spin" ? "spin-image" : ""}" draggable="false" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(p.name)} — ${escapeHtml(v.name)} — ${escapeHtml(item?.label || "Product image")}" loading="lazy" referrerpolicy="no-referrer" />` : ""}<span class="finish-label">${escapeHtml(v.finish)}</span>
          ${detail && item?.type === "video" ? `<video class="gallery-video" controls playsinline preload="metadata" ${item.poster ? `poster="${escapeHtml(item.poster)}"` : ""} src="${escapeHtml(item.url)}" aria-label="${escapeHtml(item.label || p.name + ' video')}"></video>` : ""}
          ${detail && item?.type === "spin" ? `<div class="spin-controls"><label>Drag to rotate <input class="spin-slider" type="range" min="0" max="${item.frames.length - 1}" value="${frame}" aria-label="360° frame" aria-valuetext="Frame ${frame+1} of ${item.frames.length}" /></label><output>${frame+1} / ${item.frames.length}</output></div>` : ""}
          ${detail && media.length ? `<p class="gallery-error" role="status" hidden>Media could not load. Choose another item or check the URL.</p>` : ""}

        </div>
        ${detail && gallery.length ? `<div class="gallery-items" role="group" aria-label="Product media">${gallery.map(({variant,media:m,index:i}) => `<button class="gallery-item ${variant.id === v.id ? "selected-colour" : ""}" type="button" data-media="${i}" data-media-variant="${escapeHtml(variant.id)}" aria-pressed="${variant.id === v.id && active === i}" aria-label="${escapeHtml(variant.name + ' — ' + (m.label || (m.type === 'spin' ? '360° view' : m.type === 'video' ? 'Video' : 'Image') + ' ' + (i+1)))}">${m.type === 'image' ? `<img src="${escapeHtml(m.url)}" alt="" loading="lazy" />` : m.type === 'video' ? '<span>▶</span>' : '<span>360°</span>'}</button>`).join("")}</div>` : ""}
        ${detail ? `</div><div class="product-details-copy">` : ""}
        <div class="product-info"><div><p>${escapeHtml(p.subtitle)}</p>${detail ? `<h1 id="product-title" tabindex="-1">${escapeHtml(p.name)}</h1>` : `<h3><a class="product-link" href="#product/${encodeURIComponent(p.slug)}?colour=${encodeURIComponent(v.id)}">${escapeHtml(p.name)}</a></h3>`}</div><div class="product-price"><strong>${money.format(variantPrice(v) / 100)}</strong>${sale ? `<del aria-label="Regular price ${money.format(v.priceMinor / 100)}">${money.format(v.priceMinor / 100)}</del>` : ""}</div></div>
        <div class="product-colours"><div class="colour-caption"><span>Colour: <strong>${escapeHtml(v.name)}</strong></span><span>${p.variants.length} ${p.variants.length === 1 ? "option" : "options"}</span></div><div class="colour-options" role="group" aria-label="${escapeHtml(p.name)} colours">${p.variants.map(option => `<button type="button" class="colour-swatch ${!option.available ? "unavailable" : ""}" style="--swatch:${escapeHtml(option.colorHex)}" data-variant="${escapeHtml(option.id)}" aria-label="${escapeHtml(option.name)}${option.available ? "" : " — unavailable"}" aria-pressed="${option.id === v.id}" title="${escapeHtml(option.name)}${option.available ? "" : " — unavailable"}"><span></span></button>`).join("")}</div></div>
        ${detail && p.description ? `<p class="product-description">${escapeHtml(p.description)}</p>` : ""}
        ${detail ? `<ul>${p.features.map(f => `<li>${escapeHtml(f)}</li>`).join("")}</ul>` : ""}
        ${detail ? `<button class="button add-to-cart" type="button" ${!catalogReady || !v.available ? "disabled" : ""}>${v.available ? 'Add to cart <span aria-hidden="true">+</span>' : "Unavailable in this colour"}</button>` : ""}${detail ? "</div>" : ""}</article>`;
  }

  function renderRoute(focus = false) {
    const route = productRoute(location.hash);
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
    host.innerHTML = `<a class="back-to-products" href="#products">← Back to cards</a>` + (product ? productMarkup(product, true) : `<div class="product-missing"><h1 id="product-title" tabindex="-1">${catalogReady ? "This card is no longer available" : "Loading product…"}</h1><p>${catalogReady ? "Explore the collection to find another card." : "Fetching the latest product details."}</p></div>`);
    if (!catalogReady) host.insertAdjacentHTML("beforeend", '<p role="status">Product information is unavailable. <button type="button" class="detail-retry">Retry</button></p>');
    document.title = product ? `${product.name} | Oneinfo` : "Product | Oneinfo";
    watchImages();
    const strip = $(".gallery-items", host);
    const activeThumb = strip && $("[aria-pressed=true]", strip);
    if (activeThumb) {
      const itemRect = activeThumb.getBoundingClientRect();
      const stripRect = strip.getBoundingClientRect();
      if (itemRect.right > stripRect.right) strip.scrollLeft += itemRect.right - stripRect.right + 4;
      else if (itemRect.left < stripRect.left) strip.scrollLeft -= stripRect.left - itemRect.left + 4;
    }
    $(".gallery-video", host)?.addEventListener("error", () => { $(".gallery-error", host).hidden = false; }, {once:true});
    if (focus) { $("#product-title")?.focus({ preventScroll:true }); host.scrollIntoView({ behavior:"instant" }); }
    else if (variant) $$(".colour-swatch", host).find(el => el.dataset.variant === variant)?.focus({preventScroll:true});
    else if (mediaFocused !== undefined && mediaFocused !== null) $$(".gallery-item", host).find(el => el.dataset.media === mediaFocused && el.dataset.mediaVariant === mediaVariantFocused)?.focus({preventScroll:true});
    else if (addFocused) $(".add-to-cart", host)?.focus({preventScroll:true});
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
    const mediaButton = event.target.closest(".gallery-item");
    if (mediaButton) {
      const productId = mediaButton.closest(".product").dataset.id;
      const variantId = mediaButton.dataset.mediaVariant;
      const product = products.find(p=>p.id === productId);
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
    if (!button || button.disabled || !catalogReady) return;
    const productId = button.closest(".product").dataset.id;
    const variantId = selectedVariants.get(productId);
    const before = products.find(p => p.id === productId)?.variants.find(v => v.id === variantId);
    button.disabled = true;
    if (!await loadProducts()) { toast("Please retry loading this product."); return; }
    const product = products.find(p => p.id === productId);
    const variant = product?.variants.find(v => v.id === variantId);
    if (!variant?.available) { toast("This colour is no longer available."); return; }
    if (!before || variantPrice(before) !== variantPrice(variant)) { toast("The price changed. Please review it before adding to cart."); return; }
    const existing = cart.find(item => item.id === product.id && item.variantId === variant.id);
    if (existing) existing.quantity = Math.min(99, existing.quantity + 1);
    else cart.push({ id: product.id, variantId: variant.id, name: product.name, variantName: variant.name, colorHex: variant.colorHex, priceMinor: variantPrice(variant), quantity: 1 });
    save(storageKey, cart); renderCart();
    toast(`${product.name} · ${variant.name} added to cart`);
  }
  $(".product-grid").addEventListener("click", event => void handleProductClick(event));
  $("#product-detail").addEventListener("click", event => void handleProductClick(event));
  function activeSpin() {
    const route = productRoute(location.hash);
    const p = products.find(p=>p.slug === route?.slug);
    const v = p?.variants.find(v=>v.id === selectedVariants.get(p.id));
    const media = v ? productMedia(v) : [];
    const item = media[Math.min(selectedMedia.get(v?.id) ?? v?.defaultMediaIndex ?? 0, Math.max(0,media.length-1))];
    return item?.type === "spin" ? item : null;
  }
  function showSpinFrame(item, frame) {
    spinFrames.set(item.id, frame);
    const image = $("#product-detail .spin-image");
    if (image) image.src = item.frames[frame];
    const slider = $("#product-detail .spin-slider");
    if (slider) { slider.value = frame; slider.setAttribute("aria-valuetext", `Frame ${frame+1} of ${item.frames.length}`); }
    const output = $("#product-detail .spin-controls output");
    if (output) output.textContent = `${frame+1} / ${item.frames.length}`;
  }
  $("#product-detail").addEventListener("input", event => {
    if (!event.target.matches(".spin-slider")) return;
    const item = activeSpin(); if (item) showSpinFrame(item, Number(event.target.value));
  });
  let spinDrag = null;
  $("#product-detail").addEventListener("pointerdown", event => {
    if (!event.target.matches(".spin-image") || event.button !== 0) return;
    const item = activeSpin(); if (!item) return;
    spinDrag = {item, x:event.clientX, frame:spinFrames.get(item.id) ?? 0};
    event.target.setPointerCapture(event.pointerId);
  });
  $("#product-detail").addEventListener("pointermove", event => {
    if (spinDrag) showSpinFrame(spinDrag.item, spinFrame(spinDrag.frame,event.clientX-spinDrag.x,spinDrag.item.frames.length));
  });
  for (const event of ["pointerup","pointercancel","lostpointercapture"]) $("#product-detail").addEventListener(event,()=>{spinDrag=null;});
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
