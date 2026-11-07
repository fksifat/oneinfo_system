import { useEffect, useState } from "react";
import { api } from "./api.js";
import { orderLink, workstationLink } from "./admin-links.js";
import { CardPassport } from "./CardPassport.js";

const stages = {
  payment: ["Payment to verify", "Verify payment"],
  print: ["Printing needed", "Print card"],
  nfc: ["NFC to write", "Write NFC"],
  qc: ["QC to complete", "Run QC"],
  qc_failed: ["Failed QC", "Review failed QC"],
  packing: ["Ready to pack", "Open packing checklist"],
} as const;
type Stage = keyof typeof stages;
type Task = { key: string; stage: Stage; units: number; orderId: string | null; cardId: string | null; batchId: string | null;
  label: string; station: string | null; jobStatus: string | null };
type FollowUp = { cardId: string; publicSlug: string; customer: string; orderId: string; deliveredAt: string };

export function NeedsAttention({ counts }: { counts: Partial<Record<Stage, number>> }) {
  const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
  return (
    <section className="panel attention-panel">
      <div className="panel-head">
        <div>
          <div className="panel-eyebrow-row">
            <span className="live-pulse-dot" aria-hidden="true" />
            <span className="panel-eyebrow">OPERATIONAL QUEUES</span>
          </div>
          <h2>Needs attention</h2>
          <p>Active items organized by next required production step. Click any queue to proceed.</p>
        </div>
        <div className="attention-summary-badge">
          <strong>{total}</strong>
          <span>pending action{total === 1 ? "" : "s"}</span>
        </div>
      </div>
      <div className="attention-grid">
        {Object.entries(stages).map(([key, [label, action]]) => {
          const count = counts[key as Stage] ?? 0;
          const hasItems = count > 0;
          return (
            <a key={key} href={`?work=${key}#tracking`} className={`attention-chip stage-${key} ${hasItems ? "has-items" : "is-zero"}`}>
              <div className="attention-chip-header">
                <span className="stage-status-dot" aria-hidden="true" />
                <span className="stage-num">{count}</span>
              </div>
              <strong className="stage-title">{label}</strong>
              <span className="stage-link-hint">
                {action} <span className="arrow-glyph" aria-hidden="true">→</span>
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

export function WorkQueue({ token }: { token: string }) {
  const requested = new URLSearchParams(location.search).get("work");
  const [stage, setStage] = useState(requested && Object.hasOwn(stages, requested) ? requested : "");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: Task[]; hasMore: boolean }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setResult(undefined); setError("");
    async function load() {
      try {
        const result = await api<{ items: Task[]; hasMore: boolean }>(`/api/v1/admin/tasks?page=${page}${stage ? `&stage=${stage}` : ""}`, token);
        if (current) { setResult(result); setError(""); }
      } catch (e) { if (current) setError(e instanceof Error ? e.message : "Could not load work."); }
    }
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => { current = false; window.clearInterval(timer); };
  }, [stage, page, token]);
  return <section className="panel operation-panel"><div className="panel-head"><div><h2>Continue next task</h2><p>Open the card or order at the step that needs work.</p></div></div>
    <div className="list-toolbar"><label>Work queue<select value={stage} onChange={e => { setStage(e.target.value); setPage(1); }}>
      <option value="">All open work</option>{Object.entries(stages).map(([key, [label]]) => <option key={key} value={key}>{label}</option>)}
    </select></label></div>
    {error && <p className="store-order-notice is-error" role="alert">{error}</p>}
    {!result && !error && <p className="empty" role="status">Loading work…</p>}
    {result && !result.items.length && <p className="empty">No cards in this queue.</p>}
    {result?.items.map(task => {
      const inOrders = task.orderId && ["payment", "print", "packing"].includes(task.stage);
      const href = inOrders ? orderLink(task.orderId!, task.stage, task.cardId ?? undefined) : workstationLink(task.batchId!, task.cardId ?? undefined);
      const reason = task.jobStatus === "RETRYABLE_FAILURE" ? "Previous attempt failed; retry after checking the card."
        : task.jobStatus === "CLAIMED" ? "Assigned to a workstation." : task.stage === "qc_failed" ? "Card did not pass its last quality check."
          : task.stage === "payment" ? "Payment must be verified before production." : task.stage === "print" && !task.cardId
            ? "Card has not been allocated or prepared." : stages[task.stage][0];
      return <div className="operation-row" key={task.key}><div><strong>{task.label}{task.units > 1 ? ` · ${task.units} cards` : ""}</strong>
        <small>{reason}{task.station ? ` Station: ${task.station}.` : ""}</small></div>
        <a href={href} target={inOrders ? undefined : "_blank"} rel={inOrders ? undefined : "noreferrer"}>{stages[task.stage][1]}</a></div>;
    })}
    <PageButtons page={page} hasMore={result?.hasMore ?? false} setPage={setPage} />
  </section>;
}

function PageButtons({ page, hasMore, setPage }: { page: number; hasMore: boolean; setPage: (page: number) => void }) {
  return page > 1 || hasMore ? <nav className="list-toolbar" aria-label="Work pages"><button className="quiet" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
    <span>Page {page}</span><button className="quiet" disabled={!hasMore} onClick={() => setPage(page + 1)}>Next</button></nav> : null;
}

export function ActivationFollowUp({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: FollowUp[]; hasMore: boolean }>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let current = true;
    setResult(undefined); setError("");
    void api<{ items: FollowUp[]; hasMore: boolean }>(`/api/v1/admin/activation-follow-up?page=${page}`, token)
      .then(result => { if (current) setResult(result); }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [token, open, page]);
  return <details className="panel operation-panel" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Activation follow-up</summary><p>Delivered cards that still need a client to activate them.</p>
    {error && <p role="alert">{error}</p>}
    {!result && open && !error && <p role="status">Loading delivered cards…</p>}
    {result?.items.length === 0 && <p>No delivered cards are awaiting activation.</p>}
    {result?.items.map(card => <div className="operation-row" key={card.cardId}><div><strong>{card.customer} · {card.publicSlug}</strong>
      <small>Delivered {new Date(card.deliveredAt).toLocaleDateString("en-BD")}</small></div>
      <div className="operation-actions"><a href={orderLink(card.orderId)}>Open order</a><CardPassport cardId={card.cardId} token={token} /></div></div>)}
    <PageButtons page={page} hasMore={result?.hasMore ?? false} setPage={setPage} />
  </details>;
}

type FoundCard = { id: string; publicSlug: string; inventoryStatus: string; batchId: string; batchCode: string; orderId: string | null; printConfirmedAt: string | null };
export function CardLookup({ token }: { token: string }) {
  const [card, setCard] = useState<FoundCard>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <section className="panel operation-panel"><h2>Scan to find a card</h2>
    <form className="list-toolbar" onSubmit={async e => {
      e.preventDefault(); if (busy) return;
      const value = new FormData(e.currentTarget).get("value"); setBusy(true); setError(""); setCard(undefined);
      try { setCard(await api<FoundCard>("/api/v1/admin/cards/lookup", token, { method: "POST", body: JSON.stringify({ value }) })); }
      catch (e) { setError(e instanceof Error ? e.message : "Could not find the card."); }
      finally { setBusy(false); }
    }}>
      <label>QR link or card code<input name="value" type="search" maxLength={2048} required placeholder="Scan with a QR reader or paste the link" /></label>
      <button disabled={busy}>{busy ? "Finding…" : "Find card"}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {card && <div className="operation-row" role="status"><div><strong>{card.publicSlug} · {card.inventoryStatus.replaceAll("_", " ")}</strong>
      <small>{card.printConfirmedAt ? "Print confirmed" : "Print unconfirmed"} · {card.batchCode}</small></div>
      <div className="operation-actions"><a href={workstationLink(card.batchId, card.id)} target="_blank" rel="noreferrer">Open batch</a>
        {card.orderId && <a href={orderLink(card.orderId)}>Open order</a>}<CardPassport cardId={card.id} token={token} /></div></div>}
  </section>;
}
