import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { api, sha256, type Credentials } from "./api.js";
import { nfcAdapter } from "./nfc.js";

type JobType = "QR_GENERATION" | "NFC_ENCODING" | "QUALITY_CONTROL";

interface Card {
  id: string;
  publicSlug: string;
  canonicalUrl: string;
  qrStatus: string;
  nfcStatus: string;
  qcStatus: string;
  inventoryStatus: string;
}

interface Job {
  id: string;
  type: JobType;
  status: string;
  cardId: string;
  assignedStationId: string | null;
}

interface QueueItem {
  job: Job;
  card: Card;
}

interface ActiveWork {
  job: Job;
  card: Card;
}

interface NfcReadRecord {
  tnf: number;
  type: string;
  idHex: string;
  payloadHex: string;
  payloadText?: string;
  uri?: string;
}

interface NfcReadResult {
  uid: string;
  techList: string[];
  ndefFormatted: boolean;
  ndefType?: string;
  writable?: boolean;
  maxSize?: number;
  messageSize?: number;
  records: NfcReadRecord[];
  deviceMetadata: Record<string, unknown>;
  errorCode?: string;
}

interface NfcReadSession {
  id: string;
  state: "PENDING" | "READING" | "COMPLETED" | "FAILED";
  result?: NfcReadResult;
}

const emptyCredentials: Credentials = { accessToken: "", stationKey: "" };

function getStoredCredentials(): Credentials {
  try {
    return JSON.parse(localStorage.getItem("oneinfo.credentials") ?? "null") ?? emptyCredentials;
  } catch {
    return emptyCredentials;
  }
}

