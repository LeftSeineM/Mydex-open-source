import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {WorkerEngine} from '../workers/engine.mjs';
import {createControlServer} from '../control-server.mjs';

const dsh={exe:'fake',cli:'fake',patch:'fake'};
function tempDir(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-workers-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
// A fake DSH runner: writes the receipt like a real Worker would, reports usage.
function fakeRunner({writeReceipt=true,delay=10,usage={inputTokens:1000,outputTokens:500,cacheReadTokens:0},error}={}){
 const calls=[];
 const runner=async opts=>{
  calls.push(opts);await new Promise((r,j)=>{const t=setTimeout(r,delay);opts.signal.addEventListener('abort',()=>{clearTimeout(t);j(Object.assign(Error('killed'),{usage}));});});
  if(error)throw Object.assign(Error(error),{partial:'half done',usage});
  const receipt=opts.prompt.match(/回执写到：(.+)/)[1].trim();
  if(writeReceipt)fs.writeFileSync(receipt,'# 回执\n\n## 结论\n53 行\n## 证据\nwc -l\n## 不确定\n无\n## 用时\n1 分钟\n');
  return {text:'回执已写好',usage};
 };
 return {runner,calls};
}
const brief={title:'数行数',brief:'- 负责什么：数行数',why:'体力活'};

test('dispatch returns at once, runs the tier model with full access, writes brief, receipt and ledger',async t=>{
 const dir=tempDir(t),{runner,calls}=fakeRunner();const e=new WorkerEngine({dir,runner,locate:()=>dsh});
 const r=e.dispatch({...brief,tier:'light'});
 assert.match(r.id,/^w\d{6}-[0-9a-f]{6}$/);assert.equal(r.model,'zai-coding-cn/glm-5.3-flash');
 assert.equal(e.status({id:r.id}).job.state,'running');
 const [done]=await e.wait({ids:[r.id],timeoutSeconds:5});
 assert.equal(done.state,'done');assert.match(done.receiptText,/53 行/);assert.match(done.receiptText,/未经 Router 抽测/);
 assert.equal(calls[0].permissionMode,'danger-full-access');assert.equal(calls[0].cwd,path.join(dir,r.id));
 assert.equal(done.costCny,money(1000*0.5+500*2));
 assert.ok(fs.readFileSync(path.join(dir,r.id,'brief.md'),'utf8').includes('数行数'));
 const events=fs.readFileSync(path.join(dir,'ledger.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l).event);
 assert.deepEqual(events,['dispatched','started','done']);
});
const money=n=>Math.round(n/1e6*10000)/10000;

test('missing receipt file falls back to the final reply; failures keep partial output',async t=>{
 const dir=tempDir(t);
 const a=new WorkerEngine({dir,runner:fakeRunner({writeReceipt:false}).runner,locate:()=>dsh});
 const [x]=await a.wait({ids:[a.dispatch({...brief,tier:'mid'}).id]});
 assert.match(x.receiptText,/没有写回执文件/);
 const b=new WorkerEngine({dir,runner:fakeRunner({error:'model unavailable'}).runner,locate:()=>dsh});
 const id=b.dispatch({...brief,tier:'mid'}).id;const [y]=await b.wait({ids:[id]});
 assert.equal(y.state,'failed');assert.match(y.error,/model unavailable/);
 assert.equal(fs.readFileSync(path.join(dir,id,'partial.md'),'utf8'),'half done');
});

test('budget, concurrency, unknown tier, missing DSH and bad workdir refuse dispatch without side effects',async t=>{
 const dir=tempDir(t);const e=new WorkerEngine({dir,runner:fakeRunner({delay:200}).runner,locate:()=>dsh});
 const cfg=e.config();cfg.limits.maxConcurrent=1;fs.writeFileSync(e.configFile,JSON.stringify(cfg));
 const first=e.dispatch({...brief,tier:'light'});
 assert.throws(()=>e.dispatch({...brief,tier:'light'}),/并发上限/);
 assert.throws(()=>e.dispatch({...brief,tier:'huge'}),/Unknown tier/);
 assert.throws(()=>e.dispatch({...brief}),/tier/);
 await e.wait({ids:[first.id]});
 const folders=fs.readdirSync(dir).length;assert.throws(()=>e.dispatch({...brief,tier:'light',workdir:path.join(dir,'nope')}),/不存在/);assert.equal(fs.readdirSync(dir).length,folders);
 cfg.limits.budgetCny=0;fs.writeFileSync(e.configFile,JSON.stringify(cfg));
 assert.throws(()=>e.dispatch({...brief,tier:'light'}),/预算已用完/);
 const none=new WorkerEngine({dir:tempDir(t),runner:fakeRunner().runner,locate:()=>null});
 assert.throws(()=>none.dispatch({...brief,tier:'light'}),/DeepSeek Harness/);
 assert.equal(none.status().jobs.length,0);
});

test('cancel stops a running job; accept records the verdict; restart marks running jobs lost, never re-runs',async t=>{
 const dir=tempDir(t),fake=fakeRunner({delay:5000});const e=new WorkerEngine({dir,runner:fake.runner,locate:()=>dsh});
 const slow=e.dispatch({...brief,tier:'strong'}).id;
 assert.deepEqual(e.cancel({id:slow}),{id:slow,state:'cancelling'});
 const [c]=await e.wait({ids:[slow]});assert.equal(c.state,'cancelled');
 assert.throws(()=>e.accept({id:slow,passed:true,check:'x'}),/只能验收/);
 const quick=new WorkerEngine({dir,runner:fakeRunner().runner,locate:()=>dsh});
 const id=quick.dispatch({...brief,tier:'light'}).id;await quick.wait({ids:[id]});
 const accepted=quick.accept({id,passed:false,check:'wc -l 是 53，回执写 51'});
 assert.equal(accepted.review.passed,false);
 assert.match(fs.readFileSync(path.join(dir,id,'receipt.md'),'utf8'),/Router 抽测：未通过/);
 // Simulate a crash mid-run.
 const job=JSON.parse(fs.readFileSync(path.join(dir,id,'job.json'),'utf8'));job.state='running';fs.writeFileSync(path.join(dir,id,'job.json'),JSON.stringify(job));
 const runs=fakeRunner();const restarted=new WorkerEngine({dir,runner:runs.runner,locate:()=>dsh});
 assert.equal(restarted.status({id}).job.state,'lost');assert.equal(runs.calls.length,0);
});

test('control server exposes workers only through the authenticated Agent endpoint',async t=>{
 const dir=tempDir(t);const workers=new WorkerEngine({dir,runner:fakeRunner().runner,locate:()=>dsh});
 const token='w'.repeat(48),desktopToken='d'.repeat(48);
 const server=createControlServer({token,desktopToken,owner:{call:async()=>({})},workers});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}));
 const base='http://127.0.0.1:'+server.address().port;
 const call=(url,body,auth=token)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth},body:JSON.stringify(body)});
 assert.equal((await call('/rpc',{action:'workers',args:{operation:'tiers'}},'x'.repeat(48))).status,403);
 assert.equal((await call('/desktop',{action:'workers',args:{operation:'tiers'}},desktopToken)).status,400);
 const tiers=await (await call('/rpc',{action:'workers',args:{operation:'tiers'}})).json();
 assert.equal(tiers.result.tiers.strong.model,'glm-5.4');
 const bad=await call('/rpc',{action:'workers',args:{operation:'dispatch',args:{...brief,tier:'huge'}}});
 assert.equal(bad.status,400);assert.match((await bad.json()).error,/Unknown tier/);
 const ok=await (await call('/rpc',{action:'workers',args:{operation:'dispatch',args:{...brief,tier:'light'}}})).json();
 const done=await (await call('/rpc',{action:'workers',args:{operation:'wait',args:{ids:[ok.result.id]}}})).json();
 assert.equal(done.result[0].state,'done');
 assert.equal((await call('/rpc',{action:'workers',args:{operation:'exec'}})).status,400);
});
