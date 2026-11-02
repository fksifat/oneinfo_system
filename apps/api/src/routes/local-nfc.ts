import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  CreateNfcBridgeSessionSchema,
  NfcBridgeResultSchema,
  NfcReadResultSchema,
  PairNfcDeviceSchema,
  type NfcBridgeResultInput,
  type NfcReadResultInput,
} from "@oneinfo/contracts";
import { and, eq } from "drizzle-orm";
import { requireOperator, requireStation } from "../auth.js";
import { db } from "../db/client.js";
import { cards, productionJobs } from "../db/schema.js";
import { parseBody, sendCreated } from "../http.js";

interface Pairing {
  code: string;
  stationId: string;
  expiresAt: Date;
}

interface NfcDevice {
  id: string;
  stationId: string;
  token: string;
  name: string;
  runtimeVersion: string;
  pairedAt: Date;
  lastSeenAt: Date;
}

interface BridgeSession {
  id: string;
  jobId: string;
  cardId: string;
  stationId: string;
  expectedUrl: string;
  state: "PENDING" | "WRITING" | "SUCCEEDED" | "FAILED";
  deviceId?: string;
  result?: NfcBridgeResultInput;
  createdAt: Date;
  expiresAt: Date;
}

interface ReadSession {
  id: string;
  stationId: string;
  state: "PENDING" | "READING" | "COMPLETED" | "FAILED";
  deviceId?: string;
  result?: NfcReadResultInput;
  createdAt: Date;
  expiresAt: Date;
}

const pairings = new Map<string, Pairing>();
const devices = new Map<string, NfcDevice>();
const sessions = new Map<string, BridgeSession>();
const readSessions = new Map<string, ReadSession>();

function prune() {
  const now = Date.now();
  for (const [code, pairing] of pairings) if (pairing.expiresAt.getTime() < now) pairings.delete(code);
  for (const [id, session] of sessions) if (session.expiresAt.getTime() < now) sessions.delete(id);
  for (const [id, session] of readSessions) if (session.expiresAt.getTime() < now) readSessions.delete(id);
}

function requireDevice(request: FastifyRequest): NfcDevice {
  const token = request.headers["x-oneinfo-device-token"];
  if (typeof token !== "string") throw Object.assign(new Error("Missing NFC device token"), { statusCode: 401 });
  const device = [...devices.values()].find((candidate) => candidate.token === token);
  if (!device) throw Object.assign(new Error("Invalid NFC device token"), { statusCode: 401 });
  device.lastSeenAt = new Date();
  return device;
}

