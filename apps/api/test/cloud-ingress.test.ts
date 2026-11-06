import { afterEach, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";

const defaultProxyHops = config.TRUST_PROXY_HOPS;

it("prevents API response caching while retaining explicit public media caching", async () => {
  const app = buildApp();
  app.get("/test-private", async () => ({ private: true }));
  app.get("/test-media", async (_request, reply) => reply.header("Cache-Control", "public, max-age=300").send("media"));
  try {
    expect((await app.inject("/test-private")).headers["cache-control"]).toBe("no-store");
    expect((await app.inject("/test-media")).headers["cache-control"]).toBe("public, max-age=300");
  } finally { await app.close(); }
});

it("does not write SQL parameters or credentials into request error logs", async () => {
  const app = buildApp();
  const log = vi.fn();
  app.addHook("onRequest", async request => { request.log.error = log; });
  app.get("/test-private-error", async () => { throw Object.assign(new Error("private query"), { query: "insert ...", params: ["private-password"], cause: { code: "08006" } }); });
  try {
    const response = await app.inject("/test-private-error");
    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-password|private query|insert/);
    expect(log).toHaveBeenCalledWith({ name: "Error", code: "08006", statusCode: 500 }, "request failed");
  } finally { await app.close(); }
});

afterEach(() => {
  vi.unstubAllEnvs();
  config.TRUST_PROXY_HOPS = defaultProxyHops;
});

it.each([["1", "203.0.113.5"], ["", "127.0.0.1"]])("uses the platform client address only in Vercel (VERCEL=%s)", async (vercel, expected) => {
  vi.stubEnv("VERCEL", vercel);
  const app = buildApp();
  app.get("/test-client-address", async request => ({ ip: request.ip }));
  try {
    const response = await app.inject({ url: "/test-client-address", headers: { "x-forwarded-for": "203.0.113.5" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().ip).toBe(expected);
  } finally { await app.close(); }
});

it("trusts only the nearest configured VPS proxy hop", async () => {
  vi.stubEnv("VERCEL", "");
  config.TRUST_PROXY_HOPS = 1;
  const app = buildApp();
  app.get("/test-client-address", async request => ({ ip: request.ip }));
  try {
    const response = await app.inject({
      url: "/test-client-address",
      remoteAddress: "172.18.0.1",
      headers: { "x-forwarded-for": "198.51.100.99, 203.0.113.5" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().ip).toBe("203.0.113.5");
  } finally { await app.close(); }
});