export function App() {
  const [credentials, setCredentials] = useState<Credentials>(getStoredCredentials);
  const [stationCode, setStationCode] = useState("PROD-01");
  const [batchCode, setBatchCode] = useState(`BATCH-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`);
  const [quantity, setQuantity] = useState(3);
  const [jobs, setJobs] = useState<QueueItem[]>([]);
  const [active, setActive] = useState<ActiveWork | null>(null);
  const [qrPreview, setQrPreview] = useState("");
  const [message, setMessage] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState<{ pairingCode: string; expiresAt: string } | null>(null);
  const [readResult, setReadResult] = useState<NfcReadResult | null>(null);

  const configured = Boolean(credentials.accessToken && credentials.stationKey);

  const saveCredentials = (next: Credentials) => {
    localStorage.setItem("oneinfo.credentials", JSON.stringify(next));
    setCredentials(next);
  };

  async function stationApi<T>(path: string, init: RequestInit = {}): Promise<T> {
    try {
      return await api<T>(path, init, credentials);
    } catch (error) {
      const expired = error instanceof Error && error.message === "Invalid or expired operator token";
      if (!expired) throw error;
      const token = await api<{ accessToken: string }>("/api/v1/dev/token", { method: "POST" });
      const renewed = { ...credentials, accessToken: token.accessToken };
      saveCredentials(renewed);
      return api<T>(path, init, renewed);
    }
  }

  const bootstrap = async () => {
    setBusy(true);
    try {
      const token = await api<{ accessToken: string }>("/api/v1/dev/token", { method: "POST" });
      const station = await api<{ stationCredential: string }>(
        "/api/v1/production/stations/register",
        {
          method: "POST",
          body: JSON.stringify({ stationCode, name: `Production station ${stationCode}`, metadata: { client: "web-mvp" } }),
        },
        { accessToken: token.accessToken },
      );
      saveCredentials({ accessToken: token.accessToken, stationKey: station.stationCredential });
      setMessage(`Station ${stationCode} registered. The credential is stored only in this browser.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  };

  const refreshJobs = useCallback(async () => {
    if (!configured) return;
    try {
      const response = await stationApi<{ items: QueueItem[] }>("/api/v1/production/jobs");
      setJobs(response.items);
      setMessage(`${response.items.length} available or assigned jobs`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load jobs");
    }
  }, [configured, credentials]);

  useEffect(() => {
    void refreshJobs();
  }, [refreshJobs]);

  const createBatch = async () => {
    setBusy(true);
    try {
      await stationApi(
        "/api/v1/production/batches",
        {
          method: "POST",
          body: JSON.stringify({ batchCode, productVariantId: "ONEINFO-NFC-CARD", quantity }),
        },
      );
      setMessage(`Created ${batchCode} with ${quantity} cards and ${quantity * 3} production jobs.`);
      await refreshJobs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Batch creation failed");
    } finally {
      setBusy(false);
    }
  };

  const createDesktopPairing = async () => {
    setBusy(true);
    try {
      const result = await stationApi<{ pairingCode: string; expiresAt: string }>(
        "/api/v1/local-nfc/pairings",
        { method: "POST" },
      );
      setPairing(result);
      setMessage("NFC pairing code created. Enter it in the Android companion or desktop USB-reader bridge.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create NFC pairing code");
    } finally {
      setBusy(false);
    }
  };

  const readNfcTag = async () => {
    setBusy(true);
    setReadResult(null);
    try {
      const created = await stationApi<NfcReadSession>("/api/v1/local-nfc/read-sessions", { method: "POST" });
      setMessage("Read request sent. Hold the NFC tag against the back of the Android phone.");
      const deadline = Date.now() + 2 * 60_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        const session = await stationApi<NfcReadSession>(`/api/v1/local-nfc/read-sessions/${created.id}`);
        if (session.state === "FAILED") throw new Error(session.result?.errorCode ?? "NFC read failed");
        if (session.state === "COMPLETED" && session.result) {
          setReadResult(session.result);
          setMessage(`NFC tag ${session.result.uid || "without UID"} read successfully.`);
          return;
        }
      }
      throw new Error("Timed out waiting for an NFC tag");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "NFC read failed");
    } finally {
      setBusy(false);
    }
  };

  const claim = async (item: QueueItem) => {
    setBusy(true);
    try {
      const response = await stationApi<ActiveWork>(
        `/api/v1/production/jobs/${item.job.id}/claim`,
        { method: "POST", body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) },
      );
      setActive({ job: response.job, card: response.card });
      if (response.job.type === "QR_GENERATION") {
        setQrPreview(await QRCode.toDataURL(response.card.canonicalUrl, { errorCorrectionLevel: "H", margin: 4, width: 320 }));
      } else {
        setQrPreview("");
      }
      setMessage(`Claimed ${response.job.type} job`);
      await refreshJobs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not claim job");
    } finally {
      setBusy(false);
    }
  };

  const completeQr = async () => {
    if (!active || !qrPreview) return;
    setBusy(true);
    try {
      const blob = await (await fetch(qrPreview)).blob();
      await stationApi(
        `/api/v1/production/jobs/${active.job.id}/qr-results`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            format: "PNG",
            storageKey: `${batchCode}/${active.card.id}_qr.png`,
            checksumSha256: await sha256(blob),
            width: 320,
            height: 320,
            generatorVersion: "qrcode-js/1.5.4",
          }),
        },
      );
      setMessage("QR generated, checksummed, and recorded.");
      setActive(null);
      await refreshJobs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "QR submission failed");
    } finally {
      setBusy(false);
    }
  };

  const completeNfc = async () => {
    if (!active) return;
    setBusy(true);
    try {
      setMessage("Waiting for the paired NFC device. Present the card when prompted.");
      const result = await nfcAdapter.writeAndReadBack({
        jobId: active.job.id,
        url: active.card.canonicalUrl,
        credentials,
      });
      const expectedUrlHash = await sha256(result.expectedUrl);
      const readbackUrlHash = result.readbackUrl ? await sha256(result.readbackUrl) : undefined;
      const verified = result.result === "SUCCEEDED" && expectedUrlHash === readbackUrlHash;
      await stationApi(
        `/api/v1/production/jobs/${active.job.id}/nfc-attempts`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            result: verified ? "SUCCEEDED" : "FAILED",
            expectedUrlHash,
            ...(readbackUrlHash ? { readbackUrlHash } : {}),
            ...(!verified ? { errorCode: result.errorCode ?? "READBACK_MISMATCH" } : {}),
            deviceMetadata: result.deviceMetadata,
          }),
        },
      );
      setMessage(verified ? "The paired NFC device wrote the NDEF URI and verified it by read-back." : `NFC write failed: ${result.errorCode ?? "READBACK_MISMATCH"}`);
      setActive(null);
      await refreshJobs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "NFC attempt failed");
    } finally {
      setBusy(false);
    }
  };

  const completeQc = async (result: "PASSED" | "FAILED") => {
    if (!active) return;
    setBusy(true);
    try {
      await stationApi(
        `/api/v1/production/jobs/${active.job.id}/quality-checks`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            result,
            ...(result === "FAILED" ? { reason: "Manual inspection failed" } : {}),
            evidenceReference: `console://${active.card.id}/${new Date().toISOString()}`,
          }),
        },
      );
      setMessage(result === "PASSED" ? "QC passed; card released to saleable inventory." : "QC failed; card quarantined.");
      setActive(null);
      await refreshJobs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Quality check failed");
    } finally {
      setBusy(false);
    }
  };

  const groupedJobs = useMemo(
    () => ({
      QR_GENERATION: jobs.filter((item) => item.job.type === "QR_GENERATION"),
      NFC_ENCODING: jobs.filter((item) => item.job.type === "NFC_ENCODING"),
      QUALITY_CONTROL: jobs.filter((item) => item.job.type === "QUALITY_CONTROL"),
    }),
    [jobs],
  );

  return (
    <div className="app-shell">
      <header>
        <div>
          <p className="eyebrow">ONEINFO OPERATIONS</p>
          <h1>QR and NFC Production</h1>
        </div>
        <span className={configured ? "status online" : "status"}>{configured ? "Station ready" : "Setup required"}</span>
      </header>

      <main>
        {!configured ? (
          <section className="panel setup-panel">
            <p className="section-label">First-run setup</p>
            <h2>Register this workstation</h2>
            <p>The development flow creates an administrator token and a revocable station credential.</p>
            <label>
              Station code
              <input value={stationCode} onChange={(event) => setStationCode(event.target.value)} />
            </label>
            <button disabled={busy} onClick={() => void bootstrap()}>Register workstation</button>
          </section>
        ) : (
          <>
            <section className="panel batch-panel">
              <div>
                <p className="section-label">Batch control</p>
                <h2>Create production work</h2>
              </div>
              <label>Batch code<input value={batchCode} onChange={(event) => setBatchCode(event.target.value)} /></label>
              <label>Cards<input type="number" min="1" max="1000" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
              <button disabled={busy} onClick={() => void createBatch()}>Create batch</button>
            </section>

            <section className="panel desktop-nfc-panel">
              <div><p className="section-label">LOCAL NFC DEVICE</p><h2>NFC bridge</h2><p>Connect an NFC-capable Android phone through <code>adb reverse</code>, or use a PC/SC USB reader.</p></div>
              {pairing ? <div className="pairing-code"><small>PAIRING CODE</small><strong>{pairing.pairingCode}</strong><span>Expires {new Date(pairing.expiresAt).toLocaleTimeString()}</span></div> : null}
              <div className="nfc-bridge-actions"><button disabled={busy} onClick={() => void readNfcTag()}>Read NFC tag</button><button className="secondary" disabled={busy} onClick={() => void createDesktopPairing()}>{pairing ? "New pairing code" : "Pair NFC device"}</button></div>
            </section>

            {readResult ? <NfcInspector result={readResult} onClose={() => setReadResult(null)} /> : null}

            <section className="queue-grid">
              {(Object.entries(groupedJobs) as [JobType, QueueItem[]][]).map(([type, items]) => (
                <article className="panel queue" key={type}>
                  <div className="queue-heading"><h2>{type.replaceAll("_", " ")}</h2><strong>{items.length}</strong></div>
                  {items.length === 0 ? <p className="empty">No pending work</p> : items.slice(0, 8).map((item) => (
                    <button className="job" key={item.job.id} disabled={busy} onClick={() => void claim(item)}>
                      <span>{item.card.publicSlug}</span><small>{item.job.status}</small>
                    </button>
                  ))}
                </article>
              ))}
            </section>

            {active ? (
              <section className="panel workbench">
                <div>
                  <p className="section-label">Active work</p>
                  <h2>{active.job.type.replaceAll("_", " ")}</h2>
                  <p className="url">{active.card.canonicalUrl}</p>
                </div>
                {active.job.type === "QR_GENERATION" && qrPreview ? <img src={qrPreview} alt="Generated QR preview" /> : null}
                {active.job.type === "NFC_ENCODING" ? <p className="device-note">Device: {nfcAdapter.name}. Connect Android through ADB or run the PC/SC USB-reader task, then pair it with this station.</p> : null}
                <div className="actions">
                  {active.job.type === "QR_GENERATION" ? <button disabled={busy} onClick={() => void completeQr()}>Verify and record QR</button> : null}
                  {active.job.type === "NFC_ENCODING" ? <button disabled={busy} onClick={() => void completeNfc()}>Write and verify NFC</button> : null}
                  {active.job.type === "QUALITY_CONTROL" ? <><button disabled={busy} onClick={() => void completeQc("PASSED")}>Pass QC</button><button className="secondary" disabled={busy} onClick={() => void completeQc("FAILED")}>Quarantine</button></> : null}
                  <button className="secondary" onClick={() => setActive(null)}>Close</button>
                </div>
              </section>
            ) : null}
          </>
        )}
      </main>

      <footer><span>{busy ? "Working…" : message}</span><button className="text-button" disabled={!configured || busy} onClick={() => void refreshJobs()}>Refresh queue</button></footer>
    </div>
  );
}

