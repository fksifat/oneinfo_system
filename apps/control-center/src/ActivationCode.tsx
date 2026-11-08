import { useState } from "react";
import { api } from "./api.js";

export function ActivationCode({ cardId, slug, token, issued, claimed, ready }: {
  cardId: string; slug: string; token: string; issued: boolean; claimed: boolean; ready: boolean;
}) {
  const [secret, setSecret] = useState<{ secretCode: string; canonicalUrl: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (claimed) return <span className="table-status-pill is-good"><span className="status-dot"></span>Client claimed</span>;
  if (!ready) return <span className="table-status-pill is-warn"><span className="status-dot"></span>Awaiting QC</span>;
  const generate = async () => {
    const replaceExisting = issued || Boolean(secret);
    if (replaceExisting && !window.confirm("Replace this card's secret code? Its previous code and unfinished activation will stop working.")) return;
    setBusy(true); setError("");
    try {
      setSecret(await api(`/api/v1/customer/cards/${cardId}/activation-code`, token, { method: "POST", body: JSON.stringify({ replaceExisting }) }));
    } catch (error) { setError(error instanceof Error ? error.message : "Could not issue secret code"); }
    finally { setBusy(false); }
  };
  const print = () => {
    if (!secret) return;
    const popup = window.open("", "_blank", "width=640,height=500");
    if (!popup) { setError("Allow this site's print window, or copy the code instead."); return; }
    popup.opener = null; popup.document.title = `Oneinfo activation · ${slug}`;
    const style = popup.document.createElement("style");
    style.textContent = "body{font:16px system-ui;padding:32px;max-width:520px}h2{font:24px monospace;letter-spacing:2px}p{overflow-wrap:anywhere}@page{margin:15mm}";
    popup.document.head.append(style);
    for (const [tag, value] of [["h1", "Oneinfo · Private activation code"], ["p", `Card: ${slug}`], ["h2", secret.secretCode],
      ["p", "Tap your card or scan its code, enter this private activation code, then create your account and set up your profile."],
      ["p", secret.canonicalUrl], ["p", "Keep this slip private. Give it only to the card's owner."]]) {
      const element = popup.document.createElement(tag!); element.textContent = value!; popup.document.body.append(element);
    }
    popup.focus(); popup.print();
  };
  return <div className="activation-code-control">
    <button className="quiet button-secret-pill" disabled={busy} onClick={() => void generate()}>{busy ? "Issuing…" : issued || secret ? "Replace secret code" : "Generate secret code"}</button>
    {secret && <><strong className="private-code">{secret.secretCode}</strong><small>Copy or print now. The code cannot be retrieved later.</small>
      <button className="quiet" onClick={() => void navigator.clipboard.writeText(secret.secretCode).catch(() => setError("Copy failed. Select and copy the code manually."))}>Copy code</button>
      <button className="quiet" onClick={print}>Print private slip</button></>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
