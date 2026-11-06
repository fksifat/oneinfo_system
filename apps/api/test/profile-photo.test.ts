import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { put } from "@vercel/blob";
import { allowAuthAttempt } from "../src/domain/auth-attempts.js";
import { productMediaRoutes } from "../src/routes/product-media.js";

const state = vi.hoisted(() => ({ secret: { codeHash: "hash", version: "current", redeemedAt: null as Date | null } }));
vi.mock("@vercel/blob", () => ({ put: vi.fn(async () => ({ url: "https://media.example/profile.webp" })) }));
vi.mock("../src/domain/auth-attempts.js", () => ({ allowAuthAttempt: vi.fn(async () => true) }));
vi.mock("../src/domain/customer-auth.js", () => ({
  requireCustomer: vi.fn(async (request: { headers: { authorization?: string } }) => {
    if (request.headers.authorization !== "Bearer owner") throw Object.assign(new Error("Sign in"), { statusCode: 401 });
    return { id: "owner" };
  }),
  readClaimToken: vi.fn(async (token: string) => {
    if (token !== "claim") throw Object.assign(new Error("Invalid claim"), { statusCode: 401 });
    return { cardId: "card", version: "current" };
  }),
}));
vi.mock("../src/db/client.js", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [state.secret] }) }) }) } }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); state.secret.redeemedAt = null; vi.mocked(allowAuthAttempt).mockResolvedValue(true); });

it("allows only authenticated owners or a live activation claim to upload a bounded raster photo", async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-only");
  const app = Fastify(); app.register(productMediaRoutes, { prefix: "/media" });
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const upload = (route = "profile/png", token = "owner", payload = png) => app.inject({ method: "POST", url: `/media/${route}`, payload,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" } });
  try {
    expect((await upload("profile/png", "anonymous")).statusCode).toBe(401);
    expect((await upload("profile-claim/png", "invalid")).statusCode).toBe(401);
    expect((await upload("profile/svg")).statusCode).toBe(415);
    expect((await upload("profile/png", "owner", Buffer.from("not an image"))).statusCode).toBe(415);
    expect((await upload("profile/png", "owner", Buffer.alloc(2 * 1024 * 1024 + 1))).statusCode).toBe(413);
    expect(put).not.toHaveBeenCalled();
    expect((await upload()).statusCode).toBe(201);
    expect((await upload("profile-claim/png", "claim")).statusCode).toBe(201);
    expect(put).toHaveBeenCalledTimes(2);
    state.secret.redeemedAt = new Date();
    expect((await upload("profile-claim/png", "claim")).statusCode).toBe(401);
    vi.mocked(allowAuthAttempt).mockResolvedValue(false);
    const limited = await upload(); expect(limited.statusCode).toBe(429); expect(limited.headers["retry-after"]).toBe("3600");
    expect(put).toHaveBeenCalledTimes(2);
  } finally { await app.close(); }
});
