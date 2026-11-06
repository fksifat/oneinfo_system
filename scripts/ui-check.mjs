import { createRequire } from 'node:module';
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
  const { npmCommand } = await import(pathToFileURL(join(root,'scripts/start-local.mjs')).href);
  const {config}=await import(pathToFileURL(join(root,'apps/api/dist/config.js')).href);
  assert.equal(new URL(config.DATABASE_URL).pathname,'/'+database,'Refusing to populate a non-test database');
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
  await connection.db.update(schema.cards).set({ qcStatus: 'PASSED', nfcStatus: 'WRITTEN', lifecycleStatus: 'QC_PASSED', inventoryStatus: 'SALEABLE' }).where(eq(schema.cards.id, card.id));
  await connection.db.update(schema.productionJobs).set({status:'COMPLETED',completedAt:new Date()}).where(eq(schema.productionJobs.cardId,card.id));
  const secret = await api(`/api/v1/customer/cards/${card.id}/activation-code`, {}, headers);
  const catalog = await fetch('http://127.0.0.1:3001/api/v1/products/public').then(r => r.json());
  assert.ok(catalog.items.length, 'Published storefront products needed for UI audit');
  for(const {createdAt,updatedAt,...product} of catalog.items)await connection.db.insert(schema.products).values(product).onConflictDoUpdate({target:schema.products.id,set:product});
  await connection.db.insert(schema.storeShippingSettings).values({id:'default',rates:{insideDhaka:6000,subDhaka:10000,outsideDhaka:12000},codAdvanceTaka:0}).onConflictDoUpdate({target:schema.storeShippingSettings.id,set:{codAdvanceTaka:0}});
  const nativeFetch=globalThis.fetch;
  globalThis.fetch=(url,...args)=>String(url).startsWith('https://api.resend.com/')?Promise.resolve(Response.json({id:'ui-test-email'})):nativeFetch(url,...args);
  const product=catalog.items[0],variant=product.variants.find(v=>v.available);
  await api('/api/v1/orders',{requestId:crypto.randomUUID(),customer:{name:'UI audit buyer',email:'ui-audit@example.com',phone:'01712345678'},deliveryAddress:{district:'Dhaka',dhakaArea:'city',addressLine:'UI test address'},shippingMinor:6000,items:[{productId:product.id,variantId:variant.id,quantity:1,unitPriceMinor:variant.salePriceMinor??variant.priceMinor}]});
  await api('/api/v1/profiles',{publicSlug:'ui-audit-profile',displayName:'UI Audit Profile',headline:'Profile with longer description for responsive checks',company:'Oneinfo',links:[{label:'Portfolio',url:'https://example.com'}]},headers);
  const pairing=await api('/api/v1/local-nfc/pairings',{},headers);
  const device=await api('/api/v1/local-nfc/devices/pair',{pairingCode:pairing.pairingCode,deviceName:'UI audit NFC device'},headers);
  const deviceHeaders={'x-oneinfo-device-token':device.deviceToken};
  globalThis.uiHeartbeat=setInterval(()=>void app.inject({method:'GET',url:'/api/v1/local-nfc/device/status',headers:deviceHeaders}),5000);
  chrome = spawn(chromePath, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${chromeProfile}`, 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !existsSync(join(chromeProfile, 'DevToolsActivePort')); i++) await delay(100);
  const port = readFileSync(join(chromeProfile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let seq = 0, requestedWidth = 390; const waiting = new Map(); const browserErrors = [];
  let failProfileSave=false,failOverview=false,expirePairingSoon=false;
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
        const failed=(failProfileSave&&url.pathname==='/api/v1/profiles'&&paused.request.method==='POST')||(failOverview&&url.pathname==='/api/v1/admin/overview');
        const result = failed?{statusCode:503,headers:{'content-type':'application/json','access-control-allow-origin':'http://127.0.0.1:5174'},body:JSON.stringify({message:'UI test connection failure'})}:await app.inject({ method: paused.request.method, url: url.pathname + url.search, headers: paused.request.headers,
          ...(paused.request.postData && { payload: paused.request.postData }) });
        if(expirePairingSoon&&url.pathname==='/api/v1/local-nfc/pairings'&&result.statusCode===201){result.body=JSON.stringify({...JSON.parse(result.body),expiresAt:new Date(Date.now()+1500).toISOString()});expirePairingSoon=false;}
        await command('Fetch.fulfillRequest', { requestId: paused.requestId, responseCode: result.statusCode,
          responseHeaders: Object.entries(result.headers).map(([name, value]) => ({ name, value: String(value) })), body: Buffer.from(result.body).toString('base64') });
      } catch (error) { browserErrors.push(error.message); await command('Fetch.failRequest', { requestId: paused.requestId, errorReason: 'Failed' }); }
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
  const fill = (label, value) => evaluate(`(() => {const el = [...document.querySelectorAll('label')].find(l => l.textContent.startsWith(${JSON.stringify(label)}))?.querySelector('input,textarea'); if(!el) throw Error('Missing field'); const type = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(type.prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const click = async label => {await until(`[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&!b.disabled&&b.textContent.trim()===${JSON.stringify(label)})`);return evaluate(`(()=>{[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&!b.disabled&&b.textContent.trim()===${JSON.stringify(label)}).click()})()`);};
  const reload=async()=>{const before=await evaluate('performance.timeOrigin');await command('Page.reload');await until(`performance.timeOrigin!==${before}&&document.readyState==='complete'`);};
  const set = (selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing field '+${JSON.stringify(selector)});const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement:e instanceof HTMLSelectElement?HTMLSelectElement:HTMLInputElement;Object.getOwnPropertyDescriptor(p.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
  mkdirSync(root + '/.oneinfo/qa', { recursive: true });
  async function screenshot(name) { const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(root + '/.oneinfo/qa/' + name + '.png', Buffer.from(shot.data, 'base64')); }
  async function inspect(name){
    await delay(200);
    const data=await evaluate(`(()=>{const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,hiddenVisible:[...document.querySelectorAll('[hidden]')].filter(visible).map(e=>e.className),unlabelled:[...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(visible).filter(e=>!e.closest('label')&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')&&![...document.querySelectorAll('label[for]')].some(l=>l.htmlFor===e.id)).map(e=>e.placeholder||e.id||e.type),buttons:[...document.querySelectorAll('button')].filter(visible).filter(e=>!e.textContent.trim()&&!e.getAttribute('aria-label')).length}})()`);
    console.log(name,JSON.stringify(data));assert.ok(data.documentWidth<=requestedWidth+2,name+' overflows the requested viewport');assert.equal(data.hiddenVisible.length,0,name+' shows hidden panels');assert.equal(data.unlabelled.length,0,name+' has unlabelled fields');await screenshot('audit-'+name);
  }
  for(const width of [1440,768,390,320]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
    await command('Page.navigate',{url:'http://127.0.0.1:5174/'});await until(`!!document.querySelector('.sidebar')`);await delay(250);
    for(const label of ['Overview','Orders','Reviews','Products','Client profiles','Cards & inventory','Production batches','Stations','Audit history','NFC & QR operations']){
      const found=await evaluate(`(()=>{const b=[...document.querySelectorAll('.sidebar nav button')].find(b=>b.textContent.trim().endsWith(${JSON.stringify(label)}));if(!b)return false;b.click();return true})()`);
      if(!found){console.log('MISSING NAV',label);continue;}
      await delay(350);await inspect('admin-'+label.replace(/[^a-z]/gi,'-')+'-'+width);
      if(label==='NFC & QR operations')assert.equal(await evaluate(`!!document.querySelector('.production-frame')`),true);
      if(label==='Client profiles'){
        await evaluate(`document.querySelector('.list-toolbar button').focus();document.querySelector('.list-toolbar button').click()`);await inspect('admin-profile-editor-'+width);assert.equal(await evaluate(`document.querySelector('.editor-panel').contains(document.activeElement)`),true);
        if(width===1440){await fill('Public slug','ui-created-profile');await fill('Display name','UI Created Profile');failProfileSave=true;await click('Save profile');await until(`!!document.querySelector('.profile-save-error')`);assert.equal(await evaluate(`document.querySelector('.editor-panel').contains(document.querySelector('[role=alert]'))`),true);failProfileSave=false;await click('Save profile');await until(`!document.querySelector('.editor-panel[open]')`);await evaluate(`document.querySelector('.list-toolbar button').focus();document.querySelector('.list-toolbar button').click()`);}
        await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await delay(100);assert.equal(await evaluate(`!!document.querySelector('.editor-panel[open]')`),false);console.log('profile-editor-escape PASS');
      }
      if(label==='Products'){const opened=await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Edit ')&&b.classList.contains('catalog-secondary'));if(!b)return false;b.click();return true})()`);if(opened){await delay(200);await inspect('admin-product-editor-'+width);for(const section of ['Details','Colours & prices','Media','Warranty','Publishing']){await evaluate(`(()=>{const b=[...document.querySelectorAll('.catalog-editor-nav button')].find(b=>b.textContent===${JSON.stringify(section)});b.click()})()`);assert.equal(await evaluate(`document.querySelectorAll('.catalog-section:not([hidden])').length`),1);}await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});}}
      if(label==='Orders'){
        await click('Settings');await until(`!!document.querySelector('.store-settings-dialog[open]')`);await inspect('admin-order-settings-'+width);
        if(width===1440){await click('Save payment settings');await until(`document.body.innerText.includes('COD advance saved.')`);await click('Save rates');await until(`document.body.innerText.includes('Delivery rates saved.')`);await fill('Coupon code','UICHECK');await fill('Discount (%)','15');await click('Save coupon');await until(`document.body.innerText.includes('UICHECK saved.')`);}
        await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await until(`!document.querySelector('.store-settings-dialog[open]')`);
        await evaluate(`document.querySelector('.store-order summary').click()`);assert.equal(await evaluate(`document.querySelector('.store-order').open`),true);
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
      await api('/api/v1/local-nfc/device/resolve-qr',{scanId:crypto.randomUUID(),scannedValue:target.canonicalUrl},deviceHeaders);
      await until(`location.hash==='#production'&&document.querySelector('.batch-toolbar select').value===${JSON.stringify(scannedBatch.id)}&&document.querySelector('.selected-production-card')?.textContent.includes(${JSON.stringify(target.publicSlug)})`);
      assert.equal(await evaluate(`document.querySelector('.card-search input').value`),'');
      assert.equal(await evaluate(`document.querySelector('.card-search select').value`),'all');
      await evaluate(`document.querySelector('.production-card-list button').click()`);await delay(2500);
      assert.equal(await evaluate(`document.querySelector('.selected-production-card').textContent.includes(${JSON.stringify(detail.cards[0].publicSlug)})`),true);
      await api('/api/v1/local-nfc/device/resolve-qr',{scanId:crypto.randomUUID(),scannedValue:target.canonicalUrl},deviceHeaders);
      await until(`document.querySelector('.selected-production-card')?.textContent.includes(${JSON.stringify(target.publicSlug)})`);
      for(const item of detail.cards)await connection.db.delete(schema.cardEvents).where(eq(schema.cardEvents.cardId,item.id));
      await set('.batch-toolbar select',batch.id);await until(`document.querySelector('.selected-production-card')?.textContent.includes(${JSON.stringify(card.publicSlug)})`);
      console.log('Phone QR auto-selects batch/card, clears filters, opens Production, and preserves later manual selection PASS');
    }
    for(const label of ['Production','NFC tools','Connection']){
      await evaluate(`(()=>{const b=[...document.querySelectorAll('.workspace-nav button')].find(b=>b.textContent.endsWith(${JSON.stringify(label)}));b.click();})()`);await inspect('production-'+label.replaceAll(' ','-')+'-'+width);
      if(label==='Production'&&width===1440){
        await fill('Batch code','UI-BULK');await fill('Number of cards','3');await click('Create batch');await until(`document.querySelector('.batch-toolbar select')?.selectedOptions[0]?.textContent.includes('UI-BULK')&&!!document.querySelector('.selected-production-card')`);
        const selectedBatch=await evaluate(`document.querySelector('.batch-toolbar select').value`);assert.equal(await evaluate(`new URL(location.href).searchParams.get('batch')`),selectedBatch);await reload();await until(`document.querySelector('.batch-toolbar select')?.value===${JSON.stringify(selectedBatch)}&&!!document.querySelector('.selected-production-card')`);
        await click('Generate all QR codes');await until(`document.querySelectorAll('.production-card-list button').length===3&&[...document.querySelectorAll('.production-card-list small')].every(e=>e.textContent.includes('QR ready'))`);
        await evaluate(`window.__printCalled=false;window.print=()=>{window.__printCalled=true}`);await click('Print selected QR');await until(`window.__printCalled`);assert.equal(await evaluate(`document.querySelectorAll('.print-label').length`),1);await click('Print full batch');await until(`document.querySelectorAll('.print-label').length===3`);
        await command('Emulation.setEmulatedMedia',{media:'print'});assert.equal(await evaluate(`getComputedStyle(document.querySelector('.production-print')).display`),'block');await screenshot('audit-print-qr');await command('Emulation.setEmulatedMedia',{media:''});
        await evaluate(`document.querySelector('.print-confirmation input').click()`);await click('Confirm printed batch');await until(`document.querySelector('.print-confirmation h2')?.textContent==='Printed stock confirmed'`);console.log('Bulk QR create/generate/single/full print/confirmation PASS');
      }
      if(label==='Connection'){
        expirePairingSoon=width===1440;
        await click('Create connection QR');await until(`!!document.querySelector('.lan-pairing img')`);await inspect('production-lan-qr-'+width);
        assert.equal(await evaluate(`document.querySelector('.lan-pairing img').getAttribute('src').startsWith('data:image/png;base64,')`),true);
        assert.equal(await evaluate(`document.querySelector('.connection-details details').open`),false);
        if(width===1440){await until(`document.querySelector('.lan-pairing').textContent.includes('QR expired')&&!document.querySelector('.lan-pairing img')`);await click('New connection QR');await until(`!!document.querySelector('.lan-pairing img')`);console.log('Connection QR expiry and refresh PASS');}
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
      await set('#arisepay-transaction','UICHECK123456');await click('Submit payment for verification');await until(`!document.querySelector('.order-saved').hidden`);await inspect('storefront-order-receipt-'+width);console.log('Storefront coupon/bKash submission/order receipt PASS (test transaction, no payment sent)');
    }
  }
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  for(const width of [1440,320]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
    await command('Page.navigate',{url:'http://127.0.0.1:5174/?ui-auth=1'});await until(`!!document.querySelector('.auth-card')`);await inspect('admin-auth-'+width);await click('Enter development workspace');await until(`!!document.querySelector('.sidebar')`);
    await command('Page.navigate',{url:'http://127.0.0.1:5173/?ui-auth=1'});await until(`!!document.querySelector('.setup-panel')`);await inspect('production-setup-'+width);
    await fill('Station code','BROWSER-QA');await click('Register workstation');await until(`document.querySelector('.setup-error')?.textContent.includes('already registered')`);await inspect('production-duplicate-station-'+width);
    await fill('Station code','UI-REGISTER-'+width);await click('Register workstation');await until(`!!document.querySelector('.workspace-nav')`);assert.equal(await evaluate(`!!document.querySelector('.setup-error')`),false);
  }
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const url = `http://127.0.0.1:5174/c/${card.publicSlug}`;
  await command('Page.navigate', { url });
  await until(`document.querySelector('h1')?.textContent === 'Activate your card'`);
  await screenshot('customer-activation');
  await fill('Secret code', secret.secretCode); await click('Activate & continue');
  await until(`document.querySelector('h1')?.textContent === 'Create your account'`);
  await screenshot('customer-signup');
  await fill('Account email', 'browser-owner@example.com'); await fill('Password', 'a secure browser test password');
  await fill('Full name', 'Browser Test Owner'); await fill('Headline', 'Profile verified in browser');
  await click('Create account & save profile');
  await until(`document.querySelector('h1')?.textContent === 'Browser Test Owner'`);
  assert.equal(await evaluate(`document.body.innerText.includes('browser-owner@example.com')`), false);
  await screenshot('customer-public-profile');
  await click('Manage this card');
  await until(`document.querySelector('h1')?.textContent === 'Edit your public profile'`);
  await reload();await until(`document.querySelector('h1')?.textContent === 'Edit your public profile'`);
  assert.equal(await evaluate(`document.querySelector('input[autocomplete=name]').value`),'Browser Test Owner');
  await fill('Full name', 'Updated Browser Owner'); await click('Save profile');
  await until(`document.querySelector('h1')?.textContent === 'Updated Browser Owner'`);
  await evaluate('sessionStorage.clear()'); await command('Page.navigate', { url });
  await until(`document.querySelector('h1')?.textContent === 'Updated Browser Owner'`);
  assert.equal(browserErrors.length, 0, browserErrors.join('\n'));
  console.log('PASS: real browser activation → signup → public scan → owner edit → fresh visitor scan; private account email hidden.');
} catch(error) { console.log('UI AUDIT FAILED:',error.message); process.exitCode=1; } finally {
  closing=true;
  clearInterval(globalThis.uiHeartbeat);
  if(socket)socket.onmessage=null;
  chrome?.kill('SIGKILL'); await delay(300); socket?.close();
  await app?.close(); await connection?.closeDatabase();
  if (created) await admin.query(`drop database "${database}" with (force)`);
  await admin.end(); await delay(500); rmSync(chromeProfile, { recursive: true, force: true });
  console.log('UI audit cleanup complete: disposable database and browser profile removed.');
}
