import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function browserCommands(url, platform = process.platform, env = process.env) {
  if (platform === "win32") return [
    ...[env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean)
      .flatMap((base) => [join(base, "Google/Chrome/Application/chrome.exe"), join(base, "Microsoft/Edge/Application/msedge.exe")])
      .filter(existsSync).map((command) => [command, [`--app=${url}`, "--new-window"]]),
    ["explorer.exe", [url]],
  ];
  if (platform === "darwin") return [
    ...["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(existsSync)
      .map((command) => [command, [`--app=${url}`, "--new-window"]]),
    ["open", [url]],
  ];
  return [["google-chrome", [`--app=${url}`, "--new-window"]], ["chromium", [`--app=${url}`, "--new-window"]], ["xdg-open", [url]]];
}

export async function openConsole(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Console URL must use HTTP or HTTPS");
  for (const [command, args] of browserCommands(url.href)) {
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: "ignore" });
        child.once("error", reject);
        child.once("spawn", () => { child.unref(); resolve(); });
      });
      return;
    } catch { /* Try the next installed browser or the OS default. */ }
  }
  console.log(`Open ${url.href} in your browser.`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const url = process.env.ONEINFO_DESKTOP_URL ?? "http://127.0.0.1:5173";
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await openConsole(url);
  } catch {
    console.error("Console is not running. Use npm run start:local to start the local system.");
    process.exitCode = 1;
  }
}
