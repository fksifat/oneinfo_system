const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001";

export async function customerApi<T>(path: string, method = "GET", body?: unknown, token?: string, namespace = "customer"): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1/${namespace}${path}`, {
    method,
    cache: "no-store",
    keepalive: method === "POST" && path.endsWith("/activity"),
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message ?? "Request failed. Please try again."), { status: response.status });
  return data as T;
}
