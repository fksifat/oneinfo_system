import { useEffect, useState } from "react";
import { api, sha256, type Credentials } from "./api.js";

type Backup = { id: string; fileName: string; createdAt: string; database: string; source: string; bytes: number; sha256: string };
export function DatabaseBackups({ credentials, visible, onMessage }: { credentials: Credentials; visible: boolean; onMessage: (message: string) => void }) {
  const [items, setItems] = useState<Backup[]>([]);
  const [directory, setDirectory] = useState(".oneinfo/backups/database");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let current = true;
    setLoading(true); setError("");
    void api<{ items: Backup[]; directory: string }>("/api/v1/production/backups", {}, credentials)
      .then(result => { if (current) { setItems(result.items); setDirectory(result.directory); } })
      .catch(e => { if (current) setError(e instanceof Error ? e.message : "Could not load local backups"); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [visible, credentials, reload]);
  async function download(backup: Backup) {
    const file = await api<Blob>(`/api/v1/production/backups/${backup.id}/download`, {}, credentials);
    if (file.size !== backup.bytes || await sha256(file) !== backup.sha256) throw new Error("Downloaded file failed its integrity check. The saved local backup is retained; download it again.");
    const url = URL.createObjectURL(file), link = document.createElement("a");
    link.href = url; link.download = backup.fileName; document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    onMessage("Verified backup is saved on this PC. Browser download started; check your Downloads folder.");
  }
  async function run(existing?: Backup) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const backup = existing ?? await api<Backup>("/api/v1/production/backups", { method: "POST" }, credentials);
      if (!existing) { setItems(current => [backup, ...current.filter(item => item.id !== backup.id)].slice(0, 20)); onMessage("Database backup saved in .oneinfo/backups/database. Preparing download…"); }
      await download(backup);
    } catch (e) { setError(e instanceof Error ? e.message : "Backup failed. Check the saved backup list before retrying."); }
    finally { setBusy(false); }
  }
  return <section hidden={!visible} className="panel database-backups" aria-label="Database backups">
    <div className="desk-heading"><div><p className="section-label">LOCAL DATABASE BACKUPS</p><h2>Protect your production data</h2></div><button disabled={busy || loading} onClick={() => void run()}>{busy ? "Preparing backup…" : "Back up database & download"}</button></div>
    <p>Creates a consistent PostgreSQL snapshot of the database this workstation uses, including QR images/links, batches, orders, clients, activation records and migration history. Production data stays unchanged.</p>
    <p>Take a backup after generating your final batch, and again after printing, NFC encoding or client activation. New changes after the snapshot need another backup.</p>
    <p>Completed files stay in <code>{directory}</code> on this PC even if the browser download fails. No automatic deletion. Keep a second copy on another drive.</p>
    <p className="backup-notice">Private customer/account data is included. Media files, environment secrets and phone pairing files are separate—keep those backed up too.</p>
    {error && <p className="tool-error" role="alert">{error}</p>}
    <div className="desk-heading"><h3>Latest 20 saved backups</h3><button className="secondary" disabled={busy || loading} onClick={() => setReload(value => value + 1)}>Refresh backups</button></div>
    {loading && <p role="status">Loading saved backups…</p>}
    {!loading && !error && !items.length && <p>No database backups saved by this console yet.</p>}
    <div className="backup-list">{items.map(backup => <article className="backup-record" key={backup.id}>
      <div><strong>{new Date(backup.createdAt).toLocaleString()}</strong><p><code>{backup.database}</code> · {backup.source} · {(backup.bytes / 1024 / 1024).toFixed(2)} MB</p><small>{backup.fileName}</small><details><summary>Verify file checksum</summary><code>SHA-256: {backup.sha256}</code></details></div>
      <button className="secondary" disabled={busy} onClick={() => void run(backup)}>Download backup</button>
    </article>)}</div>
    <details><summary>Restoring a backup</summary><p>This console does not overwrite or restore a database. Use PostgreSQL pg_restore with a new, separate database and verify it before switching the app. See the README for recovery steps. Keep your original environment secrets, especially JWT_SECRET, so existing encrypted activation codes remain usable.</p></details>
  </section>;
}
