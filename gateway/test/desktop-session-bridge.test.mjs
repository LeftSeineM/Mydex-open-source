import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import runtime from '../../desktop/bridges/session-server.cjs';
import {DesktopSessionBridge} from '../desktop-session-bridge.mjs';
import {Adapter} from '../adapter.mjs';
import {ToolRegistry} from '../tool-registry.mjs';

test('desktop bridge sends to the exact existing session and deduplicates uncertain delivery',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-native-'));let sends=0;
 const manager={getAllSessions:async()=>[{sessionId:'original',title:'Desktop',credential:'NEVER EXPOSE'}],getSession:async id=>id==='original'?{sessionId:id}:null,
 getTranscript:async()=>[{uuid:'a',message:{role:'assistant',content:'Original response'},secret:'NEVER EXPOSE'}],sendMessage:async(id,text,image,options)=>{sends++;assert.equal(id,'original');assert.equal(text,'continue');assert.equal(image,undefined);assert(options.messageUuid);return {delivered:true};}};
 const host=await runtime.startSessionServer({manager,descriptorPath:path.join(dir,'claude-desktop.json')});
 t.after(async()=>{await host.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert(path.basename(dir).startsWith('mydex-native-'));fs.rmSync(dir,{recursive:true,force:true});});
 const bridge=new DesktopSessionBridge({bridgeDirectory:dir});
 assert.equal((await bridge.sessions('claude-desktop'))[0].sessionId,'original');
 assert(!JSON.stringify(await bridge.sessions('claude-desktop')).includes('NEVER EXPOSE'));
 assert(!JSON.stringify(await bridge.detail('claude-desktop','original')).includes('NEVER EXPOSE'));
 const body={sessionId:'original',instruction:'continue',requestId:crypto.randomUUID()};
 await Promise.all([bridge.request('claude-desktop','send',body),bridge.request('claude-desktop','send',body)]);assert.equal(sends,1);
 await assert.rejects(bridge.request('claude-desktop','send',{...body,instruction:'different'}),/conflict/);
 await assert.rejects(bridge.send('claude-desktop','not-on-desktop','continue'),/unavailable/);assert.equal(sends,1);
 const url=`http://127.0.0.1:${host.descriptor.port}/v1/sessions`;
 assert.equal((await fetch(url)).status,401);
 assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+host.descriptor.token,Origin:'https://untrusted.example'}})).status,401);
});

test('desktop-only creation never falls back to an independent CLI task',async()=>{
 const a=Object.create(Adapter.prototype);a.remoteDesktop={rows:new Map(),refs:new Map()};let created=false;a.cli={create:()=>{created=true;}};
 for(const toolId of ['claude','claude-desktop','zcode','gemini','opencode'])await assert.rejects(a.create({toolId,instruction:'continue'}),/桌面/);
 assert.equal(created,false);
});

test('native session routing preserves Unicode identifiers, project directory and original text',async()=>{
 const registry=Object.create(ToolRegistry.prototype);
 registry.bridge={detail:async(tool,id)=>{assert.equal(tool,'claude-desktop');assert.equal(id,'会话/a:b');return {session:{sessionId:id,cwd:'D:/project',title:'Original'},messages:[{uuid:'u',message:{role:'user',content:'继续这条对话'}}]};}};
 const detail=await registry.nativeDetail('native:claude-desktop:'+encodeURIComponent('会话/a:b'));
 assert.equal(detail.cwd,'D:/project');assert.equal(detail.messages[0].text,'继续这条对话');assert.equal(detail.readOnly,false);
 const a=Object.create(Adapter.prototype);a.remoteDesktop={rows:new Map(),refs:new Map()};a.toolbox=registry;a.config={};
 assert.deepEqual(await a.detail(detail.id),detail);
});

test('desktop-owned conversation is not duplicated as imported file history',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-dedup-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert(path.basename(dir).startsWith('mydex-dedup-'));fs.rmSync(dir,{recursive:true,force:true});});
 const metadata=path.join(dir,'AppData/Local/Claude-3p/claude-code-sessions/account');fs.mkdirSync(metadata,{recursive:true});
 fs.writeFileSync(path.join(metadata,'local_original.json'),JSON.stringify({cliSessionId:'cli-original',title:'Original'}));
 const project=path.join(dir,'.claude/projects/project');fs.mkdirSync(project,{recursive:true});
 fs.writeFileSync(path.join(project,'cli-original.jsonl'),JSON.stringify({uuid:'u',message:{role:'user',content:'original'}}));
 const registry=new ToolRegistry({homeDir:dir});registry.bridge.sessions=async tool=>tool==='claude-desktop'?[{sessionId:'local_original',title:'Original'}]:[];
 const tasks=await registry.list();assert.equal(tasks.length,1);assert.equal(tasks[0].id,'native:claude-desktop:local_original');
});


test('ZCode loads the same cold desktop conversation before sending',async()=>{
 const bridge=new DesktopSessionBridge({});const calls=[];
 bridge.request=async(tool,route,body)=>{calls.push([tool,route,body?.sessionId]);return {};};
 await bridge.send('zcode','original','continue');
 assert.deepEqual(calls.map(c=>c.slice(0,3)),[['zcode','detail','original'],['zcode','send','original']]);
});
