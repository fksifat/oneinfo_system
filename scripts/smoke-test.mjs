import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const baseUrl = process.env.API_URL ?? "http://localhost:3001";
if (!process.env.ONEINFO_SMOKE_NONCE || !["127.0.0.1", "localhost"].includes(new URL(baseUrl).hostname)) throw new Error("Run npm run smoke; direct smoke requests against a live API are disabled.");
const guard = await fetch(`${baseUrl}/__smoke-test-guard`).then(response => response.json());
assert.equal(guard.nonce, process.env.ONEINFO_SMOKE_NONCE, "Disposable smoke API required");

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
await request(`/api/v1/production/batches/${batch.id}/generate-qr`, { method: "POST", body: "{}" }, credentials);
await request(`/api/v1/production/batches/${batch.id}/confirm-print`, { method: "POST", body: JSON.stringify({ confirmed: true }) }, credentials);
const resumedNfc = await request(`/api/v1/production/jobs/${nfc.job.id}/claim`, {
  method: "POST", body: JSON.stringify({ idempotencyKey: randomUUID() }),
}, credentials);
assert.equal(resumedNfc.card.id, card.id, "A station must be able to resume its claimed job after reload");
const urlHash = createHash("sha256").update(card.canonicalUrl).digest("hex");
async function expectStatus(path, body, status, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: {
    "content-type": "application/json", authorization: `Bearer ${accessToken}`, "x-station-key": credentials.stationKey, ...extraHeaders,
  }, body: JSON.stringify(body) });
  assert.equal(response.status, status, `${path}: ${await response.text()}`);
}

await expectStatus(`/api/v1/production/jobs/${nfc.job.id}/nfc-attempts`, {
  idempotencyKey: randomUUID(), result: "SUCCEEDED", expectedUrlHash: "a".repeat(64), readbackUrlHash: "b".repeat(64),
}, 400);
await expectStatus(`/api/v1/production/jobs/${nfc.job.id}/nfc-attempts`, {
  idempotencyKey: randomUUID(), result: "SUCCEEDED", expectedUrlHash: "a".repeat(64), readbackUrlHash: "a".repeat(64),
}, 409);
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

const pairing = await request("/api/v1/local-nfc/pairings", { method: "POST" }, credentials);
const device = await request("/api/v1/local-nfc/devices/pair", {
  method: "POST", body: JSON.stringify({ pairingCode: pairing.pairingCode, deviceName: "API regression test", runtimeVersion: "test" }),
});
const deviceHeaders = { "x-oneinfo-device-token": device.deviceToken };

async function verifyPair(scannedValue, target = card) {
  const scannedQr = target === card ? target.canonicalUrl.replace(/\?source=nfc$/, "?source=qr") : target.canonicalUrl;
  const payload = JSON.stringify({ scanId: randomUUID(), scannedValue: scannedQr });
  const created = await fetch(`${baseUrl}/api/v1/local-nfc/device/verification-from-qr`, {
    method: "POST", headers: { ...deviceHeaders, "content-type": "application/json" }, body: payload,
  });
  assert.equal(created.status, 201);
  const session = await created.json();
  assert.equal(session.expectedUrl, target.canonicalUrl);
  const replay = await fetch(`${baseUrl}/api/v1/local-nfc/device/verification-from-qr`, {
    method: "POST", headers: { ...deviceHeaders, "content-type": "application/json" }, body: payload,
  });
  assert.equal((await replay.json()).id, session.id, "A retried QR scan must resume the same NFC comparison");
  await expectStatus(`/api/v1/local-nfc/device/verification-tasks/${session.id}/result`, { scannedValue }, 200, deviceHeaders);
  return request(`/api/v1/local-nfc/verification-sessions/${session.id}`, {}, credentials);
}

await expectStatus("/api/v1/local-nfc/device/verification-from-qr", { scanId: randomUUID(), scannedValue: `https://unknown.example/${unique}` }, 404, deviceHeaders);
assert.equal((await verifyPair("https://wrong.example/card")).state, "MISMATCH");

const qc = await claim("QUALITY_CONTROL");
await expectStatus(`/api/v1/production/jobs/${qc.job.id}/quality-checks`, {
  idempotencyKey: randomUUID(), result: "PASSED",
}, 409);
assert.equal((await verifyPair(card.canonicalUrl)).state, "MATCHED");
const live = await request(`/api/v1/production/batches/${batch.id}/verification-status`, {}, credentials);
assert.equal(live.items.find((item) => item.id === card.id).verification.cameraResult, "MATCHED");
assert.equal(live.items.find((item) => item.id === card.id).verification.nfcResult, "MATCHED");
await request(
  `/api/v1/production/jobs/${qc.job.id}/quality-checks`,
  {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: randomUUID(), result: "PASSED", evidenceReference: "smoke://verified" }),
  },
  credentials,
);

