import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { customerProfiles } from "../db/schema.js";

const reserved = new Set(["admin", "api", "c", "team", "health", "assets", "dashboard", "index", "products", "arisepay", "robots", "sitemap", "favicon"]);
export function profileHandleBase(name: string) {
  const base = name.normalize("NFKD").replace(/[^a-zA-Z0-9]/g, "").slice(0, 48) || "Oneinfo";
  return reserved.has(base.toLowerCase()) ? `${base}Profile` : base;
}

// The profile keeps its first handle when its display name changes, so shared links stay valid.
export async function ensureProfileHandle(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], profileId: string, name: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('oneinfo-profile-handles', 0))`);
  const [profile] = await tx.select({ handle: customerProfiles.handle }).from(customerProfiles).where(eq(customerProfiles.id, profileId));
  if (profile?.handle) return profile.handle;
  const base = profileHandleBase(name);
  let handle = base;
  for (let suffix = 2; ; suffix++) {
    const [used] = await tx.select({ id: customerProfiles.id }).from(customerProfiles).where(sql`lower(${customerProfiles.handle}) = lower(${handle})`).limit(1);
    if (!used) break;
    handle = `${base}${suffix}`;
  }
  await tx.update(customerProfiles).set({ handle }).where(eq(customerProfiles.id, profileId));
  return handle;
}
