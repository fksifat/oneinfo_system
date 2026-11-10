import { variantPrice } from '@oneinfo/contracts';

export function addCartVariant(cart, product, variant, quantity, customization = null) {
  if (!variant.available || !Number.isInteger(quantity) || quantity < 1 || quantity > 99)
    throw new RangeError('Choose an available colour and a quantity from 1 to 99.');
  const customKey = customization ? JSON.stringify(customization) : '';
  const existing = cart.find(item => item.id === product.id && item.variantId === variant.id && (item.customization ? JSON.stringify(item.customization) : '') === customKey);
  if ((existing?.quantity ?? 0) + quantity > 99) throw new RangeError('You can add up to 99 cards of each colour.');
  const item = {
    id: product.id,
    variantId: variant.id,
    name: product.name,
    variantName: variant.name,
    colorHex: variant.colorHex,
    priceMinor: variantPrice(variant),
    quantity: (existing?.quantity ?? 0) + quantity,
    ...(customization ? { customization } : {})
  };
  return existing ? cart.map(previous => previous === existing ? item : previous) : [...cart, item];
}

export function reconcileCartItems(cart, products) {
  const merged = new Map();
  for (const item of cart) {
    if (!item || !Number.isInteger(item.quantity) || item.quantity < 1) continue;
    const product = products.find(p => p.id === item.id || (!item.id && p.name === item.name));
    if (!product) continue;
    // Legacy carts predate colour selection; new carts never switch a missing colour.
    const variant = item.variantId ? product.variants.find(v => v.id === item.variantId) : product.variants[0];
    if (!variant?.available) continue;
    const customKey = item.customization ? JSON.stringify(item.customization) : '';
    const key = `${product.id}:${variant.id}:${customKey}`;
    const quantity = Math.min(99, (merged.get(key)?.quantity ?? 0) + item.quantity);
    merged.set(key, {
      id: product.id,
      variantId: variant.id,
      name: product.name,
      variantName: variant.name,
      colorHex: variant.colorHex,
      priceMinor: variantPrice(variant),
      quantity,
      ...(item.customization ? { customization: item.customization } : {})
    });
  }
  return [...merged.values()];
}

export function productRoute(hash) {
  if (!hash.startsWith('#product/')) return null;
  try {
    const [slug, query = ''] = hash.slice(9).split('?');
    return { slug: decodeURIComponent(slug), variantId: new URLSearchParams(query).get('colour') };
  } catch { return { slug: '', variantId: null }; }
}

export function spinFrame(start, distance, count) {
  if (count < 1) return 0;
  return ((start + Math.round(distance / 8)) % count + count) % count;
}

export const PREMIUM_PRESETS = [
  { id: "01", name: "01 · Obsidian Facets", layout: "left", motif: "facets", surfaceColor: "#0a0b0d", accentColor: "#d8b26e", label: "Classic Left", subtitle: "Left-aligned stack with geometric angled facets" },
  { id: "02", name: "02 · Midnight Contour", layout: "right", motif: "contour", surfaceColor: "#0a121e", accentColor: "#e2e8f0", label: "Right Aligned", subtitle: "Right-aligned stack with topographic flowing curves" },
  { id: "03", name: "03 · Forest Corner", layout: "center", motif: "architectural", surfaceColor: "#0d1f18", accentColor: "#c5a059", label: "Centered Stack", subtitle: "Centered stack with precision framing brackets" },
  { id: "04", name: "04 · Burgundy Inlay", layout: "reverse", motif: "inlay", surfaceColor: "#1f0a12", accentColor: "#e8a598", label: "Reverse Stack", subtitle: "Reverse stack with sleek diagonal foil stripes" },
  { id: "05", name: "05 · Midnight Split", layout: "split-logo-left", motif: "contour", surfaceColor: "#0a121e", accentColor: "#e2e8f0", label: "Split Left", subtitle: "Logo left / Name right with contoured curves" },
  { id: "06", name: "06 · Obsidian Split", layout: "split-logo-right", motif: "facets", surfaceColor: "#0a0b0d", accentColor: "#d8b26e", label: "Split Right", subtitle: "Name left / Logo right with faceted corner precision" },
  { id: "07", name: "07 · Forest Diagonal", layout: "diagonal", motif: "architectural", surfaceColor: "#0d1f18", accentColor: "#c5a059", label: "Diagonal Corners", subtitle: "Opposing diagonal balance with corner framing" },
  { id: "08", name: "08 · Burgundy Column", layout: "column", motif: "inlay", surfaceColor: "#1f0a12", accentColor: "#e8a598", label: "Side Column", subtitle: "Vertical signature column with foil inlays" },
  { id: "09", name: "09 · Signature Classic", layout: "left", motif: "facets", surfaceColor: "#0a0b0d", accentColor: "#d8b26e", label: "Original Signature", subtitle: "The flagship Oneinfo Signature composition" },
  { id: "10", name: "10 · Signature Header", layout: "header", motif: "architectural", surfaceColor: "#0d1f18", accentColor: "#c5a059", label: "Header Stack", subtitle: "Prestige header banner with centered name" },
];

