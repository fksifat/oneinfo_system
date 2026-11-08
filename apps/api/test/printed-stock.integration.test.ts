import { qrUrl } from "../src/domain/card-urls.js";
import { randomUUID, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { request as httpsRequest } from "node:https";
import { configureLanConnection, lanAddresses, loadLanIdentity } from "../src/domain/lan-connection.js";

const networkFetch = globalThis.fetch;

// This suite only mutates the disposable database created by test:printed-stock.
describe.skipIf(process.env.ONEINFO_PRINT_STOCK_TEST !== "1")("confirmed print stock and orders", () => {
  let app: FastifyInstance;
  let client: typeof import("../src/db/client.js");
  let schema: typeof import("../src/db/schema.js");
  let headers: Record<string, string>;
  let failNextShippingEmail = false;
  let rejectEmployeeEmail = "";
  const productId = randomUUID(), variantId = randomUUID();

  beforeAll(async () => {
    const { config } = await import("../src/config.js");
    if (!/^\/oneinfo_print_stock_\d+_test$/.test(new URL(config.DATABASE_URL).pathname)) throw new Error("Disposable test database required");
    Object.assign(config, {
      BREVO_SMTP_USER: undefined,
      BREVO_SMTP_KEY: undefined,
      RESEND_API_KEY: "test-key",
      ORDER_EMAIL_FROM: "Oneinfo <test@example.com>",
      STOREFRONT_URL: "https://example.com",
      CRM_LEAD_WEBHOOK_URL: "https://crm.example.com/leads",
      CRM_LEAD_WEBHOOK_TOKEN: undefined,
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === config.CRM_LEAD_WEBHOOK_URL) return Response.json({ accepted: true });
      if (url !== "https://api.resend.com/emails") throw new Error("Unexpected external request");
      if (failNextShippingEmail && String(init?.body).includes("Your Oneinfo order has shipped")) {
        failNextShippingEmail = false;
        return Response.json({}, { status: 503 });
      }
      if (rejectEmployeeEmail && String(init?.body).includes("Your Oneinfo employee profile is ready") &&
        JSON.parse(String(init?.body)).to.includes(rejectEmployeeEmail)) return Response.json({}, { status: 503 });
      return Response.json({ id: "test-email" });
    }));
    client = await import("../src/db/client.js");
    schema = await import("../src/db/schema.js");
    app = (await import("../src/app.js")).buildApp();
    app.log.level = "silent";
    const auth = (await app.inject({ method: "POST", url: "/api/v1/dev/token" })).json();
    headers = { authorization: `Bearer ${auth.accessToken}` };
    const station = (await app.inject({ method: "POST", url: "/api/v1/production/stations/register", headers,
      payload: { stationCode: "PRINT-TEST", name: "Print test" } })).json();
    headers["x-station-key"] = station.stationCredential;
    await client.db.insert(schema.products).values({ id: productId, slug: "test-card", name: "Test card", priceMinor: 50000, status: "PUBLISHED",
      variants: [{ id: variantId, name: "Standard", priceMinor: 50000, available: true, imageUrl: "" }] });
    await client.db.insert(schema.storeShippingSettings).values({ id: "default", rates: { insideDhaka: 6000, subDhaka: 10000, outsideDhaka: 12000 }, codAdvanceTaka: 0 });
  }, 30_000);
  beforeEach(async () => {
    failNextShippingEmail = false;
    rejectEmployeeEmail = "";
    await client.db.execute(sql`truncate table card_batches, customer_profiles, store_orders, audit_logs cascade`);
  });
  afterAll(async () => { await app?.close(); await client?.closeDatabase(); vi.unstubAllGlobals(); });

  async function request(url: string, payload?: object) {
    const response = await app.inject({ method: payload ? "POST" : "GET", url, headers, ...(payload && { payload }) });
    expect(response.statusCode, response.body).toBeLessThan(300);
    return response.json();
  }
  async function batch(quantity: number, generate = true) {
    const created = await request("/api/v1/production/batches", { batchCode: randomUUID(), productVariantId: "ONEINFO-NFC-CARD", quantity });
    if (generate) await request(`/api/v1/production/batches/${created.id}/generate-qr`, {});
    return created;
  }
  const confirm = (id: string) => request(`/api/v1/production/batches/${id}/confirm-print`, { confirmed: true });

  it("creates the maximum batch with unique cards, all jobs and complete creation history", async () => {
    const created = await batch(1000, false);
    const rows = await client.db.select().from(schema.cards).where(eq(schema.cards.batchId, created.id));
    const jobs = await client.db.select().from(schema.productionJobs).where(eq(schema.productionJobs.batchId, created.id));
    const events = await client.db.select().from(schema.cardEvents);
    expect(rows).toHaveLength(1000);
    expect(new Set(rows.map(row => row.publicSlug)).size).toBe(1000);
    expect(jobs).toHaveLength(3000);
    expect(rows.every(row => jobs.filter(job => job.cardId === row.id).length === 3)).toBe(true);
    expect(events).toHaveLength(1000);
    expect(events.map(event => Number(event.metadata.sequence)).sort((a, b) => a - b)).toEqual(Array.from({ length: 1000 }, (_, index) => index + 1));
    expect(rows.every(row => row.profileId === null && row.inventoryStatus === "NOT_READY")).toBe(true);
  });

  const removeStock = (created: { id: string; batchCode: string }, card?: { id: string; publicSlug: string }, confirmation = card?.publicSlug ?? created.batchCode) => app.inject({
    method: "DELETE", url: `/api/v1/production/batches/${created.id}${card ? `/cards/${card.id}` : ""}`, headers, payload: { confirmation },
  });

  it("deletes individual draft cards, adjusts quantities, and removes the last empty batch", async () => {
    const created = await batch(2, false);
    const [first, second] = await client.db.select().from(schema.cards);
    expect((await removeStock(created, first!, "wrong confirmation")).statusCode).toBe(400);
    expect(await client.db.select().from(schema.cards)).toHaveLength(2);
    expect((await removeStock(created, first!)).json()).toMatchObject({ deleted: 1, batchDeleted: false });
    expect((await request(`/api/v1/production/batches/${created.id}`)).plannedQuantity).toBe(1);
    expect(await client.db.select().from(schema.productionJobs)).toHaveLength(3);
    expect((await removeStock(created, second!)).json()).toMatchObject({ deleted: 1, batchDeleted: true });
    expect(await client.db.select().from(schema.cardBatches)).toHaveLength(0);
    expect(await client.db.select().from(schema.productionJobs)).toHaveLength(0);
    expect(await client.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "PRODUCTION_CARD_DELETED"))).toHaveLength(2);
  });

  it("removes confirmed stock from Admin and deletes all dependent evidence while retaining an audit", async () => {
    const card = await readyForClaim();
    const created = (await request(`/api/v1/production/batches/${card.batchId}`));
    const jobs = await client.db.select().from(schema.productionJobs);
    const [actor] = await client.db.select().from(schema.operators);
    const stationId = headers["x-station-key"]!.split(".")[0]!;
    await client.db.insert(schema.nfcEncodingAttempts).values({ jobId: jobs.find(job => job.type === "NFC_ENCODING")!.id,
      cardId: card.id, stationId, operatorId: actor!.id, idempotencyKey: randomUUID(), result: "SUCCEEDED", expectedUrlHash: "a".repeat(64) });
    await client.db.insert(schema.qualityChecks).values({ jobId: jobs.find(job => job.type === "QUALITY_CONTROL")!.id,
      cardId: card.id, inspectorId: actor!.id, idempotencyKey: randomUUID(), result: "PASSED" });
    await client.db.insert(schema.cardVerifications).values({ cardId: card.id, stationId, method: "QR_CAMERA", expectedUrl: qrUrl(card.canonicalUrl), scannedValue: qrUrl(card.canonicalUrl), matched: true });
    expect((await request("/api/v1/admin/cards")).items).toHaveLength(1);
    const removed = await removeStock(created);
    expect(removed.statusCode, removed.body).toBe(200);
    expect((await request("/api/v1/admin/cards")).items).toHaveLength(0);
    expect((await request("/api/v1/admin/batches")).items).toHaveLength(0);
    for (const table of [schema.cards, schema.cardBatches, schema.productionJobs, schema.qrArtifacts, schema.nfcEncodingAttempts, schema.qualityChecks, schema.cardVerifications, schema.cardEvents, schema.cardActivationSecrets]) {
      expect(await client.db.select().from(table)).toHaveLength(0);
    }
    expect((await app.inject(`/api/v1/customer/cards/${card.publicSlug}`)).statusCode).toBe(404);
    const audit = await client.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "PRODUCTION_BATCH_DELETED"));
    expect(audit).toHaveLength(1);expect(JSON.stringify(audit)).not.toContain("codeHash");
  });

  it("protects activation-code stock reserved for client handover", async () => {
    const card = await readyForClaim();await issue(card.id);
    const created = await request(`/api/v1/production/batches/${card.batchId}`);
    expect((await removeStock(created)).statusCode).toBe(409);
    expect(await client.db.select().from(schema.cardActivationSecrets)).toHaveLength(1);
    expect(await client.db.select().from(schema.cards)).toHaveLength(1);
  });

  it("keeps the whole batch when an order owns a card but still permits deletion of an unused sibling", async () => {
    const created = await batch(2);await confirm(created.id);await order();
    const rows = await client.db.select().from(schema.cards);
    const reserved = rows.find(card => card.inventoryStatus === "RESERVED")!, free = rows.find(card => card.id !== reserved.id)!;
    expect((await removeStock(created)).statusCode).toBe(409);
    expect((await removeStock(created, reserved)).statusCode).toBe(409);
    expect(await client.db.select().from(schema.cards)).toHaveLength(2);
    expect(await client.db.select().from(schema.qrArtifacts)).toHaveLength(2);
    expect((await removeStock(created, free)).statusCode).toBe(200);
    expect((await request("/api/v1/admin/cards")).items).toHaveLength(1);
    expect((await request(`/api/v1/production/batches/${created.id}`)).plannedQuantity).toBe(1);
    expect(await client.db.select().from(schema.orderCardAllocations)).toHaveLength(1);
  });

  it.each(["profile", "customer", "company", "dispatched"] as const)("protects %s-linked cards from deletion", async kind => {
    const created = await batch(1);
    const [card] = await client.db.select().from(schema.cards);
    const profile = await request("/api/v1/profiles", { publicSlug: `delete-guard-${kind}`, displayName: "Protected Owner" });
    const [account] = await client.db.insert(schema.customerAccounts).values({ email: randomUUID() + "@example.com", passwordHash: "test-only", profileId: profile.id }).returning();
    if (kind === "company") {
      const [company] = await client.db.insert(schema.companies).values({ name: "Protected Company", ownerAccountId: account!.id }).returning();
      await client.db.update(schema.cards).set({ companyId: company!.id }).where(eq(schema.cards.id, card!.id));
    } else await client.db.update(schema.cards).set(kind === "profile" ? { profileId: profile.id } : kind === "customer" ? { customerAccountId: account!.id } : { inventoryStatus: "DISPATCHED" }).where(eq(schema.cards.id, card!.id));
    expect((await removeStock(created, card!)).statusCode).toBe(409);
    expect(await client.db.select().from(schema.cards)).toHaveLength(1);
    expect(await client.db.select().from(schema.customerAccounts)).toHaveLength(1);
  });

  it("refuses deletion during a claimed NFC job and rejects cards outside the selected batch", async () => {
    const created = await batch(1), other = await batch(1);
    const [card] = await client.db.select().from(schema.cards).where(eq(schema.cards.batchId, created.id));
    expect((await removeStock(other, card!)).statusCode).toBe(404);
    const jobs = await client.db.select().from(schema.productionJobs).where(eq(schema.productionJobs.cardId, card!.id));
    const job = jobs.find(item => item.type === "NFC_ENCODING")!;
    await request(`/api/v1/production/jobs/${job.id}/claim`, { idempotencyKey: randomUUID() });
    expect((await removeStock(created)).statusCode).toBe(409);
    expect(await client.db.select().from(schema.cards)).toHaveLength(2);
  });

  it.each(["PRODUCTION_OPERATOR", "INVENTORY_MANAGER"] as const)("requires deletion permission for %s", async role => {
    const created = await batch(1, false);
    const url = `/api/v1/production/batches/${created.id}`;
    const payload = { confirmation: created.batchCode };
    expect((await app.inject({ method: "DELETE", url, payload })).statusCode).toBe(401);
    const [actor] = await client.db.insert(schema.operators).values({ email: randomUUID() + "@example.com", displayName: "Delete role test", role }).returning();
    const { issueOperatorToken } = await import("../src/auth.js");
    const token = await issueOperatorToken({ operatorId: actor!.id, email: actor!.email, role });
    try {
      const result = await app.inject({ method: "DELETE", url, headers: { authorization: `Bearer ${token}` }, payload });
      expect(result.statusCode).toBe(role === "INVENTORY_MANAGER" ? 200 : 403);
    } finally { await client.db.delete(schema.operators).where(eq(schema.operators.id, actor!.id)); }
  });

  it("clears the removed card's phone selection and expected-card lock", async () => {
    const created = await batch(1);
    const [card] = await client.db.select().from(schema.cards);
    const send = await phone();
    await request("/api/v1/local-nfc/expected-card", { cardId: card!.id });
    const scanId = randomUUID();
    expect((await send("resolve-qr", { scanId, scannedValue: qrUrl(card!.canonicalUrl) })).statusCode).toBe(200);
    expect((await removeStock(created)).statusCode).toBe(200);
    expect(await request("/api/v1/local-nfc/latest-qr-scan")).toMatchObject({ scan: null, expected: null });
    expect((await send("load-to-nfc", { scanId })).statusCode).toBe(404);
  });

  it("serializes deletion against concurrent order allocation without orphaning either record", async () => {
    const created = await batch(1);await confirm(created.id);
    const [removed] = await Promise.all([removeStock(created), order()]);
    expect([200, 409]).toContain(removed.statusCode);
    const allocations = await client.db.select().from(schema.orderCardAllocations), rows = await client.db.select().from(schema.cards);
    expect(await client.db.select().from(schema.storeOrders)).toHaveLength(1);
    expect(allocations).toHaveLength(removed.statusCode === 200 ? 0 : 1);
    expect(rows).toHaveLength(allocations.length);
  });

  it("refreshes an older QR design without changing card links or discarding the previous artifact", async () => {
    const created = await batch(1);
    const [card] = await client.db.select().from(schema.cards).where(eq(schema.cards.batchId, created.id));
    const [original] = await client.db.select().from(schema.qrArtifacts);
    await client.db.update(schema.qrArtifacts).set({ generatorVersion: "qrcode-js/1.5.4" }).where(eq(schema.qrArtifacts.id, original!.id));
    const generated = await request(`/api/v1/production/batches/${created.id}/generate-qr`, {});
    expect(generated.generated).toBe(1);
    expect((await request(`/api/v1/production/batches/${created.id}/generate-qr`, {})).generated).toBe(0);
    expect(await client.db.select().from(schema.qrArtifacts)).toHaveLength(2);
    expect((await client.db.select().from(schema.cards))[0]!.canonicalUrl).toBe(card!.canonicalUrl);
    expect((await client.db.select().from(schema.productionJobs)).find(job => job.type === "QR_GENERATION")!.status).toBe("COMPLETED");
  });

  it("allocates unchanged legacy QR links only when their previous domain is explicitly configured", async () => {
    const { config } = await import("../src/config.js");
    const original = config.PUBLIC_CARD_BASE_URL_ALIASES;
    try {
      config.PUBLIC_CARD_BASE_URL_ALIASES = ["https://legacy.example/c"];
      const created = await batch(1, false);
      const [card] = await client.db.select().from(schema.cards).where(eq(schema.cards.batchId, created.id));
      const link = `https://legacy.example/c/${card!.publicSlug}`;
      await client.db.update(schema.cards).set({ canonicalUrl: link }).where(eq(schema.cards.id, card!.id));
      await request(`/api/v1/production/batches/${created.id}/generate-qr`, {});
      await confirm(created.id);await order();
      const [allocated] = await client.db.select().from(schema.orderCardAllocations);
      expect(allocated?.cardId).toBe(card!.id);
      expect((await client.db.select().from(schema.cards))[0]?.canonicalUrl).toBe(link);
    } finally { config.PUBLIC_CARD_BASE_URL_ALIASES = original; }
  });

  it("prevents legacy assignment from bypassing an order's secret-code activation", async () => {
    const card = await readyForClaim();await order();
    const profile = await request("/api/v1/profiles", { publicSlug: "assignment-guard", displayName: "Assignment Guard" });
    const result = await app.inject({ method: "POST", url: `/api/v1/profiles/${profile.id}/assign-card`, headers, payload: { cardId: card.id } });
    expect(result.statusCode).toBe(409);
    expect((await client.db.select().from(schema.cards))[0]?.profileId).toBeNull();
  });

  it("requires confirmed stock for manual assignment and reserves it idempotently", async () => {
    const created = await batch(1);
    const [card] = await client.db.select().from(schema.cards).where(eq(schema.cards.batchId, created.id));
    await client.db.update(schema.cards).set({ qcStatus: "PASSED", lifecycleStatus: "QC_PASSED", inventoryStatus: "SALEABLE" }).where(eq(schema.cards.id, card!.id));
    const profile = await request("/api/v1/profiles", { publicSlug: "manual-assignment", displayName: "Manual Assignment" });
    const path = `/api/v1/profiles/${profile.id}/assign-card`;
    expect((await app.inject({ method: "POST", url: path, headers, payload: { cardId: card!.id } })).statusCode).toBe(409);
    await confirm(created.id);await request(path, { cardId: card!.id });await request(path, { cardId: card!.id });
    expect((await client.db.select().from(schema.cards))[0]).toMatchObject({ inventoryStatus: "RESERVED", profileId: profile.id });
    const events = await client.db.select().from(schema.cardEvents).where(eq(schema.cardEvents.eventType, "PROFILE_ASSIGNED"));
    expect(events).toHaveLength(1);
  });
  it("reports only this workstation's latest recognized phone QR", async () => {
    expect((await request("/api/v1/local-nfc/latest-qr-scan")).scan).toBeNull();
    const first = await batch(1), second = await batch(1);
    const pairing = await request("/api/v1/local-nfc/pairings", {});
    const paired = (await app.inject({ method: "POST", url: "/api/v1/local-nfc/devices/pair", payload: { pairingCode: pairing.pairingCode, deviceName: "Scan selection test" } })).json();
    const deviceHeaders = { "x-oneinfo-device-token": paired.deviceToken };
    const [expected] = await client.db.select().from(schema.cards).where(eq(schema.cards.batchId, first.id));
    const [different] = await client.db.select().from(schema.cards).where(eq(schema.cards.batchId, second.id));
    await request("/api/v1/local-nfc/expected-card", { cardId: expected!.id });
    const wrongScan = { scanId: randomUUID(), scannedValue: qrUrl(different!.canonicalUrl) };
    for (const action of ["resolve-qr", "verification-from-qr"]) {
      const rejected = await app.inject({ method: "POST", url: `/api/v1/local-nfc/device/${action}`, headers: deviceHeaders, payload: wrongScan });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json().message).toContain("Wrong card");
    }
    expect((await request("/api/v1/local-nfc/latest-qr-scan")).scan).toBeNull();
    await request("/api/v1/local-nfc/expected-card", { cardId: null });
    for (const created of [first, second]) {
      const [card] = await client.db.select().from(schema.cards).where(eq(schema.cards.batchId, created.id));
      const scanId = randomUUID();
      const result = await app.inject({ method: "POST", url: "/api/v1/local-nfc/device/resolve-qr", headers: deviceHeaders, payload: { scanId, scannedValue: qrUrl(card!.canonicalUrl) } });
      expect(result.statusCode).toBe(200);
      expect((await request("/api/v1/local-nfc/latest-qr-scan")).scan).toMatchObject({ id: scanId, cardId: card!.id, batchId: created.id });
    }
    const other = await request("/api/v1/production/stations/register", { stationCode: randomUUID(), name: "Other scan station" });
    const isolated = await app.inject({ method: "GET", url: "/api/v1/local-nfc/latest-qr-scan", headers: { ...headers, "x-station-key": other.stationCredential } });
    expect(isolated.json().scan).toBeNull();
    expect((await app.inject({ method: "GET", url: "/api/v1/local-nfc/latest-qr-scan" })).statusCode).toBe(401);
  });
  function orderPayload(quantity = 1) {
    return { requestId: randomUUID(), customer: { name: "Test buyer", email: "buyer@example.com", phone: "01712345678" },
      deliveryAddress: { district: "Dhaka", dhakaArea: "city", addressLine: "Test address" }, shippingMinor: 6000,
      items: [{ productId, variantId, quantity, unitPriceMinor: 50000 }] };
  }
  async function legacyOrder(payload: object) {
    const placed = await request("/api/v1/orders", payload);
    const { allocatePendingOrders } = await import("../src/domain/printed-stock.js");
    await client.db.transaction(async tx => {
      const slots = await tx.select().from(schema.orderActivationProfiles).where(eq(schema.orderActivationProfiles.orderId, placed.id));
      await tx.delete(schema.orderActivationProfiles).where(eq(schema.orderActivationProfiles.orderId, placed.id));
      for (const slot of slots) await tx.delete(schema.customerProfiles).where(eq(schema.customerProfiles.id, slot.profileId));
      await tx.update(schema.storeOrders).set({ invoiceNumber: null, activationMethod: "LEGACY" }).where(eq(schema.storeOrders.id, placed.id));
      await allocatePendingOrders(tx);
    });
    const admin = await request("/api/v1/orders/admin", { query: placed.id });
    return { ...placed, ...admin.items[0] };
  }
  const order = (quantity = 1) => legacyOrder(orderPayload(quantity));

  it("keeps work counts, card lookup, reprints and packing in sync", async () => {
    const placed = await order(2);
    expect((await request("/api/v1/admin/overview")).attention).toMatchObject({ print: 2 });
    expect((await request("/api/v1/admin/tasks?stage=print")).items).toEqual([expect.objectContaining({ orderId: placed.id, units: 2 })]);
    const created = await batch(2);
    await confirm(created.id);
    const [first, second] = await client.db.select().from(schema.cards).where(eq(schema.cards.batchId, created.id));
    expect(await request("/api/v1/admin/cards/lookup", { value: qrUrl(first!.canonicalUrl) })).toMatchObject({
      id: first!.id, batchId: created.id, orderId: placed.id, inventoryStatus: "RESERVED",
    });
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/cards/lookup", payload: { value: first!.publicSlug } })).statusCode).toBe(401);
    const reprint = await request(`/api/v1/admin/batches/${created.id}/reprint`);
    const artifacts = await client.db.select().from(schema.qrArtifacts);
    expect(reprint.items).toContainEqual(expect.objectContaining({ id: first!.id, imageData: artifacts.find(item => item.cardId === first!.id)!.imageData }));
    expect(artifacts).toHaveLength(2);
    const pack = (scans: string[]) => app.inject({ method: "POST", url: `/api/v1/orders/admin/${placed.id}/packing-check`, headers, payload: { scans } });
    expect((await pack([first!.publicSlug, second!.publicSlug])).statusCode).toBe(409);
    await client.db.update(schema.cards).set({ qcStatus: "PASSED", nfcStatus: "WRITTEN", lifecycleStatus: "QC_PASSED" }).where(eq(schema.cards.id, first!.id));
    expect((await request("/api/v1/admin/tasks?stage=packing")).items).toHaveLength(0);
    await client.db.update(schema.cards).set({ qcStatus: "PASSED", nfcStatus: "WRITTEN", lifecycleStatus: "QC_PASSED" }).where(eq(schema.cards.id, second!.id));
    expect((await request("/api/v1/admin/overview")).attention).toMatchObject({ packing: 2 });
    expect((await pack([first!.publicSlug, qrUrl(first!.canonicalUrl)])).statusCode).toBe(409);
    expect((await pack([first!.publicSlug, "wrong-card"])).statusCode).toBe(409);
    expect((await pack([first!.publicSlug, qrUrl(second!.canonicalUrl)])).json()).toEqual({ checked: 2 });
    await client.db.update(schema.storeOrders).set({ deliveredAt: new Date() }).where(eq(schema.storeOrders.id, placed.id));
    expect((await request("/api/v1/admin/activation-follow-up")).items).toHaveLength(2);
    expect((await request("/api/v1/admin/stations")).items).toContainEqual(expect.objectContaining({ online: true }));
    const [review] = await client.db.insert(schema.storeReviews).values({
      orderId: placed.id, productId, displayName: "Buyer", rating: 2, title: "Needs follow-up", body: "The package arrived late.",
    }).returning();
    expect((await request("/api/v1/reviews/admin?inbox=low")).items).toContainEqual(expect.objectContaining({ id: review!.id, seen: false }));
    await request(`/api/v1/reviews/admin/${review!.id}/seen`, {});
    expect((await request("/api/v1/reviews/admin?inbox=new")).items).not.toContainEqual(expect.objectContaining({ id: review!.id }));
    expect((await request("/api/v1/reviews/admin?inbox=seen")).items).toContainEqual(expect.objectContaining({ id: review!.id, seen: true }));
  });

  it("prepares and confirms ordered cards individually without duplicating assigned stock or QR artifacts", async () => {
    const [essential] = await client.db.select().from(schema.products).where(eq(schema.products.slug, "oneinfo-essential"));
    const variant = essential!.variants[0]!;
    const buy = (quantity: number) => legacyOrder({
      ...orderPayload(quantity), items: [{ productId: essential!.id, variantId: variant.id, quantity, unitPriceMinor: variant.salePriceMinor ?? variant.priceMinor }],
    });
    const print = (id: string, unitIndex: number, action: "prepare" | "confirm") =>
      request(`/api/v1/orders/admin/${id}/card-print`, { lineIndex: 0, unitIndex, action });
    const single = await buy(1);
    const attempt = (id: string) => app.inject({ method: "POST", url: `/api/v1/orders/admin/${id}/card-print`, headers,
      payload: { lineIndex: 0, unitIndex: 0, action: "prepare" } });
    const unsupported = await order();
    expect((await attempt(unsupported.id)).statusCode).toBe(409);
    await client.db.update(schema.storeOrders).set({ cancelledAt: new Date() }).where(eq(schema.storeOrders.id, unsupported.id));
    await client.db.update(schema.storeOrders).set({ paymentAmountMinor: 10000 }).where(eq(schema.storeOrders.id, single.id));
    expect((await attempt(single.id)).statusCode).toBe(409);
    expect(await client.db.select().from(schema.orderCardAllocations)).toHaveLength(0);
    await client.db.update(schema.storeOrders).set({ paymentVerifiedAt: new Date() }).where(eq(schema.storeOrders.id, single.id));
    const [first, replay] = await Promise.all([print(single.id, 0, "prepare"), print(single.id, 0, "prepare")]);
    expect(first).toEqual(replay);
    expect(first.imageData).toMatch(/^data:image\/png;base64,/);
    const batches = () => client.db.select().from(schema.cardBatches);
    expect((await batches())[0]!.printConfirmedAt).toBeNull();
    expect(await client.db.select().from(schema.qrArtifacts)).toHaveLength(1);
    expect(await print(single.id, 0, "confirm")).toEqual({ printed: true });
    expect(await print(single.id, 0, "confirm")).toEqual({ printed: true });
    expect((await batches())[0]!.printConfirmedAt).toBeTruthy();
    expect((await request("/api/v1/admin/batches")).items).toHaveLength(1);
    expect((await request("/api/v1/admin/cards")).items).toHaveLength(1);
    const stock = await batch(1);
    await confirm(stock.id);
    const multi = await buy(2);
    expect(await print(multi.id, 0, "prepare")).toEqual({ printed: true });
    expect(await batches()).toHaveLength(2);
    expect((await print(multi.id, 1, "prepare")).printed).toBe(false);
    expect((await batches()).filter(item => !item.printConfirmedAt)).toHaveLength(1);
    expect(await print(multi.id, 1, "confirm")).toEqual({ printed: true });
    const allocations = await client.db.select().from(schema.orderCardAllocations);
    expect(new Set(allocations.map(item => item.cardId)).size).toBe(3);
    const cards = await client.db.select().from(schema.cards);
    expect(cards.every(card => card.nfcStatus === "PENDING" && card.qcStatus === "PENDING")).toBe(true);
  });

  it("limits checkout spam without blocking a saved order's retry receipt", async () => {
    const payload = orderPayload();await request("/api/v1/orders", payload);
    const { allowAuthAttempt } = await import("../src/domain/auth-attempts.js");
    for (let index = 1; index < 20; index++) expect(await allowAuthAttempt("checkout:127.0.0.1", 20, 15 * 60_000)).toBe(true);
    expect((await app.inject({ method: "POST", url: "/api/v1/orders", payload: orderPayload() })).statusCode).toBe(429);
    expect((await app.inject({ method: "POST", url: "/api/v1/orders", payload })).statusCode).toBe(200);
    expect(await client.db.select().from(schema.storeOrders)).toHaveLength(1);
  });

  const publicDetails = { displayName: "Card Owner", headline: "Designer", company: "Oneinfo", phone: "+8801712345678",
    website: "https://example.com", links: [{ label: "Portfolio", url: "https://example.com/work" }] };
  async function readyForClaim() {
    const created = await batch(1);
    await confirm(created.id);
    const [card] = await client.db.select().from(schema.cards).where(eq(schema.cards.batchId, created.id));
    // Claim tests use a QC fixture; the phone workflow test above exercises actual production endpoints.
    await client.db.update(schema.cards).set({ nfcStatus: "WRITTEN", qcStatus: "PASSED", lifecycleStatus: "QC_PASSED", inventoryStatus: "SALEABLE" }).where(eq(schema.cards.id, card!.id));
    return card!;
  }
  const issue = (id: string, replaceExisting = false) => request(`/api/v1/customer/cards/${id}/activation-code`, { replaceExisting });
  const activate = (slug: string, secretCode: string) => request(`/api/v1/customer/cards/${slug}/activate`, { secretCode });
  const signup = (claimToken: string, email: string) => app.inject({ method: "POST", url: "/api/v1/customer/signup",
    payload: { claimToken, email, password: "a secure customer password", profile: publicDetails } });

  it("hides disabled profiles consistently across handles, legacy URLs, vCards and card endpoints", async () => {
    const card = await readyForClaim(), secret = await issue(card.id);
    const grant = await activate(card.publicSlug, secret.secretCode);
    expect((await signup(grant.claimToken, "visibility@example.com")).statusCode).toBe(201);
    const profile = (await request(`/api/v1/customer/cards/${card.publicSlug}`)).profile;
    const urls = [`/api/v1/profiles/handle/${profile.handle}`, `/api/v1/profiles/public/${profile.publicSlug}`,
      `/api/v1/profiles/public/${profile.publicSlug}/contact.vcf`, `/api/v1/profiles/card/${card.publicSlug}`];
    for (const url of urls) expect((await app.inject({ url })).statusCode).toBe(200);
    for (const lifecycleStatus of ["SUSPENDED", "RETIRED", "REPLACED"] as const) {
      await client.db.update(schema.cards).set({ lifecycleStatus }).where(eq(schema.cards.id, card.id));
      for (const url of urls) expect((await app.inject({ url })).statusCode, url).toBe(404);
      expect(await request(`/api/v1/customer/cards/${card.publicSlug}`)).toEqual({ status: "UNAVAILABLE" });
    }
    await client.db.update(schema.cards).set({ lifecycleStatus: "ACTIVATED" }).where(eq(schema.cards.id, card.id));
    await client.db.update(schema.customerAccounts).set({ active: false }).where(eq(schema.customerAccounts.profileId, profile.id));
    for (const url of urls) expect((await app.inject({ url })).statusCode, url).toBe(404);
    expect(await request(`/api/v1/customer/cards/${card.publicSlug}`)).toEqual({ status: "UNAVAILABLE" });
    expect((await app.inject({ method: "POST", url: `/api/v1/customer/cards/${card.publicSlug}/contact-leads`,
      payload: { requestId: randomUUID(), name: "Visitor", email: "visitor@example.com", consent: true } })).statusCode).toBe(404);
  });

  it("keeps a replacement profile visible while refusing old card routes and preserving suspension", async () => {
    const card = await readyForClaim(), secret = await issue(card.id);
    const grant = await activate(card.publicSlug, secret.secretCode);
    await signup(grant.claimToken, "replace-visibility@example.com");
    const profile = (await request(`/api/v1/customer/cards/${card.publicSlug}`)).profile;
    await client.db.update(schema.cards).set({ lifecycleStatus: "SUSPENDED" }).where(eq(schema.cards.id, card.id));
    const replacement = await readyForClaim();
    await request(`/api/v1/production/cards/${card.id}/replace`, { replacementSlug: replacement.publicSlug });
    expect((await client.db.select().from(schema.cards).where(eq(schema.cards.id, replacement.id)))[0]?.lifecycleStatus).toBe("SUSPENDED");
    expect((await app.inject({ url: `/api/v1/profiles/public/${profile.publicSlug}` })).statusCode).toBe(404);
    await client.db.update(schema.cards).set({ lifecycleStatus: "ACTIVATED" }).where(eq(schema.cards.id, replacement.id));
    expect((await app.inject({ url: `/api/v1/profiles/public/${profile.publicSlug}` })).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/v1/profiles/card/${card.publicSlug}` })).statusCode).toBe(404);
    expect((await request(`/api/v1/customer/cards/${replacement.publicSlug}`)).profile.id).toBe(profile.id);
    await client.db.update(schema.cards).set({ lifecycleStatus: "ACTIVATED", qcStatus: "FAILED" }).where(eq(schema.cards.id, card.id));
    expect((await app.inject({ url: `/api/v1/profiles/card/${card.publicSlug}` })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/v1/profiles/public/${profile.publicSlug}` })).statusCode).toBe(200);
    await client.db.update(schema.cards).set({ qcStatus: "PASSED" }).where(eq(schema.cards.id, card.id));
    await client.db.update(schema.cardBatches).set({ printConfirmedAt: null }).where(eq(schema.cardBatches.id, card.batchId));
    expect((await app.inject({ url: `/api/v1/profiles/card/${card.publicSlug}` })).statusCode).toBe(404);
    const unused = await readyForClaim();
    expect((await app.inject({ method: "POST", url: `/api/v1/profiles/${profile.id}/assign-card`, headers,
      payload: { cardId: unused.id } })).statusCode).toBe(409);
  });

  const secretCodes = (id: string) => request(`/api/v1/orders/admin/${id}/activation-codes`, {});
  const confirmPackage = (id: string) => request(`/api/v1/orders/admin/${id}/packing-check`, { confirmed: true });

  it("creates one private temporary profile and reusable packing slip per ordered unit without binding physical stock", async () => {
    const card = await readyForClaim(), payload = orderPayload(3);
    const placed = await request("/api/v1/orders", payload);
    await request("/api/v1/orders", payload);
    expect(placed.activationMethod).toBe("ORDER_SECRET");
    expect(await client.db.select().from(schema.customerProfiles)).toHaveLength(3);
    expect((await client.db.select().from(schema.customerProfiles)).every(p => !p.published && !p.email && !p.phone)).toBe(true);
    expect(await client.db.select().from(schema.customerAccounts)).toHaveLength(0);
    expect(await client.db.select().from(schema.orderCardAllocations)).toHaveLength(0);
    const codes = (await secretCodes(placed.id)).items;
    expect(codes).toHaveLength(3);
    expect(new Set(codes.map((row: any) => row.secretCode)).size).toBe(3);
    expect((await secretCodes(placed.id)).items).toEqual(codes);
    expect(await request(`/api/v1/customer/cards/${card.publicSlug}`)).toMatchObject({ status: "ACTIVATION_REQUIRED", activationMethod: "SECRET" });
    const admin = await request("/api/v1/orders/admin", { query: placed.id });
    expect(JSON.stringify(admin)).not.toContain(codes[0].secretCode);
    const stored = await client.db.select().from(schema.orderActivationProfiles);
    expect(JSON.stringify(stored)).not.toContain(codes[0].secretCode.replaceAll("-", ""));
    const anonymous = await app.inject({ method: "POST", url: `/api/v1/orders/admin/${placed.id}/activation-codes` });
    expect(anonymous.statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `/api/v1/orders/admin/${placed.id}/fulfillment`, headers, payload: { status: "SHIPPED", trackingId: "TEST" } })).statusCode).toBe(409);
    await confirmPackage(placed.id);
    expect((await request("/api/v1/admin/tasks?stage=packing")).items).toHaveLength(0);
    expect(await client.db.select().from(schema.orderCardAllocations)).toHaveLength(0);
    const tracking = await request("/api/v1/orders/tracking", { token: placed.trackingPath.split("#track/")[1] });
    expect(tracking).toMatchObject({ activationMethod: "ORDER_SECRET", packedAt: expect.any(String) });
    expect(JSON.stringify(tracking)).not.toContain(codes[0].secretCode);
  });

  it("binds any ready card to its code's existing temporary profile and keeps multiple profiles independently editable", async () => {
    const first = await readyForClaim(), second = await readyForClaim();
    const placed = await request("/api/v1/orders", orderPayload(2));
    const codes = (await secretCodes(placed.id)).items;
    const attempt = () => app.inject({ method: "POST", url: `/api/v1/customer/cards/${second.publicSlug}/activate`, payload: { secretCode: codes[0].secretCode } });
    expect((await attempt()).statusCode).toBe(409);
    await confirmPackage(placed.id);
    const grant = (await attempt()).json();
    const created = await signup(grant.claimToken, "new-flow@example.com");
    expect(created.statusCode, created.body).toBe(201);
    const auth = { authorization: `Bearer ${created.json().accessToken}` };
    const primary = await request(`/api/v1/customer/cards/${second.publicSlug}`);
    expect(primary).toMatchObject({ status: "PROFILE", profile: { id: codes[0].profileId }, canShareContact: true });
    expect((await attempt()).statusCode).toBe(409);
    const next = await activate(first.publicSlug, codes[1].secretCode);
    const claim = await app.inject({ method: "POST", url: "/api/v1/customer/claim", headers: auth,
      payload: { claimToken: next.claimToken, profile: { ...publicDetails, displayName: "Second profile" } } });
    expect(claim.statusCode, claim.body).toBe(200);
    expect(await client.db.select().from(schema.customerProfiles)).toHaveLength(2);
    expect(await client.db.select().from(schema.orderCardAllocations)).toHaveLength(2);
    expect(await request(`/api/v1/customer/cards/${first.publicSlug}`)).toMatchObject({ profile: { id: codes[1].profileId, displayName: "Second profile" }, canShareContact: true });
    expect(await request(`/api/v1/customer/cards/${second.publicSlug}`)).toMatchObject({ profile: { id: codes[0].profileId, displayName: "Card Owner" } });
    await request(`/api/v1/customer/cards/${first.publicSlug}/contact-leads`, { requestId: randomUUID(), name: "Second profile visitor", email: "visitor@example.com", consent: true });
    const inbox = await app.inject({ url: "/api/v1/customer/me/contact-leads", headers: auth });
    expect(inbox.json().items[0].recipientName).toBe("Second profile");
    const foreignCard = await readyForClaim();
    expect((await app.inject({ url: `/api/v1/customer/me?cardSlug=${foreignCard.publicSlug}`, headers: auth })).statusCode).toBe(403);
    const own = await app.inject({ url: `/api/v1/customer/me?cardSlug=${first.publicSlug}`, headers: auth });
    expect(own.json().profile.id).toBe(codes[1].profileId);
    const updated = await app.inject({ method: "PATCH", url: `/api/v1/customer/me/profile?cardSlug=${first.publicSlug}`, headers: auth,
      payload: { ...publicDetails, displayName: "Edited second" } });
    expect(updated.statusCode).toBe(200);
    expect((await request(`/api/v1/customer/cards/${second.publicSlug}`)).profile.displayName).toBe("Card Owner");
    expect((await secretCodes(placed.id)).items.every((row: any) => row.secretCode === null && row.redeemedAt)).toBe(true);
    const [account] = await client.db.select().from(schema.customerAccounts);
    await client.db.update(schema.customerAccounts).set({ active: false }).where(eq(schema.customerAccounts.id, account!.id));
    expect((await app.inject({ url: `/api/v1/profiles/public/${own.json().profile.publicSlug}/contact.vcf` })).statusCode).toBe(404);
    expect(await request(`/api/v1/customer/cards/${first.publicSlug}`)).toEqual({ status: "UNAVAILABLE" });

  });

  it("rejects cancelled codes, temporary-profile publication, reserved stock and competing code redemptions", async () => {
    const first = await readyForClaim(), second = await readyForClaim();
    const placed = await request("/api/v1/orders", orderPayload());
    const code = (await secretCodes(placed.id)).items[0];
    const publish = await app.inject({ method: "PATCH", url: `/api/v1/profiles/${code.profileId}`, headers, payload: { published: true } });
    expect(publish.statusCode).toBe(409);
    await confirmPackage(placed.id);
    await client.db.update(schema.cards).set({ inventoryStatus: "RESERVED" }).where(eq(schema.cards.id, first.id));
    expect((await app.inject({ method: "POST", url: `/api/v1/customer/cards/${first.publicSlug}/activate`, payload: { secretCode: code.secretCode } })).statusCode).toBe(409);
    await client.db.update(schema.cards).set({ inventoryStatus: "SALEABLE" }).where(eq(schema.cards.id, first.id));
    const [one, two] = await Promise.all([activate(first.publicSlug, code.secretCode), activate(second.publicSlug, code.secretCode)]);
    const results = await Promise.all([signup(one.claimToken, "race-one@example.com"), signup(two.claimToken, "race-two@example.com")]);
    expect(results.map(r => r.statusCode).sort()).toEqual([201, 409]);
    expect(await client.db.select().from(schema.customerAccounts)).toHaveLength(1);
    const cancelled = await request("/api/v1/orders", orderPayload());
    const otherCode = (await secretCodes(cancelled.id)).items[0].secretCode;
    await confirmPackage(cancelled.id);
    const unusedCard = results[0]!.statusCode === 201 ? second : first;
    const abandoned = await activate(unusedCard.publicSlug, otherCode);
    await request(`/api/v1/orders/admin/${cancelled.id}/cancel`, { reason: "Cancelled test order" });
    expect((await signup(abandoned.claimToken, "cancelled-signup@example.com")).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/api/v1/customer/cards/${unusedCard.publicSlug}/activate`, payload: { secretCode: otherCode } })).statusCode).toBe(409);
  });

  it("withholds unpaid order codes and lists delivered temporary profiles for activation follow-up", async () => {
    const card = await readyForClaim();
    const placed = await request("/api/v1/orders", { ...orderPayload(), payment: { method: "BKASH", amountMinor: 56000, transactionId: "SECRET123456" } });
    const post = (path: string, payload = {}) => app.inject({ method: "POST", url: `/api/v1/orders/admin/${placed.id}/${path}`, headers, payload });
    expect((await post("activation-codes")).statusCode).toBe(409);
    expect((await post("packing-check", { confirmed: true })).statusCode).toBe(409);
    await request(`/api/v1/orders/admin/${placed.id}/verify-payment`, {});
    const code = (await secretCodes(placed.id)).items[0];
    await confirmPackage(placed.id);
    await request(`/api/v1/orders/admin/${placed.id}/fulfillment`, { status: "SHIPPED", trackingId: "SECRET-TEST" });
    await request(`/api/v1/reviews/admin/orders/${placed.id}/deliver`, {});
    expect((await request("/api/v1/admin/activation-follow-up")).items).toEqual([expect.objectContaining({ cardId: null, profileId: code.profileId, orderId: placed.id })]);
    const grant = await activate(card.publicSlug, code.secretCode);
    expect((await signup(grant.claimToken, "delivered-secret@example.com")).statusCode).toBe(201);
    expect((await client.db.select().from(schema.cards).where(eq(schema.cards.id, card.id)))[0]?.inventoryStatus).toBe("DISPATCHED");
    expect((await request("/api/v1/admin/activation-follow-up")).items).toHaveLength(0);
  });

  it("activates with a private code, signs up, then resolves subsequent scans to the owner's saved public profile", async () => {
    const card = await readyForClaim();
    expect(await request(`/api/v1/customer/cards/${card.publicSlug}`)).toMatchObject({ status: "ACTIVATION_REQUIRED" });
    const secret = await issue(card.id);
    expect(secret.secretCode).toMatch(/^(?:[A-F0-9]{4}-){4}[A-F0-9]{4}$/);
    const [stored] = await client.db.select().from(schema.cardActivationSecrets);
    expect(stored!.codeHash).not.toContain(secret.secretCode.replaceAll("-", ""));
    const wrong = await app.inject({ method: "POST", url: `/api/v1/customer/cards/${card.publicSlug}/activate`, payload: { secretCode: "0".repeat(20) } });
    expect(wrong.statusCode).toBe(403);
    const grant = await activate(card.publicSlug, secret.secretCode);
    const registered = await signup(grant.claimToken, "private-account@example.com");
    expect(registered.statusCode, registered.body).toBe(201);
    const scanned = await request(`/api/v1/customer/cards/${card.publicSlug}`);
    expect(scanned.status).toBe("PROFILE");
    expect(scanned.profile).toMatchObject({ displayName: "Card Owner", email: "" });
    expect(JSON.stringify(scanned)).not.toContain("private-account@example.com");
    expect(JSON.stringify(scanned)).not.toContain("passwordHash");
    expect(JSON.stringify(await request("/api/v1/admin/cards"))).not.toContain("codeHash");
    const login = await request("/api/v1/customer/login", { email: "PRIVATE-ACCOUNT@example.com", password: "a secure customer password" });
    const ownerHeaders = { authorization: `Bearer ${login.accessToken}` };
    const owner = (await app.inject({ method: "GET", url: "/api/v1/customer/me", headers: ownerHeaders })).json();
    expect(owner.cards.map((card: any) => card.publicSlug)).toContain(card.publicSlug);
    expect((await app.inject({ method: "PATCH", url: "/api/v1/customer/me/profile", headers: ownerHeaders,
      payload: { ...publicDetails, displayName: "Updated Owner" } })).statusCode).toBe(200);
    expect((await request(`/api/v1/customer/cards/${card.publicSlug}`)).profile.displayName).toBe("Updated Owner");
    expect((await signup(grant.claimToken, "other@example.com")).statusCode).toBe(409);
    const [consumed] = await client.db.select().from(schema.cardActivationSecrets);
    expect(consumed!.codeHash).toBeNull(); expect(consumed!.redeemedAt).toBeTruthy();
    expect((await app.inject({ method: "POST", url: `/api/v1/customer/cards/${card.id}/activation-code`, headers, payload: {} })).statusCode).toBe(409);
  });

  it("protects QC, secret issuance and code rotation without bypassing client signup", async () => {
    const incomplete = await batch(1);
    await confirm(incomplete.id);
    const [card] = await client.db.select().from(schema.cards).where(eq(schema.cards.batchId, incomplete.id));
    const codePath = `/api/v1/customer/cards/${card!.id}/activation-code`;
    expect((await app.inject({ method: "POST", url: codePath, headers, payload: {} })).statusCode).toBe(409);
    await client.db.update(schema.cards).set({ qcStatus: "PASSED", nfcStatus: "WRITTEN", lifecycleStatus: "QC_PASSED" }).where(eq(schema.cards.id, card!.id));
    expect((await app.inject({ method: "POST", url: codePath, payload: {} })).statusCode).toBe(401);
    const first = await issue(card!.id);
    const oldGrant = await activate(card!.publicSlug, first.secretCode);
    expect((await app.inject({ method: "POST", url: codePath, headers, payload: {} })).statusCode).toBe(409);
    const replacement = await issue(card!.id, true);
    expect((await app.inject({ method: "POST", url: `/api/v1/customer/cards/${card!.publicSlug}/activate`, payload: { secretCode: first.secretCode } })).statusCode).toBe(403);
    expect((await signup(oldGrant.claimToken, "old-code@example.com")).statusCode).toBe(401);
    expect((await activate(card!.publicSlug, replacement.secretCode)).claimToken).toBeTruthy();
    const legacyProfile = await request("/api/v1/profiles", { publicSlug: "cannot-bypass-secret", displayName: "Cannot bypass" });
    expect((await app.inject({ method: "POST", url: `/api/v1/profiles/${legacyProfile.id}/assign-card`, headers, payload: { cardId: card!.id } })).statusCode).toBe(409);
  });

  it("keeps opt-in contact shares private, deduplicates retries and pages older contacts", async () => {
    const card = await readyForClaim();
    const sendUrl = `/api/v1/customer/cards/${card.publicSlug}/contact-leads`;
    const inboxUrl = "/api/v1/customer/me/contact-leads";
    const payload = { requestId: randomUUID(), name: "Test visitor", email: "visitor@example.com", message: "Please follow up", consent: true, crmAllowed: true, source: "NFC" };
    const send = (body: object) => app.inject({ method: "POST", url: sendUrl, payload: body });
    expect((await send(payload)).statusCode).toBe(404);
    const grant = await activate(card.publicSlug, (await issue(card.id)).secretCode);
    const owner = await signup(grant.claimToken, "lead-owner@example.com");
    expect(owner.statusCode, owner.body).toBe(201);
    const otherCard = await readyForClaim();
    const otherGrant = await activate(otherCard.publicSlug, (await issue(otherCard.id)).secretCode);
    const other = await signup(otherGrant.claimToken, "other-owner@example.com");
    expect(other.statusCode, other.body).toBe(201);
    expect(await request(`/api/v1/customer/cards/${card.publicSlug}`)).toMatchObject({ status: "PROFILE", canShareContact: true });
    expect((await send({ ...payload, consent: false })).statusCode).toBe(400);
    expect((await send({ ...payload, email: "" })).statusCode).toBe(400);
    const retries = await Promise.all([send(payload), send(payload)]);
    for (const result of retries) expect(result.statusCode, result.body).toBe(201);
    const [lead] = await client.db.select().from(schema.customerContactLeads);
    expect(lead).toBeTruthy();
    const auth = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });
    const get = (accessToken: string, before?: string) => app.inject({ method: "GET", url: before ? `${inboxUrl}?before=${before}` : inboxUrl, headers: auth(accessToken) });
    expect((await app.inject(inboxUrl)).statusCode).toBe(401);
    expect((await get(other.json().accessToken, lead!.id)).json()).toMatchObject({ items: [], nextCursor: null });
    const inbox = await get(owner.json().accessToken);
    expect(inbox.json().items).toEqual([expect.objectContaining({ name: payload.name, email: payload.email, message: payload.message })]);
    expect(inbox.headers["cache-control"]).toBe("no-store");
    const activity = `/api/v1/customer/cards/${card.publicSlug}/activity`;
    const update = await app.inject({ method: "PATCH", url: "/api/v1/customer/me/profile", headers: auth(owner.json().accessToken),
      payload: { ...publicDetails, profileMode: "EVENT", modeContent: { EVENT: { title: "Oneinfo Expo", description: "Meet the team" } } } });
    expect(update.statusCode, update.body).toBe(200);
    expect((await app.inject({ method: "POST", url: activity, payload: { source: "QR", event: "VIEW" } })).statusCode).toBe(204);
    const stats = await app.inject({ url: "/api/v1/customer/me/activity", headers: auth(owner.json().accessToken) });
    expect(stats.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ mode: "EVENT", campaign: "Oneinfo Expo", source: "QR", event: "VIEW", total: 1 }),
      expect.objectContaining({ mode: "BUSINESS", source: "NFC", event: "LEAD", total: 1 }),
    ]));
    if (inbox.json().crmEnabled) {
      const forward = (accessToken: string) => app.inject({ method: "POST", url: `${inboxUrl}/${lead!.id}/crm`, headers: auth(accessToken) });
      expect((await forward(other.json().accessToken)).statusCode).toBe(404);
      const sent = await forward(owner.json().accessToken);
      expect(sent.statusCode, sent.body).toBe(200);
      expect((await forward(owner.json().accessToken)).json()).toEqual(sent.json());
    }
    await client.db.insert(schema.customerContactLeads).values(Array.from({ length: 50 }, () => ({
      accountId: lead!.accountId, requestId: randomUUID(), name: "Later visitor", email: "later@example.com", phone: "", message: "", createdAt: new Date(Date.now() + 60_000),
    })));
    const firstPage = (await get(owner.json().accessToken)).json();
    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondPage = await get(owner.json().accessToken, firstPage.nextCursor);
    expect(secondPage.statusCode, secondPage.body).toBe(200);
    expect(secondPage.json().items).toEqual([expect.objectContaining({ id: lead!.id })]);
    await client.db.update(schema.cards).set({ lifecycleStatus: "SUSPENDED" }).where(eq(schema.cards.id, card.id));
    expect((await send({ ...payload, requestId: randomUUID() })).statusCode).toBe(404);
  });

  it("keeps tracking private, searches the full order list, and validates shipping and COD settlement", async () => {
    const result = await order();
    const url = `/api/v1/orders/admin/${result.id}`;
    const inject = (method: "POST" | "PUT", url: string, payload: object, auth = headers) => app.inject({ method, url, payload, headers: auth });
    const token = result.trackingPath.split("#track/")[1];
    const track = async (secret: string) => inject("POST", "/api/v1/orders/tracking", { token: secret }, {});
    expect((await track(token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"))).statusCode).toBe(404);
    expect((await track(token)).json()).toMatchObject({ status: "RECEIVED", cards: { total: 1, qrGenerated: 0, nfcWritten: 0, qcPassed: 0 } });
    expect((await inject("PUT", `${url}/cod`, { codCollectedMinor: 100, codSettledMinor: 0 })).statusCode).toBe(409);
    const processing = await inject("POST", `${url}/fulfillment`, { status: "PROCESSING" });
    expect(processing.statusCode, processing.body).toBe(200);
    failNextShippingEmail = true;
    const shipped = await inject("POST", `${url}/fulfillment`, { status: "SHIPPED", trackingId: "COURIER-42" });
    expect(shipped.statusCode, shipped.body).toBe(200);
    if (shipped.json().shippingEmail) {
      expect(shipped.json().shippingEmail).toBe("failed");
      const retry = await inject("POST", `${url}/emails/retry`, { kind: "shipping" });
      expect(retry.statusCode, retry.body).toBe(200);
      expect(retry.json().status).toBe("accepted");
    }
    const tracking = await track(token);
    expect(tracking.headers["cache-control"]).toBe("no-store");
    expect(tracking.json()).toMatchObject({ status: "SHIPPED", courierTrackingId: "COURIER-42" });
    expect(tracking.body).not.toContain("buyer@example.com");
    expect(tracking.body).not.toContain("Test address");
    const search = await inject("POST", "/api/v1/orders/admin", { query: "(017) 123-45678", delivery: "SHIPPED", qr: "AWAITING_QR" });
    expect(search.statusCode, search.body).toBe(200);
    expect(search.json().items.map((item: { id: string }) => item.id)).toEqual([result.id]);
    expect((await inject("POST", "/api/v1/orders/admin", { query: "buyer@EXAMPLE.COM", delivery: "RECEIVED" })).json().items).toEqual([]);
    const delivered = await inject("POST", `/api/v1/reviews/admin/orders/${result.id}/deliver`, {});
    expect(delivered.statusCode, delivered.body).toBe(200);
    expect((await track(token)).json().status).toBe("DELIVERED");
    expect((await inject("PUT", `${url}/cod`, { codCollectedMinor: 100, codSettledMinor: 101 })).statusCode).toBe(409);
    const cod = await inject("PUT", `${url}/cod`, { codCollectedMinor: 100, codSettledMinor: 50 });
    expect(cod.statusCode, cod.body).toBe(200);
    expect(cod.json()).toEqual({ codCollectedMinor: 100, codSettledMinor: 50 });
    const history = await request(`${url}/emails`);
    expect(history.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "delivery", status: expect.stringMatching(/^(failed|accepted)$/) })]));
  });

  it("keeps company management tenant-scoped and handles employee edits, reassignment and replacement", async () => {
    const ownerCard = await readyForClaim();
    const owner = await signup((await activate(ownerCard.publicSlug, (await issue(ownerCard.id)).secretCode)).claimToken, "team-owner@example.com");
    expect(owner.statusCode, owner.body).toBe(201);
    const secondOwnerCard = await readyForClaim();
    const second = await signup((await activate(secondOwnerCard.publicSlug, (await issue(secondOwnerCard.id)).secretCode)).claimToken, "other-team@example.com");
    expect(second.statusCode, second.body).toBe(201);
    const ownerHeaders = { authorization: `Bearer ${owner.json().accessToken}` }, otherHeaders = { authorization: `Bearer ${second.json().accessToken}` };
    const { id } = await request("/api/v1/company/admin", { name: "Oneinfo Team", ownerEmail: "team-owner@example.com", domain: "team.example.com" });
    const url = `/api/v1/company/me/${id}`;
    const send = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: object, auth = ownerHeaders) => app.inject({ method, url, headers: auth, ...(payload ? { payload } : {}) });
    expect((await send("GET", url, undefined, otherHeaders)).statusCode).toBe(404);
    const branding = await send("PUT", `${url}/settings`, { name: "Oneinfo Team", logoUrl: "https://team.example.com/logo.png", headline: "Team member", bio: "Team bio", theme: "MINT", allowEmployeeEdits: true });
    expect(branding.statusCode, branding.body).toBe(200);
    const imported = await send("POST", `${url}/employees`, { employees: [{ name: "First Employee", email: "employee@example.com" }, { name: "Other Employee", email: "other-employee@example.com" }] });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json()).toEqual({ added: 2, skipped: 0, queued: 2 });
    const stock = await readyForClaim();
    await request(`/api/v1/company/admin/${id}/cards`, { cardSlug: stock.publicSlug });
    const workspace = (await send("GET", url)).json();
    const [employee, colleague] = workspace.employees;
    expect(employee.inviteEmailStatus).toBe("pending");
    expect((await send("POST", `${url}/employees`, { employees: [{ name: "First Employee", email: "EMPLOYEE@example.com" }] })).json())
      .toEqual({ added: 0, skipped: 1, queued: 0 });
    const welcome = `${url}/employees/${employee.id}/welcome-email`;
    expect((await send("POST", welcome, undefined, otherHeaders)).statusCode).toBe(404);
    const previousLink = (await send("POST", `${url}/employees/${employee.id}/edit-link`)).json().path.split("#edit/")[1];
    const { drainEmployeeEmails } = await import("../src/domain/employee-email.js");
    const employeeEmails = () => vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body ?? "{}")))
      .filter(mail => mail.subject === "Your Oneinfo employee profile is ready");
    rejectEmployeeEmail = "employee@example.com";
    await Promise.all([drainEmployeeEmails(), drainEmployeeEmails()]);
    expect(employeeEmails()).toHaveLength(2);
    expect((await send("GET", url)).json().employees.map((item: { inviteEmailStatus: string }) => item.inviteEmailStatus)).toEqual(["failed", "accepted"]);
    const editor = "/api/v1/company/employee/profile";
    expect((await send("POST", editor, { token: previousLink }, {})).statusCode).toBe(200);
    expect((await send("POST", welcome)).statusCode).toBe(429);
    await client.db.update(schema.companyEmployees).set({ inviteEmailUpdatedAt: new Date(0) }).where(eq(schema.companyEmployees.id, employee.id));
    rejectEmployeeEmail = "";
    expect((await send("POST", welcome)).json()).toEqual({ queued: true });
    await drainEmployeeEmails();
    const retried = employeeEmails().at(-1);
    expect(retried.to).toEqual(["employee@example.com"]);
    expect(retried.text).toContain("Oneinfo Team");
    const emailToken = /#edit\/([\w-]+)/.exec(retried.text)![1];
    expect((await send("POST", editor, { token: emailToken }, {})).json().profile.displayName).toBe("First Employee");
    expect((await send("POST", editor, { token: previousLink }, {})).statusCode).toBe(404);
    expect((await send("GET", url)).json().employees[0].inviteEmailStatus).toBe("accepted");
    const teamCard = `/api/v1/customer/cards/${stock.publicSlug}`;
    expect((await send("PUT", `${url}/cards/${stock.id}`, { employeeId: employee.id })).statusCode).toBe(200);
    expect((await request(teamCard)).profile).toMatchObject({ displayName: "First Employee", theme: "MINT", email: "" });
    expect((await request(teamCard)).canShareContact).toBe(true);
    expect((await send("POST", `${teamCard}/contact-leads`, { requestId: randomUUID(), name: "Company visitor", email: "visitor@example.com", consent: true, source: "QR" }, {})).statusCode).toBe(201);
    const leadUrl = `/api/v1/customer/me/contact-leads?companyId=${id}`;
    expect((await send("GET", leadUrl)).json().items).toEqual([expect.objectContaining({ recipientName: "First Employee" })]);
    expect((await send("GET", leadUrl, undefined, otherHeaders)).json().items).toEqual([]);
    expect((await send("GET", `/api/v1/customer/me/activity?companyId=${id}`)).json().items).toEqual([expect.objectContaining({ event: "LEAD", source: "QR", total: 1 })]);
    const edit = await send("POST", `${url}/employees/${employee.id}/edit-link`);
    expect(edit.statusCode, edit.body).toBe(200);
    const secret = edit.json().path.split("#edit/")[1];
    expect((await send("POST", editor, { token: secret, profile: { displayName: "Edited Employee", company: "Untrusted Company" } }, {})).json().profile)
      .toMatchObject({ displayName: "Edited Employee", company: "Oneinfo Team" });
    const publicPortal = await app.inject({ url: "/api/v1/company/public/team.example.com", headers: { origin: "https://team.example.com" } });
    expect(publicPortal.headers["access-control-allow-origin"]).toBe("*");
    expect(publicPortal.body).not.toContain("employee@example.com");
    const [workspaceOwner] = await client.db.select().from(schema.companies).where(eq(schema.companies.id, id));
    await client.db.update(schema.customerAccounts).set({ active: false }).where(eq(schema.customerAccounts.id, workspaceOwner!.ownerAccountId));
    expect((await app.inject({ url: "/api/v1/company/public/team.example.com" })).statusCode).toBe(404);
    expect((await request(teamCard)).status).toBe("UNAVAILABLE");
    const profileUrl = `/api/v1/profiles/public/${employee.publicSlug}`;
    expect((await app.inject({ url: `${profileUrl}/contact.vcf` })).statusCode).toBe(404);
    await client.db.update(schema.customerAccounts).set({ active: true }).where(eq(schema.customerAccounts.id, workspaceOwner!.ownerAccountId));

    expect((await send("PATCH", `${url}/employees/${employee.id}`, { active: false })).statusCode).toBe(200);
    expect((await send("POST", welcome)).statusCode).toBe(404);
    expect((await request(teamCard)).status).toBe("UNAVAILABLE");
    await client.db.update(schema.customerProfiles).set({ published: true }).where(eq(schema.customerProfiles.id, employee.profileId));
    expect((await app.inject({ url: `${profileUrl}/contact.vcf` })).statusCode).toBe(404);
    expect((await request(teamCard)).status).toBe("UNAVAILABLE");
    expect((await send("POST", editor, { token: secret }, {})).statusCode).toBe(404);
    expect((await send("PUT", `${url}/cards/${stock.id}`, { employeeId: colleague.id })).statusCode).toBe(200);
    expect((await request(teamCard)).profile.displayName).toBe("Other Employee");
    const replacement = await readyForClaim();
    await request(`/api/v1/production/cards/${stock.id}/disable`, {});
    await request(`/api/v1/production/cards/${stock.id}/replace`, { replacementSlug: replacement.publicSlug });
    expect((await request(teamCard)).status).toBe("UNAVAILABLE");
    expect((await request(`/api/v1/customer/cards/${replacement.publicSlug}`)).profile.displayName).toBe("Other Employee");
    const passport = await request(`/api/v1/production/cards/${stock.id}/history`);
    expect(passport.events.map((event: { eventType: string }) => event.eventType)).toContain("CARD_REPLACED");
    expect((await send("PUT", `${url}/settings`, { name: "Oneinfo Team", allowEmployeeEdits: false })).statusCode).toBe(200);
    expect((await send("POST", `${url}/employees`, { employees: [{ name: "Read Only", email: "readonly@example.com" }] })).statusCode).toBe(200);
    await drainEmployeeEmails();
    expect(employeeEmails().at(-1)).toMatchObject({ to: ["readonly@example.com"], text: expect.stringContaining("workspace owner") });
    expect(employeeEmails().at(-1).text).not.toContain("#edit/");
  });

  it("prevents concurrent checkout from overselling tracked variants and reports low stock", async () => {
    const [original] = await client.db.select().from(schema.products).where(eq(schema.products.id, productId));
    expect(original).toBeTruthy();
    await client.db.update(schema.products).set({ variants: original!.variants.map(variant => ({ ...variant, stockQuantity: 1 })) }).where(eq(schema.products.id, productId));
    try {
      const submit = () => app.inject({ method: "POST", url: "/api/v1/orders", payload: orderPayload() });
      const orders = await Promise.all([submit(), submit()]);
      expect(orders.map(result => result.statusCode).sort()).toEqual([201, 409]);
      const overview = await request("/api/v1/admin/overview");
      expect(overview.stockAlerts).toContainEqual({ name: "Test card · Standard", remaining: 0 });
      const publicProducts = await request("/api/v1/products/public");
      const item = publicProducts.items.find((product: { id: string }) => product.id === productId);
      expect(item.variants[0].available).toBe(false);
      expect(item.variants[0].stockQuantity).toBeUndefined();
    } finally {
      await client.db.update(schema.products).set({ variants: original!.variants }).where(eq(schema.products.id, productId));
    }
  });

  it("allows exactly one concurrent claim without leaving an orphan account", async () => {
    const card = await readyForClaim(), secret = await issue(card.id);
    const grant = await activate(card.publicSlug, secret.secretCode);
    const results = await Promise.all([signup(grant.claimToken, "first@example.com"), signup(grant.claimToken, "second@example.com")]);
    expect(results.map(result => result.statusCode).sort()).toEqual([201, 409]);
    expect(await client.db.select().from(schema.customerAccounts)).toHaveLength(1);
    expect(await client.db.select().from(schema.customerProfiles)).toHaveLength(1);
  });

  it("requires customer login for an existing email and keeps customer/operator permissions separate", async () => {
    const first = await readyForClaim(), secret = await issue(first.id);
    const grant = await activate(first.publicSlug, secret.secretCode);
    const account = await signup(grant.claimToken, "existing@example.com");
    expect(account.statusCode, account.body).toBe(201);
    const second = await readyForClaim(), secondSecret = await issue(second.id);
    const secondGrant = await activate(second.publicSlug, secondSecret.secretCode);
    expect((await signup(secondGrant.claimToken, "existing@example.com")).statusCode).toBe(409);
    const customerHeaders = { authorization: `Bearer ${account.json().accessToken}` };
    expect((await app.inject({ method: "POST", url: "/api/v1/customer/claim", headers: customerHeaders,
      payload: { claimToken: secondGrant.claimToken, profile: publicDetails } })).statusCode).toBe(200);
    const owned = (await app.inject({ method: "GET", url: "/api/v1/customer/me", headers: customerHeaders })).json();
    expect(owned.cards).toHaveLength(2);
    expect((await app.inject({ method: "GET", url: "/api/v1/customer/me", headers })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/overview", headers: customerHeaders })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/v1/customer/login", payload: { email: "existing@example.com", password: "incorrect" } })).statusCode).toBe(401);
  });

  it("limits repeated public activation attempts", async () => {
    const limited = (await import("../src/app.js")).buildApp();
    try {
      for (let index = 0; index < 20; index++) expect((await limited.inject({ method: "POST", url: "/api/v1/customer/cards/missing/activate", payload: { secretCode: "0".repeat(20) } })).statusCode).toBe(403);
      expect((await limited.inject({ method: "POST", url: "/api/v1/customer/cards/missing/activate", payload: { secretCode: "0".repeat(20) } })).statusCode).toBe(429);
    } finally { await limited.close(); }
  });

  it("keeps custom external QR links out of customer card allocation", async () => {
    const external = await request("/api/v1/production/batches", { batchCode: randomUUID(), productVariantId: "CUSTOM-QR", quantity: 1, links: ["https://example.com/external"] });
    await request(`/api/v1/production/batches/${external.id}/generate-qr`, {});
    await confirm(external.id);
    expect((await order()).qrAllocation.status).toBe("AWAITING_QR");
    await confirm((await batch(1)).id);
    const [allocation] = await client.db.select().from(schema.orderCardAllocations);
    const [assigned] = await client.db.select().from(schema.cards).where(eq(schema.cards.id, allocation!.cardId));
    expect(assigned!.batchId).not.toBe(external.id);
  });

  async function phone() {
    const pairing = await request("/api/v1/local-nfc/pairings", {});
    const paired = await request("/api/v1/local-nfc/devices/pair", { pairingCode: pairing.pairingCode, deviceName: "Integration phone" });
    return async (path: string, payload: object) => {
      const response = await app.inject({ method: "POST", url: `/api/v1/local-nfc/device/${path}`,
        headers: { "x-oneinfo-device-token": paired.deviceToken }, payload });
      return response;
    };
  }

  it("requires secure LAN pairing secrets, persists ownership checks and permits phone revocation", async () => {
    const pairing = await request("/api/v1/local-nfc/pairings", {});
    const blocked = await app.inject({ method: "POST", url: "/api/v1/dev/token", remoteAddress: "192.168.1.50", headers: { "x-forwarded-for": "127.0.0.1" } });
    expect(blocked.statusCode).toBe(403);
    const insecure = await app.inject({ method: "POST", url: "/api/v1/local-nfc/devices/pair", remoteAddress: "192.168.1.50", payload: { pairingCode: pairing.pairingCode, deviceName: "LAN phone" } });
    expect(insecure.statusCode).toBe(403);
    const badSecret = await app.inject({ method: "POST", url: "/api/v1/local-nfc/devices/pair", payload: { pairingCode: pairing.pairingCode, pairingSecret: "wrong".repeat(10), deviceName: "LAN phone" } });
    expect(badSecret.statusCode).toBe(403);
    const paired = await request("/api/v1/local-nfc/devices/pair", { pairingCode: pairing.pairingCode, deviceName: "LAN phone" });
    const deviceHeaders = { "x-oneinfo-device-token": paired.deviceToken };
    expect((await app.inject({ url: "/api/v1/local-nfc/device/status", headers: deviceHeaders })).statusCode).toBe(200);
    const list = await request("/api/v1/local-nfc/devices");
    expect(JSON.stringify(list)).not.toContain(paired.deviceToken);
    expect(JSON.stringify(list)).not.toContain("tokenHash");
    await request(`/api/v1/local-nfc/devices/${paired.deviceId}/revoke`, {});
    expect((await app.inject({ url: "/api/v1/local-nfc/device/status", headers: deviceHeaders })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/v1/local-nfc/devices/pair", payload: { pairingCode: pairing.pairingCode, deviceName: "Reuse" } })).statusCode).toBe(404);
  });

  it("recovers a lost pairing acknowledgement without creating another device or reviving revoked access", async () => {
    const pairing = await request("/api/v1/local-nfc/pairings", {});
    const payload = { pairingCode: pairing.pairingCode, deviceName: "Retry-safe phone", deviceCredential: randomBytes(32).toString("base64url") };
    const first = await request("/api/v1/local-nfc/devices/pair", payload);
    const retry = await request("/api/v1/local-nfc/devices/pair", payload);
    expect(retry).toEqual(first);
    expect(first.deviceToken).toBe(payload.deviceCredential);
    await request(`/api/v1/local-nfc/devices/${first.deviceId}/revoke`, {});
    expect((await app.inject({ method: "POST", url: "/api/v1/local-nfc/devices/pair", payload })).statusCode).toBe(404);
  });

  it.runIf(lanAddresses().length > 0)("pairs over a real encrypted LAN socket only with the scanned one-time secret", async () => {
    const directory = mkdtempSync(join(tmpdir(), "oneinfo-lan-api-"));
    const identity = await loadLanIdentity(join(directory, "identity.json"));
    const lan = (await import("../src/app.js")).buildApp(identity);
    try {
      await lan.listen({ port: 0, host: "0.0.0.0" });
      const port = (lan.server.address() as { port: number }).port;
      const { fingerprint } = configureLanConnection(identity.cert, port);
      const pairing = await request("/api/v1/local-nfc/pairings", {});
      expect(pairing.lanQr).toMatch(/^data:image\/png;base64,/);
      const send = (path: string, payload: object) => new Promise<{ status: number; body: any }>((resolve, reject) => {
        const req = httpsRequest({ host: lanAddresses()[0]!, port, path, method: "POST", agent: false, ca: identity.cert,
          checkServerIdentity: (_host, cert) => cert.fingerprint256.replaceAll(":", "").toLowerCase() === fingerprint ? undefined : new Error("Certificate mismatch"),
          headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" } }, res => {
          let body = ""; res.on("data", chunk => { body += chunk; }); res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(body) }));
        }); req.on("error", reject); req.end(JSON.stringify(payload));
      });
      expect((await send("/api/v1/dev/token", {})).status).toBe(403);
      const payload = { pairingCode: pairing.pairingCode, deviceName: "Secure LAN test phone" };
      expect((await send("/api/v1/local-nfc/devices/pair", payload)).status).toBe(403);
      const paired = await send("/api/v1/local-nfc/devices/pair", { ...payload, pairingSecret: pairing.lan.pairingSecret });
      expect(paired.status).toBe(201); expect(paired.body.deviceToken).toBeTruthy();
      expect((await send("/api/v1/local-nfc/devices/pair", { ...payload, pairingSecret: pairing.lan.pairingSecret })).status).toBe(404);
    } finally { await lan.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 15000);

  it("keeps phone pairing and an in-progress operation after the local API process restarts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "oneinfo-api-restart-"));
    let child: ChildProcess | undefined;
    const start = async () => {
      child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `import {buildApp} from './src/app.ts';const app=buildApp();await app.listen({port:0,host:'127.0.0.1'});process.send({port:app.server.address().port});`], {
        cwd: process.cwd(), env: { ...process.env, NODE_ENV: "development", NFC_STATE_FILE: join(directory, "nfc-state.bin") }, stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      const timer = setTimeout(() => child?.kill(), 12_000);
      try { const [message] = await Promise.race([once(child, "message"), once(child, "exit").then(() => { throw new Error("Test API stopped before startup"); })]); return `http://127.0.0.1:${message.port}`; }
      finally { clearTimeout(timer); }
    };
    const stop = async () => { if (child && child.exitCode === null && child.signalCode === null) { const ended = once(child, "exit"); child.kill(); await ended; } };
    try {
      let base = await start();
      const pairingResponse = await networkFetch(base + "/api/v1/local-nfc/pairings", { method: "POST", headers });
      expect(pairingResponse.status).toBe(201); const pairing = await pairingResponse.json();
      const response = await networkFetch(base + "/api/v1/local-nfc/devices/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pairingCode: pairing.pairingCode, deviceName: "Restart test phone" }) });
      expect(response.status).toBe(201); const paired = await response.json();
      const deviceHeaders = { "x-oneinfo-device-token": paired.deviceToken, "content-type": "application/json" };
      const operationResponse = await networkFetch(base + "/api/v1/local-nfc/device/utility-sessions", { method: "POST", headers: deviceHeaders, body: JSON.stringify({ operation: "READ" }) });
      expect(operationResponse.status).toBe(201); const operation = await operationResponse.json();
      await stop(); base = await start();
      expect((await networkFetch(base + "/api/v1/local-nfc/device/status", { headers: deviceHeaders })).status).toBe(200);
      const restored = await networkFetch(base + `/api/v1/local-nfc/device/read-tasks/${operation.id}`, { headers: deviceHeaders });
      expect(restored.status).toBe(200); expect((await restored.json()).state).toBe("READING");
      const cancelled = await networkFetch(base + `/api/v1/local-nfc/device/read-tasks/${operation.id}/cancel`, { method: "POST", headers: deviceHeaders, body: "{}" });
      expect(cancelled.status).toBe(200);
      await stop(); base = await start();
      expect((await (await networkFetch(base + `/api/v1/local-nfc/device/read-tasks/${operation.id}`, { headers: deviceHeaders })).json()).state).toBe("CANCELLED");
    } finally { await stop(); rmSync(directory, { recursive: true, force: true }); }
  }, 40_000);

  it("runs a reserved order card through the complete phone workflow", async () => {
    await confirm((await batch(1)).id);
    await order();
    const [card] = await client.db.select().from(schema.cards);
    const send = await phone();
    const scanId = randomUUID();
    expect((await send("resolve-qr", { scanId, scannedValue: qrUrl(card!.canonicalUrl) })).statusCode).toBe(200);
    const write = await send("load-to-nfc", { scanId });
    expect(write.statusCode, write.body).toBe(201);
    const result = { result: "SUCCEEDED", expectedUrl: card!.canonicalUrl, readbackUrl: card!.canonicalUrl };
    expect((await send(`tasks/${scanId}/result`, result)).statusCode).toBe(200);
    expect((await send(`tasks/${scanId}/result`, result)).statusCode).toBe(200);
    const wrongScan = randomUUID();
    expect((await send("verification-from-qr", { scanId: wrongScan, scannedValue: qrUrl(card!.canonicalUrl) })).statusCode).toBe(201);
    expect((await send(`verification-tasks/${wrongScan}/result`, { scannedValue: "https://example.com/wrong-card" })).json().state).toBe("MISMATCH");
    expect((await send(`verification-tasks/${wrongScan}/approve`, {})).statusCode).toBe(409);
    const finalScan = randomUUID();
    expect((await send("verification-from-qr", { scanId: finalScan, scannedValue: qrUrl(card!.canonicalUrl) })).statusCode).toBe(201);
    expect((await request("/api/v1/local-nfc/latest-qr-scan")).scan).toMatchObject({ cardId: card!.id, batchId: card!.batchId });
    expect((await send(`verification-tasks/${finalScan}/result`, { scannedValue: card!.canonicalUrl })).json().state).toBe("MATCHED");
    const approved = await send(`verification-tasks/${finalScan}/approve`, {});
    expect(approved.statusCode, approved.body).toBe(201);
    expect(approved.json().inventoryStatus).toBe("RESERVED");
    expect((await send(`verification-tasks/${finalScan}/approve`, {})).statusCode).toBe(201);
    const [updated] = await client.db.select().from(schema.cards);
    expect(updated).toMatchObject({ nfcStatus: "WRITTEN", qcStatus: "PASSED", inventoryStatus: "RESERVED", profileId: card!.profileId });
  });

  it("rejects a paired device after its operator is deactivated", async () => {
    const send = await phone();
    const [operator] = await client.db.select().from(schema.operators);
    try {
      await client.db.update(schema.operators).set({ active: false }).where(eq(schema.operators.id, operator!.id));
      expect((await send("resolve-qr", { scanId: randomUUID(), scannedValue: "https://example.com/missing" })).statusCode).toBe(403);
    } finally {
      await client.db.update(schema.operators).set({ active: true }).where(eq(schema.operators.id, operator!.id));
    }
  });

  it("hides unconfirmed QR codes, rejects incomplete confirmation and records confirmation once", async () => {
    const created = await batch(2, false);
    const url = `/api/v1/production/batches/${created.id}/confirm-print`;
    expect((await app.inject({ method: "POST", url, headers, payload: { confirmed: true } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url, headers, payload: { confirmed: false } })).statusCode).toBe(400);
    await request(`/api/v1/production/batches/${created.id}/generate-qr`, {});
    expect((await request("/api/v1/admin/cards")).items).toHaveLength(0);
    expect((await request("/api/v1/admin/batches")).items).toHaveLength(0);
    expect(await request("/api/v1/admin/overview")).toMatchObject({ cards: 0, batches: 0, qrArtifacts: 0, pendingJobs: 0 });
    await confirm(created.id);
    expect((await request(`/api/v1/production/batches/${created.id}/verification-status`)).printConfirmedAt).toBeTruthy();
    expect((await confirm(created.id)).replayed).toBe(true);
    expect((await request("/api/v1/admin/cards")).items).toHaveLength(2);
    expect((await request("/api/v1/admin/batches")).items).toHaveLength(1);
    expect(await request("/api/v1/admin/overview")).toMatchObject({ cards: 2, batches: 1, qrArtifacts: 2, pendingJobs: 4 });
    const audit = await client.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "BATCH_PRINT_CONFIRMED"));
    expect(audit).toHaveLength(1);
  });

  it("queues orders, fills quantities FIFO after confirmation and keeps profiles private", async () => {
    const created = await batch(2);
    const first = await order(3);
    const second = await order();
    expect(first.qrAllocation.status).toBe("AWAITING_QR");
    expect((await confirm(created.id)).assigned).toBe(2);
    let admin = (await request("/api/v1/orders/admin")).items;
    expect(admin.find((item: any) => item.id === first.id).qrAllocation).toMatchObject({ assigned: 2, pending: 1, status: "PARTIAL" });
    expect(admin.find((item: any) => item.id === second.id).qrAllocation.assigned).toBe(0);
    await confirm((await batch(2)).id);
    admin = (await request("/api/v1/orders/admin")).items;
    expect(admin.find((item: any) => item.id === first.id).assignedCards).toHaveLength(3);
    expect(admin.find((item: any) => item.id === second.id).assignedCards).toHaveLength(1);
    const profiles = await client.db.select().from(schema.customerProfiles);
    expect(profiles).toHaveLength(0);
    const cards = await client.db.select().from(schema.cards);
    expect(cards.every(card => card.inventoryStatus === "RESERVED" && card.lifecycleStatus === "IN_PRODUCTION" && card.qcStatus === "PENDING")).toBe(true);
  });

  it("issues one invoice per checkout and leaves prepared stock available", async () => {
    const card = await readyForClaim();
    const input = orderPayload();
    const results = await Promise.all([request("/api/v1/orders", input), request("/api/v1/orders", input), request("/api/v1/orders", orderPayload())]);
    expect(results[0].id).toBe(results[1].id);
    expect(results[0].invoiceNumber).toMatch(/^\d{8}-[A-Z0-9]{6}$/);
    expect(results[0].invoiceNumber).toBe(results[1].invoiceNumber);
    expect(results[0].invoiceNumber).not.toBe(results[2].invoiceNumber);
    expect(await client.db.select().from(schema.storeOrders)).toHaveLength(2);
    expect((await confirm((await batch(1)).id)).assigned).toBe(0);
    expect(await client.db.select().from(schema.orderCardAllocations)).toHaveLength(0);
    const admin = await request("/api/v1/orders/admin", { query: results[0].invoiceNumber.toLowerCase() });
    expect(admin.items).toEqual([expect.objectContaining({ id: results[0].id, assignedCards: [] })]);
    expect((await request("/api/v1/admin/tasks?stage=packing")).items).toHaveLength(2);
    expect((await client.db.select().from(schema.cards).where(eq(schema.cards.id, card.id)))[0]?.inventoryStatus).toBe("SALEABLE");
    const { nextInvoiceNumber } = await import("../src/domain/order-invoice.js");
    expect(await client.db.transaction(tx => nextInvoiceNumber(tx, new Date("2026-11-07T18:00:00Z")))).toMatch(/^20261108-/);
  });

  it("packs available stock once and claims delivered cards with a link bound to the invoice and order email", async () => {
    const first = await readyForClaim(), second = await readyForClaim(), replacement = await readyForClaim();
    const payload = orderPayload(2);
    payload.customer.email = "invoice-activation@example.com";
    const placed = await request("/api/v1/orders", payload);
    const other = await request("/api/v1/orders", orderPayload());
    await client.db.update(schema.storeOrders).set({ activationMethod: "LEGACY" }).where(sql`id in (${placed.id}, ${other.id})`);
    const post = (url: string, payload: object, auth = headers) => app.inject({ method: "POST", url, headers: auth, payload });
    const pack = (id: string, scans: string[], replace?: string[]) => post(`/api/v1/orders/admin/${id}/packing-check`, { scans, replace });
    const ship = () => post(`/api/v1/orders/admin/${placed.id}/fulfillment`, { status: "SHIPPED", trackingId: "INVOICE-TEST" });
    const deliver = () => post(`/api/v1/reviews/admin/orders/${placed.id}/deliver`, {});
    const scans = [qrUrl(first.canonicalUrl), second.publicSlug];
    expect((await ship()).statusCode).toBe(409);
    expect((await deliver()).statusCode).toBe(409);
    expect((await pack(placed.id, [first.publicSlug, scans[0]!])).statusCode).toBe(409);
    expect((await pack(placed.id, [first.publicSlug, "unknown-card"])).statusCode).toBe(409);
    await client.db.update(schema.cardBatches).set({ productVariantId: randomUUID() }).where(eq(schema.cardBatches.id, first.batchId));
    expect((await pack(placed.id, scans)).json().message).toContain("different variant");
    await client.db.update(schema.cardBatches).set({ productVariantId: variantId }).where(eq(schema.cardBatches.id, first.batchId));
    const packed = await Promise.all([pack(placed.id, scans), pack(placed.id, scans)]);
    expect(packed.map(result => result.json())).toEqual([{ checked: 2 }, { checked: 2 }]);
    expect((await pack(other.id, [first.publicSlug])).statusCode).toBe(409);
    expect((await request("/api/v1/admin/tasks?stage=packing")).items).toEqual([expect.objectContaining({ orderId: other.id })]);
    const next = [replacement.publicSlug, second.publicSlug];
    expect((await pack(placed.id, next, [replacement.id, second.id])).statusCode).toBe(409);
    await client.db.update(schema.cards).set({ qcStatus: "FAILED" }).where(eq(schema.cards.id, first.id));
    expect((await pack(placed.id, next, [first.id, second.id])).json()).toEqual({ checked: 2 });
    expect((await client.db.select().from(schema.cards).where(eq(schema.cards.id, first.id)))[0]?.inventoryStatus).toBe("NOT_READY");
    expect(await client.db.select().from(schema.orderCardAllocations)).toHaveLength(2);

    const emailCalls = () => vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body ?? "{}")))
      .filter(email => email.subject === "Activate your Oneinfo card");
    const emailLink = (slug: string, invoiceNumber = placed.invoiceNumber) => post(`/api/v1/customer/cards/${slug}/invoice-activation`, { invoiceNumber }, {});
    const exchange = (slug: string, claimToken: string) => post(`/api/v1/customer/cards/${slug}/invoice-claim`, { claimToken }, {});
    expect((await emailLink(replacement.publicSlug)).statusCode).toBe(200);
    expect(emailCalls()).toHaveLength(0);
    expect((await ship()).statusCode).toBe(200);
    expect((await pack(placed.id, next)).statusCode).toBe(409);
    expect((await deliver()).statusCode).toBe(200);
    const mismatch = await emailLink(replacement.publicSlug, other.invoiceNumber);
    const match = await emailLink(replacement.publicSlug, placed.invoiceNumber.toLowerCase());
    expect(match.json()).toEqual(mismatch.json());
    expect(emailCalls()).toHaveLength(1);
    expect(emailCalls()[0].to).toEqual([payload.customer.email]);
    const getToken = (email: { text: string }) => /#invoice-claim\/([\w.-]+)/.exec(email.text)![1]!;
    const claimToken = getToken(emailCalls()[0]);
    const { SignJWT } = await import("jose");
    const { config } = await import("../src/config.js");
    const expired = await new SignJWT({ orderId: placed.id }).setProtectedHeader({ alg: "HS256" }).setIssuer("oneinfo-customer-api")
      .setAudience("oneinfo-card-claim").setSubject(replacement.id).setExpirationTime(1).sign(new TextEncoder().encode(config.JWT_SECRET));
    expect((await exchange(replacement.publicSlug, expired)).statusCode).toBe(401);
    expect((await exchange(second.publicSlug, claimToken)).statusCode).toBe(401);
    expect((await exchange(replacement.publicSlug, claimToken)).json()).toEqual({ email: payload.customer.email });
    expect((await signup(claimToken, "someone-else@example.com")).statusCode).toBe(403);
    const created = await signup(claimToken, payload.customer.email);
    expect(created.statusCode, created.body).toBe(201);
    expect((await exchange(replacement.publicSlug, claimToken)).statusCode).toBe(401);
    expect((await signup(claimToken, payload.customer.email)).statusCode).toBe(409);
    await emailLink(second.publicSlug);
    const secondToken = getToken(emailCalls()[1]);
    expect((await post("/api/v1/customer/claim", { claimToken: secondToken, profile: publicDetails }, { authorization: `Bearer ${created.json().accessToken}` })).statusCode).toBe(200);
    expect((await request(`/api/v1/customer/cards/${second.publicSlug}`)).status).toBe("PROFILE");
  });

  it("paginates all confirmed QR codes without skipping equal timestamps", async () => {
    await confirm((await batch(101)).id);
    const first = await request("/api/v1/admin/cards");
    const second = await request(`/api/v1/admin/cards?beforeId=${first.items.at(-1).card.id}`);
    expect(first.items).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.items, ...second.items].map(item => item.card.id)).size).toBe(101);
    expect(first.items.every((item: any) => item.imageData.startsWith("data:image/png"))).toBe(true);
  }, 30000);

  it("requires final phone verification and keeps an assigned card reserved after QC", async () => {
    const created = await batch(1);
    await confirm(created.id);
    await order();
    const [card] = await client.db.select().from(schema.cards);
    const jobs = await client.db.select().from(schema.productionJobs).where(eq(schema.productionJobs.cardId, card!.id));
    const qc = jobs.find(job => job.type === "QUALITY_CONTROL")!;
    await request(`/api/v1/production/jobs/${qc.id}/claim`, { idempotencyKey: randomUUID() });
    const url = `/api/v1/production/jobs/${qc.id}/quality-checks`;
    const payload = { idempotencyKey: randomUUID(), result: "PASSED" };
    expect((await app.inject({ method: "POST", url, headers, payload })).statusCode).toBe(409);
    await client.db.update(schema.cards).set({ nfcStatus: "WRITTEN" }).where(eq(schema.cards.id, card!.id));
    expect((await app.inject({ method: "POST", url, headers, payload })).statusCode).toBe(409);
    const stationId = headers["x-station-key"]!.split(".")[0]!;
    await client.db.insert(schema.cardVerifications).values(["QR_CAMERA", "NFC_READ"].map((method, index) => ({
      cardId: card!.id, stationId, method, matched: true, expectedUrl: card!.canonicalUrl, scannedValue: card!.canonicalUrl,
      createdAt: new Date(Date.now() + index), deviceMetadata: { scanId: "final-check" },
    })));
    await request(url, payload);
    const [updated] = await client.db.select().from(schema.cards);
    expect(updated).toMatchObject({ inventoryStatus: "RESERVED", lifecycleStatus: "QC_PASSED", qcStatus: "PASSED", profileId: null });
    expect(await client.db.select().from(schema.customerProfiles)).toHaveLength(0);
    await order();
    expect(await client.db.select().from(schema.orderCardAllocations)).toHaveLength(1);
  });
  it("authenticates a configured cloud administrator, blocks revoked accounts and rate limits across app instances", async () => {
    const { config } = await import("../src/config.js");
    const { hashPassword } = await import("../src/domain/customer-auth.js");
    const saved = { ADMIN_EMAIL: config.ADMIN_EMAIL, ADMIN_PASSWORD_HASH: config.ADMIN_PASSWORD_HASH, NODE_ENV: config.NODE_ENV };
    const login = (email: string, password: string) => app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
    try {
      config.ADMIN_EMAIL = undefined; config.ADMIN_PASSWORD_HASH = undefined;
      expect((await login("cloud-admin@example.com", "test password")).statusCode).toBe(503);
      config.ADMIN_EMAIL = "cloud-admin@example.com";
      config.ADMIN_PASSWORD_HASH = await hashPassword("a long unique test password");
      expect((await login(config.ADMIN_EMAIL, "wrong password")).statusCode).toBe(401);
      const success = await login(config.ADMIN_EMAIL.toUpperCase(), "a long unique test password");
      expect(success.statusCode, success.body).toBe(200);
      expect(success.body).not.toContain(config.ADMIN_PASSWORD_HASH);
      const operatorId = success.json().operator.operatorId;
      expect((await app.inject({ url: "/api/v1/admin/overview", headers: { authorization: `Bearer ${success.json().accessToken}` } })).statusCode).toBe(200);
      await client.db.update(schema.operators).set({ active: false }).where(eq(schema.operators.id, operatorId));
      expect((await login(config.ADMIN_EMAIL, "a long unique test password")).statusCode).toBe(403);
      config.NODE_ENV = "production";
      expect((await app.inject({ method: "POST", url: "/api/v1/dev/token" })).statusCode).toBe(404);
      for (let attempt = 0; attempt < 7; attempt++) await login(config.ADMIN_EMAIL, "wrong password");
      const secondApp = (await import("../src/app.js")).buildApp();
      try {
        const limited = await secondApp.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: config.ADMIN_EMAIL, password: "wrong password" } });
        expect(limited.statusCode).toBe(429);
      } finally { await secondApp.close(); }
    } finally { Object.assign(config, saved); }
  });
  it("assigns stable case-insensitive handles under concurrent duplicate names", async () => {
    const make = (slug: string, name = "Sushmoy Nandi") => request("/api/v1/profiles", { publicSlug: slug, displayName: name, published: true });
    const profiles = await Promise.all([make("same-one"), make("same-two"), make("same-three", "sushmoy nandi")]);
    expect(new Set(profiles.map(profile => profile.handle.toLowerCase())).size).toBe(3);
    expect(profiles.map(profile => profile.handle.toLowerCase()).sort()).toEqual(["sushmoynandi", "sushmoynandi2", "sushmoynandi3"]);
    const owner = profiles[0];
    const found = await request(`/api/v1/profiles/handle/${owner.handle.toUpperCase()}`);
    expect(found.profile.id).toBe(owner.id);
    await app.inject({ method: "PATCH", url: `/api/v1/profiles/${owner.id}`, headers, payload: { displayName: "New Name" } });
    expect((await request(`/api/v1/profiles/handle/${owner.handle}`)).profile.displayName).toBe("New Name");
    await app.inject({ method: "PATCH", url: `/api/v1/profiles/${owner.id}`, headers, payload: { published: false } });
    expect((await app.inject({ url: `/api/v1/profiles/handle/${owner.handle}` })).statusCode).toBe(404);
    expect((await make("reserved-name", "Admin")).handle).toBe("AdminProfile");
  });

  it("reserves stock before payment, freezes the total, and releases stock once on cancellation", async () => {
    const [catalog] = await client.db.select().from(schema.products).where(eq(schema.products.id, productId));
    try {
      await client.db.update(schema.products).set({ variants: catalog!.variants.map(variant => ({ ...variant, stockQuantity: 1 })) }).where(eq(schema.products.id, productId));
      const payload = { ...orderPayload(), payment: { method: "BKASH", amountMinor: 56000 } };
      const reserved = await request("/api/v1/orders/reserve", payload);
      expect(reserved.status).toBe("AWAITING_PAYMENT");
      expect((await request("/api/v1/orders/reserve", payload)).id).toBe(reserved.id);
      expect((await app.inject({ method: "POST", url: "/api/v1/orders/reserve", payload: { ...payload, requestId: randomUUID() } })).statusCode).toBe(409);
      expect(await client.db.select().from(schema.orderCardAllocations)).toHaveLength(0);
      expect(await client.db.select().from(schema.orderEmails)).toHaveLength(0);
      const [remaining] = await client.db.select().from(schema.products).where(eq(schema.products.id, productId));
      await client.db.update(schema.products).set({ variants: remaining!.variants.map(variant => ({ ...variant, priceMinor: 60000 })) }).where(eq(schema.products.id, productId));
      const paid = await request("/api/v1/orders", { ...payload, payment: { ...payload.payment, transactionId: "AUDITPAY01" } });
      expect(paid).toMatchObject({ id: reserved.id, status: "RECEIVED", totalMinor: 56000 });
      const cancelUrl = `/api/v1/orders/admin/${paid.id}/cancel`;
      expect((await app.inject({ method: "POST", url: cancelUrl, headers, payload: { reason: "Customer cancelled" } })).statusCode).toBe(409);
      await request(cancelUrl, { reason: "Customer cancelled", refundConfirmed: true });
      await request(cancelUrl, { reason: "Customer cancelled", refundConfirmed: true });
      expect((await client.db.select().from(schema.products).where(eq(schema.products.id, productId)))[0]!.variants[0]!.stockQuantity).toBe(1);
      expect((await app.inject({ method: "POST", url: `/api/v1/orders/admin/${paid.id}/fulfillment`, headers, payload: { status: "PROCESSING" } })).statusCode).toBe(409);
    } finally { await client.db.update(schema.products).set({ variants: catalog!.variants }).where(eq(schema.products.id, productId)); }
  });

  it("never allocates a card after issuing its private activation code", async () => {
    const card = await readyForClaim(); await issue(card.id); await order();
    expect(await client.db.select().from(schema.orderCardAllocations)).toHaveLength(0);
    expect((await client.db.select().from(schema.cards))[0]!.inventoryStatus).toBe("RESERVED");
  });

  it("creates company accounts from one-use invitation links and revokes sessions on reset", async () => {
    const { createAccountLink } = await import("../src/domain/account-tokens.js");
    const link = await createAccountLink("invited@example.com", "invite", { name: "Invited Company" });
    const input = { token: link.token, password: "a long invitation password", displayName: "Invited Owner" };
    await request("/api/v1/customer/account-link/complete", input);
    expect((await app.inject({ method: "POST", url: "/api/v1/customer/account-link/complete", payload: input })).statusCode).toBe(400);
    const login = await request("/api/v1/customer/login", { email: "invited@example.com", password: input.password });
    const auth = { authorization: `Bearer ${login.accessToken}` };
    expect((await app.inject({ url: "/api/v1/company/me", headers: auth })).json().items).toHaveLength(1);
    const reset = await createAccountLink("invited@example.com", "reset");
    await request("/api/v1/customer/account-link/complete", { token: reset.token, password: "another long password" });
    expect((await app.inject({ url: "/api/v1/customer/me", headers: auth })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/v1/customer/login", payload: { email: "invited@example.com", password: input.password } })).statusCode).toBe(401);
    expect((await request("/api/v1/customer/login", { email: "invited@example.com", password: "another long password" })).accessToken).toBeTruthy();
    const expired = await createAccountLink("invited@example.com", "reset");
    await client.db.update(schema.accountTokens).set({ expiresAt: new Date(0) });
    expect((await app.inject({ method: "POST", url: "/api/v1/customer/account-link/complete", payload: { token: expired.token, password: "another long password" } })).statusCode).toBe(400);
  });

  it("serializes competing password resets and atomically invalidates reset links after a password change", async () => {
    const { createAccountLink } = await import("../src/domain/account-tokens.js");
    const invite = await createAccountLink("reset-race@example.com", "invite", { name: "Reset Race" });
    await request("/api/v1/customer/account-link/complete", { token: invite.token, password: "initial reset race password", displayName: "Reset Race" });
    const links = await Promise.all([createAccountLink("reset-race@example.com", "reset"), createAccountLink("reset-race@example.com", "reset")]);
    const complete = (token: string, password: string) => app.inject({ method: "POST", url: "/api/v1/customer/account-link/complete", payload: { token, password } });
    const reset = await Promise.all(links.map((link, i) => complete(link.token, `new competing password ${i}`)));
    expect(reset.map(result => result.statusCode).sort()).toEqual([200, 400]);
    const currentPassword = `new competing password ${reset.findIndex(result => result.statusCode === 200)}`;
    const login = await request("/api/v1/customer/login", { email: "reset-race@example.com", password: currentPassword });
    const stale = await createAccountLink("reset-race@example.com", "reset");
    const changed = await app.inject({ method: "POST", url: "/api/v1/customer/me/password", headers: { authorization: `Bearer ${login.accessToken}` },
      payload: { currentPassword, password: "changed password invalidates resets" } });
    expect(changed.statusCode, changed.body).toBe(200);
    expect((await complete(stale.token, "a stale reset password")).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/v1/customer/me", headers: { authorization: `Bearer ${login.accessToken}` } })).statusCode).toBe(401);
    expect((await request("/api/v1/customer/login", { email: "reset-race@example.com", password: "changed password invalidates resets" })).accessToken).toBeTruthy();
  });

  it("recovers queued email after a restart and fences concurrent send attempts", async () => {
    const result = await order();
    await client.db.delete(schema.orderEmails).where(eq(schema.orderEmails.orderId, result.id));
    await client.db.delete(schema.auditLogs).where(eq(schema.auditLogs.targetId, result.id));
    const { queueOrderEmail, attemptOrderEmail } = await import("../src/domain/order-email-history.js");
    await client.db.transaction(tx => queueOrderEmail(tx, result.id, "confirmation"));
    const send = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 30)); return true; });
    await Promise.all([attemptOrderEmail(result.id, "confirmation", send), attemptOrderEmail(result.id, "confirmation", send)]);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await client.db.select().from(schema.orderEmails))[0]!.status).toBe("accepted");
    const { drainOrderEmails } = await import("../src/domain/order-email-worker.js");
    await client.db.transaction(tx => queueOrderEmail(tx, result.id, "shipping"));
    await client.db.update(schema.storeOrders).set({ shippedAt: new Date(), courierTrackingId: "RECOVERED-1" }).where(eq(schema.storeOrders.id, result.id));
    await drainOrderEmails();
    expect((await client.db.select().from(schema.orderEmails)).find(row => row.kind === "shipping")!.status).toBe("accepted");
  });

  it("persists team enquiries idempotently and supports admin search and pagination", async () => {
    const payload = { requestId: randomUUID(), name: "Team Buyer", email: "teams@example.com", company: "Audit Team", quantity: "12" };
    await request("/api/v1/company/enquiries", payload); await request("/api/v1/company/enquiries", payload);
    expect((await request("/api/v1/company/admin/enquiries?query=Audit%20Team")).items).toHaveLength(1);
    expect((await app.inject({ url: "/api/v1/company/admin/enquiries" })).statusCode).toBe(401);
    await client.db.insert(schema.customerProfiles).values(Array.from({ length: 101 }, (_, i) => ({ publicSlug: `page-${i}`, displayName: `Paged ${i}` })));
    const first = await request("/api/v1/profiles?query=Paged"), second = await request("/api/v1/profiles?query=Paged&page=2");
    expect(first.items).toHaveLength(100); expect(first.hasMore).toBe(true); expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map(row => row.id)).size).toBe(101);
  });

  it("fences a stopped station before recovering its jobs", async () => {
    const station = await request("/api/v1/production/stations/register", { stationCode: `RECOVERY-${randomUUID()}`, name: "Recovery test" });
    const created = await batch(1, false);
    const [job] = await client.db.select().from(schema.productionJobs).where(eq(schema.productionJobs.batchId, created.id));
    const auth = { ...headers, "x-station-key": station.stationCredential };
    expect((await app.inject({ method: "POST", url: `/api/v1/production/jobs/${job!.id}/claim`, headers: auth, payload: { idempotencyKey: randomUUID() } })).statusCode).toBe(200);
    expect((await request(`/api/v1/admin/stations/${station.station.id}/recover-jobs`, {})).recovered).toBe(1);
    expect((await app.inject({ method: "POST", url: `/api/v1/production/jobs/${job!.id}/claim`, headers: auth, payload: { idempotencyKey: randomUUID() } })).statusCode).toBe(401);
    expect((await request(`/api/v1/production/jobs/${job!.id}/claim`, { idempotencyKey: randomUUID() })).job.assignedStationId).not.toBe(station.station.id);
  });

});
