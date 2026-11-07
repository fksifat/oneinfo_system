export function initializeHero3D(root) {
  if (!root) return;

  void import("@google/model-viewer").catch(() => {});

  const viewer = root.querySelector("#hero-model-viewer");
  const buttons = [...root.querySelectorAll("[data-card-variant]")];
  const titleEl = root.querySelector("#hero-card-title");
  const descEl = root.querySelector("#hero-card-desc");
  const flipBtn = root.querySelector("#hero-flip-btn");

  const variants = {
    black: {
      model: "/assets/cards-final/black.glb",
      title: "Matte Black NFC Card",
      desc: "NTAG213 · 13.56 MHz contactless chip",
    },
    light: {
      model: "/assets/cards-final/light.glb",
      title: "Minimalist Light Card",
      desc: "Architectural satin finish · Dynamic QR",
    },
  };

  let isFlipped = false;

  function setVariant(name) {
    const config = variants[name];
    if (!config || !viewer) return;
    root.dataset.heroActive = name;
    if (viewer.src !== config.model && !viewer.src.endsWith(config.model)) {
      viewer.src = config.model;
    }
    if (titleEl) titleEl.textContent = config.title;
    if (descEl) descEl.textContent = config.desc;
    for (const btn of buttons) {
      btn.setAttribute("aria-pressed", String(btn.dataset.cardVariant === name));
    }
    isFlipped = false;
    viewer.cameraOrbit = "25deg 75deg 105%";
  }

  for (const button of buttons) {
    button.addEventListener("click", () => {
      setVariant(button.dataset.cardVariant);
    });
  }

  if (flipBtn && viewer) {
    flipBtn.addEventListener("click", () => {
      isFlipped = !isFlipped;
      viewer.cameraOrbit = isFlipped ? "205deg 75deg 105%" : "25deg 75deg 105%";
    });
  }

  const viewport = root.querySelector(".hero-3d-viewport");
  if (viewport) {
    viewport.addEventListener("mousemove", (e) => {
      const rect = viewport.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      viewport.style.setProperty("--tilt-x", `${(-y * 7).toFixed(2)}deg`);
      viewport.style.setProperty("--tilt-y", `${(x * 7).toFixed(2)}deg`);
    });
    viewport.addEventListener("mouseleave", () => {
      viewport.style.setProperty("--tilt-x", "0deg");
      viewport.style.setProperty("--tilt-y", "0deg");
    });
  }
}

