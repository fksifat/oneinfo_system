import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { auditLogs } from "../db/schema.js";

export async function allowAuthAttempt(key: string, maximum: number, windowMs: number) {
  const targetId = createHash("sha256").update(key).digest("hex");
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${targetId}))`);
    const [recent] = await tx.select({ count: sql<number>`count(*)::int` }).from(auditLogs)
      .where(and(eq(auditLogs.action, "AUTH_ATTEMPT"), eq(auditLogs.targetId, targetId), gte(auditLogs.createdAt, new Date(Date.now() - windowMs))));
    if ((recent?.count ?? 0) >= maximum) return false;
    await tx.insert(auditLogs).values({ action: "AUTH_ATTEMPT", targetType: "authentication", targetId });
    return true;
  });
}
