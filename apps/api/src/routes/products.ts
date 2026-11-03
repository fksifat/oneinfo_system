import type { FastifyPluginAsync } from "fastify";
import { ProductInputSchema, UpdateProductSchema, type ProductInput } from "@oneinfo/contracts";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { requireOperator } from "../auth.js";
import { db } from "../db/client.js";
import { products, auditLogs } from "../db/schema.js";
import { parseBody, sendCreated } from "../http.js";

// Keep legacy columns populated while variant pricing becomes the source of truth.
function productValues(input: ProductInput) {
  const first = input.variants[0]!;
  return { ...input, priceMinor: first.priceMinor, finish: first.finish, appearance: first.appearance, imageUrl: first.imageUrl };
}

export const productRoutes: FastifyPluginAsync = async app => {
  app.get("/public", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    const items = await db.select().from(products).where(eq(products.status, "PUBLISHED"))
      .orderBy(asc(products.sortOrder), asc(products.name), asc(products.id));
    return { items };
  });
  app.get("/", async request => {
    await requireOperator(request, ["SUPER_ADMIN", "AUDITOR"]);
    return { items: await db.select().from(products).orderBy(asc(products.sortOrder), asc(products.name), asc(products.id)) };
  });
  app.post("/", async (request, reply) => {
    const actor = await requireOperator(request, ["SUPER_ADMIN"]);
    const input = parseBody(ProductInputSchema, request.body);
    const product = await db.transaction(async tx => {
      const [created] = await tx.insert(products).values(productValues(input)).onConflictDoNothing({ target: products.slug }).returning();
      if (!created) throw Object.assign(new Error("This product slug already exists"), { statusCode: 409 });
      await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: "PRODUCT_CREATED", targetType: "product", targetId: created.id, requestId: request.id, metadata: { status: created.status } });
      return created;
    });
    return sendCreated(reply, product);
  });
  app.put("/:productId", async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN"]);
    const { productId } = parseBody(z.object({ productId: z.uuid() }), request.params);
    const { version, ...input } = parseBody(UpdateProductSchema, request.body);
    try {
      return await db.transaction(async tx => {
        const [updated] = await tx.update(products).set({ ...productValues(input), version: version + 1, updatedAt: new Date() })
          .where(and(eq(products.id, productId), eq(products.version, version))).returning();
        if (!updated) {
          const [existing] = await tx.select({ id: products.id }).from(products).where(eq(products.id, productId));
          throw Object.assign(new Error(existing ? "This product changed elsewhere. Reload it before saving." : "Product not found"), { statusCode: existing ? 409 : 404 });
        }
        await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: "PRODUCT_UPDATED", targetType: "product", targetId: productId, requestId: request.id, metadata: { status: updated.status, featured: updated.featured, version: updated.version } });
        return updated;
      });
    } catch (error) {
      const cause = error as { code?: string; cause?: { code?: string } };
      if (cause.code === "23505" || cause.cause?.code === "23505") throw Object.assign(new Error("This product slug already exists"), { statusCode: 409 });
      throw error;
    }
  });
};
