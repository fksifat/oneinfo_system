import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';

test('manual smoke invocation cannot create records on a live API',()=>{
  const result=spawnSync(process.execPath,['scripts/smoke-test.mjs'],{env:{...process.env,ONEINFO_SMOKE_NONCE:'',API_URL:'https://api.oneinfo.online'},encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/direct smoke requests against a live API are disabled/);
});

test('smoke client checks the disposable API nonce before requesting any credentials',async()=>{
  const requests=[];const server=createServer((request,response)=>{requests.push(request.url);response.setHeader('content-type','application/json');response.end(JSON.stringify({nonce:'different-test-server'}));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const child=spawn(process.execPath,['scripts/smoke-test.mjs'],{env:{...process.env,ONEINFO_SMOKE_NONCE:'expected-test-server',API_URL:`http://127.0.0.1:${server.address().port}`},stdio:['ignore','ignore','pipe']});
    let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});const [code]=await once(child,'close');assert.notEqual(code,0);assert.match(stderr,/Disposable smoke API required/);assert.deepEqual(requests,['/__smoke-test-guard']);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
