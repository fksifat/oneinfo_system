import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { productionQrImage } from "../src/domain/qr-image.js";

it.each([
  "https://oneinfo.online/c/1B66ylNKBeRl?source=qr",
  "https://www.oneinfo.online/c/abcdefgh1234?source=qr",
  "https://example.com/",
  "https://a.co",
  "https://example.com/" + "long-custom-card-link/".repeat(12),
  "https://example.com/যোগাযোগ?name=Farhan",
  ...Array.from({ length: 12 }, (_, index) => `https://oneinfo.online/c/${createHash("sha256").update(`test${index}`).digest("base64url").slice(0, 12)}?source=qr`),
])("round dotted PNG with a centre badge decodes to its exact link: %s", value => {
  const data = productionQrImage(value);
  expect(data.length).toBeLessThan(100 * 1024);
  const png = PNG.sync.read(Buffer.from(data.split(",")[1]!, "base64"));
  expect([png.width, png.height]).toEqual([512, 512]);
  expect(Array.from(png.data.subarray(0, 4))).toEqual([255, 255, 255, 255]);
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(decoded?.data).toBe(value);
  // Dense custom links need full print resolution rather than a 256px thumbnail.
  if (Buffer.byteLength(value) > 120) return;
  const small = new Uint8ClampedArray(256 * 256 * 4);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) for (let c = 0; c < 4; c++) {
    const offset = ((y * 2) * 512 + x * 2) * 4 + c;
    small[(y * 256 + x) * 4 + c] = Math.round((png.data[offset]! + png.data[offset + 4]! + png.data[offset + 2048]! + png.data[offset + 2052]!) / 4);
  }
  expect(jsQR(small, 256, 256)?.data).toBe(value);
});
