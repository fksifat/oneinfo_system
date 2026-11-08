import QRCode from "qrcode";
import { PNG } from "pngjs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const logoBytes = readFileSync(new URL("../../assets/qr-center-logo.png", import.meta.url));
const logo = PNG.sync.read(logoBytes);
export const qrGeneratorVersion = `oneinfo/dotted-logo-v2/${createHash("sha256").update(logoBytes).digest("hex").slice(0, 12)}`;
const ink = [51, 66, 81] as const;
const white = [255, 255, 255] as const;
const width = 512;

/** Keep four quiet modules, H correction and a small badge for printed-card scanning. */
export function productionQrImage(value: string): string {
  const { modules } = QRCode.create(value, { errorCorrectionLevel: "H" });
  const image = new PNG({ width, height: width });
  image.data.fill(255);
  const scale = Math.floor(width / (modules.size + 8));
  const pixel = (x: number) => (width - modules.size * scale) / 2 + x * scale;
  function paint(x: number, y: number, color: readonly number[], coverage = 1) {
    const offset = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) image.data[offset + c] = Math.round(image.data[offset + c]! * (1 - coverage) + color[c]! * coverage);
  }
  function circle(cx: number, cy: number, radius: number, color: readonly number[]) {
    cx = pixel(cx); cy = pixel(cy); radius *= scale;
    for (let y = Math.max(0, Math.floor(cy - radius - 1)); y < Math.min(width, Math.ceil(cy + radius + 1)); y++) {
      for (let x = Math.max(0, Math.floor(cx - radius - 1)); x < Math.min(width, Math.ceil(cx + radius + 1)); x++) {
        const coverage = Math.min(1, Math.max(0, radius + .5 - Math.hypot(x + .5 - cx, y + .5 - cy)));
        if (coverage) paint(x, y, color, coverage);
      }
    }
  }
  const size = modules.size;
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const finder = (row < 7 && col < 7) || (row < 7 && col >= size - 7) || (row >= size - 7 && col < 7);
    if (!finder && modules.get(row, col)) circle(col + .5, row + .5, .5, ink);
  }
  for (const [cx, cy] of [[3.5, 3.5], [size - 3.5, 3.5], [3.5, size - 3.5]] as const) {
    circle(cx, cy, 3.5, ink); circle(cx, cy, 2.5, white); circle(cx, cy, 1.5, ink);
  }
  const centre = size / 2;
  const radius = Math.min(size * .095, 4.5);
  circle(centre, centre, radius, white);
  const markScale = (radius - .7) * scale * 2 / Math.max(logo.width, logo.height);
  const markWidth = logo.width * markScale, markHeight = logo.height * markScale;
  const origin = pixel(centre);
  for (let y = Math.ceil(origin - markHeight / 2); y < origin + markHeight / 2; y++) {
    for (let x = Math.ceil(origin - markWidth / 2); x < origin + markWidth / 2; x++) {
      const sx = Math.max(0, Math.min(logo.width - 1, (x + .5 - origin + markWidth / 2) * logo.width / markWidth - .5));
      const sy = Math.max(0, Math.min(logo.height - 1, (y + .5 - origin + markHeight / 2) * logo.height / markHeight - .5));
      const left = Math.floor(sx), top = Math.floor(sy), dx = sx - left, dy = sy - top;
      const color = [0, 0, 0];
      let alpha = 0;
      // Interpolate premultiplied pixels so transparent edges stay clean on white.
      for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
        const offset = (Math.min(top + row, logo.height - 1) * logo.width + Math.min(left + col, logo.width - 1)) * 4;
        const weight = (col ? dx : 1 - dx) * (row ? dy : 1 - dy) * logo.data[offset + 3]! / 255;
        alpha += weight;
        for (let c = 0; c < 3; c++) color[c] = color[c]! + logo.data[offset + c]! * weight;
      }
      if (alpha) paint(x, y, color.map(channel => channel / alpha), alpha);
    }
  }
  return `data:image/png;base64,${PNG.sync.write(image, { filterType: 0, deflateLevel: 6, deflateStrategy: 0 }).toString("base64")}`;
}
