import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { probeService, waitForService, npmCommand } from "./start-local.mjs";
import { shortcut, desktopQuote, installShortcut } from "./setup-desktop.mjs";
import { browserCommands } from "./desktop.mjs";

test("readiness identifies Oneinfo, rejects an unrelated server, and detects stopped children", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/health") response.end(JSON.stringify({ status: "ok", service: "oneinfo-production-api" }));
    else if (request.url === "/console") response.end("<title>Oneinfo Production Console</title>");
    else response.end("Some other app");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(await probeService(base + "/health", "api"), "ready");
    assert.equal(await probeService(base + "/console", "console"), "ready");
    assert.equal(await probeService(base + "/other", "console"), "conflict");
    await assert.rejects(waitForService(base + "/other", "api"), /Port conflict/);
    await assert.rejects(waitForService(base + "/health", "api", { exitCode: 1, signalCode: null }), /stopped during startup/);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  assert.equal(await probeService(base + "/health", "api"), "down");
});

test("Windows npm uses cmd only for trusted fixed arguments when a CLI path is unavailable", () => {
  assert.deepEqual(npmCommand(["run", "build", "--workspace", "@oneinfo/api"], "win32", "/oneinfo-test-missing/bin/node", "/missing/npm"), [
    "cmd.exe", ["/d", "/s", "/c", "npm.cmd run build --workspace @oneinfo/api"],
  ]);
  assert.throws(() => npmCommand(["run", "build&whoami"], "win32", "/oneinfo-test-missing/bin/node", "/missing/npm"), /Unsafe/);
});

test("npm CLI and project paths with spaces are passed as separate arguments", () => {
  const directory = mkdtempSync(join(tmpdir(), "Oneinfo workspace "));
  try {
    const cli = join(directory, "npm-cli.js"); writeFileSync(cli, "");
    assert.deepEqual(npmCommand(["ci"], "win32", "C:\\Program Files\\nodejs\\node.exe", cli), ["C:\\Program Files\\nodejs\\node.exe", [cli, "ci"]]);
  } finally { rmSync(directory, { recursive: true }); }
});

test("shortcuts handle each platform and quote paths without expanding shell content", async () => {
  const linux = shortcut("linux", "/home/user/Oneinfo $work", "/node path/node");
  assert.equal(linux.name, "oneinfo-production.desktop");
  assert.ok(linux.content.includes('Terminal=true'));
  assert.ok(linux.content.includes(desktopQuote("/home/user/Oneinfo $work/scripts/start-local.mjs")));
  assert.ok(desktopQuote("100% ready").includes("100%% ready"));
  assert.throws(() => desktopQuote("bad\npath"), /line breaks/);
  const windows = shortcut("win32", "C:\\Oneinfo Workspace", "C:\\Program Files\\nodejs\\node.exe");
  assert.equal(windows.name, "Start Oneinfo.cmd");
  assert.ok(windows.content.includes('"C:\\Oneinfo Workspace\\scripts\\start-local.mjs"'));
  const mac = shortcut("darwin", "/Users/dev/Oneinfo 'work' $cash", "/node path/node");
  assert.equal(mac.name, "Start Oneinfo.command");
  if (process.platform !== "win32") {
    // A harmless printf substitute proves that shell quotes preserve literal paths.
    const line = mac.content.split("\n").find((line) => line.startsWith("exec ")).slice(5).replace("'/node path/node'", "printf '%s\\n'");
    const child = spawn("/bin/sh", ["-c", line], { stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", (data) => { output += data; });
    const [code] = await once(child, "close");
    assert.equal(code, 0); assert.equal(output.split("\n")[0], "/Users/dev/Oneinfo 'work' $cash/scripts/start-local.mjs");
  }
});

test("desktop setup updates only its own shortcut and preserves unrelated files", () => {
  const directory = mkdtempSync(join(tmpdir(), "oneinfo-launcher-"));
  try {
    const path = installShortcut(directory);
    assert.ok(readFileSync(path, "utf8").includes("Oneinfo managed launcher"));
    assert.equal(installShortcut(directory), path);
    writeFileSync(path, "unrelated user file");
    assert.throws(() => installShortcut(directory), /Will not replace/);
    assert.equal(readFileSync(path, "utf8"), "unrelated user file");
  } finally { rmSync(directory, { recursive: true }); }
});

test("browser launchers provide Windows, macOS and Linux default-browser fallbacks", () => {
  const url = "http://127.0.0.1:5173/";
  assert.deepEqual(browserCommands(url, "win32", {}).at(-1), ["explorer.exe", [url]]);
  assert.deepEqual(browserCommands(url, "darwin").at(-1), ["open", [url]]);
  assert.deepEqual(browserCommands(url, "linux").at(-1), ["xdg-open", [url]]);
});
