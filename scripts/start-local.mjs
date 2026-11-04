import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve, delimiter } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { openConsole } from "./desktop.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

export function npmCommand(args, platform = process.platform, execPath = process.execPath, npmCli = process.env.npm_execpath) {
  const cli = [npmCli, join(dirname(execPath), "node_modules/npm/bin/npm-cli.js"),
    resolve(dirname(execPath), "../lib/node_modules/npm/bin/npm-cli.js")].find((path) => path && existsSync(path));
  if (cli) return [execPath, [cli, ...args]];
  if (platform === "win32") {
    if (args.some((arg) => !/^[A-Za-z0-9_@:/=.-]+$/.test(arg))) throw new Error("Unsafe npm command argument");
    return ["cmd.exe", ["/d", "/s", "/c", "npm.cmd " + args.join(" ")]];
  }
  return ["npm", args];
}

export async function probeService(url, kind) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500), redirect: "manual" });
    const body = await response.text();
    if (!response.ok) return "conflict";
    if (kind === "api") {
      try { const data = JSON.parse(body); return data.service === "oneinfo-production-api" && data.status === "ok" ? "ready" : "conflict"; }
      catch { return "conflict"; }
    }
    return body.includes("<title>Oneinfo Production Console</title>") ? "ready" : "conflict";
  } catch { return "down"; }
}

export async function waitForService(url, kind, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error(`${kind} stopped during startup. Check .oneinfo/logs/${kind}.log`);
    const state = await probeService(url, kind);
    if (state === "ready") return;
    if (state === "conflict") throw new Error(`Port conflict at ${url}. Close the other application and retry.`);
    await delay(350);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${url}. Check .oneinfo/logs.`);
}

async function command(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
    child.once("error", (error) => reject(new Error(`Cannot run ${command}: ${error.message}`)));
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed (exit ${code}). See the message above.`)));
  });
}

async function connectPhone(apiPort) {
  const localAdb = join(root, ".tools/android/platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
  const adb = process.env.ADB_PATH ?? (existsSync(localAdb) ? localAdb : "adb");
  const capture = (args) => new Promise((resolve, reject) => {
    const child = spawn(adb, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.once("error", reject);
    const timer = setTimeout(() => { child.kill(); reject(new Error("ADB timed out")); }, 8000);
    child.once("close", (code) => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error("ADB command failed")); });
  });
  try {
    const devices = (await capture(["devices"])).split(/\r?\n/).filter((line) => /\sdevice$/.test(line)).map((line) => line.split(/\s/)[0]);
    let serial = process.env.ANDROID_SERIAL;
    if (serial && !devices.includes(serial)) throw new Error("Selected phone is not authorized/connected");
    if (!serial && devices.length === 1) serial = devices[0];
    if (!serial && devices.length > 1 && devices.length <= 4) {
      const ids = await Promise.all(devices.map((device) => capture(["-s", device, "shell", "getprop", "ro.serialno"])));
      if (ids[0] && ids.every((id) => id === ids[0])) serial = devices[0];
    }
    if (!serial) { console.log("Phone tunnel skipped. Connect/authorize one phone, or set ANDROID_SERIAL for multiple devices."); return; }
    await capture(["-s", serial, "reverse", "tcp:3001", `tcp:${apiPort}`]);
    console.log("Android NFC tunnel ready (USB or wireless ADB).");
  } catch { console.log("ADB tunnel was not set up. You can connect the phone later from the Connection instructions."); }
}

