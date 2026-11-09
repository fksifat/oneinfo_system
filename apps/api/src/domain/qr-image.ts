import QRCode from "qrcode";
import { PNG } from "pngjs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const logoBytes = readFileSync(new URL("../../assets/qr-center-logo.png", import.meta.url));
const logo = PNG.sync.read(logoBytes);
export const qrGeneratorVersion = `oneinfo/dotted-logo-29-v3/${createHash("sha256").update(logoBytes).digest("hex").slice(0, 12)}`;
const ink = [51, 65, 85] as const;
const white = [255, 255, 255] as const;
const width = 512;

export function qrMatrix(value: string) {
  // A fixed mask avoids rounded-pattern finder ambiguity at small print sizes.
  for (const errorCorrectionLevel of ["H", "Q", "M", "L"] as const) {
    try { return QRCode.create(value, { version: 3, errorCorrectionLevel, maskPattern: 0 }); } catch { /* Try the next capacity. */ }
  }
  throw Object.assign(new Error("This link is too long for a 29×29 QR code. Use a shorter URL (normally up to 53 UTF-8 bytes); the original link has not been changed."), { statusCode: 400 });
}

/** Keep four quiet modules and a small badge for printed-card scanning. */
export function productionQrImage(value: string): string {
  const drawing = qrDrawing(value);
  const image = new PNG({ width, height: width });
  image.data.fill(255);
  function paint(x: number, y: number, color: readonly number[], coverage = 1) {
    const offset = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) image.data[offset + c] = Math.round(image.data[offset + c]! * (1 - coverage) + color[c]! * coverage);
  }
  for (const { cx, cy, radius, color } of drawing.circles) {
    for (let y = Math.max(0, Math.floor(cy - radius - 1)); y < Math.min(width, Math.ceil(cy + radius + 1)); y++) {
      for (let x = Math.max(0, Math.floor(cx - radius - 1)); x < Math.min(width, Math.ceil(cx + radius + 1)); x++) {
        const coverage = Math.min(1, Math.max(0, radius + .5 - Math.hypot(x + .5 - cx, y + .5 - cy)));
        if (coverage) paint(x, y, color, coverage);
      }
    }
  }
  const { scale, radius, centre } = drawing;
  const markScale = (radius - .7) * scale * 2 / Math.max(logo.width, logo.height);
  const markWidth = logo.width * markScale, markHeight = logo.height * markScale;
  const origin = centre;
  for (let y = Math.ceil(origin - markHeight / 2); y < origin + markHeight / 2; y++) {
    for (let x = Math.ceil(origin - markWidth / 2); x < origin + markWidth / 2; x++) {
      const sx = (x + .5 - origin + markWidth / 2) * logo.width / markWidth - .5;
      const sy = (y + .5 - origin + markHeight / 2) * logo.height / markHeight - .5;
      paint(x, y, logoPixel(sx, sy));
    }
  }
  return `data:image/png;base64,${PNG.sync.write(image, { filterType: 0, deflateLevel: 6, deflateStrategy: 0 }).toString("base64")}`;
}

// PNG, SVG and EPS share exactly the same modules, finder rings and logo placement.
function qrDrawing(value: string) {
  const { modules } = qrMatrix(value);
  const size = modules.size;
  const scale = width / (size + 8);
  const pixel = (x: number) => (width - size * scale) / 2 + x * scale;
  const circles: { cx: number; cy: number; radius: number; color: readonly number[] }[] = [];
  const circle = (x: number, y: number, radius: number, color: readonly number[]) => circles.push({ cx: pixel(x), cy: pixel(y), radius: radius * scale, color });
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const finder = (row < 7 && col < 7) || (row < 7 && col >= size - 7) || (row >= size - 7 && col < 7);
    if (!finder && modules.get(row, col)) circle(col + .5, row + .5, .5, ink);
  }
  for (const [cx, cy] of [[3.5, 3.5], [size - 3.5, 3.5], [3.5, size - 3.5]] as const) {
    circle(cx, cy, 3.5, ink); circle(cx, cy, 2.5, white); circle(cx, cy, 1.5, ink);
  }
  const radius = 2;
  circle(size / 2, size / 2, radius, white);
  const markScale = (radius - .7) * scale * 2 / Math.max(logo.width, logo.height);
  const markWidth = logo.width * markScale, markHeight = logo.height * markScale;
  return { size, circles, scale, radius, centre: pixel(size / 2), markWidth, markHeight };
}