export const SURFACE_COLORS = [
  { hex: "#0a0b0d", name: "Obsidian Black" },
  { hex: "#0a121e", name: "Midnight Navy" },
  { hex: "#0d1f18", name: "Forest Green" },
  { hex: "#1f0a12", name: "Imperial Burgundy" },
  { hex: "#1f2428", name: "Titanium Slate" },
  { hex: "#f7f5f0", name: "Pearl Ivory" },
];

export const ACCENT_COLORS = [
  { hex: "#d8b26e", name: "Champagne Gold" },
  { hex: "#c5a059", name: "Antique Gold" },
  { hex: "#e2e8f0", name: "Platinum Silver" },
  { hex: "#e8a598", name: "Rose Gold" },
  { hex: "#ffffff", name: "Crisp White" },
  { hex: "#e5c158", name: "Solar Gold" },
];

export function isColorLight(hex) {
  if (!hex || typeof hex !== "string" || !hex.startsWith("#") || hex.length < 7) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 165;
}

export function defaultCustomization(presetId = "01") {
  const preset = PREMIUM_PRESETS.find(p => p.id === presetId) || PREMIUM_PRESETS[0];
  return {
    name: "",
    title: "",
    presetId: preset.id,
    layout: preset.layout,
    surfaceMotif: preset.motif,
    surfaceColor: preset.surfaceColor,
    accentColor: preset.accentColor,
    font: "sans",
    finish: "matte",
    position: preset.layout,
    backQrStyle: "minimal",
    backSubtitle: "",
    logoUrl: "",
    logoPreviewUrl: "",
    logoFileName: "",
    extraLines: [],
    textSize: 14,
    logoSize: 100,
    iconSize: 100,
    qrSize: 100,
    dividerLines: [],
    customPos: null,
    elementPositions: {},
    activeSide: "front",
  };
}

