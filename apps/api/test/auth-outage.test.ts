import { afterEach, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { config } from "../src/config.js";

const query = vi.hoisted(() => vi.fn());
vi.mock("../src/db/client.js", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: query }) }) }) } }));
import { issueOperatorToken, requireOperator, requireStation } from "../src/auth.js";
import { issueCustomerToken, requireCustomer } from "../src/domain/customer-auth.js";
afterEach(() => vi.resetAllMocks());
const request = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as FastifyRequest;

it("keeps operator/customer sessions when their database lookup fails", async () => {
  const outage = new Error("Database connection interrupted");
  query.mockRejectedValue(outage);
  const token = await issueOperatorToken({ operatorId: randomUUID(), email: "test@example.com", role: "SUPER_ADMIN" });
  await expect(requireOperator(request(token))).rejects.toBe(outage);
  await expect(requireCustomer(request(await issueCustomerToken(randomUUID())))).rejects.toBe(outage);
});

it("rejects malformed signed identities and station IDs before querying PostgreSQL", async () => {
  const key = new TextEncoder().encode(config.JWT_SECRET);
  const token = await new SignJWT({ email: "test@example.com", role: "SUPER_ADMIN" }).setProtectedHeader({ alg: "HS256" })
    .setIssuer("oneinfo-production-api").setAudience("oneinfo-production-console").setSubject("invalid-uuid").sign(key);
  await expect(requireOperator(request(token))).rejects.toMatchObject({ statusCode: 401 });
  await expect(requireCustomer(request(await issueCustomerToken("invalid-uuid")))).rejects.toMatchObject({ statusCode: 401 });
  await expect(requireStation({ headers: { "x-station-key": `${"-".repeat(36)}.secret` } } as FastifyRequest)).rejects.toMatchObject({ statusCode: 401 });
  expect(query).not.toHaveBeenCalled();
});