await expectStatus(`/api/v1/production/jobs/${nfc.job.id}/nfc-attempts`, {
  idempotencyKey: randomUUID(), result: "SUCCEEDED", expectedUrlHash: urlHash, readbackUrlHash: urlHash,
}, 409);
const resumed = await request(`/api/v1/production/jobs/${qc.job.id}/claim`, {
  method: "POST", body: JSON.stringify({ idempotencyKey: qc.job.claimIdempotencyKey }),
}, credentials);
assert.equal(resumed.card.id, card.id, "Idempotent claim must include the card");

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
const namedProfile = await request(`/api/v1/profiles/handle/${profile.handle}`);
assert.equal(namedProfile.cardSlug, card.publicSlug);
assert.equal(namedProfile.profile.id, publicProfile.profile.id);
const history = await request(`/api/v1/production/cards/${card.id}/history`, {}, credentials);
if (history.card.inventoryStatus !== "RESERVED") throw new Error("Assigned card must not remain in saleable inventory");
if (history.card.lifecycleStatus !== "ACTIVATED") throw new Error("Assigned card was not activated");
if (history.events.length < 5) throw new Error("Card traceability history is incomplete");
if (publicProfile.profile.id !== profile.id || cardProfile.profile.id !== profile.id) throw new Error("Public profile resolution failed");
assert.equal(publicProfile.profile.ownerOperatorId, undefined, "Public profile must omit operator ownership");
assert.equal(cardProfile.card.batchId, undefined, "Public card must omit production details");
const otherProfile = await request("/api/v1/profiles", {
  method: "POST", body: JSON.stringify({ publicSlug: `smoke-other-${unique.toLowerCase()}`, displayName: "Smoke Reassignment Guard" }),
}, credentials);
await expectStatus(`/api/v1/profiles/${otherProfile.id}/assign-card`, { cardId: card.id }, 409);

const bulkLinks = [1, 2, 3].map((index) => `https://example.com/oneinfo-qa/${unique}/${index}`);
const bulkBatch = await request("/api/v1/production/batches", { method: "POST", body: JSON.stringify({
  batchCode: `BULK-${unique}`, productVariantId: "QA-QR", quantity: 3, links: bulkLinks,
}) }, credentials);
const generated = await request(`/api/v1/production/batches/${bulkBatch.id}/generate-qr`, { method: "POST", body: "{}" }, credentials);
assert.equal(generated.generated, 3, "Bulk generation must save an image for every card");
const regenerated = await request(`/api/v1/production/batches/${bulkBatch.id}/generate-qr`, { method: "POST", body: "{}" }, credentials);
assert.equal(regenerated.generated, 0, "Repeated bulk generation must retain saved images");
const bulkDetail = await request(`/api/v1/production/batches/${bulkBatch.id}`, {}, credentials);
assert.deepEqual(new Set(bulkDetail.cards.map((item) => item.canonicalUrl)), new Set(bulkLinks));
for (const item of bulkDetail.cards) {
  assert.ok(item.imageData.startsWith("data:image/png;base64,"));
  assert.equal(Buffer.from(item.imageData.split(",")[1], "base64").subarray(1, 4).toString(), "PNG");
  assert.equal(item.qrStatus, "GENERATED");
  assert.equal(item.jobs.find((job) => job.type === "QR_GENERATION").status, "COMPLETED");
}

