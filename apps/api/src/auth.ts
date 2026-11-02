import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import type { OperatorRole } from "@oneinfo/contracts";
import { and, eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { operators, productionStations } from "./db/schema.js";
import { config } from "./config.js";

const jwtKey = new TextEncoder().encode(config.JWT_SECRET);

export interface OperatorIdentity {
  operatorId: string;
  email: string;
  role: OperatorRole;
}

export interface StationIdentity {
  stationId: string;
  stationCode: string;
}

export function hashCredential(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createStationCredential(stationId: string): string {
  return `${stationId}.${randomBytes(32).toString("base64url")}`;
}

export async function issueOperatorToken(identity: OperatorIdentity): Promise<string> {
  return new SignJWT({ email: identity.email, role: identity.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(identity.operatorId)
    .setIssuer("oneinfo-production-api")
    .setAudience("oneinfo-production-console")
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(jwtKey);
}

export async function requireOperator(
  request: FastifyRequest,
  allowedRoles?: readonly OperatorRole[],
): Promise<OperatorIdentity> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    throw Object.assign(new Error("Missing operator bearer token"), { statusCode: 401 });
  }

  try {
    const { payload } = await jwtVerify(authorization.slice(7), jwtKey, {
      issuer: "oneinfo-production-api",
      audience: "oneinfo-production-console",
    });
    const role = payload.role as OperatorRole;
    const identity = {
      operatorId: payload.sub ?? "",
      email: String(payload.email ?? ""),
      role,
    };
    if (!identity.operatorId || !identity.email || !role) throw new Error("Invalid claims");
    if (allowedRoles && !allowedRoles.includes(role)) {
      throw Object.assign(new Error("Operator role is not permitted"), { statusCode: 403 });
    }
    return identity;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 403) throw error;
    throw Object.assign(new Error("Invalid or expired operator token"), { statusCode: 401 });
  }
}

export async function requireStation(request: FastifyRequest): Promise<StationIdentity> {
  const rawCredential = request.headers["x-station-key"];
  if (typeof rawCredential !== "string") {
    throw Object.assign(new Error("Missing station credential"), { statusCode: 401 });
  }
  const stationId = rawCredential.split(".", 1)[0];
  if (!stationId) throw Object.assign(new Error("Invalid station credential"), { statusCode: 401 });

  const [station] = await db
    .select({ id: productionStations.id, code: productionStations.stationCode })
    .from(productionStations)
    .where(
      and(
        eq(productionStations.id, stationId),
        eq(productionStations.credentialHash, hashCredential(rawCredential)),
        eq(productionStations.status, "ACTIVE"),
      ),
    )
    .limit(1);
  if (!station) throw Object.assign(new Error("Invalid or revoked station credential"), { statusCode: 401 });

  await db.update(productionStations).set({ lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(productionStations.id, station.id));
  return { stationId: station.id, stationCode: station.code };
}

export async function ensureDevelopmentAdmin(): Promise<OperatorIdentity> {
  if (config.NODE_ENV === "production") {
    throw Object.assign(new Error("Development authentication is disabled"), { statusCode: 404 });
  }

  const [existing] = await db.select().from(operators).where(eq(operators.email, config.DEV_ADMIN_EMAIL)).limit(1);
  if (existing) return { operatorId: existing.id, email: existing.email, role: existing.role };

  const [created] = await db
    .insert(operators)
    .values({
      id: randomUUID(),
      email: config.DEV_ADMIN_EMAIL,
      displayName: "Development Administrator",
      role: "SUPER_ADMIN",
    })
    .returning();
  if (!created) throw new Error("Could not create development administrator");
  return { operatorId: created.id, email: created.email, role: created.role };
}