export const localNfcRoutes: FastifyPluginAsync = async (app) => {
  app.post("/pairings", async (request, reply) => {
    await requireOperator(request);
    const station = await requireStation(request);
    prune();
    let code = "";
    do code = String(randomInt(0, 1_000_000)).padStart(6, "0"); while (pairings.has(code));
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    pairings.set(code, { code, stationId: station.stationId, expiresAt });
    return sendCreated(reply, {
      pairingCode: code,
      expiresAt,
      localApiUrl: "http://127.0.0.1:3001",
      readerCommand: `npm run nfc:desktop -- --pairing ${code}`,
    });
  });

  app.post("/devices/pair", async (request, reply) => {
    prune();
    const input = parseBody(PairNfcDeviceSchema, request.body);
    const pairing = pairings.get(input.pairingCode);
    if (!pairing) throw Object.assign(new Error("Pairing code is invalid or expired"), { statusCode: 404 });
    pairings.delete(input.pairingCode);
    const device: NfcDevice = {
      id: randomUUID(),
      stationId: pairing.stationId,
      token: randomBytes(32).toString("base64url"),
      name: input.deviceName,
      runtimeVersion: input.runtimeVersion,
      pairedAt: new Date(),
      lastSeenAt: new Date(),
    };
    devices.set(device.id, device);
    return sendCreated(reply, { deviceId: device.id, deviceToken: device.token, stationId: device.stationId });
  });

  app.get("/devices", async (request) => {
    await requireOperator(request);
    const station = await requireStation(request);
    return {
      items: [...devices.values()]
        .filter((device) => device.stationId === station.stationId)
        .map(({ token: _token, ...device }) => ({ ...device, online: Date.now() - device.lastSeenAt.getTime() < 15_000 })),
    };
  });

  app.post("/sessions", async (request, reply) => {
    await requireOperator(request);
    const station = await requireStation(request);
    const input = parseBody(CreateNfcBridgeSessionSchema, request.body);
    const [row] = await db
      .select({ job: productionJobs, card: cards })
      .from(productionJobs)
      .innerJoin(cards, eq(cards.id, productionJobs.cardId))
      .where(and(eq(productionJobs.id, input.jobId), eq(productionJobs.assignedStationId, station.stationId)))
      .limit(1);
    if (!row || row.job.type !== "NFC_ENCODING" || row.job.status !== "CLAIMED") {
      throw Object.assign(new Error("A claimed NFC job assigned to this station is required"), { statusCode: 409 });
    }
    if (row.card.canonicalUrl !== input.expectedUrl) {
      throw Object.assign(new Error("NFC URL does not match the card canonical URL"), { statusCode: 409 });
    }
    const session: BridgeSession = {
      id: randomUUID(),
      jobId: row.job.id,
      cardId: row.card.id,
      stationId: station.stationId,
      expectedUrl: input.expectedUrl,
      state: "PENDING",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3 * 60_000),
    };
    sessions.set(session.id, session);
    return sendCreated(reply, session);
  });

  app.post("/read-sessions", async (request, reply) => {
    await requireOperator(request);
    const station = await requireStation(request);
    prune();
    const session: ReadSession = {
      id: randomUUID(),
      stationId: station.stationId,
      state: "PENDING",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 2 * 60_000),
    };
    readSessions.set(session.id, session);
    return sendCreated(reply, session);
  });

  app.get("/read-sessions/:sessionId", async (request) => {
    await requireOperator(request);
    const station = await requireStation(request);
    prune();
    const { sessionId } = request.params as { sessionId: string };
    const session = readSessions.get(sessionId);
    if (!session || session.stationId !== station.stationId) {
      throw Object.assign(new Error("NFC read session not found or expired"), { statusCode: 404 });
    }
    return session;
  });

  app.get("/sessions/:sessionId", async (request) => {
    await requireOperator(request);
    const station = await requireStation(request);
    prune();
    const { sessionId } = request.params as { sessionId: string };
    const session = sessions.get(sessionId);
    if (!session || session.stationId !== station.stationId) {
      throw Object.assign(new Error("NFC bridge session not found or expired"), { statusCode: 404 });
    }
    return session;
  });

  app.get("/device/tasks/next", async (request) => {
    prune();
    const device = requireDevice(request);
    const task = [...sessions.values()].find(
      (session) => session.stationId === device.stationId && session.state === "PENDING",
    );
    if (!task) return replyNoContent();
    task.state = "WRITING";
    task.deviceId = device.id;
    return { sessionId: task.id, jobId: task.jobId, expectedUrl: task.expectedUrl, expiresAt: task.expiresAt };
  });

  app.get("/device/read-tasks/next", async (request) => {
    prune();
    const device = requireDevice(request);
    const task = [...readSessions.values()].find(
      (session) => session.stationId === device.stationId && session.state === "PENDING",
    );
    if (!task) return { task: null };
    task.state = "READING";
    task.deviceId = device.id;
    return { sessionId: task.id, expiresAt: task.expiresAt };
  });

  app.post("/device/tasks/:sessionId/result", async (request) => {
    const device = requireDevice(request);
    const { sessionId } = request.params as { sessionId: string };
    const session = sessions.get(sessionId);
    if (!session || session.stationId !== device.stationId || session.deviceId !== device.id) {
      throw Object.assign(new Error("NFC bridge task is not assigned to this device"), { statusCode: 404 });
    }
    const result = parseBody(NfcBridgeResultSchema, request.body);
    if (result.expectedUrl !== session.expectedUrl) {
      throw Object.assign(new Error("NFC device result URL does not match the bridge task"), { statusCode: 409 });
    }
    session.result = result;
    session.state = result.result;
    return { accepted: true, state: session.state };
  });

  app.post("/device/read-tasks/:sessionId/result", async (request) => {
    const device = requireDevice(request);
    const { sessionId } = request.params as { sessionId: string };
    const session = readSessions.get(sessionId);
    if (!session || session.stationId !== device.stationId || session.deviceId !== device.id) {
      throw Object.assign(new Error("NFC read task is not assigned to this device"), { statusCode: 404 });
    }
    const result = parseBody(NfcReadResultSchema, request.body);
    session.result = result;
    session.state = result.errorCode ? "FAILED" : "COMPLETED";
    return { accepted: true, state: session.state };
  });
};

function replyNoContent() {
  return { task: null };
}
