import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export function databaseTunnelSettings(env = process.env) {
  if (!env.ONEINFO_DATABASE_SSH) return null;
  if (!/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(env.ONEINFO_DATABASE_SSH)) throw new Error("Invalid ONEINFO_DATABASE_SSH; use user@host.");
  const container = env.ONEINFO_DATABASE_CONTAINER;
  if (!container || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container)) throw new Error("Set a valid ONEINFO_DATABASE_CONTAINER.");
  const url = new URL(env.DATABASE_URL);
  if (url.hostname !== "127.0.0.1" || !Number.isInteger(Number(url.port)) || Number(url.port) < 1 || Number(url.port) > 65535) throw new Error("SSH database URLs must use 127.0.0.1 and an explicit local port.");
  return { host: env.ONEINFO_DATABASE_SSH, container, port: Number(url.port) };
}

export function databasePortOpen(port) {
  return new Promise(resolve => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(500); socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false)); socket.once("timeout", () => finish(false));
  });
}

export async function runDatabaseTunnel(settings, signal) {
  const options = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=8"];
  while (!signal.aborted) {
    try {
      const { stdout } = await promisify(execFile)("ssh", [...options, settings.host,
        `docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' ${settings.container}`], { signal, timeout: 12000, maxBuffer: 4096 });
      const address = stdout.trim().split(/\s+/).find(ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) && ip.split(".").length === 4 && ip.split(".").every(part => /^\d+$/.test(part) && Number(part) <= 255));
      if (!address) throw new Error("No private database container address");
      const child = spawn("ssh", [...options, "-N", "-T", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
        "-L", `127.0.0.1:${settings.port}:${address}:5432`, settings.host], { signal, stdio: ["ignore", "ignore", "inherit"] });
      await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    } catch { if (!signal.aborted) console.error("Database SSH connection unavailable; retrying in 3 seconds. Check SSH access and network."); }
    if (!signal.aborted) await delay(3000, undefined, { signal }).catch(() => {});
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const abort = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, () => abort.abort());
  const settings = databaseTunnelSettings();
  if (!settings) throw new Error("SSH database configuration is missing.");
  await runDatabaseTunnel(settings, abort.signal);
}
