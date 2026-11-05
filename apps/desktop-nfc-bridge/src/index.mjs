import os from "node:os";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  if (process.argv[index]?.startsWith("--")) args.set(process.argv[index].slice(2), process.argv[index + 1]);
}

const apiUrl = args.get("api") ?? "http://127.0.0.1:3001/api/v1/local-nfc";
let pairingCode = args.get("pairing") ?? process.env.ONEINFO_PAIRING_CODE;
let deviceToken = "";
let pendingTask = null;
let pendingResult = null;
let busy = false;
let polling = false;
let readerName = "Python PC/SC desktop bridge";

if (!pairingCode) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  pairingCode = (await prompt.question("Enter the six-digit pairing code from the production console: ")).trim();
  prompt.close();
}
if (!/^\d{6}$/.test(pairingCode)) throw new Error("A six-digit pairing code is required");

async function request(method, path, body) {
  const response = await fetch(apiUrl + path, {
    method,
    signal: AbortSignal.timeout(8000),
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(deviceToken ? { "x-oneinfo-device-token": deviceToken } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.message ?? `Local API returned ${response.status}`), { status: response.status });
  return payload;
}

const paired = await request("POST", "/devices/pair", {
  pairingCode,
  deviceName: `USB PC/SC reader on ${os.hostname()}`,
  runtimeVersion: `Node ${process.version} · ${process.platform}`,
});
deviceToken = paired.deviceToken;
console.log(`Paired with local station ${paired.stationId}.`);

async function submitResult(task, result, readbackUrl, errorCode, metadata = {}) {
  pendingResult = { task, body: {
    result,
    expectedUrl: task.expectedUrl,
    ...(readbackUrl ? { readbackUrl } : {}),
    ...(errorCode ? { errorCode } : {}),
    deviceMetadata: {
      adapter: "desktop-pcsc",
      reader: readerName,
      protocol: "NDEF_URI",
      runtime: process.version,
      ...metadata,
    },
  } };
  await deliverResult();
}

async function deliverResult() {
  try {
    await request("POST", `/device/tasks/${pendingResult.task.sessionId}/result`, pendingResult.body);
  } catch (error) {
    if ([400, 401, 403, 404, 409].includes(error.status)) {
      pendingResult = null;
      pendingTask = null;
      console.error("Workstation rejected the result. Check the card and connection before starting new work.");
    }
    throw error;
  }
  pendingResult = null;
  pendingTask = null;
}

async function writeWithPcsc(task) {
  busy = true;
  let writeCompleted = false;
  console.log("Waiting for an NFC Type 2 card on the USB reader…");
  try {
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "write_ndef.py");
    const result = await new Promise((resolve, reject) => {
      const child = spawn("python3", [script, task.expectedUrl], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; process.stderr.write(chunk); });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) return reject(new Error(stderr.trim() || `PC/SC helper exited with ${code}`));
        try { resolve(JSON.parse(stdout.trim())); } catch { reject(new Error("PC/SC helper returned invalid output")); }
      });
    });
    readerName = result.reader ?? readerName;
    writeCompleted = true;
    if (result.readbackUrl !== task.expectedUrl) {
      await submitResult(task, "FAILED", result.readbackUrl, "READBACK_MISMATCH", result);
      console.error("Read-back did not match the expected URL.");
    } else {
      await submitResult(task, "SUCCEEDED", result.readbackUrl, null, result);
      console.log("NFC write and read-back verified. Remove the card.");
    }
  } catch (error) {
    if (writeCompleted) {
      console.error(pendingResult ? "NFC result delivery failed; it will be retried without rewriting the tag:" : "NFC write completed but its result was rejected:", error.message);
      return;
    }
    await submitResult(task, "FAILED", null, "WRITE_FAILED", {
      message: error instanceof Error ? error.message : String(error),
    });
    console.error("NFC write failed:", error instanceof Error ? error.message : error);
  } finally {
    busy = false;
  }
}

async function poll() {
  if (busy || polling) return;
  polling = true;
  try {
    if (pendingResult) { await deliverResult(); return; }
    if (pendingTask) return;
    const task = await request("GET", "/device/tasks/next");
    if (!task.sessionId) return;
    pendingTask = task;
    await writeWithPcsc(task);
  } catch (error) {
    console.error("Bridge poll failed:", error instanceof Error ? error.message : error);
  } finally {
    polling = false;
  }
}

console.log("Desktop NFC bridge is ready. Connect a USB PC/SC reader.");
const timer = setInterval(() => void poll(), 1000);
void poll();
process.on("SIGINT", () => { clearInterval(timer); process.exit(0); });
