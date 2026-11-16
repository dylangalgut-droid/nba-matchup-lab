'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const os=require('node:os');
const fs=require('node:fs');
const path=require('node:path');
// Set these BEFORE loading the server: the hosting security settings are deliberately immutable.
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'nba-lab-http-'));
process.env.DATA_DIR=tmp;
process.env.ADMIN_TOKEN='super-secret-test-token-32-bytes-minimum';
const {server}=require('../server');
let base;
test.before(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
});
test.after(async()=>{
  await new Promise(resolve=>server.close(resolve));
  fs.rmSync(tmp,{recursive:true,force:true});
});
test('The hosted server reports health and does not expose the admin token',async()=>{
  const r=await fetch(base+'/api/health');assert.equal(r.status,200);
  const body=await r.json();assert.equal(body.ok,true);
  const status=await fetch(base+'/api/status').then(x=>x.json());
  assert.equal(status.protected,true);
  assert.equal(JSON.stringify(status).includes(process.env.ADMIN_TOKEN),false);
});
test('Refresh and import endpoints reject unauthenticated clients',async()=>{
  for(const endpoint of ['/api/refresh','/api/hooks/refresh','/api/backtest/recalculate']){
    const r=await fetch(base+endpoint,{method:'POST'});
    assert.equal(r.status,401,endpoint);
    const wrong=await fetch(base+endpoint,{method:'POST',headers:{authorization:'Bearer not-valid'}});
    assert.equal(wrong.status,401,endpoint);
  }
});
test('Authorized audit recalculation persists locally without requiring live ESPN data',async()=>{
  const r=await fetch(base+'/api/backtest/recalculate',{method:'POST',headers:{authorization:`Bearer ${process.env.ADMIN_TOKEN}`}});
  assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(data.ok,true);
  assert.ok(fs.existsSync(path.join(tmp,'backtest.json')));
});
test('Static directory traversal is blocked, unknown API paths return 404',async()=>{
  assert.equal((await fetch(base+'/api/not-real')).status,404);
  assert.ok([403,404].includes((await fetch(base+'/../server.js')).status));
  assert.ok([400,403,404].includes((await fetch(base+'/%E0%A4%A')).status));
});
