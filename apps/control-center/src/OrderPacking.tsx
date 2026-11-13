import { useState } from "react";
import type { StoreOrder } from "@oneinfo/contracts";
import { api } from "./api.js";
import { escapePrintText as escape } from "./print-artwork.js";
import { invoiceMarkup } from "../../../sites/storefront/invoice.js";
import invoiceStyles from "../../../sites/storefront/invoice.css?inline";

export function OrderPacking({ order, token, initiallyOpen, onChange }: { order: StoreOrder; token: string; initiallyOpen: boolean; onChange: () => Promise<void> }) {
  return order.activationMethod === "ORDER_SECRET"
    ? <SecretOrderPacking order={order} token={token} initiallyOpen={initiallyOpen} onChange={onChange} />
    : <LegacyOrderPacking order={order} token={token} initiallyOpen={initiallyOpen} onChange={onChange} />;
}

type SecretSlot = { id: string; profileId: string; lineIndex: number; unitIndex: number; cardId: string | null; redeemedAt: string | null; secretCode: string | null };

function SecretOrderPacking({ order, token, initiallyOpen, onChange }: Parameters<typeof OrderPacking>[0]) {
  const [codes, setCodes] = useState<SecretSlot[]>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const quantity = order.items.reduce((count, item) => count + item.quantity, 0);
  if (order.status === "CANCELLED" || order.status === "AWAITING_PAYMENT") return null;
  const paid = order.paymentStatus !== "PENDING_VERIFICATION";
  async function run(action: () => Promise<void>) {
    if (busy) return; setBusy(true); setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Could not update packing."); }
    finally { setBusy(false); }
  }
  function printInvoice() {
    if (busy || !paid || !order.invoiceNumber) return;
    const tab = window.open("", "_blank", "popup");
    if (!tab) { setError("Allow popups to print the invoice."); return; }
    tab.opener = null;
    tab.document.body.textContent = "Loading invoice…";
    void run(async () => {
      try {
        const { items } = await api<{ items: SecretSlot[] }>(`/api/v1/orders/admin/${order.id}/activation-codes`, token, { method: "POST" });
        if (!items.some(slot => slot.secretCode)) throw new Error("This order has no unused activation codes.");
        if (tab.closed) return;
        tab.document.write(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Invoice ${escape(order.invoiceNumber ?? "")} | Oneinfo</title><style>
          *,*::before,*::after{box-sizing:border-box}body{margin:20px;font:15px/1.45 system-ui;background:#f2f6f3}
          .invoice-actions button{font:inherit;padding:8px 14px;cursor:pointer}
          ${invoiceStyles}</style><main><article class="invoice-card">${invoiceMarkup(order, items)}
          <div class="invoice-actions"><button type="button">Print or save PDF</button></div></article></main></html>`);
        tab.document.close();
        tab.document.querySelector("button")?.addEventListener("click", () => tab.print());
      } catch (error) {
        tab.close();
        throw error;
      }
    });
  }
  function printCodes() {
    const tab = window.open("", "_blank", "popup");
    if (!tab) { setError("Allow popups to print activation codes."); return; }
    tab.opener = null;
    tab.document.write(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Oneinfo activation codes</title>
      <style>body{font:16px system-ui;margin:2rem}article{border:1px dashed #777;padding:1.5rem;margin:1rem 0;break-inside:avoid}strong{font:700 22px monospace}@media print{button{display:none}}</style>
      <h1>Oneinfo · ${escape(order.invoiceNumber ?? order.id)}</h1>
      ${(codes ?? []).filter(slot => slot.secretCode).map(slot => `<article><p>${escape(order.items[slot.lineIndex]?.name ?? "Card")} · ${escape(order.items[slot.lineIndex]?.variantName ?? "")} · Card ${slot.unitIndex + 1}</p>
        <strong>${escape(slot.secretCode!)}</strong><p>Scan your card’s QR or NFC, enter this secret code, then create an account or sign in and save your profile.</p><p>Use once with any unused, ready Oneinfo card. Keep this code private.</p></article>`).join("")}
      <button type="button">Print codes</button></html>`);
    tab.document.close(); tab.document.querySelector("button")?.addEventListener("click", () => tab.print());
  }
  return <details className="operation-panel order-packing" open={initiallyOpen || undefined}>
    <summary>Pack cards & activation codes</summary>
    <p>{quantity} temporary profile{quantity === 1 ? "" : "s"} · One private code per card. Physical cards are linked only when clients activate them.</p>
    <ol>{order.items.map((item, i) => <li key={i}>{item.quantity} × {item.name} · {item.variantName}{item.customization ? ` [Custom: ${item.customization.name}${item.customization.surfaceMotif ? ` · ${item.customization.surfaceMotif}` : ""}]` : ""}</li>)}</ol>
    <button type="button" disabled={busy || !paid} onClick={() => void run(async () => {
      setCodes((await api<{ items: SecretSlot[] }>(`/api/v1/orders/admin/${order.id}/activation-codes`, token, { method: "POST" })).items);
    })}>{busy ? "Loading…" : codes ? "Refresh secret codes" : "Show secret codes"}</button>
    {order.invoiceNumber && <button type="button" disabled={busy || !paid} onClick={printInvoice}>Print invoice with activation codes</button>}
    {!paid && <p>Verify payment before accessing codes or confirming packing.</p>}
    {codes && <><ul>{codes.map(slot => <li key={slot.id}>
      <span>Profile {slot.lineIndex + 1}.{slot.unitIndex + 1}</span> · {slot.redeemedAt ? "Activated" : <code>{slot.secretCode}</code>}
    </li>)}</ul><button type="button" disabled={!codes.some(slot => slot.secretCode)} onClick={printCodes}>Print activation slips</button></>}
    {!order.packedAt && paid && <form onSubmit={event => { event.preventDefault(); void run(async () => {
      await api(`/api/v1/orders/admin/${order.id}/packing-check`, token, { method: "POST", body: JSON.stringify({ confirmed: true }) });
      await onChange();
    }); }}>
      <label className="share-consent"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
        <span>I checked the quantity and finish of QC-passed cards and included a different secret code with each card.</span></label>
      <button disabled={busy || !confirmed || !codes || codes.length !== quantity}>Confirm package</button>
    </form>}
    {order.packedAt && <p role="status">Package confirmed. Any supplied unused card can be activated with an unused code from this order.</p>}
    {error && <p role="alert" className="store-order-notice is-error">{error}</p>}
  </details>;
}

function LegacyOrderPacking({ order, token, initiallyOpen, onChange }: Parameters<typeof OrderPacking>[0]) {
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
      <h2>Items</h2><ul>${order.items.map(item => `<li>${item.quantity} × ${escape(item.name)} · ${escape(item.variantName)}${item.customization ? ` [Custom: ${escape(item.customization.name)}${item.customization.surfaceMotif ? ` · ${escape(item.customization.surfaceMotif)}` : ""}]` : ""}</li>`).join("")}</ul>
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
        <ol>{order.items.map((item, index) => <li key={index}>{item.quantity} × {item.name} · {item.variantName}{item.customization ? ` [Custom: ${item.customization.name}${item.customization.surfaceMotif ? ` · ${item.customization.surfaceMotif}` : ""}]` : ""}</li>)}</ol></>}
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
