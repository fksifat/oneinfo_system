import { ProductCustomizationSchema } from "@oneinfo/contracts";
import { isColorLight, renderSurfaceMotifSvg, renderBackMotifSvg, renderQrSvg, renderAriseLogoSvg } from "./catalog.js";

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);

export function getElementStyle(custom, elKey) {
  if (!custom) return { font: "sans", size: 14, rotate: 0, bold: false, italic: false };
  const ep = custom.elementPositions || {};
  const pos = {
    ...(custom.elementStyles?.[elKey] || {}),
    ...(elKey === "name" ? custom.customPos : elKey === "title" ? ep.details : null),
    ...(ep[elKey] || {}),
  };
  const defaultTextSize = custom.textSize || 14;
  let size = pos.size;
  const font = pos.font || custom.font || "sans";
  const rotate = Number(pos.rotate ?? 0) || 0;
  const bold = pos.bold !== undefined ? Boolean(pos.bold) : (elKey === "name" ? custom.bold !== false : Boolean(custom.bold));
  const italic = pos.italic !== undefined ? Boolean(pos.italic) : Boolean(custom.italic);
  if (size === undefined || size === null) {
    if (elKey === "name") size = defaultTextSize;
    else if (elKey === "title" || elKey.startsWith("extra-")) size = Math.max(8, Math.round(defaultTextSize * 0.75));
    else if (elKey === "logo") size = custom.logoSize || 100;
    else if (elKey === "sign") size = custom.iconSize || 100;
    else if (elKey === "back-qr") size = custom.qrSize || 100;
    else size = 100;
  }
  return { font, size: Number(size), rotate, bold, italic, x: pos.x, y: pos.y };
}

