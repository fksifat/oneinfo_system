import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { printFinish } from "@oneinfo/contracts";
import { z } from "zod";
import { requireOperator } from "../auth.js";
import { db } from "../db/client.js";
import { cardBatches, cards, orderCardAllocations, products, storeOrders } from "../db/schema.js";
import { confirmPrintedBatch, createProductionBatch, generateCardQr } from "../domain/batch-print.js";
import { lockPrintedStock, reserveCardForOrder } from "../domain/printed-stock.js";
import { parseBody } from "../http.js";

export function registerOrderPrint(app: FastifyInstance) {
  app.post("/admin/:id/card-print", async request => {
    const operator = await requireOperator(request, ["SUPER_ADMIN"]);
    const { id } = parseBody(z.object({ id: z.uuid() }), request.params);
    const { lineIndex, unitIndex, action } = parseBody(z.object({
      lineIndex: z.number().int().nonnegative(), unitIndex: z.number().int().nonnegative(),
      action: z.enum(["prepare", "confirm"]),
    }), request.body);
    const conflict = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 409 }); };

    return db.transaction(async tx => {
      await lockPrintedStock(tx);
      const [order] = await tx.select().from(storeOrders).where(eq(storeOrders.id, id)).for("update");
      if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });
      if (order.invoiceNumber) conflict("Pick ready cards from stock and scan them in the packing checklist.");
      const line = order.items[lineIndex];
      if (!line || unitIndex >= line.quantity) conflict("This card is not part of the order.");
      const [allocated] = await tx.select({ card: cards, batch: cardBatches }).from(orderCardAllocations)
        .innerJoin(cards, eq(cards.id, orderCardAllocations.cardId)).innerJoin(cardBatches, eq(cardBatches.id, cards.batchId))
        .where(and(eq(orderCardAllocations.orderId, id), eq(orderCardAllocations.lineIndex, lineIndex), eq(orderCardAllocations.unitIndex, unitIndex)));
      if (allocated?.batch.printConfirmedAt) return { printed: true };
      if (order.cancelledAt || order.awaitingPayment || order.shippedAt || order.deliveredAt) conflict("Only open orders can prepare cards for printing.");
      if (order.paymentAmountMinor > 0 && !order.paymentVerifiedAt) conflict("Verify the order payment before preparing cards.");
      if (action === "confirm") {
        if (!allocated || allocated.batch.plannedQuantity !== 1) return conflict("Prepare this card before confirming its print.");
        await confirmPrintedBatch(tx, allocated.batch.id, operator.operatorId, request.id);
        return { printed: true };
      }

      const [product] = await tx.select({ slug: products.slug, variants: products.variants }).from(products).where(eq(products.id, line!.productId));
      const finish = printFinish(product?.slug ?? "", product?.variants.find(variant => variant.id === line!.variantId)?.appearance);
      if (!finish) {
        return conflict("No print artwork is configured for this variant. Configure its back artwork, print dimensions, and QR position before downloading.");
      }
      let card = allocated?.card;
      if (!card) {
        const batch = await createProductionBatch(tx, {
          batchCode: `ORDER-${id}-${lineIndex + 1}-${unitIndex + 1}`,
          productVariantId: line!.variantId, quantity: 1,
        }, operator.operatorId, request.id);
        [card] = await tx.select().from(cards).where(eq(cards.batchId, batch!.id));
        if (!card) throw new Error("Card could not be reserved");
        await reserveCardForOrder(tx, id, card, { lineIndex, unitIndex });
      }
      const { imageData } = await generateCardQr(tx, card, operator.operatorId);
      return { printed: false, finish, imageData, publicSlug: card.publicSlug };
    });
  });
}
