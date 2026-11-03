const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export async function api<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  headers.set("x-request-id", crypto.randomUUID());
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const body = (await response.json()) as T & { message?: string };
  if (response.status === 401) window.dispatchEvent(new Event("oneinfo-session-expired"));
  if (!response.ok) throw new Error(body.message ?? `Request failed (${response.status})`);
  return body;
}
