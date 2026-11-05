import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Credentials } from "./api.js";
import { NfcTools } from "./NfcTools.js";
import { ProductionDesk } from "./ProductionDesk.js";

type JobType = "QR_GENERATION" | "NFC_ENCODING" | "QUALITY_CONTROL";

interface Card {
  id: string;
  batchId: string;
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

const emptyCredentials: Credentials = { accessToken: "", stationKey: "" };
interface PhonePairing { pairingCode: string; expiresAt: string; lanQr?: string | null; lan?: { urls: string[]; fingerprint: string } | null }

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
  const [jobs, setJobs] = useState<QueueItem[]>([]);
  const [message, setMessage] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [pairing, setPairing] = useState<PhonePairing | null>(null);
  const [activeTab, setActiveTab] = useState(() => ["tools", "connection"].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "production");
  const [devices, setDevices] = useState<{ id: string; name: string; online: boolean; lastSeenAt: string }[]>([]);
  const [connectionError, setConnectionError] = useState("");

  const configured = Boolean(credentials.accessToken && credentials.stationKey);
  const pairingExpired = pairing ? Date.parse(pairing.expiresAt) <= Date.now() : false;
  useEffect(() => {
    if (!pairing) return;
    const timer = window.setTimeout(() => setPairing(value => value ? { ...value } : value), Math.max(0, Date.parse(pairing.expiresAt) - Date.now()) + 50);
    return () => window.clearTimeout(timer);
  }, [pairing?.expiresAt]);
  useEffect(() => {
    const changed = () => { const tab = window.location.hash.slice(1); setActiveTab(["tools", "connection"].includes(tab) ? tab : "production"); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);

  useEffect(() => {
    const revoked = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== credentials.stationKey.split(".")[0]) return;
      localStorage.removeItem("oneinfo.credentials");
      setCredentials(emptyCredentials);
      setMessage("This station was removed or revoked in Admin. Register the workstation again.");
    };
    window.addEventListener("oneinfo-station-revoked", revoked);
    return () => window.removeEventListener("oneinfo-station-revoked", revoked);
  }, [credentials.stationKey]);

  const saveCredentials = (next: Credentials) => {
    localStorage.setItem("oneinfo.credentials", JSON.stringify(next));
    setCredentials(next);
  };

  async function stationApi<T>(path: string, init: RequestInit = {}): Promise<T> {
    return api<T>(path, init, credentials);
  }

