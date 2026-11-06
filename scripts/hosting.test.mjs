import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

test('Vercel proxies compatibility API URLs to the single VPS backend',()=>{
  const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url)));
  assert.equal(config.functions,undefined);
  assert.equal(config.rewrites.find(rule=>rule.source==='/api/v1/:path*').destination,'https://api.oneinfo.online/api/v1/:path*');
  assert.equal(config.rewrites.find(rule=>rule.source==='/health').destination,'https://api.oneinfo.online/health');
  assert.equal(existsSync(new URL('../api/index.ts',import.meta.url)),false);
  assert.ok(readFileSync(new URL('../.vercelignore',import.meta.url),'utf8').split('\n').includes('api'));
});
