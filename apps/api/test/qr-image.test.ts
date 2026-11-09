import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { productionQrImage, qrGeneratorVersion, qrMatrix, productionQrSvg, productionQrEps } from "../src/domain/qr-image.js";

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
  "https://example.com/যোগাযোগ?name=Farhan",
  ...Array.from({ length: 40 }, (_, index) => `https://oneinfo.online/c/${createHash("sha256").update(`test${index}`).digest("base64url").slice(0, 12)}?source=qr`),
])("round dotted PNG with a centre badge decodes to its exact link: %s", value => {
  const data = productionQrImage(value);
  expect(data.length).toBeLessThan(100 * 1024);
  const png = PNG.sync.read(Buffer.from(data.split(",")[1]!, "base64"));
  expect([png.width, png.height]).toEqual([512, 512]);
  expect(Array.from(png.data.subarray(0, 4))).toEqual([255, 255, 255, 255]);
  expect(qrMatrix(value).modules.size).toBe(29);
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(decoded?.data).toBe(value);
  const small = new Uint8ClampedArray(256 * 256 * 4);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) for (let c = 0; c < 4; c++) {
    const offset = ((y * 2) * 512 + x * 2) * 4 + c;
    small[(y * 256 + x) * 4 + c] = Math.round((png.data[offset]! + png.data[offset + 4]! + png.data[offset + 2048]! + png.data[offset + 2052]!) / 4);
  }
  expect(jsQR(small, 256, 256)?.data).toBe(value);
});

it("rejects oversized links instead of changing the link or silently growing the grid", () => {
  expect(() => productionQrImage("https://example.com/" + "long-custom-card-link/".repeat(12))).toThrow("shorter URL");
  expect(qrMatrix("a".repeat(53)).modules.size).toBe(29);
  expect(() => qrMatrix("a".repeat(54))).toThrow("shorter URL");
});

it("exports editable dot/finder vectors with an embedded logo and no external assets", () => {
  const value = "https://oneinfo.online/c/123456789012?source=qr";
  const svg = productionQrSvg(value), eps = productionQrEps(value);
  expect(svg).toContain('data-modules="29"');
  expect(svg).toContain("<circle");expect(svg).toContain('href="data:image/png;base64,');
  expect(svg).not.toContain(value);
  expect(eps).toMatch(/^%!PS-Adobe-3.0 EPSF-3.0/);
  expect(eps).toContain("%%BoundingBox: 0 0 512 512");
  expect(eps).toContain("colorimage");expect(eps).toContain(" dot\n");
  expect(eps).toMatch(/%%EOF\n$/);
});
