import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "../config.js";
import * as schema from "./schema.js";

export const pool = new Pool({
  connectionString: config.DATABASE_URL, max: 10,
  connectionTimeoutMillis: 5000,
  statement_timeout: 20000,
  query_timeout: 25000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});
// pg removes a failed idle client; handle its event so the next request can reconnect.
pool.on("error", (error: Error & { code?: string }) => {
  console.warn("Idle database connection closed; the pool will reconnect.", { code: error.code });
});
export const db = drizzle({ client: pool, schema });

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
