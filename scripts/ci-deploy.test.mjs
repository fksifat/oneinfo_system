import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script=resolve('deploy/ci-deploy.sh'), revision='a'.repeat(40);
function fixture(mode='success') {
  const root=mkdtempSync(join(tmpdir(),'oneinfo-ci-deploy-'));
  for(const directory of ['bin','releases','deploy','source','media'])mkdirSync(join(root,directory));
  writeFileSync(join(root,'.env.vps'),'PRIVATE_SERVER_ENV=retained\n');
  writeFileSync(join(root,'compose.vps.yaml'),'services: {}\n');
  writeFileSync(join(root,'deploy/compose.docker-proxy.yaml'),'services: {}\n');
  writeFileSync(join(root,'source/Dockerfile.api'),'FROM scratch\n');
  writeFileSync(join(root,'source/compose.vps.yaml'),'services: {}\n');
  writeFileSync(join(root,'media/keep.txt'),'existing media');
  assert.equal(spawnSync('tar',['-czf',join(root,`releases/${revision}.tar.gz`),'-C',join(root,'source'),'Dockerfile.api','compose.vps.yaml']).status,0);
  writeFileSync(join(root,'bin/docker'),`#!/usr/bin/env bash
set -e
printf '%s\\n' "$*" >> "$TEST_LOG"
case "$1" in
inspect) echo sha256:previous ;;
volume) echo "$TEST_MEDIA" ;;
exec) if [[ "$3" == pg_dump ]]; then echo database-backup; else cat >/dev/null; echo archive-validated; fi ;;
compose)
  if [[ "$*" == *' run --rm --no-deps migrate'* && "$TEST_MODE" == migration-failure ]]; then exit 9; fi
  if [[ "$*" == *' up -d '* && "$*" != *rollback.yaml* && "$TEST_MODE" == health-failure ]]; then exit 8; fi ;;
esac
`,{mode:0o755});
  writeFileSync(join(root,'bin/curl'),'#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$TEST_LOG"\n',{mode:0o755});
  const env={...process.env,PATH:join(root,'bin')+':'+process.env.PATH,ONEINFO_DEPLOY_ROOT:root,TEST_LOG:join(root,'commands.log'),TEST_MEDIA:join(root,'media'),TEST_MODE:mode};
  return {root,env,run:request=>spawnSync('bash',[script,request],{env,encoding:'utf8'}),log:()=>existsSync(env.TEST_LOG)?readFileSync(env.TEST_LOG,'utf8'):''};
}

test('deployment backs up before migration and only replaces Oneinfo API after successful checks',()=>{
  const f=fixture();try{
    const result=f.run(`deploy ${revision}`);assert.equal(result.status,0,result.stderr);
    const log=f.log();assert.ok(log.indexOf('pg_dump')<log.indexOf(' run --rm --no-deps migrate'));
    assert.ok(log.indexOf(' run --rm --no-deps migrate')<log.indexOf(' up -d '));
    assert.match(log,/up -d --no-deps --no-build --wait --wait-timeout 120 api/);
    assert.ok(!/down|prune|arisesell/.test(log));
    assert.equal(readFileSync(join(f.root,'current-release'),'utf8').trim(),revision);
    assert.equal(readFileSync(join(f.root,'.env.vps'),'utf8'),'PRIVATE_SERVER_ENV=retained\n');
    const backups=readdirSync(join(f.root,'backups'));assert.equal(backups.length,1);
    assert.ok(existsSync(join(f.root,'backups',backups[0],'media.tar.gz')));
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('failed migration leaves the running API untouched',()=>{
  const f=fixture('migration-failure');try{
    const result=f.run(`deploy ${revision}`);assert.notEqual(result.status,0);
    assert.match(f.log(),/ run --rm --no-deps migrate/);
    assert.ok(!f.log().includes(' up -d '));assert.ok(!existsSync(join(f.root,'current-release')));
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('failed cutover restores the previous image without restoring or deleting database/media',()=>{
  const f=fixture('health-failure');try{
    const result=f.run(`deploy ${revision}`);assert.notEqual(result.status,0);
    assert.match(f.log(),/rollback.yaml.*up -d --no-deps --no-build --wait/);
    assert.match(readFileSync(join(f.root,'releases',revision,'rollback.yaml'),'utf8'),/image: oneinfo-vps-api:rollback-/);
    assert.equal(readFileSync(join(f.root,'media/keep.txt'),'utf8'),'existing media');
    assert.ok(!existsSync(join(f.root,'current-release')));
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('SSH entry point rejects shell arguments and unsafe archive members before Docker runs',()=>{
  const f=fixture();try{
    for(const request of ['deploy main','deploy '+revision+'; whoami','deploy '+revision+' extra','shell'])assert.equal(f.run(request).status,2);
    writeFileSync(join(f.root,'source/secret.env'),'must not deploy');
    assert.equal(spawnSync('tar',['-czf',join(f.root,`releases/${revision}.tar.gz`),'-C',join(f.root,'source'),'secret.env']).status,0);
    assert.notEqual(f.run(`deploy ${revision}`).status,0);assert.equal(f.log(),'');
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
