import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
const originalArgv = process.argv;
afterEach(() => { process.argv = originalArgv; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

it("retries a completed PC/SC write result after network failure without writing again or reporting failure", async () => {
  process.argv = ["node", "bridge", "--pairing", "123456"];
  vi.spyOn(process, "on").mockReturnValue(process);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  let poll: () => void;
  vi.stubGlobal("setInterval", vi.fn((callback: () => void) => { poll = callback; return 1; }));
  const results: any[] = [];
  let claimed = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith("/devices/pair")) return Response.json({ deviceToken: "test", stationId: "test" });
    if (url.endsWith("/tasks/next")) {
      if (claimed) return Response.json({ task: null });
      claimed = true;
      return Response.json({ sessionId: "task-1", expectedUrl: "https://example.com/card" });
    }
    results.push(JSON.parse(init.body as string));
    if (results.length === 1) throw new TypeError("Network unavailable");
    return Response.json({ accepted: true });
  }));
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    queueMicrotask(() => {
      child.stdout.emit("data", JSON.stringify({ reader: "Test reader", readbackUrl: "https://example.com/card" }));
      child.emit("close", 0);
    });
    return child as ReturnType<typeof spawn>;
  });
  await import("../../desktop-nfc-bridge/src/index.mjs");
  await vi.waitFor(() => expect(results.length).toBeGreaterThanOrEqual(1));
  await vi.waitFor(() => { poll!(); expect(results).toHaveLength(2); });
  expect(results.map(result => result.result)).toEqual(["SUCCEEDED", "SUCCEEDED"]);
  expect(spawn).toHaveBeenCalledTimes(1);
});
