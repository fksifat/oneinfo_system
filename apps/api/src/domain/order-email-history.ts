import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { auditLogs, orderEmails } from "../db/schema.js";

export const orderEmailKinds = ["confirmation", "payment", "shipping", "delivery"] as const;
export type OrderEmailKind = typeof orderEmailKinds[number];
const emailAction = "STORE_ORDER_EMAIL_ATTEMPT";

export async function queueOrderEmail(client: Pick<typeof db, "insert">, orderId: string, kind: OrderEmailKind) {
  await client.insert(orderEmails).values({ orderId, kind }).onConflictDoNothing();
}

export async function recordOrderEmail(client: Pick<typeof db, "insert">, orderId: string, kind: OrderEmailKind, sent: boolean) {
  const status = sent ? "accepted" : "failed";
  await client.insert(auditLogs).values({ action: emailAction, targetType: "store_order", targetId: orderId, metadata: { kind, status } });
  return status;
}

export async function orderEmailHistory(orderId: string) {
  const queued = await db.select({ id: orderEmails.id, kind: orderEmails.kind, status: orderEmails.status, createdAt: orderEmails.updatedAt })
    .from(orderEmails).where(eq(orderEmails.orderId, orderId));
  const history = await db.select({ id: auditLogs.id, kind: sql<OrderEmailKind>`${auditLogs.metadata}->>'kind'`,
    status: sql<"accepted" | "failed">`${auditLogs.metadata}->>'status'`, createdAt: auditLogs.createdAt })
    .from(auditLogs).where(and(eq(auditLogs.action, emailAction), eq(auditLogs.targetId, orderId)))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(100);
  return [...queued, ...history];
}

export async function attemptOrderEmail(orderId: string, kind: OrderEmailKind, send: () => Promise<boolean>, mode: "initial" | "retry" | "replay" = "initial") {
  const claimId = randomUUID();
  const claimed = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`oneinfo-email:${orderId}:${kind}`}, 0))`);
    const [previous] = await tx.select({ status: sql<string>`${auditLogs.metadata}->>'status'` }).from(auditLogs)
      .where(and(eq(auditLogs.action, emailAction), eq(auditLogs.targetId, orderId), sql`${auditLogs.metadata}->>'kind' = ${kind}`))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(1);
    await tx.insert(orderEmails).values({ orderId, kind, status: previous?.status === "accepted" ? "accepted" : previous ? "failed" : "pending" }).onConflictDoNothing();
    const [row] = await tx.select().from(orderEmails).where(and(eq(orderEmails.orderId, orderId), eq(orderEmails.kind, kind))).for("update");
    if (row?.status === "accepted" || previous?.status === "accepted") return "accepted";
    if (!row || row.status === "sending" || (row.status === "failed" && mode !== "retry")) return;
    await tx.update(orderEmails).set({ status: "sending", claimId, updatedAt: new Date() }).where(eq(orderEmails.id, row.id));
    return "claimed";
  });
  if (claimed !== "claimed") return claimed === "accepted" ? "accepted" as const : undefined;
  let sent = false;
  try { sent = await send(); } catch { /* Keep failed provider calls available for explicit retry. */ }
  return db.transaction(async tx => {
    const status = sent ? "accepted" : "failed";
    const changed = await tx.update(orderEmails).set({ status, claimId: null, updatedAt: new Date() })
      .where(and(eq(orderEmails.orderId, orderId), eq(orderEmails.kind, kind), eq(orderEmails.claimId, claimId))).returning();
    if (changed.length) await recordOrderEmail(tx, orderId, kind, sent);
    return status;
  });
}
