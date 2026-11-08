export function initializeHero3D(root) {
  if (!root) return;
  const viewer = root.querySelector("#hero-model-viewer");
  if (!viewer) return;
  const doc = root.ownerDocument;
  const motion = doc.defaultView.matchMedia("(prefers-reduced-motion: reduce)");
  const buttons = [...root.querySelectorAll("[data-card-variant]")];
  const title = root.querySelector("#hero-card-title");
  const description = root.querySelector("#hero-card-desc");
  const poster = root.querySelector(".hero-poster");
  const fallback = root.querySelector(".hero-fallback");
  const flip = root.querySelector("#hero-flip-btn");
  const toggle = root.querySelector("#hero-motion-btn");
  const status = root.querySelector(".hero-model-status");
  const variants = {
    black: { title: "Matte Black", description: "A confident finish. A lasting impression.", poster: "black-studio-final.webp" },
    light: { title: "Minimalist Light", description: "Understated style. A clear introduction.", poster: "light-studio-final.webp" },
  };
  let rotating = !motion.matches;
  let visible = false;
  let ready = false;
  let flipped = false;
  function syncMotion() {
    viewer.autoRotate = ready && rotating && visible && !doc.hidden && !motion.matches;
    viewer.interpolationDecay = motion.matches ? 0 : 50;
    if (toggle) {
      toggle.textContent = rotating && !motion.matches ? "Pause rotation" : "Start rotation";
      toggle.setAttribute("aria-pressed", String(rotating && !motion.matches));
      toggle.disabled = !ready || motion.matches;
    }
    if (flip) flip.disabled = !ready;
  }
  function stopRotation() { rotating = false; syncMotion(); }
  function showError() {
    ready = false;
    root.dataset.modelState = "error";
    if (fallback) fallback.hidden = false;
    viewer.src = "";
    if (status) status.textContent = "Showing a still preview. Choose a finish to try the 3D view again.";
    syncMotion();
  }
  function setVariant(name) {
    const config = variants[name];
    if (!config) return;
    const src = `/assets/cards-final/${name}.glb`;
    if (!viewer.src?.endsWith(src) || root.dataset.modelState === "error") {
      ready = false;
      root.dataset.modelState = "loading";
      if (status) status.textContent = "Preparing your card preview…";
      if (fallback) fallback.hidden = true;
      viewer.src = src;
    }
    root.dataset.heroActive = name;
    if (title) title.textContent = config.title;
    if (description) description.textContent = config.description;
    viewer.alt = `Oneinfo ${config.title} business card. Drag to explore the front and back.`;
    for (const image of [poster, fallback].filter(Boolean)) {
      image.src = `/assets/cards-final/${config.poster}`;
      image.alt = `Oneinfo ${config.title} card`;
    }
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.cardVariant === name));
    flipped = false;
    if (flip) flip.setAttribute("aria-label", "Show back of card");
    viewer.resetTurntableRotation?.();
    viewer.cameraOrbit = "25deg 75deg 105%";
    syncMotion();
  }
  for (const button of buttons) button.addEventListener("click", () => setVariant(button.dataset.cardVariant));
  flip?.addEventListener("click", () => {
    stopRotation();
    viewer.resetTurntableRotation?.();
    flipped = !flipped;
    viewer.cameraOrbit = flipped ? "205deg 75deg 105%" : "25deg 75deg 105%";
    flip.setAttribute("aria-label", flipped ? "Show front of card" : "Show back of card");
  });
  toggle?.addEventListener("click", () => { rotating = !rotating; syncMotion(); });
  viewer.addEventListener("pointerdown", stopRotation);
  viewer.addEventListener("keydown", stopRotation);
  viewer.addEventListener("load", () => {
    ready = true;
    root.dataset.modelState = "ready";
    if (fallback) fallback.hidden = true;
    if (status) status.textContent = "";
    syncMotion();
  });
  viewer.addEventListener("error", showError);
  doc.addEventListener("visibilitychange", syncMotion);
  motion.addEventListener("change", () => { rotating = !motion.matches; syncMotion(); });
  const observer = new doc.defaultView.IntersectionObserver(([entry]) => { visible = entry.isIntersecting; syncMotion(); });
  observer.observe(viewer);
  setVariant(root.dataset.heroActive || "black");
  syncMotion();
  void import("@google/model-viewer").catch(showError);
}

export function initializeCardPreviews(root) {
  if (!root) return;
  for (const card of root.querySelectorAll(".card-preview")) {
    const button = card.querySelector("button");
    button.addEventListener("click", () => {
      const back = card.dataset.preview !== "back";
      card.dataset.preview = back ? "back" : "front";
      button.setAttribute("aria-pressed", String(back));
      const heading = card.querySelector("h3").textContent.toLowerCase();
      button.setAttribute("aria-label", `Show ${back ? "front" : "back"} of ${heading} design preview`);
      card.querySelector(".preview-turn-hint").lastChild.textContent = back ? " View front" : " Turn card";
    });
  }
}
