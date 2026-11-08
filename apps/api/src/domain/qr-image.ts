import QRCode from "qrcode";
import { PNG } from "pngjs";

export const qrGeneratorVersion = "oneinfo/dotted-arise-v1";
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
  circle(centre, centre, radius - .55, ink);
  // The reference's A monogram is drawn as three simple strokes inside the badge.
  const strokes = [
    [[-.78,.66],[-.08,-.82],[.18,-.82],[-.43,.66]],
    [[.18,-.5],[.78,.66],[.42,.66],[.02,-.16]],
    [[-.13,.13],[.15,.13],[.3,.42],[-.27,.42]],
  ] as const;
  const markSize = (radius - .7) * scale;
  const origin = pixel(centre);
  for (let y = Math.floor(origin - markSize); y <= Math.ceil(origin + markSize); y++) {
    for (let x = Math.floor(origin - markSize); x <= Math.ceil(origin + markSize); x++) {
      const px = (x + .5 - origin) / markSize, py = (y + .5 - origin) / markSize;
      for (const polygon of strokes) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
          const [xi, yi] = polygon[i]!, [xj, yj] = polygon[j]!;
          if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) { paint(x, y, white); break; }
      }
    }
  }
  return `data:image/png;base64,${PNG.sync.write(image).toString("base64")}`;
}
