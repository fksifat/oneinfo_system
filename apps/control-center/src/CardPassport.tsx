import { useRef, useState, type FormEvent } from "react";
import { api } from "./api.js";

type Passport = { card: { publicSlug: string; lifecycleStatus: string; qcStatus: string; claimedAt: string | null; profileId: string | null };
  batch?: { batchCode: string; printConfirmedAt: string | null }; activation?: { issuedAt: string; redeemedAt: string | null };
  events: { id: string; eventType: string; createdAt: string; metadata?: { replacementSlug?: string; previousSlug?: string } }[] };

export function CardPassport({ cardId, token }: { cardId: string; token: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<Passport>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const path = `/api/v1/production/cards/${cardId}`;
  const load = () => api<Passport>(`${path}/history`, token).then(setData);
  async function open() {
    dialog.current?.showModal(); setMessage(""); setBusy(true);
    try { await load(); }
    catch { setMessage("Could not load the card passport."); }
    finally { setBusy(false); }
  }
  async function replace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const replacementSlug = new FormData(event.currentTarget).get("replacementSlug");
    if (!confirm("Disable this card and move its profile to the replacement card?")) return;
    setBusy(true); setMessage("");
    try {
      const result = await api<{ replacementSlug: string }>(`${path}/replace`, token, { method: "POST", body: JSON.stringify({ replacementSlug }) });
      setMessage(`Replacement activated: ${result.replacementSlug}`); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not replace the card."); }
    finally { setBusy(false); }
  }
  async function disable() {
    if (busy || !confirm("Disable this card’s public link? You can assign a replacement later.")) return;
    setBusy(true); setMessage("");
    try { await api(`${path}/disable`, token, { method: "POST" }); setMessage("Card disabled."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not disable the card."); }
    finally { setBusy(false); }
  }
  const date = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";
  return <><button type="button" className="quiet" onClick={() => void open()}>Passport</button>
    <dialog ref={dialog} className="store-settings-dialog" aria-label="Digital card passport">
      <section className="panel store-order-settings card-passport"><h2>Digital card passport</h2>
        <button className="quiet" type="button" onClick={() => dialog.current?.close()}>Close</button>
        {busy && <p role="status">Loading…</p>}{message && <p role="status">{message}</p>}
        {data && <><dl><div><dt>Card</dt><dd>{data.card.publicSlug}</dd></div><div><dt>Batch</dt><dd>{data.batch?.batchCode ?? "—"}</dd></div>
          <div><dt>Printed</dt><dd>{date(data.batch?.printConfirmedAt)}</dd></div><div><dt>QC</dt><dd>{data.card.qcStatus}</dd></div>
          <div><dt>State</dt><dd>{data.card.lifecycleStatus}</dd></div><div><dt>Activated</dt><dd>{date(data.card.claimedAt ?? data.activation?.redeemedAt)}</dd></div></dl>
          <h3>History</h3><ul>{data.events.map(event => <li key={event.id}>{date(event.createdAt)} · {event.eventType.replaceAll("_", " ")}
            {event.metadata?.replacementSlug ? ` · ${event.metadata.replacementSlug}` : event.metadata?.previousSlug ? ` · ${event.metadata.previousSlug}` : ""}</li>)}</ul>
          {data.card.profileId && ["ACTIVATED", "SUSPENDED"].includes(data.card.lifecycleStatus) &&
            <button type="button" className="quiet" disabled={busy} onClick={() => void disable()}>Disable lost card</button>}
          {data.card.profileId && ["ACTIVATED", "SUSPENDED", "RETIRED"].includes(data.card.lifecycleStatus) && <form onSubmit={replace}>
            <label>Replacement card slug<input name="replacementSlug" required maxLength={64} /></label>
            <button type="submit" disabled={busy}>Replace and disable old card</button>
          </form>}</>}
      </section>
    </dialog></>;
}
