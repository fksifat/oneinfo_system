import { createRequire } from 'node:module';
import { inflateRawSync } from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../',import.meta.url));
if(existsSync(join(root,'.env')))process.loadEnvFile(join(root,'.env'));
const chromePath=process.env.CHROME_PATH??['/usr/bin/google-chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',join(process.env.PROGRAMFILES??'C:\\Program Files','Google/Chrome/Application/chrome.exe')].find(existsSync);
if(!chromePath)throw new Error('Chrome is required for UI checks. Set CHROME_PATH to its executable.');
for(const port of [3001,5173,5174,5175]){const response=await fetch(`http://127.0.0.1:${port}${port===3001?'/health':''}`,{signal:AbortSignal.timeout(4000)});assert.ok(response.ok,`Start the local API and all three UIs before running this check (port ${port}).`);}
const require = createRequire(root + '/apps/api/package.json');
const { Client } = require('pg');
const source = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://oneinfo:oneinfo@localhost:55432/oneinfo');
const admin = new Client({ connectionString: source.href });
const database = `oneinfo_print_stock_${process.pid}_test`;
let created = false, closing = false, app, connection, chrome, socket;
const chromeProfile = mkdtempSync(join(tmpdir(), 'oneinfo-client-ui-'));
await admin.connect();
try {
  await admin.query(`create database "${database}"`); created = true;
  source.pathname = '/' + database;
  process.env.DATABASE_URL = source.href; process.env.NODE_ENV = 'test';
  process.env.PRODUCT_MEDIA_DIR = join(chromeProfile, 'profile-media');
  delete process.env.BLOB_READ_WRITE_TOKEN; delete process.env.VERCEL;
  const { npmCommand } = await import(pathToFileURL(join(root,'scripts/start-local.mjs')).href);
  const {config}=await import(pathToFileURL(join(root,'apps/api/dist/config.js')).href);
  assert.equal(new URL(config.DATABASE_URL).pathname,'/'+database,'Refusing to populate a non-test database');
  const adminTestPassword = 'isolated browser administrator password';
  const {hashPassword}=await import(pathToFileURL(join(root,'apps/api/dist/domain/customer-auth.js')).href);
  config.ADMIN_EMAIL='admin-ui@example.com';config.ADMIN_PASSWORD_HASH=await hashPassword(adminTestPassword);
  Object.assign(config,{BREVO_SMTP_USER:undefined,BREVO_SMTP_KEY:undefined,RESEND_API_KEY:'browser-test',ORDER_EMAIL_FROM:'Oneinfo <test@example.com>',STOREFRONT_URL:'http://127.0.0.1:5174'});
  const [binary, args] = npmCommand(['run', 'db:migrate']);
  const migration = spawnSync(binary, args, { cwd: root, env: process.env, encoding: 'utf8' });
  assert.equal(migration.status, 0, migration.stderr);
  connection = await import(pathToFileURL(join(root,'apps/api/dist/db/client.js')).href);
  connection.pool.on('error',error=>{if(!closing){console.warn('UI test database connection failed:',error.code);process.exitCode=1;}});
  const schema = await import(pathToFileURL(join(root,'apps/api/dist/db/schema.js')).href);
  const { eq } = require('drizzle-orm');
  app = (await import(pathToFileURL(join(root,'apps/api/dist/app.js')).href)).buildApp();
  const lanModule=await import(pathToFileURL(join(root,'apps/api/dist/domain/lan-connection.js')).href);
  const lanIdentity=await lanModule.loadLanIdentity(join(chromeProfile,'test-lan-identity.json'));
  lanModule.configureLanConnection(lanIdentity.cert,3443);
  app.log.level = 'silent';
  const api = async (path, payload, headers = {}) => {
    const response = await app.inject({ method: payload ? 'POST' : 'GET', url: path, headers, ...(payload && { payload }) });
    assert.ok(response.statusCode < 300, response.body); return response.json();
  };
  const auth = await api('/api/v1/dev/token', {});
  const headers = { authorization: `Bearer ${auth.accessToken}` };
  const station = await api('/api/v1/production/stations/register', { stationCode: 'BROWSER-QA', name: 'Browser test station' }, headers);
  headers['x-station-key'] = station.stationCredential;
  const batch = await api('/api/v1/production/batches', { batchCode: 'BROWSER-QA', productVariantId: 'ONEINFO-NFC-CARD', quantity: 1 }, headers);
  await api(`/api/v1/production/batches/${batch.id}/generate-qr`, {}, headers);
  await api(`/api/v1/production/batches/${batch.id}/confirm-print`, { confirmed: true }, headers);
  const [card] = await connection.db.select().from(schema.cards);
  const pendingAdminBatch = await api('/api/v1/production/batches',{batchCode:'ADMIN-UNPRINTED-QA',productVariantId:'ONEINFO-NFC-CARD',quantity:1},headers);
  await connection.db.update(schema.cards).set({ qcStatus: 'PASSED', nfcStatus: 'WRITTEN', lifecycleStatus: 'QC_PASSED', inventoryStatus: 'SALEABLE' }).where(eq(schema.cards.id, card.id));
  await connection.db.update(schema.productionJobs).set({status:'COMPLETED',completedAt:new Date()}).where(eq(schema.productionJobs.cardId,card.id));
  const secret = await api(`/api/v1/customer/cards/${card.id}/activation-code`, {}, headers);
  const catalog = await fetch('http://127.0.0.1:3001/api/v1/products/public').then(r => r.json());
  assert.ok(catalog.items.length, 'Published storefront products needed for UI audit');
  // This is the guarded disposable database: replace migration seed IDs with the read-only catalog fixture.
  await connection.db.delete(schema.products);
  for(const {createdAt,updatedAt,...product} of catalog.items)await connection.db.insert(schema.products).values(product).onConflictDoUpdate({target:schema.products.id,set:product});
  await connection.db.insert(schema.storeShippingSettings).values({id:'default',rates:{insideDhaka:6000,subDhaka:10000,outsideDhaka:12000},codAdvanceTaka:0}).onConflictDoUpdate({target:schema.storeShippingSettings.id,set:{codAdvanceTaka:0}});
  const nativeFetch=globalThis.fetch;
  const emails=[];
  globalThis.fetch=(url,...args)=>{
    if(String(url)!=='https://api.resend.com/emails')return nativeFetch(url,...args);
    emails.push(JSON.parse(args[0].body));
    return Promise.resolve(Response.json({id:'ui-test-email'}));
  };
  const product=catalog.items[0],variant=product.variants.find(v=>v.available);
  const uiOrder = await api('/api/v1/orders',{requestId:crypto.randomUUID(),customer:{name:'UI audit buyer',email:'ui-audit@example.com',phone:'01712345678'},deliveryAddress:{district:'Dhaka',dhakaArea:'city',addressLine:'UI test address'},shippingMinor:6000,items:[{productId:product.id,variantId:variant.id,quantity:1,unitPriceMinor:variant.salePriceMinor??variant.priceMinor}]});
  await api('/api/v1/profiles',{publicSlug:'ui-audit-profile',displayName:'UI Audit Profile',headline:'Profile with longer description for responsive checks',company:'Oneinfo',links:[{label:'Portfolio',url:'https://example.com'}]},headers);
  const pairing=await api('/api/v1/local-nfc/pairings',{},headers);
  const device=await api('/api/v1/local-nfc/devices/pair',{pairingCode:pairing.pairingCode,deviceName:'UI audit NFC device'},headers);
  const deviceHeaders={'x-oneinfo-device-token':device.deviceToken};
  globalThis.uiHeartbeat=setInterval(()=>void app.inject({method:'GET',url:'/api/v1/local-nfc/device/status',headers:deviceHeaders}),5000);
  chrome = spawn(chromePath, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${chromeProfile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeError = '';
  chrome.stderr.on('data', data => { chromeError = (chromeError + data).slice(-8000); });
  chrome.on('error', error => { chromeError = error.message; });
  for (let i = 0; i < 300 && !existsSync(join(chromeProfile, 'DevToolsActivePort')) && chrome.exitCode === null && chrome.signalCode === null; i++) await delay(100);
  assert.ok(existsSync(join(chromeProfile, 'DevToolsActivePort')), `Chrome did not start (exit ${chrome.exitCode}, signal ${chrome.signalCode}): ${chromeError}`);
  const port = readFileSync(join(chromeProfile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let seq = 0, requestedWidth = 390; const waiting = new Map(); const browserErrors = []; const adminReads = [];
  let failProfileSave=false,failOverview=false,expirePairingSoon=false;
  const backupBytes=Buffer.from('PGDMP browser-only backup fixture');
  const backupId=crypto.randomUUID();
  const backupFixture={id:backupId,fileName:`oneinfo-database-2026-11-11T00-00-00-000Z-${backupId}.dump`,createdAt:'2026-11-11T00:00:00.000Z',database:'browser_fixture',source:'Docker',bytes:backupBytes.length,sha256:require('node:crypto').createHash('sha256').update(backupBytes).digest('hex')};
  let backupSaved=false,backupFailure=false,backupCorrupt=false;
  let contactFailure='none';const contactAttempts=[];
  function command(method, params = {}) {
    if(method==='Emulation.setDeviceMetricsOverride')requestedWidth=params.width;
    return new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  }
  socket.onmessage = async event => {
    const msg = JSON.parse(event.data);
    if (msg.id) { const pending = waiting.get(msg.id); waiting.delete(msg.id); if (msg.error) pending.reject(new Error(JSON.stringify(msg.error))); else pending.resolve(msg.result); }
    if (msg.method === 'Runtime.exceptionThrown') browserErrors.push(msg.params.exceptionDetails.text);
    if (msg.method === 'Fetch.requestPaused') {
      const paused = msg.params;
      try {
        const url = new URL(paused.request.url);
        if(paused.request.method==='GET'&&url.pathname.startsWith('/api/v1/admin/'))adminReads.push(url.pathname);
        if(url.pathname==='/api/v1/company/public/127.0.0.1')url.pathname='/api/v1/company/public/team-ui.example';
        const contactShare=paused.request.method==='POST'&&url.pathname.endsWith('/contact-leads');
        if(contactShare)contactAttempts.push(JSON.parse(paused.request.postData));
        const failed=(contactShare&&contactFailure==='before-save')||(failProfileSave&&url.pathname==='/api/v1/profiles'&&paused.request.method==='POST')||(failOverview&&url.pathname==='/api/v1/admin/overview');
        let backupResponse;
        if(url.pathname==='/api/v1/production/backups'){
          if(paused.request.method==='POST'&&backupFailure)backupResponse={statusCode:503,headers:{'content-type':'application/json'},body:JSON.stringify({message:'Backup tools unavailable; previous backups retained.'})};
          else {if(paused.request.method==='POST')backupSaved=true;backupResponse={statusCode:200,headers:{'content-type':'application/json'},body:JSON.stringify(paused.request.method==='POST'?backupFixture:{directory:'/private/oneinfo-ui/backups/database',items:backupSaved?[backupFixture]:[]})};}
        }else if(url.pathname===`/api/v1/production/backups/${backupId}/download`){const bytes=backupCorrupt?Buffer.from('damaged'):backupBytes;backupResponse={statusCode:200,headers:{'content-type':'application/octet-stream'},rawPayload:bytes,body:bytes.toString()};}
        if(backupResponse)backupResponse.headers={...backupResponse.headers,'access-control-allow-origin':paused.request.headers.origin??'http://127.0.0.1:5173','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'authorization,x-station-key,x-request-id,content-type'};
        const result = backupResponse??(failed?{statusCode:503,headers:{'content-type':'application/json','access-control-allow-origin':'http://127.0.0.1:5174'},body:JSON.stringify({message:'UI test connection failure'})}:await app.inject({ method: paused.request.method, url: url.pathname + url.search, headers: paused.request.headers,
          ...(paused.request.postDataEntries?.some(entry=>entry.bytes) ? {payload:Buffer.concat(paused.request.postDataEntries.map(entry=>Buffer.from(entry.bytes??'','base64')))} : paused.request.postData ? { payload: paused.request.postData } : {}) }));
        if(contactShare&&contactFailure==='after-save'){result.statusCode=503;result.body=JSON.stringify({message:'Saved response interrupted; retry your contact.'});result.headers['content-length']=String(Buffer.byteLength(result.body));}
        if(expirePairingSoon&&url.pathname==='/api/v1/local-nfc/pairings'&&result.statusCode===201){result.body=JSON.stringify({...JSON.parse(result.body),expiresAt:new Date(Date.now()+1500).toISOString()});expirePairingSoon=false;}
        await command('Fetch.fulfillRequest', { requestId: paused.requestId, responseCode: result.statusCode,
          responseHeaders: Object.entries(result.headers).map(([name, value]) => ({ name, value: String(value) })), body: (/^(image\/|application\/(zip|octet-stream))/.test(String(result.headers['content-type'])) ? result.rawPayload : Buffer.from(result.body)).toString('base64') });
      } catch (error) {
        if(closing||/Invalid InterceptionId/i.test(error.message))return;
        browserErrors.push(error.message);
        await command('Fetch.failRequest', { requestId: paused.requestId, errorReason: 'Failed' }).catch(failure=>{
          if(!closing&&!/Invalid InterceptionId/i.test(failure.message))browserErrors.push(failure.message);
        });
      }
    }
  };
  await command('Page.enable'); await command('Runtime.enable');
  await command('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.search.includes('ui-auth')){localStorage.removeItem('oneinfo.credentials');localStorage.removeItem('oneinfo.admin.token');}else{if(location.port==='5173')localStorage.setItem('oneinfo.credentials',${JSON.stringify(JSON.stringify({accessToken:auth.accessToken,stationKey:station.stationCredential}))});if(location.port==='5174')localStorage.setItem('oneinfo.admin.token',${JSON.stringify(auth.accessToken)});}`});
  await command('Fetch.enable', { patterns: [{ urlPattern: '*://*/api/v1/*', requestStage: 'Request' }] });
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true,userGesture:true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  async function until(expression) {
    for (let i = 0; i < 150; i++) { try {if (await evaluate(expression)) return;}catch(error){if(!/context|navigation/i.test(error.message))throw error;} await delay(100); }
    throw new Error('Browser check timed out: ' + await evaluate('document.body.innerText') + '\n' + browserErrors.join('\n'));
  }
  const fill = (label, value) => evaluate(`(() => {const l = [...document.querySelectorAll('label')].find(l => l.textContent.toLowerCase().includes(${JSON.stringify(label.toLowerCase())})); const el = l?.querySelector('input,textarea') || (l?.htmlFor ? document.getElementById(l.htmlFor) : l?.parentElement?.querySelector('input,textarea')); if(!el) throw Error('Missing field ' + ${JSON.stringify(label)}); const type = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(type.prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const click = async label => {await until(`[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&!b.disabled&&b.textContent.trim().toLowerCase()===${JSON.stringify(label.toLowerCase())})`);return evaluate(`(()=>{[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&!b.disabled&&b.textContent.trim().toLowerCase()===${JSON.stringify(label.toLowerCase())}).click()})()`);};
  const reload=async()=>{const before=await evaluate('performance.timeOrigin');await command('Page.reload');await until(`performance.timeOrigin!==${before}&&document.readyState==='complete'`);};
  const set = (selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing field '+${JSON.stringify(selector)});const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement:e instanceof HTMLSelectElement?HTMLSelectElement:HTMLInputElement;Object.getOwnPropertyDescriptor(p.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
  mkdirSync(root + '/.oneinfo/qa', { recursive: true });
  async function screenshot(name) { const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(root + '/.oneinfo/qa/' + name + '.png', Buffer.from(shot.data, 'base64')); }
  async function inspect(name){
    await delay(200);
    const data=await evaluate(`(()=>{const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,hiddenVisible:[...document.querySelectorAll('[hidden]')].filter(visible).map(e=>e.className),unlabelled:[...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(visible).filter(e=>!e.closest('label')&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')&&![...document.querySelectorAll('label[for]')].some(l=>l.htmlFor===e.id)).map(e=>e.placeholder||e.id||e.type),buttons:[...document.querySelectorAll('button')].filter(visible).filter(e=>!e.textContent.trim()&&!e.getAttribute('aria-label')).length}})()`);
    console.log(name,JSON.stringify(data));assert.ok(data.documentWidth<=requestedWidth+2,name+' overflows the requested viewport');assert.equal(data.hiddenVisible.length,0,name+' shows hidden panels');assert.equal(data.unlabelled.length,0,name+' has unlabelled fields');assert.equal(data.buttons,0,name+' has unlabelled buttons');await screenshot('audit-'+name);
  }
  const uploadPhoto = async () => {
  await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=900;canvas.height=600;const ctx=canvas.getContext('2d');ctx.fillStyle='#367c7a';ctx.fillRect(0,0,900,600);ctx.fillStyle='#f4d7a4';ctx.beginPath();ctx.arc(450,280,160,0,Math.PI*2);ctx.fill();const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const transfer=new DataTransfer();transfer.items.add(new File([blob],'portrait.png',{type:'image/png'}));const input=document.querySelector('input[aria-label="Upload profile photo"]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`!!document.querySelector('.photo-editor-avatar img') && !document.querySelector('input[aria-label="Upload profile photo"]').disabled`);
  assert.equal(await evaluate(`document.querySelector('.photo-editor-avatar img').src.includes('/api/v1/product-media/')`),true);
  };
  for(const width of [1440,768,390,320]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
    await command('Page.navigate',{url:'http://127.0.0.1:5174/'});await until(`!!document.querySelector('.sidebar')`);await delay(250);
    for(const label of ['Overview','Orders','Reviews','Products','Client profiles','Companies','Cards & inventory','Assigned cards','Production batches','Stations','Audit history','NFC & QR operations']){
      const found=await evaluate(`(()=>{const b=[...document.querySelectorAll('.sidebar nav button')].find(b=>b.textContent.trim().endsWith(${JSON.stringify(label)}));if(!b)return false;b.click();return true})()`);
      assert.equal(found,true,'Missing Admin navigation: '+label);
      await delay(350);await inspect('admin-'+label.replace(/[^a-z]/gi,'-')+'-'+width);
      if(label==='NFC & QR operations')assert.equal(await evaluate(`!!document.querySelector('.production-frame')`),true);
      if(width===1440&&label==='Cards & inventory'){
        await until(`document.querySelector('table')?.textContent.includes(${JSON.stringify(card.publicSlug)})`);
        assert.equal(await evaluate(`document.querySelector('table').textContent.includes('Generate secret code')`),false);
        await fill('Search cards','unmatched-card-filter');await until(`document.querySelectorAll('table tbody tr').length===0`);
        await fill('Search cards',card.publicSlug);await until(`document.querySelectorAll('table tbody tr').length===1`);
        await set('.production-controls select','SALEABLE');await until(`document.querySelectorAll('table tbody tr').length===0`);
        await set('.production-controls select','RESERVED');await until(`document.querySelectorAll('table tbody tr').length===1`);
        await set('.production-controls select','');await fill('Search cards','');
        await evaluate(`document.querySelector('.production-lookup').open=true`);await fill('QR link or card code',card.canonicalUrl.replace(/\?source=nfc$/,'?source=qr'));await click('Find card');await until(`document.querySelector('.lookup-result-row')?.textContent.includes(${JSON.stringify(card.publicSlug)})`);
        adminReads.length=0;await evaluate(`document.querySelector('.header-tools button').click()`);await delay(600);
        assert.ok(adminReads.includes('/api/v1/admin/cards'));assert.ok(!adminReads.includes('/api/v1/admin/batches')&&!adminReads.includes('/api/v1/admin/stations')&&!adminReads.includes('/api/v1/admin/audit-logs'));
        console.log('Inventory search/status/QR lookup, order-code guidance and scoped refresh PASS');
      }
      if(width===1440&&label==='Production batches'){
        await until(`document.querySelector('table')?.textContent.includes('ADMIN-UNPRINTED-QA')`);
        await set('.production-controls select','pending');await until(`document.querySelectorAll('table tbody tr').length===1&&document.querySelector('table').textContent.includes('ADMIN-UNPRINTED-QA')`);
        assert.equal(await evaluate(`document.querySelector('.button-reprint-pill').disabled`),true);
        await set('.production-controls select','confirmed');await until(`document.querySelectorAll('table tbody tr').length===1&&document.querySelector('table').textContent.includes('BROWSER-QA')&&!document.querySelector('.button-reprint-pill').disabled`);
        await click('Reprint');await until(`!!document.querySelector('.reprint-grid input')`);await click('Select all printable');assert.equal(await evaluate(`document.querySelectorAll('.reprint-grid input:checked').length`),1);await click('Clear selection');assert.equal(await evaluate(`document.querySelectorAll('.reprint-grid input:checked').length`),0);await click('Close reprint ×');
        await set('.production-controls select','all');console.log('Unconfirmed/confirmed batch filters and bulk reprint selection PASS');
      }
      if(width===1440&&label==='Stations'){
        await fill('Search stations','unmatched-station');await until(`document.querySelectorAll('.station-card-row').length===0`);await fill('Search stations','BROWSER-QA');await until(`document.querySelectorAll('.station-card-row').length===1`);
        assert.equal(await evaluate(`document.querySelectorAll('.button-station-recover').length`),0);
        await fill('Search stations','');console.log('Station search and safe idle-station controls PASS');
      }

      if(label==='Client profiles'){
        await evaluate(`document.querySelector('.list-toolbar button').focus();document.querySelector('.list-toolbar button').click()`);await inspect('admin-profile-editor-'+width);assert.equal(await evaluate(`document.querySelector('.editor-panel').contains(document.activeElement)`),true);
        if(width===1440){await uploadPhoto();await fill('Public slug','ui-created-profile');await fill('Display name','UI Created Profile');failProfileSave=true;await click('Save profile');await until(`!!document.querySelector('.profile-save-error')`);assert.equal(await evaluate(`document.querySelector('.editor-panel').contains(document.querySelector('[role=alert]'))`),true);failProfileSave=false;await click('Save profile');await until(`!document.querySelector('.editor-panel[open]')`);await evaluate(`document.querySelector('.list-toolbar button').focus();document.querySelector('.list-toolbar button').click()`);}
        await until(`document.querySelector('.editor-panel[open]')?.querySelector('[aria-label="Close profile editor"]')?.disabled===false&&document.querySelector('.editor-panel').contains(document.activeElement)`);
        await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await until(`!document.querySelector('.editor-panel[open]')`);console.log('profile-editor-escape PASS');
      }
      if(label==='Products'){const opened=await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Edit ')&&b.classList.contains('catalog-secondary'));if(!b)return false;b.click();return true})()`);if(opened){await delay(200);await inspect('admin-product-editor-'+width);for(const section of ['Details','Colours & prices','Media','Warranty','Publishing']){await evaluate(`(()=>{const b=[...document.querySelectorAll('.catalog-editor-nav button')].find(b=>b.textContent===${JSON.stringify(section)});b.click()})()`);assert.equal(await evaluate(`document.querySelectorAll('.catalog-section:not([hidden])').length`),1);}await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});}}
      if(label==='Orders'){
        await click('Settings');await until(`!!document.querySelector('.store-settings-dialog[open]')`);await inspect('admin-order-settings-'+width);
        if(width===1440){await click('Save payment settings');await until(`document.body.innerText.includes('COD advance saved.')`);await click('Save rates');await until(`document.body.innerText.includes('Delivery rates saved.')`);await fill('Coupon code','UICHECK');await fill('Discount (%)','15');await click('Save coupon');await until(`document.body.innerText.includes('UICHECK saved.')`);}
        await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await until(`!document.querySelector('.store-settings-dialog[open]')`);
        await evaluate(`document.querySelector('.store-order summary').click()`);assert.equal(await evaluate(`document.querySelector('.store-order').open`),true);
        await click('Show secret codes');await until(`document.querySelector('.order-packing code')?.textContent.includes('-')`);
        await inspect('admin-order-secret-codes-'+width);
        if(width===1440){
          assert.equal(await evaluate(`[...document.querySelectorAll('.order-packing button')].find(b=>b.textContent==='Confirm package').disabled`),true);
          await evaluate(`window.__originalOpen=window.open;window.open=()=>({opener:null,document:{write(html){window.__activationSlipHtml=html},close(){},querySelector(){return {addEventListener(){}}}}})`);
          await click('Print activation slips');
          assert.equal(await evaluate(`window.__activationSlipHtml.includes(document.querySelector('.order-packing code').textContent)`),true);
          assert.equal(await evaluate(`(window.__activationSlipHtml.match(/<article>/g)||[]).length`),1);
          await evaluate(`window.open=window.__originalOpen`);
          await evaluate(`document.querySelector('.order-packing input[type=checkbox]').click()`);await click('Confirm package');
          await until(`document.querySelector('.order-packing')?.textContent.includes('Package confirmed.')`);
          assert.equal((await connection.db.select().from(schema.orderCardAllocations)).length,0);
          console.log('Order temporary profile/secret slips/manual package confirmation without QR assignment PASS');
        }

      }
    }
    if(width===1440){await evaluate(`location.hash='cards'`);await until(`document.querySelector('.workspace-header h1')?.textContent==='Cards & inventory'`);await reload();await until(`document.querySelector('.workspace-header h1')?.textContent==='Cards & inventory'`);failOverview=true;await evaluate(`document.querySelector('.header-tools button').click()`);await until(`!!document.querySelector('.workspace-error')`);failOverview=false;await click('Retry connection');await until(`!document.querySelector('.workspace-error')`);}
    await command('Page.navigate',{url:'http://127.0.0.1:5173/'});await until(`!!document.querySelector('.workspace-nav')`);await delay(250);
    await until(`!![...document.querySelectorAll('.batch-toolbar select option')].find(o=>o.value===${JSON.stringify(batch.id)})`);
    await set('.batch-toolbar select',batch.id);await until(`!!document.querySelector('.selected-production-card')`);
    if(width===1440){
      const scannedBatch=await api('/api/v1/production/batches',{batchCode:'PHONE-SCAN-QA',productVariantId:'ONEINFO-NFC-CARD',quantity:2},headers);
      await api(`/api/v1/production/batches/${scannedBatch.id}/generate-qr`,{},headers);
      const detail=await api(`/api/v1/production/batches/${scannedBatch.id}`,null,headers);
      const target=detail.cards[1];
      await set('.card-search input','no matching card');await set('.card-search select','passed');
      await evaluate(`location.hash='tools'`);await until(`!!document.querySelector('.tool-editor')`);
      const scannedQr=target.canonicalUrl.replace(/\?source=nfc$/,'?source=qr');
      await api('/api/v1/local-nfc/device/resolve-qr',{scanId:crypto.randomUUID(),scannedValue:scannedQr},deviceHeaders);
      await until(`location.hash==='#production'&&document.querySelector('.batch-toolbar select').value===${JSON.stringify(scannedBatch.id)}&&document.querySelector('.selected-production-card')?.textContent.includes(${JSON.stringify(target.publicSlug)})`);
      assert.equal(await evaluate(`document.querySelector('.card-search input').value`),'');
      assert.equal(await evaluate(`document.querySelector('.card-search select').value`),'all');
      await evaluate(`document.querySelector('.production-card-list button').click()`);await delay(2500);
      assert.equal(await evaluate(`document.querySelector('.selected-production-card').textContent.includes(${JSON.stringify(detail.cards[0].publicSlug)})`),true);
      await api('/api/v1/local-nfc/device/resolve-qr',{scanId:crypto.randomUUID(),scannedValue:scannedQr},deviceHeaders);
      await until(`document.querySelector('.selected-production-card')?.textContent.includes(${JSON.stringify(target.publicSlug)})`);
      for(const item of detail.cards)await connection.db.delete(schema.cardEvents).where(eq(schema.cardEvents.cardId,item.id));
      await set('.batch-toolbar select',batch.id);await until(`document.querySelector('.selected-production-card')?.textContent.includes(${JSON.stringify(card.publicSlug)})`);
      console.log('Phone QR auto-selects batch/card, clears filters, opens Production, and preserves later manual selection PASS');
    }
    for(const label of ['Production','NFC tools','Connection','Backups']){
      await evaluate(`(()=>{const b=[...document.querySelectorAll('.workspace-nav button')].find(b=>b.textContent.endsWith(${JSON.stringify(label)}));b.click();})()`);await inspect('production-'+label.replaceAll(' ','-')+'-'+width);
      if(label==='Production'){
        await evaluate(`[...document.querySelectorAll('.batch-toolbar button')].find(b=>b.textContent==='Delete batch').focus()`);
        await click('Delete batch');await until(`!!document.querySelector('.stock-delete-dialog[open]')`);
        await inspect('production-delete-batch-dialog-'+width);
        await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await until(`!document.querySelector('.stock-delete-dialog[open]')`);
        assert.equal(await evaluate(`document.activeElement.textContent.trim()`),'Delete batch');
      }
      if(label==='Production'&&width===1440){
        await fill('Batch code','UI-BULK');await fill('Number of cards','3');await click('Create batch');await until(`document.querySelector('.batch-toolbar select')?.selectedOptions[0]?.textContent.includes('UI-BULK')&&!!document.querySelector('.selected-production-card')`);
        const selectedBatch=await evaluate(`document.querySelector('.batch-toolbar select').value`);assert.equal(await evaluate(`new URL(location.href).searchParams.get('batch')`),selectedBatch);await reload();await until(`document.querySelector('.batch-toolbar select')?.value===${JSON.stringify(selectedBatch)}&&!!document.querySelector('.selected-production-card')`);
        assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Download all SVG + EPS (ZIP)').disabled`),true);
        await click('Generate all QR codes');await until(`document.querySelectorAll('.production-card-list button').length===3&&[...document.querySelectorAll('.production-card-list small')].every(e=>e.textContent.includes('QR ready'))`);
        await evaluate(`window.__qrArchive=null;window.__qrDownload='';const makeUrl=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{window.__qrArchive=blob;return makeUrl(blob)};const nativeClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__qrDownload=this.download;return nativeClick.call(this)}`);
        await click('Download all SVG + EPS (ZIP)');await until(`!!window.__qrArchive&&window.__qrDownload==='UI-BULK-qr-svg-eps.zip'&&![...document.querySelectorAll('button')].find(b=>b.textContent==='Generate all QR codes').disabled`);
        assert.deepEqual(await evaluate(`window.__qrArchive.arrayBuffer().then(buffer=>{const v=new DataView(buffer);return [v.getUint32(0,true),v.getUint16(buffer.byteLength-12,true)]})`),[0x04034b50,6]);
        const vectorZip=(await app.inject({url:`/api/v1/production/batches/${selectedBatch}/qr-export.zip`,headers})).rawPayload;
        const svgStart=30+vectorZip.readUInt16LE(26),svgBytes=inflateRawSync(vectorZip.subarray(svgStart,svgStart+vectorZip.readUInt32LE(18)));
        const renderedSvg=await evaluate(`new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=512;canvas.getContext('2d').drawImage(image,0,0);resolve(canvas.toDataURL('image/png').split(',')[1])};image.onerror=()=>reject(Error('SVG load failed'));image.src='data:image/svg+xml;base64,${svgBytes.toString('base64')}'})`);
        const svgPng=require('pngjs').PNG.sync.read(Buffer.from(renderedSvg,'base64'));
        const expectedSvg=(await app.inject({url:`/api/v1/production/batches/${selectedBatch}`,headers})).json().cards[0].canonicalUrl.replace(/\?source=nfc$/,'?source=qr');
        assert.equal(require('jsqr')(new Uint8ClampedArray(svgPng.data),512,512)?.data,expectedSvg);
        console.log('One-click full batch SVG/EPS ZIP download and browser-rendered SVG decoding PASS');
        await evaluate(`window.__printCalled=false;window.print=()=>{window.__printCalled=true}`);await click('Print selected QR');await until(`window.__printCalled`);assert.equal(await evaluate(`document.querySelectorAll('.print-label').length`),1);await click('Print full batch');await until(`document.querySelectorAll('.print-label').length===3`);
        await command('Emulation.setEmulatedMedia',{media:'print'});assert.equal(await evaluate(`getComputedStyle(document.querySelector('.production-print')).display`),'block');await screenshot('audit-print-qr');await command('Emulation.setEmulatedMedia',{media:''});
        await evaluate(`document.querySelector('.print-confirmation input').click()`);await click('Confirm printed batch');await until(`document.querySelector('.print-confirmation h2')?.textContent==='Printed stock confirmed'`);console.log('Bulk QR create/generate/single/full print/confirmation PASS');
        const bulkId=await evaluate(`document.querySelector('.batch-toolbar select').value`);
        const bulkRows=await connection.db.select().from(schema.cards).where(eq(schema.cards.batchId,bulkId));
        await click('Delete QR & link');await until(`!!document.querySelector('.stock-delete-dialog[open]')`);
        await inspect('production-delete-card-dialog-'+width);
        assert.equal(await evaluate(`[...document.querySelectorAll('.stock-delete-dialog button')].find(b=>b.textContent==='Delete permanently').disabled`),true);
        await fill('Type','wrong ID');assert.equal(await evaluate(`[...document.querySelectorAll('.stock-delete-dialog button')].find(b=>b.textContent==='Delete permanently').disabled`),true);
        await click('Cancel');assert.equal((await connection.db.select().from(schema.cards).where(eq(schema.cards.batchId,bulkId))).length,3);
        await click('Delete QR & link');await until(`!!document.querySelector('.stock-delete-dialog[open]')`);
        const deletionSlug=await evaluate(`document.querySelector('.stock-delete-dialog strong').textContent`);
        await fill('Type',deletionSlug);await click('Delete permanently');await until(`!document.querySelector('.stock-delete-dialog[open]')&&document.querySelectorAll('.production-card-list button').length===2`);
        assert.equal((await connection.db.select().from(schema.cards).where(eq(schema.cards.batchId,bulkId))).length,2);
        assert.equal((await app.inject('/api/v1/customer/cards/'+deletionSlug)).statusCode,404);
        const retained=(await connection.db.select().from(schema.cards).where(eq(schema.cards.batchId,bulkId)))[0];
        await connection.db.update(schema.cards).set({inventoryStatus:'RESERVED'}).where(eq(schema.cards.id,retained.id));
        await evaluate(`[...document.querySelectorAll('.production-card-list button')].find(button=>button.textContent.includes(${JSON.stringify(retained.publicSlug)})).click()`);
        await click('Delete batch');await until(`!!document.querySelector('.stock-delete-dialog[open]')`);
        assert.equal(await evaluate(`document.querySelector('#stock-delete-title').textContent`),'Delete unused cards from batch');
        await fill('Type',await evaluate(`document.querySelector('.stock-delete-dialog strong').textContent`));await click('Delete permanently');
        await until(`!document.querySelector('.stock-delete-dialog[open]')&&document.querySelectorAll('.production-card-list button').length===1&&document.body.innerText.includes('Kept 1 protected card.')`);
        assert.equal((await connection.db.select().from(schema.cards).where(eq(schema.cards.batchId,bulkId)))[0].id,retained.id);
        assert.equal(await evaluate(`document.querySelector('.selected-production-card').textContent.includes(${JSON.stringify(retained.publicSlug)})`),true);
        await click('Delete batch');await until(`!!document.querySelector('.stock-delete-dialog[open]')`);
        await fill('Type',await evaluate(`document.querySelector('.stock-delete-dialog strong').textContent`));await click('Delete permanently');
        await until(`document.querySelector('.stock-delete-error')?.textContent.includes('No unused cards')`);await click('Cancel');
        await connection.db.update(schema.cards).set({inventoryStatus:'NOT_READY'}).where(eq(schema.cards.id,retained.id));
        console.log('Mixed batch deletes unused cards, keeps reserved card/selection, and reports protected count PASS');

        await click('Delete batch');await until(`!!document.querySelector('.stock-delete-dialog[open]')`);
        await fill('Type',await evaluate(`document.querySelector('.stock-delete-dialog strong').textContent`));await click('Delete permanently');
        await until(`!document.querySelector('.stock-delete-dialog[open]')&&!document.querySelector('.selected-production-card')`);
        assert.equal((await connection.db.select().from(schema.cards).where(eq(schema.cards.batchId,bulkId))).length,0);
        assert.equal((await app.inject({url:'/api/v1/admin/batches/'+bulkId+'/reprint',headers})).statusCode,404);
        assert.equal(bulkRows.length,3);
        console.log('Production deletion confirmation/cancel, single QR removal, full confirmed batch removal and Admin sync PASS');
      }
      if(label==='Connection'){
        expirePairingSoon=width===1440;
        await click('Create connection QR');await until(`!!document.querySelector('.lan-pairing img')`);await inspect('production-lan-qr-'+width);
        assert.equal(await evaluate(`document.querySelector('.lan-pairing img').getAttribute('src').startsWith('data:image/png;base64,')`),true);
        assert.equal(await evaluate(`document.querySelector('.connection-details details').open`),false);
        if(width===1440){await until(`document.querySelector('.lan-pairing').textContent.includes('QR expired')&&!document.querySelector('.lan-pairing img')`);await click('New connection QR');await until(`!!document.querySelector('.lan-pairing img')`);console.log('Connection QR expiry and refresh PASS');}
      }
      if(label==='Backups'&&width===1440){
        await until(`![...document.querySelectorAll('button')].find(b=>b.textContent==='Back up database & download').disabled`);
        backupFailure=true;await click('Back up database & download');await until(`document.querySelector('.database-backups [role=alert]')?.textContent.includes('Backup tools unavailable')`);await delay(600);assert.equal(await evaluate(`!!document.querySelector('.database-backups [role=alert]')`),true);
        backupFailure=false;await evaluate(`window.__backupBlob=null;window.__backupFilename='';const create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{window.__backupBlob=blob;return create(blob)};const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__backupFilename=this.download;return click.call(this)}`);
        await click('Back up database & download');await until(`!!window.__backupBlob&&!!document.querySelector('.backup-record')&&!document.querySelector('.database-backups button').disabled`);assert.equal(await evaluate(`window.__backupFilename`),backupFixture.fileName);assert.equal(await evaluate(`window.__backupBlob.size`),backupFixture.bytes);
        await click('Refresh backups');await until(`!!document.querySelector('.backup-record')&&!document.querySelector('.database-backups button').disabled`);
        backupCorrupt=true;await click('Download backup');await until(`document.querySelector('.database-backups [role=alert]')?.textContent.includes('integrity check')`);assert.equal(await evaluate(`document.querySelectorAll('.backup-record').length`),1);backupCorrupt=false;
        console.log('Database backup create/download/history, persistent errors and corrupt download rejection PASS (browser fixture; no production dump invoked)');
      }
      if(label==='NFC tools'&&width===1440){
        const complete=async(operation,value)=>{const task=await api('/api/v1/local-nfc/device/read-tasks/next',undefined,deviceHeaders);assert.equal(task.utility.operation,operation);const records=operation==='ERASE'?[{tnf:0,type:'',payloadHex:''}]:[{tnf:1,type:'U',payloadHex:'00',uri:value}];await api(`/api/v1/local-nfc/device/read-tasks/${task.sessionId}/result`,{uid:'AABBCCDD',techList:['Ndef'],ndefFormatted:true,writable:true,maxSize:888,messageSize:42,records},deviceHeaders);await until(`!!document.querySelector('.tag-facts')&&document.querySelector('.tag-facts').textContent.includes('AABBCCDD')`);};
        await click('Read NFC tag');await until(`!!document.querySelector('.waiting-banner')`);await complete('READ','https://example.com/read');
        await set('.tool-editor textarea','invalid URL');await evaluate(`document.querySelector('.overwrite-confirm input').click()`);await click('Write & verify tag');await until(`!!document.querySelector('.tool-error[role=alert]')`);await delay(1700);assert.equal(await evaluate(`!!document.querySelector('.tool-error[role=alert]')`),true);
        await set('.tool-editor textarea','https://example.com/write');assert.equal(await evaluate(`document.querySelector('.tool-editor form button').disabled`),true);await evaluate(`document.querySelector('.overwrite-confirm input').click()`);await click('Write & verify tag');await until(`!!document.querySelector('.waiting-banner')`);await complete('WRITE','https://example.com/write');await until(`!document.querySelector('.waiting-banner')`);
        await evaluate(`[...document.querySelectorAll('.overwrite-confirm input')].at(-1).click()`);await click('Erase NFC tag');await until(`!!document.querySelector('.waiting-banner')`);await complete('ERASE','');await until(`!document.querySelector('.waiting-banner')`);
        await click('Read NFC tag');await until(`!!document.querySelector('.waiting-banner')`);await click('Stop waiting');await until(`!document.querySelector('.waiting-banner')`);console.log('NFC read/write/erase/cancel/error-persistence PASS (isolated bridge fixture)');
      }
    }
    await command('Page.navigate',{url:'http://127.0.0.1:5175/'});await until(`!!document.querySelector('.product-grid .product')`);await inspect('storefront-home-'+width);
    await evaluate(`document.querySelector('.product-link').click()`);await until(`!!document.querySelector('#product-title')`);await inspect('storefront-product-'+width);
    const added=await evaluate(`(()=>{const b=document.querySelector('#product-detail .add-to-cart');if(!b)return false;b.click();return true})()`);console.log('storefront-added',added);
    await evaluate(`document.querySelector('.cart-trigger').click()`);await inspect('storefront-cart-'+width);
    await evaluate(`document.querySelector('.cart-close').click();location.hash='order-draft'`);await delay(250);await inspect('storefront-checkout-'+width);
    if(width===1440){
      await set('#order-form input[name=name]','UI Checkout Buyer');await set('#order-phone','01712345678');await set('#order-email','checkout-ui@example.com');await set('#order-form [name=addressLine]','UI test address, Dhaka');await set('#order-form [name=district]','Dhaka');
      await evaluate(`document.querySelector('.order-coupon-toggle').click()`);await set('#order-coupon-form [name=code]','UICHECK');await evaluate(`document.querySelector('#order-coupon-form').requestSubmit()`);await until(`document.querySelector('.order-coupon-status').textContent.includes('15')`);
      await evaluate(`document.querySelector('[name=paymentMethod][value=BKASH]').click();document.querySelector('#order-form').requestSubmit()`);await until(`location.hash==='#arisepay'&&!document.querySelector('#arisepay-form').hidden`);await inspect('storefront-payment-'+width);
      const [reservation]=await connection.db.select().from(schema.storeOrders).where(eq(schema.storeOrders.awaitingPayment,true));
      assert.ok(reservation,'Checkout must reserve stock before displaying payment instructions');
      await set('#arisepay-transaction','UICHECK123456');await click('Submit payment for verification');await until(`!document.querySelector('.order-saved').hidden`);assert.ok(await evaluate(`document.querySelector('.order-receipt-activation').textContent.includes('private secret code')`));await inspect('storefront-order-receipt-'+width);console.log('Storefront coupon/bKash submission/order receipt PASS (test transaction, no payment sent)');
      const [finalized]=await connection.db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id,reservation.id));
      assert.equal(finalized.awaitingPayment,false);
    }
  }
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  for(const width of [1440,320]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
    await command('Page.navigate',{url:'http://127.0.0.1:5174/?ui-auth=1'});await until(`!!document.querySelector('.auth-card')`);await inspect('admin-auth-'+width);
    if(await evaluate(`!!document.querySelector('.admin-login')`)){await fill('Email','admin-ui@example.com');await fill('Password',adminTestPassword);await click('Sign in');}
    else await click('Enter development workspace');
    await until(`!!document.querySelector('.sidebar')`);
    await command('Page.navigate',{url:'http://127.0.0.1:5173/?ui-auth=1'});await until(`!!document.querySelector('.setup-panel')`);await inspect('production-setup-'+width);
    await fill('Station code','BROWSER-QA');await click('Register workstation');await until(`document.querySelector('.setup-error')?.textContent.includes('already registered')`);await inspect('production-duplicate-station-'+width);
    await fill('Station code','UI-REGISTER-'+width);await click('Register workstation');await until(`!!document.querySelector('.workspace-nav')`);assert.equal(await evaluate(`!!document.querySelector('.setup-error')`),false);
  }
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const flexBatch = await api('/api/v1/production/batches',{batchCode:'UI-ANY-CARD',productVariantId:'ONEINFO-NFC-CARD',quantity:1},headers);
  await api(`/api/v1/production/batches/${flexBatch.id}/generate-qr`,{},headers);
  await api(`/api/v1/production/batches/${flexBatch.id}/confirm-print`,{confirmed:true},headers);
  const [flexCard] = await connection.db.select().from(schema.cards).where(eq(schema.cards.batchId,flexBatch.id));
  await connection.db.update(schema.cards).set({qcStatus:'PASSED',nfcStatus:'WRITTEN',lifecycleStatus:'QC_PASSED',inventoryStatus:'SALEABLE'}).where(eq(schema.cards.id,flexCard.id));
  const orderCodes=(await api(`/api/v1/orders/admin/${uiOrder.id}/activation-codes`,{},headers)).items;
  await command('Page.navigate',{url:`http://127.0.0.1:5174/c/${flexCard.publicSlug}`});
  await until(`document.querySelector('h1')?.textContent==='Activate your card'`);
  await fill('Secret code',orderCodes[0].secretCode);await click('Activate & continue');
  await until(`document.querySelector('h1')?.textContent==='Create your account'`);
  await fill('Account email','flex-browser@example.com');await fill('Password','a secure browser test password');await fill('Full name','Flexible Card Client');
  await uploadPhoto();await click('Create account & save profile');await until(`document.querySelector('h1')?.textContent==='Flexible Card Client'`);
  assert.equal((await api(`/api/v1/customer/cards/${flexCard.publicSlug}`)).profile.id,orderCodes[0].profileId);
  await inspect('customer-order-secret-activation');
  await evaluate('sessionStorage.clear()');
  console.log('Any ready card + order secret → existing temporary profile → account/photo/public profile PASS');
  const url = `http://127.0.0.1:5174/c/${card.publicSlug}`;
  await command('Page.navigate', { url });
  await until(`document.querySelector('h1')?.textContent === 'Activate your card'`);
  await screenshot('customer-activation');
  await fill('Secret code', secret.secretCode); await click('Activate & continue');
  await until(`document.querySelector('h1')?.textContent === 'Create your account'`);
  await screenshot('customer-signup');
  await fill('Account email', 'browser-owner@example.com'); await fill('Password', 'a secure browser test password');
  await fill('Full name', 'Browser Test Owner'); await fill('Headline', 'Profile verified in browser');
  await uploadPhoto();
  await click('Create account & save profile');
  await until(`document.querySelector('h1')?.textContent === 'Browser Test Owner'`);
  await until(`location.pathname === '/BrowserTestOwner'`);
  await reload();
  await until(`document.querySelector('h1')?.textContent === 'Browser Test Owner'`);
  assert.equal(await evaluate(`document.body.innerText.includes('browser-owner@example.com')`), false);
  await until(`document.querySelector('.public-avatar img')?.naturalWidth === 600`);
  await screenshot('customer-public-profile');
  await evaluate(`document.querySelector('.share-contact').open=true`);
  for(const width of [320,390,1440]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
    assert.equal(await evaluate(`document.querySelector('.share-contact-submit, .submit-lead-btn, .share-contact button[type=submit]').getBoundingClientRect().width > 0`),true);
    await inspect('customer-share-contact-'+width);
  }
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await fill('Your Full Name','Browser Visitor');await click('Send my contact');
  await until(`document.querySelector('.share-contact [role=alert]')?.textContent.includes('email address or phone')`);assert.equal(contactAttempts.length,0);
  await fill('Email','visitor@example.com');contactFailure='before-save';await click('Send my contact');
  await until(`!!document.querySelector('.share-contact [role=alert]')`);await click('Send my contact');
  await until(`!!document.querySelector('.share-contact [role=alert]')`);assert.equal(contactAttempts.length,2);assert.equal(contactAttempts[0].requestId,contactAttempts[1].requestId);
  await fill('Phone','+8801712345678');contactFailure='after-save';await click('Send my contact');
  await until(`document.querySelector('.share-contact [role=alert]')?.textContent.includes('interrupted')`);assert.notEqual(contactAttempts[1].requestId,contactAttempts[2].requestId);
  contactFailure='none';await click('Send my contact');await until(`document.querySelector('.share-contact [role=status]')?.textContent.includes('private inbox')`);
  assert.equal(contactAttempts[2].requestId,contactAttempts[3].requestId);
  const savedContacts=await connection.db.select().from(schema.customerContactLeads);assert.equal(savedContacts.length,1);assert.equal(savedContacts[0].phone,'+8801712345678');
  await click('Manage this card');
  await until(`document.querySelector('h1')?.textContent.includes('Edit')`);
  await click('Open inbox');await until(`document.querySelector('.lead-inbox')?.textContent.includes('Browser Visitor')`);
  assert.equal(await evaluate(`document.querySelector('.lead-inbox').textContent.includes('visitor@example.com')`),true);
  console.log('Contact share consent/validation, retry recovery, duplicate prevention and private owner inbox PASS');
  await reload();await until(`document.querySelector('h1')?.textContent.includes('Edit')`);
  assert.equal(await evaluate(`document.querySelector('input[autocomplete=name]').value`),'Browser Test Owner');
  const previousPhoto=await evaluate(`document.querySelector('.photo-editor-avatar img').src`);await uploadPhoto();assert.notEqual(await evaluate(`document.querySelector('.photo-editor-avatar img').src`),previousPhoto);
  await click('Remove photo');assert.equal(await evaluate(`!!document.querySelector('.photo-editor-avatar img')`),false);
  await fill('Full name', 'Updated Browser Owner'); await click('Save profile');
  await until(`document.querySelector('h1')?.textContent === 'Updated Browser Owner'`);
  assert.equal(await evaluate(`document.body.innerText.includes('visitor@example.com')`),false);
  assert.equal(await evaluate(`!!document.querySelector('.public-avatar img')`),false);
  await evaluate('sessionStorage.clear()'); await command('Page.navigate', { url });
  await until(`document.querySelector('h1')?.textContent === 'Updated Browser Owner'`);
  assert.equal(browserErrors.length, 0, browserErrors.join('\n'));
  console.log('PASS: Admin/activation/owner photo upload, public image, replacement/removal; signup → owner edit → fresh scan; private email hidden.');
  await command('Page.navigate',{url:'http://127.0.0.1:5174/#cards'});await until(`!!document.querySelector('table[aria-label="Unassigned printed QR stock"]')`);
  await until(`!document.querySelector('table[aria-label="Unassigned printed QR stock"]').textContent.includes(${JSON.stringify(card.publicSlug)})`);
  await evaluate(`location.hash='assigned'`);await until(`document.querySelector('table[aria-label="Assigned client cards"]')?.textContent.includes(${JSON.stringify(card.publicSlug)})`);
  assert.equal(await evaluate(`document.querySelector('table[aria-label="Assigned client cards"]').textContent.includes('Updated Browser Owner')`),true);
  assert.equal(await evaluate(`document.querySelector('table[aria-label="Assigned client cards"]').textContent.includes('Generate secret code')`),false);
  await inspect('admin-assigned-client-cards');
  console.log('Activated client card moves from inventory to Assigned cards with owner and lifecycle status PASS');

  await command('Page.navigate',{url:'http://127.0.0.1:5173/?batch='+batch.id});
  await until(`document.querySelector('.selected-production-card')?.textContent.includes(${JSON.stringify(card.publicSlug)})`);
  await click('Delete QR & link');await until(`!!document.querySelector('.stock-delete-dialog[open]')`);
  await fill('Type',card.publicSlug);await click('Delete permanently');await until(`document.querySelector('.stock-delete-error')?.textContent.includes('assigned or reserved')`);
  assert.equal((await connection.db.select().from(schema.cards).where(eq(schema.cards.id,card.id))).length,1);
  await click('Cancel');console.log('Assigned client card remains protected with an inline deletion error PASS');
  const company=await api('/api/v1/company/admin',{name:'Browser Team',ownerEmail:'browser-owner@example.com',domain:'team-ui.example'},headers);
  await command('Page.navigate',{url:'http://127.0.0.1:5174/team?manage=1'});await until(`!!document.querySelector('input[name=email]')`);
  await fill('Account email','browser-owner@example.com');await fill('Password','a secure browser test password');await click('Sign in');
  await until(`document.body.innerText.includes('Branding and profile defaults')`);
  await fill('CSV contents','name,email,headline\nBrowser Employee,employee@example.com,Designer');await click('Import employees');
  await until(`document.querySelector('.team-list')?.textContent.includes('Browser Employee')`);
  await until(`document.querySelector('.team-list')?.textContent.includes('Welcome email queued')`);
  const companyBatch=await api('/api/v1/production/batches',{batchCode:'TEAM-BROWSER-QA',productVariantId:'ONEINFO-NFC-CARD',quantity:1},headers);
  await api(`/api/v1/production/batches/${companyBatch.id}/generate-qr`,{},headers);
  await api(`/api/v1/production/batches/${companyBatch.id}/confirm-print`,{confirmed:true},headers);
  const [companyCard]=await connection.db.select().from(schema.cards).where(eq(schema.cards.batchId,companyBatch.id));
  await connection.db.update(schema.cards).set({qcStatus:'PASSED',nfcStatus:'WRITTEN',lifecycleStatus:'QC_PASSED',inventoryStatus:'SALEABLE'}).where(eq(schema.cards.id,companyCard.id));
  await api(`/api/v1/company/admin/${company.id}/cards`,{cardSlug:companyCard.publicSlug},headers);
  await click('Refresh workspace');await until(`!!document.querySelector('.card-assign-form select')`);
  assert.equal(await evaluate(`document.querySelector('[href="#company-cards"] strong').textContent`),'0');
  await evaluate(`document.querySelector('[href="#company-cards"]').click()`);
  await until(`document.querySelector('#company-cards').parentElement.parentElement.textContent.includes('No cards match')`);
  await set('.studio-card select:has(option[value="unassigned"])','unassigned');
  await until(`!!document.querySelector('.card-assign-form select option[value]:not([value=""])')`);
  const employeeId=await evaluate(`document.querySelector('.card-assign-form select option[value]:not([value=""])').value`);
  await set('.card-assign-form select',employeeId);await click('Save assignment');
  await until(`document.querySelector('[href="#company-cards"] strong').textContent==='1'`);
  await evaluate(`document.querySelector('[href="#company-cards"]').click()`);
  await until(`document.querySelector('.card-live-links')?.textContent.includes('Copy public link')`);
  await api(`/api/v1/customer/cards/${companyCard.publicSlug}/contact-leads`,{requestId:crypto.randomUUID(),name:'Team Visitor',email:'team-visitor@example.com',consent:true,source:'QR'});
  await click('Open inbox');await until(`document.querySelector('.lead-inbox')?.textContent.includes('Team Visitor')`);
  await set('.lead-inbox input[type=search]','unmatched');await until(`document.querySelector('.lead-inbox')?.textContent.includes('No matching contacts')`);
  await click('Load analytics');await until(`!!document.querySelector('.lead-inbox select')`);
  await set('.lead-inbox select','NFC');await until(`document.body.innerText.includes('No activity from this source')`);
  await set('.lead-inbox select','QR');await until(`document.body.innerText.includes('Leads · 1')`);
  await evaluate(`document.querySelector('.studio-security-panel summary').click()`);
  await click('Refresh verification status');await until(`document.querySelector('.studio-security-panel')?.textContent.includes('Email awaiting verification')`);
  await evaluate(`document.querySelector('.team-check input').click()`);await click('Save settings');await until(`document.body.innerText.includes('Company settings saved.')`);
  const {drainEmployeeEmails}=await import(pathToFileURL(join(root,'apps/api/dist/domain/employee-email.js')).href);
  await drainEmployeeEmails();await click('Refresh workspace');
  await until(`document.querySelector('.team-list')?.textContent.includes('Welcome email sent')`);
  const welcomeEmail=emails.find(mail=>mail.subject==='Your Oneinfo employee profile is ready');
  assert.deepEqual(welcomeEmail?.to,['employee@example.com']);
  for(const width of [320,390,1440]){await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});await inspect('company-workspace-'+width);}
  const employeeLink=welcomeEmail.text.match(/https?:\/\/\S+\/team#edit\/[\w-]+/)[0];
  await command('Page.navigate',{url:employeeLink});await until(`!!document.querySelector('input[name=displayName]')`);
  await fill('Name','Updated Employee');await click('Save public profile');await until(`document.body.innerText.includes('Public profile saved.')`);await inspect('company-employee-editor');
  await command('Page.navigate',{url:'http://127.0.0.1:5174/team'});await until(`document.querySelector('h1')?.textContent==='Browser Team'`);
  assert.equal(await evaluate(`document.body.innerText.includes('employee@example.com')`),false);
  await evaluate(`[...document.querySelectorAll('a')].find(a=>a.textContent==='Updated Employee').click()`);await until(`document.querySelector('h1')?.textContent==='Updated Employee'`);
  await command('Emulation.setDeviceMetricsOverride',{width:320,height:844,deviceScaleFactor:1,mobile:true});await inspect('company-public-profile-320');
  assert.equal(browserErrors.length,0,browserErrors.join('\n'));
  console.log('PASS: company setup, employee welcome email and edit link, card assignment, contact search, analytics, security, and public directory.');
} catch(error) { console.log('UI AUDIT FAILED:',error.cause?.code ? `Database error ${error.cause.code}: ${error.cause.message}` : error.stack??error.message); process.exitCode=1; } finally {
  closing=true;
  clearInterval(globalThis.uiHeartbeat);
  if(socket)socket.onmessage=null;
  chrome?.kill('SIGKILL'); await delay(300); socket?.close();
  await app?.close(); await connection?.closeDatabase();
  if (created) await admin.query(`drop database "${database}" with (force)`);
  await admin.end(); await delay(500); rmSync(chromeProfile, { recursive: true, force: true });
  console.log('UI audit cleanup complete: disposable database and browser profile removed.');
}