export function renderCardDesign(custom, { face, interactiveProductId = "", selectedElementId = "", logoUrl = "", oneinfoLogoUrl = "" }) {
  const parsed = ProductCustomizationSchema.safeParse({ ...custom, name: custom.name?.trim() || "Your Name" });
  if (!parsed.success) return '<p class="card-design-error" role="alert">This saved card design could not be displayed. Please review its details.</p>';
  custom = parsed.data;
  const isLight = isColorLight(custom.surfaceColor);
  const surfaceBg = escapeHtml(custom.surfaceColor || "#0a0b0d");
  const cardAccent = escapeHtml(custom.accentColor || "#d8b26e");
  const layoutClass = `layout-${escapeHtml(custom.layout || 'left')}`;
  const motifClass = `motif-${escapeHtml(custom.surfaceMotif || 'facets')}`;
  const luminanceClass = isLight ? "is-light-surface light-card" : "dark-card";

  const ep = custom.elementPositions || {};
  const activeExtras = (custom.extraLines || []).filter(l => l && l.trim());
  const numExtras = activeExtras.length;

  const stName = getElementStyle(custom, "name");
  const stTitle = getElementStyle(custom, "title");
  const stLogo = getElementStyle(custom, "logo");
  const stSign = getElementStyle(custom, "sign");
  const stQr = getElementStyle(custom, "back-qr");

  const nameFontSize = `${(18 * stName.size / 14).toFixed(3)}px`;
  const titleFontSize = `${(10.4 * stTitle.size / 14).toFixed(3)}px`;
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
  const titlePosition = ep.title || ep.details;
  const titlePos = titlePosition?.x != null && titlePosition?.y != null ? titlePosition : null;
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

  const renderRotateHandle = (key) => interactiveProductId ? `
    <span class="corner-pin pin-tl" aria-hidden="true"></span>
    <span class="corner-pin pin-tr" aria-hidden="true"></span>
    <span class="corner-pin pin-bl" aria-hidden="true"></span>
    <span class="corner-pin pin-br" aria-hidden="true"></span>
    <button type="button" class="element-rotate-handle" data-rotate-handle="${escapeHtml(key)}" title="Click to rotate 90°, or drag to rotate freely" aria-label="Rotate element">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
      </svg>
    </button>
  ` : "";

  const frontIllustration = `<div class="card-design-canvas customizable-card ${layoutClass} ${motifClass} ${luminanceClass} card-view-front" style="background:${surfaceBg}; --card-accent:${cardAccent};" data-card-face="front" ${interactiveProductId ? `data-interactive-card="${escapeHtml(interactiveProductId)}"` : ""}>
    ${renderSurfaceMotifSvg(custom.surfaceMotif, custom.accentColor)}
    ${custom.layout === "column" ? `<div class="card-side-column-bar" aria-hidden="true"></div>` : ""}
    ${custom.layout === "header" ? `<div class="card-header-banner" aria-hidden="true"></div>` : ""}

    <div class="${interactiveProductId ? "card-drag-item " : ""}card-design-element card-element-logo ${logoPosClass} ${isLogoNearTop ? 'is-near-top' : ''} ${selectedElementId === 'logo' ? 'is-selected' : ''}" style="${logoStyle}" data-design-element="logo" data-product-id="${escapeHtml(interactiveProductId || "")}">
      ${(logoUrl || custom.logoUrl) ? `
        <img class="mini-product-logo custom-user-logo" src="${escapeHtml(logoUrl || custom.logoUrl)}" alt="Custom logo" />
      ` : `
        <span class="card-logo-placeholder" style="color:${escapeHtml(custom.accentColor)};">YOUR LOGO</span>
      `}
      ${renderRotateHandle("logo")}
    </div>

    <div class="${interactiveProductId ? "card-drag-item " : ""}card-design-element card-element-nfc ${signPosClass} ${isSignNearTop ? 'is-near-top' : ''} ${selectedElementId === 'sign' ? 'is-selected' : ''}" style="color:${escapeHtml(custom.accentColor)}; ${signStyle}" data-design-element="sign" data-product-id="${escapeHtml(interactiveProductId || "")}">
      <span class="card-nfc-wave" aria-hidden="true" style="color:inherit;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9a5 5 0 0 1 0 6"/><path d="M10 6a9 9 0 0 1 0 12"/><path d="M14 3a13 13 0 0 1 0 18"/></svg>
      </span>
      ${renderRotateHandle("sign")}
    </div>

    <div class="${interactiveProductId ? "card-drag-item " : ""}card-design-element card-element-name ${namePosClass} ${isNameNearTop ? 'is-near-top' : ''} font-${escapeHtml(stName.font)} ${selectedElementId === 'name' ? 'is-selected' : ''}" style="${nameStyle}" data-design-element="name" data-product-id="${escapeHtml(interactiveProductId || "")}">
      <strong class="card-custom-name ${!custom.name ? "is-placeholder" : ""} ${stName.bold ? "is-bold" : "is-not-bold"} ${stName.italic ? "is-italic" : ""}" style="font-size:${nameFontSize}; font-weight:${stName.bold ? 700 : 400}; font-style:${stName.italic ? 'italic' : 'normal'};">${escapeHtml(custom.name || "Your Name")}</strong>
      ${renderRotateHandle("name")}
    </div>

    <div class="${interactiveProductId ? "card-drag-item " : ""}card-design-element card-element-title ${titlePosClass} ${isTitleNearTop ? 'is-near-top' : ''} font-${escapeHtml(stTitle.font)} ${selectedElementId === 'title' ? 'is-selected' : ''}" style="${titleStyle}" data-design-element="title" data-product-id="${escapeHtml(interactiveProductId || "")}">
      <span class="card-custom-title ${!custom.title && numExtras === 0 ? "is-placeholder" : ""} ${stTitle.bold ? "is-bold" : "is-not-bold"} ${stTitle.italic ? "is-italic" : ""}" style="color:${escapeHtml(custom.accentColor)}; font-size:${titleFontSize}; font-weight:${stTitle.bold ? 700 : 400}; font-style:${stTitle.italic ? 'italic' : 'normal'};">${escapeHtml(custom.title || (numExtras > 0 ? "" : "Your Title / Role"))}</span>
      ${renderRotateHandle("title")}
    </div>

    ${(custom.extraLines || []).map((line, idx) => {
      if (!line || !line.trim()) return "";
      const extraKey = `extra-${idx}`;
      const stExtra = getElementStyle(custom, extraKey);
      const extraPos = ep[extraKey]?.x != null && ep[extraKey]?.y != null ? ep[extraKey] : null;
      const extraRot = stExtra.rotate;
      const extraFontSize = `${(10.4 * stExtra.size / 14).toFixed(3)}px`;
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
        <div class="${interactiveProductId ? "card-drag-item " : ""}card-design-element card-element-extra ${extraPosClass} font-${escapeHtml(stExtra.font)} ${selectedElementId === extraKey ? 'is-selected' : ''}" style="${extraStyle}" data-design-element="${extraKey}" data-extra-index="${idx}" data-product-id="${escapeHtml(interactiveProductId || "")}">
          <span class="card-custom-extra-line ${stExtra.bold ? 'is-bold' : 'is-not-bold'} ${stExtra.italic ? 'is-italic' : ''}" style="color:${escapeHtml(custom.accentColor)}; font-size:${extraFontSize}; font-weight:${stExtra.bold ? 700 : 400}; font-style:${stExtra.italic ? 'italic' : 'normal'};">${escapeHtml(line.trim())}</span>
          ${renderRotateHandle(extraKey)}
        </div>
      `;
    }).join("")}

    ${(custom.dividerLines || []).map((line, idx) => {
      const dividerKey = `divider-${idx}`;
      const dividerPos = ep[dividerKey]?.x != null && ep[dividerKey]?.y != null ? ep[dividerKey] : null;
      const divRot = dividerPos?.rotate || 0;
      const isVert = line.orientation === "vertical";
      const len = line.length || (isVert ? 60 : 100);
      const dividerStyle = dividerPos
        ? `left:${dividerPos.x}%; top:${dividerPos.y}%; --divider-len:${len}px; --rot:${divRot}deg;`
        : `left:50%; top:${50 + idx * 12}%; --divider-len:${len}px; --rot:${divRot}deg;`;
      return `
        <div class="${interactiveProductId ? "card-drag-item " : ""}card-design-element card-element-divider divider-${escapeHtml(line.orientation || 'horizontal')} ${line.style === 'dashed' ? 'is-dashed' : ''} pos-custom ${selectedElementId === dividerKey ? 'is-selected' : ''}" style="${dividerStyle} color:${escapeHtml(custom.accentColor)};" data-design-element="${dividerKey}" data-divider-index="${idx}" data-product-id="${escapeHtml(interactiveProductId || "")}">
          ${renderRotateHandle(dividerKey)}
        </div>
      `;
    }).join("")}
  </div>`;

  const backQrStyle = backQrPos ? `left:${backQrPos.x}%; top:${backQrPos.y}%; --scale:${qrScale}; --rot:${qrRot}deg;` : `--scale:${qrScale}; --rot:${qrRot}deg;`;
  const backQrClass = backQrPos ? "pos-custom" : "";

  const backIllustration = `<div class="card-design-canvas customizable-card ${luminanceClass} card-view-back" style="background:${surfaceBg}; --card-accent:${cardAccent};" data-card-face="back" ${interactiveProductId ? `data-interactive-card="${escapeHtml(interactiveProductId)}"` : ""}>
    ${renderBackMotifSvg(custom.surfaceMotif, custom.accentColor)}
    <div class="${interactiveProductId ? "card-drag-item " : ""}card-design-element card-back-center-qr ${backQrClass} ${selectedElementId === 'back-qr' ? 'is-selected' : ''}" style="${backQrStyle}" data-design-element="back-qr" data-product-id="${escapeHtml(interactiveProductId || "")}">
      <div class="card-qr-wrap ${escapeHtml(custom.backQrStyle || 'minimal')}">
        ${renderQrSvg(custom.accentColor, custom.backQrStyle || 'minimal')}
      </div>
      ${(custom.backSubtitle && custom.backSubtitle.trim()) ? `<span class="card-back-subtitle" style="color:${escapeHtml(custom.accentColor)};">${escapeHtml(custom.backSubtitle.trim())}</span>` : ""}
      ${renderRotateHandle("back-qr")}
    </div>
    <div class="card-back-footer" style="${custom.hasOneinfoLogo !== false && custom.brandingMode !== 'without-logo' ? '' : 'display:none;'}">
      ${custom.hasOneinfoLogo !== false ? `
        <img class="mini-product-logo card-back-oneinfo-logo" src="${escapeHtml(oneinfoLogoUrl)}" alt="Oneinfo logo" />
        ${renderAriseLogoSvg()}
      ` : `<!-- Brand labeling omitted (Without Oneinfo Logo edition) -->`}
    </div>
  </div>`;


  let markup = face === "front" ? frontIllustration : backIllustration;
  if (interactiveProductId) markup = markup.replaceAll('data-design-element=', 'data-drag-element=');
  return `<div class="card-design-viewport">${markup}</div>`;
}

export function observeCardDesigns(root) {
  const frames = [...root.querySelectorAll(".card-design-viewport")];
  const fit = frame => frame.style.setProperty("--design-scale", String(frame.clientWidth / 380));
  const observer = new ResizeObserver(entries => entries.forEach(({ target }) => fit(target)));
  frames.forEach(frame => { fit(frame); observer.observe(frame); });
  return () => observer.disconnect();
}
