const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface Credentials {
  accessToken: string;
  stationKey: string;
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
  credentials?: Partial<Credentials>,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (credentials?.accessToken) headers.set("authorization", `Bearer ${credentials.accessToken}`);
  if (credentials?.stationKey) headers.set("x-station-key", credentials.stationKey);
  headers.set("x-request-id", crypto.randomUUID());

  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const body = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? `Request failed (${response.status})`);
  return body;
}

export async function sha256(value: string | Blob): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : await value.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
