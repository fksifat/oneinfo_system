import { adminPage } from "../domain/admin-page.js";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireOperator } from "../auth.js";
import { db } from "../db/client.js";
import { auditLogs, products, storeOrders, storeReviewInvites, storeReviews } from "../db/schema.js";
import { parseBody } from "../http.js";
import { sendReviewInvitation } from "../domain/review-invitation.js";
import { queueOrderEmail } from "../domain/order-email-history.js";
import { dispatchOrderEmail, reviewTokenHash } from "../domain/order-email-worker.js";

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const tokenSchema = z.object({ token: z.string().min(40).max(100) });
const reviewSeen = sql<boolean>`(${storeReviews.status} <> 'PENDING' or exists (
  select 1 from ${auditLogs} a where a.target_type = 'store_review' and a.target_id = ${storeReviews.id}::text
    and a.action = 'STORE_REVIEW_SEEN' and a.created_at >= ${storeReviews.updatedAt}
))`;

export const reviewRoutes: FastifyPluginAsync = async app => {
  app.get("/products/:slug", async (request, reply) => {
    const { slug } = parseBody(z.object({ slug: z.string().min(1).max(100) }), request.params);
    const [product] = await db.select({ id: products.id }).from(products).where(and(eq(products.slug, slug), eq(products.status, "PUBLISHED")));
    reply.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    if (!product) return reply.code(404).send({ items: [], count: 0, average: 0 });
    const [summary] = await db.select({ count: sql<number>`count(*)::int`, average: sql<number>`coalesce(avg(${storeReviews.rating}), 0)::float8` })
      .from(storeReviews).where(and(eq(storeReviews.productId, product.id), eq(storeReviews.status, "PUBLISHED")));
    const items = await db.select({ id: storeReviews.id, displayName: storeReviews.displayName, rating: storeReviews.rating,
      title: storeReviews.title, body: storeReviews.body, createdAt: storeReviews.createdAt })
      .from(storeReviews).where(and(eq(storeReviews.productId, product.id), eq(storeReviews.status, "PUBLISHED")))
      .orderBy(desc(storeReviews.createdAt)).limit(50);
    return { items, count: summary?.count ?? 0, average: summary?.average ?? 0 };
  });

  app.get("/admin", async request => {
    await requireOperator(request, ["SUPER_ADMIN"]);
    const { page, query } = adminPage(request.query);
    const { inbox } = parseBody(z.object({ inbox: z.enum(["new", "low", "seen"]).optional() }), request.query);
    const items = await db.select({ id: storeReviews.id, orderId: storeReviews.orderId, productId: storeReviews.productId,
      productName: products.name, displayName: storeReviews.displayName, rating: storeReviews.rating, title: storeReviews.title,
      body: storeReviews.body, status: storeReviews.status, createdAt: storeReviews.createdAt, seen: reviewSeen })
      .from(storeReviews).innerJoin(products, eq(products.id, storeReviews.productId))
      .where(and(sql`position(lower(${query}) in lower(${storeReviews.displayName} || ' ' || ${storeReviews.title} || ' ' || ${storeReviews.status} || ' ' || ${products.name} || ' ' || ${storeReviews.orderId}::text)) > 0`,
        inbox === "new" ? sql`not ${reviewSeen}` : inbox === "seen" ? reviewSeen : inbox === "low" ? sql`${storeReviews.rating} <= 2` : undefined))
      .orderBy(desc(storeReviews.createdAt), desc(storeReviews.id)).limit(101).offset((page - 1) * 100);
    return { items: items.slice(0, 100), hasMore: items.length > 100 };
  });

  app.post("/admin/:id/seen", async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN"]);
    const { id } = parseBody(z.object({ id: z.uuid() }), request.params);
    return db.transaction(async tx => {
      const [review] = await tx.select({ seen: reviewSeen }).from(storeReviews).where(eq(storeReviews.id, id)).for("update");
      if (!review) throw Object.assign(new Error("Review not found"), { statusCode: 404 });
      if (!review.seen) await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: "STORE_REVIEW_SEEN",
        targetType: "store_review", targetId: id, requestId: request.id, createdAt: sql`clock_timestamp()` });
      return { seen: true };
    });
  });

  app.patch("/admin/:id", async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN"]);
    const { id } = parseBody(z.object({ id: z.uuid() }), request.params);
    const { status } = parseBody(z.object({ status: z.enum(["PUBLISHED", "REJECTED"]) }), request.body);
    return db.transaction(async tx => {
      const [updated] = await tx.update(storeReviews).set({ status, updatedAt: new Date() }).where(eq(storeReviews.id, id)).returning();
      if (!updated) throw Object.assign(new Error("Review not found"), { statusCode: 404 });
      await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: `STORE_REVIEW_${status}`, targetType: "store_review", targetId: id, requestId: request.id, metadata: { productId: updated.productId, orderId: updated.orderId } });
      return { id, status };
    });
  });

  app.post("/admin/orders/:id/deliver", async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN"]);
    const { id } = parseBody(z.object({ id: z.uuid() }), request.params);
    await db.transaction(async tx => {
      const [order] = await tx.select().from(storeOrders).where(eq(storeOrders.id, id)).for("update");
      if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });
      if (order.cancelledAt || order.awaitingPayment) throw Object.assign(new Error("Only an open order can be delivered"), { statusCode: 409 });
      if (order.paymentAmountMinor > 0 && !order.paymentVerifiedAt) throw Object.assign(new Error("Verify the order payment before marking it delivered"), { statusCode: 409 });
      const [existing] = await tx.select().from(storeReviewInvites).where(eq(storeReviewInvites.orderId, id));
      if (existing?.sentAt) return;
      const tokenHash = reviewTokenHash(id);
      if (existing) await tx.update(storeReviewInvites).set({ tokenHash }).where(eq(storeReviewInvites.id, existing.id));
      else await tx.insert(storeReviewInvites).values({ orderId: id, tokenHash });
      if (!order.deliveredAt) {
        await tx.update(storeOrders).set({ deliveredAt: new Date() }).where(eq(storeOrders.id, id));
        await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: "STORE_ORDER_MARKED_DELIVERED", targetType: "store_order", targetId: id, requestId: request.id, metadata: {} });
      }
      await queueOrderEmail(tx, id, "delivery");
    });
    const sent = await dispatchOrderEmail(id, "delivery", true);
    return { delivered: true, invitation: sent === "accepted" ? "sent" : "pending" };
  });

  app.post("/portal", { bodyLimit: 1024 }, async request => {
    const { token } = parseBody(tokenSchema, request.body);
    const [invite] = await db.select().from(storeReviewInvites).where(eq(storeReviewInvites.tokenHash, tokenHash(token)));
    if (!invite?.sentAt) throw Object.assign(new Error("This review link is invalid or not active"), { statusCode: 404 });
    const [order] = await db.select().from(storeOrders).where(eq(storeOrders.id, invite.orderId));
    if (!order?.deliveredAt) throw Object.assign(new Error("Reviews are available after delivery"), { statusCode: 409 });
    const ids = order.items.map(item => item.productId);
    const purchased = ids.length ? await db.select({ id: products.id, slug: products.slug, name: products.name }).from(products).where(and(inArray(products.id, ids), eq(products.status, "PUBLISHED"))) : [];
    const own = await db.select().from(storeReviews).where(eq(storeReviews.orderId, order.id));
    return { products: purchased.map(product => ({ ...product, review: own.find(review => review.productId === product.id) ?? null })) };
  });

  app.post("/portal/reviews", { bodyLimit: 4096 }, async request => {
    const input = parseBody(tokenSchema.extend({ productId: z.uuid(), displayName: z.string().trim().min(1).max(60), rating: z.number().int().min(1).max(5), title: z.string().trim().min(1).max(100), body: z.string().trim().min(5).max(1200) }), request.body);
    const [invite] = await db.select().from(storeReviewInvites).where(eq(storeReviewInvites.tokenHash, tokenHash(input.token)));
    if (!invite?.sentAt) throw Object.assign(new Error("This review link is invalid or not active"), { statusCode: 404 });
    const [order] = await db.select().from(storeOrders).where(eq(storeOrders.id, invite.orderId));
    if (!order?.deliveredAt || !order.items.some(item => item.productId === input.productId)) throw Object.assign(new Error("You can only review products from this delivered order"), { statusCode: 403 });
    const [product] = await db.select({ id: products.id }).from(products).where(and(eq(products.id, input.productId), eq(products.status, "PUBLISHED")));
    if (!product) throw Object.assign(new Error("Product not found"), { statusCode: 404 });
    const [review] = await db.insert(storeReviews).values({ orderId: order.id, productId: input.productId, displayName: input.displayName, rating: input.rating, title: input.title, body: input.body })
      .onConflictDoUpdate({ target: [storeReviews.orderId, storeReviews.productId], set: { displayName: input.displayName, rating: input.rating, title: input.title, body: input.body, status: "PENDING", updatedAt: new Date() } }).returning();
    if (!review) throw new Error("Review could not be saved");
    return { id: review.id, status: review.status };
  });

  app.delete("/portal/reviews", { bodyLimit: 1024 }, async request => {
    const input = parseBody(tokenSchema.extend({ productId: z.uuid() }), request.body);
    const [invite] = await db.select().from(storeReviewInvites).where(eq(storeReviewInvites.tokenHash, tokenHash(input.token)));
    if (!invite?.sentAt) throw Object.assign(new Error("This review link is invalid or not active"), { statusCode: 404 });
    const [order] = await db.select().from(storeOrders).where(eq(storeOrders.id, invite.orderId));
    if (!order?.deliveredAt || !order.items.some(item => item.productId === input.productId)) throw Object.assign(new Error("This product is not part of your delivered order"), { statusCode: 403 });
    await db.delete(storeReviews).where(and(eq(storeReviews.orderId, order.id), eq(storeReviews.productId, input.productId)));
    return { deleted: true };
  });
};
