import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const marker = "Oneinfo managed launcher";
const root = fileURLToPath(new URL("../", import.meta.url));
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const batchQuote = (value) => '"' + value.replaceAll("%", "%%") + '"';

export function desktopQuote(value) {
  if (/[\r\n]/.test(value)) throw new Error("Launcher paths cannot contain line breaks");
  const quoted = value.replace(/[\\"$`]/g, (character) => "\\" + character).replaceAll("%", "%%");
  return '"' + quoted.replaceAll("\\", "\\\\") + '"';
}

export function shortcut(platform, projectRoot, nodePath) {
  const script = platform === "win32" ? win32.join(projectRoot, "scripts/start-local.mjs") : join(projectRoot, "scripts/start-local.mjs");
  if (platform === "win32") return { name: "Start Oneinfo.cmd", content: `@echo off\r\nrem ${marker}\r\nsetlocal DisableDelayedExpansion\r\n${batchQuote(nodePath)} ${batchQuote(script)} --pause-on-error\r\n` };
  if (platform === "darwin") return { name: "Start Oneinfo.command", content: `#!/bin/bash\n# ${marker}\nexec ${shellQuote(nodePath)} ${shellQuote(script)} --pause-on-error\n` };
  return { name: "oneinfo-production.desktop", content: `[Desktop Entry]\n# ${marker}\nType=Application\nVersion=1.0\nName=Start Oneinfo\nComment=Start the local Oneinfo production workstation\nExec=${desktopQuote(nodePath)} ${desktopQuote(script)} --pause-on-error\nTerminal=true\nIcon=applications-office\nCategories=Office;\n` };
}

function desktopDirectory() {
  if (process.platform === "win32") {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  } else if (process.platform === "linux") {
    const result = spawnSync("xdg-user-dir", ["DESKTOP"], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim() && result.stdout.trim() !== homedir()) return result.stdout.trim();
  }
  return join(homedir(), "Desktop");
}

export function installShortcut(directory = desktopDirectory()) {
  const { name, content } = shortcut(process.platform, root, process.execPath);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  if (existsSync(path) && !readFileSync(path, "utf8").includes(marker)) throw new Error(`Will not replace an unrelated file: ${path}`);
  writeFileSync(path, content);
  if (process.platform !== "win32") chmodSync(path, 0o755);
  if (process.platform === "linux") spawnSync("gio", ["set", path, "metadata::trusted", "true"], { stdio: "ignore" });
  console.log(`Desktop launcher created: ${path}`);
  if (process.platform === "linux") console.log('If needed, right-click it and choose "Allow Launching" once.');
  console.log("Install Node.js 22.12+ and Docker with Compose first. Keep Docker running.");
  return path;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { installShortcut(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
