import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

// This suite only mutates the disposable database created by test:printed-stock.
describe.skipIf(process.env.ONEINFO_PRINT_STOCK_TEST !== "1")("confirmed print stock and orders", () => {
  let app: FastifyInstance;
  let client: typeof import("../src/db/client.js");
  let schema: typeof import("../src/db/schema.js");
  let headers: Record<string, string>;
  const productId = randomUUID(), variantId = randomUUID();

  beforeAll(async () => {
    const { config } = await import("../src/config.js");
    if (!/^\/oneinfo_print_stock_\d+_test$/.test(new URL(config.DATABASE_URL).pathname)) throw new Error("Disposable test database required");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url !== "https://api.resend.com/emails") throw new Error("Unexpected external request");
      return Response.json({ id: "test-email" });
    }));
    client = await import("../src/db/client.js");
    schema = await import("../src/db/schema.js");
    app = (await import("../src/app.js")).buildApp();
    const auth = (await app.inject({ method: "POST", url: "/api/v1/dev/token" })).json();
    headers = { authorization: `Bearer ${auth.accessToken}` };
    const station = (await app.inject({ method: "POST", url: "/api/v1/production/stations/register", headers,
      payload: { stationCode: "PRINT-TEST", name: "Print test" } })).json();
    headers["x-station-key"] = station.stationCredential;
    await client.db.insert(schema.products).values({ id: productId, slug: "test-card", name: "Test card", priceMinor: 50000, status: "PUBLISHED",
      variants: [{ id: variantId, name: "Standard", priceMinor: 50000, available: true, imageUrl: "" }] });
    await client.db.insert(schema.storeShippingSettings).values({ id: "default", rates: { insideDhaka: 6000, subDhaka: 10000, outsideDhaka: 12000 }, codAdvanceTaka: 0 });
  });
  beforeEach(async () => {
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
  function orderPayload(quantity = 1) {
    return { requestId: randomUUID(), customer: { name: "Test buyer", email: "buyer@example.com", phone: "01712345678" },
      deliveryAddress: { district: "Dhaka", dhakaArea: "city", addressLine: "Test address" }, shippingMinor: 6000,
      items: [{ productId, variantId, quantity, unitPriceMinor: 50000 }] };
  }
  const order = (quantity = 1) => request("/api/v1/orders", orderPayload(quantity));

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

  it("runs a reserved order card through the complete phone workflow", async () => {
    await confirm((await batch(1)).id);
    await order();
    const [card] = await client.db.select().from(schema.cards);
    const send = await phone();
    const scanId = randomUUID();
    expect((await send("resolve-qr", { scanId, scannedValue: card!.canonicalUrl })).statusCode).toBe(200);
    const write = await send("load-to-nfc", { scanId });
    expect(write.statusCode, write.body).toBe(201);
    const result = { result: "SUCCEEDED", expectedUrl: card!.canonicalUrl, readbackUrl: card!.canonicalUrl };
    expect((await send(`tasks/${scanId}/result`, result)).statusCode).toBe(200);
    expect((await send(`tasks/${scanId}/result`, result)).statusCode).toBe(200);
    const wrongScan = randomUUID();
    expect((await send("verification-from-qr", { scanId: wrongScan, scannedValue: card!.canonicalUrl })).statusCode).toBe(201);
    expect((await send(`verification-tasks/${wrongScan}/result`, { scannedValue: "https://example.com/wrong-card" })).json().state).toBe("MISMATCH");
    expect((await send(`verification-tasks/${wrongScan}/approve`, {})).statusCode).toBe(409);
    const finalScan = randomUUID();
    expect((await send("verification-from-qr", { scanId: finalScan, scannedValue: card!.canonicalUrl })).statusCode).toBe(201);
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

  it("serializes competing checkouts and idempotent retries without sharing a QR", async () => {
    await confirm((await batch(1)).id);
    const input = orderPayload();
    const results = await Promise.all([request("/api/v1/orders", input), request("/api/v1/orders", input), order()]);
    expect(results[0].id).toBe(results[1].id);
    expect(await client.db.select().from(schema.storeOrders)).toHaveLength(2);
    expect(await client.db.select().from(schema.orderCardAllocations)).toHaveLength(1);
    const admin = (await request("/api/v1/orders/admin")).items;
    expect(admin.map((item: any) => item.qrAllocation.assigned).sort()).toEqual([0, 1]);
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
});
