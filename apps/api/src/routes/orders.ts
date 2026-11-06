import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  bkashNumber, CodAdvanceSchema, defaultCodAdvanceTaka, paymentDueNow, CouponCodeSchema, couponDiscount, checkoutDeliveryZone, defaultShippingRates, deliveryZone, PlaceOrderSchema,
  ShippingRatesSchema, StoreCouponSchema, variantPrice, AdminOrderSearchSchema, OrderFulfillmentSchema,
  type AdminOrderSearch, type OrderReceipt,
} from "@oneinfo/contracts";
import { requireOperator } from "../auth.js";
import { db } from "../db/client.js";
import { auditLogs, cards, orderCardAllocations, products, storeCoupons, storeOrders, storeReviewInvites, storeShippingSettings } from "../db/schema.js";
import { allocatePendingOrders, allocationSummary } from "../domain/printed-stock.js";

import { confirmationEmailEnabled, sendOrderConfirmation, sendPaymentVerifiedEmail, sendShippingEmail } from "../domain/order-confirmation.js";
import { orderTracking, trackingOrderId, trackingPath } from "../domain/order-tracking.js";
import { attemptOrderEmail, orderEmailHistory, orderEmailKinds } from "../domain/order-email-history.js";
import { usesBrevoSmtp } from "../domain/transactional-email.js";
import { parseBody, sendCreated } from "../http.js";

const shippingSettingsId = "default";

async function readCheckoutSettings(client: Pick<typeof db, "select"> = db) {
  const [settings] = await client.select().from(storeShippingSettings).where(eq(storeShippingSettings.id, shippingSettingsId));
  return { rates: settings?.rates ?? defaultShippingRates, codAdvanceTaka: settings?.codAdvanceTaka ?? defaultCodAdvanceTaka };
}

