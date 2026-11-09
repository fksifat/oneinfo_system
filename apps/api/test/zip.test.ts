import { expect, it } from "vitest";
import { crc32, inflateRawSync } from "node:zlib";
import { zipFiles } from "../src/domain/zip.js";

it("writes a standard ZIP with compressed SVG/EPS content, matching checksums and directory offsets", () => {
  const files = [{ name: "SVG/card-a.svg", data: "<svg>test</svg>" }, { name: "EPS/card-a.eps", data: "%!PS-Adobe-3.0 EPSF-3.0\n" }];
  const zip = zipFiles(files);
  let offset = 0;
  for (const file of files) {
    expect(zip.readUInt32LE(offset)).toBe(0x04034b50);
    expect(zip.readUInt16LE(offset + 8)).toBe(8);
    const packedSize = zip.readUInt32LE(offset + 18), nameSize = zip.readUInt16LE(offset + 26), start = offset + 30 + nameSize;
    expect(zip.subarray(offset + 30, start).toString()).toBe(file.name);
    const data = inflateRawSync(zip.subarray(start, start + packedSize));
    expect(data.toString()).toBe(file.data);
    expect(crc32(data)).toBe(zip.readUInt32LE(offset + 14));
    offset = start + packedSize;
  }
  expect(zip.readUInt32LE(offset)).toBe(0x02014b50);
  expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  expect(zip.readUInt16LE(zip.length - 12)).toBe(2);
  expect(zip.readUInt32LE(zip.length - 6)).toBe(offset);
  expect(() => zipFiles([{ name: "../card.svg", data: "bad" }])).toThrow("Unsafe");
  expect(() => zipFiles(Array.from({ length: 2001 }, () => files[0]!))).toThrow("Too many");
});
