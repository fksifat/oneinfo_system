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