function receipt(order: typeof storeOrders.$inferSelect): OrderReceipt {
  const { id, shippingZone, subtotalMinor, shippingMinor, couponCode, discountMinor } = order;
  const { paymentMethod, paymentAmountMinor, paymentVerifiedAt } = order;
  return { id, paymentMethod, paymentAmountMinor,
    ...(paymentAmountMinor > 0 && { paymentStatus: paymentVerifiedAt ? "VERIFIED" : "PENDING_VERIFICATION" }),
    ...orderTracking(order), trackingPath: trackingPath(id), shippingZone, subtotalMinor, shippingMinor,
    couponCode, discountMinor, totalMinor: subtotalMinor + shippingMinor - discountMinor };
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
    const { order, newlyVerified } = await db.transaction(async tx => {
      const [order] = await tx.select().from(storeOrders).where(eq(storeOrders.id, id)).for("update");
      if (!order?.transactionId || order.paymentAmountMinor <= 0) conflict("This order has no bKash payment to verify.");
      if (order.paymentVerifiedAt) return { order, newlyVerified: false };
      const [verified] = await tx.update(storeOrders).set({ paymentVerifiedAt: new Date() })
        .where(eq(storeOrders.id, id)).returning();
      if (!verified) throw new Error("Payment verification could not be saved");
      await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: "STORE_PAYMENT_VERIFIED",
        targetType: "store_order", targetId: id, requestId: request.id, metadata: { amountMinor: order.paymentAmountMinor } });
      return { order: verified, newlyVerified: true };
    });
    const result = receipt(order);
    if (!newlyVerified || !confirmationEmailEnabled) return result;
    const status = await attemptOrderEmail(id, "payment", () => sendPaymentVerifiedEmail({ ...result, customer: order.customer }));
    if (status === "failed") request.log.warn({ orderId: id }, "Payment verification email was not accepted");
    return { ...result, paymentEmail: status };
  });

  app.post("/tracking", { bodyLimit: 1024 }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { token } = parseBody(z.object({ token: z.string().max(100) }), request.body);
    const id = trackingOrderId(token);
    if (id) {
      const [order] = await db.select().from(storeOrders).where(eq(storeOrders.id, id));
      if (order) return orderTracking(order);
    }
    return reply.code(404).send({ message: "This private tracking link is invalid." });
  });

  app.post("/admin/:id/fulfillment", async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN"]);
    const { id } = parseBody(z.object({ id: z.uuid() }), request.params);
    const input = parseBody(OrderFulfillmentSchema, request.body);
    const { order, shipped } = await db.transaction(async tx => {
      const [existing] = await tx.select().from(storeOrders).where(eq(storeOrders.id, id)).for("update");
      if (!existing || existing.deliveredAt) conflict("Only an open order can be updated.");
      if (input.status === "PROCESSING" ? existing.processingAt || existing.shippedAt : existing.shippedAt && existing.courierTrackingId === input.trackingId) {
        return { order: existing, shipped: false };
      }
      if (input.status === "SHIPPED" && existing.paymentAmountMinor > 0 && !existing.paymentVerifiedAt) conflict("Verify the bKash payment before shipping.");
      const now = new Date();
      const [updated] = await tx.update(storeOrders).set(input.status === "PROCESSING" ? { processingAt: now }
        : { processingAt: existing.processingAt ?? now, shippedAt: existing.shippedAt ?? now, courierTrackingId: input.trackingId })
        .where(eq(storeOrders.id, id)).returning();
      if (!updated) throw new Error("Order update failed");
      await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: `STORE_ORDER_${input.status}`,
        targetType: "store_order", targetId: id, requestId: request.id });
      return { order: updated, shipped: input.status === "SHIPPED" && !existing.shippedAt };
    });
    const shippingEmail = shipped && confirmationEmailEnabled ? await attemptOrderEmail(id, "shipping", () => sendShippingEmail({ ...receipt(order), customer: order.customer })) : undefined;
    return { ...receipt(order), shippingEmail };
  });

  app.get("/admin/:id/emails", async (request, reply) => {
    await requireOperator(request, ["SUPER_ADMIN"]);
    const { id } = parseBody(z.object({ id: z.uuid() }), request.params);
    reply.header("Cache-Control", "no-store");
    return { items: await orderEmailHistory(id) };
  });

  app.post("/admin/:id/emails/retry", async request => {
    await requireOperator(request, ["SUPER_ADMIN"]);
    const { id } = parseBody(z.object({ id: z.uuid() }), request.params);
    const { kind } = parseBody(z.object({ kind: z.enum(orderEmailKinds).exclude(["delivery"]) }), request.body);
    if (!confirmationEmailEnabled) conflict("Order email is not configured.");
    const [order] = await db.select().from(storeOrders).where(eq(storeOrders.id, id));
    if (!order) conflict("Order not found.");
    const data = { ...receipt(order), customer: order.customer, deliveryAddress: order.deliveryAddress, items: order.items };
    const status = await attemptOrderEmail(id, kind, async () => {
      if (kind === "payment") return sendPaymentVerifiedEmail(data);
      if (kind === "shipping") return sendShippingEmail(data);
      return await sendOrderConfirmation(data, true, true) === "accepted";
    }, "retry");
    if (!status) conflict("Only a failed email can be retried.");
    return { status };
  });

  app.put("/admin/:id/cod", async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN"]);
    const { id } = parseBody(z.object({ id: z.uuid() }), request.params);
    const input = parseBody(z.object({ codCollectedMinor: z.number().int().nonnegative(), codSettledMinor: z.number().int().nonnegative() }), request.body);
    return db.transaction(async tx => {
      const [order] = await tx.select().from(storeOrders).where(eq(storeOrders.id, id)).for("update");
      if (!order?.deliveredAt || order.paymentMethod !== "COD") conflict("COD amounts can be recorded after delivery.");
      const due = receipt(order).totalMinor - (order.paymentVerifiedAt ? order.paymentAmountMinor : 0);
      if (input.codSettledMinor > input.codCollectedMinor || input.codCollectedMinor > due) conflict("Settlement cannot exceed collection, and collection cannot exceed the remaining order balance.");
      if (order.codCollectedMinor === input.codCollectedMinor && order.codSettledMinor === input.codSettledMinor) return input;
      await tx.update(storeOrders).set(input).where(eq(storeOrders.id, id));
      await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: "STORE_COD_UPDATED", targetType: "store_order", targetId: id,
        requestId: request.id, metadata: input });
      return input;
    });
  });

  app.route({ method: ["GET", "POST"], url: "/admin", bodyLimit: 2048, handler: async (request, reply) => {
    await requireOperator(request, ["SUPER_ADMIN"]);
    reply.header("Cache-Control", "no-store");
    const filters: AdminOrderSearch = request.method === "POST" ? parseBody(AdminOrderSearchSchema, request.body)
      : parseBody(AdminOrderSearchSchema.pick({ beforeId: true }), request.query);
    const { beforeId, query, payment, delivery, qr } = filters;
    const before = db.select({ createdAt: storeOrders.createdAt, id: storeOrders.id })
      .from(storeOrders).where(eq(storeOrders.id, beforeId ?? ""));
    const state = sql`case when ${storeOrders.deliveredAt} is not null then 'DELIVERED' when ${storeOrders.shippedAt} is not null then 'SHIPPED' when ${storeOrders.processingAt} is not null then 'PROCESSING' else 'RECEIVED' end`;
    const required = sql`(select coalesce(sum((line->>'quantity')::integer), 0) from jsonb_array_elements(${storeOrders.items}) as line)`;
    const assigned = sql`(select count(*) from ${orderCardAllocations} where ${orderCardAllocations.orderId} = ${storeOrders.id})`;
    const digits = query?.replace(/\D/g, "") ?? "";
    const phone = query && digits && /^[+\d(). -]+$/.test(query) ? sql`or position(${digits} in regexp_replace(${storeOrders.customer}->>'phone', '[^0-9]', '', 'g')) > 0` : sql``;
    const rows = await db.select().from(storeOrders)
      .where(and(beforeId ? sql`(${storeOrders.createdAt}, ${storeOrders.id}) < (${before})` : undefined,
        query ? sql`(position(lower(${query}) in lower(${storeOrders.id}::text)) > 0 or position(lower(${query}) in lower(${storeOrders.customer}->>'email')) > 0 ${phone})` : undefined,
        payment ? sql`${storeOrders.paymentAmountMinor} > 0 and ${storeOrders.paymentVerifiedAt} is ${payment === "VERIFIED" ? sql`not null` : sql`null`}` : undefined,
        delivery ? sql`(${state}) = ${delivery}` : undefined,
        qr ? sql`(case when ${assigned} >= ${required} then 'ASSIGNED' when ${assigned} > 0 then 'PARTIAL' else 'AWAITING_QR' end) = ${qr}` : undefined))
      .orderBy(desc(storeOrders.createdAt), desc(storeOrders.id)).limit(51);
    const page = rows.slice(0, 50);
    const allocations = page.length ? await db.select({ orderId: orderCardAllocations.orderId, id: cards.id, publicSlug: cards.publicSlug,
      canonicalUrl: cards.canonicalUrl, qcStatus: cards.qcStatus }).from(orderCardAllocations).innerJoin(cards, eq(cards.id, orderCardAllocations.cardId))
      .where(inArray(orderCardAllocations.orderId, page.map(row => row.id))) : [];
    const invites = page.length ? await db.select().from(storeReviewInvites).where(inArray(storeReviewInvites.orderId, page.map(row => row.id))) : [];
    return { items: page.map(row => {
      const assignedCards = allocations.filter(item => item.orderId === row.id).map(({ orderId: _, ...card }) => card);
      return { ...receipt(row), reviewInviteSentAt: invites.find(invite => invite.orderId === row.id)?.sentAt?.toISOString() ?? null, customer: row.customer, profileId: row.profileId, assignedCards,
        qrAllocation: allocationSummary(row.items.reduce((sum, item) => sum + item.quantity, 0), assignedCards.length),
        deliveryAddress: row.deliveryAddress, items: row.items, transactionId: row.transactionId,
        codCollectedMinor: row.codCollectedMinor, codSettledMinor: row.codSettledMinor };
    }), hasMore: rows.length > 50, supportsSearch: true };

  } });

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
        inArray(products.id, input.items.map(item => item.productId)))).orderBy(asc(products.id)).for("update");
      const items = input.items.map(line => {
        const product = catalog.find(item => item.id === line.productId);
        const variant = product?.variants.find(item => item.id === line.variantId);
        if (!product || !variant?.available) conflict("An item in your cart is no longer available.");
        if (variant.stockQuantity !== undefined && line.quantity > variant.stockQuantity) conflict("There are not enough units of an item in your cart.");
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
      for (const product of catalog) {
        const quantities = new Map(items.filter(item => item.productId === product.id).map(item => [item.variantId, item.quantity]));
        if (!product.variants.some(variant => variant.stockQuantity !== undefined && quantities.has(variant.id))) continue;
        const variants = product.variants.map(variant => variant.stockQuantity !== undefined && quantities.has(variant.id)
          ? { ...variant, stockQuantity: variant.stockQuantity - (quantities.get(variant.id) ?? 0) } : variant);
        await tx.update(products).set({ variants, version: product.version + 1, updatedAt: new Date() }).where(eq(products.id, product.id));
      }
      await allocatePendingOrders(tx);
      return { order, created: true };
    }).catch(error => {
      if (error instanceof Error && "statusCode" in error) throw error;
      // Database errors can include SQL parameter values from the customer's order.
      request.log.error({ name: error instanceof Error ? error.name : "UnknownError" }, "Order transaction failed");
      throw new Error("Could not save order");
    });
    const result = receipt(order);
    const allocations = await db.select({ id: orderCardAllocations.id }).from(orderCardAllocations).where(eq(orderCardAllocations.orderId, order.id));
    result.qrAllocation = allocationSummary(order.items.reduce((sum, item) => sum + item.quantity, 0), allocations.length);
    const maySend = confirmationEmailEnabled && !order.paymentVerifiedAt && (created || !usesBrevoSmtp) &&
      Date.now() - order.createdAt.getTime() < 23 * 60 * 60 * 1000;
    const emailStatus = maySend ? await attemptOrderEmail(order.id, "confirmation", async () =>
      await sendOrderConfirmation({ ...result, customer: order.customer, deliveryAddress: order.deliveryAddress, items: order.items }, created) === "accepted",
      created ? "initial" : "replay") : undefined;
    if (emailStatus === "failed") request.log.warn({ orderId: order.id }, "Order confirmation email was not accepted");
    if (emailStatus) result.confirmationEmail = emailStatus;
    return created ? sendCreated(reply, result) : result;
  });
};
