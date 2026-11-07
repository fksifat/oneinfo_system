import { config } from "../config.js";

export function managedCardBases() {
  return [...new Set([config.PUBLIC_CARD_BASE_URL, ...config.PUBLIC_CARD_BASE_URL_ALIASES].map(base => base.replace(/\/$/, "")))];
}

export function isManagedCardUrl(url: string, slug: string) {
  return managedCardBases().some(base => url === `${base}/${slug}` || url === `${base}/${slug}?source=nfc`);
}

export function qrUrl(canonicalUrl: string) {
  const url = new URL(canonicalUrl);
  return isManagedCardUrl(canonicalUrl, url.pathname.split("/").at(-1) ?? "") && url.search === "?source=nfc"
    ? canonicalUrl.replace(/\?source=nfc$/, "?source=qr") : canonicalUrl;
}

export function nfcUrlFromQr(value: string) {
  const canonical = value.replace(/\?source=qr$/, "?source=nfc");
  try {
    const url = new URL(canonical);
    return isManagedCardUrl(canonical, url.pathname.split("/").at(-1) ?? "") ? canonical : value;
  } catch { return value; }
}
