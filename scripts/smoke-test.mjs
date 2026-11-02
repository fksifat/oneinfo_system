import { createHash, randomUUID } from "node:crypto";

const baseUrl = process.env.API_URL ?? "http://localhost:3001";

async function request(path, options = {}, credentials = {}) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("content-type", "application/json");
  if (credentials.accessToken) headers.set("authorization", `Bearer ${credentials.accessToken}`);
  if (credentials.stationKey) headers.set("x-station-key", credentials.stationKey);
  headers.set("x-request-id", randomUUID());
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const body = await response.json();
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path}: ${body.message ?? response.status}`);
  return body;
}

const tokenResponse = await request("/api/v1/dev/token", { method: "POST" });
const accessToken = tokenResponse.accessToken;
const unique = Date.now().toString(36).toUpperCase();
const stationResponse = await request(
  "/api/v1/production/stations/register",
  {
    method: "POST",
    body: JSON.stringify({ stationCode: `SMOKE-${unique}`, name: "Smoke test station", metadata: { automated: true } }),
  },
  { accessToken },
);
const credentials = { accessToken, stationKey: stationResponse.stationCredential };

const batch = await request(
  "/api/v1/production/batches",
  {
    method: "POST",
    body: JSON.stringify({ batchCode: `SMOKE-${unique}`, productVariantId: "ONEINFO-NFC-CARD", quantity: 1 }),
  },
  credentials,
);

const queue = await request("/api/v1/production/jobs", {}, credentials);
const batchJobs = queue.items.filter((item) => item.job.batchId === batch.id);
if (batchJobs.length !== 3) throw new Error(`Expected 3 jobs, received ${batchJobs.length}`);
const card = batchJobs[0].card;

async function claim(type) {
  const item = batchJobs.find((candidate) => candidate.job.type === type);
  if (!item) throw new Error(`Missing ${type} job`);
  return request(
    `/api/v1/production/jobs/${item.job.id}/claim`,
    { method: "POST", body: JSON.stringify({ idempotencyKey: randomUUID() }) },
    credentials,
  );
}

const qr = await claim("QR_GENERATION");
await request(
  `/api/v1/production/jobs/${qr.job.id}/qr-results`,
  {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: randomUUID(),
      format: "PNG",
      storageKey: `${batch.batchCode}/${card.id}_qr.png`,
      checksumSha256: createHash("sha256").update(card.canonicalUrl).digest("hex"),
      width: 320,
      height: 320,
      generatorVersion: "smoke-test",
    }),
  },
  credentials,
);

const nfc = await claim("NFC_ENCODING");
const urlHash = createHash("sha256").update(card.canonicalUrl).digest("hex");
await request(
  `/api/v1/production/jobs/${nfc.job.id}/nfc-attempts`,
  {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: randomUUID(),
      result: "SUCCEEDED",
      expectedUrlHash: urlHash,
      readbackUrlHash: urlHash,
      deviceMetadata: { adapter: "smoke-test" },
    }),
  },
  credentials,
);

const qc = await claim("QUALITY_CONTROL");
await request(
  `/api/v1/production/jobs/${qc.job.id}/quality-checks`,
  {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: randomUUID(), result: "PASSED", evidenceReference: "smoke://verified" }),
  },
  credentials,
);

const profile = await request(
  "/api/v1/profiles",
  {
    method: "POST",
    body: JSON.stringify({
      publicSlug: `smoke-${unique.toLowerCase()}`,
      displayName: "Smoke Test Client",
      headline: "Verified Oneinfo profile",
      company: "Oneinfo QA",
      bio: "End-to-end profile and card assignment verification.",
      email: "smoke@example.com",
      website: "https://example.com",
      theme: "MIDNIGHT",
      published: true,
      links: [{ label: "Portfolio", url: "https://example.com/portfolio", sortOrder: 0, active: true }],
    }),
  },
  credentials,
);
await request(
  `/api/v1/profiles/${profile.id}/assign-card`,
  { method: "POST", body: JSON.stringify({ cardId: card.id }) },
  credentials,
);

const publicProfile = await request(`/api/v1/profiles/public/${profile.publicSlug}`);
const cardProfile = await request(`/api/v1/profiles/card/${card.publicSlug}`);
const history = await request(`/api/v1/production/cards/${card.id}/history`, {}, credentials);
if (history.card.inventoryStatus !== "SALEABLE") throw new Error("QC-passed card was not released to saleable inventory");
if (history.card.lifecycleStatus !== "ACTIVATED") throw new Error("Assigned card was not activated");
if (history.events.length < 5) throw new Error("Card traceability history is incomplete");
if (publicProfile.profile.id !== profile.id || cardProfile.profile.id !== profile.id) throw new Error("Public profile resolution failed");

console.log(
  JSON.stringify(
    {
      batch: batch.batchCode,
      cardId: card.id,
      canonicalUrl: card.canonicalUrl,
      profileSlug: profile.publicSlug,
      finalState: history.card.lifecycleStatus,
      inventoryStatus: history.card.inventoryStatus,
      eventCount: history.events.length,
    },
    null,
    2,
  ),
);
