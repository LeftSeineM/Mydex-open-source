import crypto from 'node:crypto';
import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createGateway} from '../server.mjs';import {DshCreationJournal,nativeCreationId} from '../dsh-creation-journal.mjs';import {summary} from '../transport.mjs';

test('HTTP creation identity survives lost result and gateway restart; GET only recovers original',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-http-recovery-')),cwd=path.join(dir,'workspace');fs.mkdirSync(cwd);let creates=0,sends=0,failResponse=true;const sessions=[];
 const client={create:async(cwd,id)=>{creates++;const s={sessionId:'session-'+id,cwd};sessions.push(s);return s;},send:async()=>{sends++;return {accepted:true};},rawSessions:async()=>sessions};
 const key=crypto.randomBytes(24).toString('hex'),token=crypto.randomBytes(32).toString('hex');
 class Fake extends EventEmitter{
   constructor(){super();this.journal=new DshCreationJournal({directory:path.join(dir,'journal'),client});}
   async dispatch(method,args){
     if(method==='list')return {tasks:[],desktopOnline:true};
     if(method==='create'){
       assert.equal(args.requestId,key);const r=await this.journal.createAndPrompt({cwd,instruction:args.instruction,requestId:args.requestId});
       if(failResponse){failResponse=false;throw Error('Lost adapter result after native admission');}
       return {id:'native:deepseek:'+r.sessionId,initialDelivery:r.initialDelivery,creationRequestId:key,source:'desktop',toolId:'deepseek'};
     }
     if(method==='creationStatus'){const r=await this.journal.inspect(args.requestId);return {...r,task:r.sessionId?{id:'native:deepseek:'+r.sessionId,source:'desktop',toolId:'deepseek',initialDelivery:r.initialDelivery,creationRequestId:key}:null};}
     return [];
   }
 }
 const config={local:{id:'pc'},token,devices:[{id:'pc'}],ledgerFile:path.join(dir,'requests.json')};let g=createGateway(config,new Fake());
 const start=async()=>{await new Promise(r=>g.server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+g.server.address().port;};let base=await start();
 t.after(async()=>{await new Promise(r=>g.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const headers={Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':key};
 const body={deviceId:'pc',toolId:'deepseek',projectId:'p',instruction:'Only return a marker',requestId:'body-must-not-override-http-key'};
 assert.equal((await fetch(base+'/api/tasks',{method:'POST',headers,body:JSON.stringify(body)})).status,502);assert.equal(creates,1);assert.equal(sends,1);
 await new Promise(r=>g.server.close(r));g=createGateway(config,new Fake());base=await start();
 assert.equal((await fetch(base+'/api/requests/'+key)).status,401);
 const recovered=await(await fetch(base+'/api/requests/'+key,{headers})).json();assert.equal(recovered.task.id,'pc~native:deepseek:session-'+nativeCreationId(key));assert.equal(recovered.task.initialDelivery,'acknowledged');assert.equal(recovered.task.projectId,'p');
 const before={creates,sends};await fetch(base+'/api/requests/'+key,{headers});await fetch(base+'/api/tasks',{method:'POST',headers,body:JSON.stringify(body)});assert.deepEqual({creates,sends},before);
 assert.equal((await(await fetch(base+'/api/requests/unknown-request-12345',{headers})).json()).state,'not-found');
});

test('first prompt receipt uncertainty is preserved in transport and reconciled from exact native request event',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-prompt-reconcile-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let sends=0;
 const requestId='abcdef1234567890abcdef1234567890abcdef1234567890';const client={create:async(cwd,id)=>({sessionId:'session-'+id}),send:async()=>{sends++;throw Error('lost receipt');},detail:async()=>({submittedRequests:[nativeCreationId(requestId)]})};
 const j=new DshCreationJournal({directory:path.join(dir,'journal'),client}),r=await j.createAndPrompt({cwd:dir,instruction:'marker',requestId});assert.equal(r.initialDelivery,'unknown');
 assert.equal(summary({id:'native:deepseek:'+r.sessionId,initialDelivery:r.initialDelivery,creationRequestId:requestId}).initialDelivery,'unknown');
 const recovered=await j.inspect(requestId);assert.equal(recovered.initialDelivery,'acknowledged');assert.equal(sends,1);
});

test('DSH continuation keeps stable phone identity through lost receipt and gateway restart',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-message-recovery-'));let sends=0,observed=false,lastKey;
 class Fake extends EventEmitter{async dispatch(method,args){if(method==='list')return {tasks:[]};if(method==='send'){sends++;lastKey=args.requestId;observed=true;throw Error('receipt lost after native send');}if(method==='messageStatus'){assert.equal(args.requestId,lastKey);return {acknowledged:observed};}return [];}}
 const key=crypto.randomBytes(24).toString('hex'),token=crypto.randomBytes(32).toString('hex'),config={local:{id:'pc'},token,devices:[{id:'pc'}],ledgerFile:path.join(dir,'ledger.json')};let g=createGateway(config,new Fake());
 const start=async()=>{await new Promise(r=>g.server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+g.server.address().port;};let base=await start();t.after(async()=>{await new Promise(r=>g.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const headers={Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':key},route='/api/tasks/'+encodeURIComponent('pc~native:deepseek:original')+'/messages',body=JSON.stringify({instruction:'continue',requestId:'cannot-override'});
 assert.equal((await fetch(base+route,{method:'POST',headers,body})).status,502);assert.equal(lastKey,key);
 await new Promise(r=>g.server.close(r));g=createGateway(config,new Fake());base=await start();
 const recovered=await(await fetch(base+'/api/requests/'+key,{headers})).json();assert.equal(recovered.task.id,'pc~native:deepseek:original');assert.equal(recovered.task.delivery,'acknowledged');
 await fetch(base+route,{method:'POST',headers,body});assert.equal(sends,1);
});
