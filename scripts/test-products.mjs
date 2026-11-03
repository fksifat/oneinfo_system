import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../apps/api/dist/app.js';
import { issueOperatorToken } from '../apps/api/dist/auth.js';
import { closeDatabase } from '../apps/api/dist/db/client.js';
assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'), 'Use a dedicated database ending in _test');
const app=buildApp();
const admin=await issueOperatorToken({operatorId:randomUUID(),email:'catalog-test@example.com',role:'SUPER_ADMIN'});
const auditor=await issueOperatorToken({operatorId:randomUUID(),email:'audit-test@example.com',role:'AUDITOR'});
async function request(method,url,payload,token=admin){const r=await app.inject({method,url,...(payload?{payload}:{}),headers:token?{authorization:`Bearer ${token}`}:{}});return {status:r.statusCode,body:r.json()};}
const base='/api/v1/products';
try {
 assert.equal((await request('POST',base,{},admin)).status,400);
 assert.equal((await request('GET',base,undefined,'')).status,401);
 assert.equal((await request('POST',base,{},auditor)).status,403);
 const initial=await request('GET',base+'/public',undefined,'');assert.equal(initial.body.items.length,2);
 const variant={id:randomUUID(),name:'White',colorHex:'#ffffff',priceMinor:123456,media:[{id:randomUUID(),type:'image',url:'/assets/card.svg'},{id:randomUUID(),type:'video',url:'/assets/card.mp4'},{id:randomUUID(),type:'spin',frames:['/assets/a.webp','/assets/b.webp']}]};
 const blue={id:randomUUID(),name:'Blue',colorHex:'#193c66',priceMinor:200000,salePriceMinor:150000};
 const input={name:'Integration card',slug:`test-${randomUUID()}`,variants:[variant,blue],features:['A'],featured:true,sortOrder:0};
 let r=await request('POST',base,input);assert.equal(r.status,201);let product=r.body;
 assert.equal(product.variants[0].showAllColourMedia,true);assert.equal(product.variants[0].defaultMediaIndex,0);assert.equal(product.status,'DRAFT');assert.equal(product.variants[0].media.length,3);
 assert.equal((await request('GET',base+'/public')).body.items.some(p=>p.id===product.id),false);
 assert.equal((await request('POST',base,input)).status,409);
 r=await request('PUT',`${base}/${product.id}`,{...product,status:'PUBLISHED'});assert.equal(r.status,200);
 assert.equal((await request('PUT',`${base}/${product.id}`,{...product,status:'ARCHIVED'})).status,409);
 product=r.body;
 let items=(await request('GET',base+'/public')).body.items;assert.equal(items[0].id,product.id);assert.equal(items[0].variants.length,2);assert.equal(items[0].variants[1].salePriceMinor,150000);
 r=await request('PUT',`${base}/${product.id}`,{...product,variants:product.variants.map((v,i)=>i===0?{...v,priceMinor:150099}:v),name:'Updated card'});assert.equal(r.status,200);product=r.body;
 items=(await request('GET',base+'/public')).body.items;assert.equal(items[0].name,'Updated card');assert.equal(items[0].variants[0].priceMinor,150099);
 assert.equal((await request('PUT',`${base}/${product.id}`,{...product,variants:[{...product.variants[0],salePriceMinor:999999}]})).status,400);
 r=await request('PUT',`${base}/${product.id}`,{...product,variants:product.variants.map(v=>({...v,available:false}))});assert.equal(r.status,200);product=r.body;
 assert.equal((await request('GET',base+'/public')).body.items[0].variants[0].available,false);
 assert.equal((await request('PUT',`${base}/${product.id}`,{...product,slug:'oneinfo-essential'})).status,409);
 assert.equal((await request('PUT',`${base}/${product.id}`,{...product,status:'ARCHIVED'})).status,200);
 assert.equal((await request('GET',base+'/public')).body.items.length,2);
 const audits=(await request('GET','/api/v1/admin/audit-logs')).body.items;assert.ok(audits.some(a=>a.targetId===product.id&&a.action==='PRODUCT_UPDATED'));
 console.log('Catalog integration: auth, validation, create, duplicate, draft visibility, publish, ordering, variant pricing, invalid sale, availability, stale update, archive, audit: PASS');
} finally {await app.close();await closeDatabase();}
