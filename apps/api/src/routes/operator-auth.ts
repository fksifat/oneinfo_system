import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { operators } from "../db/schema.js";
import { issueOperatorToken } from "../auth.js";
import { verifyPassword } from "../domain/customer-auth.js";
import { allowAuthAttempt } from "../domain/auth-attempts.js";
import { parseBody } from "../http.js";

const LoginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) });

export const operatorAuthRoutes: FastifyPluginAsync = async app => {
  app.post("/login", async (request, reply) => {
    if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD_HASH) return reply.code(503).send({ message: "Administrator login is not configured." });
    const input = parseBody(LoginSchema, request.body);
    const allowed = await allowAuthAttempt(`operator-login:${request.ip}`, 10, 15 * 60_000);
    if (!allowed) return reply.code(429).header("Retry-After", "900").send({ message: "Too many login attempts. Try again in 15 minutes." });
    const passwordMatches = await verifyPassword(input.password, config.ADMIN_PASSWORD_HASH);
    if (!passwordMatches || input.email.toLowerCase() !== config.ADMIN_EMAIL.toLowerCase()) return reply.code(401).send({ message: "Email or password is incorrect." });
    await db.insert(operators).values({ email: config.ADMIN_EMAIL.toLowerCase(), displayName: "Oneinfo Administrator", role: "SUPER_ADMIN" }).onConflictDoNothing();
    const [operator] = await db.select().from(operators).where(eq(operators.email, config.ADMIN_EMAIL.toLowerCase())).limit(1);
    if (!operator?.active || operator.role !== "SUPER_ADMIN") return reply.code(403).send({ message: "Administrator access is disabled." });
    const identity = { operatorId: operator.id, email: operator.email, role: operator.role };
    reply.header("Cache-Control", "no-store");
    return { accessToken: await issueOperatorToken(identity), operator: identity, expiresInSeconds: 1800 };
  });
};
