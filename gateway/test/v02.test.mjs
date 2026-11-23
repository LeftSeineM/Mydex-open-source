import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {X509Certificate} from 'node:crypto';
import {Controls} from '../controls.mjs';
import {Adapter} from '../adapter.mjs';
import {normalizeTranscript} from '../tool-registry.mjs';
import {cliArguments} from '../cli-adapter.mjs';
import {createHub} from '../../desktop/setup.mjs';

test('slow global desktop list never blocks local history or marks local desktop offline',async()=>{
 const a=Object.create(Adapter.prototype);a.desktop={discover:async()=>{},call:()=>new Promise(()=>{})};
 a.config={};a.indexed=[{id:'desktop:local',updatedAt:1}];a.managed=new Map();a.nativeTasks=new Map();a.cli={tasks:new Map()};a.toolbox={list:async()=>[]};
 const result=await a.list();assert.equal(result.desktopOnline,true);assert.equal(result.tasks[0].id,'desktop:local');
});

test('tool prompts stay arguments or stdin, never shell command text',()=>{
 const prompt='literal $(echo secret) & del /s * | `whoami` "quoted"\nnext';
 for(const name of ['claude','gemini','opencode','openclaw']){
  const r=cliArguments(name,prompt);assert(r.stdin===prompt||r.args.includes(prompt));
  assert(!r.args.includes('--dangerously-skip-permissions'));assert(!r.args.includes('--deliver'));
 }
});
test('foreign transcripts retain user text, tool blocks and stable message identity',()=>{
 const r=normalizeTranscript([{uuid:'u',type:'user',message:{role:'user',content:'hello'}},{uuid:'a',message:{role:'assistant',content:[{type:'text',text:'partial'}]}},{uuid:'a',message:{role:'assistant',content:[{type:'text',text:'complete'},{type:'tool_use',name:'read_file',input:{path:'x'}}]}}]);
 assert.equal(r.messages.length,3);assert.equal(r.messages[1].text,'complete');assert.equal(r.messages[2].type,'step');
});
test('control rejects invalid model, effort, budget and foreign queue item',async()=>{
 const c=Object.create(Controls.prototype);c.raw=()=> 'thread';c.catalog=async()=>[{id:'real',efforts:['low'],fast:false}];
 await assert.rejects(c.settings('desktop:x',{model:'invented'}),/模型/);
 await assert.rejects(c.settings('desktop:x',{model:'real',effort:'ultra'}),/强度/);
 await assert.rejects(c.settings('desktop:x',{model:'real',fast:true}),/快速/);
 await assert.rejects(c.goal('desktop:x',{status:'active',tokenBudget:-1}),/预算/);
 c.rpc=async()=>({data:[{id:'mine'}]});await assert.rejects(c.queue('desktop:x',{action:'remove',queueId:'foreign'}),/不属于/);
});
test('portable setup creates private unique credentials and a verifiable IP certificate without overwriting',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-setup-'));t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert(path.basename(dir).startsWith('mydex-setup-'));fs.rmSync(dir,{recursive:true,force:true});});
 const c=createHub({directory:dir,address:'https://127.0.0.1:18443'});
 assert(c.token.length>=32);assert.notEqual(c.token,c.devices[1].token);
 const cert=new X509Certificate(fs.readFileSync(c.tls.cert));assert(cert.verify(cert.publicKey));assert.equal(cert.checkIP('127.0.0.1'),'127.0.0.1');
 assert.throws(()=>createHub({directory:dir,address:'https://127.0.0.1:18443'}),/未覆盖/);
 const pair=JSON.parse(fs.readFileSync(path.join(dir,'gateway/private/pair-computer-2.json')));assert.equal(pair.token,c.devices[1].token);
});

test('independent desktop creates only its own device and no computer-pairing file',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-standalone-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert(path.basename(dir).startsWith('mydex-standalone-'));fs.rmSync(dir,{recursive:true,force:true});});
 const c=createHub({directory:dir,address:'https://127.0.0.1:18443',standalone:true,name:'Independent PC'});
 assert.deepEqual(c.devices,[{id:c.local.id,name:'Independent PC'}]);
 assert(!fs.existsSync(path.join(dir,'gateway/private/pair-computer-2.json')));
});
