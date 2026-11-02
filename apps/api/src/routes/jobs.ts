import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  ClaimJobSchema,
  NfcAttemptSchema,
  QrResultSchema,
  QualityCheckSchema,
} from "@oneinfo/contracts";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { requireOperator, requireStation } from "../auth.js";
import { db } from "../db/client.js";
import {
  auditLogs,
  cardEvents,
  cards,
  nfcEncodingAttempts,
  productionJobs,
  qrArtifacts,
  qualityChecks,
} from "../db/schema.js";
import { canPassQualityControl, nextNfcJobStatus } from "../domain/workflow.js";
import { parseBody, sendCreated } from "../http.js";

async function identities(request: FastifyRequest) {
  const [operator, station] = await Promise.all([requireOperator(request), requireStation(request)]);
  return { operator, station };
}

async function getAssignedJob(jobId: string, stationId: string) {
  const [row] = await db
    .select({ job: productionJobs, card: cards })
    .from(productionJobs)
    .innerJoin(cards, eq(cards.id, productionJobs.cardId))
    .where(and(eq(productionJobs.id, jobId), eq(productionJobs.assignedStationId, stationId)))
    .limit(1);
  if (!row) throw Object.assign(new Error("Assigned job not found"), { statusCode: 404 });
  return row;
}