async function phonePost(path, body) {
  const response = await fetch(`${baseUrl}/api/v1/local-nfc/device${path}`, {
    method: "POST", headers: { ...deviceHeaders, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  assert.ok(response.ok, `${path}: ${JSON.stringify(result)}`);
  return result;
}
const phoneCard = bulkDetail.cards[0];
await expectStatus("/api/v1/local-nfc/device/verification-from-qr", { scanId: randomUUID(), scannedValue: phoneCard.canonicalUrl }, 409, deviceHeaders);
const scan = await phonePost("/resolve-qr", { scanId: randomUUID(), scannedValue: phoneCard.canonicalUrl });
assert.equal(scan.batchCode, bulkBatch.batchCode, "Printed QR automatically identifies its batch");
assert.equal(scan.cardId, phoneCard.id);
assert.equal(scan.nfcStatus, "PENDING", "Printed QR can be checked before NFC exists");
await expectStatus("/api/v1/local-nfc/device/load-to-nfc", { scanId: randomUUID() }, 404, deviceHeaders);
const failedWrite = await phonePost("/load-to-nfc", { scanId: scan.scanId });
await phonePost(`/tasks/${failedWrite.sessionId}/result`, { expectedUrl: phoneCard.canonicalUrl, result: "FAILED", errorCode: "WRITE_FAILED" });
const retryScan = await phonePost("/resolve-qr", { scanId: randomUUID(), scannedValue: phoneCard.canonicalUrl });
const phoneWrite = await phonePost("/load-to-nfc", { scanId: retryScan.scanId });
assert.equal(phoneWrite.expectedUrl, phoneCard.canonicalUrl, "Load to NFC uses the scanned QR link");
assert.equal((await phonePost("/load-to-nfc", { scanId: retryScan.scanId })).sessionId, phoneWrite.sessionId);
const writeResult = { expectedUrl: phoneCard.canonicalUrl, readbackUrl: phoneCard.canonicalUrl, result: "SUCCEEDED" };
await phonePost(`/tasks/${phoneWrite.sessionId}/result`, writeResult);
await phonePost(`/tasks/${phoneWrite.sessionId}/result`, writeResult);
let phoneLive = await request(`/api/v1/production/batches/${bulkBatch.id}/verification-status`, {}, credentials);
let phoneState = phoneLive.items.find((item) => item.id === phoneCard.id);
assert.equal(phoneState.printChecked, true);
assert.equal(phoneState.nfcStatus, "WRITTEN", "Phone write persists without a PC submission");
assert.equal(phoneState.qcStatus, "PENDING", "Writing a card does not pass QC");
assert.equal(phoneState.verification.camera, false, "Initial print check cannot stand in for final QC");
const badQc = await verifyPair("https://wrong.example/nfc", phoneCard);
await expectStatus(`/api/v1/local-nfc/device/verification-tasks/${badQc.id}/approve`, {}, 409, deviceHeaders);
const goodQc = await verifyPair(phoneCard.canonicalUrl, phoneCard);
const newerQr = await phonePost("/verification-from-qr", { scanId: randomUUID(), scannedValue: phoneCard.canonicalUrl });
await expectStatus(`/api/v1/local-nfc/device/verification-tasks/${goodQc.id}/approve`, {}, 409, deviceHeaders);
phoneLive = await request(`/api/v1/production/batches/${bulkBatch.id}/verification-status`, {}, credentials);
assert.equal(phoneLive.items.find((item) => item.id === phoneCard.id).verification.nfcResult, "PENDING", "A fresh QR check cannot reuse an earlier NFC scan");
await phonePost(`/verification-tasks/${newerQr.sessionId}/result`, { scannedValue: phoneCard.canonicalUrl, uid: "QA-TAG" });
assert.equal((await phonePost(`/verification-tasks/${newerQr.sessionId}/approve`, {})).qcStatus, "PASSED");
assert.equal((await phonePost(`/verification-tasks/${newerQr.sessionId}/approve`, {})).replayed, true);
const phoneHistory = await request(`/api/v1/production/cards/${phoneCard.id}/history`, {}, credentials);
assert.equal(phoneHistory.card.inventoryStatus, "SALEABLE");
assert.equal(phoneHistory.events.filter((event) => event.eventType === "NFC_VERIFIED").length, 1, "Retrying a write result must not duplicate production evidence");

const readSession = await request("/api/v1/local-nfc/read-sessions", { method: "POST" }, credentials);
await expectStatus("/api/v1/local-nfc/read-sessions", {}, 409);
const taskResponse = await fetch(`${baseUrl}/api/v1/local-nfc/device/read-tasks/next`, { headers: deviceHeaders });
assert.equal((await taskResponse.json()).sessionId, readSession.id);
const readResult = { uid: "01020304", techList: ["android.nfc.tech.Ndef"], ndefFormatted: true, records: [] };
await expectStatus(`/api/v1/local-nfc/device/read-tasks/${readSession.id}/result`, readResult, 200, deviceHeaders);
await expectStatus(`/api/v1/local-nfc/device/read-tasks/${readSession.id}/result`, { ...readResult, uid: "05060708" }, 409, deviceHeaders);

await expectStatus("/api/v1/local-nfc/utility-sessions", { operation: "WRITE", recordType: "URL", value: "https://example.com" }, 400);
await expectStatus("/api/v1/local-nfc/utility-sessions", { operation: "WRITE", recordType: "URL", value: "javascript:alert(1)", overwriteConfirmed: true }, 400);
const utilityWrite = await request("/api/v1/local-nfc/utility-sessions", { method: "POST", body: JSON.stringify({
  operation: "WRITE", recordType: "URL", value: "https://example.com/tool-test", overwriteConfirmed: true,
}) }, credentials);
await expectStatus("/api/v1/local-nfc/device/utility-sessions", { operation: "READ" }, 409, deviceHeaders);
const utilityTask = await fetch(`${baseUrl}/api/v1/local-nfc/device/read-tasks/next`, { headers: deviceHeaders }).then((response) => response.json());
assert.equal(utilityTask.sessionId, utilityWrite.id);
assert.equal(utilityTask.utility.value, "https://example.com/tool-test");
const utilityResult = { ...readResult, records: [{ tnf: 1, type: "U", payloadHex: "00", uri: "https://example.com/wrong" }] };
assert.equal((await phonePost(`/read-tasks/${utilityWrite.id}/result`, utilityResult)).state, "FAILED", "Utility URL readback mismatch is rejected");
assert.equal((await phonePost(`/read-tasks/${utilityWrite.id}/result`, utilityResult)).state, "FAILED", "Failed result retries are idempotent");
await expectStatus(`/api/v1/local-nfc/device/read-tasks/${utilityWrite.id}/result`, { ...utilityResult, uid: "05060708" }, 409, deviceHeaders);
const text = " বাংলা NFC test\nSecond line ";
const textWrite = await phonePost("/utility-sessions", { operation: "WRITE", recordType: "TEXT", value: text, overwriteConfirmed: true });
assert.equal((await phonePost(`/read-tasks/${textWrite.id}/result`, { ...readResult, records: [{ tnf: 1, type: "T", payloadHex: "00", payloadText: text }] })).state, "COMPLETED");
const stopped = await phonePost("/utility-sessions", { operation: "READ" });
await request(`/api/v1/local-nfc/utility-sessions/${stopped.id}/cancel`, { method: "POST" }, credentials);
await expectStatus(`/api/v1/local-nfc/device/read-tasks/${stopped.id}/result`, readResult, 409, deviceHeaders);
const phoneStopped = await phonePost("/utility-sessions", { operation: "READ" });
assert.equal((await phonePost(`/read-tasks/${phoneStopped.id}/cancel`, {})).state, "CANCELLED");
const toolActivity = await request("/api/v1/local-nfc/utility-sessions", {}, credentials);
assert.equal(toolActivity.items.find((item) => item.id === textWrite.id).result.records[0].payloadText, text);
assert.equal(toolActivity.items.find((item) => item.id === utilityWrite.id).result.errorCode, "READBACK_MISMATCH");
await expectStatus("/api/v1/local-nfc/device/utility-sessions", { operation: "ERASE" }, 400, deviceHeaders);
const badErase = await phonePost("/utility-sessions", { operation: "ERASE", overwriteConfirmed: true });
assert.equal((await phonePost(`/read-tasks/${badErase.id}/result`, utilityResult)).state, "FAILED", "Erase must reject nonempty readback");
assert.equal((await phonePost(`/read-tasks/${badErase.id}/result`, utilityResult)).state, "FAILED", "Erase retries are idempotent");
const unformattedErase = await phonePost("/utility-sessions", { operation: "ERASE", overwriteConfirmed: true });
assert.equal((await phonePost(`/read-tasks/${unformattedErase.id}/result`, { ...readResult, ndefFormatted: false })).state, "FAILED", "Unformatted/no-readback is not proof of erase");
const erase = await request("/api/v1/local-nfc/utility-sessions", { method: "POST", body: JSON.stringify({ operation: "ERASE", overwriteConfirmed: true }) }, credentials);
const eraseTask = await fetch(`${baseUrl}/api/v1/local-nfc/device/read-tasks/next`, { headers: deviceHeaders }).then((response) => response.json());
assert.equal(eraseTask.utility.operation, "ERASE");
assert.equal(eraseTask.sessionId, erase.id);
const emptyTag = { ...readResult, records: [{ tnf: 0, type: "", payloadHex: "", idHex: "" }] };
assert.equal((await phonePost(`/read-tasks/${erase.id}/result`, emptyTag)).state, "COMPLETED", "Erase accepts a verified TNF_EMPTY record");
await expectStatus(`/api/v1/local-nfc/device/read-tasks/${erase.id}/result`, utilityResult, 409, deviceHeaders);
const afterTools = await request(`/api/v1/production/cards/${phoneCard.id}/history`, {}, credentials);
assert.equal(afterTools.events.length, phoneHistory.events.length, "General NFC tools must not create production events");
assert.equal(afterTools.card.qcStatus, "PASSED", "Utility results do not change production QC status");
await request(`/api/v1/admin/stations/${stationResponse.station.id}/revoke`, { method: "POST" }, credentials);
const revoked = await fetch(`${baseUrl}/api/v1/local-nfc/device/read-tasks/next`, { headers: deviceHeaders });
assert.equal(revoked.status, 401, "Revoked station must invalidate paired devices");

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
