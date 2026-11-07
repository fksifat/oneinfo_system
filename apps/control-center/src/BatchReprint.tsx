import { useEffect, useState } from "react";
import { api } from "./api.js";
import { escapePrintText as escape, isQrImage, loadPrintTemplate, printArtwork } from "./print-artwork.js";

type Reprint = { id: string; slug: string; imageData: string | null; finish: "light" | "dark" | null; labelOnly: boolean };
const canPrint = (card: Reprint) => Boolean(card.imageData && (card.finish || card.labelOnly));

export function BatchReprint({ batchId, token, onClose }: { batchId: string; token: string; onClose: () => void }) {
  const [result, setResult] = useState<{ code: string; items: Reprint[] }>();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    setError("");
    void api<{ code: string; items: Reprint[] }>(`/api/v1/admin/batches/${batchId}/reprint`, token)
      .then(value => { if (current) setResult(value); })
      .catch(e => { if (current) setError(e instanceof Error ? e.message : "Could not load saved QR codes."); });
    return () => { current = false; };
  }, [batchId, token, reload]);
  async function download() {
    if (!result || busy) return;
    setBusy(true); setError("");
    try {
      const cards = result.items.filter(card => selected.includes(card.id) && canPrint(card));
      const templates = new Map(await Promise.all([...new Set(cards.flatMap(card => card.finish ?? []))].map(async finish => [finish, await loadPrintTemplate(finish)] as const)));
      const artwork = cards.map(card => {
        const data = card.imageData!;
        if (!isQrImage(data)) throw new Error(`Saved QR for ${card.slug} is unavailable.`);
        return card.finish ? printArtwork(templates.get(card.finish)!, data)
          : `<div class="label"><img src="${data}" alt="QR code"><br>${escape(card.slug)}</div>`;
      });
      const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Oneinfo reprint</title><style>
        body{font:16px system-ui}section{break-inside:avoid;margin:8mm}.label img{width:25mm;height:25mm}svg{display:block}
        @media print{header{display:none}@page{margin:8mm}}
      </style><header><h1>Batch ${escape(result.code)}</h1><p>Print at actual size (100%).</p><button onclick="window.print()">Print selected cards</button></header>
      ${artwork.map(svg => `<section>${svg}</section>`).join("")}</html>`;
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      const link = document.createElement("a"); link.href = url; link.download = `oneinfo-reprint-${batchId.slice(0, 8)}.html`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not export the selected cards."); }
    finally { setBusy(false); }
  }

  return <div className="batch-reprint"><div className="panel-head"><h2>Reprint selected cards</h2>
    <button className="quiet" type="button" onClick={onClose}>Close reprint</button></div>
    {error && <p role="alert">{error}</p>}
    {!result && (error ? <button className="quiet" onClick={() => setReload(value => value + 1)}>Try again</button> : <p role="status">Loading saved QR codes…</p>)}
    {result && <><p>Select cards to download a print sheet using their saved QR codes.</p>
      <fieldset disabled={busy}><legend>Cards to reprint</legend>{result.items.map(card => <label key={card.id}>
        <input type="checkbox" disabled={!canPrint(card)} checked={selected.includes(card.id)} onChange={e => {
          const checked = e.target.checked; setSelected(ids => checked ? [...ids, card.id] : ids.filter(id => id !== card.id));
        }} /> {card.slug} · {canPrint(card) ? (card.labelOnly ? "QR label" : "Card back") : "Print artwork or QR missing"}
      </label>)}</fieldset>
      <button type="button" disabled={!selected.length || busy} onClick={() => void download()}>{busy ? "Preparing…" : `Download selected (${selected.length})`}</button></>}
  </div>;
}
