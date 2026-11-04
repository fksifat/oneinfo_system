import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  bkashNumber, CodAdvanceSchema, defaultCodAdvanceTaka, paymentDueNow, CouponCodeSchema, couponDiscount, checkoutDeliveryZone, defaultShippingRates, deliveryZone, PlaceOrderSchema,
  ShippingRatesSchema, StoreCouponSchema, variantPrice,
  type OrderReceipt,
} from "@oneinfo/contracts";
import { requireOperator } from "../auth.js";
import { db } from "../db/client.js";
import { auditLogs, products, storeCoupons, storeOrders, storeShippingSettings } from "../db/schema.js";
import { confirmationEmailEnabled, sendOrderConfirmation } from "../domain/order-confirmation.js";
import { parseBody, sendCreated } from "../http.js";

const shippingSettingsId = "default";

async function readCheckoutSettings(client: Pick<typeof db, "select"> = db) {
  const [settings] = await client.select().from(storeShippingSettings).where(eq(storeShippingSettings.id, shippingSettingsId));
  return { rates: settings?.rates ?? defaultShippingRates, codAdvanceTaka: settings?.codAdvanceTaka ?? defaultCodAdvanceTaka };
}

function receipt(order: typeof storeOrders.$inferSelect): OrderReceipt {
  const { id, shippingZone, subtotalMinor, shippingMinor, couponCode, discountMinor, createdAt } = order;
  const { paymentMethod, paymentAmountMinor, paymentVerifiedAt } = order;
  return { id, paymentMethod, paymentAmountMinor,
    ...(paymentAmountMinor > 0 && { paymentStatus: paymentVerifiedAt ? "VERIFIED" : "PENDING_VERIFICATION" }),
    status: "RECEIVED", shippingZone, subtotalMinor, shippingMinor,
    couponCode, discountMinor, totalMinor: subtotalMinor + shippingMinor - discountMinor, createdAt: createdAt.toISOString() };
}

function conflict(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 409 });
}

