import type { StoreOrder } from "@oneinfo/contracts";

const arrowSvg = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 12h15m-5-5 5 5-5 5" />
  </svg>
);

export function OrderTrackingPipeline({ order, compact = false }: { order: StoreOrder; compact?: boolean }) {
  const cards = order.cards ?? {
    total: order.items?.reduce((sum, item) => sum + item.quantity, 0) || 1,
    qrGenerated: order.assignedCards?.filter(c => c.qcStatus === "PASSED" || c.publicSlug).length || 0,
    nfcWritten: order.assignedCards?.filter(c => c.qcStatus === "PASSED").length || 0,
    qcPassed: order.assignedCards?.filter(c => c.qcStatus === "PASSED").length || 0,
  };
  const total = Math.max(1, cards.total || 1);
  const pastProcessing = Boolean(order.processingAt || order.shippedAt || order.deliveredAt);
  const pastShipped = Boolean(order.shippedAt || order.deliveredAt);
  const isDelivered = Boolean(order.deliveredAt) || order.status === "DELIVERED";
  const isCancelled = order.status === "CANCELLED";
  const isConfirmed = order.status !== "AWAITING_PAYMENT" && !isCancelled;
  const qrReady = isConfirmed && (cards.qrGenerated >= total || pastProcessing);
  const qcReady = isConfirmed && (cards.qcPassed >= total || pastShipped);

  const fmt = (date?: string | null) =>
    date ? new Intl.DateTimeFormat("en-BD", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" }).format(new Date(date)) : "";

  const stages = [
    { title: "Received", sub: "Order placed", done: isConfirmed, meta: fmt(order.createdAt) || "Awaiting order", note: order.paymentStatus === "VERIFIED" ? "bKash verified" : order.paymentMethod === "COD" ? "COD confirmed" : "Order received" },
    { title: "Card & QR Generated", sub: "Identity allocated", done: qrReady, meta: `${qrReady ? total : cards.qrGenerated}/${total} QR ready`, note: order.assignedCards?.length ? `${order.assignedCards.length} cards assigned` : "Optical QR code" },
    { title: "NFC & QC Test OK", sub: "Hardware verified", done: qcReady, meta: `${qcReady ? total : cards.qcPassed}/${total} QC passed`, note: "NTAG213 write & read-back" },
    { title: "Processing", sub: "Packed for dispatch", done: pastProcessing, meta: fmt(order.processingAt) || "Workstation prep", note: "Card sealed with secret code" },
    { title: "Shipped", sub: "Handed to courier", done: pastShipped, meta: fmt(order.shippedAt) || "Courier handoff", note: order.courierTrackingId ? `Tracking: ${order.courierTrackingId}` : "Nationwide dispatch" },
    { title: "Delivered", sub: "In client’s hands", done: isDelivered, meta: fmt(order.deliveredAt) || "Delivered", note: isDelivered ? "Card ready for tap & activate" : "Awaiting delivery" },
  ];

  const activeIndex = stages.findIndex(s => !s.done);
  const doneCount = stages.filter(s => s.done).length;

  return (
    <div className={`admin-tracking-pipeline ${compact ? "is-compact" : ""}`}>
      <div className="pipeline-header">
        <div className="pipeline-title-group">
          <span className="pipeline-kicker">LIVE CARD JOURNEY</span>
          <strong>{doneCount}/6 stages completed</strong>
        </div>
        <div className="pipeline-bar-wrapper">
          <div className="pipeline-bar"><span style={{ width: `${Math.round((doneCount / 6) * 100)}%` }}></span></div>
          <span className="pipeline-percent">{Math.round((doneCount / 6) * 100)}%</span>
        </div>
      </div>
      <ol className="pipeline-stages">
        {stages.map((stage, i) => {
          const state = isCancelled && !stage.done ? "cancelled" : stage.done ? "done" : i === activeIndex ? "current" : "upcoming";
          return (
            <li key={stage.title} className="pipeline-stage-item" data-state={state}>
              <div className="pipeline-card">
                <div className="pipeline-card-top">
                  <span className="pipeline-badge">{stage.done ? "✓" : `0${i + 1}`}</span>
                  <small>{stage.sub}</small>
                </div>
                <strong className="pipeline-stage-name">{stage.title}</strong>
                <p className="pipeline-note">{stage.note}</p>
                <span className="pipeline-meta">{stage.meta}</span>
              </div>
              {i < stages.length - 1 && (
                <span className={`pipeline-arrow ${stage.done ? "is-done" : state === "current" ? "is-active" : ""}`} aria-hidden="true">
                  {arrowSvg}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
