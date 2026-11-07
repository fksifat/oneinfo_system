import { useState } from "react";
import type { StoreOrder } from "@oneinfo/contracts";
import { api } from "./api.js";
import { escapePrintText as escape } from "./print-artwork.js";

export function OrderPacking({ order, token, initiallyOpen, onChange }: { order: StoreOrder; token: string; initiallyOpen: boolean; onChange: () => Promise<void> }) {
  const [scans, setScans] = useState("");
  const [verified, setVerified] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [repacking, setRepacking] = useState(false);
  const required = order.items.reduce((count, item) => count + item.quantity, 0);
  const cards = order.assignedCards ?? [];
  const invoiceOrder = Boolean(order.invoiceNumber);
  const ready = cards.filter(card => card.printConfirmedAt && card.nfcStatus === "WRITTEN" && card.qcStatus === "PASSED" &&
    (!invoiceOrder || card.inventoryStatus === "RESERVED")).length;
  const paid = order.paymentStatus !== "PENDING_VERIFICATION";
  const fingerprint = cards.map(card => card.id).sort().join(",");
  const checked = (invoiceOrder || verified === fingerprint) && ready === required && paid && !repacking;
  if (order.status !== "RECEIVED" && order.status !== "PROCESSING") return null;

  function printSlip() {
    const tab = window.open("", "_blank", "popup");
    if (!tab) { setError("Allow popups to open the packing slip."); return; }
    tab.opener = null;
    tab.document.write(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Oneinfo packing slip</title>
      <style>body{font:16px system-ui;margin:2rem;line-height:1.5}li{margin:.25rem 0} @media print{button{display:none}}</style>
      <h1>Oneinfo packing slip</h1><p>${order.invoiceNumber ? `Invoice ${escape(order.invoiceNumber)}` : `Order ${escape(order.id)}`}</p>
      <p>${escape(order.customer.name)}<br>${escape(order.customer.phone)}<br>${escape(order.deliveryAddress.addressLine)}<br>
      ${escape(order.deliveryAddress.district)} ${escape(order.deliveryAddress.postalCode ?? "")}</p>
      <h2>Items</h2><ul>${order.items.map(item => `<li>${item.quantity} × ${escape(item.name)} · ${escape(item.variantName)}</li>`).join("")}</ul>
      <p>Verified cards: ${cards.map(card => escape(card.publicSlug)).join(", ")}</p><button type="button">Print packing slip</button></html>`);
    tab.document.close();
    tab.document.querySelector("button")?.addEventListener("click", () => tab.print());
  }

  return <details className="operation-panel order-packing" open={initiallyOpen || undefined}><summary>{invoiceOrder ? "Pack from ready stock" : "Packing checklist"}</summary>
    <ul><li>{paid ? "Payment checked (or no advance required)" : "Payment needs verification"}</li>
      <li>{ready} of {required} {invoiceOrder ? "ready cards packed" : "cards printed, NFC written and QC passed"}</li>
      <li>{checked ? "All assigned cards matched" : "Match the cards in the package"}</li></ul>
    {paid && (invoiceOrder ? !cards.length || repacking : ready === required) && !checked && <form onSubmit={async event => {
      event.preventDefault(); if (busy) return; setError(""); setBusy(true);
      try {
        await api(`/api/v1/orders/admin/${order.id}/packing-check`, token, {
          method: "POST", body: JSON.stringify({ scans: scans.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
            ...(repacking ? { replace: cards.map(card => card.id) } : {}) }),
        });
        setVerified(fingerprint); await onChange(); setRepacking(false); setScans("");
      } catch (e) { setError(e instanceof Error ? e.message : "Could not verify the cards."); }
      finally { setBusy(false); }
    }}>
      {invoiceOrder && <><p>Pick any ready cards of the correct finish. Scan the ones going into this package, in the order shown below.</p>
        <ol>{order.items.map((item, index) => <li key={index}>{item.quantity} × {item.name} · {item.variantName}</li>)}</ol></>}
      <label>Scan or paste one QR link or card code per line
        <textarea value={scans} onChange={e => setScans(e.target.value)} required rows={3} maxLength={500000} />
      </label><button className="button-action button-action-primary" disabled={busy}>{busy ? "Checking…" : invoiceOrder ? "Confirm packed cards" : "Check packed cards"}</button>
      {repacking && <button className="quiet" type="button" disabled={busy} onClick={() => { setRepacking(false); setScans(""); }}>Cancel repack</button>}
    </form>}
    {checked && <p role="status">Packing complete. <button className="quiet" type="button" onClick={printSlip}>Open packing slip</button></p>}
    {invoiceOrder && paid && cards.length > 0 && !repacking && <button className="quiet" type="button" onClick={() => { setRepacking(true); setError(""); }}>Repack cards</button>}
    {error && <p role="alert" className="store-order-notice is-error">{error}</p>}
  </details>;
}
