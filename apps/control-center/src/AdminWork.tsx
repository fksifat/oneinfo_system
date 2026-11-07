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
  packing: ["Needs packing", "Open packing checklist"],
} as const;
type Stage = keyof typeof stages;
const stageIcons: Record<Stage, string> = {
  payment: "💳",
  print: "🖨️",
  nfc: "📡",
  qc: "🔬",
  qc_failed: "⚠️",
  packing: "📦",
};

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

  return (
    <section className="panel operation-panel workqueue-panel">
      <div className="panel-head workqueue-panel-head">
        <div>
          <span className="eyebrow">PRODUCTION WORKFLOW QUEUE</span>
          <h2>Continue next task</h2>
          <p>Open the card or order at the step that needs operator action.</p>
        </div>
        <span className="workqueue-count-badge">
          {result?.items ? result.items.length + " tasks ready" : "Live queue"}
        </span>
      </div>

      <div className="workqueue-filter-toolbar">
        <label className="workqueue-filter-label">
          <span className="filter-kicker">Work queue</span>
          <div className="workqueue-select-wrap">
            <span className="filter-glyph" aria-hidden="true">⚡</span>
            <select
              value={stage}
              onChange={e => { setStage(e.target.value); setPage(1); }}
              aria-label="Filter work queue by stage"
            >
              <option value="">All open work</option>
              {Object.entries(stages).map(([key, [label]]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
        </label>
      </div>

      {error && <p className="store-order-notice is-error lookup-error-banner" role="alert">{error}</p>}
      {!result && !error && <p className="workqueue-loading" role="status">Loading live tasks…</p>}
      {result && !result.items.length && (
        <div className="workqueue-empty-state">
          <span className="empty-icon" aria-hidden="true">✓</span>
          <p>No cards in this queue. Everything in this stage is completed!</p>
        </div>
      )}

      <div className="workqueue-cards-list">
        {result?.items.map(task => {
          const inOrders = task.orderId && ["payment", "print", "packing"].includes(task.stage);
          const href = inOrders ? orderLink(task.orderId!, task.stage, task.cardId ?? undefined) : workstationLink(task.batchId!, task.cardId ?? undefined);
          const reason = task.jobStatus === "RETRYABLE_FAILURE"
            ? "Previous attempt failed; retry after checking the card."
            : task.jobStatus === "CLAIMED"
              ? "Assigned to an active workstation."
              : task.stage === "qc_failed"
                ? "Card did not pass its last quality check."
                : task.stage === "payment"
                  ? "Payment must be verified before production."
                  : task.stage === "print" && !task.cardId
                    ? "Card has not been allocated or prepared."
                    : stages[task.stage][0];

          const isAlert = task.stage === "qc_failed" || task.jobStatus === "RETRYABLE_FAILURE";
          const isWarn = task.stage === "payment" || task.stage === "print";

          return (
            <div className={"workqueue-card-row " + (isAlert ? "is-alert " : isWarn ? "is-warn " : "is-standard ")} key={task.key}>
              <div className="workqueue-card-main">
                <div className="workqueue-stage-avatar" aria-hidden="true">
                  <span>{stageIcons[task.stage] ?? "⚙️"}</span>
                </div>
                <div className="workqueue-card-details">
                  <div className="workqueue-title-line">
                    <code className="workqueue-slug-code">{task.label}</code>
                    {task.units > 1 && (
                      <span className="workqueue-units-pill">{task.units} cards</span>
                    )}
                    <span className={"table-status-pill " + (isAlert ? "is-bad" : isWarn ? "is-warn" : "is-good")}>
                      <span className="status-dot"></span>
                      {stages[task.stage][0]}
                    </span>
                  </div>
                  <p className="workqueue-reason-text">
                    {reason}
                    {task.station ? <span className="workqueue-station-tag"> · Station: {task.station}</span> : ""}
                  </p>
                </div>
              </div>

              <div className="workqueue-action-area">
                <a
                  href={href}
                  target={inOrders ? undefined : "_blank"}
                  rel={inOrders ? undefined : "noreferrer"}
                  className="button-task-action"
                >
                  {stages[task.stage][1]} <span className="action-glyph">↗</span>
                </a>
              </div>
            </div>
          );
        })}
      </div>

      <PageButtons page={page} hasMore={result?.hasMore ?? false} setPage={setPage} />
    </section>
  );
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
  return (
    <details className="panel operation-panel activation-followup-panel" onToggle={e => setOpen(e.currentTarget.open)}>
      <summary className="activation-followup-summary">
        <div className="summary-left">
          <span className="summary-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
          <div className="summary-titles">
            <span className="eyebrow">CLIENT ENGAGEMENT</span>
            <strong className="summary-title">Activation follow-up</strong>
          </div>
        </div>
        <span className="summary-badge">
          {result?.items ? result.items.length + " cards awaiting signup" : "Delivered card queue"}
        </span>
      </summary>
      <div className="activation-followup-content">
        <p className="activation-followup-desc">Delivered cards that still need a client to activate them and publish their digital identity.</p>
        {error && <p role="alert" className="lookup-error-banner">{error}</p>}
        {!result && open && !error && <p role="status" className="followup-loading">Loading delivered cards…</p>}
        {result?.items.length === 0 && <p className="followup-empty">✓ No delivered cards are awaiting activation.</p>}
        {result?.items.map(card => (
          <div className="operation-row followup-card-row" key={card.cardId}>
            <div className="followup-card-info">
              <div className="followup-title-row">
                <strong>{card.customer}</strong>
                <code>{card.publicSlug}</code>
              </div>
              <small>Delivered {new Date(card.deliveredAt).toLocaleDateString("en-BD")}</small>
            </div>
            <div className="operation-actions">
              <a href={orderLink(card.orderId)} className="action-pill-link">Open order ↗</a>
              <CardPassport cardId={card.cardId} token={token} />
            </div>
          </div>
        ))}
        <PageButtons page={page} hasMore={result?.hasMore ?? false} setPage={setPage} />
      </div>
    </details>
  );
}

type FoundCard = { id: string; publicSlug: string; inventoryStatus: string; batchId: string; batchCode: string; orderId: string | null; printConfirmedAt: string | null };
export function CardLookup({ token }: { token: string }) {
  const [card, setCard] = useState<FoundCard>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel operation-panel card-lookup-panel">
      <div className="panel-head card-lookup-head">
        <div>
          <span className="eyebrow">HARDWARE INSPECTION</span>
          <h2>Scan to find a card</h2>
          <p>Scan with an optical 2D barcode scanner or paste the public card URL to inspect state.</p>
        </div>
      </div>
      <form className="list-toolbar card-lookup-form" onSubmit={async e => {
        e.preventDefault(); if (busy) return;
        const value = new FormData(e.currentTarget).get("value"); setBusy(true); setError(""); setCard(undefined);
        try { setCard(await api<FoundCard>("/api/v1/admin/cards/lookup", token, { method: "POST", body: JSON.stringify({ value }) })); }
        catch (e) { setError(e instanceof Error ? e.message : "Could not find the card."); }
        finally { setBusy(false); }
      }}>
        <label className="card-lookup-label">
          <span className="control-kicker">QR link or card code</span>
          <div className="card-lookup-input-wrap">
            <span className="scanner-glyph" aria-hidden="true">📷</span>
            <input name="value" type="search" maxLength={2048} required placeholder="Scan with a QR reader or paste card URL (e.g. https://oneinfo.online/c/DwwWaqIx8xQa)" />
          </div>
        </label>
        <button className="button-lookup-submit" disabled={busy}>{busy ? "Finding…" : "Find card"}</button>
      </form>
      {error && <p role="alert" className="lookup-error-banner">{error}</p>}
      {card && (
        <div className="operation-row lookup-result-row" role="status">
          <div className="lookup-result-info">
            <div className="lookup-result-title">
              <strong><code>{card.publicSlug}</code></strong>
              <span className="status-pill is-good">{card.inventoryStatus.replaceAll("_", " ")}</span>
            </div>
            <small>{card.printConfirmedAt ? "✓ Print confirmed" : "⏳ Print unconfirmed"} · Batch {card.batchCode}</small>
          </div>
          <div className="operation-actions">
            <a href={workstationLink(card.batchId, card.id)} target="_blank" rel="noreferrer" className="action-pill-link">Open batch ↗</a>
            {card.orderId && <a href={orderLink(card.orderId)} className="action-pill-link">Open order ↗</a>}
            <CardPassport cardId={card.id} token={token} />
          </div>
        </div>
      )}
    </section>
  );
}
