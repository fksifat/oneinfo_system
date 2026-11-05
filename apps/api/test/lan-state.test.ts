import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, X509Certificate } from "node:crypto";
import { createServer, request } from "node:https";
import { expect, it } from "vitest";
import { openNfcState } from "../src/domain/nfc-state.js";
import { configureLanConnection, lanPairing, loadLanIdentity, privateIpv4 } from "../src/domain/lan-connection.js";

it("restores device authentication, one-use pairing and pending tag work after a restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "oneinfo-state-")), path = join(directory, "state.bin");
  try {
    const store = openNfcState(path), now = new Date(), token = "private-device-token";
    store.state.devices.set("device", { id: "device", stationId: "station", operatorId: "operator", name: "Phone", tokenHash: createHash("sha256").update(token).digest("hex"), pairedAt: now, lastSeenAt: now, runtimeVersion: "Android" });
    store.state.readSessions.set("read", { id: "read", stationId: "station", deviceId: "device", state: "READING", createdAt: now, expiresAt: new Date(Date.now() + 60_000) });
    store.state.pairings.set("123456", { code: "123456", secretHash: "one-use-secret-hash", stationId: "station", operatorId: "operator", expiresAt: now });
    store.save();
    const restarted = openNfcState(path);
    expect(restarted.state.devices.get("device")?.lastSeenAt).toEqual(now);
    expect(restarted.state.readSessions.get("read")?.expiresAt).toBeInstanceOf(Date);
    expect(restarted.state.readSessions.get("read")?.state).toBe("READING");
    expect(readFileSync(path).includes(Buffer.from(token))).toBe(false);
    restarted.state.pairings.delete("123456"); restarted.save();
    expect(openNfcState(path).state.pairings.has("123456")).toBe(false);
    writeFileSync(path, "corrupted");
    expect(() => openNfcState(path)).toThrow();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it("keeps a stable workstation certificate and verifies it over a real TLS connection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "oneinfo-lan-"));
  const identity = await loadLanIdentity(join(directory, "identity.json"));
  const server = createServer(identity, (_req, res) => res.end("Oneinfo"));
  try {
    expect(await loadLanIdentity(join(directory, "identity.json"))).toEqual(identity);
    const { fingerprint } = configureLanConnection(identity.cert, 3443);
    expect(fingerprint).toBe(new X509Certificate(identity.cert).fingerprint256.replaceAll(":", "").toLowerCase());
    expect(lanPairing("123456", "test-secret")?.fingerprint).toBe(fingerprint);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const read = (pin: string) => new Promise<string>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, agent: false, ca: identity.cert, checkServerIdentity: (_host, cert) => cert.fingerprint256.replaceAll(":", "").toLowerCase() === pin ? undefined : new Error("Certificate mismatch") }, res => {
        let body = ""; res.on("data", chunk => { body += chunk; }); res.on("end", () => resolve(body));
      }); req.on("error", reject); req.end();
    });
    expect(await read(fingerprint)).toBe("Oneinfo");
    await expect(read("0".repeat(64))).rejects.toThrow("Certificate mismatch");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});

it("advertises only private LAN IPv4 addresses", () => {
  for (const ip of ["10.0.0.4", "172.16.0.1", "172.31.255.255", "192.168.1.10"]) expect(privateIpv4(ip)).toBe(true);
  for (const ip of ["127.0.0.1", "8.8.8.8", "172.15.0.1", "172.32.0.1", "192.168.1.999", "10.0.1", "invalid"]) expect(privateIpv4(ip)).toBe(false);
});
