import { useEffect, useState } from "react";
import { api } from "./api.js";

type Review = { id: string; orderId: string; productId: string; productName: string; displayName: string; rating: number; title: string; body: string; status: "PENDING" | "PUBLISHED" | "REJECTED"; createdAt: string };
export function Reviews({ token }: { token: string }) {
  const [items, setItems] = useState<Review[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  async function load() { try { setItems((await api<{ items: Review[] }>("/api/v1/reviews/admin", token)).items); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Could not load reviews."); } }
  useEffect(() => { void load(); }, [token]);
  async function moderate(review: Review, status: "PUBLISHED" | "REJECTED") {
    setBusy(review.id); setError("");
    try { await api(`/api/v1/reviews/admin/${review.id}`, token, { method: "PATCH", body: JSON.stringify({ status }) }); setItems(previous => previous.map(item => item.id === review.id ? { ...item, status } : item)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update review."); }
    finally { setBusy(""); }
  }
  return <section className="panel review-admin"><div className="panel-head"><div><h2>Customer reviews</h2><p>Only delivered-order buyers can submit. Publish reviews to show them in the storefront.</p></div><button className="quiet" onClick={() => void load()}>Refresh</button></div>
    {error && <p role="alert">{error}</p>}{items.length === 0 && !error && <p className="empty">No reviews submitted yet.</p>}
    {items.map(review => <article className="review-admin-card" key={review.id}><div className="panel-head"><div><strong>{review.title}</strong><p>{review.productName} · {review.displayName} · {"★".repeat(review.rating)}{"☆".repeat(5-review.rating)}</p></div><span className={`pill ${review.status === "PUBLISHED" ? "success" : ""}`}>{review.status}</span></div><p>{review.body}</p><small>Order {review.orderId} · {new Date(review.createdAt).toLocaleDateString("en-BD")}</small>
      <div className="review-admin-actions">{review.status !== "PUBLISHED" && <button disabled={Boolean(busy)} onClick={() => void moderate(review,"PUBLISHED")}>{busy === review.id ? "Saving…" : "Publish"}</button>}{review.status !== "REJECTED" && <button className="quiet" disabled={Boolean(busy)} onClick={() => void moderate(review,"REJECTED")}>Reject</button>}</div></article>)}
  </section>;
}
