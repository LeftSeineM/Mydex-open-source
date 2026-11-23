// Adapted from graceeeeeeeee124's patch/tests in Mydex-mobile issue #1.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {socketCandidates} from '../platform-sockets.mjs';
import {NativeFollower} from '../native.mjs';
import {Desktop} from '../desktop.mjs';
import {Adapter} from '../adapter.mjs';
import {migrateCodexExecutable,discoverCodex} from '../../desktop/setup.mjs';

test('current Unix socket directories, CODEX_HOME, override and ownership',{skip:process.platform==='win32'},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-mac-'));const servers=[];
 t.after(async()=>{for(const server of servers)await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});});
 async function socket(relative){const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});const server=net.createServer();await new Promise((r,j)=>{server.once('error',j);server.listen(file,r);});servers.push(server);return file;}
 const tools=await socket('codex-app-tools/test.sock'),browser=await socket('codex-browser-use/test.sock'),native=await socket('home/ipc/ipc.sock'),legacy=await socket('codex-app-tools-legacy.sock');
 const opts={platform:'darwin',temp:root,env:{CODEX_HOME:path.join(root,'home')},uid:process.getuid()};
 for(const file of [tools,browser,legacy])assert(socketCandidates('tools',opts).includes(file));
 assert(socketCandidates('native',opts).includes(native));
 const fake=path.join(root,'codex-app-tools/fake.sock');fs.writeFileSync(fake,'not a socket');assert(!socketCandidates('tools',opts).includes(fake));
 assert(!socketCandidates('tools',{...opts,uid:process.getuid()+1}).includes(tools));
 assert.equal(socketCandidates('tools',{...opts,env:{...opts.env,MYDEX_CODEX_TOOLS_SOCKET:tools}})[0],tools);
 const linkRoot=path.join(root,'linked');fs.mkdirSync(linkRoot);fs.symlinkSync(path.dirname(tools),path.join(linkRoot,'codex-app-tools'));assert(!socketCandidates('tools',{...opts,temp:linkRoot}).includes(path.join(linkRoot,'codex-app-tools/test.sock')));
});
test('Windows IPC endpoint remains unchanged',()=>assert.deepEqual(socketCandidates('native',{platform:'win32'}),['\\\\.\\pipe\\codex-ipc']));
test('follower sends idle/active messages only to the discovered owner; never retries',async()=>{
 const n=new NativeFollower();let captured,calls=0;
 n.snapshot=async()=>({threadRuntimeStatus:{type:'idle'}});n.watch=async()=>{};n.owners.set('thread','owner');
 n.request=async(...args)=>{calls++;captured=args;return {resultType:'success',result:{}};};
 assert.deepEqual(await n.send('thread','hello'),{accepted:true});
 assert.equal(captured[0],'thread-follower-start-turn');assert.equal(captured[2],2);assert.equal(captured[3],'owner');assert.equal(captured[1].turnStart.request.threadId,'thread');assert.deepEqual(captured[1].turnStart.context,{inheritThreadSettings:true});
 n.snapshot=async()=>({threadRuntimeStatus:'active'});await n.send('thread','continue');assert.equal(captured[0],'thread-follower-steer-turn');assert.equal(captured[2],1);assert.ok(captured[1].clientUserMessageId);assert.deepEqual(captured[1].restoreMessage,{context:{}});
 n.snapshot=async()=>({threadRuntimeStatus:'needsAttention'});const before=calls;await assert.rejects(n.send('thread','wait'),/等待审批/);assert.equal(calls,before);
 n.snapshot=async()=>({threadRuntimeStatus:'idle'});n.request=async()=>{calls++;throw Error('ambiguous');};await assert.rejects(n.send('thread','once'),/ambiguous/);assert.equal(calls,before+1);
});
test('snapshot waits for matching thread and clears listeners on disconnect',async()=>{
 const n=new NativeFollower();n.watch=async()=>{};
 const pending=n.snapshot('one');await Promise.resolve();n.emit('state',{id:'other',state:{wrong:true}});n.emit('state',{id:'one',state:{ok:true}});assert.deepEqual(await pending,{ok:true});assert.equal(n.listenerCount('state'),0);
 const closed=n.snapshot('one');await Promise.resolve();n.emit('disconnected');await assert.rejects(closed,/disconnected/);assert.equal(n.listenerCount('state'),0);assert.equal(n.listenerCount('disconnected'),0);
});
test('tool connection rejected without data fails promptly',async t=>{
 const server=net.createServer(s=>{s.resume();s.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const start=Date.now();await assert.rejects(new Desktop().rpc({port:server.address().port,host:'127.0.0.1'},'tools/list',{},5000),/关闭或拒绝/);assert(Date.now()-start<3000);
});
test('adapter only falls back before a write; pending model settings are applied first',async()=>{
 const a=Object.create(Adapter.prototype),calls=[];a.controls={pending:{'desktop:one':{model:'chosen'}}};
 a.desktop={pipe:null,discover:async()=>{throw Error('unavailable');}};
 a.native={control:async(...args)=>{calls.push(['settings',...args]);return {applied:true};},send:async(...args)=>{calls.push(['send',...args]);return {accepted:true};}};
 await a.send('desktop:one',{instruction:'hello'});assert.deepEqual(calls.map(c=>c[0]),['settings','send']);assert.equal(calls[0][3].threadSettings.model,'chosen');
 calls.length=0;a.desktop={pipe:'cached',call:async()=>{throw Error('ambiguous tool timeout');}};await assert.rejects(a.send('desktop:one',{instruction:'once'}),/ambiguous/);assert.equal(calls.length,0);
 a.desktop={pipe:null,discover:async()=>{throw Error('unavailable');}};a.native.control=async()=>({applied:false});await assert.rejects(a.send('desktop:one',{instruction:'hello'}),/尚未应用/);assert.equal(calls.length,0);
});
test('legacy CLI migration fills missing path once and preserves credentials and explicit choices',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-migrate-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'config.json'),config={token:'fixture-only',local:{codexExecutable:'',id:'original'}};fs.writeFileSync(file,JSON.stringify(config));const original=fs.readFileSync(file);
 const opts={platform:'darwin',discover:()=>'/fixture/codex'};
 assert.equal(migrateCodexExecutable(file,config,opts),true);assert.deepEqual(fs.readFileSync(file+'.before-codex-path-migration'),original);assert.equal(JSON.parse(fs.readFileSync(file)).token,'fixture-only');assert.equal(config.local.id,'original');
 assert.equal(migrateCodexExecutable(file,config,{...opts,discover:()=>'/different'}),false);assert.equal(config.local.codexExecutable,'/fixture/codex');
 assert.equal(migrateCodexExecutable(file,{local:{}},{...opts,platform:'win32'}),false);
});
test('discovers user-installed ChatGPT CLI on macOS',{skip:process.platform==='win32'},t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-cli-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const file=path.join(home,'Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'#!/bin/sh\n',{mode:0o700});
 // System-installed Codex may legitimately take precedence on a real Mac.
 const result=discoverCodex(home,'darwin');assert(result===file||result.startsWith('/Applications/'));
});