export const jobRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request) => {
    const { station } = await identities(request);
    const query = request.query as { status?: string; type?: string };
    const allowedStatuses = ["QUEUED", "CLAIMED", "RETRYABLE_FAILURE"] as const;
    const status = allowedStatuses.find((value) => value === query.status);

    const rows = await db
      .select({ job: productionJobs, card: cards })
      .from(productionJobs)
      .innerJoin(cards, eq(cards.id, productionJobs.cardId))
      .where(
        and(
          status ? eq(productionJobs.status, status) : inArray(productionJobs.status, [...allowedStatuses]),
          or(
            and(eq(productionJobs.status, "QUEUED"), eq(productionJobs.assignedStationId, station.stationId)),
            and(eq(productionJobs.status, "QUEUED"), isNull(productionJobs.assignedStationId)),
            eq(productionJobs.assignedStationId, station.stationId),
          ),
          query.type && ["QR_GENERATION", "NFC_ENCODING", "QUALITY_CONTROL"].includes(query.type)
            ? eq(productionJobs.type, query.type as "QR_GENERATION" | "NFC_ENCODING" | "QUALITY_CONTROL")
            : undefined,
        ),
      )
      .limit(200);
    return { items: rows, count: rows.length };
  });

  app.get("/:jobId", async (request) => {
    const { station } = await identities(request);
    const { jobId } = request.params as { jobId: string };
    return getAssignedJob(jobId, station.stationId);
  });

  app.post("/:jobId/claim", async (request) => {
    const { operator, station } = await identities(request);
    const { jobId } = request.params as { jobId: string };
    const input = parseBody(ClaimJobSchema, request.body);
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + 15 * 60_000);

    const [claimed] = await db
      .update(productionJobs)
      .set({
        status: "CLAIMED",
        assignedStationId: station.stationId,
        claimedBy: operator.operatorId,
        claimIdempotencyKey: input.idempotencyKey,
        claimedAt: now,
        leaseExpiresAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(productionJobs.id, jobId),
          inArray(productionJobs.status, ["QUEUED", "RETRYABLE_FAILURE"]),
          or(eq(productionJobs.assignedStationId, station.stationId), isNull(productionJobs.assignedStationId)),
        ),
      )
      .returning();

    if (!claimed) {
      const [idempotent] = await db
        .select()
        .from(productionJobs)
        .where(
          and(
            eq(productionJobs.id, jobId),
            eq(productionJobs.claimIdempotencyKey, input.idempotencyKey),
            eq(productionJobs.assignedStationId, station.stationId),
          ),
        )
        .limit(1);
      if (idempotent) return { job: idempotent, replayed: true };
      throw Object.assign(new Error("Job is not claimable by this station"), { statusCode: 409 });
    }

    const [card] = await db.select().from(cards).where(eq(cards.id, claimed.cardId)).limit(1);
    return { job: claimed, card, replayed: false };
  });

  app.post("/:jobId/qr-results", async (request, reply) => {
    const { operator, station } = await identities(request);
    const { jobId } = request.params as { jobId: string };
    const input = parseBody(QrResultSchema, request.body);
    const { job, card } = await getAssignedJob(jobId, station.stationId);
    if (job.type !== "QR_GENERATION") throw Object.assign(new Error("Job is not a QR job"), { statusCode: 409 });

    const [existing] = await db.select().from(qrArtifacts).where(eq(qrArtifacts.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existing) return { artifact: existing, replayed: true };

    const artifact = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(qrArtifacts)
        .values({
          jobId,
          cardId: card.id,
          idempotencyKey: input.idempotencyKey,
          format: input.format,
          storageKey: input.storageKey,
          checksumSha256: input.checksumSha256,
          width: input.width,
          height: input.height,
          generatorVersion: input.generatorVersion,
        })
        .returning();
      await tx.update(productionJobs).set({ status: "COMPLETED", completedAt: new Date(), updatedAt: new Date() }).where(eq(productionJobs.id, jobId));
      await tx.update(cards).set({ qrStatus: "GENERATED", lifecycleStatus: "IN_PRODUCTION", updatedAt: new Date() }).where(eq(cards.id, card.id));
      await tx.insert(cardEvents).values({
        cardId: card.id,
        eventType: "QR_GENERATED",
        previousState: card.qrStatus,
        newState: "GENERATED",
        actorId: operator.operatorId,
        stationId: station.stationId,
        metadata: { checksumSha256: input.checksumSha256, format: input.format },
      });
      return created;
    });
    return sendCreated(reply, { artifact, replayed: false });
  });

  app.post("/:jobId/nfc-attempts", async (request, reply) => {
    const { operator, station } = await identities(request);
    const { jobId } = request.params as { jobId: string };
    const input = parseBody(NfcAttemptSchema, request.body);
    const { job, card } = await getAssignedJob(jobId, station.stationId);
    if (job.type !== "NFC_ENCODING") throw Object.assign(new Error("Job is not an NFC job"), { statusCode: 409 });

    const [existing] = await db
      .select()
      .from(nfcEncodingAttempts)
      .where(eq(nfcEncodingAttempts.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing) return { attempt: existing, replayed: true };

    const attempt = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(nfcEncodingAttempts)
        .values({
          jobId,
          cardId: card.id,
          stationId: station.stationId,
          operatorId: operator.operatorId,
          idempotencyKey: input.idempotencyKey,
          result: input.result,
          expectedUrlHash: input.expectedUrlHash,
          readbackUrlHash: input.readbackUrlHash,
          errorCode: input.errorCode,
          deviceMetadata: input.deviceMetadata,
        })
        .returning();
      const succeeded = input.result === "SUCCEEDED";
      await tx
        .update(productionJobs)
        .set({
          status: nextNfcJobStatus(input.result),
          completedAt: succeeded ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(productionJobs.id, jobId));
      if (succeeded) {
        await tx.update(cards).set({ nfcStatus: "WRITTEN", lifecycleStatus: "IN_PRODUCTION", updatedAt: new Date() }).where(eq(cards.id, card.id));
      }
      await tx.insert(cardEvents).values({
        cardId: card.id,
        eventType: succeeded ? "NFC_VERIFIED" : "NFC_ATTEMPT_FAILED",
        previousState: card.nfcStatus,
        newState: succeeded ? "WRITTEN" : card.nfcStatus,
        actorId: operator.operatorId,
        stationId: station.stationId,
        metadata: { attemptId: created?.id, errorCode: input.errorCode ?? null },
      });
      return created;
    });
    return sendCreated(reply, { attempt, replayed: false });
  });

  app.post("/:jobId/quality-checks", async (request, reply) => {
    const { operator, station } = await identities(request);
    if (!["SUPER_ADMIN", "QUALITY_INSPECTOR"].includes(operator.role)) {
      throw Object.assign(new Error("Quality inspector role is required"), { statusCode: 403 });
    }
    const { jobId } = request.params as { jobId: string };
    const input = parseBody(QualityCheckSchema, request.body);
    const { job, card } = await getAssignedJob(jobId, station.stationId);
    if (job.type !== "QUALITY_CONTROL") throw Object.assign(new Error("Job is not a quality-control job"), { statusCode: 409 });
    if (input.result === "PASSED" && !canPassQualityControl(card.qrStatus, card.nfcStatus)) {
      throw Object.assign(new Error("QR generation and verified NFC encoding are required before QC can pass"), { statusCode: 409 });
    }

    const [existing] = await db.select().from(qualityChecks).where(eq(qualityChecks.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existing) return { qualityCheck: existing, replayed: true };

    const qualityCheck = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(qualityChecks)
        .values({
          jobId,
          cardId: card.id,
          inspectorId: operator.operatorId,
          idempotencyKey: input.idempotencyKey,
          result: input.result,
          reason: input.reason,
          evidenceReference: input.evidenceReference,
        })
        .returning();
      const passed = input.result === "PASSED";
      await tx.update(productionJobs).set({ status: "COMPLETED", completedAt: new Date(), updatedAt: new Date() }).where(eq(productionJobs.id, jobId));
      await tx
        .update(cards)
        .set({
          qcStatus: passed ? "PASSED" : "FAILED",
          lifecycleStatus: passed ? "QC_PASSED" : "QUARANTINED",
          inventoryStatus: passed ? "SALEABLE" : "NOT_READY",
          updatedAt: new Date(),
        })
        .where(eq(cards.id, card.id));
      await tx.insert(cardEvents).values({
        cardId: card.id,
        eventType: passed ? "QC_PASSED" : "QC_FAILED",
        previousState: card.lifecycleStatus,
        newState: passed ? "QC_PASSED" : "QUARANTINED",
        actorId: operator.operatorId,
        stationId: station.stationId,
        metadata: { reason: input.reason ?? null, evidenceReference: input.evidenceReference ?? null },
      });
      await tx.insert(auditLogs).values({
        actorId: operator.operatorId,
        action: passed ? "QUALITY_CHECK_PASSED" : "QUALITY_CHECK_FAILED",
        targetType: "card",
        targetId: card.id,
        stationId: station.stationId,
        requestId: request.id,
      });
      return created;
    });
    return sendCreated(reply, { qualityCheck, replayed: false });
  });
};
