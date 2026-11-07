export const productionUrl = (import.meta.env.VITE_PRODUCTION_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");

export function orderLink(id: string, task?: string, cardId?: string) {
  const params = new URLSearchParams({ order: id });
  if (task) params.set("task", task);
  if (cardId) params.set("card", cardId);
  return `?${params}#orders`;
}

export function workstationLink(batchId: string, cardId?: string) {
  const params = new URLSearchParams({ batch: batchId });
  if (cardId) params.set("card", cardId);
  return `${productionUrl}/?${params}#production`;
}
