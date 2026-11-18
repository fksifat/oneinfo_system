import { createHash } from "node:crypto";
import { catalogVariantId, type OrderLine } from "@oneinfo/contracts";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { storeShippingSettings } from "../db/schema.js";
import { decryptOrderCode } from "./order-activation.js";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function normalizeBdPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("01") && digits.length === 11) return `88${digits}`;
  if (digits.startsWith("8801") && digits.length === 13) return digits;
  return digits;
}

export function metaPurchaseCatalogData(items: OrderLine[], totalMinor: number) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const id = catalogVariantId(item.productId, item.variantId);
    counts.set(id, (counts.get(id) ?? 0) + item.quantity);
  }
  const content_ids = [...counts.keys()].sort();
  const contents = content_ids.map(id => ({ id, quantity: counts.get(id)! }));
  return {
    content_ids,
    content_type: "product" as const,
    contents,
    num_items: contents.reduce((sum, item) => sum + item.quantity, 0),
    currency: "BDT" as const,
    value: totalMinor / 100,
  };
}

export async function resolveMetaCapiToken(): Promise<string | undefined> {
  const rows = await db.select({ encryptedMetaCapiToken: storeShippingSettings.encryptedMetaCapiToken })
    .from(storeShippingSettings).where(eq(storeShippingSettings.id, "default")).catch(() => []);
  if (rows[0]?.encryptedMetaCapiToken) {
    try { return decryptOrderCode(rows[0].encryptedMetaCapiToken); } catch { /* Fall back to env config. */ }
  }
  return config.META_CONVERSIONS_API_TOKEN;
}

export async function sendMetaPurchaseEvent(
  order: { id: string; createdAt: Date | string; customer: { email: string; phone: string }; deliveryAddress: { district: string }; items: OrderLine[] },
  totalMinor: number,
  client: { ip?: string | undefined; userAgent?: string | undefined } = {},
): Promise<boolean> {
  const token = await resolveMetaCapiToken();
  if (!token) return false;
  const createdMs = typeof order.createdAt === "string" ? Date.parse(order.createdAt) : order.createdAt.getTime();
  const eventTime = Number.isFinite(createdMs) ? Math.floor(createdMs / 1000) : Math.floor(Date.now() / 1000);
  const email = order.customer.email.trim().toLowerCase();
  const phone = normalizeBdPhone(order.customer.phone);
  const city = order.deliveryAddress.district.toLowerCase().replace(/[^a-z]/g, "");
  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: eventTime,
        event_id: `oneinfo-order-${order.id}`,
        action_source: "website",
        event_source_url: config.STOREFRONT_URL ?? "https://oneinfo.online",
        user_data: {
          ...(email && { em: [sha256(email)] }),
          ...(phone.length >= 7 && { ph: [sha256(phone)] }),
          ...(city && { ct: [sha256(city)] }),
          country: [sha256("bd")],
          external_id: [sha256(order.id)],
          ...(client.ip && { client_ip_address: client.ip }),
          ...(client.userAgent && { client_user_agent: client.userAgent }),
        },
        custom_data: metaPurchaseCatalogData(order.items, totalMinor),
      },
    ],
  };
  const endpoint = `https://graph.facebook.com/v21.0/${encodeURIComponent(config.META_PIXEL_ID)}/events`;
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
  return Boolean(response?.ok);
}
