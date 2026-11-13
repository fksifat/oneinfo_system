import { resolveProductImageUrl } from "@oneinfo/contracts";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
let renewal: Promise<string> | undefined;

export async function api<T>(path: string, token?: string, init: RequestInit = {}, retry = true): Promise<T> {
  if (token) token = localStorage.getItem("oneinfo.admin.token") || token;
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  headers.set("x-request-id", crypto.randomUUID());
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const body = (await response.json()) as T & { message?: string };
  if (response.status === 401 && body.message === "Invalid or expired operator token" && token && retry && import.meta.env.VITE_OPERATOR_LOGIN !== "password") {
    renewal ??= api<{ accessToken: string }>("/api/v1/dev/token", undefined, { method: "POST" }).then((result) => result.accessToken)
      .finally(() => { renewal = undefined; });
    const renewed = await renewal;
    localStorage.setItem("oneinfo.admin.token", renewed);
    return api<T>(path, renewed, init, false);
  }
  if (response.status === 401) window.dispatchEvent(new Event("oneinfo-session-expired"));
  if (!response.ok) throw new Error(body.message ?? `Request failed (${response.status})`);
  return body;
}

export async function uploadProductMedia(file: Blob, extension: string, token: string): Promise<string> {
  const response = await fetch(`${API_URL}/api/v1/product-media/upload/${extension}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream", "x-request-id": crypto.randomUUID() },
    body: file,
  });
  const body = await response.json() as { url?: string; message?: string };
  if (response.status === 401) window.dispatchEvent(new Event("oneinfo-session-expired"));
  if (!response.ok || !body.url) throw new Error(body.message ?? `Upload failed (${response.status})`);
  return body.url;
}

export function productMediaUrl(path?: string) {
  if (!path) return "";
  if (path.startsWith("data:") || path.startsWith("blob:") || path.startsWith("http://") || path.startsWith("https://")) return path;
  const source = resolveProductImageUrl(path);
  const base = source.startsWith("/api/v1/product-media/") ? API_URL : import.meta.env.VITE_STOREFRONT_URL ?? "http://127.0.0.1:5175";
  return new URL(source, base || window.location.origin).href;
}
