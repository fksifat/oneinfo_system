const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface Credentials {
  accessToken: string;
  stationKey: string;
}

let renewal: Promise<string> | undefined;

export async function api<T>(
  path: string,
  init: RequestInit = {},
  credentials?: Partial<Credentials>,
  retry = true,
): Promise<T> {
  if (credentials?.stationKey) {
    try {
      const stored = JSON.parse(localStorage.getItem("oneinfo.credentials") ?? "null") as Credentials | null;
      if (stored?.stationKey === credentials.stationKey) credentials = stored;
    } catch { /* Keep explicitly supplied credentials when browser storage is unavailable. */ }
  }
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (credentials?.accessToken) headers.set("authorization", `Bearer ${credentials.accessToken}`);
  if (credentials?.stationKey) headers.set("x-station-key", credentials.stationKey);
  headers.set("x-request-id", crypto.randomUUID());

  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const body = (await response.json()) as T & { message?: string };
  if (response.status === 401 && body.message === "Invalid or expired operator token" && credentials?.accessToken && retry) {
    renewal ??= api<{ accessToken: string }>("/api/v1/dev/token", { method: "POST" }).then((result) => result.accessToken)
      .finally(() => { renewal = undefined; });
    const renewed = { ...credentials, accessToken: await renewal };
    localStorage.setItem("oneinfo.credentials", JSON.stringify(renewed));
    return api<T>(path, init, renewed, false);
  }
  if (!response.ok) throw new Error(body.message ?? `Request failed (${response.status})`);
  return body;
}

export async function sha256(value: string | Blob): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : await value.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
