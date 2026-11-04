import { useEffect, useRef, useState, type FormEvent } from "react";
import { bkashNumber, CodAdvanceSchema, shippingZoneLabels, type OrderReceipt, type ShippingRates, type ShippingZone, type StoreCoupon, type StoreOrder } from "@oneinfo/contracts";
import { api } from "./api.js";

const zones: ShippingZone[] = ["insideDhaka", "subDhaka", "outsideDhaka"];
const money = new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT", currencyDisplay: "narrowSymbol" });
const bdt = (minor: number) => money.format(minor / 100);
const path = "/api/v1/orders";

export function Orders({ token, settingsOpen, onSettingsOpenChange }: { token: string; settingsOpen: boolean; onSettingsOpenChange: (open: boolean) => void }) {
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<StoreOrder[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [rates, setRates] = useState<Record<ShippingZone, string>>();
  const [codAdvance, setCodAdvance] = useState<string>();
  const [paymentMessage, setPaymentMessage] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState<string>();
  const [delivering, setDelivering] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [orderError, setOrderError] = useState("");
  const [message, setMessage] = useState("");
  const [orderMessage, setOrderMessage] = useState("");
  const [coupons, setCoupons] = useState<StoreCoupon[]>([]);
  const [couponCode, setCouponCode] = useState("");
  const [couponPercent, setCouponPercent] = useState("");
  const [couponActive, setCouponActive] = useState(true);
  const [savingCoupon, setSavingCoupon] = useState(false);
  const [couponError, setCouponError] = useState("");
  const [couponMessage, setCouponMessage] = useState("");

  async function loadOrders(beforeId?: string) {
    setLoading(true);
    setOrderError("");
    try {
      const page = await api<{ items: StoreOrder[]; hasMore: boolean }>(`${path}/admin${beforeId ? `?beforeId=${beforeId}` : ""}`, token);
      setItems(previous => beforeId ? [...previous, ...page.items] : page.items);
      setHasMore(page.hasMore);
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : "Could not load orders.");
    } finally {
      setLoading(false);
    }
  }

  async function loadRates() {
    try {
      const { rates, codAdvanceTaka } = await api<{ rates: ShippingRates; codAdvanceTaka: number }>(`${path}/shipping`);
      setCodAdvance(String(CodAdvanceSchema.parse(codAdvanceTaka)));
      setRates({ insideDhaka: String(rates.insideDhaka / 100), subDhaka: String(rates.subDhaka / 100), outsideDhaka: String(rates.outsideDhaka / 100) });
    } catch {
      setError("Could not load delivery rates.");
    }
  }

  useEffect(() => {
    void loadOrders();
    void loadRates();
    void loadCoupons();
  }, [token]);

  useEffect(() => {
    if (settingsOpen && settingsDialog.current && !settingsDialog.current.open) settingsDialog.current.showModal();
    else if (!settingsOpen && settingsDialog.current?.open) settingsDialog.current.close();
  }, [settingsOpen]);

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
    setError("");
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
      setError(error instanceof Error ? error.message : "Could not save rates.");
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
      const result = await api<{ delivered: boolean; invitation: string }>(`${path}/admin/${order.id}/deliver`, token, { method: "POST" });
      setItems(previous => previous.map(item => item.id === order.id ? { ...item, deliveredAt: item.deliveredAt ?? new Date().toISOString(), ...(result.invitation === "sent" ? { reviewInviteSentAt: new Date().toISOString() } : {}) } : item));
      setOrderMessage(result.invitation === "sent" ? "Order marked delivered; review email sent." : result.invitation === "already-sent" ? "Order is delivered; review email was already sent." : "Order marked delivered. Review email could not be sent; use this action to retry.");
    } catch (error) { setOrderError(error instanceof Error ? error.message : "Could not mark order delivered."); }
    finally { setDelivering(undefined); }
  }

  return <div className="store-orders">
    <section className="panel store-orders-list">
      <div className="panel-head"><div><h2>Received orders</h2><p>Review payments, delivery details, and order items.</p></div><button type="button" className="quiet" disabled={loading} onClick={() => void loadOrders()}>Refresh</button></div>
      {orderError && <p className="store-order-notice is-error" role="alert">{orderError}</p>}
      {orderMessage && <p className="store-order-notice" role="status">{orderMessage}</p>}
      {!items.length && <p className="empty">{loading ? "Loading orders…" : "No orders received yet."}</p>}
      {items.map(order => <details className="store-order" key={order.id}>
        <summary>
          <span className="store-order-customer"><strong>{order.customer.name}</strong><small>{order.customer.phone} · {new Date(order.createdAt).toLocaleString("en-BD", { timeZone: "Asia/Dhaka" })}</small></span>
          <span className="store-order-total"><strong>{bdt(order.totalMinor)}</strong><small>{order.paymentMethod === "BKASH" ? "bKash" : "Cash on delivery"}{order.paymentStatus === "PENDING_VERIFICATION" && <em className="store-order-status is-pending">Payment pending</em>}{order.paymentStatus === "VERIFIED" && <em className="store-order-status is-paid">Payment verified</em>}</small></span>
        </summary>
        <div className="store-order-content">
          <dl>
            <div><dt>Order ID</dt><dd>{order.id}</dd></div>
            <div><dt>Contact</dt><dd>{order.customer.phone}<br />{order.customer.email}</dd></div>
            <div><dt>Delivery address</dt><dd>{order.deliveryAddress.addressLine}<br />{order.deliveryAddress.district}{order.deliveryAddress.postalCode && ` ${order.deliveryAddress.postalCode}`}</dd></div>
            <div><dt>Delivery charge</dt><dd>{shippingZoneLabels[order.shippingZone]} · {bdt(order.shippingMinor)}</dd></div>
            {order.couponCode && <div><dt>Coupon discount</dt><dd>{order.couponCode} · −{bdt(order.discountMinor)}</dd></div>}
            {order.transactionId && <div><dt>bKash payment</dt><dd>{bdt(order.paymentAmountMinor ?? 0)} · {order.transactionId}<br />
              {order.paymentStatus === "VERIFIED" ? "Verified" : "Pending verification"}</dd></div>}
            {order.transactionId && order.paymentMethod === "COD" && <div><dt>Remaining on delivery after verification</dt>
              <dd>{bdt(order.totalMinor - (order.paymentAmountMinor ?? 0))}</dd></div>}
            {order.customer.note && <div><dt>Order note</dt><dd>{order.customer.note}</dd></div>}
          </dl>
          <div className="store-order-actions">
            {order.paymentStatus === "PENDING_VERIFICATION" && <button className="quiet" type="button"
              disabled={Boolean(verifyingPayment)} onClick={() => void verifyPayment(order)}>
              {verifyingPayment === order.id ? "Verifying…" : "Verify bKash payment"}
            </button>}
            <button className="quiet" type="button" disabled={Boolean(delivering) || Boolean(order.reviewInviteSentAt)} onClick={() => void markDelivered(order)}>
              {delivering === order.id ? "Saving…" : order.reviewInviteSentAt ? "Review invitation sent" : order.deliveredAt ? "Retry review invitation" : "Mark delivered & invite review"}
            </button>
          </div>
          <ul>{order.items.map(item => <li key={`${item.productId}:${item.variantId}`}>
            {item.quantity} × {item.name} · {item.variantName} · {bdt(item.unitPriceMinor * item.quantity)}
          </li>)}</ul>
        </div>
      </details>)}
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
        {error && <p className="store-order-feedback is-error" role="alert">{error}</p>}
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
