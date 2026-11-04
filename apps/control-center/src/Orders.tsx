import { useEffect, useState, type FormEvent } from "react";
import { bkashNumber, CodAdvanceSchema, shippingZoneLabels, type OrderReceipt, type ShippingRates, type ShippingZone, type StoreCoupon, type StoreOrder } from "@oneinfo/contracts";
import { api } from "./api.js";

const zones: ShippingZone[] = ["insideDhaka", "subDhaka", "outsideDhaka"];
const money = new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT", currencyDisplay: "narrowSymbol" });
const bdt = (minor: number) => money.format(minor / 100);
const path = "/api/v1/orders";

export function Orders({ token }: { token: string }) {
  const [items, setItems] = useState<StoreOrder[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [rates, setRates] = useState<Record<ShippingZone, string>>();
  const [codAdvance, setCodAdvance] = useState<string>();
  const [paymentMessage, setPaymentMessage] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [coupons, setCoupons] = useState<StoreCoupon[]>([]);
  const [couponCode, setCouponCode] = useState("");
  const [couponPercent, setCouponPercent] = useState("");
  const [couponActive, setCouponActive] = useState(true);
  const [savingCoupon, setSavingCoupon] = useState(false);
  const [couponError, setCouponError] = useState("");
  const [couponMessage, setCouponMessage] = useState("");

  async function loadOrders(beforeId?: string) {
    setLoading(true);
    setError("");
    try {
      const page = await api<{ items: StoreOrder[]; hasMore: boolean }>(`${path}/admin${beforeId ? `?beforeId=${beforeId}` : ""}`, token);
      setItems(previous => beforeId ? [...previous, ...page.items] : page.items);
      setHasMore(page.hasMore);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load orders.");
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
    setError("");
    try {
      const updated = await api<OrderReceipt>(`${path}/admin/${order.id}/verify-payment`, token, { method: "POST" });
      setItems(previous => previous.map(item => item.id === order.id ? { ...item, ...updated } : item));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not verify payment.");
    } finally {
      setVerifyingPayment(undefined);
    }
  }

  return <div className="store-orders">
    <section className="panel">
      <div className="panel-head"><div><h2>Payment settings</h2><p>bKash {bkashNumber} · Set the COD advance to 0 to turn it off.</p></div></div>
      {codAdvance !== undefined && <form className="store-order-rates" onSubmit={savePayment}>
        <label>COD advance (BDT)<input type="number" min="0" max="10000" step="1" required value={codAdvance}
          onChange={event => setCodAdvance(event.target.value)} disabled={savingPayment} /></label>
        <button disabled={savingPayment}>{savingPayment ? "Saving…" : "Save payment settings"}</button>
      </form>}
      {paymentMessage && <p role="status">{paymentMessage}</p>}
      {paymentError && <p role="alert">{paymentError}</p>}
    </section>
    <section className="panel">
      <div className="panel-head"><div><h2>Delivery rates</h2><p>Set the charge in taka for each delivery zone.</p></div></div>
      {rates ? <form className="store-order-rates" onSubmit={saveRates}>
        {zones.map(zone => <label key={zone}>{shippingZoneLabels[zone]}
          <input type="number" required min="0" max="10000" step="0.01" value={rates[zone]}
            onChange={event => setRates({ ...rates, [zone]: event.target.value })} disabled={saving} />
        </label>)}
        <button disabled={saving}>{saving ? "Saving…" : "Save rates"}</button>
      </form> : <button type="button" onClick={() => void loadRates()}>Load rates</button>}
      {message && <p role="status">{message}</p>}
    </section>
    <section className="panel">
      <div className="panel-head"><div><h2>Coupons</h2><p>Create percentage discounts on items. Shipping is charged separately.</p></div></div>
      <form className="store-order-rates store-coupon-form" onSubmit={saveCoupon}>
        <label>Coupon code<input required value={couponCode} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_\-]{2,31}"
          onChange={event => setCouponCode(event.target.value.toUpperCase())} disabled={savingCoupon} /></label>
        <label>Discount (%)<input required type="number" min="1" max="100" value={couponPercent}
          onChange={event => setCouponPercent(event.target.value)} disabled={savingCoupon} /></label>
        <label className="store-coupon-active"><input type="checkbox" checked={couponActive}
          onChange={event => setCouponActive(event.target.checked)} disabled={savingCoupon} /> Active</label>
        <button disabled={savingCoupon}>{savingCoupon ? "Saving…" : "Save coupon"}</button>
      </form>
      {couponMessage && <p role="status">{couponMessage}</p>}
      {couponError && <p role="alert">{couponError} <button type="button" className="quiet" onClick={() => { setCouponError(""); void loadCoupons(); }}>Reload coupons</button></p>}
      {coupons.map(coupon => <div className="store-coupon-row" key={coupon.code}>
        <span><strong>{coupon.code}</strong> · {coupon.percent}% · {coupon.active ? "Active" : "Inactive"}</span>
        <button type="button" className="quiet" disabled={savingCoupon} onClick={() => {
          setCouponCode(coupon.code);
          setCouponPercent(String(coupon.percent));
          setCouponActive(coupon.active);
          setCouponMessage("");
        }}>Edit {coupon.code}</button>
      </div>)}
    </section>
    <section className="panel">
      <div className="panel-head"><h2>Received orders</h2><button type="button" className="quiet" disabled={loading} onClick={() => void loadOrders()}>Refresh orders</button></div>
      {error && <p role="alert">{error}</p>}
      {!items.length && <p className="empty">{loading ? "Loading orders…" : "No orders received yet."}</p>}
      {items.map(order => <details className="store-order" key={order.id}>
        <summary>
          <span><strong>{order.customer.name}</strong><small>{new Date(order.createdAt).toLocaleString("en-BD", { timeZone: "Asia/Dhaka" })}</small></span>
          <span><strong>{bdt(order.totalMinor)}</strong><small>{order.paymentMethod === "BKASH" ? "bKash" : "Cash on delivery"}{order.paymentStatus === "PENDING_VERIFICATION" && " · Payment pending"}</small></span>
        </summary>
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
        {order.paymentStatus === "PENDING_VERIFICATION" && <button className="quiet" type="button"
          disabled={Boolean(verifyingPayment)} onClick={() => void verifyPayment(order)}>
          {verifyingPayment === order.id ? "Verifying…" : "Verify bKash payment"}
        </button>}
        <ul>{order.items.map(item => <li key={`${item.productId}:${item.variantId}`}>
          {item.quantity} × {item.name} · {item.variantName} · {bdt(item.unitPriceMinor * item.quantity)}
        </li>)}</ul>
      </details>)}
      {hasMore && <button className="quiet" type="button" disabled={loading} onClick={() => void loadOrders(items.at(-1)?.id)}>Load older orders</button>}
    </section>
  </div>;
}
