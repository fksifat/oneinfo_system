import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { CreateBatchSchema } from "@oneinfo/contracts";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { requireOperator } from "../auth.js";
import { db } from "../db/client.js";
import { auditLogs, cardBatches, cardEvents, cards, productionJobs } from "../db/schema.js";
import { parseBody, sendCreated } from "../http.js";

function makePublicSlug(): string {
  return randomBytes(9).toString("base64url");
}

export const batchRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", async (request, reply) => {
    const operator = await requireOperator(request, ["SUPER_ADMIN"]);
    const input = parseBody(CreateBatchSchema, request.body);
    const batchId = randomUUID();

    const result = await db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(cardBatches)
        .values({
          id: batchId,
          batchCode: input.batchCode,
          productVariantId: input.productVariantId,
          plannedQuantity: input.quantity,
          createdBy: operator.operatorId,
        })
        .returning();

      for (let index = 0; index < input.quantity; index += 1) {
        const cardId = randomUUID();
        const publicSlug = makePublicSlug();
        const canonicalUrl = `${config.PUBLIC_CARD_BASE_URL.replace(/\/$/, "")}/${publicSlug}`;
        await tx.insert(cards).values({ id: cardId, batchId, publicSlug, canonicalUrl });
        await tx.insert(productionJobs).values([
          { batchId, cardId, type: "QR_GENERATION" },
          { batchId, cardId, type: "NFC_ENCODING" },
          { batchId, cardId, type: "QUALITY_CONTROL" },
        ]);
        await tx.insert(cardEvents).values({
          cardId,
          eventType: "CARD_CREATED",
          newState: "CREATED",
          actorId: operator.operatorId,
          metadata: { batchId, sequence: index + 1 },
        });
      }

      await tx.insert(auditLogs).values({
        actorId: operator.operatorId,
        action: "BATCH_CREATED",
        targetType: "card_batch",
        targetId: batchId,
        requestId: request.id,
        metadata: { quantity: input.quantity },
      });
      return batch;
    });

    return sendCreated(reply, result);
  });

  app.get("/:batchId", async (request) => {
    await requireOperator(request);
    const { batchId } = request.params as { batchId: string };
    const [batch] = await db.select().from(cardBatches).where(eq(cardBatches.id, batchId)).limit(1);
    if (!batch) throw Object.assign(new Error("Batch not found"), { statusCode: 404 });
    const batchCards = await db.select().from(cards).where(eq(cards.batchId, batchId));
    return { ...batch, cards: batchCards };
  });
};