  const bootstrap = async () => {
    setBusy(true);
    setSetupError("");
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
      const text = (error as { status?: number }).status === 409
        ? "This station code is already registered. Open the console in the browser where you registered it, or choose a new code for a new workstation."
        : error instanceof Error ? error.message : "Setup failed";
      setSetupError(text);
      setMessage(text);
    } finally {
      setBusy(false);
    }
  };

  const refreshJobs = useCallback(async (quiet = false) => {
    if (!configured) return;
    try {
      const response = await stationApi<{ items: QueueItem[] }>("/api/v1/production/jobs");
      setJobs(response.items);
      if (!quiet) setMessage(`${response.items.length} available or assigned jobs`);
    } catch (error) {
      if (!quiet) setMessage(error instanceof Error ? error.message : "Could not load jobs");
    }
  }, [configured, credentials]);

  useEffect(() => {
    void refreshJobs();
    const interval = window.setInterval(() => void refreshJobs(true), 5000);
    return () => window.clearInterval(interval);
  }, [refreshJobs]);

  const createDesktopPairing = async () => {
    setBusy(true);
    try {
      const result = await stationApi<PhonePairing>(
        "/api/v1/local-nfc/pairings",
        { method: "POST" },
      );
      setPairing(result);
      setMessage(result.lanQr ? "Scan the connection QR in the phone app. Use the same Wi-Fi/LAN as this PC." : "Secure LAN connection is not ready. Restart Oneinfo and check this PC's network connection.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create NFC pairing code");
    } finally {
      setBusy(false);
    }
  };

  const revokeDevice = async (device: { id: string; name: string }) => {
    if (!window.confirm(`Remove ${device.name}? This phone will need to scan a new connection QR to pair again.`)) return;
    setBusy(true);
    try { await stationApi(`/api/v1/local-nfc/devices/${device.id}/revoke`, { method: "POST" }); setDevices(items => items.filter(item => item.id !== device.id)); setMessage("Phone access removed."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not remove phone."); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (!configured) return;
    let disposed = false;
    let pending = false;
    const sync = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await stationApi<{ items: typeof devices }>("/api/v1/local-nfc/devices");
        if (!disposed) { setDevices(result.items); setConnectionError(""); }
      } catch (error) { if (!disposed) setConnectionError(error instanceof Error ? error.message : "API unavailable"); }
      finally { pending = false; }
    };
    void sync();
    const interval = window.setInterval(() => void sync(), 5000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [configured, credentials]);

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
        <div className="header-links"><a href={import.meta.env.VITE_ADMIN_URL ?? "http://127.0.0.1:5174"} target="_blank" rel="noreferrer">Admin panel ↗</a><span className={configured ? "status online" : "status"}>{configured ? "Station ready" : "Setup required"}</span></div>
      </header>

      {configured ? <nav className="workspace-nav" aria-label="Workspace">{([["production", "01", "Production"], ["tools", "02", "NFC tools"], ["connection", "03", "Connection"]] as const).map(([id, number, label]) => <button key={id} aria-pressed={activeTab === id} onClick={() => { window.location.hash = id; }}><span>{number}</span>{label}</button>)}<span className="connection-indicator">{connectionError ? "API unavailable" : devices.some((device) => device.online) ? "NFC device connected" : "No NFC device online"}</span></nav> : null}
      <main>
        {!configured ? (
          <section className="panel setup-panel">
            <p className="section-label">First-run setup</p>
            <h2>Register this workstation</h2>
            <p>Choose an unused station code for this production PC. The station credential is saved in this browser.</p>
            <form onSubmit={event => { event.preventDefault(); void bootstrap(); }}><label>
              Station code
              <input required minLength={3} maxLength={64} pattern="[A-Za-z0-9_-]+" title="Use letters, numbers, dashes or underscores" value={stationCode} onChange={(event) => setStationCode(event.target.value)} />
            </label>
            <button disabled={busy} type="submit">{busy ? "Registering…" : "Register workstation"}</button></form>
            {setupError && <p className="tool-error setup-error" role="alert">{setupError}</p>}
          </section>
        ) : (
          <>
            <ProductionDesk visible={activeTab === "production"} credentials={credentials} busy={busy} onBusy={setBusy} onMessage={setMessage} onChanged={refreshJobs} />

            <div hidden={activeTab !== "tools"}><NfcTools credentials={credentials} connected={devices.some(device => device.online)} onMessage={setMessage} /></div>
            <section hidden={activeTab !== "connection"} className="panel desktop-nfc-panel lan-connection-panel">
              <div><p className="section-label">SECURE WI-FI / LAN</p><h2>Connect your phone to this PC</h2><p>Keep the phone and PC on the same network. In the phone app, open Connect → Scan workstation connection QR. Pair once; your phone stays paired after Oneinfo restarts.</p>
                <div className="nfc-bridge-actions"><button className="secondary" disabled={busy} onClick={() => void createDesktopPairing()}>{pairing ? "New connection QR" : "Create connection QR"}</button></div>
                {pairing?.lan?.urls.map(url => <p className="lan-address" key={url}><code>{url}</code></p>)}
                {pairing && !pairing.lanQr ? <p role="alert">No LAN address is available. Start Oneinfo, connect this PC to Wi-Fi/Ethernet, then create a new QR.</p> : null}
                <p className="lan-help">If connection fails, check that the network allows phone-to-PC traffic and the PC firewall allows the HTTPS port shown above. Keep Oneinfo running on this PC.</p>
              </div>
              {pairing ? <div className="lan-pairing" role="status">{!pairingExpired && pairing.lanQr ? <img src={pairing.lanQr} alt="Scan this QR with the Oneinfo phone app to pair securely" width="280" height="280" /> : null}<strong>{pairingExpired ? "QR expired · create a new one" : "Scan in the Oneinfo app"}</strong><small>{pairingExpired ? "Already paired phones remain connected." : `New pairing available until ${new Date(pairing.expiresAt).toLocaleTimeString()}`}</small></div> : null}
            </section>

            <section hidden={activeTab !== "connection"} className="panel connection-details"><h2>Paired phones</h2>{connectionError ? <p role="alert">{connectionError}</p> : null}{devices.length ? devices.map((device) => <div className="device-row" key={device.id}><span><strong>{device.name}</strong><small>Last seen {new Date(device.lastSeenAt).toLocaleTimeString()}</small></span><span className={device.online ? "pill success" : "pill"}>{device.online ? "ONLINE" : "OFFLINE"}</span><button className="secondary" disabled={busy} onClick={() => void revokeDevice(device)}>Remove phone</button></div>) : <p>No paired phones yet. Create a connection QR above and scan it in the phone's Connect tab.</p>}<p>Paired devices and pending operations are saved on this PC. Keep the workstation's Oneinfo data folder when updating the app. If discovery is blocked after the PC's network address changes, scan a fresh connection QR to update the address.</p>
              <details><summary>USB development fallback</summary><p>Use USB debugging and <code>adb reverse tcp:3001 tcp:3001</code>, then open USB development connection in the phone app.</p>{pairing ? <div className="pairing-code"><small>DEVELOPMENT PAIRING CODE</small><strong>{pairingExpired ? "Expired" : pairing.pairingCode}</strong></div> : <p>Create a connection QR above to also generate a development code.</p>}</details>
            </section>

            <section hidden={activeTab !== "production"} className="queue-grid">
              {(Object.entries(groupedJobs) as [JobType, QueueItem[]][]).map(([type, items]) => (
                <article className="panel queue" key={type}>
                  <div className="queue-heading"><h2>{type.replaceAll("_", " ")}</h2><strong>{items.length}</strong></div>
                  {items.length === 0 ? <p className="empty">No pending work</p> : items.slice(0, 8).map((item) => (
                    <div className="job" key={item.job.id}>
                      <span>{item.card.publicSlug}</span><small>{item.job.status}</small>
                    </div>
                  ))}
                </article>
              ))}
            </section>


          </>
        )}
      </main>

      <footer><span role="status" aria-live="polite">{busy ? `Working… ${message}` : message}</span><button className="text-button" disabled={!configured || busy} onClick={() => void refreshJobs()}>Refresh queue</button></footer>
    </div>
  );
}
