import { orderLink } from "./admin-links.js";
import { useEffect, useState } from "react";
import { api } from "./api.js";

type Review = { id: string; orderId: string; productId: string; productName: string; displayName: string; rating: number; title: string; body: string; status: "PENDING" | "PUBLISHED" | "REJECTED"; createdAt: string; seen: boolean };

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && first && last) {
    return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase() || "CU";
}

export function Reviews({ token }: { token: string }) {
  const [inbox, setInbox] = useState("");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [more, setMore] = useState(false);
  const [items, setItems] = useState<Review[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      const result = await api<{ items: Review[]; hasMore: boolean }>(`/api/v1/reviews/admin?page=${page}&query=${encodeURIComponent(query)}${inbox ? `&inbox=${inbox}` : ""}`, token);
      setItems(result.items);
      setMore(result.hasMore);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load reviews.");
    }
  }

  useEffect(() => { void load(); }, [token, page, query, inbox]);

  async function moderate(review: Review, status?: "PUBLISHED" | "REJECTED") {
    setBusy(review.id);
    setError("");
    try {
      const path = `/api/v1/reviews/admin/${review.id}`;
      if (status) await api(path, token, { method: "PATCH", body: JSON.stringify({ status }) });
      else await api(`${path}/seen`, token, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update review.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="panel review-admin">
      <div className="panel-head reviews-panel-head">
        <div>
          <span className="eyebrow">CUSTOMER FEEDBACK</span>
          <h2>Review inbox</h2>
          <p>Verified reviews from delivered card buyers. Moderate, publish or reject feedback for storefront display.</p>
        </div>
        <button className="quiet" onClick={() => void load()}>Refresh</button>
      </div>

      <div className="reviews-controls-shelf">
        <form className="list-toolbar reviews-toolbar" onSubmit={event => {
          event.preventDefault();
          setQuery(String(new FormData(event.currentTarget).get("query") ?? ""));
          setPage(1);
        }}>
          <label className="review-search-label">
            <span className="control-kicker">Search reviews</span>
            <div className="review-search-wrap">
              <span className="search-icon" aria-hidden="true">🔍</span>
              <input type="search" name="query" maxLength={120} defaultValue={query} placeholder="Search customer, product, or feedback…" />
            </div>
          </label>
          <div className="review-submit-wrap">
            <button className="button-search-submit">Search</button>
          </div>
          <label className="review-filter-label">
            <span className="control-kicker">Inbox filter</span>
            <select value={inbox} onChange={e => { setInbox(e.target.value); setPage(1); }}>
              <option value="">All reviews</option>
              <option value="new">New unread</option>
              <option value="low">Low rating (1–2 ★)</option>
              <option value="seen">Already reviewed</option>
            </select>
          </label>
        </form>

        <nav className="reviews-pagination-bar" aria-label="Review pages">
          <button className="quiet" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button>
          <span className="reviews-page-indicator">Page {page}</span>
          <button className="quiet" disabled={!more} onClick={() => setPage(value => value + 1)}>Next</button>
        </nav>
      </div>

      {error && <p role="alert" className="review-error-banner">{error}</p>}
      {items.length === 0 && !error && <p className="empty">No reviews submitted yet.</p>}

      <div className="reviews-list-stack">
        {items.map(review => (
          <article className="review-admin-card" key={review.id}>
            <div className="review-card-header">
              <div className="review-card-user">
                <span className="review-user-avatar" aria-hidden="true">{getInitials(review.displayName)}</span>
                <div className="review-user-info">
                  <div className="review-user-name-row">
                    <strong>{review.displayName}</strong>
                    <span className="review-product-pill">{review.productName}</span>
                    {!review.seen && <span className="review-new-badge">NEW</span>}
                  </div>
                  <div className="review-rating-row">
                    <span className="rating-stars" aria-label={`${review.rating} out of 5 stars`}>
                      {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}
                    </span>
                    <span className="rating-number">{review.rating}.0 / 5</span>
                  </div>
                </div>
              </div>
              <div className="review-status-wrap">
                <span className={`pill ${review.status === "PUBLISHED" ? "success" : review.status === "REJECTED" ? "is-rejected" : ""}`}>
                  {review.status}
                </span>
              </div>
            </div>

            <div className="review-card-body">
              {review.title && <h3 className="review-headline">{review.title}</h3>}
              <p className="review-text">{review.body}</p>
            </div>

            <div className="review-card-footer">
              <div className="review-meta">
                <span className={`review-seen-dot ${review.seen ? "is-seen" : "is-unread"}`} aria-hidden="true"></span>
                <span>{review.seen ? "Seen by operator" : "Awaiting review"}</span>
                <span className="meta-sep" aria-hidden="true">·</span>
                <a href={orderLink(review.orderId)} className="review-order-link">
                  Open order ↗
                </a>
                <span className="meta-sep" aria-hidden="true">·</span>
                <time>{new Date(review.createdAt).toLocaleDateString("en-BD", { year: "numeric", month: "short", day: "numeric" })}</time>
              </div>

              <div className="review-admin-actions">
                {!review.seen && (
                  <button className="quiet" disabled={Boolean(busy)} onClick={() => void moderate(review)}>
                    Mark seen
                  </button>
                )}
                {review.status !== "PUBLISHED" && (
                  <button className="button-publish" disabled={Boolean(busy)} onClick={() => void moderate(review, "PUBLISHED")}>
                    {busy === review.id ? "Saving…" : "Publish"}
                  </button>
                )}
                {review.status !== "REJECTED" && (
                  <button className="quiet button-reject" disabled={Boolean(busy)} onClick={() => void moderate(review, "REJECTED")}>
                    Reject
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
