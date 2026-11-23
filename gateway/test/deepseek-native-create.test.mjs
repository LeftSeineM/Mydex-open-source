import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {DeepSeekDesktop} from '../deepseek-desktop.mjs';import {Adapter} from '../adapter.mjs';

test('DSH creates through original controller, with exact cwd and stable native identity',async t=>{
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-native-'));t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
 const c=new DeepSeekDesktop(),requestId=crypto.randomUUID(),calls=[];
 c.rpc=async(method,request,namespace='session')=>{calls.push({method,request,namespace});return namespace==='workspace'?{workspace:{workspaceId:'original-workspace'}}:{sessionId:request.sessionId};};
 const result=await c.create(cwd,requestId);assert.deepEqual(calls,[{method:'create',request:{path:cwd},namespace:'workspace'},{method:'create',request:{workspaceId:'original-workspace',sessionId:'session-'+requestId},namespace:'session'}]);assert.equal(result.sessionId,'session-'+requestId);
 await assert.rejects(c.create('relative/path',requestId),/本机工作目录/);
});
test('new blank DSH session remains readable and accepts its first prompt',async()=>{
 const c=new DeepSeekDesktop(),id='session-new',calls=[];
 c.rpc=async(method,request)=>{calls.push({method,request});if(method==='list')return {items:[{sessionId:id,blank:true,projections:{asOfSeq:0}}]};if(method==='projections')return {asOfSeq:0};if(method==='page')return {records:[],hasMore:false};if(method==='prompt')return {accepted:true};};
 assert.equal((await c.sessions()).length,0);assert.equal((await c.detail(id)).session.sessionId,id);await c.send(id,'first prompt','stable-existing-request');assert.equal(calls.at(-1).request.requestId,'stable-existing-request');
});
test('DSH adapter new conversation preserves native identity on uncertain first message',async()=>{
 const calls=[],a=Object.create(Adapter.prototype);a.dispatch=async()=>[{id:'project',toolId:'deepseek',path:'D:/workspace'}];
 a.dshCreations={createAndPrompt:async({cwd,requestId})=>{calls.push({cwd,requestId});return {sessionId:'session-original',initialDelivery:'unknown'};}};
 const t=await a.create({toolId:'deepseek',mode:'desktop',projectId:'project',instruction:'read-only test',requestId:'stable-id'});assert.equal(t.id,'native:deepseek:session-original');assert.equal(t.initialDelivery,'unknown');assert.equal(t.source,'desktop');assert.equal(calls.length,1);
 await assert.rejects(a.create({toolId:'deepseek',projectId:'unknown',instruction:'x'}),/真实工作目录/);
 await assert.rejects(a.create({toolId:'deepseek',projectId:'project',model:'other',instruction:'x'}),/默认模型/);
});