export function renderSurfaceMotifSvg(motif, accentColor) {
  const stroke = accentColor || "#d8b26e";
  if (motif === "facets") {
    return `<svg class="card-surface-motif motif-facets" viewBox="0 0 400 252" preserveAspectRatio="none" aria-hidden="true"><g stroke="${stroke}" stroke-width="0.85" fill="none"><polygon points="400,0 330,0 360,50 400,35" stroke-opacity="0.35"/><polygon points="330,0 260,0 290,45 360,50" stroke-opacity="0.22"/><polygon points="360,50 400,35 400,95 345,90" stroke-opacity="0.28"/><polygon points="290,45 360,50 345,90 280,80" stroke-opacity="0.18"/><polygon points="345,90 400,95 400,150 355,135" stroke-opacity="0.22"/><polyline points="400,0 290,45 280,80 355,135 400,150" stroke-opacity="0.45" stroke-width="1.1"/><polygon points="0,252 65,252 40,210 0,220" stroke-opacity="0.28"/><polygon points="65,252 130,252 105,215 40,210" stroke-opacity="0.18"/><polygon points="0,220 40,210 50,170 0,165" stroke-opacity="0.22"/><polyline points="0,252 40,210 50,170 0,165" stroke-opacity="0.4" stroke-width="1"/></g></svg>`;
  }
  if (motif === "contour") {
    return `<svg class="card-surface-motif motif-contour" viewBox="0 0 400 252" preserveAspectRatio="none" aria-hidden="true"><g stroke="${stroke}" stroke-width="0.9" fill="none"><path d="M-20,180 C80,160 140,210 220,190 C300,170 340,220 420,200" stroke-opacity="0.2"/><path d="M-20,150 C70,130 150,180 230,160 C310,140 350,190 420,170" stroke-opacity="0.26"/><path d="M-20,120 C60,100 160,150 240,130 C320,110 360,160 420,140" stroke-opacity="0.32"/><path d="M-20,90 C50,70 170,120 250,100 C330,80 370,130 420,110" stroke-opacity="0.26"/><path d="M-20,60 C40,40 180,90 260,70 C340,50 380,100 420,80" stroke-opacity="0.2"/><path d="M-20,30 C30,10 190,60 270,40 C350,20 390,70 420,50" stroke-opacity="0.14"/><ellipse cx="360" cy="45" rx="55" ry="30" stroke-opacity="0.22" transform="rotate(-15 360 45)"/><ellipse cx="360" cy="45" rx="35" ry="18" stroke-opacity="0.3" transform="rotate(-15 360 45)"/><ellipse cx="360" cy="45" rx="15" ry="8" stroke-opacity="0.38" transform="rotate(-15 360 45)"/></g></svg>`;
  }
  if (motif === "architectural") {
    return `<svg class="card-surface-motif motif-architectural" viewBox="0 0 400 252" preserveAspectRatio="none" aria-hidden="true"><g stroke="${stroke}" stroke-width="1.2" fill="none"><path d="M22,38 L22,22 L38,22" stroke-opacity="0.75"/><path d="M378,38 L378,22 L362,22" stroke-opacity="0.75"/><path d="M22,214 L22,230 L38,230" stroke-opacity="0.75"/><path d="M378,214 L378,230 L362,230" stroke-opacity="0.75"/><line x1="200" y1="16" x2="200" y2="26" stroke-opacity="0.35"/><line x1="200" y1="226" x2="200" y2="236" stroke-opacity="0.35"/><line x1="14" y1="126" x2="24" y2="126" stroke-opacity="0.35"/><line x1="376" y1="126" x2="386" y2="126" stroke-opacity="0.35"/><rect x="34" y="34" width="332" height="184" rx="4" stroke-width="0.65" stroke-opacity="0.2" stroke-dasharray="3 4"/></g></svg>`;
  }
  if (motif === "inlay") {
    return `<svg class="card-surface-motif motif-inlay" viewBox="0 0 400 252" preserveAspectRatio="none" aria-hidden="true"><g stroke="${stroke}" stroke-width="1.2" fill="none"><line x1="260" y1="0" x2="400" y2="140" stroke-opacity="0.45" stroke-width="1.5"/><line x1="285" y1="0" x2="400" y2="115" stroke-opacity="0.28" stroke-width="0.8"/><line x1="310" y1="0" x2="400" y2="90" stroke-opacity="0.28" stroke-width="0.8"/><line x1="225" y1="0" x2="400" y2="175" stroke-opacity="0.22" stroke-width="0.8"/><line x1="0" y1="112" x2="140" y2="252" stroke-opacity="0.45" stroke-width="1.5"/><line x1="0" y1="137" x2="115" y2="252" stroke-opacity="0.28" stroke-width="0.8"/><line x1="0" y1="162" x2="90" y2="252" stroke-opacity="0.28" stroke-width="0.8"/></g></svg>`;
  }
  return "";
}

