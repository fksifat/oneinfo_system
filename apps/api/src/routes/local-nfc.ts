import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  CreateNfcBridgeSessionSchema,
  NfcBridgeResultSchema,
  NfcReadResultSchema,
  PairNfcDeviceSchema,
  CreateVerificationSchema,
  VerificationResultSchema,
  StartQrVerificationSchema,
  ScanActionSchema,
  NfcUtilitySchema,
  type NfcUtilityInput,
  type NfcBridgeResultInput,
  type NfcReadResultInput,
} from "@oneinfo/contracts";
import { and, desc, eq } from "drizzle-orm";
import { hashCredential, requireOperator, requireStation } from "../auth.js";
import { db } from "../db/client.js";
import { cards, cardBatches, productionJobs, productionStations, cardVerifications, cardEvents, operators } from "../db/schema.js";
import { claimProductionJob, saveNfcAttempt, saveQualityCheck } from "./jobs.js";
import { parseBody, sendCreated } from "../http.js";

interface Pairing {
  code: string;
  stationId: string;
  operatorId: string;
  expiresAt: Date;
}

interface NfcDevice {
  id: string;
  stationId: string;
  operatorId: string;
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
  phoneInitiated?: boolean;
  result?: NfcBridgeResultInput;
  createdAt: Date;
  expiresAt: Date;
}

interface ReadSession {
  id: string;
  stationId: string;
  state: "PENDING" | "READING" | "COMPLETED" | "FAILED" | "CANCELLED";
  utility?: NfcUtilityInput;
  deviceId?: string;
  result?: NfcReadResultInput;
  createdAt: Date;
  expiresAt: Date;
}

interface VerificationSession {
  id: string;
  cardId: string;
  stationId: string;
  method: "QR_CAMERA" | "NFC_READ";
  expectedUrl: string;
  state: "PENDING" | "SCANNING" | "MATCHED" | "MISMATCH";
  deviceId?: string;
  result?: { scannedValue: string; uid?: string | undefined; errorCode?: string | undefined; deviceMetadata: Record<string, unknown> };
  expiresAt: Date;
}

const pairings = new Map<string, Pairing>();
const devices = new Map<string, NfcDevice>();
const sessions = new Map<string, BridgeSession>();
const readSessions = new Map<string, ReadSession>();
const verificationSessions = new Map<string, VerificationSession>();
const qrScans = new Map<string, { id: string; cardId: string; deviceId: string; expectedUrl: string; expiresAt: Date }>();

function prune() {
  const now = Date.now();
  for (const [code, pairing] of pairings) if (pairing.expiresAt.getTime() < now) pairings.delete(code);
  for (const [id, session] of sessions) if (session.expiresAt.getTime() < now) sessions.delete(id);
  for (const [id, session] of readSessions) {
    if (session.createdAt.getTime() < now - 60 * 60_000) readSessions.delete(id);
    else if (session.expiresAt.getTime() < now && ["PENDING", "READING"].includes(session.state)) session.state = "FAILED";
  }
  for (const [id, session] of verificationSessions) if (session.expiresAt.getTime() < now) verificationSessions.delete(id);
  for (const [id, scan] of qrScans) if (scan.expiresAt.getTime() < now) qrScans.delete(id);
}

async function deviceOperator(device: NfcDevice, qc = false) {
  const [operator] = await db.select().from(operators).where(and(eq(operators.id, device.operatorId), eq(operators.active, true))).limit(1);
  const roles = qc ? ["SUPER_ADMIN", "QUALITY_INSPECTOR"] : ["SUPER_ADMIN", "PRODUCTION_OPERATOR", "QUALITY_INSPECTOR"];
  if (!operator || !roles.includes(operator.role)) throw Object.assign(new Error(qc ? "Quality inspector role is required" : "Production operator role is required"), { statusCode: 403 });
  return { operatorId: operator.id, role: operator.role };
}

