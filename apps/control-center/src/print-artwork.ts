import type { ProductCustomization } from "@oneinfo/contracts";
import lightBack from "../../../output/essential-svg/03_PRINT_Light_Back.svg?url";
import darkBack from "../../../output/essential-svg/05_PRINT_Black_Back.svg?url";

export const isQrImage = (value: string) => /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(value);
export const printTemplateUrl = (finish: "light" | "dark") => finish === "dark" ? darkBack : lightBack;

export async function loadPrintTemplate(finish: "light" | "dark", signal?: AbortSignal) {
  const response = await fetch(printTemplateUrl(finish), signal ? { signal } : {});
  if (!response.ok) throw new Error("Could not load the back artwork. Try again.");
  return response.text();
}

function isColorLight(hex?: string): boolean {
  if (!hex || !hex.startsWith("#")) return false;
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  if (isNaN(num)) return false;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.65;
}

export function escapePrintText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function printArtwork(template: string, imageData: string) {
  if (!isQrImage(imageData)) throw new Error("This saved QR image cannot be exported.");
  if (!template.includes('width="260.79" height="172.91"') || !template.includes("</svg>")) throw new Error("The back artwork has no matching print dimensions.");
  // Exact 94 x 63 mm with bleed
  return template.replace('width="260.79" height="172.91"', 'width="94mm" height="63mm"')
    .replace("</svg>", `<rect x="103" y="61" width="55" height="55" fill="white"/><image x="103" y="61" width="55" height="55" href="${imageData}" style="image-rendering:pixelated"/></svg>`);
}

