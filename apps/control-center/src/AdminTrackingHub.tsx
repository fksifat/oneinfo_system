import { useEffect, useState, useDeferredValue } from "react";
import type { StoreOrder, OrderReceipt } from "@oneinfo/contracts";
import { api } from "./api.js";
import { OrderTrackingPipeline } from "./OrderTrackingPipeline.js";

const path = "/api/v1/orders";
const statusLabels: Record<string, string> = {
  AWAITING_PAYMENT: "Awaiting payment",
  CANCELLED: "Cancelled",
  RECEIVED: "Received",
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
};

export function AdminTrackingHub({ token }: { token: string }) {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [delivering, setDelivering] = useState<string>();
  const [selectedOrder, setSelectedOrder] = useState<string>();
  const deferredSearch = useDeferredValue(search);

  async function load() {
    setLoading(true);
    try {
      const result = await api<{ items: StoreOrder[] }>(`${path}/admin`, token);
      setOrders(result.items);
      setError("");
      if (!selectedOrder && result.items.length) {
        setSelectedOrder(result.items[0]!.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load orders");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  async function updateFulfillment(order: StoreOrder, status: "PROCESSING" | "SHIPPED", trackingId?: string) {
    setDelivering(order.id);
    try {
      const updated = await api<OrderReceipt>(`${path}/admin/${order.id}/fulfillment`, token, {
        method: "POST",
        body: JSON.stringify({ status, trackingId }),
      });
      setOrders(prev => prev.map(item => item.id === order.id ? { ...item, ...updated } : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fulfillment update failed");
    } finally {
      setDelivering(undefined);
    }
  }

  async function markDelivered(order: StoreOrder) {
    if (!window.confirm(`Mark order ${order.id.slice(0, 8)} as delivered into the client's hands?`)) return;
    setDelivering(order.id);
    try {
      await api(`/api/v1/reviews/admin/orders/${order.id}/deliver`, token, { method: "POST" });
      setOrders(prev => prev.map(item => item.id === order.id ? { ...item, status: "DELIVERED", deliveredAt: new Date().toISOString() } : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark delivered");
    } finally {
      setDelivering(undefined);
    }
  }

  const filtered = orders.filter(o => {
    if (!deferredSearch) return true;
    const q = deferredSearch.toLowerCase();
    return (
      o.id.toLowerCase().includes(q) ||
      o.customer.name.toLowerCase().includes(q) ||
      o.customer.phone.includes(q) ||
      o.customer.email.toLowerCase().includes(q) ||
      o.assignedCards?.some(c => c.publicSlug.toLowerCase().includes(q))
    );
  });

  const active = orders.find(o => o.id === selectedOrder) ?? filtered[0];

  return (
    <section className="panel admin-tracking-hub-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">OPERATIONS PIPELINE</p>
          <h2>Live card order tracking</h2>
          <p>Follow physical smart cards from purchase to client delivery with live hardware QC verification.</p>
        </div>
        <button className="quiet" type="button" onClick={() => void load()}>Refresh</button>
      </div>

      <div className="list-toolbar">
        <input
          type="search"
          aria-label="Search order tracking"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter by customer, phone, order ID or card slug…"
        />
        <span className="tracking-hub-count">{filtered.length} active orders</span>
      </div>

      {error && <p className="store-order-notice is-error" role="alert">{error}</p>}

      {loading && !orders.length ? (
        <p className="empty">Loading card pipeline…</p>
      ) : !filtered.length ? (
        <p className="empty">No matching orders found.</p>
      ) : (
        <div className="admin-tracking-grid">
          <aside className="tracking-order-list" aria-label="Orders list">
            {filtered.map(order => {
              const isSelected = active?.id === order.id;
              return (
                <button
                  key={order.id}
                  type="button"
                  className={`tracking-order-item ${isSelected ? "is-selected" : ""}`}
                  onClick={() => setSelectedOrder(order.id)}
                >
                  <div className="order-item-header">
                    <strong>{order.customer.name}</strong>
                    <span className={`store-order-status ${order.status === "DELIVERED" ? "is-delivered" : "is-pending"}`}>
                      {statusLabels[order.status] ?? order.status}
                    </span>
                  </div>
                  <div className="order-item-meta">
                    <small>{order.customer.phone}</small>
                    <small>Order #{order.id.slice(0, 8)}</small>
                  </div>
                </button>
              );
            })}
          </aside>

          {active && (
            <div className="tracking-stage-detail">
              <div className="tracking-detail-card">
                <header className="tracking-detail-header">
                  <div>
                    <h3>{active.customer.name}</h3>
                    <p>{active.deliveryAddress.addressLine}, {active.deliveryAddress.district}</p>
                    <small>Order #{active.id} · {active.items.map(i => `${i.quantity}× ${i.name}`).join(", ")}</small>
                  </div>
                  <div className="tracking-detail-actions">
                    {active.status === "RECEIVED" && (
                      <button
                        className="button"
                        type="button"
                        disabled={Boolean(delivering)}
                        onClick={() => void updateFulfillment(active, "PROCESSING")}
                      >
                        Start processing
                      </button>
                    )}
                    {active.status === "PROCESSING" && (
                      <button
                        className="button"
                        type="button"
                        disabled={Boolean(delivering)}
                        onClick={() => {
                          const id = prompt("Enter courier tracking ID:");
                          if (id) void updateFulfillment(active, "SHIPPED", id);
                        }}
                      >
                        Ship with tracking ID
                      </button>
                    )}
                    {active.status === "SHIPPED" && (
                      <button
                        className="button"
                        type="button"
                        disabled={Boolean(delivering)}
                        onClick={() => void markDelivered(active)}
                      >
                        Confirm client delivery
                      </button>
                    )}
                  </div>
                </header>

                <OrderTrackingPipeline order={active} />

                {active.assignedCards?.length ? (
                  <div className="tracking-assigned-cards">
                    <strong>Assigned physical cards ({active.assignedCards.length})</strong>
                    <ul>
                      {active.assignedCards.map(c => (
                        <li key={c.id}>
                          <a href={c.canonicalUrl} target="_blank" rel="noreferrer">{c.publicSlug}</a>
                          <span> · QC: {c.qcStatus}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
