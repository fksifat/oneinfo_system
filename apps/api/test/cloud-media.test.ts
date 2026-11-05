import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { put } from "@vercel/blob";
import { productMediaRoutes } from "../src/routes/product-media.js";

vi.mock("@vercel/blob", () => ({ put: vi.fn(async () => ({ url: "https://media.public.blob.vercel-storage.com/product-media/test.png" })) }));
vi.mock("../src/auth.js", () => ({ requireOperator: vi.fn(async (request: { headers: { authorization?: string } }) => {
  if (request.headers.authorization !== "Bearer test-admin") throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
}) }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("requires operator authentication and valid bytes before storing cloud uploads durably", async () => {
  vi.stubEnv("VERCEL", "1"); vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-only");
  const app = Fastify(); app.register(productMediaRoutes, { prefix: "/media" });
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const upload = (payload: Buffer, authenticated = true) => app.inject({ method: "POST", url: "/media/upload/png", payload,
    headers: { "content-type": "application/octet-stream", ...(authenticated ? { authorization: "Bearer test-admin" } : {}) } });
  try {
    expect((await upload(png, false)).statusCode).toBe(401);
    expect((await upload(Buffer.from("invalid"))).statusCode).toBe(415);
    expect(put).not.toHaveBeenCalled();
    const uploaded = await upload(png);
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().url).toMatch(/^https:\/\//);
    expect(put).toHaveBeenCalledTimes(1);
    expect((await upload(Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024)]))).statusCode).toBe(413);
    vi.stubEnv("VERCEL", "");
    expect((await upload(png)).statusCode).toBe(201);
    expect(put).toHaveBeenCalledTimes(2);
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect((await upload(png)).statusCode).toBe(503);
    expect(put).toHaveBeenCalledTimes(2);
  } finally { await app.close(); }
});
