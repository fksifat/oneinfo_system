import { orderLink } from "./admin-links.js";
import { useEffect, useState } from "react";
import { api } from "./api.js";

type Review = { id: string; orderId: string; productId: string; productName: string; displayName: string; rating: number; title: string; body: string; status: "PENDING" | "PUBLISHED" | "REJECTED"; createdAt: string; seen: boolean };
export function Reviews({ token }: { token: string }) {
  const [inbox, setInbox] = useState("");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [more, setMore] = useState(false);
  const [items, setItems] = useState<Review[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  async function load() { try { const result = await api<{ items: Review[]; hasMore: boolean }>(`/api/v1/reviews/admin?page=${page}&query=${encodeURIComponent(query)}${inbox ? `&inbox=${inbox}` : ""}`, token); setItems(result.items); setMore(result.hasMore); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Could not load reviews."); } }
  useEffect(() => { void load(); }, [token, page, query, inbox]);
  async function moderate(review: Review, status?: "PUBLISHED" | "REJECTED") {
    setBusy(review.id); setError("");
    try {
      const path = `/api/v1/reviews/admin/${review.id}`;
      if (status) await api(path, token, { method: "PATCH", body: JSON.stringify({ status }) });
      else await api(`${path}/seen`, token, { method: "POST" });
      await load();
    }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update review."); }
    finally { setBusy(""); }
  }
  return <section className="panel review-admin"><div className="panel-head"><div><h2>Review inbox</h2><p>Only delivered-order buyers can submit. Publish reviews to show them in the storefront.</p></div><button className="quiet" onClick={() => void load()}>Refresh</button></div>
    <form className="list-toolbar" onSubmit={event => { event.preventDefault(); setQuery(String(new FormData(event.currentTarget).get("query") ?? "")); setPage(1); }}><label>Search reviews<input type="search" name="query" maxLength={120} /></label><button>Search</button><label>Inbox<select value={inbox} onChange={e => { setInbox(e.target.value); setPage(1); }}>
      <option value="">All reviews</option><option value="new">New</option><option value="low">Low rating (1–2)</option><option value="seen">Seen</option></select></label></form>
    <nav className="list-toolbar" aria-label="Review pages"><button className="quiet" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page}</span><button className="quiet" disabled={!more} onClick={() => setPage(value => value + 1)}>Next</button></nav>
    {error && <p role="alert">{error}</p>}{items.length === 0 && !error && <p className="empty">No reviews submitted yet.</p>}
    {items.map(review => <article className="review-admin-card" key={review.id}><div className="panel-head"><div><strong>{review.title}</strong><p>{review.productName} · {review.displayName} · <span className="rating-stars" aria-label={`${review.rating} out of 5 stars`}>{"★".repeat(review.rating)}{"☆".repeat(5-review.rating)}</span></p></div><span className={`pill ${review.status === "PUBLISHED" ? "success" : ""}`}>{review.status}</span></div><p>{review.body}</p><small>{review.seen ? "Seen" : "New"} · <a href={orderLink(review.orderId)}>Open order</a> · {new Date(review.createdAt).toLocaleDateString("en-BD")}</small>
      <div className="review-admin-actions">{!review.seen && <button className="quiet" disabled={Boolean(busy)} onClick={() => void moderate(review)}>Mark seen</button>}{review.status !== "PUBLISHED" && <button disabled={Boolean(busy)} onClick={() => void moderate(review,"PUBLISHED")}>{busy === review.id ? "Saving…" : "Publish"}</button>}{review.status !== "REJECTED" && <button className="quiet" disabled={Boolean(busy)} onClick={() => void moderate(review,"REJECTED")}>Reject</button>}</div></article>)}
  </section>;
}
