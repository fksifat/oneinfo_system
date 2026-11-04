import { useCallback, useEffect, useState } from "react";
import { NfcUtilitySchema } from "@oneinfo/contracts";
import { api, type Credentials } from "./api.js";
import { NfcInspector, type NfcReadResult } from "./NfcInspector.js";

interface Session {
  id: string; state: string; createdAt: string; expiresAt: string;
  utility?: { operation: string; recordType?: string; value?: string };
  result?: NfcReadResult;
}

export function NfcTools({ credentials, onMessage }: { credentials: Credentials; onMessage: (message: string) => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [recordType, setRecordType] = useState("URL");
  const [value, setValue] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [eraseConfirmed, setEraseConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [showDetails, setShowDetails] = useState(true);
  const pending = sessions.find((session) => ["PENDING", "READING"].includes(session.state));
  const selected = selectedId ? sessions.find((session) => session.id === selectedId) : sessions.find((session) => session.result);

  const refresh = useCallback(async () => {
    const result = await api<{ items: Session[] }>("/api/v1/local-nfc/utility-sessions", {}, credentials);
    setSessions(result.items);
    setError("");
  }, [credentials]);

  useEffect(() => {
    let disposed = false;
    let loading = false;
    const sync = async () => {
      if (loading) return;
      loading = true;
      try {
        const result = await api<{ items: Session[] }>("/api/v1/local-nfc/utility-sessions", {}, credentials);
        if (!disposed) { setSessions(result.items); setError(""); }
      } catch (error) { if (!disposed) setError(error instanceof Error ? error.message : "Could not update NFC activity"); }
      finally { loading = false; }
    };
    void sync();
    const interval = window.setInterval(() => void sync(), 1500);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [credentials]);

  const start = async (operation: "READ" | "WRITE" | "ERASE") => {
    const parsed = NfcUtilitySchema.safeParse(operation === "ERASE" ? { operation, overwriteConfirmed: eraseConfirmed } : operation === "WRITE" ? { operation, recordType, value, overwriteConfirmed: confirmed } : { operation });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check NFC content and replacement confirmation"); return; }
    setBusy(true);
    try {
      const session = await api<Session>("/api/v1/local-nfc/utility-sessions", { method: "POST", body: JSON.stringify(parsed.data) }, credentials);
      setSelectedId(session.id); setShowDetails(true); setConfirmed(false); setEraseConfirmed(false);
      await refresh();
      onMessage(operation === "ERASE" ? "Erase queued. Tap ONLY the tag you want to empty against the paired phone." : operation === "WRITE" ? "Write queued. Tap the target tag against the paired phone to replace its content." : "Read queued. Tap a tag against the paired phone.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not start NFC operation"); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await api(`/api/v1/local-nfc/utility-sessions/${pending.id}/cancel`, { method: "POST" }, credentials);
      await refresh(); onMessage("Stopped waiting for the tag. Any content already written remains on the tag.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not stop waiting"); }
    finally { setBusy(false); }
  };

  const exportResult = () => {
    if (!selected?.result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(selected.result, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `nfc-${selected.result.uid || selected.id}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <section className="nfc-tools">
    <div className="tools-heading"><div><p className="section-label">NFC TOOLBOX</p><h2>A small workspace for every tag.</h2><p>Read and inspect tags, or write a website link or plain text using your paired phone.</p></div><span className="pill">GENERAL PURPOSE</span></div>
    {error ? <p className="tool-error" role="alert">{error}</p> : null}
    {pending ? <div className="waiting-banner" role="status"><div><strong>{pending.utility?.operation === "ERASE" ? "Ready to erase · tap ONLY the tag to empty" : pending.utility?.operation === "WRITE" ? "Ready to write · tap the target tag" : "Ready to read · tap a tag"}</strong><small>Keep the Oneinfo companion open. Deadline {new Date(pending.expiresAt).toLocaleTimeString()}.</small></div><button className="secondary" disabled={busy} onClick={() => void cancel()}>Stop waiting</button></div> : null}
    <div className="tool-columns">
      <section className="panel tool-editor"><p className="section-label">01 / INSPECT</p><h2>What's on this tag?</h2><p>Read the UID, NDEF records, capacity, technologies and writable status.</p><button disabled={busy || Boolean(pending)} onClick={() => void start("READ")}>Read NFC tag</button><hr /><p className="section-label">02 / WRITE</p><h2>Put something useful on it.</h2>
        <form onSubmit={(event) => { event.preventDefault(); void start("WRITE"); }}>
          <label>Content type<select value={recordType} onChange={(event) => { setRecordType(event.target.value); setConfirmed(false); }}><option value="URL">Website link</option><option value="TEXT">Plain text</option></select></label>
          <label>{recordType === "URL" ? "HTTP or HTTPS link" : "Text content"}<textarea required rows={4} maxLength={2048} value={value} placeholder={recordType === "URL" ? "https://example.com" : "Write a note, product detail or short message…"} onChange={(event) => { setValue(event.target.value); setConfirmed(false); }} /></label>
          <small>{new TextEncoder().encode(value).length} content bytes · phone checks actual NDEF size against tag capacity</small>
          <label className="overwrite-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Replace all existing NDEF records on the tag I tap.</label>
          <button disabled={busy || Boolean(pending) || !confirmed || !value.trim()}>Write &amp; verify tag</button>
        </form><hr /><p className="section-label">03 / ERASE</p><h2>Empty this tag.</h2><p>Remove all NDEF links and text. The tag stays reusable and its UID stays unchanged. This does not securely wipe chip memory.</p><label className="overwrite-confirm"><input type="checkbox" checked={eraseConfirmed} onChange={(event) => setEraseConfirmed(event.target.checked)} />Erase all NDEF content on the tag I tap.</label><button className="danger-button" disabled={busy || Boolean(pending) || !eraseConfirmed} onClick={() => void start("ERASE")}>Erase NFC tag</button><p className="tool-footnote">These tools do not complete production jobs or approve QC. Changing a production card's physical content does not update its saved production records.</p>
      </section>
      <section className="panel tool-activity"><div className="activity-heading"><div><p className="section-label">LIVE ACTIVITY</p><h2>Phone &amp; desktop, together</h2></div><button className="text-button" onClick={() => void refresh().catch((error: Error) => setError(error.message))}>Refresh</button></div><p>Latest 20 operations from this station, kept for one hour while the API runs.</p>
        {sessions.length ? sessions.map((session) => <button className={`activity-row ${selected?.id === session.id ? "is-selected" : ""}`} key={session.id} onClick={() => { setSelectedId(session.id); setShowDetails(true); }}><span><strong>{session.utility?.operation === "ERASE" ? "Erase tag" : session.utility?.operation === "WRITE" ? `Write ${session.utility.recordType?.toLowerCase()}` : "Read tag"}</strong><small>{new Date(session.createdAt).toLocaleTimeString()} · {session.result?.uid ?? "Awaiting tag"}</small></span><span className={`pill ${session.state === "COMPLETED" ? "success" : session.state === "FAILED" ? "failure" : ""}`}>{session.state}</span></button>) : <div className="tool-empty"><span>↗</span><h3>Your next tap starts here.</h3><p>Start a read, write or erase from either device. Its result will appear here automatically.</p></div>}
      </section>
    </div>
    {selected?.result && showDetails ? <><div className="result-actions"><button className="secondary" onClick={() => void navigator.clipboard.writeText(JSON.stringify(selected.result, null, 2)).then(() => onMessage("Tag result copied.")).catch(() => onMessage("Clipboard unavailable. Use Export JSON."))}>Copy result</button><button className="secondary" onClick={exportResult}>Export JSON</button></div>{selected.result.errorCode ? <p className="tool-error" role="alert">{selected.result.errorCode}</p> : null}<NfcInspector result={selected.result} onClose={() => setShowDetails(false)} /></> : null}
  </section>;
}
