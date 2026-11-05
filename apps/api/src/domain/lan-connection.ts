import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { networkInterfaces } from "node:os";
import { X509Certificate } from "node:crypto";

let connection: { port: number; fingerprint: string } | null = null;

export function privateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31));
}

export function lanAddresses() {
  return [...new Set(Object.values(networkInterfaces()).flat().filter(item => item && !item.internal && item.family === "IPv4" && privateIpv4(item.address)).map(item => item!.address))]
    .sort((a, b) => Number(b.startsWith("192.168.")) - Number(a.startsWith("192.168."))).slice(0, 8);
}

export async function loadLanIdentity(filename: string) {
  if (existsSync(filename)) {
    const identity = JSON.parse(readFileSync(filename, "utf8")) as { key: string; cert: string };
    new X509Certificate(identity.cert);
    return identity;
  }
  const { generate } = await import("selfsigned");
  const notBeforeDate = new Date(Date.now() - 5 * 60_000);
  const notAfterDate = new Date(); notAfterDate.setFullYear(notAfterDate.getFullYear() + 10);
  const result = await generate([{ name: "commonName", value: "Oneinfo workstation" }], {
    keyType: "ec", curve: "P-256", algorithm: "sha256", notBeforeDate, notAfterDate,
  });
  const identity = { key: result.private, cert: result.cert };
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, JSON.stringify(identity), { mode: 0o600, flag: "wx", flush: true });
  return identity;
}

export function configureLanConnection(cert: string, port: number) {
  connection = { port, fingerprint: new X509Certificate(cert).fingerprint256.replaceAll(":", "").toLowerCase() };
  return connection;
}

export function lanPairing(pairingCode: string, pairingSecret: string) {
  if (!connection) return null;
  const urls = lanAddresses().map(address => `https://${address}:${connection!.port}`);
  return { type: "oneinfo-lan-pairing", version: 1, urls, fingerprint: connection.fingerprint, pairingCode, pairingSecret };
}
