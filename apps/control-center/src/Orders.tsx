import { OrderPrint } from "./OrderPrint.js";
import { OrderPacking } from "./OrderPacking.js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { bkashNumber, CodAdvanceSchema, shippingZoneLabels, type AdminOrderSearch, type OrderReceipt, type ShippingRates, type ShippingZone, type StoreCoupon, type StoreOrder } from "@oneinfo/contracts";
import { api, productMediaUrl } from "./api.js";
import { downloadOrderEps } from "./eps-generator.js";
import { AdminCardPreview } from "./AdminCardPreview.js";

const zones: ShippingZone[] = ["insideDhaka", "subDhaka", "outsideDhaka"];
const money = new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT", currencyDisplay: "narrowSymbol" });
const bdt = (minor: number) => money.format(minor / 100);
const path = "/api/v1/orders";
const searchFields = ["payment", "delivery", "qr"] as const;
const needsPacking = (order: StoreOrder) => order.activationMethod === "ORDER_SECRET" ? !order.packedAt : Boolean(order.invoiceNumber && order.qrAllocation?.status !== "ASSIGNED");
const statusLabels = { AWAITING_PAYMENT: "Awaiting payment", CANCELLED: "Cancelled", RECEIVED: "Received", PROCESSING: "Processing", SHIPPED: "Shipped", DELIVERED: "Delivered" };
const orderStages = [
  { id: "payment", label: "Received", title: "Order received" },
  { id: "processing", label: "Processing", title: "Order processing" },
  { id: "shipping", label: "Shipped", title: "Courier handoff" },
  { id: "delivery", label: "Delivered", title: "Delivery confirmation" },
] as const;
type OrderStage = typeof orderStages[number]["id"];

function nextOrderStage(order: StoreOrder): OrderStage {
  if (order.status === "CANCELLED" || order.status === "AWAITING_PAYMENT" || order.paymentStatus === "PENDING_VERIFICATION") return "payment";
  if (order.status === "SHIPPED" || order.status === "DELIVERED") return "delivery";
  if (needsPacking(order) || order.qrAllocation?.status === "AWAITING_QR" && !order.invoiceNumber) return "processing";
  return order.status === "RECEIVED" ? "processing" : "shipping";
}