export function renderBackMotifSvg(motif, accentColor) {
  const stroke = accentColor || "#d8b26e";
  if (motif === "facets") {
    return `<svg class="card-surface-motif motif-facets-back" viewBox="0 0 400 252" preserveAspectRatio="none" aria-hidden="true"><g stroke="${stroke}" stroke-width="0.85" fill="none"><polygon points="0,0 70,0 40,50 0,35" stroke-opacity="0.35"/><polygon points="70,0 140,0 110,45 40,50" stroke-opacity="0.22"/><polygon points="40,50 0,35 0,95 55,90" stroke-opacity="0.28"/><polygon points="400,252 335,252 360,210 400,220" stroke-opacity="0.28"/><polyline points="400,252 360,210 350,170 400,165" stroke-opacity="0.4" stroke-width="1"/></g></svg>`;
  }
  if (motif === "contour") {
    return `<svg class="card-surface-motif motif-contour-back" viewBox="0 0 400 252" preserveAspectRatio="none" aria-hidden="true"><g stroke="${stroke}" stroke-width="0.9" fill="none"><path d="M-20,200 C80,210 140,160 220,170 C300,180 340,140 420,150" stroke-opacity="0.2"/><path d="M-20,170 C70,180 150,130 230,140 C310,150 350,110 420,120" stroke-opacity="0.26"/><path d="M-20,140 C60,150 160,100 240,110 C320,120 360,80 420,90" stroke-opacity="0.32"/><ellipse cx="40" cy="45" rx="45" ry="25" stroke-opacity="0.22" transform="rotate(15 40 45)"/></g></svg>`;
  }
  if (motif === "architectural") {
    return `<svg class="card-surface-motif motif-architectural-back" viewBox="0 0 400 252" preserveAspectRatio="none" aria-hidden="true"><g stroke="${stroke}" stroke-width="1.2" fill="none"><path d="M22,38 L22,22 L38,22" stroke-opacity="0.75"/><path d="M378,38 L378,22 L362,22" stroke-opacity="0.75"/><path d="M22,214 L22,230 L38,230" stroke-opacity="0.75"/><path d="M378,214 L378,230 L362,230" stroke-opacity="0.75"/><line x1="200" y1="16" x2="200" y2="26" stroke-opacity="0.35"/><line x1="200" y1="226" x2="200" y2="236" stroke-opacity="0.35"/></g></svg>`;
  }
  if (motif === "inlay") {
    return `<svg class="card-surface-motif motif-inlay-back" viewBox="0 0 400 252" preserveAspectRatio="none" aria-hidden="true"><g stroke="${stroke}" stroke-width="1.2" fill="none"><line x1="140" y1="0" x2="0" y2="140" stroke-opacity="0.45" stroke-width="1.5"/><line x1="115" y1="0" x2="0" y2="115" stroke-opacity="0.28" stroke-width="0.8"/><line x1="260" y1="252" x2="400" y2="112" stroke-opacity="0.45" stroke-width="1.5"/><line x1="285" y1="252" x2="400" y2="137" stroke-opacity="0.28" stroke-width="0.8"/></g></svg>`;
  }
  return "";
}

const QR_ONEINFO_ROWS = [
  "11111110110011000010001111111",
  "10000010001100000110001000001",
  "10111010000010111001001011101",
  "10111010111001001010001011101",
  "10111010010011110011001011101",
  "10000010010101000101001000001",
  "11111110101010101010101111111",
  "00000000000001100110100000000",
  "00101110100111010011110001001",
  "01000101010100100111011000001",
  "10011011101111111010000000011",
  "00010100110001101101111010010",
  "11001010000101110110101100000",
  "11111000001100110010111100011",
  "10101110101101111010010100111",
  "11111100011111101000110100011",
  "00010111111110100001111001010",
  "00110000101011110010111000111",
  "10101011111101111000110101011",
  "01110100100110011000101011011",
  "10110110101101011011111110011",
  "00000000101001000001100010011",
  "11111110001110101001101010111",
  "10000010110011100000100010000",
  "10111010100001110010111111000",
  "10111010011000111100110010100",
  "10111010111000100011000110001",
  "10000010010001111001111100010",
  "11111110010011001101111010011"
];

const QR_DOTS_SVG = (() => {
  const size = 29;
  const width = 512;
  const scale = width / (size + 8);
  const pixel = (x) => (width - size * scale) / 2 + x * scale;
  const r = (0.5 * scale).toFixed(1);
  const circles = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const finder = (row < 7 && col < 7) || (row < 7 && col >= size - 7) || (row >= size - 7 && col < 7);
      if (!finder && QR_ONEINFO_ROWS[row][col] === "1") {
        circles.push(`<circle cx="${pixel(col + 0.5).toFixed(1)}" cy="${pixel(row + 0.5).toFixed(1)}" r="${r}" fill="#121316"/>`);
      }
    }
  }
  return circles.join("");
})();