export function productionQrSvg(value: string): string {
  const d = qrDrawing(value);
  const circles = d.circles.map(c => `<circle cx="${c.cx}" cy="${c.cy}" r="${c.radius}" fill="rgb(${c.color.join(",")})"/>`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" data-modules="${d.size}">
<rect width="512" height="512" fill="white"/>
${circles}
<image href="data:image/png;base64,${logoBytes.toString("base64")}" x="${d.centre - d.markWidth / 2}" y="${d.centre - d.markHeight / 2}" width="${d.markWidth}" height="${d.markHeight}"/>
</svg>`;
}

function logoPixel(sx: number, sy: number) {
  sx = Math.max(0, Math.min(logo.width - 1, sx)); sy = Math.max(0, Math.min(logo.height - 1, sy));
  const left = Math.floor(sx), top = Math.floor(sy), dx = sx - left, dy = sy - top;
  const color = [0, 0, 0];
  let alpha = 0;
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
    const offset = (Math.min(top + row, logo.height - 1) * logo.width + Math.min(left + col, logo.width - 1)) * 4;
    const weight = (col ? dx : 1 - dx) * (row ? dy : 1 - dy) * logo.data[offset + 3]! / 255;
    alpha += weight;
    for (let c = 0; c < 3; c++) color[c] = color[c]! + logo.data[offset + c]! * weight;
  }
  return color.map(channel => Math.round(channel + 255 * (1 - alpha)));
}

// The badge occupies 36 points: 128 pixels preserves print detail without huge EPS batches.
const epsScale = Math.min(1, 128 / Math.max(logo.width, logo.height));
const epsWidth = Math.round(logo.width * epsScale), epsHeight = Math.round(logo.height * epsScale);
const epsLogoRgb = Buffer.alloc(epsWidth * epsHeight * 3);
for (let y = 0; y < epsHeight; y++) for (let x = 0; x < epsWidth; x++) {
  const color = logoPixel((x + .5) / epsScale - .5, (y + .5) / epsScale - .5);
  for (let c = 0; c < 3; c++) epsLogoRgb[(y * epsWidth + x) * 3 + c] = color[c]!;
}
const epsLogoHex = epsLogoRgb.toString("hex").match(/.{1,120}/g)!.join("\n");

export function productionQrEps(value: string): string {
  const d = qrDrawing(value);
  const circles = d.circles.map(c => `${c.color.map(v => (v / 255).toFixed(6)).join(" ")} setrgbcolor ${c.cx} ${c.cy} ${c.radius} dot`).join("\n");
  return `%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 512 512
%%HiResBoundingBox: 0 0 512 512
%%LanguageLevel: 2
%%EndComments
/dot { newpath 0 360 arc closepath fill } bind def
gsave
0 512 translate 1 -1 scale
1 1 1 setrgbcolor 0 0 512 512 rectfill
${circles}
gsave
${d.centre - d.markWidth / 2} ${d.centre - d.markHeight / 2} translate
${d.markWidth} ${d.markHeight} scale
${epsWidth} ${epsHeight} 8 [${epsWidth} 0 0 ${epsHeight} 0 0]
{currentfile ${epsWidth * 3} string readhexstring pop} false 3 colorimage
${epsLogoHex}
grestore
grestore
showpage
%%EOF
`;
}
