import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { productionQrImage, qrGeneratorVersion } from "../src/domain/qr-image.js";

it("embeds the supplied green logo and versions cached images by its file contents", () => {
  const source = readFileSync(new URL("../assets/qr-center-logo.png", import.meta.url));
  expect(qrGeneratorVersion).toContain(createHash("sha256").update(source).digest("hex").slice(0, 12));
  expect(readFileSync(new URL("../../../.dockerignore", import.meta.url), "utf8")).toContain("!apps/api/assets/qr-center-logo.png");
  const png = PNG.sync.read(Buffer.from(productionQrImage("https://oneinfo.online/c/logo?source=qr").split(",")[1]!, "base64"));
  let greenPixels = 0;
  for (let y = 220; y < 292; y++) for (let x = 220; x < 292; x++) {
    const offset = (y * png.width + x) * 4;
    if (png.data[offset + 1]! > png.data[offset]! + 30 && png.data[offset + 1]! > png.data[offset + 2]! + 10) greenPixels++;
    expect(png.data[offset + 3]).toBe(255);
  }
  expect(greenPixels).toBeGreaterThan(100);
});

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
