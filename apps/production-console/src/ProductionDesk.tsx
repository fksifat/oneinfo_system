import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, type Credentials } from "./api.js";

interface Job { id: string; type: string; status: string }
interface ProductionCard {
  id: string; publicSlug: string; canonicalUrl: string; qrStatus: string; nfcStatus: string; qcStatus: string;
  imageData: string | null; printChecked: boolean; verification: { camera: boolean; nfc: boolean; cameraResult?: string; nfcResult?: string }; jobs: Job[];
}
interface Batch { id: string; batchCode: string; plannedQuantity: number; printConfirmedAt: string | null; cards: ProductionCard[] }
type ExpectedCard = { cardId: string; slug: string; expiresAt: number };
type DeleteTarget = { batchId: string; cardId?: string; label: string; quantity: number };
interface Props { visible: boolean; credentials: Credentials; busy: boolean; onBusy: (value: boolean) => void; onMessage: (value: string) => void; onChanged: () => Promise<void>; onPhoneScan: () => void }

export function ProductionDesk({ visible, credentials, busy, onBusy, onMessage, onChanged, onPhoneScan }: Props) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState(() => new URLSearchParams(window.location.search).get("batch") ?? localStorage.getItem("oneinfo.production.batch") ?? "");
  const currentBatchId = useRef(batchId);
  currentBatchId.current = batchId;
  const [batch, setBatch] = useState<Batch | null>(null);
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(location.search).get("card") ?? "");
  const deepLinked = useRef(Boolean(selectedId));
  const [expected, setExpected] = useState<ExpectedCard | null>(null);
  const [checking, setChecking] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const deleteDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!deleteTarget) return;
    setDeleteConfirmation(""); setDeleteError("");
    const dialog = deleteDialog.current, opener = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); if (opener?.isConnected) opener.focus(); };
  }, [deleteTarget]);
  const [checkError, setCheckError] = useState("");
  const [batchCode, setBatchCode] = useState(`BATCH-${new Date().toLocaleDateString("en-CA").replaceAll("-", "")}-${Date.now().toString(36).slice(-4)}`);
  const [quantity, setQuantity] = useState(10);
  const [links, setLinks] = useState("");
  const [printCards, setPrintCards] = useState<ProductionCard[]>([]);
  const [labelWidth, setLabelWidth] = useState(55);
  const [labelHeight, setLabelHeight] = useState(40);
  const [columns, setColumns] = useState(3);
  const [gap, setGap] = useState(3);
  const [margin, setMargin] = useState(10);
  const [syncError, setSyncError] = useState("");
  const [lastSynced, setLastSynced] = useState("");
  const [search, setSearch] = useState("");
  const [cardFilter, setCardFilter] = useState("all");
  const [printingComplete, setPrintingComplete] = useState(false);
  const lastPhoneScan = useRef("");
  useEffect(() => {
    let disposed = false;
    let pending = false;
    const sync = async () => {
      if (pending || busy) return;
      pending = true;
      try {
        const { scan, expected } = await api<{ scan: { id: string; batchId: string; cardId: string; publicSlug: string; scannedAt: string } | null; expected?: ExpectedCard | null }>("/api/v1/local-nfc/latest-qr-scan", {}, credentials);
        if (disposed) return;
        setExpected(expected ?? null);
        if (!scan || scan.id === lastPhoneScan.current) return;
        if (deepLinked.current) {
          deepLinked.current = false;
          if (Date.parse(scan.scannedAt) < performance.timeOrigin) { lastPhoneScan.current = scan.id; return; }
        }
        if (expected && expected.cardId !== scan.cardId) return;
        const loaded = await api<Batch>(`/api/v1/production/batches/${scan.batchId}`, {}, credentials);
        if (disposed) return;
        currentBatchId.current = scan.batchId;
        setBatches(items => items.some(item => item.id === loaded.id) ? items : [loaded, ...items]);
        setBatchId(scan.batchId); setBatch(loaded); setSelectedId(scan.cardId);
        setSearch(""); setCardFilter("all");
        lastPhoneScan.current = scan.id;
        onPhoneScan();
        onMessage(`Phone scanned ${scan.publicSlug} · ${loaded.batchCode}. Card selected automatically.`);
      } catch (error) { if (!disposed) setSyncError(error instanceof Error ? error.message : "Could not sync phone scan"); }
      finally { pending = false; }
    };
    void sync();
    const interval = window.setInterval(() => void sync(), 2000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [credentials, busy, onPhoneScan, onMessage]);
  useEffect(() => setPrintingComplete(false), [batchId]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (batchId) { url.searchParams.set("batch", batchId); localStorage.setItem("oneinfo.production.batch", batchId); }
    else { url.searchParams.delete("batch"); localStorage.removeItem("oneinfo.production.batch"); }
    window.history.replaceState(null, "", url);
  }, [batchId]);
  const visibleCards = batch?.cards.filter((card) => `${card.publicSlug} ${card.canonicalUrl}`.toLowerCase().includes(search.toLowerCase()) &&
    (cardFilter === "all" || (cardFilter === "pending" && card.nfcStatus !== "WRITTEN") || (cardFilter === "qc" && card.nfcStatus === "WRITTEN" && card.qcStatus !== "PASSED") || (cardFilter === "passed" && card.qcStatus === "PASSED"))) ?? [];
  const selected = visibleCards.find((card) => card.id === selectedId) ?? visibleCards[0];
  async function setCardCheck(cardId: string | null) {
    if (checking) return;
    setChecking(true); setCheckError("");
    try {
      const result = await api<{ expected: ExpectedCard | null }>("/api/v1/local-nfc/expected-card", {
        method: "POST", body: JSON.stringify({ cardId }),
      }, credentials);
      setExpected(result.expected);
    } catch (e) { setCheckError(e instanceof Error ? e.message : "Could not change the card check."); }
    finally { setChecking(false); }
  }
  const rowsPerPage = Math.max(1, Math.floor((297 - margin * 2 + gap) / (labelHeight + gap)));
  const perPage = Math.max(1, Math.min(1000, rowsPerPage * Math.max(1, columns)));
  const layoutValid = labelWidth >= 25 && labelHeight >= 30 && Number.isInteger(columns) && columns >= 1 && columns <= 6 && gap >= 0 && margin >= 0 &&
    columns * labelWidth + (columns - 1) * gap + 2 * margin <= 210 && labelHeight + margin * 2 <= 297;

  const clearMissingBatch = useCallback(() => {
    currentBatchId.current = "";
    setBatch(null); setBatchId(""); setSelectedId(""); setPrintCards([]);
  }, []);

  const refresh = useCallback(async () => {
    const list = await api<{ items: Batch[] }>("/api/v1/production/batches", {}, credentials);
    setBatches(list.items);
    if (batchId) {
      try { const loaded = await api<Batch>(`/api/v1/production/batches/${batchId}`, {}, credentials); if (currentBatchId.current === batchId) setBatch(loaded); }
      catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
        if (currentBatchId.current === batchId) clearMissingBatch();
      }
    }
  }, [batchId, credentials, clearMissingBatch]);

  useEffect(() => { void refresh().catch((error: Error) => onMessage(error.message)); }, [refresh]);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    const sync = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await api<{ items: Batch[] }>("/api/v1/production/batches", {}, credentials);
        if (!disposed) setBatches(result.items);
      } catch (error) { if (!disposed) setSyncError(error instanceof Error ? error.message : "Could not refresh batches"); }
      finally { pending = false; }
    };
    const interval = window.setInterval(() => void sync(), 5000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [credentials]);

  useEffect(() => {
    if (!batchId) return;
    let disposed = false;
    let pending = false;
    const sync = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await api<{ printConfirmedAt: string | null; items: Pick<ProductionCard, "id" | "qrStatus" | "nfcStatus" | "qcStatus" | "printChecked" | "verification">[] }>(
          `/api/v1/production/batches/${batchId}/verification-status`, {}, credentials);
        if (disposed) return;
        setBatch((current) => current?.id === batchId ? { ...current, plannedQuantity: result.items.length, printConfirmedAt: result.printConfirmedAt, cards: current.cards.filter(card => result.items.some(item => item.id === card.id)).map((card) => ({ ...card, ...result.items.find((item) => item.id === card.id) })) } : current);
        setSyncError("");
        setLastSynced(new Date().toLocaleTimeString());
      } catch (error) {
        if (disposed) return;
        if ((error as { status?: number }).status === 404) {
          clearMissingBatch();
        } else setSyncError(error instanceof Error ? error.message : "Dashboard update failed");
      }
      finally { pending = false; }
    };
    void sync();
    const interval = window.setInterval(() => void sync(), 2000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [batchId, credentials, clearMissingBatch]);

  const run = async (action: () => Promise<string>) => {
    onBusy(true);
    try {
      const result = await action();
      await refresh();
      await onChanged();
      onMessage(result);
    } catch (error) {
      await refresh().catch(() => undefined);
      onMessage(error instanceof Error ? error.message : "Production operation failed");
    }
    finally { onBusy(false); }
  };

  const createBatch = () => run(async () => {
    const urls = links.split(/\r?\n/).map((link) => link.trim()).filter(Boolean);
    const created = await api<Batch>("/api/v1/production/batches", { method: "POST", body: JSON.stringify({
      batchCode, productVariantId: "ONEINFO-NFC-CARD", quantity: urls.length || quantity, ...(urls.length ? { links: urls } : {}),
    }) }, credentials);
    setBatchId(created.id);
    setBatch(null);
    setSelectedId("");
    return `Created ${created.batchCode}. Generate its QR images next.`;
  });

  const generate = (card?: ProductionCard) => run(async () => {
    if (!batch) throw new Error("Select a batch first");
    onMessage(`Generating ${card ? "one QR image" : `${batch.cards.length} QR images`}…`);
    const result = await api<{ generated: number }>(`/api/v1/production/batches/${batch.id}/generate-qr`, {
      method: "POST", body: JSON.stringify(card ? { cardId: card.id } : {}),
    }, credentials);
    return `${result.generated} QR images generated and saved. Previously generated images are retained.`;
  });

  const print = async (cards: ProductionCard[]) => {
    if (!layoutValid || !cards.length || cards.some((card) => !card.imageData)) {
      onMessage("Generate all selected QR images and choose a layout that fits A4 before printing.");
      return;
    }
    setPrintCards(cards);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>(".production-print img")).map((image) => image.decode()));
    window.print();
  };

  const confirmPrint = () => run(async () => {
    if (!batch || !printingComplete) throw new Error("Confirm that every card in this batch has been printed first.");
    const result = await api<{ assigned: number }>(`/api/v1/production/batches/${batch.id}/confirm-print`, {
      method: "POST", body: JSON.stringify({ confirmed: true }),
    }, credentials);
    return `Printed stock confirmed and visible in Admin. ${result.assigned} QR codes assigned to waiting orders. NFC encoding and QC are still required.`;
  });

  async function deleteStock(event: FormEvent) {
    event.preventDefault();
    if (!deleteTarget || busy || deleteConfirmation !== deleteTarget.label) return;
    const target = deleteTarget;
    onBusy(true); setDeleteError("");
    let deleted = false;
    try {
      const result = await api<{ deleted: number; skipped: number; cardIds: string[]; batchDeleted: boolean }>(`/api/v1/production/batches/${target.batchId}${target.cardId ? `/cards/${target.cardId}` : ""}`, {
        method: "DELETE", body: JSON.stringify({ confirmation: deleteConfirmation }),
      }, credentials);
      deleted = true;
      const removedIds = result.cardIds ?? (target.cardId ? [target.cardId] : []);
      setDeleteTarget(null); setPrintCards([]); setPrintingComplete(false);
      if (currentBatchId.current === target.batchId) {
        if (result.batchDeleted) clearMissingBatch();
        else {
          setBatch(current => {
            if (!current) return current;
            const cards = current.cards.filter(card => !removedIds.includes(card.id));
            return { ...current, plannedQuantity: cards.length, cards };
          });
          setSelectedId(current => removedIds.includes(current) ? "" : current);
        }
      }
      await refresh(); await onChanged();
      onMessage(`Deleted ${result.deleted} QR/card${result.deleted === 1 ? "" : "s"}${result.batchDeleted ? " and the empty batch" : ""}.${result.skipped ? ` Kept ${result.skipped} protected card${result.skipped === 1 ? "" : "s"}.` : ""} Deleted cards were removed from Admin inventory and their Oneinfo links no longer work.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not delete production stock.";
      if (deleted) onMessage(`Stock deleted. Refresh the dashboard: ${message}`);
      else setDeleteError(message);
    } finally { onBusy(false); }
  }

  return <>
    <section hidden={!visible} className="panel production-desk">
      <div className="desk-heading"><div><p className="section-label">PRODUCTION WORKSPACE</p><h2>Generate → print → load NFC → final QC</h2></div><span className="desk-badge">PRODUCTION DESK</span></div>
      <p>Create a batch and print its QR codes here. On the phone, scan each printed QR to detect its batch and card, choose Load to NFC, then scan QR and NFC again for final QC approval.</p>
      <form className="batch-create" onSubmit={(event) => { event.preventDefault(); void createBatch(); }}>
        <label>Batch code<input required value={batchCode} onChange={(event) => setBatchCode(event.target.value)} /></label>
        <label>Number of cards<input type="number" min="1" max="1000" required value={quantity} disabled={Boolean(links.trim())} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
        <button disabled={busy}>Create batch</button>
        <details><summary>Use your own links</summary><label>One unique HTTP(S) URL per card<textarea rows={4} value={links} onChange={(event) => setLinks(event.target.value)} placeholder="https://your-domain.com/card-1&#10;https://your-domain.com/card-2" /></label><small>Leave empty to generate unique card URLs from the configured card domain. Pasted links determine the quantity.</small></details>
      </form>
      <div className="batch-toolbar"><label>Production batch<select value={batchId} disabled={busy} onChange={(event) => { if (event.target.value === batchId) return; setBatchId(event.target.value); setBatch(null); setSelectedId(""); localStorage.setItem("oneinfo.production.batch", event.target.value); }}><option value="">Choose a batch</option>{batches.map((item) => <option key={item.id} value={item.id}>{item.batchCode} · {item.plannedQuantity} cards</option>)}</select></label><button disabled={busy || !batch} onClick={() => void generate()}>Generate all QR codes</button><button className="secondary" disabled={busy} onClick={() => void refresh().catch((error: Error) => onMessage(error.message))}>Refresh batch</button><button className="danger-button" disabled={busy || !batch} onClick={() => batch && setDeleteTarget({ batchId: batch.id, label: batch.batchCode, quantity: batch.cards.length })}>Delete batch</button></div>
      {batch ? <>
        {batch.cards.some((card) => { const host = new URL(card.canonicalUrl).hostname; return host.endsWith(".example") || ["localhost", "127.0.0.1", "[::1]"].includes(host); }) ? <p className="domain-warning">This batch uses local or placeholder links. Local activation pages need the Admin/customer app running on port 5174. Configure your hosted card domain before printing cards for client delivery; saved QR/NFC links do not change afterward.</p> : null}
        <div className="batch-metrics">{[["Cards", batch.cards.length], ["Print checked", batch.cards.filter((card) => card.printChecked).length], ["NFC written", batch.cards.filter((card) => card.nfcStatus === "WRITTEN").length], ["QC approved", batch.cards.filter((card) => card.qcStatus === "PASSED").length]].map(([label, count]) => <div key={label}><span>{label}</span><strong>{count}<small> / {batch.cards.length}</small></strong></div>)}</div>
        <div className="card-search"><label>Find a card<input type="search" value={search} placeholder="Card ID or link…" onChange={(event) => setSearch(event.target.value)} /></label><label>Stage<select value={cardFilter} onChange={(event) => setCardFilter(event.target.value)}><option value="all">All cards</option><option value="pending">Awaiting NFC</option><option value="qc">Awaiting final QC</option><option value="passed">QC approved</option></select></label><small>{visibleCards.length} cards shown</small></div>
        <div className="production-layout"><div className="production-card-list" role="group" aria-label="Batch cards">{!visibleCards.length ? <p className="empty">No cards match this search.</p> : null}{visibleCards.map((card) => <button aria-pressed={selected?.id === card.id} className={selected?.id === card.id ? "selected" : ""} key={card.id} disabled={busy} onClick={() => setSelectedId(card.id)}><strong>{String(batch.cards.indexOf(card) + 1).padStart(3, "0")} · {card.publicSlug}</strong><small>QR {card.imageData ? "ready" : "pending"} · NFC {card.nfcStatus === "WRITTEN" ? "written" : "pending"} · QC {card.qcStatus.toLowerCase()}</small><span>{card.verification.camera ? "Camera ✓" : "Camera —"} · {card.verification.nfc ? "NFC ✓" : "NFC —"}</span></button>)}</div>
          {selected ? <article className="selected-production-card"><div className="selected-qr">{selected.imageData ? <img src={selected.imageData} alt={`QR for ${selected.publicSlug}`} /> : <span>Generate this QR first</span>}</div><p className="section-label">SELECTED CARD · {selected.publicSlug}</p><p className="canonical-link">{selected.canonicalUrl}</p><small>This is the NFC write link. New Oneinfo QR images use source=qr; phone QC verifies each link separately.</small>
            <p role="status">Printed QR check: {selected.printChecked ? "CHECKED ON PHONE" : "AWAITING PHONE SCAN"}</p>
            <div className="verification-controls"><strong>Wrong-card check</strong>
              <p>{expected ? `Phone scans must match ${expected.slug}. The check expires after 10 minutes.` : "Lock this card before scanning on the paired phone. A different QR will be rejected before NFC writing or QC."}</p>
              <button type="button" className="secondary" disabled={busy || checking} onClick={() => void setCardCheck(expected?.cardId === selected.id ? null : selected.id)}>
                {checking ? "Saving…" : expected?.cardId === selected.id ? "Release card check" : "Check against this card"}
              </button>
              {checkError && <p role="alert">{checkError}</p>}
            </div>
            <div className="actions"><button disabled={busy || Boolean(selected.imageData)} onClick={() => void generate(selected)}>Generate QR</button>{selected.imageData ? <a className="download-qr" href={selected.imageData} download={`${selected.publicSlug}.png`}>Download PNG</a> : null}<button className="danger-button" disabled={busy} onClick={() => setDeleteTarget({ batchId: batch.id, cardId: selected.id, label: selected.publicSlug, quantity: 1 })}>Delete QR & link</button></div>
            <div className="verification-controls"><p className="section-label">PHONE PRODUCTION · LIVE UPDATES</p><small>Phone: Scan printed QR → Load to NFC → scan QR again → tap NFC → Approve QC. Only the final scans after writing count toward QC.</small><div><span className={selected.nfcStatus === "WRITTEN" ? "check-pass" : ""}>{selected.nfcStatus === "WRITTEN" ? "✓" : "1"}</span><strong role="status">NFC encoding: {selected.nfcStatus}</strong></div><div><span className={selected.verification.camera ? "check-pass" : ""}>{selected.verification.camera ? "✓" : "2"}</span><strong role="status">Final QR check: {selected.verification.cameraResult ?? "PENDING"}</strong></div><div><span className={selected.verification.nfc ? "check-pass" : ""}>{selected.verification.nfc ? "✓" : "3"}</span><strong role="status">Final NFC check: {selected.verification.nfcResult ?? "PENDING"}</strong></div><strong role="status">QC approval: {selected.qcStatus}</strong><small>{syncError ? `Live updates paused: ${syncError}` : `Updated ${lastSynced || "just now"} · refreshes every 2 seconds`}</small></div>
          </article> : null}
        </div>
        <div className="print-settings"><div><p className="section-label">PRINT PRODUCTION</p><h2>A4 label sheet</h2></div><label>Width (mm)<input type="number" min="25" max="180" value={labelWidth} onChange={(event) => setLabelWidth(Number(event.target.value))} /></label><label>Height (mm)<input type="number" min="30" max="277" value={labelHeight} onChange={(event) => setLabelHeight(Number(event.target.value))} /></label><label>Columns<input type="number" min="1" max="6" value={columns} onChange={(event) => setColumns(Number(event.target.value))} /></label><label>Gap (mm)<input type="number" min="0" max="20" value={gap} onChange={(event) => setGap(Number(event.target.value))} /></label><label>Margin (mm)<input type="number" min="0" max="30" value={margin} onChange={(event) => setMargin(Number(event.target.value))} /></label><button className="secondary" disabled={busy || !selected?.imageData || !layoutValid} onClick={() => selected && void print([selected])}>Print selected QR</button><button disabled={busy || !layoutValid || batch.cards.some((card) => !card.imageData)} onClick={() => void print(batch.cards)}>Print full batch</button><p>{layoutValid ? `${columns} columns · ${rowsPerPage} rows · ${perPage} labels per A4 page. Use actual size / 100% scale; test one sheet first.` : "The selected dimensions do not fit an A4 sheet."}</p></div>
      </> : <p className="empty">Create a batch or choose an existing one to start production.</p>}
    </section>
    {visible && batch && <section className="panel print-confirmation"><p className="section-label">PRINT CONFIRMATION · ADMIN STOCK</p>
      <h2>{batch.printConfirmedAt ? "Printed stock confirmed" : "Confirm after printing the entire batch"}</h2>
      <p>Confirmed QR codes appear in Admin and are assigned to waiting orders automatically. NFC encoding and final QC remain separate steps.</p>
      {batch.printConfirmedAt ? <p role="status">Confirmed {new Date(batch.printConfirmedAt).toLocaleString()}</p> : <>
        <label><input type="checkbox" checked={printingComplete} onChange={event => setPrintingComplete(event.target.checked)} /> Every card in {batch.batchCode} has been printed.</label>
        <button disabled={busy || !printingComplete || batch.cards.some(card => !card.imageData)} onClick={() => void confirmPrint()}>Confirm printed batch</button>
      </>}
    </section>}
    {deleteTarget && <dialog ref={deleteDialog} className="stock-delete-dialog" aria-labelledby="stock-delete-title" aria-describedby="stock-delete-description" onCancel={event => { event.preventDefault(); if (!busy) setDeleteTarget(null); }}>
      <form onSubmit={event => void deleteStock(event)}>
        <h2 id="stock-delete-title">{deleteTarget.cardId ? "Delete QR & link" : "Delete unused cards from batch"}</h2>
        <p id="stock-delete-description">{deleteTarget.cardId ? "Remove this QR/card" : `Remove all eligible unused QR/cards from this ${deleteTarget.quantity}-card batch`} from Oneinfo and Admin inventory. Deleted Oneinfo card links will stop working. This cannot be undone in the console.</p>
        <p>{deleteTarget.cardId ? "Only this unused card will be deleted. Assigned/reserved cards and cards with claimed production jobs cannot be deleted." : "Assigned/reserved cards and cards with claimed production jobs will be kept. Other unused cards will be deleted."} The batch is removed only when empty.</p>
        <p>Printed copies, physical NFC tags and external websites are not erased.</p>
        <label>Type <strong>{deleteTarget.label}</strong> to confirm<input autoFocus autoComplete="off" required value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} disabled={busy} /></label>
        {deleteError && <p role="alert" className="stock-delete-error">{deleteError}</p>}
        <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={() => setDeleteTarget(null)}>Cancel</button><button type="submit" className="danger-button" disabled={busy || deleteConfirmation !== deleteTarget.label}>{busy ? "Deleting…" : "Delete permanently"}</button></div>
      </form>
    </dialog>}
    <div className="production-print" aria-hidden="true"><style>{`@media print { @page { size: A4 portrait; margin: ${margin}mm; } .print-sheet { display:grid; grid-template-columns:repeat(${columns},${labelWidth}mm); grid-auto-rows:${labelHeight}mm; gap:${gap}mm; } .print-label { width:${labelWidth}mm; height:${labelHeight}mm; } .print-label img { width:${Math.min(labelHeight - 12, labelWidth - 6)}mm; height:${Math.min(labelHeight - 12, labelWidth - 6)}mm; } }`}</style>{Array.from({ length: Math.ceil(printCards.length / perPage) }, (_, page) => <div className="print-sheet" key={page}>{printCards.slice(page * perPage, (page + 1) * perPage).map((card) => <div className="print-label" key={card.id}><img src={card.imageData!} alt="" /><strong>{card.publicSlug}</strong><small>{card.canonicalUrl}</small></div>)}</div>)}</div>
  </>;
}
