import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {ToolWake} from '../tool-wake.mjs';
function fixture(t,options={}){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-wake-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));let live=false,starts=0,time=100000;const config={directory,platform:'win32',probe:async()=>live,discover:async()=>({executable:'original.exe',running:false}),launch:async()=>{starts++;live=true;},clock:()=>time,pause:async n=>{time+=n;},timeout:1000,...options};return {config,make:()=>new ToolWake(config),get starts(){return starts;},set live(v){live=v;}};}
test('ready original is reused and concurrent requests launch only once',async t=>{
 const f=fixture(t),wake=f.make();const [a,b]=await Promise.all([wake.prepare('deepseek'),wake.prepare('deepseek')]);assert.equal(a.ready,true);assert.equal(b.ready,true);assert.equal(f.starts,1);await wake.prepare('deepseek');assert.equal(f.starts,1);
});
test('a launched process without its native interface is not ready',async t=>{
 const f=fixture(t,{probe:async()=>false,launch:async()=>{}}),result=await f.make().prepare('deepseek');assert.equal(result.state,'interface_not_ready');assert.equal(result.ready,false);
 // Restart of Mydex must not repeatedly spawn the unready app.
 assert.equal((await f.make().prepare('deepseek')).state,'starting');
});
test('missing app and unsupported CLI never launch replacements',async t=>{
 let launches=0;const f=fixture(t,{discover:async()=>null,launch:async()=>launches++}),w=f.make();assert.equal((await w.prepare('deepseek')).state,'not_installed');assert.equal((await w.prepare('claude')).state,'unsupported');assert.equal((await w.prepare('arbitrary.exe')).state,'unsupported');assert.equal(launches,0);
});
test('already running unready app is not started twice',async t=>{
 let launches=0;const f=fixture(t,{probe:async()=>false,discover:async()=>({running:true}),launch:async()=>launches++});assert.equal((await f.make().prepare('deepseek')).state,'interface_not_ready');assert.equal(launches,0);
});
