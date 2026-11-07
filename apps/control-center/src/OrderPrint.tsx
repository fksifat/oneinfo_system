import { useEffect, useRef, useState } from "react";
import type { StoreOrder } from "@oneinfo/contracts";
import lightBack from "../../../output/essential-svg/03_PRINT_Light_Back.svg?url";
import darkBack from "../../../output/essential-svg/05_PRINT_Black_Back.svg?url";
import { api } from "./api.js";

type Prepared = { printed: false; finish: "light" | "dark"; imageData: string; publicSlug: string };
type Result = Prepared | { printed: true };

function printArtwork(template: string, imageData: string) {
  if (!/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(imageData)) throw new Error("This QR image cannot be exported. Prepare the card again.");
  if (!template.includes('width="260.79" height="172.91"') || !template.includes("</svg>")) throw new Error("The back artwork has no matching print dimensions. Check the configured template.");
  // EPS artwork bounds are 92 Ã— 61 mm including bleed. Cover the template's sample QR.
  return template.replace('width="260.79" height="172.91"', 'width="92mm" height="61mm"')
    .replace("</svg>", `<rect x="103" y="61" width="55" height="55" fill="white"/><image x="103" y="61" width="55" height="55" href="${imageData}" style="image-rendering:pixelated"/></svg>`);
}

export function OrderPrint({ order, token, onChange }: { order: StoreOrder; token: string; onChange: () => void }) {
  const [selected, setSelected] = useState<number>();
  const [prepared, setPrepared] = useState<Prepared>();
  const [step, setStep] = useState<"prepare" | "preview" | "scan" | "confirm">("prepare");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [artwork, setArtwork] = useState("");
  const [confirmed, setConfirmed] = useState<number[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const slots = order.items.flatMap((line, lineIndex) => Array.from({ length: line.quantity }, (_, unitIndex) => ({ line, lineIndex, unitIndex })));
  const assigned = new Map(order.assignedCards?.map(card => [`${card.lineIndex}:${card.unitIndex}`, card]));
  const finished = slots.map((slot, index) => confirmed.includes(index) || Boolean(assigned.get(`${slot.lineIndex}:${slot.unitIndex}`)?.printConfirmedAt));
  const next = finished.indexOf(false);
  const active = selected ?? next;
  const slot = slots[active];
  const printed = finished[active];
  const eligible = (order.status === "RECEIVED" || order.status === "PROCESSING") && order.paymentStatus !== "PENDING_VERIFICATION";
  const total = slots.length;
  const printedCount = finished.filter(Boolean).length;
  const title = next === -1 ? "All cards printed" : printed ? "Print confirmed" : !eligible ? "Printing paused"
    : { prepare: "Prepare the card", preview: "Preview and download", scan: "Print and scan the QR", confirm: "Confirm the print" }[step];
  const stepLabel = next === -1 || printed || !eligible ? null
    : { prepare: "Step 1 of 4", preview: "Step 2 of 4", scan: "Step 3 of 4", confirm: "Step 4 of 4" }[step];

  function focusStep() {
    requestAnimationFrame(() => heading.current?.focus());
  }

  function openCard(index: number) {
    setSelected(index); setPrepared(undefined); setError(""); setStep("prepare"); focusStep();
  }

  useEffect(() => {
    setArtwork("");
    if (!prepared) return;
    const controller = new AbortController();
    let url: string | undefined;
    void fetch(prepared.finish === "dark" ? darkBack : lightBack, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Could not load the back artwork. Prepare the card again.");
      const svg = printArtwork(await response.text(), prepared.imageData);
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      setArtwork(url);
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not open the artwork."); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [prepared]);

  async function run(action: "prepare" | "confirm") {
    if (!slot || busy) return;
    setSelected(active); setBusy(true); setError("");
    try {
      const result = await api<Result>(`/api/v1/orders/admin/${order.id}/card-print`, token,
        { method: "POST", body: JSON.stringify({ lineIndex: slot.lineIndex, unitIndex: slot.unitIndex, action }) });
      if (result.printed) {
        setConfirmed(previous => [...previous, active]);
        setPrepared(undefined);
      } else {
        setPrepared(result);
        setStep("preview");
      }
      focusStep();
      onChange();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update this card. Try again."); }
    finally { setBusy(false); }
  }

  if (!total || (!eligible && !printedCount)) return null;
  return <details className="order-print">
    <summary><strong>Card printing</strong> <span>{printedCount} of {total} printed</span></summary>
    <div className="order-print-body">
      <div className="order-print-step">
        {slot && next !== -1 && <p className="order-print-meta">Card {active + 1} of {total} <span>·</span> {slot.line.name} · {slot.line.variantName}</p>}
        <h3 ref={heading} tabIndex={-1}>{title}</h3>
        {stepLabel && <p className="order-print-step-number">{stepLabel}</p>}
      </div>
      {next === -1 ? <p role="status">Printing is complete for this order.</p>
        : printed ? <>
          <p role="status">This card’s print is saved. Continue with the next card that needs printing.</p>
          <button className="order-print-primary" type="button" onClick={() => openCard(next)}>Next card</button>
        </> : !eligible ? <p>Only open orders with verified payment, when required, can prepare cards.</p>
        : step === "prepare" ? <>
          <p>Create the QR for this card and place it on the back design.</p>
          <button className="order-print-primary" type="button" disabled={busy} onClick={() => void run("prepare")}>{busy ? "Preparing…" : "Prepare card for printing"}</button>
        </> : step === "preview" && prepared ? <>
          {artwork ? <>
            <img className="order-print-preview" src={artwork} alt="Back of the ordered card with its unique QR code" />
            <p>Check the design, then download the 92 × 61 mm SVG with bleed.</p>
            <a className="order-print-primary order-print-download" href={artwork} download={`oneinfo-${prepared.publicSlug}-back.svg`} onClick={() => { setStep("scan"); focusStep(); }}>Download card back</a>
          </> : error ? <button className="order-print-primary" type="button" disabled={busy} onClick={() => void run("prepare")}>Retry preview</button>
            : <p role="status">Loading the card design…</p>}
        </> : step === "scan" && prepared ? <>
          <ol className="order-print-instructions">
            <li>Print the downloaded design at actual size (100%).</li>
            <li>Scan the printed QR with your phone. The address should contain <code>/c/{prepared.publicSlug}</code>.</li>
          </ol>
          <button className="order-print-primary" type="button" onClick={() => { setStep("confirm"); focusStep(); }}>I printed and scanned it</button>
          <a href={artwork} download={`oneinfo-${prepared.publicSlug}-back.svg`}>Download again</a>
        </> : <>
          <p>Save the print confirmation for this card.</p>
          <button className="order-print-primary" type="button" disabled={busy} onClick={() => void run("confirm")}>{busy ? "Confirming…" : "Confirm printed"}</button>
          <button className="order-print-back" type="button" disabled={busy} onClick={() => { setStep("scan"); focusStep(); }}>Back to print instructions</button>
        </>}
      {error && <p className="store-order-notice is-error" role="alert">{error}</p>}
      {error && finished.some((done, index) => !done && index !== active) && <button className="order-print-back" type="button" disabled={busy}
        onClick={() => openCard(finished.findIndex((done, index) => !done && index !== active))}>Work on another card</button>}
    </div>
  </details>;
}
