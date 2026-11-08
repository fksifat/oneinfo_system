import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { config } from "../config.js";
import { customerProfiles, orderActivationProfiles, storeOrders, cards, cardBatches, cardActivationSecrets, orderCardAllocations, customerAccounts } from "../db/schema.js";
import { isManagedCardUrl } from "./card-urls.js";
import { codeHash } from "./customer-auth.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const orderSecretHash = (code: string) => codeHash("order-activation", code);
const key = () => createHash("sha256").update(`oneinfo-order-secrets:${config.JWT_SECRET}`).digest();

export function encryptOrderCode(code: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  return Buffer.concat([iv, cipher.update(code, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
}
export function decryptOrderCode(value: string) {
  const bytes = Buffer.from(value, "base64"), decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString("utf8");
}

export async function createOrderProfiles(tx: Tx, order: typeof storeOrders.$inferSelect) {
  if (order.activationMethod !== "ORDER_SECRET") return;
  const existing = await tx.select().from(orderActivationProfiles).where(eq(orderActivationProfiles.orderId, order.id));
  const profiles: (typeof customerProfiles.$inferInsert)[] = [];
  const slots: (typeof orderActivationProfiles.$inferInsert)[] = [];
  for (const [lineIndex, item] of order.items.entries()) {
    for (let unitIndex = 0; unitIndex < item.quantity; unitIndex++) {
      if (existing.some(row => row.lineIndex === lineIndex && row.unitIndex === unitIndex)) continue;
      const profileId = randomUUID(), code = randomBytes(10).toString("hex").toUpperCase();
      // Order contact details stay private; the client supplies their public profile during activation.
      profiles.push({ id: profileId, publicSlug: `client-${randomBytes(12).toString("hex")}`,
        displayName: order.customer.name.slice(0, 120), published: false });
      slots.push({ orderId: order.id, profileId, lineIndex, unitIndex,
        codeHash: orderSecretHash(code), encryptedCode: encryptOrderCode(code) });
    }
  }
  if (profiles.length) {
    await tx.insert(customerProfiles).values(profiles);
    await tx.insert(orderActivationProfiles).values(slots);
  }
}

export async function orderProfileCodes(tx: Tx, orderId: string) {
  const rows = await tx.select().from(orderActivationProfiles).where(eq(orderActivationProfiles.orderId, orderId))
    .orderBy(asc(orderActivationProfiles.lineIndex), asc(orderActivationProfiles.unitIndex));
  return rows.map(({ id, profileId, lineIndex, unitIndex, cardId, redeemedAt, encryptedCode }) => ({ id, profileId, lineIndex, unitIndex, cardId,
    redeemedAt: redeemedAt?.toISOString() ?? null,
    secretCode: !redeemedAt && encryptedCode ? decryptOrderCode(encryptedCode).match(/.{4}/g)!.join("-") : null }));
}

export async function pendingOrderProfile(tx: Tx, id: string) {
  const [entry] = await tx.select({ slot: orderActivationProfiles, order: storeOrders }).from(orderActivationProfiles)
    .innerJoin(storeOrders, eq(storeOrders.id, orderActivationProfiles.orderId))
    .where(and(eq(orderActivationProfiles.id, id), isNull(orderActivationProfiles.redeemedAt)))
    .for("update", { of: [storeOrders, orderActivationProfiles] });
  if (!entry || entry.order.activationMethod !== "ORDER_SECRET" || entry.order.cancelledAt || entry.order.awaitingPayment || !entry.order.packedAt ||
    (entry.order.paymentAmountMinor > 0 && !entry.order.paymentVerifiedAt)) {
    throw Object.assign(new Error("Activation code is unavailable or the order is not ready."), { statusCode: 409 });
  }
  return entry;
}

function fail(message: string, statusCode = 409): never { throw Object.assign(new Error(message), { statusCode }); }

export async function readyCard(tx: Tx, cardId: string) {
  const [card] = await tx.select().from(cards).where(eq(cards.id, cardId)).for("update");
  if (!card) fail("Card not found", 404);
  const [batch] = await tx.select().from(cardBatches).where(eq(cardBatches.id, card.batchId));
  if (card.customerAccountId || card.companyId || !batch?.printConfirmedAt || card.qcStatus !== "PASSED" || !["QC_PASSED", "ACTIVATED"].includes(card.lifecycleStatus)) {
    fail("This card is already claimed or is not ready for activation.");
  }
  if (card.profileId) {
    const [profile] = await tx.select().from(customerProfiles).where(eq(customerProfiles.id, card.profileId));
    if (profile?.published) fail("This card already has a published owner profile.");
  }
  return card;
}

export async function orderProfileClaimable(tx: Tx, cardId: string, orderProfileId: string) {
  const entry = await pendingOrderProfile(tx, orderProfileId);
  const card = await readyCard(tx, cardId);
  const [allocation] = await tx.select().from(orderCardAllocations).where(eq(orderCardAllocations.cardId, cardId));
  const [legacySecret] = await tx.select().from(cardActivationSecrets).where(eq(cardActivationSecrets.cardId, cardId));
  const [owner] = await tx.select().from(customerAccounts).where(eq(customerAccounts.profileId, entry.slot.profileId));
  const [profile] = await tx.select().from(customerProfiles).where(eq(customerProfiles.id, entry.slot.profileId)).for("update");
  if (card.profileId || allocation || legacySecret || card.inventoryStatus !== "SALEABLE" ||
    card.qrStatus !== "GENERATED" || card.nfcStatus !== "WRITTEN" || !isManagedCardUrl(card.canonicalUrl, card.publicSlug) ||
    owner || !profile || profile.published) fail("This card or temporary profile is no longer available for activation.");
  return card;
}