async function requireDevice(request: FastifyRequest): Promise<NfcDevice> {
  const token = request.headers["x-oneinfo-device-token"];
  if (typeof token !== "string") throw Object.assign(new Error("Missing NFC device token"), { statusCode: 401 });
  const device = [...devices.values()].find((candidate) => candidate.token === token);
  if (!device) throw Object.assign(new Error("Invalid NFC device token"), { statusCode: 401 });
  const [station] = await db.select({ id: productionStations.id }).from(productionStations)
    .where(and(eq(productionStations.id, device.stationId), eq(productionStations.status, "ACTIVE"))).limit(1);
  if (!station) {
    devices.delete(device.id);
    throw Object.assign(new Error("NFC station has been revoked"), { statusCode: 401 });
  }
  await deviceOperator(device);
  device.lastSeenAt = new Date();
  return device;
}

function assertStationIdle(stationId: string) {
  prune();
  const writing = [...sessions.values()].some((session) => session.stationId === stationId && ["PENDING", "WRITING"].includes(session.state));
  const reading = [...readSessions.values()].some((session) => session.stationId === stationId && ["PENDING", "READING"].includes(session.state));
  const verifying = [...verificationSessions.values()].some((session) => session.stationId === stationId && ["PENDING", "SCANNING"].includes(session.state));
  if (writing || reading || verifying) throw Object.assign(new Error("A phone operation is already pending. Complete it or wait for it to expire."), { statusCode: 409 });
}

function createUtility(stationId: string, utility: NfcUtilityInput, deviceId?: string) {
  assertStationIdle(stationId);
  const session: ReadSession = { id: randomUUID(), stationId, utility, state: deviceId ? "READING" : "PENDING",
    ...(deviceId ? { deviceId } : {}), createdAt: new Date(), expiresAt: new Date(Date.now() + 2 * 60_000) };
  readSessions.set(session.id, session);
  return session;
}

async function createVerification(stationId: string, input: { cardId: string; method: "QR_CAMERA" | "NFC_READ" }, deviceId?: string, id: string = randomUUID()) {
  const [card] = await db.select().from(cards).where(eq(cards.id, input.cardId)).limit(1);
  if (!card || card.qrStatus !== "GENERATED" || card.nfcStatus !== "WRITTEN") {
    throw Object.assign(new Error("Generate the QR and write the NFC tag before phone verification"), { statusCode: 409 });
  }
  assertStationIdle(stationId);
  const session: VerificationSession = { id, cardId: card.id, stationId,
    method: input.method, expectedUrl: card.canonicalUrl, state: deviceId ? "SCANNING" : "PENDING",
    ...(deviceId ? { deviceId } : {}), expiresAt: new Date(Date.now() + 2 * 60_000) };
  verificationSessions.set(session.id, session);
  return session;
}

