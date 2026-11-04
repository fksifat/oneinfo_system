import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { productMediaRoutes } from "../src/routes/product-media.js";

afterEach(() => vi.unstubAllGlobals());

it("serves Drive image bytes and rejects invalid IDs and HTML responses", async () => {
  const app = Fastify();
  app.register(productMediaRoutes, { prefix: "/api/v1/product-media" });
  const bytes = Buffer.from("89504e470d0a1a0a", "hex");
  const upstream = vi.fn()
    .mockResolvedValueOnce(new Response(bytes, { headers: { "content-type": "image/png" } }))
    .mockResolvedValueOnce(new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } }));
  vi.stubGlobal("fetch", upstream);
  const path = "/api/v1/product-media/drive/sample-id?resourcekey=0-key";
  try {
    expect((await app.inject("/api/v1/product-media/drive/bad%2Fid")).statusCode).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    const image = await app.inject(path);
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toBe("image/png");
    expect(image.rawPayload).toEqual(bytes);
    expect(String(upstream.mock.calls[0]?.[0])).toBe("https://drive.usercontent.google.com/download?id=sample-id&export=download&resourcekey=0-key");
    expect(upstream.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    expect((await app.inject(path)).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});
