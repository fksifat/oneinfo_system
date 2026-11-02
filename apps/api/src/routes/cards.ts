import type { FastifyPluginAsync } from "fastify";
import { asc, eq } from "drizzle-orm";
import { requireOperator } from "../auth.js";
import { db } from "../db/client.js";
import { cardEvents, cards } from "../db/schema.js";

export const cardRoutes: FastifyPluginAsync = async (app) => {
  app.get("/:cardId/history", async (request) => {
    await requireOperator(request);
    const { cardId } = request.params as { cardId: string };
    const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
    if (!card) throw Object.assign(new Error("Card not found"), { statusCode: 404 });
    const events = await db
      .select()
      .from(cardEvents)
      .where(eq(cardEvents.cardId, cardId))
      .orderBy(asc(cardEvents.createdAt));
    return { card, events };
  });
};
