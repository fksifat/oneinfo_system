import type { ProductCustomization } from "@oneinfo/contracts";

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

export function generateCardEps(
  custom: ProductCustomization,
  order: { id: string; transactionId?: string | null | undefined; invoiceNumber?: string | null | undefined; customerName?: string | null | undefined }
): string {
  const [bgR, bgG, bgB] = hexToRgb(custom.surfaceColor || "#0a0b0d");
  const [accentR, accentG, accentB] = hexToRgb(custom.accentColor || "#d8b26e");
  const fontName = custom.font === "serif" ? "Times-Bold" : custom.font === "mono" ? "Courier-Bold" : "Helvetica-Bold";
  const titleFont = custom.font === "serif" ? "Times-Roman" : custom.font === "mono" ? "Courier" : "Helvetica";

  const txn = order.transactionId?.trim() || order.invoiceNumber?.trim() || order.id;
  const cardName = escapePs(custom.name || order.customerName || "Cardholder Name");
  const cardTitle = escapePs(custom.title || "Custom Edition");
  const backSubtitle = escapePs(custom.backSubtitle || "oneinfo.me");
  const layout = custom.layout || "left";
  const motif = custom.surfaceMotif || "facets";

  return `%!PS-Adobe-3.0 EPSF-3.0
%%Creator: Oneinfo Bespoke Card Studio
%%Title: Oneinfo Signature Production Card - ${txn}
%%BoundingBox: 0 0 540 220
%%HiResBoundingBox: 0 0 540.00 220.00
%%Orientation: Portrait
%%Pages: 1
%%LanguageLevel: 3
%%EndComments

/cardW 242.64 def
/cardH 153.00 def
/cardR 9.00 def

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

% Header Labels
/Helvetica findfont 9 scalefont setfont
0.2 0.25 0.3 setrgbcolor
20 200 moveto (FRONT ARTWORK (LASER ENGRAVE & FOIL)) show
280 200 moveto (BACK ARTWORK (QR & NFC PRINT)) show
/Helvetica findfont 7 scalefont setfont
0.4 0.45 0.5 setrgbcolor
20 12 moveto (Transaction ID: ${txn}   Card: Oneinfo Signature   Layout: ${layout}   Motif: ${motif}) show

% ========================================================
% FRONT CARD (Origin: 20, 35)
% ========================================================
gsave
20 35 translate

% Background fill
0 0 cardW cardH cardR roundrect
${bgR} ${bgG} ${bgB} setrgbcolor fill

% Border stroke
0 0 cardW cardH cardR roundrect
${accentR} ${accentG} ${accentB} setrgbcolor 0.8 setlinewidth stroke

% Clip to card boundary for motif vector art
0 0 cardW cardH cardR roundrect clip

% Motif Vector Overlay
${accentR} ${accentG} ${accentB} setrgbcolor
${
  motif === "facets"
    ? `
% Layered Facets Motif
0.8 setlinewidth
newpath
242.64 153 moveto 200 153 lineto 218 122 lineto 242.64 131 lineto closepath stroke
newpath
200 153 moveto 157 153 lineto 175 125 lineto 218 122 lineto closepath stroke
newpath
218 122 moveto 242.64 131 lineto 242.64 95 lineto 209 98 lineto closepath stroke
newpath
0 0 moveto 39 0 lineto 24 25 lineto 0 19 lineto closepath stroke
newpath
39 0 moveto 78 0 lineto 63 22 lineto 24 25 lineto closepath stroke
`
    : motif === "contour"
    ? `
% Contour Engraving Motif
0.7 setlinewidth
newpath -10 40 moveto 50 50 90 20 140 30 curveto 190 40 220 10 260 20 curveto stroke
newpath -10 60 moveto 45 70 85 40 135 50 curveto 185 60 215 30 260 40 curveto stroke
newpath -10 80 moveto 40 90 80 60 130 70 curveto 180 80 210 50 260 60 curveto stroke
newpath -10 100 moveto 35 110 75 80 125 90 curveto 175 100 205 70 260 80 curveto stroke
`
    : motif === "architectural"
    ? `
% Architectural Corner Motif
1.2 setlinewidth
newpath 14 125 moveto 14 139 lineto 28 139 lineto stroke
newpath 228 125 moveto 228 139 lineto 214 139 lineto stroke
newpath 14 28 moveto 14 14 lineto 28 14 lineto stroke
newpath 228 28 moveto 228 14 lineto 214 14 lineto stroke
0.5 setlinewidth
[2 3] 0 setdash
newpath 22 22 moveto 220 22 lineto 220 131 lineto 22 131 lineto closepath stroke
[] 0 setdash
`
    : motif === "inlay"
    ? `
% Diagonal Inlay Motif
1.0 setlinewidth
newpath 150 153 moveto 242.64 60 lineto stroke
newpath 165 153 moveto 242.64 75 lineto stroke
newpath 180 153 moveto 242.64 90 lineto stroke
newpath 0 93 moveto 93 0 lineto stroke
newpath 0 78 moveto 78 0 lineto stroke
newpath 0 63 moveto 63 0 lineto stroke
`
    : "% Minimal - Clean finish"
}

% Logo & NFC Glyph
${accentR} ${accentG} ${accentB} setrgbcolor
/Helvetica-Bold findfont 11 scalefont setfont
${
  layout === "center" || layout === "header"
    ? "98 126 moveto (ONEINFO) show"
    : layout === "right"
    ? "175 126 moveto (ONEINFO) show"
    : layout === "reverse" || layout === "split-logo-right"
    ? "175 22 moveto (ONEINFO) show"
    : "20 126 moveto (ONEINFO) show"
}

% NFC waves icon
newpath
222 130 5 45 135 arc stroke
newpath
222 130 9 45 135 arc stroke

% Cardholder Typography
/${fontName} findfont 12 scalefont setfont
1 1 1 setrgbcolor
${
  layout === "center" || layout === "header"
    ? `90 52 moveto (${cardName}) show`
    : layout === "right" || layout === "split-logo-left" || layout === "diagonal"
    ? `130 38 moveto (${cardName}) show`
    : layout === "reverse" || layout === "split-logo-right"
    ? `20 105 moveto (${cardName}) show`
    : `20 38 moveto (${cardName}) show`
}

/${titleFont} findfont 6.5 scalefont setfont
${accentR} ${accentG} ${accentB} setrgbcolor
${
  layout === "center" || layout === "header"
    ? `90 40 moveto (${cardTitle}) show`
    : layout === "right" || layout === "split-logo-left" || layout === "diagonal"
    ? `130 26 moveto (${cardTitle}) show`
    : layout === "reverse" || layout === "split-logo-right"
    ? `20 93 moveto (${cardTitle}) show`
    : `20 26 moveto (${cardTitle}) show`
}

grestore

% ========================================================
% BACK CARD (Origin: 280, 35)
% ========================================================
gsave
280 35 translate

% Background fill
0 0 cardW cardH cardR roundrect
${bgR} ${bgG} ${bgB} setrgbcolor fill

% Border stroke
0 0 cardW cardH cardR roundrect
${accentR} ${accentG} ${accentB} setrgbcolor 0.8 setlinewidth stroke

% Clip to card boundary
0 0 cardW cardH cardR roundrect clip

% Motif overlay
${accentR} ${accentG} ${accentB} setrgbcolor
${
  motif === "architectural"
    ? `
1.2 setlinewidth
newpath 14 125 moveto 14 139 lineto 28 139 lineto stroke
newpath 228 125 moveto 228 139 lineto 214 139 lineto stroke
newpath 14 28 moveto 14 14 lineto 28 14 lineto stroke
newpath 228 28 moveto 228 14 lineto 214 14 lineto stroke
`
    : motif === "inlay"
    ? `
1.0 setlinewidth
newpath 160 153 moveto 242.64 70 lineto stroke
newpath 0 83 moveto 83 0 lineto stroke
`
    : ""
}

% Back QR Code Framing Box
0.8 setlinewidth
newpath 96 46 50 50 4 roundrect
1 1 1 setrgbcolor fill
newpath 96 46 50 50 4 roundrect
${accentR} ${accentG} ${accentB} setrgbcolor stroke

% QR Code Finder Patterns
0 0 0 setrgbcolor
newpath 101 81 12 12 2 roundrect fill
1 1 1 setrgbcolor
newpath 103 83 8 8 1 roundrect fill
0 0 0 setrgbcolor
newpath 105 85 4 4 0 roundrect fill

newpath 129 81 12 12 2 roundrect fill
1 1 1 setrgbcolor
newpath 131 83 8 8 1 roundrect fill
0 0 0 setrgbcolor
newpath 133 85 4 4 0 roundrect fill

newpath 101 51 12 12 2 roundrect fill
1 1 1 setrgbcolor
newpath 103 53 8 8 1 roundrect fill
0 0 0 setrgbcolor
newpath 105 55 4 4 0 roundrect fill

% Footer: Bottom-left Oneinfo branding & Bottom-right AriseStudio attribution
${accentR} ${accentG} ${accentB} setrgbcolor
/Helvetica-Bold findfont 8 scalefont setfont
20 16 moveto (ONEINFO) show

/Helvetica findfont 6.5 scalefont setfont
0.7 0.7 0.7 setrgbcolor
170 16 moveto (By AriseStudio) show

grestore

showpage
%%EOF
`;
}

export function downloadOrderEps(
  custom: ProductCustomization,
  order: { id: string; transactionId?: string | null | undefined; invoiceNumber?: string | null | undefined; customerName?: string | null | undefined }
): void {
  const epsContent = generateCardEps(custom, order);
  const blob = new Blob([epsContent], { type: "application/postscript" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const filename = (order.transactionId?.trim() || order.invoiceNumber?.trim() || order.id).replace(/[^a-zA-Z0-9_-]/g, "_") + ".eps";
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
