import { config } from "../config.js";

export function managedCardBases() {
  return [...new Set([config.PUBLIC_CARD_BASE_URL, ...config.PUBLIC_CARD_BASE_URL_ALIASES].map(base => base.replace(/\/$/, "")))];
}

export function isManagedCardUrl(url: string, slug: string) {
  return managedCardBases().some(base => url === `${base}/${slug}`);
}
