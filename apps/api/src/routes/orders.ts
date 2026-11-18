import { allowAuthAttempt } from "../domain/auth-attempts.js";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  bkashNumber, rocketNumber, CodAdvanceSchema, defaultCodAdvanceTaka, defaultCodAdvanceInsideDhaka, paymentDueNow, CouponCodeSchema, couponDiscount, checkoutDeliveryZone, defaultShippingRates, deliveryZone, PlaceOrderSchema,
  ShippingRatesSchema, StoreCouponSchema, variantPrice, variantPriceForBranding, AdminOrderSearchSchema, OrderFulfillmentSchema,
  type AdminOrderSearch, type OrderLine, type OrderReceipt,
  orderDesignProductSlug,
} from "@oneinfo/contracts";
import { requireOperator } from "../auth.js";
import { db } from "../db/client.js";
import { auditLogs, cardActivationSecrets, cardBatches, cards, orderCardAllocations, products, storeCoupons, storeOrders, storeReviewInvites, storeShippingSettings, orderActivationProfiles } from "../db/schema.js";
import { config } from "../config.js";
import { createOrderProfiles, encryptOrderCode, orderProfileCodes } from "../domain/order-activation.js";
import { sendMetaPurchaseEvent } from "../domain/meta-conversions.js";
import { registerOrderPrint } from "./order-print.js";
import { nextInvoiceNumber } from "../domain/order-invoice.js";
import { assertInvoicePacked, packInvoiceOrder, packedCards } from "../domain/order-packing.js";
import { qrUrl } from "../domain/card-urls.js";
import { orderDesignExists } from "../domain/order-design.js";
import { allocatePendingOrders, allocationSummary, lockPrintedStock } from "../domain/printed-stock.js";

import { confirmationEmailEnabled, sendOrderConfirmation, sendPaymentVerifiedEmail, sendShippingEmail } from "../domain/order-confirmation.js";
import { invoicePath, orderTracking, trackingOrderId, trackingPath } from "../domain/order-tracking.js";
import { attemptOrderEmail, queueOrderEmail, orderEmailHistory, orderEmailKinds } from "../domain/order-email-history.js";
import { dispatchOrderEmail } from "../domain/order-email-worker.js";

import { parseBody, sendCreated } from "../http.js";

const shippingSettingsId = "default";

async function readCheckoutSettings(client: Pick<typeof db, "select"> = db) {
  const [settings] = await client.select().from(storeShippingSettings).where(eq(storeShippingSettings.id, shippingSettingsId));
  return {
    rates: settings?.rates ?? defaultShippingRates,
    codAdvanceTaka: settings?.codAdvanceTaka ?? defaultCodAdvanceTaka,
    codAdvanceInsideDhaka: settings?.codAdvanceInsideDhaka ?? defaultCodAdvanceInsideDhaka,
    metaConversionsEnabled: Boolean(settings?.encryptedMetaCapiToken || config.META_CONVERSIONS_API_TOKEN),
  };
}

function receipt(order: typeof storeOrders.$inferSelect): OrderReceipt {
  const { id, shippingZone, subtotalMinor, shippingMinor, couponCode, discountMinor, activationMethod, packedAt } = order;
  const { paymentMethod, paymentAmountMinor, paymentVerifiedAt } = order;
  return { id, activationMethod, packedAt: packedAt?.toISOString() ?? null, paymentMethod, paymentAmountMinor,
    ...(paymentAmountMinor > 0 && { paymentStatus: paymentVerifiedAt ? "VERIFIED" : "PENDING_VERIFICATION" }),
    ...orderTracking(order), trackingPath: trackingPath(id), shippingZone, subtotalMinor, shippingMinor,
    ...(order.invoiceNumber && { invoicePath: invoicePath(id) }),
    couponCode, discountMinor, totalMinor: subtotalMinor + shippingMinor - discountMinor };
}

function conflict(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 409 });
}

function productWarranty(product: Pick<typeof products.$inferSelect, "warranty" | "warrantyIsDemo">) {
  return product.warrantyIsDemo ? null : product.warranty.trim() || null;
}

