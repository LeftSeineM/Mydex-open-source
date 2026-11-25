import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {SharedDesktopClient} from '../desktop-client.mjs';

// Exercise the actual supervisor/HTTP/IPC code in a throwaway installation.
// Only the native application bridge is a fixture: no real chats or pairing.
async function fixture(t,{fail=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-service-lifecycle-'));
 const source=fileURLToPath(new URL('..',import.meta.url));
 const headless=path.join(root,'desktop/headless'),data=path.join(root,'data');
 fs.mkdirSync(headless,{recursive:true});fs.mkdirSync(data);
 for(const name of ['service.mjs','bridge-owner.mjs','control-server.mjs','router-client.mjs','local-state.mjs'])fs.copyFileSync(path.join(source,name),path.join(headless,name));
 fs.cpSync(path.join(source,'workers'),path.join(headless,'workers'),{recursive:true});
 fs.mkdirSync(path.join(root,'gateway/router'),{recursive:true});
 fs.copyFileSync(fileURLToPath(new URL('../../../gateway/router/access.mjs',import.meta.url)),path.join(root,'gateway/router/access.mjs'));
 fs.copyFileSync(fileURLToPath(new URL('../../../gateway/router/process-lock.mjs',import.meta.url)),path.join(root,'gateway/router/process-lock.mjs'));
 fs.writeFileSync(path.join(headless,'package.json'),JSON.stringify({version:'test'}));
 fs.writeFileSync(path.join(data,'preserved-history.json'),JSON.stringify({session:'existing',pairing:'fixture-only',tasks:['a','b']}));
 fs.writeFileSync(path.join(root,'desktop/gui-bridge.mjs'),`
 import fs from 'node:fs';import path from 'node:path';import readline from 'node:readline';
 fs.writeFileSync(path.join(process.env.MYDEX_DATA_DIR,'bridge.pid'),String(process.pid));
 let connected=false;
 readline.createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);
  if(${fail}&&m.action==='status'){console.log(JSON.stringify({id:m.id,error:'fixture initialization failure'}));return;}
  if(m.action==='start')connected=true;
  if(m.action==='stop')connected=false;
  console.log(JSON.stringify({id:m.id,result:{configured:true,connected,owned:true,action:m.action}}));
 });`);
 const children=[];
 const start=(reuseOwnPid=false)=>{
  const child=spawn(process.execPath,[path.join(headless,'service.mjs')],{env:{...process.env,MYDEX_DATA_DIR:data},windowsHide:true,stdio:['ignore','pipe','pipe']});
  children.push(child);child.stdout.resume();child.stderr.resume();
  if(reuseOwnPid){
   const lock=path.join(data,'agent-control/service.lock');
   fs.mkdirSync(path.dirname(lock),{recursive:true});fs.writeFileSync(lock,String(child.pid));
   const old=new Date(Date.now()-86400000);fs.utimesSync(lock,old,old);
  }
  const terminal=new Promise(resolve=>child.once('exit',code=>resolve(code)));
  return {child,terminal};
 };
 t.after(async()=>{
  for(const child of children)if(child.exitCode===null&&child.signalCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}
  const pidFile=path.join(data,'bridge.pid');if(fs.existsSync(pidFile))try{process.kill(Number(fs.readFileSync(pidFile)));}catch{}
  fs.rmSync(root,{recursive:true,force:true});
 });
 const directory=path.join(data,'agent-control');
 const client=new SharedDesktopClient({directory,configPath:path.join(data,'gateway/private/config.json'),timeout:1000});
 async function ready(run){
  const end=Date.now()+10000;
  while(Date.now()<end){
   if(run.child.exitCode!==null)throw Error('Service exited before ready');
   try{const status=await client.call('status');if(status.connected)return status;}catch{}
   await new Promise(r=>setTimeout(r,50));
  }
  throw Error('Service readiness timeout');
 }
 async function stop(run){
  const endpoint=JSON.parse(fs.readFileSync(path.join(directory,'endpoint.json')));
  const response=await fetch('http://127.0.0.1:'+endpoint.port+'/rpc',{method:'POST',headers:{Authorization:'Bearer '+endpoint.token,'Content-Type':'application/json'},body:JSON.stringify({action:'shutdown'})});
  assert.equal(response.status,200);assert.equal(await run.terminal,0);
 }
 return {root,data,directory,client,start,ready,stop};
}

test('real supervisor survives UI detach, rejects second owner and reconnects after restart',async t=>{
 const f=await fixture(t),saved=fs.readFileSync(path.join(f.data,'preserved-history.json'));
 const first=f.start();await f.ready(first);
 const before=JSON.parse(fs.readFileSync(path.join(f.directory,'desktop-endpoint.json')));
 const duplicate=f.start();assert.notEqual(await duplicate.terminal,0);
 assert.equal((await f.client.call('status')).connected,true);
 f.client.close();assert.equal((await f.client.call('status')).connected,true);
 await f.stop(first);
 assert.equal(fs.existsSync(path.join(f.directory,'desktop-endpoint.json')),false);
 assert.equal(fs.existsSync(path.join(f.directory,'service.lock')),false);
 await assert.rejects(f.client.call('start'),/未启动替代网关/);
 const second=f.start();await f.ready(second);
 const after=JSON.parse(fs.readFileSync(path.join(f.directory,'desktop-endpoint.json')));
 assert.notEqual(before.token,after.token);
 assert.equal((await f.client.call('status')).connected,true);
 assert.deepEqual(fs.readFileSync(path.join(f.data,'preserved-history.json')),saved);
 await f.stop(second);
});

test('initialization failure removes descriptors, releases lock and reaps bridge',async t=>{
 const f=await fixture(t,{fail:true}),run=f.start();assert.equal(await run.terminal,1);
 for(const name of ['endpoint.json','desktop-endpoint.json','service.lock'])assert.equal(fs.existsSync(path.join(f.directory,name)),false);
 const pid=Number(fs.readFileSync(path.join(f.data,'bridge.pid')));
 assert.throws(()=>process.kill(pid,0));
});

test('supervisor crash is recovered without replaying earlier desktop operations',async t=>{
 const f=await fixture(t),first=f.start();await f.ready(first);
 const bridgePid=Number(fs.readFileSync(path.join(f.data,'bridge.pid')));
 await f.client.call('stop');
 first.child.kill();await first.terminal;
 // stdin EOF should allow the child to exit even when supervisor cleanup did
 // not run. Wait for this observed process, never start a competing one.
 let live=true;
 for(let n=0;n<100&&live;n++){
  try{process.kill(bridgePid,0);await new Promise(r=>setTimeout(r,20));}catch{live=false;}
 }
 assert.equal(live,false);
 const second=f.start();await f.ready(second);
 // A stale prior stop request is not replayed into the new owner.
 assert.equal((await f.client.call('status')).connected,true);
 await f.stop(second);
});
test('real service recovers a previous lock whose PID was reused by itself',async t=>{
 const f=await fixture(t),saved=fs.readFileSync(path.join(f.data,'preserved-history.json'));
 const run=f.start(true);await f.ready(run);
 assert.equal((await f.client.call('status')).connected,true);
 assert.deepEqual(fs.readFileSync(path.join(f.data,'preserved-history.json')),saved);
 await f.stop(run);
});
