import { crc32, deflateRawSync } from "node:zlib";

/** Small, ordinary ZIP archives; production batches contain at most 2,000 files. */
export function zipFiles(files: Iterable<{ name: string; data: string | Buffer }>): Buffer {
  const chunks: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0, count = 0;
  for (const file of files) {
    if (!/^[a-zA-Z0-9_/-]+\.(svg|eps)$/.test(file.name) || file.name.includes("..")) throw new Error("Unsafe ZIP filename");
    if (++count > 2000) throw new Error("Too many ZIP entries");
    const name = Buffer.from(file.name), data = Buffer.from(file.data), packed = deflateRawSync(data), checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(33, 12); // 1980-01-01, the first valid ZIP date.
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const end = Buffer.alloc(22), directorySize = directory.reduce((sum, chunk) => sum + chunk.length, 0);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(directorySize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...directory, end]);
}
