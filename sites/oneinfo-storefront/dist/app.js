(function () {
  "use strict";

  const money = new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT", maximumFractionDigits: 0 });
  const storageKey = "oneinfo.storefront.cart";
  const draftKey = "oneinfo.storefront.orderDraft";
  const teamDraftKey = "oneinfo.storefront.teamDraft";
  const savedCart = load(storageKey, []);
  const products = Array.from(document.querySelectorAll(".product"));
  let cart = (Array.isArray(savedCart) ? savedCart : []).flatMap((item) => {
    const product = products.find((product) => product.dataset.product === item?.name);
    return product && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 1000
      ? [{ name: product.dataset.product, price: Number(product.dataset.price), quantity: item.quantity }] : [];
  });
  let lastFocused = null;

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
    lastFocused = document.activeElement;
    const modal = $(`#${id}`);
    const form = $("form", modal);
    if (form) form.hidden = false;
    const success = $(".order-success", modal);
    if (success) success.hidden = true;
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
    const count = cart.reduce((total, item) => total + item.quantity, 0);
    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const countElement = $(".cart-count");
    countElement.textContent = String(count);
    countElement.setAttribute("aria-label", `${count} ${count === 1 ? "item" : "items"}`);

    const items = $(".cart-items");
    items.innerHTML = cart
      .map(
        (item) => `
          <div class="cart-item" data-name="${escapeHtml(item.name)}">
            <div class="cart-item-art"></div>
            <div class="cart-item-info">
              <strong>${escapeHtml(item.name)}</strong>
              <span>${money.format(item.price)} · Qty ${item.quantity}</span>
            </div>
            <button class="remove-item" type="button" aria-label="Remove ${escapeHtml(item.name)}">×</button>
          </div>`,
      )
      .join("");

    $(".cart-empty").hidden = cart.length > 0;
    $(".cart-summary").hidden = cart.length === 0;
    $(".cart-total").textContent = money.format(total);

    $$(".remove-item", items).forEach((button) => {
      button.addEventListener("click", () => {
        const itemElement = button.closest(".cart-item");
        const name = itemElement?.dataset.name;
        cart = cart.filter((item) => item.name !== name);
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

  $$(".add-to-cart").forEach((button) => {
    button.addEventListener("click", () => {
      const product = button.closest(".product");
      const name = product.dataset.product;
      const price = Number(product.dataset.price);
      const existing = cart.find((item) => item.name === name);
      if (existing) existing.quantity += 1;
      else cart.push({ name, price, quantity: 1 });
      save(storageKey, cart);
      renderCart();
      toast(`${name} added to cart`);
      button.textContent = "Added ✓";
      window.setTimeout(() => (button.innerHTML = 'Add to cart <span aria-hidden="true">+</span>'), 1200);
    });
  });

  $(".cart-trigger").addEventListener("click", openCart);
  $(".cart-close").addEventListener("click", closeCart);
  $(".drawer-backdrop").addEventListener("click", closeCart);
  $(".cart-shop").addEventListener("click", () => {
    closeCart();
    $("#products").scrollIntoView({ behavior: "smooth" });
  });
  $(".checkout-trigger").addEventListener("click", () => {
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

  $("#order-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
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
    const modal = $(".modal.open");
    const drawer = $(".cart-drawer.open");
    if (event.key === "Escape") {
      if (modal) closeModal(modal);
      else if (drawer) closeCart();
    }
    if (event.key === "Tab" && (modal || drawer)) {
      const focusable = $$("button, a[href], input, select, textarea, [tabindex='0']", modal || drawer)
        .filter((element) => !element.disabled && element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first && ((!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first) || !(modal || drawer).contains(document.activeElement))) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
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
  renderCart();
})();
