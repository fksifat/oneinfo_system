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

  return (
    <div className="batch-reprint-panel">
      <div className="panel-head batch-reprint-head">
        <div>
          <span className="eyebrow">HARDWARE REPRINT UTILITY</span>
          <h2>Reprint selected cards</h2>
          <p>Select cards to download a high-resolution print sheet using their saved vector QR codes.</p>
        </div>
        <button className="quiet reprint-close-button" type="button" onClick={onClose}>Close reprint ×</button>
      </div>
      {error && <p role="alert" className="lookup-error-banner">{error}</p>}
      {!result && (error ? <button className="quiet" onClick={() => setReload(value => value + 1)}>Try again</button> : <p role="status">Loading saved QR codes…</p>)}
      {result && (
        <>
          <fieldset disabled={busy} className="reprint-fieldset">
            <legend className="reprint-legend">Cards in Batch {result.code} ({result.items.length})</legend>
            <div className="reprint-grid">
              {result.items.map(card => {
                const printable = canPrint(card);
                const isChecked = selected.includes(card.id);
                return (
                  <label key={card.id} className={"reprint-card-item " + (isChecked ? "is-selected " : "") + (!printable ? "is-disabled" : "")}>
                    <input
                      type="checkbox"
                      disabled={!printable}
                      checked={isChecked}
                      onChange={e => {
                        const checked = e.target.checked;
                        setSelected(ids => checked ? [...ids, card.id] : ids.filter(id => id !== card.id));
                      }}
                    />
                    <div className="reprint-card-content">
                      <code>{card.slug}</code>
                      <small>{printable ? (card.labelOnly ? "QR label" : "Card back") : "Print artwork missing"}</small>
                    </div>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="reprint-actions">
            <button
              type="button"
              className="button-reprint-submit"
              disabled={!selected.length || busy}
              onClick={() => void download()}
            >
              {busy ? "Preparing export…" : `Download print sheet (${selected.length} cards)`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
