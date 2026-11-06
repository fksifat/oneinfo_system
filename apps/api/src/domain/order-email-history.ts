import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { auditLogs } from "../db/schema.js";

export const orderEmailKinds = ["confirmation", "payment", "shipping", "delivery"] as const;
export type OrderEmailKind = typeof orderEmailKinds[number];
const emailAction = "STORE_ORDER_EMAIL_ATTEMPT";

export async function recordOrderEmail(client: Pick<typeof db, "insert">, orderId: string, kind: OrderEmailKind, sent: boolean) {
  const status = sent ? "accepted" : "failed";
  await client.insert(auditLogs).values({ action: emailAction, targetType: "store_order", targetId: orderId, metadata: { kind, status } });
  return status;
}

export function orderEmailHistory(orderId: string) {
  return db.select({ id: auditLogs.id, kind: sql<OrderEmailKind>`${auditLogs.metadata}->>'kind'`,
    status: sql<"accepted" | "failed">`${auditLogs.metadata}->>'status'`, createdAt: auditLogs.createdAt })
    .from(auditLogs).where(and(eq(auditLogs.action, emailAction), eq(auditLogs.targetId, orderId)))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(100);
}

export async function attemptOrderEmail(orderId: string, kind: OrderEmailKind, send: () => Promise<boolean>, mode: "initial" | "retry" | "replay" = "initial") {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`oneinfo-email:${orderId}:${kind}`}, 0))`);
    const [previous] = await tx.select({ status: sql<string>`${auditLogs.metadata}->>'status'` }).from(auditLogs)
      .where(and(eq(auditLogs.action, emailAction), eq(auditLogs.targetId, orderId), sql`${auditLogs.metadata}->>'kind' = ${kind}`))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(1);
    if (previous?.status === "accepted") return "accepted" as const;
    if ((mode === "retry" && previous?.status !== "failed") || (mode === "initial" && previous)) return;
    return recordOrderEmail(tx, orderId, kind, await send());
  });
}