const orderDate = new Intl.DateTimeFormat("en-BD", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" });
const codBalance = (order: StoreOrder) => Math.max(0, order.totalMinor - (order.paymentStatus === "VERIFIED" ? order.paymentAmountMinor ?? 0 : 0));

export function Orders({ token, settingsOpen, onSettingsOpenChange, customOnly: initialCustomOnly = false }: { token: string; settingsOpen: boolean; onSettingsOpenChange: (open: boolean) => void; customOnly?: boolean }) {
  const params = new URLSearchParams(location.search);
  const requestedOrder = params.get("order");
  const requestedTask = params.get("task");
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const orderDialog = useRef<HTMLDialogElement>(null);
  const deepLinkOpened = useRef<string | null>(null);
  const listVersion = useRef(0);
  const [selectedOrder, setSelectedOrder] = useState<StoreOrder>();
  const [refreshingOrder, setRefreshingOrder] = useState(false);
  const [detailError, setDetailError] = useState<{ id: string; text: string }>();
  const [cancelError, setCancelError] = useState<{ id: string; text: string }>();
  const [items, setItems] = useState<StoreOrder[]>([]);
  const [showCustomOnly, setShowCustomOnly] = useState(initialCustomOnly);

  useEffect(() => {
    setShowCustomOnly(initialCustomOnly);
  }, [initialCustomOnly]);
  const [hasMore, setHasMore] = useState(false);
  const [supportsSearch, setSupportsSearch] = useState(false);
  const [rates, setRates] = useState<Record<ShippingZone, string>>();
  const [codAdvance, setCodAdvance] = useState<string>();
  const [codAdvanceInsideDhaka, setCodAdvanceInsideDhaka] = useState(true);
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
  const [selectedStages, setSelectedStages] = useState<Partial<Record<string, OrderStage>>>({});
  const [actionNotice, setActionNotice] = useState<{ orderId: string; stage: OrderStage; text: string; error?: boolean }>();
  const [ratesError, setRatesError] = useState("");

  const [message, setMessage] = useState("");
  const [coupons, setCoupons] = useState<StoreCoupon[]>([]);
  const [couponCode, setCouponCode] = useState("");
  const [couponPercent, setCouponPercent] = useState("");
  const [couponActive, setCouponActive] = useState(true);
  const [savingCoupon, setSavingCoupon] = useState(false);
  const [couponError, setCouponError] = useState("");
  const [couponMessage, setCouponMessage] = useState("");

  function selectStage(orderId: string, stage: OrderStage) {
    setSelectedStages(previous => ({ ...previous, [orderId]: stage }));
  }

  function readOrders(filters: AdminOrderSearch, beforeId?: string) {
    type Page = { items: StoreOrder[]; hasMore: boolean; supportsSearch?: boolean };
    if (filters.query || filters.payment || filters.delivery || filters.qr) {
      return api<Page>(`${path}/admin`, token, { method: "POST", body: JSON.stringify({ ...filters, beforeId }) });
    }
    return api<Page>(`${path}/admin${beforeId ? `?beforeId=${encodeURIComponent(beforeId)}` : ""}`, token);
  }

  async function loadOrders(beforeId?: string, applied = filters) {
    const version = ++listVersion.current;
    const isCurrent = () => activeFilters.current === applied && listVersion.current === version;
    setLoading(true);
    setOrderError("");
    try {
      const page = await readOrders(applied, beforeId);
      if (!isCurrent()) return;
      setItems(previous => beforeId ? [...previous, ...page.items.filter(order => !previous.some(item => item.id === order.id))] : page.items);
      setHasMore(page.hasMore);
      setSupportsSearch(Boolean(page.supportsSearch));
    } catch (error) {
      if (isCurrent()) setOrderError(error instanceof Error ? error.message : "Could not load orders.");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }

  async function loadRates() {
    setRatesError("");
    try {
      const { rates, codAdvanceTaka, codAdvanceInsideDhaka } = await api<{
        rates: ShippingRates;
        codAdvanceTaka: number;
        codAdvanceInsideDhaka?: boolean;
      }>(`${path}/shipping`);
      setCodAdvance(String(CodAdvanceSchema.parse(codAdvanceTaka)));
      setCodAdvanceInsideDhaka(codAdvanceInsideDhaka !== false);
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
    if (!requestedOrder || deepLinkOpened.current === requestedOrder) return;
    const order = items.find(item => item.id === requestedOrder);
    if (order) {
      deepLinkOpened.current = requestedOrder;
      setSelectedOrder(order);
    }
  }, [items, requestedOrder]);

  const selectedOrderId = selectedOrder?.id;
  useEffect(() => {
    if (selectedOrderId && orderDialog.current && !orderDialog.current.open) orderDialog.current.showModal();
  }, [selectedOrderId]);

  useEffect(() => {
    if (selectedOrderId || loading) return;
    let disposed = false;
    let pending = false;
    const sync = async () => {
      if (pending) return;
      pending = true;
      const version = listVersion.current;
      const isCurrent = () => !disposed && activeFilters.current === filters && listVersion.current === version;
      try {
        const updated: StoreOrder[] = [];
        let hasMore = true;
        while (isCurrent() && hasMore && updated.length < Math.max(50, items.length)) {
          const cursor = updated.at(-1)?.id;
          const page = await readOrders(filters, cursor);
          if (isCurrent()) setSupportsSearch(Boolean(page.supportsSearch));
          if (!page.items.length || page.items.at(-1)?.id === cursor) { hasMore = false; break; }
          updated.push(...page.items); hasMore = page.hasMore;
        }
        if (isCurrent()) { setItems(updated); setHasMore(hasMore); setOrderError(""); }
      } catch (error) { if (isCurrent()) setOrderError(error instanceof Error ? error.message : "Order sync failed."); }
      finally { pending = false; }
    };
    const interval = window.setInterval(() => void sync(), 5000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [token, items.length, filters, selectedOrderId, loading]);

  function updateOrder(id: string, apply: (order: StoreOrder) => StoreOrder) {
    setItems(previous => previous.map(order => order.id === id ? apply(order) : order));
    setSelectedOrder(previous => previous?.id === id ? apply(previous) : previous);
  }

  function closeOrder() {
    setSelectedOrder(undefined);
    orderDialog.current?.close();
  }

  async function refreshOrder(id: string) {
    setRefreshingOrder(true);
    setDetailError(undefined);
    try {
      const page = await readOrders({ query: id });
      const refreshed = page.items.find(order => order.id === id);
      if (!refreshed) throw new Error("Order not found. Return to the list and refresh.");
      updateOrder(id, () => refreshed);
    } catch (error) {
      setDetailError({ id, text: error instanceof Error ? error.message : "Could not refresh the order." });
    } finally { setRefreshingOrder(false); }
  }

  function searchOrders(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const selected = Object.fromEntries(searchFields.flatMap(field => data.get(field) ? [[field, data.get(field)]] : []));
    const next = { query: String(data.get("query") ?? "").trim(), ...selected };
    applyFilters(next);
  }

  function applyFilters(next: AdminOrderSearch) {
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
        body: JSON.stringify({
          codAdvanceTaka: CodAdvanceSchema.parse(Number(codAdvance)),
          codAdvanceInsideDhaka,
        }),
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
    selectStage(order.id, "payment");
    setVerifyingPayment(order.id);
    setActionNotice(undefined);
    try {
      const updated = await api<OrderReceipt>(`${path}/admin/${order.id}/verify-payment`, token, { method: "POST" });
      updateOrder(order.id, item => ({ ...item, ...updated }));
      setActionNotice({ orderId: order.id, stage: "payment", text: "bKash payment verified." });
    } catch (error) {
      setActionNotice({ orderId: order.id, stage: "payment", text: error instanceof Error ? error.message : "Could not verify payment.", error: true });
    } finally {
      setVerifyingPayment(undefined);
    }
  }

  async function markDelivered(order: StoreOrder) {
    if (delivering) return;
    selectStage(order.id, "delivery");
    setDelivering(order.id); setActionNotice(undefined);
    try {
      const result = await api<{ delivered: boolean; invitation: string }>(`/api/v1/reviews/admin/orders/${order.id}/deliver`, token, { method: "POST" });
      const now = new Date().toISOString();
      updateOrder(order.id, item => ({ ...item, status: "DELIVERED", deliveredAt: item.deliveredAt ?? now, ...(["sent", "already-sent"].includes(result.invitation) ? { reviewInviteSentAt: item.reviewInviteSentAt ?? now } : {}) }));
      setActionNotice({ orderId: order.id, stage: "delivery", text: result.invitation === "sent" ? "Order marked delivered and review email sent." : result.invitation === "already-sent" ? "The review email was already sent." : "Order marked delivered. Use Retry review invitation to send the email again." });
    } catch (error) { setActionNotice({ orderId: order.id, stage: "delivery", text: error instanceof Error ? error.message : "Could not mark order delivered.", error: true }); }
    finally { setDelivering(undefined); }
  }

  async function updateFulfillment(order: StoreOrder, status: "PROCESSING" | "SHIPPED", trackingId?: string) {
    if (delivering) return;
    const stage = status === "PROCESSING" ? "processing" : "shipping";
    selectStage(order.id, stage);
    setDelivering(order.id); setActionNotice(undefined);
    try {
      const updated = await api<OrderReceipt & { shippingEmail?: string }>(`${path}/admin/${order.id}/fulfillment`, token,
        { method: "POST", body: JSON.stringify({ status, trackingId }) });
      updateOrder(order.id, item => ({ ...item, ...updated }));
      setActionNotice({ orderId: order.id, stage, text: updated.shippingEmail === "failed" ? "Shipping saved. The email could not be sent." : "Order status updated." });
    } catch (error) { setActionNotice({ orderId: order.id, stage, text: error instanceof Error ? error.message : "Could not update order status.", error: true }); }
    finally { setDelivering(undefined); }
  }

  async function saveCod(event: FormEvent<HTMLFormElement>, order: StoreOrder) {
    event.preventDefault();
    if (delivering) return;
    const data = new FormData(event.currentTarget);
    const input = { codCollectedMinor: Math.round(Number(data.get("collected")) * 100), codSettledMinor: Math.round(Number(data.get("settled")) * 100) };
    if (input.codSettledMinor > input.codCollectedMinor || input.codCollectedMinor > codBalance(order)) {
      setActionNotice({ orderId: order.id, stage: "delivery", text: "Settlement cannot exceed collection. Collection cannot exceed the remaining order balance.", error: true });
      return;
    }
    setDelivering(order.id); setActionNotice(undefined);
    try {
      const updated = await api<typeof input>(`${path}/admin/${order.id}/cod`, token, { method: "PUT", body: JSON.stringify(input) });
      updateOrder(order.id, item => ({ ...item, ...updated }));
      setActionNotice({ orderId: order.id, stage: "delivery", text: "COD collection and settlement saved." });
    } catch (error) { setActionNotice({ orderId: order.id, stage: "delivery", text: error instanceof Error ? error.message : "Could not save COD amounts.", error: true }); }
    finally { setDelivering(undefined); }
  }

  const displayedItems = showCustomOnly ? items.filter(order => order.items.some(item => Boolean(item.customization))) : items;
  const filtered = Boolean(filters.query || filters.payment || filters.delivery || filters.qr);

  return <div className="store-orders">
    <section className="panel store-orders-list" aria-label="Order list">
      <div className="orders-panel-head">
        <div className="orders-scope-tabs" role="group" aria-label="Order type">
          <button type="button" aria-pressed={!showCustomOnly} onClick={() => setShowCustomOnly(false)}>All orders</button>
          <button type="button" aria-pressed={showCustomOnly} onClick={() => setShowCustomOnly(true)}>Custom orders</button>
        </div>
        <button type="button" className="quiet" disabled={loading} onClick={() => void loadOrders()}>
          {loading ? "Refreshing…" : "Refresh orders"}
        </button>
      </div>

      {supportsSearch && (
        <div className="orders-filter-container">
          <form className="order-filter-form" key={JSON.stringify(filters)} onSubmit={searchOrders}>
            <label className="filter-field filter-search">
              <span className="filter-label">Search orders</span>
              <input type="search" name="query" maxLength={254} defaultValue={filters.query ?? ""} placeholder="Invoice, order ID, phone or email" />
            </label>
            <label className="filter-field">
              <span className="filter-label">Payment</span>
              <select name="payment" defaultValue={filters.payment ?? ""}>
                <option value="">Any</option>
                <option value="PENDING_VERIFICATION">Pending verification</option>
                <option value="VERIFIED">Verified</option>
              </select>
            </label>
            <label className="filter-field">
              <span className="filter-label">Delivery</span>
              <select name="delivery" defaultValue={filters.delivery ?? ""}>
                <option value="">Any</option>
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="filter-field">
              <span className="filter-label">QR allocation</span>
              <select name="qr" defaultValue={filters.qr ?? ""}>
                <option value="">Any</option>
                <option value="AWAITING_QR">No QR linked</option>
                <option value="PARTIAL">Partially assigned</option>
                <option value="ASSIGNED">Assigned</option>
              </select>
            </label>
            <div className="filter-submit-wrap">
              <button type="submit" className="button-filter-submit">Search</button>
              {filtered && <button type="button" className="quiet" onClick={() => applyFilters({})}>Clear</button>}
            </div>
          </form>
        </div>
      )}

      {orderError && <p className="store-order-notice is-error" role="alert">{orderError}</p>}
      {!displayedItems.length && !orderError && (
        <p className="empty" role="status">{loading ? "Loading orders…" : filtered ? "No orders match these filters." : showCustomOnly ? "No custom orders on this page." : "No orders received yet."}</p>
      )}

      <div className="store-orders-stack">
        {displayedItems.map(order => (
          <button
            type="button"
            className="store-order"
            data-order-id={order.id}
            key={order.id}
            aria-haspopup="dialog"
            onClick={event => {
              event.currentTarget.focus();
              setDetailError(undefined);
              setCancelError(undefined);
              setActionNotice(undefined);
              setSelectedOrder(order);
            }}
          >
            <span className="store-order-customer">
              <strong>{order.customer.name}</strong>
              <span className="store-order-meta">
                {order.invoiceNumber && <span>{order.invoiceNumber}</span>}
                <time dateTime={order.createdAt}>{orderDate.format(new Date(order.createdAt))}</time>
              </span>
            </span>
            <span className="store-order-total">
              <strong className="order-price-val">{bdt(order.totalMinor)}</strong>
              <span className="store-order-status" data-status={order.status}>{statusLabels[order.status]}</span>
              {order.paymentStatus === "PENDING_VERIFICATION" && order.status !== "CANCELLED" &&
                <span className="order-payment-note">Verify payment</span>}
            </span>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        ))}
      </div>

      {hasMore && <div className="store-order-pagination"><button className="quiet" type="button" disabled={loading} onClick={() => void loadOrders(items.at(-1)?.id)}>{loading ? "Loading…" : "Load older orders"}</button></div>}
    </section>

    <dialog
      ref={orderDialog}
      className="store-order-dialog"
      aria-labelledby="store-order-dialog-title"
      onCancel={event => { event.preventDefault(); closeOrder(); }}
    >
      {selectedOrder && (() => {
        const order = selectedOrder;
          const deepLink = requestedOrder === order.id ? requestedTask : null;
          const packingLink = deepLink === "print" || deepLink === "packing";
          const stage = selectedStages[order.id] ?? (packingLink ? "processing" : deepLink === "payment" ? "payment" : nextOrderStage(order));
          const actionId = `order-actions-${order.id}`;
          const closed = order.status === "CANCELLED" || order.status === "AWAITING_PAYMENT";
          const paid = order.paymentStatus !== "PENDING_VERIFICATION";
          const notice = actionNotice?.orderId === order.id && actionNotice.stage === stage ? actionNotice : undefined;
          const chooseStage = (value: OrderStage) => {
            selectStage(order.id, value);
            requestAnimationFrame(() => document.getElementById(actionId)?.focus({ preventScroll: true }));
          };
          const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
          const busy = Boolean(delivering || verifyingPayment || refreshingOrder);
          return <>
            <header className="store-order-dialog-header">
              <div>
                <h2 id="store-order-dialog-title">{order.customer.name}</h2>
                <p>{order.invoiceNumber ?? orderDate.format(new Date(order.createdAt))} · {statusLabels[order.status]} · {bdt(order.totalMinor)}</p>
              </div>
              <button type="button" className="quiet" aria-label="Close order" onClick={closeOrder}>×</button>
            </header>
            <div className="store-order-content">
              <div className="store-order-dialog-tools">
                {order.invoicePath && <a className="quiet" href={new URL(order.invoicePath, import.meta.env.VITE_STOREFRONT_URL || "http://127.0.0.1:5175").href} target="_blank" rel="noreferrer">View invoice</a>}
                <button type="button" className="quiet" disabled={busy} onClick={() => void refreshOrder(order.id)}>{refreshingOrder ? "Refreshing…" : "Refresh order"}</button>
              </div>
              {detailError?.id === order.id && <p className="store-order-notice is-error" role="alert">{detailError.text}</p>}
              <div className="order-stage-nav" role="group" aria-label="Order stages">
                {orderStages.map(({ id, label }) => <button key={id} type="button" aria-controls={actionId}
                  aria-pressed={stage === id} onClick={() => chooseStage(id)}>{label}</button>)}
              </div>

              <section className="store-order-actions-bar order-stage-actions" id={actionId} tabIndex={-1} aria-labelledby={`${actionId}-title`}>
                <h3 id={`${actionId}-title`}>{orderStages.find(item => item.id === stage)?.title}</h3>
                {notice && <p className={`store-order-notice${notice.error ? " is-error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
                {closed && <p>{order.status === "CANCELLED" ? "This order was cancelled." : "Waiting for the customer to submit payment details."}</p>}
                {stage === "payment" && !closed && (paid ? <p>{order.paymentStatus === "VERIFIED" ? "bKash payment is verified." : "Order received. No advance payment is required."}</p>
                  : <p>Check the bKash transaction before verifying payment.</p>)}
                {stage === "processing" && !closed && order.status !== "RECEIVED" && <p>{order.status === "SHIPPED" || order.status === "DELIVERED" ? "The order has left packing." : "Processing started."}</p>}
                {(stage === "shipping" || stage === "delivery") && !closed && order.status !== "DELIVERED" && (!paid || needsPacking(order)) && (
                  <p>{!paid ? "Verify bKash payment before continuing." : "Confirm packing before continuing."} <button type="button" className="button-action button-action-primary"
                    onClick={() => chooseStage(paid ? "processing" : "payment")}>{paid ? "Open packing checklist" : "Open payment verification"}</button></p>
                )}
                {stage === "shipping" && order.status === "DELIVERED" && <p>{order.courierTrackingId ? `Courier tracking ID ${order.courierTrackingId}` : "This order was delivered."}</p>}
                <div className="store-order-actions">
                  {stage === "processing" && order.trackingPath && order.status === "RECEIVED" && (
                    <button className="button-action button-action-primary" type="button" disabled={busy} onClick={() => void updateFulfillment(order, "PROCESSING")}>
                      <span aria-hidden="true">▶</span> Start processing
                    </button>
                  )}
                  {stage === "payment" && !closed && order.transactionId && !paid && (
                    <button className="button-action button-action-verify" type="button" disabled={busy} onClick={() => void verifyPayment(order)}>
                      <span aria-hidden="true">✓</span> {verifyingPayment === order.id ? "Verifying…" : "Verify bKash payment"}
                    </button>
                  )}
                  {stage === "delivery" && !closed && (order.status === "DELIVERED" || paid && !needsPacking(order)) && (
                    <button className="button-action button-action-delivered" type="button" disabled={busy || Boolean(order.reviewInviteSentAt)} onClick={() => void markDelivered(order)}>
                      <span aria-hidden="true">★</span> {delivering === order.id ? "Saving…" : order.reviewInviteSentAt ? "Review invitation sent" : order.deliveredAt ? "Retry review invitation" : "Mark delivered & invite review"}
                    </button>
                  )}
                </div>
                <div className="order-work-panels" hidden={stage !== "processing" || closed}>
                  {!order.invoiceNumber && <OrderPrint order={order} token={token} onChange={() => void refreshOrder(order.id)}
                    startCardId={deepLink === "print" ? params.get("card") : null} initiallyOpen />}
                  <OrderPacking order={order} token={token} onChange={() => refreshOrder(order.id)} initiallyOpen />
                </div>

                {stage === "shipping" && order.trackingPath && !closed && order.status !== "DELIVERED" && paid && !needsPacking(order) && (
                  <form className="order-inline-action-form" onSubmit={event => {
                    event.preventDefault(); void updateFulfillment(order, "SHIPPED", String(new FormData(event.currentTarget).get("trackingId")));
                  }}>
                    <label className="order-inline-field">
                      <span>Courier tracking ID</span>
                      <input name="trackingId" maxLength={100} required defaultValue={order.courierTrackingId ?? ""} placeholder="Tracking ID…" />
                    </label>
                    <button type="submit" className="button-action button-action-ship" disabled={busy}>
                      {order.status === "SHIPPED" ? "Update tracking ID" : "Mark shipped"}
                    </button>
                  </form>
                )}

                {stage === "delivery" && order.trackingPath && order.status === "DELIVERED" && order.paymentMethod === "COD" && (
                  <form className="order-inline-action-form" onSubmit={event => void saveCod(event, order)}>
                    <label className="order-inline-field">
                      <span>Courier collected (৳)</span>
                      <input name="collected" type="number" min="0" step="0.01" required defaultValue={(order.codCollectedMinor ?? 0) / 100} />
                    </label>
                    <label className="order-inline-field">
                      <span>Courier settled (৳)</span>
                      <input name="settled" type="number" min="0" step="0.01" required defaultValue={(order.codSettledMinor ?? 0) / 100} />
                    </label>
                    <button type="submit" className="button-action button-action-cod" disabled={busy}>Save COD amounts</button>
                  </form>
                )}
              </section>

              <div className="order-info-cards">
                <div className="order-info-card">
                  <div className="order-info-card-head">
                    <h3>Delivery details</h3>
                  </div>
                  <dl>
                    <div><dt>Contact</dt><dd><strong>{order.customer.phone}</strong><br /><span className="order-contact-email">{order.customer.email}</span></dd></div>
                    <div><dt>Delivery address</dt><dd>{order.deliveryAddress.addressLine}<br />{order.deliveryAddress.district}{order.deliveryAddress.postalCode && ` ${order.deliveryAddress.postalCode}`}</dd></div>
                    <div><dt>Delivery zone</dt><dd>{shippingZoneLabels[order.shippingZone]} · {bdt(order.shippingMinor)}</dd></div>
                    {order.customer.note && <div><dt>Customer note</dt><dd className="order-note-bubble">{order.customer.note}</dd></div>}
                    {order.courierTrackingId && <div><dt>Courier tracking ID</dt><dd className="mono-code">{order.courierTrackingId}</dd></div>}
                  </dl>
                  {order.trackingPath && <a href={new URL(order.trackingPath, import.meta.env.VITE_STOREFRONT_URL || location.origin).href} target="_blank" rel="noreferrer" className="order-external-link">Open order tracking ↗</a>}
                </div>

                <div className="order-info-card">
                  <div className="order-info-card-head">
                    <h3>Payment summary</h3>
                  </div>
                  <dl>
                    <div><dt>Payment method</dt><dd><strong>{order.paymentMethod === "BKASH" ? "bKash Digital" : "Cash on Delivery (COD)"}</strong></dd></div>
                    {order.transactionId && <div><dt>bKash transaction</dt><dd>{bdt(order.paymentAmountMinor ?? 0)} · <code className="mono-code">{order.transactionId}</code><br />
                      <span className={`order-status-badge ${order.paymentStatus === "VERIFIED" ? "is-verified" : "is-pending"}`}>{order.paymentStatus === "VERIFIED" ? "✓ Verified" : "⏳ Pending verification"}</span></dd></div>}
                    {order.transactionId && order.paymentMethod === "COD" && <div><dt>Due on delivery</dt>
                      <dd><strong>{bdt(codBalance(order))}</strong></dd></div>}
                    {order.couponCode && <div><dt>Coupon discount</dt><dd className="coupon-tag">{order.couponCode} (−{bdt(order.discountMinor)})</dd></div>}
                    <div><dt>Total order value</dt><dd><strong className="order-final-price">{bdt(order.totalMinor)}</strong></dd></div>
                  </dl>
                </div>
              </div>

              <div className="order-items-block">
                <div className="order-items-header">
                  <h3>Items</h3>
                  <span className="order-items-badge">{quantity} {quantity === 1 ? "card" : "cards"}</span>
                </div>
                <ul className="order-items-list">
                  {order.items.map(item => (
                    <li key={`${item.productId}:${item.variantId}:${item.customization ? JSON.stringify(item.customization) : ""}`} className="order-item-row">
                      <span className="order-item-qty">{item.quantity}×</span>
                      <div className="order-item-details">
                        <strong className="order-item-title">{item.name}</strong>
                        <span className="order-item-variant">{item.variantName}</span>
                        {item.customization && (
                          <div className="order-item-custom-card-panel" style={{ marginTop: "10px", padding: "12px 14px", background: "rgba(201, 147, 62, 0.05)", border: "1px solid rgba(201, 147, 62, 0.28)", borderRadius: "10px" }}>
                            {/* Visual Card Preview matching customer storefront personalization */}
                            <AdminCardPreview custom={item.customization} customerName={order.customer.name} />

                            <span className="order-item-customization" style={{ display: "block", fontSize: "0.82rem", color: "var(--accent, #c9933e)", lineHeight: 1.45, marginTop: "8px" }}>
                              <strong>Bespoke Edition</strong>: <strong>{item.customization.name}</strong>{item.customization.title ? ` · ${item.customization.title}` : ""}
                              {item.customization.extraLines && item.customization.extraLines.length > 0 && (
                                <span style={{ display: "block", marginTop: "3px", fontSize: "0.78rem", color: "var(--text-secondary, #d4d4d8)" }}>
                                  {item.customization.extraLines.map((line: string, idx: number) => (
                                    <span key={idx} style={{ display: "inline-block", marginRight: "8px" }}>Line {idx + 3}: <strong>{line}</strong></span>
                                  ))}
                                </span>
                              )}
                              <br />
                              <small style={{ opacity: 0.9, color: "var(--text-secondary, #a1a1aa)" }}>
                                Motif: <strong>{item.customization.surfaceMotif || "facets"}</strong> · Layout: <strong>{String(item.customization.layout || item.customization.position || "left").replace("-", " ")}</strong> · Foil: <strong>{item.customization.accentColor || "#d4af37"}</strong> · Font: <strong>{item.customization.font || "sans"}</strong>{item.customization.textSize && item.customization.textSize !== 14 ? ` · Size: ${item.customization.textSize}pt` : ""}{item.customization.backSubtitle ? ` · Back: "${item.customization.backSubtitle}"` : ""}
                              </small>
                              {item.customization.logoUrl && (
                                <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
                                  <span style={{ fontSize: "0.78rem", color: "var(--text-secondary, #a1a1aa)" }}>Custom Logo:</span>
                                  <img
                                    src={productMediaUrl(item.customization.logoUrl)}
                                    alt="Customer logo"
                                    style={{ maxHeight: "24px", maxWidth: "64px", objectFit: "contain", background: "rgba(255,255,255,0.08)", borderRadius: "4px", padding: "2px" }}
                                  />
                                  <a
                                    href={productMediaUrl(item.customization.logoUrl)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ fontSize: "0.76rem", color: "var(--accent, #c9933e)", textDecoration: "underline" }}
                                  >
                                    View logo
                                  </a>
                                  {item.customization.companyName && (
                                    <span style={{ fontSize: "0.76rem", color: "var(--text-secondary, #a1a1aa)" }}>({item.customization.companyName})</span>
                                  )}
                                </div>
                              )}
                            </span>
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginTop: "10px" }}>
                              <button
                                type="button"
                                className="button-download-eps"
                                title="Download Front Vector EPS (94×63 mm canvas with 4mm bleed around 86×55 mm cut)"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  downloadOrderEps(item.customization!, {
                                    id: order.id,
                                    transactionId: order.transactionId,
                                    invoiceNumber: order.invoiceNumber,
                                    customerName: order.customer.name,
                                  }, "front");
                                }}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  padding: "6px 12px",
                                  fontSize: "0.78rem",
                                  fontWeight: 600,
                                  background: "#090d16",
                                  color: "#f59e0b",
                                  border: "1px solid #d97706",
                                  borderRadius: "6px",
                                  cursor: "pointer",
                                  transition: "all 0.15s ease",
                                }}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                  <polyline points="7 10 12 15 17 10" />
                                  <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                                <span>Front EPS (94×63 mm)</span>
                              </button>

                              <button
                                type="button"
                                className="button-download-eps"
                                title="Download Back Vector EPS (94×63 mm canvas with 4mm bleed around 86×55 mm cut)"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  downloadOrderEps(item.customization!, {
                                    id: order.id,
                                    transactionId: order.transactionId,
                                    invoiceNumber: order.invoiceNumber,
                                    customerName: order.customer.name,
                                  }, "back");
                                }}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  padding: "6px 12px",
                                  fontSize: "0.78rem",
                                  fontWeight: 600,
                                  background: "#090d16",
                                  color: "#f59e0b",
                                  border: "1px solid #d97706",
                                  borderRadius: "6px",
                                  cursor: "pointer",
                                  transition: "all 0.15s ease",
                                }}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                  <polyline points="7 10 12 15 17 10" />
                                  <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                                <span>Back EPS (94×63 mm)</span>
                              </button>

                              <button
                                type="button"
                                className="button-download-eps-all"
                                title="Download both Front and Back production EPS files (94×63 mm each)"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  downloadOrderEps(item.customization!, {
                                    id: order.id,
                                    transactionId: order.transactionId,
                                    invoiceNumber: order.invoiceNumber,
                                    customerName: order.customer.name,
                                  }, "both");
                                }}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "5px",
                                  padding: "6px 10px",
                                  fontSize: "0.74rem",
                                  fontWeight: 500,
                                  background: "rgba(217, 119, 6, 0.12)",
                                  color: "#fbbf24",
                                  border: "1px dashed #d97706",
                                  borderRadius: "6px",
                                  cursor: "pointer",
                                  transition: "all 0.15s ease",
                                }}
                              >
                                <span>Both (Front + Back)</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <span className="order-item-amount">{bdt(item.unitPriceMinor * item.quantity)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {order.cancellationReason && <p className="order-cancellation-notice">Cancellation: {order.cancellationReason}</p>
              }

              {!["SHIPPED", "DELIVERED", "CANCELLED"].includes(order.status) && (
                <details className="order-cancel-fold">
                  <summary>Cancel order and release stock</summary>
                  <form className="order-cancel-form" onSubmit={event => {
                    event.preventDefault(); if (busy) return;
                    const data = new FormData(event.currentTarget);
                    setDelivering(order.id); setCancelError(undefined);
                    void api<OrderReceipt>(`${path}/admin/${order.id}/cancel`, token, { method: "POST", body: JSON.stringify({ reason: data.get("reason"), refundConfirmed: data.has("refundConfirmed"), cardsRecovered: data.has("cardsRecovered") }) })
                      .then(updated => updateOrder(order.id, item => ({ ...item, ...updated, assignedCards: [] })))
                      .catch(error => setCancelError({ id: order.id, text: error instanceof Error ? error.message : "Could not cancel the order." })).finally(() => setDelivering(undefined));
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
                    {cancelError?.id === order.id && <p className="store-order-notice is-error" role="alert">{cancelError.text}</p>}
                    <button type="submit" className="button-cancel-order" disabled={busy}>Cancel order</button>
                  </form>
                </details>
              )}

              {order.trackingPath && <OrderEmailHistory orderId={order.id} token={token} onChange={() => void refreshOrder(order.id)} />}
            </div>
          </>;
      })()}
    </dialog>

    <dialog ref={settingsDialog} className="store-settings-dialog" onCancel={() => onSettingsOpenChange(false)} onClose={() => onSettingsOpenChange(false)} aria-labelledby="store-settings-title">
    <section className="panel store-order-settings" aria-label="Checkout settings">
      <header className="store-settings-heading"><h2 id="store-settings-title">Checkout settings</h2><button className="quiet" type="button" aria-label="Close checkout settings" onClick={() => settingsDialog.current?.close()}>×</button></header>
      <section className="store-settings-card">
        <div className="panel-head"><div><h2>Payment</h2><p>bKash {bkashNumber}</p></div></div>
        {codAdvance !== undefined && <form className="store-payment-form" onSubmit={savePayment}>
          <div className="store-payment-row">
            <label>COD advance (BDT)<input type="number" min="0" max="10000" step="1" required value={codAdvance}
              onChange={event => setCodAdvance(event.target.value)} disabled={savingPayment} /></label>
            <button disabled={savingPayment}>{savingPayment ? "Saving…" : "Save payment settings"}</button>
          </div>
          <label className="store-cod-toggle">
            <input
              type="checkbox"
              checked={codAdvanceInsideDhaka}
              onChange={event => setCodAdvanceInsideDhaka(event.target.checked)}
              disabled={savingPayment}
            />
            <span className="store-cod-toggle-text">
              <strong>COD advance Inside Dhaka: {codAdvanceInsideDhaka ? "ON" : "OFF"}</strong>
              <small>{codAdvanceInsideDhaka ? "Advance required for Inside Dhaka COD orders" : "No advance required for Inside Dhaka COD orders (orders place directly)"}</small>
            </span>
          </label>
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

function OrderEmailHistory({ orderId, token, onChange }: { orderId: string; token: string; onChange: () => void }) {
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
      if (kind) onChange();
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

