import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {BridgeOwner} from '../bridge-owner.mjs';
function fixture(t,timeout=2000,linger=false){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-owner-'));const script=path.join(dir,'worker.mjs');fs.writeFileSync(script,`import readline from 'node:readline';let n=0;${linger?'setInterval(()=>{},1000);':''}readline.createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.action==='exit')process.exit(1);if(m.action==='hang')return;setTimeout(()=>console.log(JSON.stringify({id:m.id,result:{n:++n,action:m.action}})),m.args.delay||0)});`);const owner=new BridgeOwner({script,timeout});t.after(async()=>{await owner.close();fs.rmSync(dir,{recursive:true,force:true});});return owner;}
test('independent callers share one worker and correlate out-of-order replies',async t=>{const owner=fixture(t);const [a,b]=await Promise.all([owner.call('first',{delay:30}),owner.call('second')]);assert.equal(a.action,'first');assert.equal(b.action,'second');assert.equal(b.n,1);assert.equal(a.n,2);assert.equal((await owner.call('third')).n,3);});
test('worker exit rejects outstanding requests rather than reporting success',async t=>{const owner=fixture(t);await assert.rejects(owner.call('exit'),/stopped/);await assert.rejects(owner.call('status'),/stopped/);});
test('timeout does not replay a mutation or destroy the worker',async t=>{const owner=fixture(t);await owner.call('ready');owner.timeout=100;await assert.rejects(owner.call('hang'),/outcome is unknown/);assert.equal((await owner.call('status')).n,2);});

test('broken input pipe still reaps live child during concurrent shutdown',async t=>{
 const owner=fixture(t,2000,true);await owner.call('ready');
 // Keep the fixture alive after stdin closes, as a gateway may own timers.
 const exited=new Promise(resolve=>owner.process.once('exit',resolve));
 owner.process.stdin.destroy(new Error('simulated pipe failure'));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(owner.closed,true);
 await Promise.all([owner.close(),owner.close(),exited]);
 assert.ok(owner.process.exitCode!==null||owner.process.signalCode!==null);
 assert.equal(owner.pending.size,0);
});

test('failed spawn can be closed without waiting for an exit that never occurs',async()=>{
 const owner=new BridgeOwner({node:path.join(os.tmpdir(),'mydex-no-such-runtime.exe'),script:'unused'});
 await new Promise(resolve=>owner.process.once('error',resolve));
 await owner.close();
 assert.equal(owner.closed,true);
 assert.equal(owner.pending.size,0);
});

test('service shutdown rejects pending work and does not accept new calls',async t=>{
 const owner=fixture(t);await owner.call('ready');
 const pending=assert.rejects(owner.call('hang'),/stopped/);
 await Promise.all([owner.close(),owner.close(),pending]);
 await assert.rejects(owner.call('status'),/stopped/);
 assert.equal(owner.pending.size,0);
});