const QR_FINDERS_SVG = (() => {
  const size = 29;
  const width = 512;
  const scale = width / (size + 8);
  const pixel = (x) => (width - size * scale) / 2 + x * scale;
  const r35 = (3.5 * scale).toFixed(1);
  const r25 = (2.5 * scale).toFixed(1);
  const r15 = (1.5 * scale).toFixed(1);
  const finders = [[3.5, 3.5], [size - 3.5, 3.5], [3.5, size - 3.5]];
  return finders.map(([cx, cy]) => {
    const px = pixel(cx).toFixed(1);
    const py = pixel(cy).toFixed(1);
    return `<circle cx="${px}" cy="${py}" r="${r35}" fill="#121316"/><circle cx="${px}" cy="${py}" r="${r25}" fill="#ffffff"/><circle cx="${px}" cy="${py}" r="${r15}" fill="#121316"/>`;
  }).join("");
})();

const QR_CENTER_BADGE_SVG = (() => {
  const size = 29;
  const width = 512;
  const scale = width / (size + 8);
  const pixel = (x) => (width - size * scale) / 2 + x * scale;
  const centre = pixel(size / 2).toFixed(1);
  const whiteR = (2 * scale).toFixed(1);
  const darkR = (1.8 * scale).toFixed(1);
  const markSize = 1.8 * scale * 1.35;
  const origin = (pixel(size / 2) - markSize / 2).toFixed(1);
  const markScale = (markSize / 280).toFixed(4);
  return `<circle cx="${centre}" cy="${centre}" r="${whiteR}" fill="#ffffff"/><circle cx="${centre}" cy="${centre}" r="${darkR}" fill="#121316"/><g transform="translate(${origin}, ${origin}) scale(${markScale})" fill="#ffffff"><g transform="translate(0.630915, -12.517350) scale(0.403785489)"><path fill-rule="evenodd" d="M 171.1 494.42 C 163.37 492.34 156.33 488.25 150.54 482.47 C 146.67 478.6 144.37 474.9 140.6 466.47 C 129.74 442.15 100.68 378.26 91.73 359 C 86.49 347.73 81.65 336.48 80.99 334 C 79.21 327.42 79.46 313.38 81.47 306.42 C 84.11 297.26 88.93 289.07 95.53 282.5 C 100.89 277.16 105.87 274.19 141.03 255.35 C 176 236.61 208.85 219.19 243.5 201 C 280.55 181.56 358.57 140.06 386.55 124.92 C 408.27 113.17 414.39 111.04 426.54 111.01 C 445.21 110.98 463.26 121.58 471.65 137.51 C 474.92 143.72 479 155.75 479 159.18 C 479 160.71 476.21 162.47 466.25 167.19 C 370.92 212.44 350.48 222.35 266 264.25 C 228.32 282.93 191.2 301.3 183.5 305.06 C 168.18 312.54 160.25 318.21 153.95 326.19 C 144.87 337.67 140.6 349.81 140.85 364 C 141.192 373.11 141.559 374.46 150.163 397 C 161.417 426.02 177.36 472.43 181.03 484.5 C 182.53 489.45 183.98 494.06 184.24 494.75 C 184.85 496.35 177.95 496.26 171.1 494.42 Z"/><path fill-rule="evenodd" d="M243.5 548.6 C232.09 544.97 220.51 535.83 215.92 526.84 C214.78 524.6 207.56 504.71 199.88 482.64 C192.2 460.56 181.84 430.86 176.85 416.64 C171.86 402.41 167.31 387.78 166.75 384.12 C164.58 370.1 171.15 351.79 182.38 340.61 C189.7 333.3 193.88 331.02 222.5 318.71 C243.1 309.85 266.87 299.45 316 277.77 C372.58 252.82 400.63 240.34 433.5 225.49 C470.3 208.87 498.64 196.28 509.71 191.62 C524.39 185.44 538.99 185.73 552.61 192.46 C562.2 197.2 568.83 203.85 573.63 213.56 C576.84 220.07 577.39 222.15 577.44 228.14 C577.5 235.12 577.5 235.12 556 243.93 C544.17 248.77 507.5 264 474.5 277.77 C441.5 291.54 398.98 309.21 380 317.03 C361.02 324.85 336.27 335.05 325 339.7 C275.97 359.91 269.08 363.07 260.99 369.07 C242.86 382.51 231.01 404.25 231.04 424 C231.05 429.66 232.48 438.39 240.46 481.5 C243 495.25 246.65 515.05 248.56 525.5 C250.47 535.95 252.29 545.74 252.6 547.25 C253.11 549.74 252.9 549.99 250.33 549.93 C248.77 549.9 245.7 549.29 243.5 548.6 Z"/><path fill-rule="evenodd" d="M 301.6 583.01 C 294.9 580.87 286.4 575.39 283.32 571.22 C 277.49 563.34 276.06 558.57 272.54 535.27 C 267.69 503.18 260.32 454.89 258.91 445.99 C 257.91 439.67 257.97 437.23 259.31 430.66 C 262.48 415.09 272.19 400.67 285.2 392.2 C 293.68 386.68 373.15 354.7 545.61 287.56 L 600.861 266.05 A 50 50 0 0 1 669 312.644 L 669 364.77 C 669 425.57 668.9 429.11 667.04 435.14 C 663.5 446.66 654.76 457.66 644.83 463.19 C 642.19 464.67 627.58 470.81 612.53 476.84 C 597.6 482.87 561.55 497.52 531.96 509.4 C 501.43 521.28 475.78 531 475.68 531 C 475.58 531 475.5 498.91 475.5 459.68 C 475.5 388.36 475.5 388.36 472.77 384.24 C 471.27 381.97 467.9 378.85 465.27 377.31 C 461.17 374.89 459.45 374.5 453 374.53 C 445.8 374.56 445.01 374.81 433 380.9 C 407.96 393.6 348.42 425.32 345.35 427.6 C 343.62 428.89 341.04 432.3 339.6 435.17 C 334.35 445.7 337.11 457.45 346.28 463.66 C 353.05 468.23 357.26 468.63 370.46 465.92 C 381.66 463.62 381.66 463.62 386.53 466.06 C 389.21 467.4 392.32 469.77 393.45 471.32 C 395.44 474.06 395.5 475.38 395.5 515.15 L 395.5 556.16 387.5 559.22 C 383.1 560.91 368.02 566.78 354 572.27 C 339.98 577.76 326.25 582.87 323.5 583.62 C 316.65 585.48 308.64 585.26 301.6 583.01 Z"/></g></g>`;
})();