async function legacyProductWarranties(items: OrderLine[]) {
  const ids = [...new Set(items.filter(item => item.warranty === undefined).map(item => item.productId))];
  if (!ids.length) return new Map<string, string | null>();
  const catalog = await db.select({ id: products.id, warranty: products.warranty, warrantyIsDemo: products.warrantyIsDemo })
    .from(products).where(inArray(products.id, ids));
  return new Map(catalog.map(product => [product.id, productWarranty(product)]));
}

function orderLineWarranty(item: OrderLine, legacy: Map<string, string | null>) {
  return item.warranty === undefined ? legacy.get(item.productId) ?? null : item.warranty;
}

export const orderRoutes: FastifyPluginAsync = async app => {
  registerOrderPrint(app);
  app.post("/admin/:id/activation-codes", async (request, reply) => {
    const actor = await requireOperator(request, ["SUPER_ADMIN"]);
    const { id } = parseBody(z.object({ id: z.uuid() }), request.params);
    reply.header("Cache-Control", "no-store");
    return db.transaction(async tx => {
      const [order] = await tx.select().from(storeOrders).where(eq(storeOrders.id, id)).for("update");
      if (!order || order.activationMethod !== "ORDER_SECRET" || order.cancelledAt || order.awaitingPayment) conflict("No activation codes are available for this order.");
      if (order.paymentAmountMinor > 0 && !order.paymentVerifiedAt) conflict("Verify payment before accessing activation codes.");
      await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: "ORDER_ACTIVATION_CODES_VIEWED", targetType: "store_order", targetId: id, requestId: request.id });
      return { items: await orderProfileCodes(tx, id) };
    });
  });
  app.post("/admin/:id/packing-check", { bodyLimit: 524288 }, async request => {
    const operator = await requireOperator(request, ["SUPER_ADMIN"]);
    const { id } = parseBody(z.object({ id: z.uuid() }), request.params);
    const { scans, replace, confirmed } = parseBody(z.object({ confirmed: z.literal(true).optional(), scans: z.array(z.string().trim().min(1).max(2048)).max(4950).default([]),
      replace: z.array(z.uuid()).max(4950).optional() }), request.body);
    return db.transaction(async tx => {
      await lockPrintedStock(tx);
      const [order] = await tx.select().from(storeOrders).where(eq(storeOrders.id, id)).for("update");
      if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });
      if (order.cancelledAt || order.awaitingPayment || order.shippedAt || order.deliveredAt) conflict("Packing is available for open orders only.");
      if (order.paymentAmountMinor > 0 && !order.paymentVerifiedAt) conflict("Verify payment before packing.");
      if (order.activationMethod === "ORDER_SECRET") {
        if (!confirmed || scans.length) conflict("Confirm the correct quantity and finish of QC-passed cards and include one secret code per card. QR scans are not assigned during packing.");
        const slots = await tx.select().from(orderActivationProfiles).where(eq(orderActivationProfiles.orderId, id));
        const checked = order.items.reduce((sum, item) => sum + item.quantity, 0);
        if (slots.length !== checked) conflict("Temporary profiles are incomplete. Contact support.");
        await tx.update(storeOrders).set({ packedAt: order.packedAt ?? new Date() }).where(eq(storeOrders.id, id));
        await tx.insert(auditLogs).values({ actorId: operator.operatorId, action: "ORDER_PACKING_CHECKED", targetType: "store_order", targetId: id, requestId: request.id, metadata: { checked, activationMethod: "ORDER_SECRET" } });
        return { checked };
      }
      if (order.invoiceNumber) {
        const { checked, cardIds } = await packInvoiceOrder(tx, order, scans, replace);
        await tx.insert(auditLogs).values({ actorId: operator.operatorId, action: "ORDER_PACKING_CHECKED", targetType: "store_order",
          targetId: id, requestId: request.id, metadata: { cardIds } });
        return { checked };
      }
      const assigned = await packedCards(tx, id);
      const required = order.items.reduce((sum, item) => sum + item.quantity, 0);
      if (assigned.length !== required || assigned.some(({ card, printed }) => !printed || card.qcStatus !== "PASSED" ||
          card.nfcStatus !== "WRITTEN" || !["QC_PASSED", "ACTIVATED"].includes(card.lifecycleStatus))) {
        conflict("All ordered cards need confirmed printing, NFC and passed QC before packing.");
      }
      const byCode = new Map(assigned.flatMap(({ card }) => [card.publicSlug, qrUrl(card.canonicalUrl)].map(code => [code, card.id] as const)));
      const matched = scans.map(code => byCode.get(code));
      if (matched.length !== required || matched.some(id => !id) || new Set(matched).size !== required) {
        conflict("Scan each assigned card once. A missing, duplicate, or different card cannot pass the packing check.");
      }
      await tx.insert(auditLogs).values({ actorId: operator.operatorId, action: "ORDER_PACKING_CHECKED", targetType: "store_order",
        targetId: id, requestId: request.id, metadata: { cardIds: matched } });
      return { checked: required };
    });
  });
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
    return { ...await readCheckoutSettings(), bkashNumber, rocketNumber, confirmationEmailEnabled };
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
    const { codAdvanceTaka, codAdvanceInsideDhaka } = parseBody(
      z.object({ codAdvanceTaka: CodAdvanceSchema, codAdvanceInsideDhaka: z.boolean().default(true) }),
      request.body
    );
    await db.transaction(async tx => {
      await tx.insert(storeShippingSettings).values({ id: shippingSettingsId, rates: defaultShippingRates, codAdvanceTaka, codAdvanceInsideDhaka })
        .onConflictDoUpdate({ target: storeShippingSettings.id, set: { codAdvanceTaka, codAdvanceInsideDhaka } });
      await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: "STORE_COD_ADVANCE_UPDATED",
        targetType: "store_shipping", targetId: shippingSettingsId, requestId: request.id, metadata: { codAdvanceTaka, codAdvanceInsideDhaka } });
    });
    return { codAdvanceTaka, codAdvanceInsideDhaka };
  });

  app.put("/admin/meta-capi", async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN"]);
    const { token } = parseBody(z.object({ token: z.string().trim().max(512) }), request.body);
    const encryptedMetaCapiToken = token ? encryptOrderCode(token) : null;
    await db.transaction(async tx => {
      await tx.insert(storeShippingSettings).values({ id: shippingSettingsId, rates: defaultShippingRates, encryptedMetaCapiToken })
        .onConflictDoUpdate({ target: storeShippingSettings.id, set: { encryptedMetaCapiToken } });
      await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: "STORE_META_CAPI_UPDATED",
        targetType: "store_shipping", targetId: shippingSettingsId, requestId: request.id, metadata: { configured: Boolean(token) } });
    });
    return { metaConversionsEnabled: Boolean(token || config.META_CONVERSIONS_API_TOKEN) };
  });

  app.post("/admin/:id/verify-payment", async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN"]);
    const { id } = parseBody(z.object({ id: z.uuid() }), request.params);
    const { order, newlyVerified } = await db.transaction(async tx => {
      const [order] = await tx.select().from(storeOrders).where(eq(storeOrders.id, id)).for("update");
      if (order?.cancelledAt || !order?.transactionId || order.paymentAmountMinor <= 0) conflict("This order has no payment to verify.");
      if (order.paymentVerifiedAt) return { order, newlyVerified: false };
      const [verified] = await tx.update(storeOrders).set({ paymentVerifiedAt: new Date() })
        .where(eq(storeOrders.id, id)).returning();
      if (!verified) throw new Error("Payment verification could not be saved");
      await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: "STORE_PAYMENT_VERIFIED",
        targetType: "store_order", targetId: id, requestId: request.id, metadata: { amountMinor: order.paymentAmountMinor } });
      await queueOrderEmail(tx, id, "payment");
      return { order: verified, newlyVerified: true };
    });
    const result = receipt(order);
    if (!newlyVerified || !confirmationEmailEnabled) return result;
    const status = await attemptOrderEmail(id, "payment", () => sendPaymentVerifiedEmail({ ...result, customer: order.customer }));
    if (status === "failed") request.log.warn({ orderId: id }, "Payment verification email was not accepted");
    return { ...result, paymentEmail: status };
  });

  app.post("/admin/:id/cancel", async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN"]);
    const { id } = parseBody(z.object({ id: z.uuid() }), request.params);
    const { reason, refundConfirmed, cardsRecovered } = parseBody(z.object({ reason: z.string().trim().min(5).max(500), refundConfirmed: z.boolean().default(false), cardsRecovered: z.boolean().default(false) }), request.body);
    return db.transaction(async tx => {
      await lockPrintedStock(tx);
      const [order] = await tx.select().from(storeOrders).where(eq(storeOrders.id, id)).for("update");
      if (!order) conflict("Order not found.");
      if (order.cancelledAt) return receipt(order);
      if (!order.stockReservations) conflict("This older order needs a manual stock check before cancellation. Contact support to reconcile its inventory.");
      if (new Set(order.stockReservations.map(line => `${line.productId}:${line.variantId}`)).size !== order.stockReservations.length) {
        conflict("This older order has split stock reservations. Reconcile its inventory before cancellation.");
      }
      if (order.shippedAt || order.deliveredAt) conflict("A shipped order requires a return, not cancellation.");
      if (order.transactionId && !refundConfirmed) conflict("Check the payment and resolve any refund before cancelling.");
      const allocated = await tx.select({ card: cards }).from(orderCardAllocations).innerJoin(cards, eq(cards.id, orderCardAllocations.cardId))
        .where(eq(orderCardAllocations.orderId, id)).for("update", { of: cards });
      for (const { card } of allocated) {
        const [secret] = await tx.select().from(cardActivationSecrets).where(eq(cardActivationSecrets.cardId, card.id));
        if (card.profileId || card.customerAccountId || card.companyId || !["IN_PRODUCTION", "QC_PASSED"].includes(card.lifecycleStatus)) conflict("An allocated card has been issued. Recover it and revoke its activation code before cancelling.");
        if ((order.invoiceNumber || secret || card.inventoryStatus === "DISPATCHED") && !cardsRecovered) conflict("Confirm the packed or issued cards have been recovered before releasing stock.");
        if (secret) await tx.delete(cardActivationSecrets).where(eq(cardActivationSecrets.cardId, card.id));
      }
      const catalog = await tx.select().from(products).where(inArray(products.id, order.items.map(item => item.productId))).orderBy(asc(products.id)).for("update");
      for (const product of catalog) {
        const variants = product.variants.map(variant => {
          const line = order.stockReservations!.find(item => item.productId === product.id && item.variantId === variant.id);
          return line && variant.stockQuantity !== undefined ? { ...variant, stockQuantity: variant.stockQuantity + line.quantity } : variant;
        });
        await tx.update(products).set({ variants, version: product.version + 1, updatedAt: new Date() }).where(eq(products.id, product.id));
      }
      const usedProfiles = await tx.select().from(orderActivationProfiles).where(eq(orderActivationProfiles.orderId, id));
      if (usedProfiles.some(slot => slot.redeemedAt)) conflict("An activated order cannot be cancelled.");
      await tx.update(orderActivationProfiles).set({ encryptedCode: null }).where(eq(orderActivationProfiles.orderId, id));
      await tx.delete(orderCardAllocations).where(eq(orderCardAllocations.orderId, id));
      for (const { card } of allocated) await tx.update(cards).set({ inventoryStatus: card.qcStatus === "PASSED" ? "SALEABLE" : "NOT_READY", updatedAt: new Date() }).where(eq(cards.id, card.id));
      const [cancelled] = await tx.update(storeOrders).set({ cancelledAt: new Date(), cancellationReason: reason }).where(eq(storeOrders.id, id)).returning();
      await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: "STORE_ORDER_CANCELLED", targetType: "store_order", targetId: id, metadata: { reason, refundConfirmed, cardsRecovered } });
      await allocatePendingOrders(tx);
      return receipt(cancelled!);
    });
  });

  app.post("/tracking", { bodyLimit: 1024 }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { token } = parseBody(z.object({ token: z.string().max(100) }), request.body);
    const id = trackingOrderId(token);
    if (id) {
      const [order] = await db.select().from(storeOrders).where(eq(storeOrders.id, id));
      if (order) {
        const allocated = await db.select({ qrStatus: cards.qrStatus, nfcStatus: cards.nfcStatus, qcStatus: cards.qcStatus })
          .from(orderCardAllocations).innerJoin(cards, eq(cards.id, orderCardAllocations.cardId))
          .where(eq(orderCardAllocations.orderId, id));
        return {
          ...orderTracking(order),
          cards: {
            total: order.items.reduce((sum, item) => sum + item.quantity, 0),
            qrGenerated: allocated.filter(c => c.qrStatus === "GENERATED").length,
            nfcWritten: allocated.filter(c => c.nfcStatus === "WRITTEN").length,
            qcPassed: allocated.filter(c => c.qcStatus === "PASSED").length,
          },
        };
      }
    }
    return reply.code(404).send({ message: "This private tracking link is invalid." });
  });

  app.post("/invoice", { bodyLimit: 1024 }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { token } = parseBody(z.object({ token: z.string().max(100) }), request.body);
    const id = trackingOrderId(token);
    if (id) {
      const [order] = await db.select().from(storeOrders).where(eq(storeOrders.id, id));
      if (order?.invoiceNumber && !order.awaitingPayment) {
        const { invoiceNumber, status, createdAt, subtotalMinor, shippingMinor, discountMinor, totalMinor, paymentMethod, paymentAmountMinor, paymentStatus } = receipt(order);
        const warranties = await legacyProductWarranties(order.items);
        return { id, invoiceNumber, status, createdAt, subtotalMinor, shippingMinor, discountMinor, totalMinor, paymentMethod,
          paymentAmountMinor, paymentStatus,
          items: order.items.map(item => ({ name: item.name, variantName: item.variantName, quantity: item.quantity,
            unitPriceMinor: item.unitPriceMinor, warranty: orderLineWarranty(item, warranties) })) };
      }
    }
    return reply.code(404).send({ message: "This invoice is unavailable." });
  });

  app.post("/admin/:id/fulfillment", async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN"]);
    const { id } = parseBody(z.object({ id: z.uuid() }), request.params);
    const input = parseBody(OrderFulfillmentSchema, request.body);
    const { order, shipped } = await db.transaction(async tx => {
      const [existing] = await tx.select().from(storeOrders).where(eq(storeOrders.id, id)).for("update");
      if (!existing || existing.deliveredAt || existing.cancelledAt || existing.awaitingPayment) conflict("Only an open order can be updated.");
      if (input.status === "PROCESSING" ? existing.processingAt || existing.shippedAt : existing.shippedAt && existing.courierTrackingId === input.trackingId) {
        return { order: existing, shipped: false };
      }
      if (input.status === "SHIPPED" && existing.paymentAmountMinor > 0 && !existing.paymentVerifiedAt) conflict("Verify the payment before shipping.");
      if (input.status === "SHIPPED") await assertInvoicePacked(tx, existing);
      const now = new Date();
      const [updated] = await tx.update(storeOrders).set(input.status === "PROCESSING" ? { processingAt: now }
        : { processingAt: existing.processingAt ?? now, shippedAt: existing.shippedAt ?? now, courierTrackingId: input.trackingId })
        .where(eq(storeOrders.id, id)).returning();
      if (!updated) throw new Error("Order update failed");
      await tx.insert(auditLogs).values({ actorId: actor.operatorId, action: `STORE_ORDER_${input.status}`,
        targetType: "store_order", targetId: id, requestId: request.id });
      if (input.status === "SHIPPED" && !existing.shippedAt) await queueOrderEmail(tx, id, "shipping");
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
    const { kind } = parseBody(z.object({ kind: z.enum(orderEmailKinds) }), request.body);
    if (!confirmationEmailEnabled) conflict("Order email is not configured.");
    const [order] = await db.select().from(storeOrders).where(eq(storeOrders.id, id));
    if (!order) conflict("Order not found.");
    const status = await dispatchOrderEmail(id, kind, true);
    if (!status) conflict("This email is already being sent. Refresh its history shortly.");
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
    const state = sql`case when ${storeOrders.cancelledAt} is not null then 'CANCELLED' when ${storeOrders.awaitingPayment} then 'AWAITING_PAYMENT' when ${storeOrders.deliveredAt} is not null then 'DELIVERED' when ${storeOrders.shippedAt} is not null then 'SHIPPED' when ${storeOrders.processingAt} is not null then 'PROCESSING' else 'RECEIVED' end`;
    const required = sql`(select coalesce(sum((line->>'quantity')::integer), 0) from jsonb_array_elements(${storeOrders.items}) as line)`;
    const assigned = sql`(select count(*) from ${orderCardAllocations} where ${orderCardAllocations.orderId} = ${storeOrders.id})`;
    const digits = query?.replace(/\D/g, "") ?? "";
    const phone = query && digits && /^[+\d(). -]+$/.test(query) ? sql`or position(${digits} in regexp_replace(${storeOrders.customer}->>'phone', '[^0-9]', '', 'g')) > 0` : sql``;
    const rows = await db.select().from(storeOrders)
      .where(and(beforeId ? sql`(${storeOrders.createdAt}, ${storeOrders.id}) < (${before})` : undefined,
        query ? sql`(position(lower(${query}) in lower(${storeOrders.id}::text)) > 0 or position(upper(${query}) in coalesce(${storeOrders.invoiceNumber}, '')) > 0 or position(lower(${query}) in lower(${storeOrders.customer}->>'email')) > 0 ${phone})` : undefined,
        payment ? sql`${storeOrders.paymentAmountMinor} > 0 and ${storeOrders.paymentVerifiedAt} is ${payment === "VERIFIED" ? sql`not null` : sql`null`}` : undefined,
        delivery ? sql`(${state}) = ${delivery}` : undefined,
        qr ? sql`(case when ${assigned} >= ${required} then 'ASSIGNED' when ${assigned} > 0 then 'PARTIAL' else 'AWAITING_QR' end) = ${qr}` : undefined))
      .orderBy(desc(storeOrders.createdAt), desc(storeOrders.id)).limit(51);
    const page = rows.slice(0, 50);
    const allocations = page.length ? await db.select({ orderId: orderCardAllocations.orderId, id: cards.id, publicSlug: cards.publicSlug,
      lineIndex: orderCardAllocations.lineIndex, unitIndex: orderCardAllocations.unitIndex, printConfirmedAt: cardBatches.printConfirmedAt,
      canonicalUrl: cards.canonicalUrl, qcStatus: cards.qcStatus, nfcStatus: cards.nfcStatus, inventoryStatus: cards.inventoryStatus }).from(orderCardAllocations).innerJoin(cards, eq(cards.id, orderCardAllocations.cardId))
      .innerJoin(cardBatches, eq(cardBatches.id, cards.batchId))
      .where(inArray(orderCardAllocations.orderId, page.map(row => row.id))) : [];
    const invites = page.length ? await db.select().from(storeReviewInvites).where(inArray(storeReviewInvites.orderId, page.map(row => row.id))) : [];
    const warranties = await legacyProductWarranties(page.flatMap(row => row.items));
    return { items: page.map(row => {
      const assignedCards = allocations.filter(item => item.orderId === row.id).map(({ orderId: _, ...card }) => card);
      return { ...receipt(row), reviewInviteSentAt: invites.find(invite => invite.orderId === row.id)?.sentAt?.toISOString() ?? null, customer: row.customer, profileId: row.profileId, assignedCards,
        qrAllocation: allocationSummary(row.items.reduce((sum, item) => sum + item.quantity, 0), assignedCards.length),
        deliveryAddress: row.deliveryAddress, items: row.items.map(item => ({ ...item, warranty: orderLineWarranty(item, warranties) })),
        transactionId: row.transactionId, paymentSenderNumber: row.paymentSenderNumber,
        codCollectedMinor: row.codCollectedMinor, codSettledMinor: row.codSettledMinor };
    }), hasMore: rows.length > 50, supportsSearch: true };

  } });

  for (const route of ["/", "/reserve"]) app.post(route, { bodyLimit: 512 * 1024 }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const reserving = route === "/reserve";
    const { requestId, ...input } = parseBody(PlaceOrderSchema, request.body);
    const senderNumber = input.payment?.senderNumber;
    if (senderNumber && !input.payment?.transactionId) conflict("Enter your transaction ID with the payment number.");
    if (!reserving && input.payment?.method === "ROCKET" && input.payment.amountMinor > 0 && !senderNumber) conflict("Enter the Rocket number used to pay.");
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const [replay] = await db.select({ id: storeOrders.id }).from(storeOrders).where(eq(storeOrders.requestId, requestId)).limit(1);
    if (!replay && !await allowAuthAttempt(`checkout:${request.ip}`, 20, 15 * 60_000)) {
      return reply.code(429).header("Retry-After", "900").send({ message: "Too many checkout attempts. Please wait fifteen minutes and try again." });
    }
    const { order, created } = await db.transaction(async tx => {
      await lockPrintedStock(tx);
      // Serialize retries before checking prices so a committed request always returns its receipt.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
      const [previous] = await tx.select().from(storeOrders).where(eq(storeOrders.requestId, requestId));
      if (previous?.cancelledAt) conflict("This order was cancelled. Do not send payment. Contact Oneinfo if you already paid.");
      if (previous?.awaitingPayment && !reserving) {
        const reservedInput = { ...input, payment: input.payment ? { method: input.payment.method, amountMinor: input.payment.amountMinor } : undefined };
        if (previous.requestHash !== createHash("sha256").update(JSON.stringify(reservedInput)).digest("hex")) conflict("Use the original reserved order and payment amount.");
        if (!input.payment?.transactionId) conflict("Enter your transaction ID.");
        const [duplicate] = await tx.select({ id: storeOrders.id }).from(storeOrders).where(eq(storeOrders.transactionId, input.payment.transactionId));
        if (duplicate) conflict("This transaction ID is already linked to an order.");
        const [completed] = await tx.update(storeOrders).set({ transactionId: input.payment.transactionId, paymentSenderNumber: senderNumber, requestHash, awaitingPayment: false,
          invoiceNumber: await nextInvoiceNumber(tx) }).where(eq(storeOrders.id, previous.id)).returning();
        await createOrderProfiles(tx, completed!);
        await queueOrderEmail(tx, previous.id, "confirmation");
        return { order: completed!, created: true };
      }
      if (previous) {
        if (previous.requestHash !== requestHash) conflict("This order request has already been used.");
        return { order: previous, created: false };
      }
      if (reserving && input.payment?.transactionId) conflict("Reserve your order before entering payment details.");
      const { district, dhakaArea, addressLine } = input.deliveryAddress;
      // Keep pending requests from older checkout pages valid during the rollout.
      const zone = dhakaArea ? deliveryZone(district, dhakaArea) : checkoutDeliveryZone(district, addressLine);
      if (!zone) throw Object.assign(new Error("Enter a complete delivery address."), { statusCode: 400 });
      const { rates, codAdvanceTaka, codAdvanceInsideDhaka } = await readCheckoutSettings(tx);
      const shippingMinor = rates[zone];
      if (shippingMinor !== input.shippingMinor) conflict("Delivery rates changed. Review your updated total and try again.");

      const catalog = await tx.select().from(products).where(and(eq(products.status, "PUBLISHED"),
        inArray(products.id, input.items.map(item => item.productId)))).orderBy(asc(products.id)).for("update");
      const requestedQuantities = new Map<string, number>();
      for (const line of input.items) {
        const key = `${line.productId}:${line.variantId}`;
        requestedQuantities.set(key, (requestedQuantities.get(key) ?? 0) + line.quantity);
      }
      const items = await Promise.all(input.items.map(async line => {
        const product = catalog.find(item => item.id === line.productId);
        const variant = product?.variants.find(item => item.id === line.variantId);
        if (!product || !variant?.available) conflict("An item in your cart is no longer available.");
        if (variant.stockQuantity !== undefined && requestedQuantities.get(`${line.productId}:${line.variantId}`)! > variant.stockQuantity) conflict("There are not enough units of an item in your cart.");
        if (line.designFile && (product.slug !== orderDesignProductSlug || !product.customizable || !await orderDesignExists(line.designFile.id))) {
          conflict("This design file is unavailable for the selected card. Return to the card page to attach your design again.");
        }
        const hasLogo = line.designFile ? line.designFile.brandingMode === "with-logo"
          : line.customization?.hasOneinfoLogo !== false && line.customization?.brandingMode !== "without-logo";
        const unitPriceMinor = variantPriceForBranding(variant, hasLogo);
        if (unitPriceMinor !== line.unitPriceMinor) conflict("An item price changed. Review your updated cart and try again.");
        return { ...line, unitPriceMinor, name: product.name, variantName: variant.name, warranty: productWarranty(product) };
      }));
      const subtotalMinor = items.reduce((total, item) => total + item.unitPriceMinor * item.quantity, 0);
      let discountMinor = 0;
      if (input.coupon) {
        const [coupon] = await tx.select().from(storeCoupons).where(eq(storeCoupons.code, input.coupon.code)).for("share");
        if (!coupon?.active) conflict("This coupon is no longer available. Remove it and review your total.");
        discountMinor = couponDiscount(subtotalMinor, coupon.percent);
        if (discountMinor !== input.coupon.discountMinor) conflict("The coupon discount changed. Review your updated total.");
      }
      const paymentMethod = input.payment?.method ?? "COD";
      const paymentAmountMinor = paymentDueNow(subtotalMinor + shippingMinor - discountMinor, paymentMethod, codAdvanceTaka, { zone, codAdvanceInsideDhaka });
      if ((input.payment?.amountMinor ?? 0) !== paymentAmountMinor) conflict("Payment amount changed. Review the updated amount before paying. If you already paid, contact Oneinfo with your transaction ID.");
      const transactionId = input.payment?.transactionId ?? null;
      if (!reserving && paymentAmountMinor > 0 && !transactionId) conflict("Enter your transaction ID.");
      if (paymentAmountMinor === 0 && transactionId) conflict("No advance payment is required for this order.");
      const awaitingPayment = reserving && paymentAmountMinor > 0;
      const [order] = await tx.insert(storeOrders).values({
        activationMethod: "ORDER_SECRET", requestId, requestHash, customer: input.customer, deliveryAddress: input.deliveryAddress,
        stockReservations: catalog.flatMap(product => product.variants.filter(variant => variant.stockQuantity !== undefined && requestedQuantities.has(`${product.id}:${variant.id}`))
          .map(variant => ({ productId: product.id, variantId: variant.id, quantity: requestedQuantities.get(`${product.id}:${variant.id}`)! }))),
        items, shippingZone: zone, subtotalMinor, shippingMinor, couponCode: input.coupon?.code, discountMinor,
        paymentMethod, paymentAmountMinor, transactionId, paymentSenderNumber: senderNumber, awaitingPayment,
        invoiceNumber: awaitingPayment ? null : await nextInvoiceNumber(tx),
      }).onConflictDoNothing({ target: storeOrders.transactionId }).returning();
      if (!order) conflict("This transaction ID is already linked to an order.");
      for (const product of catalog) {
        if (!product.variants.some(variant => variant.stockQuantity !== undefined && requestedQuantities.has(`${product.id}:${variant.id}`))) continue;
        const variants = product.variants.map(variant => variant.stockQuantity !== undefined && requestedQuantities.has(`${product.id}:${variant.id}`)
          ? { ...variant, stockQuantity: Math.max(0, variant.stockQuantity - requestedQuantities.get(`${product.id}:${variant.id}`)!) } : variant);
        await tx.update(products).set({ variants, version: product.version + 1, updatedAt: new Date() }).where(eq(products.id, product.id));
      }
      await createOrderProfiles(tx, order);
      if (!order.awaitingPayment) await queueOrderEmail(tx, order.id, "confirmation");
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
    const emailStatus = !order.awaitingPayment && confirmationEmailEnabled ? await attemptOrderEmail(order.id, "confirmation", async () =>
      await sendOrderConfirmation({ ...result, customer: order.customer, deliveryAddress: order.deliveryAddress, items: order.items }, true, true) === "accepted") : undefined;
    if (emailStatus === "failed") request.log.warn({ orderId: order.id }, "Order confirmation email was not accepted");
    if (emailStatus) result.confirmationEmail = emailStatus;
    if (created && !order.awaitingPayment) {
      void sendMetaPurchaseEvent(order, result.totalMinor, {
        ip: request.ip,
        userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : undefined,
      });
    }
    return created ? sendCreated(reply, result) : result;
  });
};
