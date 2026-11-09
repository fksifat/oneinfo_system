import { OrderPrint } from "./OrderPrint.js";
import { OrderPacking } from "./OrderPacking.js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { bkashNumber, CodAdvanceSchema, shippingZoneLabels, type AdminOrderSearch, type OrderReceipt, type ShippingRates, type ShippingZone, type StoreCoupon, type StoreOrder } from "@oneinfo/contracts";
import { api } from "./api.js";
import { OrderTrackingPipeline } from "./OrderTrackingPipeline.js";

const zones: ShippingZone[] = ["insideDhaka", "subDhaka", "outsideDhaka"];
const money = new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT", currencyDisplay: "narrowSymbol" });
const bdt = (minor: number) => money.format(minor / 100);
const path = "/api/v1/orders";
const searchFields = ["payment", "delivery", "qr"] as const;
const needsPacking = (order: StoreOrder) => order.activationMethod === "ORDER_SECRET" ? !order.packedAt : Boolean(order.invoiceNumber && order.qrAllocation?.status !== "ASSIGNED");
const statusLabels = { AWAITING_PAYMENT: "Awaiting payment", CANCELLED: "Cancelled", RECEIVED: "Received", PROCESSING: "Processing", SHIPPED: "Shipped", DELIVERED: "Delivered" };

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && first && last) {
    return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase() || "CU";
}
export function Orders({ token, settingsOpen, onSettingsOpenChange }: { token: string; settingsOpen: boolean; onSettingsOpenChange: (open: boolean) => void }) {
  const params = new URLSearchParams(location.search);
  const requestedOrder = params.get("order");
  const requestedTask = params.get("task");
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<StoreOrder[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [supportsSearch, setSupportsSearch] = useState(false);
  const [rates, setRates] = useState<Record<ShippingZone, string>>();
  const [codAdvance, setCodAdvance] = useState<string>();
  const [paymentMessage, setPaymentMessage] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState<string>();
  const [delivering, setDelivering] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<AdminOrderSearch>(() => requestedOrder ? { query: requestedOrder } : {});
  const activeFilters = useRef(filters);
  const [saving, setSaving] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [ratesError, setRatesError] = useState("");

  const [message, setMessage] = useState("");
  const [orderMessage, setOrderMessage] = useState("");
  const [coupons, setCoupons] = useState<StoreCoupon[]>([]);
  const [couponCode, setCouponCode] = useState("");
  const [couponPercent, setCouponPercent] = useState("");
  const [couponActive, setCouponActive] = useState(true);
  const [savingCoupon, setSavingCoupon] = useState(false);
  const [couponError, setCouponError] = useState("");
  const [couponMessage, setCouponMessage] = useState("");

  function readOrders(filters: AdminOrderSearch, beforeId?: string) {
    type Page = { items: StoreOrder[]; hasMore: boolean; supportsSearch?: boolean };
    if (filters.query || filters.payment || filters.delivery || filters.qr) {
      return api<Page>(`${path}/admin`, token, { method: "POST", body: JSON.stringify({ ...filters, beforeId }) });
    }
    return api<Page>(`${path}/admin${beforeId ? `?beforeId=${encodeURIComponent(beforeId)}` : ""}`, token);
  }

  async function loadOrders(beforeId?: string, applied = filters) {
    setLoading(true);
    setOrderError("");
    try {
      const page = await readOrders(applied, beforeId);
      if (activeFilters.current !== applied) return;
      setItems(previous => beforeId ? [...previous, ...page.items] : page.items);
      setHasMore(page.hasMore);
      setSupportsSearch(Boolean(page.supportsSearch));
    } catch (error) {
      if (activeFilters.current === applied) setOrderError(error instanceof Error ? error.message : "Could not load orders.");
    } finally {
      if (activeFilters.current === applied) setLoading(false);
    }
  }

  async function loadRates() {
    setRatesError("");
    try {
      const { rates, codAdvanceTaka } = await api<{ rates: ShippingRates; codAdvanceTaka: number }>(`${path}/shipping`);
      setCodAdvance(String(CodAdvanceSchema.parse(codAdvanceTaka)));
      setRates({ insideDhaka: String(rates.insideDhaka / 100), subDhaka: String(rates.subDhaka / 100), outsideDhaka: String(rates.outsideDhaka / 100) });
    } catch {
      setRatesError("Could not load delivery rates.");
    }
  }

  useEffect(() => {
    void loadRates();
    void loadCoupons();
  }, [token]);
  useEffect(() => { void loadOrders(undefined, filters); }, [token, filters]);

  useEffect(() => {
    if (settingsOpen && settingsDialog.current && !settingsDialog.current.open) settingsDialog.current.showModal();
    else if (!settingsOpen && settingsDialog.current?.open) settingsDialog.current.close();
  }, [settingsOpen]);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    const sync = async () => {
      if (pending) return;
      pending = true;
      try {
        const updated: StoreOrder[] = [];
        let hasMore = true;
        while (hasMore && updated.length < Math.max(50, items.length)) {
          const page = await readOrders(filters, updated.at(-1)?.id);
          updated.push(...page.items); hasMore = page.hasMore;
          if (!disposed && activeFilters.current === filters) setSupportsSearch(Boolean(page.supportsSearch));
        }
        if (!disposed && activeFilters.current === filters) { setItems(updated); setHasMore(hasMore); }
      } catch (error) { if (!disposed) setOrderError(error instanceof Error ? error.message : "Order sync failed."); }
      finally { pending = false; }
    };
    const interval = window.setInterval(() => void sync(), 5000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [token, items.length, filters]);

  function searchOrders(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const selected = Object.fromEntries(searchFields.flatMap(field => data.get(field) ? [[field, data.get(field)]] : []));
    const next = { query: String(data.get("query") ?? "").trim(), ...selected };
    activeFilters.current = next;
    setItems([]); setHasMore(false); setFilters(next);
  }


  async function loadCoupons() {
    try {
      const { items } = await api<{ items: StoreCoupon[] }>(`${path}/admin/coupons`, token);
      setCoupons(items);
    } catch {
      setCouponError("Could not load coupons.");
    }
  }

  async function saveCoupon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingCoupon) return;
    setSavingCoupon(true);
    setCouponError("");
    setCouponMessage("");
    try {
      const coupon = await api<StoreCoupon>(`${path}/admin/coupons`, token, {
        method: "PUT",
        body: JSON.stringify({ code: couponCode.trim(), percent: Number(couponPercent), active: couponActive }),
      });
      setCoupons(previous => [...previous.filter(item => item.code !== coupon.code), coupon]
        .sort((a, b) => a.code.localeCompare(b.code)));
      setCouponCode("");
      setCouponPercent("");
      setCouponActive(true);
      setCouponMessage(`${coupon.code} saved.`);
    } catch (error) {
      setCouponError(error instanceof Error ? error.message : "Could not save coupon.");
    } finally {
      setSavingCoupon(false);
    }
  }

  async function saveRates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rates || saving) return;
    setSaving(true);
    setRatesError("");
    setMessage("");
    try {
      const values = {
        insideDhaka: Math.round(Number(rates.insideDhaka) * 100),
        subDhaka: Math.round(Number(rates.subDhaka) * 100),
        outsideDhaka: Math.round(Number(rates.outsideDhaka) * 100),
      };
      await api(`${path}/shipping`, token, { method: "PUT", body: JSON.stringify(values) });
      setMessage("Delivery rates saved.");
    } catch (error) {
      setRatesError(error instanceof Error ? error.message : "Could not save rates.");
    } finally {
      setSaving(false);
    }
  }

  async function savePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingPayment || !codAdvance?.trim()) return;
    setPaymentError("");
    setPaymentMessage("");
    setSavingPayment(true);
    try {
      await api(`${path}/admin/payment`, token, {
        method: "PUT",
        body: JSON.stringify({ codAdvanceTaka: CodAdvanceSchema.parse(Number(codAdvance)) }),
      });
      setPaymentMessage("COD advance saved.");
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Could not save payment settings.");
    } finally {
      setSavingPayment(false);
    }
  }

  async function verifyPayment(order: StoreOrder) {
    if (verifyingPayment || !order.transactionId || !order.paymentAmountMinor) return;
    if (!window.confirm(`Confirm you received ${bdt(order.paymentAmountMinor)} in bKash for transaction ${order.transactionId}.`)) return;
    setVerifyingPayment(order.id);
    setOrderError("");
    try {
      const updated = await api<OrderReceipt>(`${path}/admin/${order.id}/verify-payment`, token, { method: "POST" });
      setItems(previous => previous.map(item => item.id === order.id ? { ...item, ...updated } : item));
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : "Could not verify payment.");
    } finally {
      setVerifyingPayment(undefined);
    }
  }

  async function markDelivered(order: StoreOrder) {
    if (delivering) return;
    setDelivering(order.id); setOrderError(""); setOrderMessage("");
    try {
      const result = await api<{ delivered: boolean; invitation: string }>(`/api/v1/reviews/admin/orders/${order.id}/deliver`, token, { method: "POST" });
      setItems(previous => previous.map(item => item.id === order.id ? { ...item, status: "DELIVERED", deliveredAt: item.deliveredAt ?? new Date().toISOString(), ...(result.invitation === "sent" ? { reviewInviteSentAt: new Date().toISOString() } : {}) } : item));
      setOrderMessage(result.invitation === "sent" ? "Order marked delivered; review email sent." : result.invitation === "already-sent" ? "Order is delivered; review email was already sent." : "Order marked delivered. Review email could not be sent; use this action to retry.");
    } catch (error) { setOrderError(error instanceof Error ? error.message : "Could not mark order delivered."); }
    finally { setDelivering(undefined); }
  }

  async function updateFulfillment(order: StoreOrder, status: "PROCESSING" | "SHIPPED", trackingId?: string) {
    if (delivering) return;
    setDelivering(order.id); setOrderError(""); setOrderMessage("");
    try {
      const updated = await api<OrderReceipt & { shippingEmail?: string }>(`${path}/admin/${order.id}/fulfillment`, token,
        { method: "POST", body: JSON.stringify({ status, trackingId }) });
      setItems(previous => previous.map(item => item.id === order.id ? { ...item, ...updated } : item));
      setOrderMessage(updated.shippingEmail === "failed" ? "Shipping saved. The email could not be sent." : "Order status updated.");
    } catch (error) { setOrderError(error instanceof Error ? error.message : "Could not update order status."); }
    finally { setDelivering(undefined); }
  }

  async function saveCod(event: FormEvent<HTMLFormElement>, order: StoreOrder) {
    event.preventDefault();
    if (delivering) return;
    const data = new FormData(event.currentTarget);
    const input = { codCollectedMinor: Math.round(Number(data.get("collected")) * 100), codSettledMinor: Math.round(Number(data.get("settled")) * 100) };
    setDelivering(order.id); setOrderError(""); setOrderMessage("");
    try {
      const updated = await api<typeof input>(`${path}/admin/${order.id}/cod`, token, { method: "PUT", body: JSON.stringify(input) });
      setItems(previous => previous.map(item => item.id === order.id ? { ...item, ...updated } : item));
      setOrderMessage("COD collection and settlement saved.");
    } catch (error) { setOrderError(error instanceof Error ? error.message : "Could not save COD amounts."); }
    finally { setDelivering(undefined); }
  }

  return <div className="store-orders">
    <section className="panel store-orders-list">
      <div className="panel-head orders-panel-head">
        <div>
          <span className="eyebrow">ORDER FULFILLMENT</span>
          <h2>Received orders</h2>
          <p>Review customer orders, manage bKash verification, and track hardware dispatch.</p>
        </div>
        <button type="button" className="quiet" disabled={loading} onClick={() => void loadOrders()}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {supportsSearch && (
        <div className="orders-filter-container">
          <form className="order-filter-form" onSubmit={searchOrders}>
            <label className="filter-field filter-search">
              <span className="filter-label">Search orders</span>
              <div className="filter-input-wrap">
                <span className="filter-search-icon" aria-hidden="true">🔍</span>
                <input type="search" name="query" maxLength={254} defaultValue={requestedOrder ?? ""} placeholder="Invoice, order ID, phone or email…" />
              </div>
            </label>
            <label className="filter-field">
              <span className="filter-label">Payment</span>
              <select name="payment">
                <option value="">Any</option>
                <option value="PENDING_VERIFICATION">Pending verification</option>
                <option value="VERIFIED">Verified</option>
              </select>
            </label>
            <label className="filter-field">
              <span className="filter-label">Delivery</span>
              <select name="delivery">
                <option value="">Any</option>
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="filter-field">
              <span className="filter-label">QR allocation</span>
              <select name="qr">
                <option value="">Any</option>
                <option value="AWAITING_QR">No QR linked</option>
                <option value="PARTIAL">Partially assigned</option>
                <option value="ASSIGNED">Assigned</option>
              </select>
            </label>
            <div className="filter-submit-wrap">
              <button type="submit" className="button-filter-submit">Apply filters</button>
            </div>
          </form>
        </div>
      )}

      {orderError && <p className="store-order-notice is-error" role="alert">{orderError}</p>}
      {orderMessage && <p className="store-order-notice" role="status">{orderMessage}</p>}
      {!items.length && <p className="empty">{loading ? "Loading orders…" : "No orders received yet."}</p>}

      <div className="store-orders-stack">
        {items.map(order => <details className="store-order" key={order.id} open={requestedOrder === order.id || undefined}>
          <summary>
            <div className="store-order-summary-left">
              <span className="store-order-avatar" aria-hidden="true">{getInitials(order.customer.name)}</span>
              <span className="store-order-customer">
                <div className="store-order-title-row">
                  <strong>{order.customer.name}</strong>
                  {order.status !== "CANCELLED" && order.status !== "AWAITING_PAYMENT" && (
                    <span className={`order-qr-pill ${(order.activationMethod === "ORDER_SECRET" ? order.packedAt : order.qrAllocation?.status === "ASSIGNED") ? "is-assigned" : "is-pending"}`}>
                      <span className="order-qr-dot" aria-hidden="true"></span>
                      {order.activationMethod === "ORDER_SECRET" ? order.packedAt ? "Package confirmed" : "Awaiting package" : order.invoiceNumber ? needsPacking(order) ? "Awaiting packing" : "Cards packed" : order.qrAllocation?.status === "AWAITING_QR" ? "Awaiting QR" : order.qrAllocation?.status === "PARTIAL" ? "Partially assigned" : "QR assigned"} · {order.activationMethod === "ORDER_SECRET" && order.packedAt ? order.qrAllocation?.required ?? 0 : order.qrAllocation?.assigned ?? 0}/{order.qrAllocation?.required ?? 0}
                    </span>
                  )}
                </div>
                <small className="store-order-meta">
                  <span className="order-meta-phone">{order.customer.phone}</span>
                  <span className="order-meta-sep" aria-hidden="true">·</span>
                  <time className="order-meta-date">{new Date(order.createdAt).toLocaleString("en-BD", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" })}</time>
                </small>
              </span>
            </div>

            <span className="store-order-total">
              <strong className="order-price-val">{bdt(order.totalMinor)}</strong>
              <small className="order-badge-row">
                <span className="order-method-badge">{order.paymentMethod === "BKASH" ? "bKash" : "Cash on delivery"}</span>
                {order.paymentStatus === "PENDING_VERIFICATION" && <em className="store-order-status is-pending">Payment pending</em>}
                {order.paymentStatus === "VERIFIED" && <em className="store-order-status is-paid">Payment verified</em>}
                <em className={`store-order-status ${order.status === "DELIVERED" ? "is-delivered" : order.status === "CANCELLED" ? "is-cancelled" : "is-stage"}`}>{statusLabels[order.status]}</em>
              </small>
            </span>
          </summary>

          <div className="store-order-content">
            <div className="order-work-panels">
              {!order.invoiceNumber && <OrderPrint order={order} token={token} onChange={() => void loadOrders()}
                startCardId={requestedOrder === order.id ? params.get("card") : null} initiallyOpen={requestedOrder === order.id && requestedTask === "print"} />}
              <OrderPacking order={order} token={token} onChange={() => loadOrders()} initiallyOpen={Boolean(order.invoiceNumber) || (requestedOrder === order.id && requestedTask === "packing")} />
            </div>

            <OrderTrackingPipeline order={order} compact />

            <div className="order-info-cards">
              <div className="order-info-card">
                <div className="order-info-card-head">
                  <span className="order-card-icon" aria-hidden="true">🆔</span>
                  <h3>Card & Identity</h3>
                </div>
                <dl>
                  <div><dt>Order ID</dt><dd className="mono-code">{order.id}</dd></div>
                  {order.invoiceNumber && <div><dt>Invoice number</dt><dd className="mono-code">{order.invoiceNumber}</dd></div>}
                  <div><dt>QR allocation</dt><dd>{order.status === "CANCELLED" ? "Released" : order.status === "AWAITING_PAYMENT" ? "Starts after payment details are submitted"
                    : order.activationMethod === "ORDER_SECRET" ? "Card links to its temporary profile when the client activates it" : order.invoiceNumber ? needsPacking(order) ? "Pick ready stock and scan the cards while packing" : "Cards linked at packing"
                    : `${order.qrAllocation?.assigned ?? 0} assigned · ${order.qrAllocation?.pending ?? 0} awaiting printed stock`}</dd></div>
                  <div><dt>Client activation</dt><dd>{order.activationMethod === "ORDER_SECRET" ? "Include one private secret code per card. The client scans any unused card, enters the code, and completes their profile." : order.invoiceNumber ? "After delivery, scan the card, enter the invoice number and verify through the order email." : "The client claims ownership using their secret code and account."}</dd></div>
                  {order.assignedCards?.map(card => <div key={card.id}><dt>Assigned QR</dt><dd><a href={card.canonicalUrl} target="_blank" rel="noreferrer" className="order-slug-link">{card.publicSlug} ↗</a> <span className="qc-badge">QC {card.qcStatus}</span></dd></div>)}
                </dl>
              </div>

              <div className="order-info-card">
                <div className="order-info-card-head">
                  <span className="order-card-icon" aria-hidden="true">📍</span>
                  <h3>Recipient & Delivery</h3>
                </div>
                <dl>
                  <div><dt>Contact</dt><dd><strong>{order.customer.phone}</strong><br /><span className="order-contact-email">{order.customer.email}</span></dd></div>
                  <div><dt>Delivery address</dt><dd>{order.deliveryAddress.addressLine}<br />{order.deliveryAddress.district}{order.deliveryAddress.postalCode && ` ${order.deliveryAddress.postalCode}`}</dd></div>
                  <div><dt>Delivery zone</dt><dd>{shippingZoneLabels[order.shippingZone]} · {bdt(order.shippingMinor)}</dd></div>
                  {order.customer.note && <div><dt>Customer note</dt><dd className="order-note-bubble">{order.customer.note}</dd></div>}
                  {order.courierTrackingId && <div><dt>Courier tracking ID</dt><dd className="mono-code">{order.courierTrackingId}</dd></div>}
                  {order.trackingPath && <div><dt>Tracking page</dt><dd><a href={new URL(order.trackingPath, import.meta.env.VITE_STOREFRONT_URL || location.origin).href} target="_blank" rel="noreferrer" className="order-external-link">Open order tracking ↗</a></dd></div>}
                </dl>
              </div>

              <div className="order-info-card">
                <div className="order-info-card-head">
                  <span className="order-card-icon" aria-hidden="true">💳</span>
                  <h3>Financials & Settlement</h3>
                </div>
                <dl>
                  <div><dt>Payment method</dt><dd><strong>{order.paymentMethod === "BKASH" ? "bKash Digital" : "Cash on Delivery (COD)"}</strong></dd></div>
                  {order.transactionId && <div><dt>bKash transaction</dt><dd>{bdt(order.paymentAmountMinor ?? 0)} · <code className="mono-code">{order.transactionId}</code><br />
                    <span className={`order-status-badge ${order.paymentStatus === "VERIFIED" ? "is-verified" : "is-pending"}`}>{order.paymentStatus === "VERIFIED" ? "✓ Verified" : "⏳ Pending verification"}</span></dd></div>}
                  {order.transactionId && order.paymentMethod === "COD" && <div><dt>Due on delivery</dt>
                    <dd><strong>{bdt(order.totalMinor - (order.paymentAmountMinor ?? 0))}</strong></dd></div>}
                  {order.couponCode && <div><dt>Coupon discount</dt><dd className="coupon-tag">{order.couponCode} (−{bdt(order.discountMinor)})</dd></div>}
                  <div><dt>Total order value</dt><dd><strong className="order-final-price">{bdt(order.totalMinor)}</strong></dd></div>
                </dl>
              </div>
            </div>

            <div className="order-items-block">
              <div className="order-items-header">
                <span className="eyebrow">ORDER CONTENTS</span>
                <span className="order-items-badge">{order.items.reduce((sum, item) => sum + item.quantity, 0)} {order.items.length === 1 ? "card" : "cards"}</span>
              </div>
              <ul className="order-items-list">
                {order.items.map(item => (
                  <li key={`${item.productId}:${item.variantId}:${item.customization ? JSON.stringify(item.customization) : ""}`} className="order-item-row">
                    <span className="order-item-qty">{item.quantity}×</span>
                    <div className="order-item-details">
                      <strong className="order-item-title">{item.name}</strong>
                      <span className="order-item-variant">{item.variantName}</span>
                      {item.customization && (
                        <span className="order-item-customization" style={{ display: "block", fontSize: "0.78rem", color: "var(--accent, #9e7938)", marginTop: "3px" }}>
                          ✦ Custom: <strong>{item.customization.name}</strong>{item.customization.title ? ` · ${item.customization.title}` : ""} · Layout: {String(item.customization.layout || item.customization.position || "left").replace("-", " ")}{item.customization.surfaceMotif ? ` · Motif: ${item.customization.surfaceMotif}` : ""}{item.customization.accentColor ? ` · Foil: ${item.customization.accentColor}` : ""} ({item.customization.font || "sans"})
                        </span>
                      )}
                    </div>
                    <span className="order-item-amount">{bdt(item.unitPriceMinor * item.quantity)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="store-order-actions-bar">
              <div className="store-order-actions">
                {order.trackingPath && order.status === "RECEIVED" && (
                  <button className="button-action button-action-primary" type="button" disabled={Boolean(delivering)} onClick={() => void updateFulfillment(order, "PROCESSING")}>
                    <span aria-hidden="true">▶</span> Start processing
                  </button>
                )}
                {order.status !== "CANCELLED" && order.transactionId && order.paymentStatus === "PENDING_VERIFICATION" && (
                  <button className="button-action button-action-verify" type="button" disabled={Boolean(verifyingPayment)} onClick={() => void verifyPayment(order)}>
                    <span aria-hidden="true">✓</span> {verifyingPayment === order.id ? "Verifying…" : "Verify bKash payment"}
                  </button>
                )}
                {!["AWAITING_PAYMENT", "CANCELLED"].includes(order.status) && (
                  <button className="button-action button-action-delivered" type="button" disabled={Boolean(delivering) || Boolean(order.reviewInviteSentAt) || needsPacking(order)} onClick={() => void markDelivered(order)}>
                    <span aria-hidden="true">★</span> {delivering === order.id ? "Saving…" : order.reviewInviteSentAt ? "Review invitation sent" : order.deliveredAt ? "Retry review invitation" : "Mark delivered & invite review"}
                  </button>
                )}
              </div>

              {order.trackingPath && !["DELIVERED", "CANCELLED", "AWAITING_PAYMENT"].includes(order.status) && order.paymentStatus !== "PENDING_VERIFICATION" && (
                <form className="order-inline-action-form" onSubmit={event => {
                  event.preventDefault(); void updateFulfillment(order, "SHIPPED", String(new FormData(event.currentTarget).get("trackingId")));
                }}>
                  <label className="order-inline-field">
                    <span>Courier tracking ID</span>
                    <input name="trackingId" maxLength={100} required defaultValue={order.courierTrackingId ?? ""} placeholder="Tracking ID…" />
                  </label>
                  <button type="submit" className="button-action button-action-ship" disabled={Boolean(delivering) || needsPacking(order)}>
                    {order.status === "SHIPPED" ? "Update tracking ID" : "Mark shipped"}
                  </button>
                </form>
              )}

              {order.trackingPath && order.status === "DELIVERED" && order.paymentMethod === "COD" && (
                <form className="order-inline-action-form" onSubmit={event => void saveCod(event, order)}>
                  <label className="order-inline-field">
                    <span>Courier collected (৳)</span>
                    <input name="collected" type="number" min="0" step="0.01" required defaultValue={(order.codCollectedMinor ?? 0) / 100} />
                  </label>
                  <label className="order-inline-field">
                    <span>Courier settled (৳)</span>
                    <input name="settled" type="number" min="0" step="0.01" required defaultValue={(order.codSettledMinor ?? 0) / 100} />
                  </label>
                  <button type="submit" className="button-action button-action-cod" disabled={Boolean(delivering)}>Save COD amounts</button>
                </form>
              )}
            </div>

            {order.cancellationReason && <p className="order-cancellation-notice">Cancellation: {order.cancellationReason}</p>
            }

            {!["SHIPPED", "DELIVERED", "CANCELLED"].includes(order.status) && (
              <details className="order-cancel-fold">
                <summary>Cancel order and release stock</summary>
                <form className="order-cancel-form" onSubmit={event => {
                  event.preventDefault(); if (delivering) return;
                  const data = new FormData(event.currentTarget);
                  setDelivering(order.id); setOrderError("");
                  void api<OrderReceipt>(`${path}/admin/${order.id}/cancel`, token, { method: "POST", body: JSON.stringify({ reason: data.get("reason"), refundConfirmed: data.has("refundConfirmed"), cardsRecovered: data.has("cardsRecovered") }) })
                    .then(updated => setItems(previous => previous.map(item => item.id === order.id ? { ...item, ...updated, assignedCards: [] } : item)))
                    .catch(error => setOrderError(error.message)).finally(() => setDelivering(undefined));
                }}>
                  <label className="cancel-field-full">
                    <span>Cancellation reason</span>
                    <input name="reason" minLength={5} maxLength={500} required placeholder="Provide reason for customer and audit logs…" />
                  </label>
                  <label className="order-check-label">
                    <input type="checkbox" name="refundConfirmed" required={Boolean(order.transactionId)} />
                    <span>Payment checked and any refund resolved</span>
                  </label>
                  <label className="order-check-label">
                    <input type="checkbox" name="cardsRecovered" required={Boolean(order.invoiceNumber && order.assignedCards?.length)} />
                    <span>{order.invoiceNumber ? "All packed cards have been returned to stock" : "Any issued physical cards and secret codes have been recovered; invalidate those codes"}</span>
                  </label>
                  <button type="submit" className="button-cancel-order" disabled={Boolean(delivering)}>Cancel order</button>
                </form>
              </details>
            )}

            {order.trackingPath && <OrderEmailHistory orderId={order.id} token={token} />}
          </div>
        </details>)}
      </div>

      {hasMore && <div className="store-order-pagination"><button className="quiet" type="button" disabled={loading} onClick={() => void loadOrders(items.at(-1)?.id)}>{loading ? "Loading…" : "Load older orders"}</button></div>}
    </section>


    <dialog ref={settingsDialog} className="store-settings-dialog" onCancel={() => onSettingsOpenChange(false)} onClose={() => onSettingsOpenChange(false)} aria-labelledby="store-settings-title">
    <section className="panel store-order-settings" aria-label="Checkout settings">
      <header className="store-settings-heading"><h2 id="store-settings-title">Checkout settings</h2><button className="quiet" type="button" aria-label="Close checkout settings" onClick={() => settingsDialog.current?.close()}>×</button></header>
      <section className="store-settings-card">
        <div className="panel-head"><div><h2>Payment</h2><p>bKash {bkashNumber}</p></div></div>
        {codAdvance !== undefined && <form className="store-order-rates" onSubmit={savePayment}>
        <label>COD advance (BDT)<input type="number" min="0" max="10000" step="1" required value={codAdvance}
          onChange={event => setCodAdvance(event.target.value)} disabled={savingPayment} /></label>
        <button disabled={savingPayment}>{savingPayment ? "Saving…" : "Save payment settings"}</button>
      </form>}
        {paymentMessage && <p className="store-order-feedback" role="status">{paymentMessage}</p>}
        {paymentError && <p className="store-order-feedback is-error" role="alert">{paymentError}</p>}
      </section>
      <section className="store-settings-card">
        <div className="panel-head"><div><h2>Delivery rates</h2></div></div>
        {rates ? <form className="store-order-rates store-delivery-rates" onSubmit={saveRates}>
        {zones.map(zone => <label key={zone}>{shippingZoneLabels[zone]}
          <input type="number" required min="0" max="10000" step="0.01" value={rates[zone]}
            onChange={event => setRates({ ...rates, [zone]: event.target.value })} disabled={saving} />
        </label>)}
        <button disabled={saving}>{saving ? "Saving…" : "Save rates"}</button>
      </form> : <button type="button" onClick={() => void loadRates()}>Load rates</button>}
        {message && <p className="store-order-feedback" role="status">{message}</p>}
        {ratesError && <p className="store-order-feedback is-error" role="alert">{ratesError}</p>}
      </section>
      <section className="store-settings-card">
        <div className="panel-head"><div><h2>Coupons</h2></div></div>
        <form className="store-order-rates store-coupon-form" onSubmit={saveCoupon}>

        <label>Coupon code<input required value={couponCode} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_\-]{2,31}"
          onChange={event => setCouponCode(event.target.value.toUpperCase())} disabled={savingCoupon} /></label>
        <label>Discount (%)<input required type="number" min="1" max="100" value={couponPercent}
          onChange={event => setCouponPercent(event.target.value)} disabled={savingCoupon} /></label>
        <label className="store-coupon-active"><input type="checkbox" checked={couponActive}
          onChange={event => setCouponActive(event.target.checked)} disabled={savingCoupon} /> Active</label>
        <button disabled={savingCoupon}>{savingCoupon ? "Saving…" : "Save coupon"}</button>
      </form>
        {couponMessage && <p className="store-order-feedback" role="status">{couponMessage}</p>}
        {couponError && <p className="store-order-feedback is-error" role="alert">{couponError} <button type="button" className="quiet" onClick={() => { setCouponError(""); void loadCoupons(); }}>Reload coupons</button></p>}
        <div className="store-coupon-list">{coupons.map(coupon => <div className="store-coupon-row" key={coupon.code}>
        <span><strong>{coupon.code}</strong> · {coupon.percent}% · {coupon.active ? "Active" : "Inactive"}</span>
        <button type="button" className="quiet" disabled={savingCoupon} onClick={() => {
          setCouponCode(coupon.code);
          setCouponPercent(String(coupon.percent));
          setCouponActive(coupon.active);
          setCouponMessage("");
        }}>Edit {coupon.code}</button>
      </div>)}</div>
    </section>

    </section>
    </dialog>
  </div>;
}

type EmailAttempt = { id: string; kind: "confirmation" | "payment" | "shipping" | "delivery"; status: "accepted" | "failed" | "pending" | "sending"; createdAt: string };

function OrderEmailHistory({ orderId, token }: { orderId: string; token: string }) {
  const [items, setItems] = useState<EmailAttempt[]>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const endpoint = `${path}/admin/${orderId}/emails`;

  async function refresh(kind?: EmailAttempt["kind"]) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      if (kind === "delivery") await api(`/api/v1/reviews/admin/orders/${orderId}/deliver`, token, { method: "POST" });
      else if (kind) await api(`${endpoint}/retry`, token, { method: "POST", body: JSON.stringify({ kind }) });
      const page = await api<{ items: EmailAttempt[] }>(endpoint, token);
      setItems(page.items);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load email history."); }
    finally { setBusy(false); }
  }

  return <div className="order-email-history">
    <button type="button" className="quiet" disabled={busy} onClick={() => void refresh()}>{items ? "Refresh email history" : "Show email history"}</button>
    {message && <p role="alert">{message}</p>}
    {items?.length === 0 && <p>No email attempts recorded for this order.</p>}
    {!!items?.length && <ul>{items.map((item, index) => <li key={item.id}>
      {item.kind} · {item.status === "accepted" ? "Accepted by email service" : item.status === "failed" ? "Send failed or interrupted" : item.status === "pending" ? "Queued" : "Sending"} · {new Date(item.createdAt).toLocaleString()}
      {item.status === "failed" && items.findIndex(attempt => attempt.kind === item.kind) === index &&
        <button type="button" className="quiet" disabled={busy} onClick={() => void refresh(item.kind)}>Retry {item.kind}</button>}
    </li>)}</ul>}
  </div>;
}