export const orderRoutes: FastifyPluginAsync = async app => {
  app.post("/coupon", { bodyLimit: 1024 }, async (request, reply) => {
    const { code } = parseBody(z.object({ code: CouponCodeSchema }), request.body);
    const [coupon] = await db.select().from(storeCoupons).where(eq(storeCoupons.code, code));
    reply.header("Cache-Control", "no-store");
    if (!coupon?.active) return reply.code(404).send({ message: "This coupon is invalid or inactive." });
    return { code, percent: coupon.percent };
  });

  app.get("/admin/coupons", async (request, reply) => {
    await requireOperator(request, ["SUPER_ADMIN"]);
    reply.header("Cache-Control", "no-store");
    return { items: await db.select().from(storeCoupons).orderBy(storeCoupons.code) };
  });

  app.put("/admin/coupons", async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN"]);
    const coupon = parseBody(StoreCouponSchema, request.body);
    await db.transaction(async tx => {
      await tx.insert(storeCoupons).values(coupon).onConflictDoUpdate({
        target: storeCoupons.code, set: { percent: coupon.percent, active: coupon.active },
      });
      await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: "STORE_COUPON_UPDATED",
        targetType: "store_coupon", targetId: coupon.code, requestId: request.id,
        metadata: { percent: coupon.percent, active: coupon.active } });
    });
    return coupon;
  });

  app.get("/shipping", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { ...await readCheckoutSettings(), bkashNumber, confirmationEmailEnabled };
  });

  app.put("/shipping", async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN"]);
    const rates = parseBody(ShippingRatesSchema, request.body);
    await db.transaction(async tx => {
      await tx.insert(storeShippingSettings).values({ id: shippingSettingsId, rates })
        .onConflictDoUpdate({ target: storeShippingSettings.id, set: { rates } });
      await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: "STORE_SHIPPING_UPDATED",
        targetType: "store_shipping", targetId: shippingSettingsId, requestId: request.id, metadata: rates });
    });
    return { rates };
  });

  app.put("/admin/payment", async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN"]);
    const { codAdvanceTaka } = parseBody(z.object({ codAdvanceTaka: CodAdvanceSchema }), request.body);
    await db.transaction(async tx => {
      await tx.insert(storeShippingSettings).values({ id: shippingSettingsId, rates: defaultShippingRates, codAdvanceTaka })
        .onConflictDoUpdate({ target: storeShippingSettings.id, set: { codAdvanceTaka } });
      await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: "STORE_COD_ADVANCE_UPDATED",
        targetType: "store_shipping", targetId: shippingSettingsId, requestId: request.id, metadata: { codAdvanceTaka } });
    });
    return { codAdvanceTaka };
  });

  app.post("/admin/:id/verify-payment", async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN"]);
    const { id } = parseBody(z.object({ id: z.uuid() }), request.params);
    return db.transaction(async tx => {
      const [order] = await tx.select().from(storeOrders).where(eq(storeOrders.id, id)).for("update");
      if (!order?.transactionId || order.paymentAmountMinor <= 0) conflict("This order has no bKash payment to verify.");
      if (order.paymentVerifiedAt) return receipt(order);
      const [verified] = await tx.update(storeOrders).set({ paymentVerifiedAt: new Date() })
        .where(eq(storeOrders.id, id)).returning();
      if (!verified) throw new Error("Payment verification could not be saved");
      await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: "STORE_PAYMENT_VERIFIED",
        targetType: "store_order", targetId: id, requestId: request.id, metadata: { amountMinor: order.paymentAmountMinor } });
      return receipt(verified);
    });
  });

  app.get("/admin", async (request, reply) => {
    await requireOperator(request, ["SUPER_ADMIN"]);
    reply.header("Cache-Control", "no-store");
    const { beforeId } = parseBody(z.object({ beforeId: z.uuid().optional() }), request.query);
    const before = db.select({ createdAt: storeOrders.createdAt, id: storeOrders.id })
      .from(storeOrders).where(eq(storeOrders.id, beforeId ?? ""));
    const rows = await db.select().from(storeOrders)
      .where(beforeId ? sql`(${storeOrders.createdAt}, ${storeOrders.id}) < (${before})` : undefined)
      .orderBy(desc(storeOrders.createdAt), desc(storeOrders.id)).limit(51);
    return { items: rows.slice(0, 50).map(row => ({ ...receipt(row), customer: row.customer,
      deliveryAddress: row.deliveryAddress, items: row.items, transactionId: row.transactionId })), hasMore: rows.length > 50 };
  });

  app.post("/", { bodyLimit: 32 * 1024 }, async (request, reply) => {
    const { requestId, ...input } = parseBody(PlaceOrderSchema, request.body);
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const { order, created } = await db.transaction(async tx => {
      // Serialize retries before checking prices so a committed request always returns its receipt.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
      const [previous] = await tx.select().from(storeOrders).where(eq(storeOrders.requestId, requestId));
      if (previous) {
        if (previous.requestHash !== requestHash) conflict("This order request has already been used.");
        return { order: previous, created: false };
      }
      const { district, dhakaArea, addressLine } = input.deliveryAddress;
      // Keep pending requests from older checkout pages valid during the rollout.
      const zone = dhakaArea ? deliveryZone(district, dhakaArea) : checkoutDeliveryZone(district, addressLine);
      if (!zone) throw Object.assign(new Error("Enter a complete delivery address."), { statusCode: 400 });
      const { rates, codAdvanceTaka } = await readCheckoutSettings(tx);
      const shippingMinor = rates[zone];
      if (shippingMinor !== input.shippingMinor) conflict("Delivery rates changed. Review your updated total and try again.");

      const catalog = await tx.select().from(products).where(and(eq(products.status, "PUBLISHED"),
        inArray(products.id, input.items.map(item => item.productId)))).for("share");
      const items = input.items.map(line => {
        const product = catalog.find(item => item.id === line.productId);
        const variant = product?.variants.find(item => item.id === line.variantId);
        if (!product || !variant?.available) conflict("An item in your cart is no longer available.");
        const unitPriceMinor = variantPrice(variant);
        if (unitPriceMinor !== line.unitPriceMinor) conflict("An item price changed. Review your updated cart and try again.");
        return { ...line, unitPriceMinor, name: product.name, variantName: variant.name };
      });
      const subtotalMinor = items.reduce((total, item) => total + item.unitPriceMinor * item.quantity, 0);
      let discountMinor = 0;
      if (input.coupon) {
        const [coupon] = await tx.select().from(storeCoupons).where(eq(storeCoupons.code, input.coupon.code)).for("share");
        if (!coupon?.active) conflict("This coupon is no longer available. Remove it and review your total.");
        discountMinor = couponDiscount(subtotalMinor, coupon.percent);
        if (discountMinor !== input.coupon.discountMinor) conflict("The coupon discount changed. Review your updated total.");
      }
      const paymentMethod = input.payment?.method ?? "COD";
      const paymentAmountMinor = paymentDueNow(subtotalMinor + shippingMinor - discountMinor, paymentMethod, codAdvanceTaka);
      if ((input.payment?.amountMinor ?? 0) !== paymentAmountMinor) conflict("Payment amount changed. Review the updated amount before paying. If you already paid, contact Oneinfo with your bKash transaction ID.");
      const transactionId = input.payment?.transactionId ?? null;
      if (paymentAmountMinor > 0 && !transactionId) conflict("Enter your bKash transaction ID.");
      if (paymentAmountMinor === 0 && transactionId) conflict("No bKash payment is required for this order.");
      const [order] = await tx.insert(storeOrders).values({
        requestId, requestHash, customer: input.customer, deliveryAddress: input.deliveryAddress,
        items, shippingZone: zone, subtotalMinor, shippingMinor, couponCode: input.coupon?.code, discountMinor,
        paymentMethod, paymentAmountMinor, transactionId,
      }).onConflictDoNothing({ target: storeOrders.transactionId }).returning();
      if (!order) conflict("This bKash transaction ID is already linked to an order.");
      return { order, created: true };
    }).catch(error => {
      if (error instanceof Error && "statusCode" in error) throw error;
      // Database errors can include SQL parameter values from the customer's order.
      request.log.error({ name: error instanceof Error ? error.name : "UnknownError" }, "Order transaction failed");
      throw new Error("Could not save order");
    });
    const result = receipt(order);
    const emailStatus = order.paymentVerifiedAt ? undefined : await sendOrderConfirmation({
      ...result, customer: order.customer, deliveryAddress: order.deliveryAddress, items: order.items,
    });
    if (emailStatus === "failed") request.log.warn({ orderId: order.id }, "Order confirmation email was not accepted");
    if (emailStatus) result.confirmationEmail = emailStatus;
    return created ? sendCreated(reply, result) : result;
  });
};
