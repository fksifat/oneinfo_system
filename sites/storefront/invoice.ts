import type { OrderLine, OrderReceipt } from "@oneinfo/contracts";
import logo from "./assets/oneinfo-logo.svg";

type InvoiceOrder = Pick<OrderReceipt, "id" | "invoiceNumber" | "status" | "createdAt" | "paymentMethod" |
  "paymentAmountMinor" | "paymentStatus" | "subtotalMinor" | "shippingMinor" | "discountMinor" | "totalMinor"> & {
  items: Pick<OrderLine, "name" | "variantName" | "quantity" | "unitPriceMinor">[];
};

type InvoiceCode = { secretCode: string | null };

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const money = (minor: number) => `BDT ${(minor / 100).toFixed(2)}`;
const invoiceDate = new Intl.DateTimeFormat("en-BD", { timeZone: "Asia/Dhaka", dateStyle: "medium" });

export function invoiceMarkup(order: InvoiceOrder, codes: readonly InvoiceCode[] = []) {
  const payment = order.paymentAmountMinor ?? 0;
  const verified = order.paymentStatus === "VERIFIED";
  const balance = order.totalMinor - payment;
  const cancelled = order.status === "CANCELLED";
  const unused = cancelled ? [] : codes.flatMap(({ secretCode }, index) => secretCode ? [{ secretCode, cardNumber: index + 1 }] : []);
  return `<header class="invoice-header">
      <img class="invoice-logo" src="${escape(new URL(logo, location.href).href)}" alt="Oneinfo" width="142" height="43">
      <div><h1 id="invoice-title" tabindex="-1">Invoice</h1>
      <p class="invoice-number">${escape(order.invoiceNumber ?? "")} <span>·</span> <time datetime="${escape(order.createdAt)}">${invoiceDate.format(new Date(order.createdAt))}</time></p></div>
    </header>
    <dl class="invoice-reference">
      <div><dt>Order ID</dt><dd>${escape(order.id)}</dd></div>
      <div><dt>Payment</dt><dd>${order.paymentMethod === "BKASH" ? "bKash" : "Cash on delivery"}</dd></div>
    </dl>
    ${cancelled ? '<p class="invoice-cancelled">Order cancelled</p>' : ""}
    <table class="invoice-table" aria-label="Invoice items">
      <thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Price</th><th scope="col">Amount</th></tr></thead>
      <tbody>${order.items.map(item => `<tr><th scope="row">${escape(item.name)}<small>${escape(item.variantName)}</small></th><td>${item.quantity}</td><td>${money(item.unitPriceMinor)}</td><td>${money(item.unitPriceMinor * item.quantity)}</td></tr>`).join("")}</tbody>
    </table>
    <dl class="invoice-totals">
      <div><dt>Items</dt><dd>${money(order.subtotalMinor)}</dd></div>
      ${order.discountMinor ? `<div><dt>Discount</dt><dd>−${money(order.discountMinor)}</dd></div>` : ""}
      <div><dt>Delivery</dt><dd>${money(order.shippingMinor)}</dd></div>
      <div class="invoice-total"><dt>Total</dt><dd>${money(order.totalMinor)}</dd></div>
      ${!cancelled && payment > 0 ? `<div><dt>${verified ? "Paid" : "Payment to verify"}</dt><dd>${money(payment)}</dd></div>
      ${balance > 0 ? `<div><dt>${verified ? "Due on delivery" : "Due after payment check"}</dt><dd>${money(balance)}</dd></div>` : ""}` : ""}
    </dl>
    ${unused.length ? `<section class="invoice-activation" aria-labelledby="invoice-activation-title">
      <header><h2 id="invoice-activation-title">${unused.length === 1 ? "Activation code" : "Activation codes"}</h2>
      <p>Tap or scan your card, then enter the code. Keep it private.</p></header>
      ${unused.map(({ secretCode, cardNumber }) => `<div class="invoice-code">${codes.length > 1 ? `<span>Card ${cardNumber}</span>` : ""}
        <code>${escape(secretCode)}</code></div>`).join("")}
    </section>` : ""}`;
}