export const localNfcRoutes: FastifyPluginAsync = async (app) => {
  app.get("/device/status", async (request) => {
    const device = await requireDevice(request);
    return { name: device.name, stationId: device.stationId };
  });
  app.post("/utility-sessions", async (request, reply) => {
    await requireOperator(request, ["SUPER_ADMIN", "PRODUCTION_OPERATOR", "QUALITY_INSPECTOR"]);
    const station = await requireStation(request);
    return sendCreated(reply, createUtility(station.stationId, parseBody(NfcUtilitySchema, request.body)));
  });

  app.post("/device/utility-sessions", async (request, reply) => {
    const device = await requireDevice(request);
    await deviceOperator(device);
    return sendCreated(reply, createUtility(device.stationId, parseBody(NfcUtilitySchema, request.body), device.id));
  });

  app.get("/utility-sessions", async (request) => {
    await requireOperator(request);
    const station = await requireStation(request);
    prune();
    return { items: [...readSessions.values()].filter((session) => session.stationId === station.stationId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 20) };
  });

  app.post("/utility-sessions/:sessionId/cancel", async (request) => {
    await requireOperator(request);
    const station = await requireStation(request);
    const { sessionId } = request.params as { sessionId: string };
    const session = readSessions.get(sessionId);
    if (!session || session.stationId !== station.stationId) throw Object.assign(new Error("Operation not found"), { statusCode: 404 });
    if (["PENDING", "READING"].includes(session.state)) session.state = "CANCELLED";
    return { state: session.state };
  });

  app.get("/device/read-tasks/:sessionId", async (request) => {
    const device = await requireDevice(request);
    prune();
    const { sessionId } = request.params as { sessionId: string };
    const session = readSessions.get(sessionId);
    if (!session || session.deviceId !== device.id || session.stationId !== device.stationId) throw Object.assign(new Error("Operation not found"), { statusCode: 404 });
    return { state: session.state };
  });

  app.post("/device/read-tasks/:sessionId/cancel", async (request) => {
    const device = await requireDevice(request);
    const { sessionId } = request.params as { sessionId: string };
    const session = readSessions.get(sessionId);
    if (!session || session.deviceId !== device.id || session.stationId !== device.stationId) throw Object.assign(new Error("Operation not found"), { statusCode: 404 });
    if (["PENDING", "READING"].includes(session.state)) session.state = "CANCELLED";
    return { state: session.state };
  });
  app.post("/pairings", async (request, reply) => {
    const operator = await requireOperator(request, ["SUPER_ADMIN", "PRODUCTION_OPERATOR", "QUALITY_INSPECTOR"]);
    const station = await requireStation(request);
    prune();
    let code = "";
    do code = String(randomInt(0, 1_000_000)).padStart(6, "0"); while (pairings.has(code));
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    pairings.set(code, { code, stationId: station.stationId, operatorId: operator.operatorId, expiresAt });
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
      operatorId: pairing.operatorId,
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

  app.post("/verification-sessions", async (request, reply) => {
    await requireOperator(request, ["SUPER_ADMIN", "PRODUCTION_OPERATOR", "QUALITY_INSPECTOR"]);
    const station = await requireStation(request);
    const input = parseBody(CreateVerificationSchema, request.body);
    return sendCreated(reply, await createVerification(station.stationId, input));
  });

  app.get("/device/cards", async (request) => {
    await requireDevice(request);
    const items = await db.select({ id: cards.id, publicSlug: cards.publicSlug, canonicalUrl: cards.canonicalUrl, batchCode: cardBatches.batchCode })
      .from(cards).innerJoin(cardBatches, eq(cardBatches.id, cards.batchId))
      .where(and(eq(cards.qrStatus, "GENERATED"), eq(cards.nfcStatus, "WRITTEN")))
      .orderBy(desc(cards.createdAt)).limit(1000);
    return { items };
  });

  app.post("/device/verification-sessions", async (request, reply) => {
    const device = await requireDevice(request);
    const input = parseBody(CreateVerificationSchema, request.body);
    const session = await createVerification(device.stationId, input, device.id);
    return sendCreated(reply, { ...session, sessionId: session.id });
  });

  app.post("/device/resolve-qr", async (request) => {
    const device = await requireDevice(request);
    const input = parseBody(StartQrVerificationSchema, request.body);
    prune();
    const existing = qrScans.get(input.scanId);
    if (existing && (existing.deviceId !== device.id || existing.expectedUrl !== input.scannedValue)) {
      throw Object.assign(new Error("Scan ID belongs to another operation"), { statusCode: 409 });
    }
    const [row] = await db.select({ card: cards, batchCode: cardBatches.batchCode }).from(cards)
      .innerJoin(cardBatches, eq(cardBatches.id, cards.batchId)).where(eq(cards.canonicalUrl, input.scannedValue)).limit(1);
    if (!row) throw Object.assign(new Error("This QR link is not registered in production"), { statusCode: 404 });
    if (row.card.qrStatus !== "GENERATED") throw Object.assign(new Error("Generate this card's QR before checking the print"), { statusCode: 409 });
    qrScans.set(input.scanId, { id: input.scanId, cardId: row.card.id, deviceId: device.id, expectedUrl: input.scannedValue,
      expiresAt: new Date(Date.now() + 10 * 60_000) });
    await db.insert(cardEvents).values({ id: input.scanId, cardId: row.card.id, eventType: "PRINT_QR_CHECKED", newState: "PRINT_CHECKED",
      actorId: device.operatorId, stationId: device.stationId, metadata: { scanId: input.scanId, scannedValue: input.scannedValue, batchId: row.card.batchId } }).onConflictDoNothing();
    return { scanId: input.scanId, cardId: row.card.id, publicSlug: row.card.publicSlug, batchId: row.card.batchId,
      batchCode: row.batchCode, expectedUrl: row.card.canonicalUrl, nfcStatus: row.card.nfcStatus, qcStatus: row.card.qcStatus };
  });

  app.post("/device/load-to-nfc", async (request, reply) => {
    const device = await requireDevice(request);
    const operator = await deviceOperator(device);
    const { scanId } = parseBody(ScanActionSchema, request.body);
    prune();
    const scan = qrScans.get(scanId);
    if (!scan || scan.deviceId !== device.id) throw Object.assign(new Error("Scan the printed QR again before loading NFC"), { statusCode: 404 });
    const existing = sessions.get(scanId);
    if (existing) {
      if (existing.deviceId !== device.id) throw Object.assign(new Error("Write belongs to another device"), { statusCode: 409 });
      return { ...existing, sessionId: existing.id };
    }
    assertStationIdle(device.stationId);
    const [card] = await db.select().from(cards).where(eq(cards.id, scan.cardId)).limit(1);
    if (!card || card.qrStatus !== "GENERATED" || card.nfcStatus === "WRITTEN" || card.qcStatus !== "PENDING" || card.lifecycleStatus !== "IN_PRODUCTION") {
      throw Object.assign(new Error("This card is not awaiting NFC encoding. Use final QC for a written card."), { statusCode: 409 });
    }
    const [job] = await db.select().from(productionJobs).where(and(eq(productionJobs.cardId, card.id), eq(productionJobs.type, "NFC_ENCODING"))).limit(1);
    if (!job) throw Object.assign(new Error("NFC production job not found"), { statusCode: 404 });
    await claimProductionJob(job.id, { idempotencyKey: scanId }, operator, device);
    assertStationIdle(device.stationId);
    const session: BridgeSession = { id: scanId, jobId: job.id, cardId: card.id, stationId: device.stationId, deviceId: device.id,
      expectedUrl: scan.expectedUrl, state: "WRITING", phoneInitiated: true, createdAt: new Date(), expiresAt: new Date(Date.now() + 3 * 60_000) };
    sessions.set(scanId, session);
    return sendCreated(reply, { ...session, sessionId: session.id });
  });

  app.post("/device/verification-tasks/:sessionId/approve", async (request, reply) => {
    const device = await requireDevice(request);
    const operator = await deviceOperator(device, true);
    prune();
    const { sessionId } = request.params as { sessionId: string };
    const session = verificationSessions.get(sessionId);
    if (!session || session.deviceId !== device.id || session.method !== "NFC_READ" || session.state !== "MATCHED") {
      throw Object.assign(new Error("Scan the QR and NFC again and match both links before approving QC"), { statusCode: 409 });
    }
    const [job] = await db.select().from(productionJobs).where(and(eq(productionJobs.cardId, session.cardId), eq(productionJobs.type, "QUALITY_CONTROL"))).limit(1);
    if (!job) throw Object.assign(new Error("QC production job not found"), { statusCode: 404 });
    if (job.status !== "COMPLETED") await claimProductionJob(job.id, { idempotencyKey: sessionId }, operator, device);
    const result = await saveQualityCheck(job.id, { idempotencyKey: sessionId, result: "PASSED", evidenceReference: `phone-scans://${sessionId}` }, operator, device, request.id);
    const [card] = await db.select({ inventoryStatus: cards.inventoryStatus }).from(cards).where(eq(cards.id, session.cardId));
    return sendCreated(reply, { ...result, qcStatus: "PASSED", inventoryStatus: card!.inventoryStatus });
  });

  app.post("/device/verification-from-qr", async (request, reply) => {
    const device = await requireDevice(request);
    const input = parseBody(StartQrVerificationSchema, request.body);
    prune();
    const existing = verificationSessions.get(input.scanId);
    if (existing) {
      if (existing.deviceId !== device.id || existing.expectedUrl !== input.scannedValue) throw Object.assign(new Error("Scan ID belongs to another operation"), { statusCode: 409 });
      return { ...existing, sessionId: existing.id };
    }
    const [card] = await db.select().from(cards).where(eq(cards.canonicalUrl, input.scannedValue)).limit(1);
    if (!card) throw Object.assign(new Error("This QR link is not registered in production"), { statusCode: 404 });
    const session = await createVerification(device.stationId, { cardId: card.id, method: "NFC_READ" }, device.id, input.scanId);
    try {
      await db.transaction(async (tx) => {
        const [saved] = await tx.insert(cardVerifications).values({ cardId: card.id, stationId: device.stationId,
          method: "QR_CAMERA", expectedUrl: card.canonicalUrl, scannedValue: input.scannedValue, matched: true,
          deviceMetadata: { deviceName: device.name, scanId: input.scanId },
        }).returning();
        await tx.insert(cardEvents).values({ cardId: card.id, eventType: "QR_CAMERA_MATCHED", stationId: device.stationId,
          newState: "VERIFIED", metadata: { verificationId: saved!.id, scannedValue: input.scannedValue } });
      });
    } catch (error) { verificationSessions.delete(session.id); throw error; }
    return sendCreated(reply, { ...session, sessionId: session.id, publicSlug: card.publicSlug });
  });

  app.get("/verification-sessions/:sessionId", async (request) => {
    await requireOperator(request);
    const station = await requireStation(request);
    prune();
    const { sessionId } = request.params as { sessionId: string };
    const session = verificationSessions.get(sessionId);
    if (!session || session.stationId !== station.stationId) throw Object.assign(new Error("Verification session expired or not found"), { statusCode: 404 });
    return session;
  });

  app.get("/device/verification-tasks/next", async (request) => {
    prune();
    const device = await requireDevice(request);
    const session = [...verificationSessions.values()].find((task) => task.stationId === device.stationId && task.state === "PENDING");
    if (!session) return { task: null };
    session.state = "SCANNING";
    session.deviceId = device.id;
    return { sessionId: session.id, method: session.method, expectedUrl: session.expectedUrl, expiresAt: session.expiresAt };
  });

  app.post("/device/verification-tasks/:sessionId/result", async (request) => {
    prune();
    const device = await requireDevice(request);
    const { sessionId } = request.params as { sessionId: string };
    const session = verificationSessions.get(sessionId);
    if (!session || session.deviceId !== device.id || session.stationId !== device.stationId) {
      throw Object.assign(new Error("Verification task is not assigned to this device"), { statusCode: 404 });
    }
    const input = parseBody(VerificationResultSchema, request.body);
    if (session.state !== "SCANNING") {
      if (JSON.stringify(session.result) === JSON.stringify(input)) return { accepted: true, state: session.state };
      throw Object.assign(new Error("Verification result is already finalized"), { statusCode: 409 });
    }
    const matched = !input.errorCode && input.scannedValue === session.expectedUrl;
    await db.transaction(async (tx) => {
      const [saved] = await tx.insert(cardVerifications).values({ id: session.id, cardId: session.cardId, stationId: session.stationId,
        method: session.method, expectedUrl: session.expectedUrl, scannedValue: input.scannedValue, matched, uid: input.uid,
        deviceMetadata: { ...input.deviceMetadata, scanId: session.id, deviceName: device.name, errorCode: input.errorCode ?? null },
      }).onConflictDoNothing().returning();
      if (saved) await tx.insert(cardEvents).values({ cardId: session.cardId, eventType: `${session.method}_${matched ? "MATCHED" : "MISMATCH"}`,
        stationId: session.stationId, newState: matched ? "VERIFIED" : "MISMATCH", metadata: { verificationId: session.id, scannedValue: input.scannedValue } });
    });
    session.result = input;
    session.state = matched ? "MATCHED" : "MISMATCH";
    return { accepted: true, state: session.state };
  });

  app.post("/sessions", async (request, reply) => {
    await requireOperator(request, ["SUPER_ADMIN", "PRODUCTION_OPERATOR", "QUALITY_INSPECTOR"]);
    const station = await requireStation(request);
    const input = parseBody(CreateNfcBridgeSessionSchema, request.body);
    assertStationIdle(station.stationId);
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
    assertStationIdle(station.stationId);
    sessions.set(session.id, session);
    return sendCreated(reply, session);
  });

  app.post("/read-sessions", async (request, reply) => {
    await requireOperator(request);
    const station = await requireStation(request);
    assertStationIdle(station.stationId);
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
    const device = await requireDevice(request);
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
    const device = await requireDevice(request);
    const task = [...readSessions.values()].find(
      (session) => session.stationId === device.stationId && session.state === "PENDING",
    );
    if (!task) return { task: null };
    task.state = "READING";
    task.deviceId = device.id;
    return { sessionId: task.id, expiresAt: task.expiresAt, utility: task.utility ?? { operation: "READ" } };
  });

  app.post("/device/tasks/:sessionId/result", async (request) => {
    prune();
    const device = await requireDevice(request);
    const { sessionId } = request.params as { sessionId: string };
    const session = sessions.get(sessionId);
    if (!session || session.stationId !== device.stationId || session.deviceId !== device.id) {
      throw Object.assign(new Error("NFC bridge task is not assigned to this device"), { statusCode: 404 });
    }
    const result = parseBody(NfcBridgeResultSchema, request.body);
    if (session.state !== "WRITING") {
      if (JSON.stringify(session.result) === JSON.stringify(result)) return { accepted: true, state: session.state };
      throw Object.assign(new Error("NFC result is already finalized"), { statusCode: 409 });
    }
    if (result.expectedUrl !== session.expectedUrl) {
      throw Object.assign(new Error("NFC device result URL does not match the bridge task"), { statusCode: 409 });
    }
    if (session.phoneInitiated) {
      const operator = await deviceOperator(device);
      await saveNfcAttempt(session.jobId, { idempotencyKey: session.id, result: result.result,
        expectedUrlHash: hashCredential(session.expectedUrl), ...(result.readbackUrl ? { readbackUrlHash: hashCredential(result.readbackUrl) } : {}),
        ...(result.errorCode ? { errorCode: result.errorCode } : {}), deviceMetadata: { ...result.deviceMetadata, scanId: session.id } }, operator, device);
    }
    session.result = result;
    session.state = result.result;
    return { accepted: true, state: session.state };
  });

  app.post("/device/read-tasks/:sessionId/result", async (request) => {
    prune();
    const device = await requireDevice(request);
    const { sessionId } = request.params as { sessionId: string };
    const session = readSessions.get(sessionId);
    if (!session || session.stationId !== device.stationId || session.deviceId !== device.id) {
      throw Object.assign(new Error("NFC read task is not assigned to this device"), { statusCode: 404 });
    }
    let result = parseBody(NfcReadResultSchema, request.body);
    if (!result.errorCode && session.utility?.operation === "ERASE") {
      const record = result.records[0];
      const empty = result.ndefFormatted && (result.records.length === 0 || (result.records.length === 1 && record?.tnf === 0 &&
        record.type === "" && record.payloadHex === "" && record.idHex === "" && !record.uri && !record.payloadText));
      if (!empty) result = { ...result, errorCode: "ERASE_READBACK_MISMATCH" };
    }
    if (!result.errorCode && session.utility?.operation === "WRITE") {
      const record = result.records[0];
      const value = session.utility.recordType === "URL" ? record?.uri : record?.payloadText;
      if (result.records.length !== 1 || value !== session.utility.value) result = { ...result, errorCode: "READBACK_MISMATCH" };
    }
    if (session.state !== "READING") {
      if (JSON.stringify(session.result) === JSON.stringify(result)) return { accepted: true, state: session.state };
      throw Object.assign(new Error("NFC result is already finalized"), { statusCode: 409 });
    }
    session.result = result;
    session.state = result.errorCode ? "FAILED" : "COMPLETED";
    return { accepted: true, state: session.state };
  });
};

function replyNoContent() {
  return { task: null };
}
