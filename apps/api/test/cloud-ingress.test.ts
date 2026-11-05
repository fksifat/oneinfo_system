import { afterEach, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

afterEach(() => vi.unstubAllEnvs());

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
