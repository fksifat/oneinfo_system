import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { npmCommand } from "./start-local.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
if (existsSync(`${root}.env`)) process.loadEnvFile(`${root}.env`);
const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { Client } = require("pg");
const source = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://oneinfo:oneinfo@localhost:55432/oneinfo");
const database = `oneinfo_print_stock_${process.pid}_test`;
const admin = new Client({ connectionString: source.href });
await admin.connect();
let created = false;
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  source.pathname = `/${database}`;
  const env = { ...process.env, DATABASE_URL: source.href, ONEINFO_PRINT_STOCK_TEST: "1", NODE_ENV: "test" };
  for (const args of [["run", "db:migrate", "--workspace", "@oneinfo/api"],
    ["exec", "--workspace", "@oneinfo/api", "--", "vitest", "run", "test/printed-stock.integration.test.ts"]]) {
    const [binary, parameters] = npmCommand(args);
    const result = spawnSync(binary, parameters, { cwd: root, env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
    if (args[1] === "db:migrate") {
      assert.equal(source.pathname, `/${database}`);
      const fixture = new Client({ connectionString: source.href });
      await fixture.connect();
      try {
        const before = (await fixture.query('SELECT count(*) FROM products')).rows[0].count;
        // Reproduce the local branch schema where customer/stock migrations preceded reviews.
        await fixture.query('DROP TABLE store_reviews, store_review_invites; ALTER TABLE store_orders DROP COLUMN delivered_at');
        const sql = readFileSync(`${root}apps/api/drizzle/0010_unified_production_customer.sql`, "utf8");
        for (let repeat = 0; repeat < 2; repeat++) {
          for (const statement of sql.split("--> statement-breakpoint")) await fixture.query(statement);
        }
        const tables = await fixture.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
        for (const name of ["store_reviews", "store_review_invites", "customer_accounts", "card_activation_secrets", "order_card_allocations"]) {
          assert.ok(tables.rows.some(row => row.tablename === name), `Missing reconciled table: ${name}`);
        }
        assert.equal((await fixture.query('SELECT count(*) FROM products')).rows[0].count, before);
        console.log("PASS: fresh migrations, local branch reconciliation and repeated migration preserve catalog data.");
      } finally { await fixture.end(); }
    }
  }
} finally {
  if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