export function generateCustomCardBackSvg(custom: ProductCustomization, qrImageData: string): string {
  const bg = custom.surfaceColor || "#0a0b0d";
  const stroke = custom.accentColor || "#d8b26e";
  const motif = custom.surfaceMotif || "facets";
  const qrStyle = custom.backQrStyle || "minimal";
  const ep = custom.elementPositions || {};
  const epQr = ep["back-qr"] as { x?: number; y?: number; rotate?: number; size?: number } | undefined;

  // 94x63 mm canvas (266.46 x 178.58 pt)
  // 86x55 mm trim card (243.78 x 155.91 pt) offset by 11.34 pt
  const qrScale = ((epQr && epQr.size != null ? epQr.size : custom.qrSize) || 100) / 100;
  const qrW = 50 * qrScale;
  const qrH = 50 * qrScale;
  const qrX = epQr && epQr.x != null ? (epQr.x / 100) * 243.78 - qrW / 2 : (243.78 - qrW) / 2;
  const qrY = epQr && epQr.y != null ? (epQr.y / 100) * 155.91 - qrH / 2 : (155.91 - qrH) / 2 - 4;

  const frameBorder =
    qrStyle === "framed"
      ? `stroke="${stroke}" stroke-width="1.5" rx="5"`
      : qrStyle === "badge"
      ? `stroke="${stroke}" stroke-width="1.2" stroke-dasharray="3 2" rx="6"`
      : `stroke="none"`;

  let motifSvg = "";
  if (motif === "facets") {
    motifSvg = `<g stroke="${stroke}" stroke-width="0.85" fill="none">
      <polygon points="0,0 70,0 40,50 0,35" stroke-opacity="0.35"/>
      <polygon points="70,0 140,0 110,45 40,50" stroke-opacity="0.22"/>
      <polygon points="40,50 0,35 0,95 55,90" stroke-opacity="0.28"/>
      <polygon points="243.78,155.91 178.78,155.91 203.78,113.91 243.78,123.91" stroke-opacity="0.28"/>
      <polyline points="243.78,155.91 203.78,113.91 193.78,73.91 243.78,68.91" stroke-opacity="0.4" stroke-width="1"/>
    </g>`;
  } else if (motif === "contour") {
    motifSvg = `<g stroke="${stroke}" stroke-width="0.9" fill="none">
      <path d="M-20,120 C80,130 140,80 220,90 C300,100 340,60 420,70" stroke-opacity="0.2"/>
      <path d="M-20,90 C70,100 150,50 230,60 C310,70 350,30 420,40" stroke-opacity="0.26"/>
      <ellipse cx="25" cy="28" rx="28" ry="15" stroke-opacity="0.22" transform="rotate(15 25 28)"/>
    </g>`;
  } else if (motif === "architectural") {
    motifSvg = `<g stroke="${stroke}" stroke-width="1.2" fill="none">
      <path d="M14,24 L14,14 L24,14" stroke-opacity="0.75"/>
      <path d="M229.78,24 L229.78,14 L219.78,14" stroke-opacity="0.75"/>
      <path d="M14,131.91 L14,141.91 L24,141.91" stroke-opacity="0.75"/>
      <path d="M229.78,131.91 L229.78,141.91 L219.78,141.91" stroke-opacity="0.75"/>
    </g>`;
  } else if (motif === "inlay") {
    motifSvg = `<g stroke="${stroke}" stroke-width="1.2" fill="none">
      <line x1="85" y1="0" x2="0" y2="85" stroke-opacity="0.45" stroke-width="1.5"/>
      <line x1="158.78" y1="155.91" x2="243.78" y2="70.91" stroke-opacity="0.45" stroke-width="1.5"/>
    </g>`;
  }

  const isLightCard = isColorLight(bg);
  const ariseColor = isLightCard ? "rgba(18,19,22,0.8)" : "rgba(255,255,255,0.75)";

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="94mm" height="63mm" viewBox="0 0 266.46 178.58">
    <!-- 1. Bleed Background 94x63 mm -->
    <rect x="0" y="0" width="266.46" height="178.58" fill="${bg}"/>

    <!-- 2. Crop Marks (86x55 mm trim indicators) -->
    <g stroke="${stroke}" stroke-width="0.5" fill="none">
      <!-- Bottom-Left -->
      <line x1="11.34" y1="1" x2="11.34" y2="8"/>
      <line x1="1" y1="11.34" x2="8" y2="11.34"/>
      <!-- Bottom-Right -->
      <line x1="255.12" y1="1" x2="255.12" y2="8"/>
      <line x1="265.46" y1="11.34" x2="258.46" y2="11.34"/>
      <!-- Top-Left -->
      <line x1="11.34" y1="177.58" x2="11.34" y2="170.58"/>
      <line x1="1" y1="167.24" x2="8" y2="167.24"/>
      <!-- Top-Right -->
      <line x1="255.12" y1="177.58" x2="255.12" y2="170.58"/>
      <line x1="265.46" y1="167.24" x2="258.46" y2="167.24"/>
    </g>

    <!-- 3. Card Trim (86x55 mm, 3mm radius at 11.34, 11.34) -->
    <g transform="translate(11.34, 11.34)">
      <!-- Trim cut contour -->
      <rect x="0" y="0" width="243.78" height="155.91" rx="8.5" ry="8.5" fill="none" stroke="${stroke}" stroke-width="0.5" stroke-opacity="0.6"/>

      <!-- Vector Motif Overlay -->
      ${motifSvg}

      <!-- Center QR Code Inlay Frame -->
      <g transform="translate(${Math.round(qrX)}, ${Math.round(qrY)})">
        <rect x="0" y="0" width="${qrW}" height="${qrH}" rx="4" fill="#ffffff" ${frameBorder}/>
        <image x="2" y="2" width="${qrW - 4}" height="${qrH - 4}" href="${qrImageData}" style="image-rendering:pixelated"/>
      </g>

      ${
        custom.backSubtitle && custom.backSubtitle.trim()
          ? `<text x="${Math.round(qrX + qrW / 2)}" y="${Math.round(qrY + qrH + 8)}" font-family="'Inter', -apple-system, sans-serif" font-size="5" fill="${stroke}" font-weight="500" text-anchor="middle" letter-spacing="0.04em">${escapePrintText(custom.backSubtitle.trim())}</text>`
          : ""
      }

      <!-- Footer: Oneinfo Logo & By AriseStudio -->
      <text x="14" y="145" font-family="'Inter', -apple-system, sans-serif" font-size="7" font-weight="700" fill="${stroke}" letter-spacing="0.08em">ONEINFO</text>
      <text x="230" y="145" font-family="'Inter', -apple-system, sans-serif" font-size="4.5" font-weight="600" fill="${ariseColor}" text-anchor="end" letter-spacing="0.1em">BY ARISESTUDIO</text>
    </g>
  </svg>`;
}