function NfcInspector({ result, onClose }: { result: NfcReadResult; onClose: () => void }) {
  return <section className="panel nfc-inspector">
    <div className="inspector-head"><div><p className="section-label">LIVE TAG INSPECTION</p><h2>NFC tag details</h2></div><span className={result.ndefFormatted ? "tag-state formatted" : "tag-state"}>{result.ndefFormatted ? "NDEF formatted" : "Not NDEF formatted"}</span><button className="secondary" onClick={onClose}>Close</button></div>
    <div className="tag-facts">
      <div><small>Tag UID</small><strong>{result.uid || "Unavailable"}</strong></div>
      <div><small>NDEF type</small><strong>{result.ndefType ?? "—"}</strong></div>
      <div><small>Writable</small><strong>{result.writable === undefined ? "Unknown" : result.writable ? "Yes" : "No"}</strong></div>
      <div><small>Capacity</small><strong>{result.maxSize === undefined ? "—" : `${result.maxSize} bytes`}</strong></div>
      <div><small>Message size</small><strong>{result.messageSize === undefined ? "—" : `${result.messageSize} bytes`}</strong></div>
      <div><small>Records</small><strong>{result.records.length}</strong></div>
    </div>
    <div className="tech-list"><small>Technologies</small><div>{result.techList.map((tech) => <code key={tech}>{tech.split(".").at(-1)}</code>)}</div></div>
    <div className="ndef-records">
      {result.records.map((record, index) => <article key={`${index}-${record.payloadHex}`}>
        <div><span>Record {index + 1}</span><b>TNF {record.tnf} · {record.type || "Unknown type"}</b></div>
        {record.uri ? <p><small>Resolved URI</small><a href={record.uri} target="_blank" rel="noreferrer">{record.uri}</a></p> : null}
        {record.payloadText ? <p><small>Text</small><strong>{record.payloadText}</strong></p> : null}
        <p><small>Payload (hex)</small><code>{record.payloadHex || "Empty"}</code></p>
        {record.idHex ? <p><small>Record ID (hex)</small><code>{record.idHex}</code></p> : null}
      </article>)}
      {result.records.length === 0 ? <p className="empty">No NDEF records were found on this tag.</p> : null}
    </div>
    <details><summary>Raw device result</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
  </section>;
}