export function renderQrSvg(accentColor = "#d8b26e", style = "minimal") {
  const stroke = accentColor || "#d8b26e";
  const frameBorder = style === "framed"
    ? `stroke="${stroke}" stroke-width="6" rx="36"`
    : style === "badge"
    ? `stroke="${stroke}" stroke-width="4.5" stroke-dasharray="4 2" rx="42"`
    : `stroke="none"`;

  return `<svg class="card-qr-svg qr-style-${style}" viewBox="0 0 512 512" width="76" height="76" aria-label="Oneinfo NFC &amp; QR link to oneinfo.online">
    <rect x="3" y="3" width="506" height="506" rx="36" fill="#ffffff" ${frameBorder}/>
    ${QR_FINDERS_SVG}
    <g>${QR_DOTS_SVG}</g>
    ${QR_CENTER_BADGE_SVG}
  </svg>`;
}

export function renderAriseLogoSvg() {
  return `<svg class="card-back-arise-svg" viewBox="0 0 423.23 63.29" fill="currentColor" aria-label="By AriseStudio">
    <path d="M0 50.29L0 5.29L16.98 5.29C20.11 5.29 23.22 5.75 25.31 6.65C27.3 7.44 29.04 8.96 30.22 10.86C31.33 12.56 32 14.72 32 16.78C32 18.53 31.46 20.5 30.39 22.2C29.2 23.59 27.72 25.25 25.56 26.29C28.08 27.1 30.35 28.46 31.81 30.39C33 32.28 34 34.59 34 37.22C34 39.02 33.55 41.29 32.66 43.11C31.55 44.65 30.67 46.32 29.36 47.31C27.93 48.29 26.4 49.04 24.42 49.54C22.31 49.96 20.04 50.29 17.17 50.29L0 50.29ZM6 24.29L15.75 24.29C18.13 24.29 20.27 24.12 21.42 23.76C22.8 23.14 24.08 22.52 24.84 21.45C25.33 20.32 26 19.03 26 17.4C26 15.82 25.64 14.51 24.92 13.34C23.89 12.16 23.18 11.38 21.84 10.95C20.24 10.29 18.24 10.29 15 10.29L6 10.29L6 24.29ZM6 45.29L17.28 45.29C19.13 45.29 20.58 45.22 21.36 45.07C22.61 44.56 23.88 44.4 24.81 43.81C25.47 43.04 26.5 42.35 27.09 41.22C27.66 39.77 28 38.77 28 37.29C28 35.57 27.55 34.06 26.64 32.78C25.53 31.34 24.53 30.6 23 30.07C21.48 29.29 19.29 29.29 16.42 29.29L6 29.29L6 45.29"/>
    <path d="M42 62.67L41 57.81C42.2 57.96 43.24 58.29 44.13 58.29C45.3 58.29 46.32 58.08 47.05 57.67C47.76 57.12 48.38 56.67 48.84 55.93C48.91 55.16 49.74 53.98 50.52 51.76C50.45 51.29 50.78 50.99 51 50.39L39 17.29L45.31 17.29L51.77 34.42C52.34 36.56 53.35 38.88 54.02 41.28C54.28 40.14 54.83 38.84 55.64 36.4L62 17.29L68.27 17.29L57 51.17C55.63 54.3 54.57 56.95 53.81 58.25C52.53 59.67 51.64 61.26 50.33 62.07C48.91 62.62 47.47 63.29 45.66 63.29C44.34 63.29 43.34 63.08 42 62.67"/>
    <path fill-rule="evenodd" d="M126.84 0L140.22 0L108.29 48.95C107.77 49.72 107.27 49.65 106.76 48.76L100.64 39.2C99.49 37.48 99.49 35.38 100.64 33.85L122.05 3.63C123.46 1.21 125.05 0 126.84 0"/>
    <path fill-rule="evenodd" d="M143.09 2.87L162.97 33.08C163.86 34.61 163.93 36.2 163.16 37.86L156.28 48.38C155.26 49.91 154.24 49.91 153.22 48.38L133.34 17.4C132.95 16.77 132.95 16.13 133.34 15.49L141.56 3.06C142.07 2.3 142.58 2.23 143.09 2.87"/>
    <path fill-rule="evenodd" d="M127.41 31.74L141.56 31.74L132.19 46.09C130.66 48.38 128.55 49.52 125.88 49.52L110.96 49.52L120.52 35.19C122.05 32.89 124.35 31.74 127.41 31.74"/>
    <path fill-rule="evenodd" d="M175.87 42.54L189.08 10.03C189.59 8.85 190.43 8.25 191.62 8.25L196.19 8.25C197.38 8.25 198.22 8.85 198.73 10.03L211.43 42.54L204.32 42.54L201.02 33.65L186.29 33.65L182.73 42.54ZM188.82 27.81L198.73 27.81L193.9 15.37"/>
    <path fill-rule="evenodd" d="M212.95 42.54L212.95 27.56C212.95 20.78 216.34 17.4 223.11 17.4L227.68 17.4L227.68 22.73L223.36 22.73C220.48 22.73 219.05 24.43 219.05 27.81L219.05 42.54"/>
    <path fill-rule="evenodd" d="M230.22 8.25L235.3 8.25C235.64 8.25 235.81 8.43 235.81 8.76L235.81 13.84C235.81 14.18 235.64 14.35 235.3 14.35L230.22 14.35C229.88 14.35 229.71 14.18 229.71 13.84L229.71 8.76C229.71 8.43 229.88 8.25 230.22 8.25ZM229.71 17.4L234.79 17.4C235.47 17.4 235.81 17.74 235.81 18.41L235.81 42.54L229.71 42.54"/>
    <path fill-rule="evenodd" d="M245.46 17.4L259.93 17.4L259.93 22.48L245.97 22.48C244.44 22.48 243.68 23.16 243.68 24.51C243.68 25.69 244.61 26.54 246.48 27.05L253.84 29.08C257.9 30.1 259.93 32.38 259.93 35.94C259.93 40.34 257.65 42.54 253.08 42.54L237.84 42.54L237.84 37.46L252.32 37.46C253.5 37.46 254.09 36.87 254.09 35.68C254.09 34.67 253.33 33.99 251.81 33.65L244.7 31.62C240.13 30.43 237.84 28.15 237.84 24.76C237.84 19.85 240.38 17.4 245.46 17.4"/>
    <path fill-rule="evenodd" d="M270.6 17.4L276.44 17.4C281.86 17.4 284.57 20.19 284.57 25.78L284.57 30.35C284.57 31.71 283.89 32.38 282.54 32.38L269.08 32.38L269.08 28.57L271.87 28.57L272.89 27.56L278.48 27.56L278.48 25.78C278.48 23.58 277.38 22.48 275.17 22.48L271.62 22.48C269.25 22.48 268.06 23.75 268.06 26.29L268.06 33.91C268.06 36.28 269.33 37.46 271.87 37.46L284.57 37.46L284.57 42.54L270.6 42.54C264.84 42.54 261.97 39.75 261.97 34.16L261.97 26.03C261.97 20.28 264.84 17.4 270.6 17.4"/>
    <path fill-rule="evenodd" d="M314.29 8.25L297.02 8.25C290.07 8.25 286.6 11.56 286.6 18.16L286.6 19.43C286.6 23.66 289.06 26.46 293.97 27.81L304.13 30.61C307 31.28 308.44 32.64 308.44 34.67C308.44 36.7 307.17 37.72 304.63 37.72L293.97 37.72L292.7 38.73L286.6 38.73L286.6 42.54L304.38 42.54C311.32 42.54 314.79 39.66 314.79 33.91L314.79 32.89C314.79 28.66 312.51 25.95 307.93 24.76L297.27 21.97C294.22 21.12 292.7 19.77 292.7 17.91C292.7 15.53 294.14 14.35 297.02 14.35L308.19 14.35L309.46 13.08L314.29 13.08"/>
    <path fill-rule="evenodd" d="M321.9 10.03L328 10.03L328 17.4L333.33 17.4L333.33 22.48L328 22.48L328 33.4C328 36.11 329.27 37.46 331.81 37.46L333.33 37.46L333.33 42.54L329.52 42.54C324.44 42.54 321.9 39.92 321.9 34.67L321.9 22.48L316.82 22.48L316.82 17.4L321.9 17.4"/>
    <path fill-rule="evenodd" d="M335.36 17.4L341.46 17.4L341.46 33.4C341.46 36.11 342.73 37.46 345.27 37.46L349.08 37.46C351.62 37.46 352.89 36.11 352.89 33.4L352.89 17.4L358.98 17.4L358.98 34.16C358.98 39.75 356.11 42.54 350.35 42.54L344 42.54C338.24 42.54 335.36 39.75 335.36 34.16"/>
    <path fill-rule="evenodd" d="M380.82 8.25L386.92 8.25L386.92 34.16C386.92 39.75 384.04 42.54 378.29 42.54L369.65 42.54C363.89 42.54 361.02 39.75 361.02 34.16L361.02 26.03C361.02 20.28 363.89 17.4 369.65 17.4L380.82 17.4ZM370.66 22.48C368.29 22.48 367.11 23.83 367.11 26.54L367.11 33.4C367.11 36.11 368.46 37.46 371.17 37.46L377.02 37.46C379.55 37.46 380.82 36.11 380.82 33.4L380.82 23.75C380.82 22.9 380.4 22.48 379.55 22.48"/>
    <path fill-rule="evenodd" d="M389.96 8.25L395.05 8.25C395.38 8.25 395.55 8.43 395.55 8.76L395.55 13.84C395.55 14.18 395.38 14.35 395.05 14.35L389.96 14.35C389.63 14.35 389.46 14.18 389.46 13.84L389.46 8.76C389.46 8.43 389.63 8.25 389.96 8.25ZM389.46 17.4L394.54 17.4C395.21 17.4 395.55 17.74 395.55 18.41L395.55 42.54L389.46 42.54"/>
    <path fill-rule="evenodd" d="M406.73 17.4L414.6 17.4C420.36 17.4 423.23 20.28 423.23 26.03L423.23 33.91C423.23 39.66 420.36 42.54 414.6 42.54L406.73 42.54C400.97 42.54 398.09 39.66 398.09 33.91L398.09 26.03C398.09 20.28 400.97 17.4 406.73 17.4ZM408 22.48C405.46 22.48 404.19 23.83 404.19 26.54L404.19 33.4C404.19 36.11 405.46 37.46 408 37.46L413.33 37.46C415.87 37.46 417.14 36.11 417.14 33.4L417.14 26.54C417.14 23.83 415.87 22.48 413.33 22.48"/>
  </svg>`;
}