export async function main() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error("Install Node.js 22.12 or newer first.");
  if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
  process.env.PATH = [dirname(process.execPath), process.env.PATH ?? "", ...(process.platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".docker/bin")] : [])].join(delimiter);
  const apiPort = Number(process.env.PORT ?? 3001);
  const consolePort = Number(process.env.ONEINFO_CONSOLE_PORT ?? 5173);
  if (![apiPort, consolePort].every((port) => Number.isInteger(port) && port > 0 && port <= 65535) || apiPort === consolePort) throw new Error("API and console ports must be valid and different.");
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const consoleUrl = `http://127.0.0.1:${consolePort}`;
  const noBrowser = process.argv.includes("--no-browser");
  const noAdb = process.argv.includes("--no-adb");
  const runtimeDir = join(root, ".oneinfo");
  const logDir = join(runtimeDir, "logs");
  mkdirSync(logDir, { recursive: true });
  const lockPath = join(runtimeDir, `launcher-${apiPort}-${consolePort}.lock`);
  let ownsLock = false;
  const children = [];
  let stopping = false;
  let interrupted = false;
  const abort = new AbortController();
  const cleanup = () => {
    if (stopping) return;
    stopping = true;
    abort.abort();
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    if (ownsLock) { try { unlinkSync(lockPath); } catch {} ownsLock = false; }
  };
  const stop = () => { interrupted = true; cleanup(); process.exitCode = 0; };
  try {
    try {
      const fd = openSync(lockPath, "wx");
      writeFileSync(fd, String(process.pid)); closeSync(fd); ownsLock = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number(readFileSync(lockPath, "utf8").trim());
      if (!Number.isInteger(pid) || pid <= 0) throw new Error("Another launcher is starting. Wait a moment and retry.");
      let alive = true;
      try { process.kill(pid, 0); } catch (error) { if (error.code === "ESRCH") alive = false; }
      if (!alive) { unlinkSync(lockPath); return main(); }
      console.log("Oneinfo is already starting/running. Waiting for its console…");
      await waitForService(`${apiUrl}/health`, "api", null, 240_000);
      await waitForService(consoleUrl, "console", null, 240_000);
      if (!noAdb) await connectPhone(apiPort);
      if (!noBrowser) await openConsole(consoleUrl);
      return;
    }
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, stop);
    process.once("exit", cleanup);
    const [apiState, consoleState] = await Promise.all([probeService(`${apiUrl}/health`, "api"), probeService(consoleUrl, "console")]);
    if ([apiState, consoleState].includes("conflict")) throw new Error("A different application is using the API/console port. Close it and retry.");
    const env = { ...process.env, HOST: "127.0.0.1", PORT: String(apiPort), VITE_API_URL: apiUrl,
      CORS_ORIGIN: `${process.env.CORS_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:5175,http://127.0.0.1:5175"},${consoleUrl},http://localhost:${consolePort}` };
    const npm = (args) => { const [binary, parameters] = npmCommand(args); return command(binary, parameters, { env, signal: abort.signal }); };
    const startService = (name, args, cwd = root) => {
      const fd = openSync(join(logDir, `${name}.log`), "a");
      const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", fd, fd] });
      closeSync(fd); children.push(child);
      child.once("error", (error) => { console.error(`${name}: ${error.message}`); cleanup(); process.exitCode = 1; });
      child.once("exit", (code) => {
        if (!stopping) { console.error(`${name} stopped (exit ${code}). See .oneinfo/logs/${name}.log`); cleanup(); process.exitCode = 1; }
      });
      return child;
    };
    if (apiState !== "ready" || consoleState !== "ready") {
      if (!existsSync(join(root, "node_modules/.package-lock.json"))) { console.log("Installing project dependencies (first launch)…"); await npm(["ci", "--include=dev"]); }
      console.log("Starting local database. Docker must be installed and running…");
      await command("docker", ["compose", "up", "-d", "--wait", "postgres"], { env, signal: abort.signal });
      if (apiState !== "ready") {
        await npm(["run", "build", "--workspace", "@oneinfo/contracts"]);
        await npm(["run", "build", "--workspace", "@oneinfo/api"]);
        await npm(["run", "db:migrate"]);
        const api = startService("api", [join(root, "apps/api/dist/server.js")]);
        await waitForService(`${apiUrl}/health`, "api", api);
      }
      if (consoleState !== "ready") {
        await npm(["run", "build", "--workspace", "@oneinfo/production-console"]);
        const consoleChild = startService("console", [join(root, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(consolePort), "--strictPort"], join(root, "apps/production-console"));
        await waitForService(consoleUrl, "console", consoleChild);
      }
    }
    console.log(`Oneinfo ready: ${consoleUrl}`);
    if (!noAdb) await connectPhone(apiPort);
    if (!noBrowser) await openConsole(consoleUrl);
    if (children.length) console.log("Keep this window open. Press Ctrl+C to stop services started here. PostgreSQL data is retained.");
    else { console.log("Reused existing Oneinfo services; no restart needed."); cleanup(); }
  } catch (error) { cleanup(); if (!interrupted) throw error; }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(async (error) => {
    console.error(`Oneinfo could not start: ${error.message}`); process.exitCode = 1;
    if (process.argv.includes("--pause-on-error") && process.stdin.isTTY) {
      const { createInterface } = await import("node:readline/promises");
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      await prompt.question("Press Enter to close…"); prompt.close();
    }
  });
}
