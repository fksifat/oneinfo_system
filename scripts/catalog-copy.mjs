import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export const catalogCopy = {
  'oneinfo-essential': {
    subtitle: 'Your everyday introduction',
    description: 'A clean, considered business card that keeps your professional details close. Share your contact information, work and links with a simple tap or scan. Update your profile as your work evolves, and use the same card for your next introduction.',
    features: ['Share your details with a tap or scan', 'Your contact details and links in one profile', 'Update your profile without replacing your card'],
  },
  'oneinfo-signature': {
    subtitle: 'A distinctive first impression',
    description: 'An understated dark finish for a confident introduction. Bring your contact details, portfolio and business links together in a profile that is easy to share and simple to keep up to date.',
    features: ['Distinctive dark finish', 'A professional profile that grows with you', 'Personalise the front and back design'],
  },
};
const unchangedFields = row => Object.fromEntries(Object.entries(row).filter(([key]) =>
  !['subtitle', 'description', 'features', 'version', 'updated_at'].includes(key)));

export async function updateCatalogCopy(client, { apply = false, backup } = {}) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const before = (await client.query(`SELECT * FROM products WHERE slug = ANY($1) ORDER BY slug${apply ? ' FOR UPDATE' : ''}`, [Object.keys(catalogCopy)])).rows;
    assert.equal(before.length, Object.keys(catalogCopy).length, 'Expected both Oneinfo catalog products; no changes applied');
    const changed = before.filter(row => {
      const copy = catalogCopy[row.slug];
      return row.subtitle !== copy.subtitle || row.description !== copy.description || JSON.stringify(row.features) !== JSON.stringify(copy.features);
    });
    if (!apply || !changed.length) {
      await client.query('ROLLBACK');
      return { applied: false, products: changed.map(row => row.slug) };
    }
    assert.ok(backup, 'A backup path is required before applying copy');
    await mkdir(dirname(backup), { recursive: true });
    await writeFile(backup, JSON.stringify(before, null, 2), { mode: 0o600, flag: 'wx' });
    for (const row of changed) {
      const copy = catalogCopy[row.slug];
      const { rows } = await client.query('UPDATE products SET subtitle=$1, description=$2, features=$3, version=version+1, updated_at=NOW() WHERE id=$4 AND version=$5 RETURNING *',
        [copy.subtitle, copy.description, JSON.stringify(copy.features), row.id, row.version]);
      assert.equal(rows.length, 1, 'Product changed during the update');
      assert.deepEqual(unchangedFields(rows[0]), unchangedFields(row), 'Non-copy product data changed');
      await client.query("INSERT INTO audit_logs (id,action,target_type,target_id,metadata) VALUES ($1,'PRODUCT_COPY_UPDATED','product',$2,$3)",
        [randomUUID(), row.id, JSON.stringify({ previousVersion: row.version, backup, fields: ['subtitle', 'description', 'features'] })]);
    }
    await client.query('COMMIT');
    return { applied: true, products: changed.map(row => row.slug), backup };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  assert.ok(args.every(arg => ['--apply', '--dry-run'].includes(arg)) && !(args.includes('--apply') && args.includes('--dry-run')), 'Use --dry-run (default) or --apply');
  try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.ok(process.env.DATABASE_URL, 'Set DATABASE_URL for the intended database');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 20000 });
  try {
    await client.connect();
    const result = await updateCatalogCopy(client, { apply: args.includes('--apply'), backup: `.oneinfo/backups/catalog-copy-${Date.now()}-${randomUUID()}.json` });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Catalog copy failed (${error.code || error.name}). Check database state before retrying.`);
    process.exitCode = 1;
  } finally { await client.end(); }
}
