import type { ProductCustomization } from "@oneinfo/contracts";

export interface OrderEpsInfo {
  id: string;
  transactionId?: string | null | undefined;
  invoiceNumber?: string | null | undefined;
  customerName?: string | null | undefined;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  if (isNaN(num)) return [0.1, 0.1, 0.1];
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  return [Number(r.toFixed(3)), Number(g.toFixed(3)), Number(b.toFixed(3))];
}

function escapePs(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// ============================================================================
// Production Vector EPS Specifications (Strict 86x55 mm trim + 4mm bleed = 94x63 mm):
// 1 mm = 72 / 25.4 = 2.83464567 pt
// Canvas / Artboard (Bleed): 94.00 mm = 266.46 pt, 63.00 mm = 178.58 pt
// Finished Card (Trim):      86.00 mm = 243.78 pt, 55.00 mm = 155.91 pt
// Bleed Margin:               4.00 mm =  11.34 pt on all 4 sides (left, right, bottom, top)
// Corner Radius:              3.00 mm =   8.50 pt
// ============================================================================
export const EPS_SPEC = {
  canvasW: 266.46, // 94 mm in pt
  canvasH: 178.58, // 63 mm in pt
  cardW: 243.78,   // 86 mm in pt
  cardH: 155.91,   // 55 mm in pt
  bleed: 11.34,    // 4 mm in pt
  cardR: 8.5,      // 3 mm corner radius in pt
};

export function generateCardFaceEps(
  custom: ProductCustomization,
  order: OrderEpsInfo,
  side: "front" | "back"
): string {
  const [bgR, bgG, bgB] = hexToRgb(custom.surfaceColor || "#0a0b0d");
  const [accentR, accentG, accentB] = hexToRgb(custom.accentColor || "#d8b26e");
  const fontName = custom.font === "serif" ? "Times-Bold" : custom.font === "mono" ? "Courier-Bold" : "Helvetica-Bold";
  const titleFont = custom.font === "serif" ? "Times-Roman" : custom.font === "mono" ? "Courier" : "Helvetica";

  const txn = order.transactionId?.trim() || order.invoiceNumber?.trim() || order.id;
  const cardName = escapePs(custom.name || order.customerName || "Cardholder Name");
  const cardTitle = escapePs(custom.title || "Custom Edition");
  const layout = custom.layout || "left";
  const motif = custom.surfaceMotif || "facets";
  const textScale = (custom.textSize || 14) / 14;
  const logoScale = (custom.logoSize || 100) / 100;
  const iconScale = (custom.iconSize || 100) / 100;
  const qrScale = (custom.qrSize || 100) / 100;
  const namePt = (12 * textScale).toFixed(1);
  const titlePt = (6.5 * textScale).toFixed(1);
  const logoPt = (11 * logoScale).toFixed(1);
  const arcR1 = (5 * iconScale).toFixed(1);
  const arcR2 = (9 * iconScale).toFixed(1);
  const extraLines = (custom.extraLines || []).filter((l) => l && l.trim()).map(escapePs);
  const ep = custom.elementPositions || {};

  // Front element coordinates relative to 86x55 mm trim box
  const epLogo = ep.logo;
  const logoX = epLogo
    ? Math.round((epLogo.x / 100) * EPS_SPEC.cardW)
    : (layout === "center" || layout === "header") ? 98 : (layout === "right" || layout === "reverse") ? 175 : 20;
  const logoY = epLogo
    ? Math.round(((100 - epLogo.y) / 100) * EPS_SPEC.cardH)
    : (layout === "reverse") ? 22 : 128;

  const epSign = ep.sign;
  const nfcX = epSign ? Math.round((epSign.x / 100) * EPS_SPEC.cardW) : 222;
  const nfcY = epSign ? Math.round(((100 - epSign.y) / 100) * EPS_SPEC.cardH) : 132;

  const epName = ep.name || custom.customPos;
  const nameX = epName
    ? Math.round((epName.x / 100) * EPS_SPEC.cardW)
    : (layout === "center" || layout === "header") ? 90 : (layout === "right" || layout === "split-logo-left" || layout === "diagonal") ? 130 : 20;
  const nameY = epName
    ? Math.round(((100 - epName.y) / 100) * EPS_SPEC.cardH)
    : (layout === "center" || layout === "header") ? 52 : (layout === "reverse" || layout === "split-logo-right") ? 105 : 38;

  const epTitle = ep.title || ep.details || (custom.customPos ? { x: custom.customPos.x, y: Math.min(90, custom.customPos.y + 10) } : null);
  const titleX = epTitle
    ? Math.round((epTitle.x / 100) * EPS_SPEC.cardW)
    : (layout === "center" || layout === "header") ? 90 : (layout === "right" || layout === "split-logo-left" || layout === "diagonal") ? 130 : 20;
  const titleY = epTitle
    ? Math.round(((100 - epTitle.y) / 100) * EPS_SPEC.cardH)
    : (layout === "center" || layout === "header") ? 40 : (layout === "reverse" || layout === "split-logo-right") ? 93 : 26;

  // Back QR coordinates relative to 86x55 mm trim box
  const epQr = ep["back-qr"];
  const qrX = epQr ? Math.round((epQr.x / 100) * EPS_SPEC.cardW) : Math.round((EPS_SPEC.cardW - 50) / 2);
  const qrY = epQr ? Math.round(((100 - epQr.y) / 100) * EPS_SPEC.cardH) : Math.round((EPS_SPEC.cardH - 50) / 2);

  const sideLabel = side === "front" ? "FRONT ARTWORK (LASER ENGRAVE & FOIL)" : "BACK ARTWORK (QR & NFC PRINT)";

  return `%!PS-Adobe-3.0 EPSF-3.0
%%Creator: Oneinfo Bespoke Card Studio
%%Title: Oneinfo Production Vector EPS (${side.toUpperCase()}) - ${txn}
%%BoundingBox: 0 0 267 179
%%HiResBoundingBox: 0 0 ${EPS_SPEC.canvasW} ${EPS_SPEC.canvasH}
%%CropBox: 0 0 ${EPS_SPEC.canvasW} ${EPS_SPEC.canvasH}
%%TrimBox: ${EPS_SPEC.bleed} ${EPS_SPEC.bleed} ${EPS_SPEC.bleed + EPS_SPEC.cardW} ${EPS_SPEC.bleed + EPS_SPEC.cardH}
%%BleedBox: 0 0 ${EPS_SPEC.canvasW} ${EPS_SPEC.canvasH}
%%Orientation: Landscape
%%Pages: 1
%%LanguageLevel: 3
%%DocumentData: Clean7Bit
%%Note: Finished Card Size: 86.00 x 55.00 mm (${EPS_SPEC.cardW} x ${EPS_SPEC.cardH} pt)
%%Note: Bleed Canvas Size: 94.00 x 63.00 mm (${EPS_SPEC.canvasW} x ${EPS_SPEC.canvasH} pt)
%%Note: Bleed Margin: 4.00 mm on each side (${EPS_SPEC.bleed} pt)
%%EndComments

/canvasW ${EPS_SPEC.canvasW} def
/canvasH ${EPS_SPEC.canvasH} def
/cardW ${EPS_SPEC.cardW} def
/cardH ${EPS_SPEC.cardH} def
/bleed ${EPS_SPEC.bleed} def
/cardR ${EPS_SPEC.cardR} def

/roundrect { % x y w h r roundrect
  /r exch def /h exch def /w exch def /y exch def /x exch def
  newpath
  x r add y moveto
  x w add y x w add y h add r arcto 4 {pop} repeat
  x w add y h add x y h add r arcto 4 {pop} repeat
  x y h add x y r arcto 4 {pop} repeat
  x y x w add y r arcto 4 {pop} repeat
  closepath
} def

% ========================================================
% 1. BLEED BACKGROUND (Edge-to-Edge 94 x 63 mm)
% ========================================================
newpath
0 0 moveto
canvasW 0 lineto
canvasW canvasH lineto
0 canvasH lineto
closepath
${bgR} ${bgG} ${bgB} setrgbcolor fill

% ========================================================
% 2. CORNER CROP MARKS / TRIM MARKS (86 x 55 mm Cut Indicator)
% ========================================================
gsave
0.4 setlinewidth
${accentR} ${accentG} ${accentB} setrgbcolor
% Bottom-Left
newpath bleed 1 moveto bleed 8 lineto stroke
newpath 1 bleed moveto 8 bleed lineto stroke
% Bottom-Right
newpath bleed cardW add 1 moveto bleed cardW add 8 lineto stroke
newpath canvasW 1 sub bleed moveto canvasW 8 sub bleed lineto stroke
% Top-Left
newpath bleed canvasH 1 sub moveto bleed canvasH 8 sub lineto stroke
newpath 1 bleed cardH add moveto 8 bleed cardH add lineto stroke
% Top-Right
newpath bleed cardW add canvasH 1 sub moveto bleed cardW add canvasH 8 sub lineto stroke
newpath canvasW 1 sub bleed cardH add moveto canvasW 8 sub bleed cardH add lineto stroke
grestore

% ========================================================
% 3. CARD TRIM BOUNDARY (Origin: bleed, bleed = 11.34, 11.34 pt)
% ========================================================
gsave
bleed bleed translate

% Die-cut trim contour hairline stroke
0 0 cardW cardH cardR roundrect
${accentR} ${accentG} ${accentB} setrgbcolor 0.6 setlinewidth stroke

% Clip vector artwork strictly inside 86x55 mm trim rounded rectangle
0 0 cardW cardH cardR roundrect clip

${side === "front" ? `
% --------------------------------------------------------
% FRONT FACE ARTWORK
% --------------------------------------------------------
% Motif Vector Overlay
${accentR} ${accentG} ${accentB} setrgbcolor
${
  motif === "facets"
    ? `
% Layered Facets Motif
0.8 setlinewidth
newpath
243.78 155.91 moveto 201 155.91 lineto 219 124 lineto 243.78 133 lineto closepath stroke
newpath
201 155.91 moveto 158 155.91 lineto 176 127 lineto 219 124 lineto closepath stroke
newpath
219 124 moveto 243.78 133 lineto 243.78 97 lineto 210 100 lineto closepath stroke
newpath
0 0 moveto 39 0 lineto 24 25 lineto 0 19 lineto closepath stroke
newpath
39 0 moveto 78 0 lineto 63 22 lineto 24 25 lineto closepath stroke
`
    : motif === "contour"
    ? `
% Contour Engraving Motif
0.7 setlinewidth
newpath -10 40 moveto 50 50 90 20 140 30 curveto 190 40 220 10 264 20 curveto stroke
newpath -10 60 moveto 45 70 85 40 135 50 curveto 185 60 215 30 264 40 curveto stroke
newpath -10 80 moveto 40 90 80 60 130 70 curveto 180 80 210 50 264 60 curveto stroke
newpath -10 100 moveto 35 110 75 80 125 90 curveto 175 100 205 70 264 80 curveto stroke
`
    : motif === "architectural"
    ? `
% Architectural Corner Motif
1.2 setlinewidth
newpath 14 128 moveto 14 142 lineto 28 142 lineto stroke
newpath 230 128 moveto 230 142 lineto 216 142 lineto stroke
newpath 14 28 moveto 14 14 lineto 28 14 lineto stroke
newpath 230 28 moveto 230 14 lineto 216 14 lineto stroke
0.5 setlinewidth
[2 3] 0 setdash
newpath 22 22 moveto 222 22 lineto 222 134 lineto 22 134 lineto closepath stroke
[] 0 setdash
`
    : motif === "inlay"
    ? `
% Diagonal Inlay Motif
1.0 setlinewidth
newpath 150 155.91 moveto 243.78 62 lineto stroke
newpath 165 155.91 moveto 243.78 77 lineto stroke
newpath 180 155.91 moveto 243.78 92 lineto stroke
newpath 0 94 moveto 94 0 lineto stroke
newpath 0 79 moveto 79 0 lineto stroke
newpath 0 64 moveto 64 0 lineto stroke
`
    : "% Minimal - Clean finish"
}

% Logo & NFC Glyph (Customer Logo / "YOUR LOGO" placeholder text)
${
  custom.companyName
    ? `${accentR} ${accentG} ${accentB} setrgbcolor
/Helvetica-Bold findfont ${logoPt} scalefont setfont
${logoX} ${logoY} moveto (${escapePs(custom.companyName)}) show`
    : `${accentR} ${accentG} ${accentB} setrgbcolor
/Helvetica-Bold findfont ${logoPt} scalefont setfont
${logoX} ${logoY} moveto (YOUR LOGO) show`
}

% NFC wave icon
newpath
${nfcX} ${nfcY} ${arcR1} 45 135 arc stroke
newpath
${nfcX} ${nfcY} ${arcR2} 45 135 arc stroke

% Divider Lines (HR & Vertical)
${(custom.dividerLines || [])
  .map((line, idx) => {
    const epLine = ep[`divider-${idx}`];
    const cx = epLine ? Math.round((epLine.x / 100) * EPS_SPEC.cardW) : Math.round(EPS_SPEC.cardW / 2);
    const cy = epLine ? Math.round(((100 - epLine.y) / 100) * EPS_SPEC.cardH) : Math.round(EPS_SPEC.cardH / 2);
    const isVert = line.orientation === "vertical";
    const lenPt = Math.round(((line.length || (isVert ? 60 : 100)) / 340) * EPS_SPEC.cardW);
    const halfLen = Math.round(lenPt / 2);
    const dashCmd = line.style === "dashed" ? "[3 3] 0 setdash" : "[] 0 setdash";
    if (isVert) {
      return `${accentR} ${accentG} ${accentB} setrgbcolor 1 setlinewidth ${dashCmd} newpath ${cx} ${cy - halfLen} moveto ${cx} ${cy + halfLen} lineto stroke [] 0 setdash`;
    } else {
      return `${accentR} ${accentG} ${accentB} setrgbcolor 1 setlinewidth ${dashCmd} newpath ${cx - halfLen} ${cy} moveto ${cx + halfLen} ${cy} lineto stroke [] 0 setdash`;
    }
  })
  .join("\n")}

% Cardholder Typography
/${fontName} findfont ${namePt} scalefont setfont
1 1 1 setrgbcolor
${nameX} ${nameY} moveto (${cardName}) show

/${titleFont} findfont ${titlePt} scalefont setfont
${accentR} ${accentG} ${accentB} setrgbcolor
${titleX} ${titleY} moveto (${cardTitle}) show
${extraLines
  .map((line, idx) => {
    const epLine = ep[`extra-${idx}`];
    const lx = epLine ? Math.round((epLine.x / 100) * EPS_SPEC.cardW) : titleX;
    const ly = epLine ? Math.round(((100 - epLine.y) / 100) * EPS_SPEC.cardH) : Math.round(titleY - (idx + 1) * (8 * textScale));
    return `${lx} ${ly} moveto (${line}) show`;
  })
  .join("\n")}
` : `
% --------------------------------------------------------
% BACK FACE ARTWORK
% --------------------------------------------------------
% Motif overlay
${accentR} ${accentG} ${accentB} setrgbcolor
${
  motif === "architectural"
    ? `
1.2 setlinewidth
newpath 14 128 moveto 14 142 lineto 28 142 lineto stroke
newpath 230 128 moveto 230 142 lineto 216 142 lineto stroke
newpath 14 28 moveto 14 14 lineto 28 14 lineto stroke
newpath 230 28 moveto 230 14 lineto 216 14 lineto stroke
`
    : motif === "inlay"
    ? `
1.0 setlinewidth
newpath 160 155.91 moveto 243.78 72 lineto stroke
newpath 0 84 moveto 84 0 lineto stroke
`
    : ""
}

% Back QR Code Framing Box
0.8 setlinewidth
newpath ${qrX} ${qrY} ${(50 * qrScale).toFixed(1)} ${(50 * qrScale).toFixed(1)} ${(4 * qrScale).toFixed(1)} roundrect
1 1 1 setrgbcolor fill
newpath ${qrX} ${qrY} ${(50 * qrScale).toFixed(1)} ${(50 * qrScale).toFixed(1)} ${(4 * qrScale).toFixed(1)} roundrect
${accentR} ${accentG} ${accentB} setrgbcolor stroke

% QR Code Finder Patterns
0 0 0 setrgbcolor
newpath ${qrX + Math.round(5 * qrScale)} ${qrY + Math.round(33 * qrScale)} ${(12 * qrScale).toFixed(1)} ${(12 * qrScale).toFixed(1)} ${(2 * qrScale).toFixed(1)} roundrect fill
1 1 1 setrgbcolor
newpath ${qrX + Math.round(7 * qrScale)} ${qrY + Math.round(35 * qrScale)} ${(8 * qrScale).toFixed(1)} ${(8 * qrScale).toFixed(1)} ${(1 * qrScale).toFixed(1)} roundrect fill
0 0 0 setrgbcolor
newpath ${qrX + Math.round(9 * qrScale)} ${qrY + Math.round(37 * qrScale)} ${(4 * qrScale).toFixed(1)} ${(4 * qrScale).toFixed(1)} 0 roundrect fill

newpath ${qrX + Math.round(33 * qrScale)} ${qrY + Math.round(33 * qrScale)} ${(12 * qrScale).toFixed(1)} ${(12 * qrScale).toFixed(1)} ${(2 * qrScale).toFixed(1)} roundrect fill
1 1 1 setrgbcolor
newpath ${qrX + Math.round(35 * qrScale)} ${qrY + Math.round(35 * qrScale)} ${(8 * qrScale).toFixed(1)} ${(8 * qrScale).toFixed(1)} ${(1 * qrScale).toFixed(1)} roundrect fill
0 0 0 setrgbcolor
newpath ${qrX + Math.round(37 * qrScale)} ${qrY + Math.round(37 * qrScale)} ${(4 * qrScale).toFixed(1)} ${(4 * qrScale).toFixed(1)} 0 roundrect fill

newpath ${qrX + Math.round(5 * qrScale)} ${qrY + Math.round(5 * qrScale)} ${(12 * qrScale).toFixed(1)} ${(12 * qrScale).toFixed(1)} ${(2 * qrScale).toFixed(1)} roundrect fill
1 1 1 setrgbcolor
newpath ${qrX + Math.round(7 * qrScale)} ${qrY + Math.round(7 * qrScale)} ${(8 * qrScale).toFixed(1)} ${(8 * qrScale).toFixed(1)} ${(1 * qrScale).toFixed(1)} roundrect fill
0 0 0 setrgbcolor
newpath ${qrX + Math.round(9 * qrScale)} ${qrY + Math.round(9 * qrScale)} ${(4 * qrScale).toFixed(1)} ${(4 * qrScale).toFixed(1)} 0 roundrect fill

% Footer Branding: Bottom-left Oneinfo branding & Bottom-right AriseStudio attribution (Omitted in Without Logo edition)
${
  custom.hasOneinfoLogo !== false
    ? `${accentR} ${accentG} ${accentB} setrgbcolor
/Helvetica-Bold findfont 8 scalefont setfont
20 16 moveto (ONEINFO) show

/Helvetica findfont 6.5 scalefont setfont
0.7 0.7 0.7 setrgbcolor
170 16 moveto (By AriseStudio) show`
    : "% Brand labeling omitted (Without Oneinfo Logo edition)"
}

${
  custom.backSubtitle && custom.backSubtitle.trim()
    ? `
% Back Subline
/Helvetica findfont 7 scalefont setfont
${accentR} ${accentG} ${accentB} setrgbcolor
${Math.max(20, Math.min(180, qrX - 10))} ${Math.max(10, qrY - 12)} moveto (${escapePs(custom.backSubtitle.trim())}) show
`
    : ""
}
`}

grestore

showpage
%%EOF
`;
}

// Backwards compatibility wrapper: defaults to Front face 94x63 mm EPS
export function generateCardEps(
  custom: ProductCustomization,
  order: OrderEpsInfo,
  side: "front" | "back" = "front"
): string {
  return generateCardFaceEps(custom, order, side);
}

export function downloadCardFaceEps(
  custom: ProductCustomization,
  order: OrderEpsInfo,
  side: "front" | "back"
): void {
  const epsContent = generateCardFaceEps(custom, order, side);
  const blob = new Blob([epsContent], { type: "application/postscript" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const txn = (order.transactionId?.trim() || order.invoiceNumber?.trim() || order.id || "card").replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${txn}_${side.toUpperCase()}_94x63mm.eps`;
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadOrderEps(
  custom: ProductCustomization,
  order: OrderEpsInfo,
  side: "front" | "back" | "both" = "both"
): void {
  if (side === "front") {
    downloadCardFaceEps(custom, order, "front");
  } else if (side === "back") {
    downloadCardFaceEps(custom, order, "back");
  } else {
    // Download both front and back EPS files
    downloadCardFaceEps(custom, order, "front");
    setTimeout(() => {
      downloadCardFaceEps(custom, order, "back");
    }, 250);
  }
}
