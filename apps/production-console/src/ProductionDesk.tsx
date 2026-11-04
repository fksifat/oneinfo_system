import { useCallback, useEffect, useState } from "react";
import { api, type Credentials } from "./api.js";

interface Job { id: string; type: string; status: string }
interface ProductionCard {
  id: string; publicSlug: string; canonicalUrl: string; qrStatus: string; nfcStatus: string; qcStatus: string;
  imageData: string | null; printChecked: boolean; verification: { camera: boolean; nfc: boolean; cameraResult?: string; nfcResult?: string }; jobs: Job[];
}
interface Batch { id: string; batchCode: string; plannedQuantity: number; cards: ProductionCard[] }
interface Props { visible: boolean; credentials: Credentials; busy: boolean; onBusy: (value: boolean) => void; onMessage: (value: string) => void; onChanged: () => Promise<void> }

export function ProductionDesk({ visible, credentials, busy, onBusy, onMessage, onChanged }: Props) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState(() => localStorage.getItem("oneinfo.production.batch") ?? "");
  const [batch, setBatch] = useState<Batch | null>(null);
  const [selectedId, setSelectedId] = useState("");
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
  const visibleCards = batch?.cards.filter((card) => `${card.publicSlug} ${card.canonicalUrl}`.toLowerCase().includes(search.toLowerCase()) &&
    (cardFilter === "all" || (cardFilter === "pending" && card.nfcStatus !== "WRITTEN") || (cardFilter === "qc" && card.nfcStatus === "WRITTEN" && card.qcStatus !== "PASSED") || (cardFilter === "passed" && card.qcStatus === "PASSED"))) ?? [];
  const selected = visibleCards.find((card) => card.id === selectedId) ?? visibleCards[0];
  const rowsPerPage = Math.max(1, Math.floor((297 - margin * 2 + gap) / (labelHeight + gap)));
  const perPage = Math.max(1, Math.min(1000, rowsPerPage * Math.max(1, columns)));
  const layoutValid = labelWidth >= 25 && labelHeight >= 30 && Number.isInteger(columns) && columns >= 1 && columns <= 6 && gap >= 0 && margin >= 0 &&
    columns * labelWidth + (columns - 1) * gap + 2 * margin <= 210 && labelHeight + margin * 2 <= 297;

  const refresh = useCallback(async () => {
    const list = await api<{ items: Batch[] }>("/api/v1/production/batches", {}, credentials);
    setBatches(list.items);
    if (batchId) setBatch(await api<Batch>(`/api/v1/production/batches/${batchId}`, {}, credentials));
  }, [batchId, credentials]);

  useEffect(() => { void refresh().catch((error: Error) => onMessage(error.message)); }, [refresh]);

  useEffect(() => {
    if (!batchId) return;
    let disposed = false;
    let pending = false;
    const sync = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await api<{ items: Pick<ProductionCard, "id" | "qrStatus" | "nfcStatus" | "qcStatus" | "printChecked" | "verification">[] }>(
          `/api/v1/production/batches/${batchId}/verification-status`, {}, credentials);
        if (disposed) return;
        setBatch((current) => current?.id === batchId ? { ...current, cards: current.cards.map((card) => ({ ...card, ...result.items.find((item) => item.id === card.id) })) } : current);
        setSyncError("");
        setLastSynced(new Date().toLocaleTimeString());
      } catch (error) { if (!disposed) setSyncError(error instanceof Error ? error.message : "Dashboard update failed"); }
      finally { pending = false; }
    };
    void sync();
    const interval = window.setInterval(() => void sync(), 2000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [batchId, credentials]);

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
    localStorage.setItem("oneinfo.production.batch", created.id);
    setBatchId(created.id);
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
      <div className="batch-toolbar"><label>Production batch<select value={batchId} disabled={busy} onChange={(event) => { setBatchId(event.target.value); setBatch(null); setSelectedId(""); localStorage.setItem("oneinfo.production.batch", event.target.value); }}><option value="">Choose a batch</option>{batches.map((item) => <option key={item.id} value={item.id}>{item.batchCode} · {item.plannedQuantity} cards</option>)}</select></label><button disabled={busy || !batch} onClick={() => void generate()}>Generate all QR codes</button><button className="secondary" disabled={busy} onClick={() => void refresh().catch((error: Error) => onMessage(error.message))}>Refresh batch</button></div>
      {batch ? <>
        {batch.cards.some((card) => card.canonicalUrl.includes(".example/")) ? <p className="domain-warning">This batch uses the placeholder cards.oneinfo.example domain. Its scan values can be verified, but the links will not open a live profile. Use your real links or configure the card domain for actual production.</p> : null}
        <div className="batch-metrics">{[["Cards", batch.cards.length], ["Print checked", batch.cards.filter((card) => card.printChecked).length], ["NFC written", batch.cards.filter((card) => card.nfcStatus === "WRITTEN").length], ["QC approved", batch.cards.filter((card) => card.qcStatus === "PASSED").length]].map(([label, count]) => <div key={label}><span>{label}</span><strong>{count}<small> / {batch.cards.length}</small></strong></div>)}</div>
        <div className="card-search"><label>Find a card<input type="search" value={search} placeholder="Card ID or link…" onChange={(event) => setSearch(event.target.value)} /></label><label>Stage<select value={cardFilter} onChange={(event) => setCardFilter(event.target.value)}><option value="all">All cards</option><option value="pending">Awaiting NFC</option><option value="qc">Awaiting final QC</option><option value="passed">QC approved</option></select></label><small>{visibleCards.length} cards shown</small></div>
        <div className="production-layout"><div className="production-card-list" role="group" aria-label="Batch cards">{!visibleCards.length ? <p className="empty">No cards match this search.</p> : null}{visibleCards.map((card) => <button aria-pressed={selected?.id === card.id} className={selected?.id === card.id ? "selected" : ""} key={card.id} disabled={busy} onClick={() => setSelectedId(card.id)}><strong>{String(batch.cards.indexOf(card) + 1).padStart(3, "0")} · {card.publicSlug}</strong><small>QR {card.imageData ? "ready" : "pending"} · NFC {card.nfcStatus === "WRITTEN" ? "written" : "pending"} · QC {card.qcStatus.toLowerCase()}</small><span>{card.verification.camera ? "Camera ✓" : "Camera —"} · {card.verification.nfc ? "NFC ✓" : "NFC —"}</span></button>)}</div>
          {selected ? <article className="selected-production-card"><div className="selected-qr">{selected.imageData ? <img src={selected.imageData} alt={`QR for ${selected.publicSlug}`} /> : <span>Generate this QR first</span>}</div><p className="section-label">SELECTED CARD · {selected.publicSlug}</p><p className="canonical-link">{selected.canonicalUrl}</p><small>This exact saved link is used for the QR image, NFC write, and scan comparisons.</small>
            <p role="status">Printed QR check: {selected.printChecked ? "CHECKED ON PHONE" : "AWAITING PHONE SCAN"}</p>
            <div className="actions"><button disabled={busy || Boolean(selected.imageData)} onClick={() => void generate(selected)}>Generate QR</button>{selected.imageData ? <a className="download-qr" href={selected.imageData} download={`${selected.publicSlug}.png`}>Download PNG</a> : null}</div>
            <div className="verification-controls"><p className="section-label">PHONE PRODUCTION · LIVE UPDATES</p><small>Phone: Scan printed QR → Load to NFC → scan QR again → tap NFC → Approve QC. Only the final scans after writing count toward QC.</small><div><span className={selected.nfcStatus === "WRITTEN" ? "check-pass" : ""}>{selected.nfcStatus === "WRITTEN" ? "✓" : "1"}</span><strong role="status">NFC encoding: {selected.nfcStatus}</strong></div><div><span className={selected.verification.camera ? "check-pass" : ""}>{selected.verification.camera ? "✓" : "2"}</span><strong role="status">Final QR check: {selected.verification.cameraResult ?? "PENDING"}</strong></div><div><span className={selected.verification.nfc ? "check-pass" : ""}>{selected.verification.nfc ? "✓" : "3"}</span><strong role="status">Final NFC check: {selected.verification.nfcResult ?? "PENDING"}</strong></div><strong role="status">QC approval: {selected.qcStatus}</strong><small>{syncError ? `Live updates paused: ${syncError}` : `Updated ${lastSynced || "just now"} · refreshes every 2 seconds`}</small></div>
          </article> : null}
        </div>
        <div className="print-settings"><div><p className="section-label">PRINT PRODUCTION</p><h2>A4 label sheet</h2></div><label>Width (mm)<input type="number" min="25" max="180" value={labelWidth} onChange={(event) => setLabelWidth(Number(event.target.value))} /></label><label>Height (mm)<input type="number" min="30" max="277" value={labelHeight} onChange={(event) => setLabelHeight(Number(event.target.value))} /></label><label>Columns<input type="number" min="1" max="6" value={columns} onChange={(event) => setColumns(Number(event.target.value))} /></label><label>Gap (mm)<input type="number" min="0" max="20" value={gap} onChange={(event) => setGap(Number(event.target.value))} /></label><label>Margin (mm)<input type="number" min="0" max="30" value={margin} onChange={(event) => setMargin(Number(event.target.value))} /></label><button className="secondary" disabled={busy || !selected?.imageData || !layoutValid} onClick={() => selected && void print([selected])}>Print selected QR</button><button disabled={busy || !layoutValid || batch.cards.some((card) => !card.imageData)} onClick={() => void print(batch.cards)}>Print full batch</button><p>{layoutValid ? `${columns} columns · ${rowsPerPage} rows · ${perPage} labels per A4 page. Use actual size / 100% scale; test one sheet first.` : "The selected dimensions do not fit an A4 sheet."}</p></div>
      </> : <p className="empty">Create a batch or choose an existing one to start production.</p>}
    </section>
    <div className="production-print" aria-hidden="true"><style>{`@media print { @page { size: A4 portrait; margin: ${margin}mm; } .print-sheet { display:grid; grid-template-columns:repeat(${columns},${labelWidth}mm); grid-auto-rows:${labelHeight}mm; gap:${gap}mm; } .print-label { width:${labelWidth}mm; height:${labelHeight}mm; } .print-label img { width:${Math.min(labelHeight - 12, labelWidth - 6)}mm; height:${Math.min(labelHeight - 12, labelWidth - 6)}mm; } }`}</style>{Array.from({ length: Math.ceil(printCards.length / perPage) }, (_, page) => <div className="print-sheet" key={page}>{printCards.slice(page * perPage, (page + 1) * perPage).map((card) => <div className="print-label" key={card.id}><img src={card.imageData!} alt="" /><strong>{card.publicSlug}</strong><small>{card.canonicalUrl}</small></div>)}</div>)}</div>
  </>;
}
