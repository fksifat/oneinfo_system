import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogCopy, updateCatalogCopy } from './catalog-copy.mjs';

function fixture({ failAudit = false, corruptPrice = false, current = false } = {}) {
  const original = Object.keys(catalogCopy).map((slug, i) => ({ id: `product-${i}`, slug, subtitle: '', description: '', features: ['NFC + dynamic QR'], version: 3,
    price_minor: 129000, variants: [{ priceMinor: 129000, stockQuantity: 7, media: ['/existing.webp'] }], ...(current ? catalogCopy[slug] : {}) }));
  let stored = structuredClone(original), pending;
  const calls = [];
  return { calls, original, rows: () => stored, async query(sql, values) {
    calls.push(sql);
    if (sql === 'BEGIN') pending = structuredClone(stored);
    if (sql.startsWith('SELECT')) return { rows: structuredClone(pending) };
    if (sql.startsWith('UPDATE')) {
      const row = pending.find(row => row.id === values[3]);
      Object.assign(row, { subtitle: values[0], description: values[1], features: JSON.parse(values[2]), version: row.version + 1 });
      if (corruptPrice) row.price_minor++;
      return { rows: [structuredClone(row)] };
    }
    if (sql.startsWith('INSERT') && failAudit) throw new Error('audit unavailable');
    if (sql === 'COMMIT') stored = pending;
    return { rows: [] };
  } };
}

test('catalog copy is a dry run by default and already updated products are unchanged', async () => {
  const db = fixture();
  assert.equal((await updateCatalogCopy(db)).products.length, 2);
  assert.deepEqual(db.rows(), db.original);
  assert.equal(db.calls.some(sql => sql.startsWith('UPDATE')), false);
  const current = fixture({ current: true });
  assert.deepEqual(await updateCatalogCopy(current, { apply: true }), { applied: false, products: [] });
});

test('apply backs up original records, preserves inventory/media/prices, and rolls back failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oneinfo-copy-test-'));
  try {
    const db = fixture(), backup = join(dir, 'before.json');
    const result = await updateCatalogCopy(db, { apply: true, backup });
    assert.equal(result.applied, true);
    assert.deepEqual(JSON.parse(await readFile(backup, 'utf8')), db.original);
    assert.equal((await stat(backup)).mode & 0o777, 0o600);
    for (const row of db.rows()) {
      assert.equal(row.description, catalogCopy[row.slug].description);
      assert.equal(row.version, 4);
      assert.deepEqual(row.variants, db.original[0].variants);
      assert.equal(row.price_minor, 129000);
    }
    for (const options of [{ failAudit: true }, { corruptPrice: true }]) {
      const failed = fixture(options);
      await assert.rejects(updateCatalogCopy(failed, { apply: true, backup: join(dir, `${Object.keys(options)[0]}.json`) }));
      assert.deepEqual(failed.rows(), failed.original);
      assert.equal(failed.calls.at(-1), 'ROLLBACK');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
