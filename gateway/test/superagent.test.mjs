import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Coordinator,boundedConversation} from '../superagent/coordinator.mjs';import {Workers} from '../superagent/workers.mjs';import {RouterModel} from '../superagent/provider.mjs';
const proposed=()=>({role:'assistant',content:'',tool_calls:[{id:'call-1',type:'function',function:{name:'propose_create',arguments:JSON.stringify({worker:'mini/mini',toolId:'codex',projectId:'p',instruction:'只做本任务'})}}]});
async function setup(t,{reply=proposed,execute,modelLimit=30}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-coord-')),dbFile=path.join(dir,'tasks.sqlite');let writes=0,detail={id:'mini~desktop:x',status:'Running',messages:[]};
 const workers={list:async()=>[],projects:async()=>[],sessions:async()=>[],validate:async()=>{},execute:async()=>{writes++;return execute?execute():{id:'mini~desktop:x',status:'Running'};},detail:async()=>detail};
 const model={turn:async()=>reply()},c=new Coordinator({dbFile,model,workers,maxCallsPerHour:modelLimit,staleMs:0});
 t.after(async()=>{await c.close();fs.rmSync(dir,{recursive:true,force:true});});return {c,dbFile,workers,model,writes:()=>writes,setDetail:d=>detail=d};
}
test('plans are durable and cannot execute before human approval; duplicate approval writes once',async t=>{
 const x=await setup(t),task=x.c.create({instruction:'测试'});await x.c.idle();assert.equal(x.writes(),0);const d=x.c.get(task.id);assert.equal(d.status,'AwaitingApproval');
 const a=d.approvals[0].id;await Promise.all([x.c.approve({id:d.id,approvalId:a,decision:'accept'}),x.c.approve({id:d.id,approvalId:a,decision:'accept'})]);assert.equal(x.writes(),1);assert.equal(d.status,'Running');
 const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(x.dbFile,{readOnly:true});assert.equal(JSON.parse(db.prepare('select data from tasks where id=?').get(d.id).data).assignments[0].session,'mini~desktop:x');db.close();
});
test('new human input invalidates old approvals and retains isolated tasks',async t=>{
 const x=await setup(t),a=x.c.create({instruction:'A'}),b=x.c.create({instruction:'B'});await x.c.idle();const old=x.c.get(a.id).approvals[0].id;x.c.send({id:a.id,instruction:'改变要求'});await x.c.idle();await x.c.approve({id:a.id,approvalId:old,decision:'accept'});assert.equal(x.writes(),0);assert.equal(x.c.get(b.id).messages.some(m=>m.text==='改变要求'),false);
});
test('ambiguous dispatch is not retried after reopening database',async t=>{
 const x=await setup(t,{execute:()=>{throw Error('network lost after accept');}}),task=x.c.create({instruction:'测试'});await x.c.idle();const d=x.c.get(task.id);await x.c.approve({id:d.id,approvalId:d.approvals[0].id,decision:'accept'});assert.equal(d.actions[0].state,'uncertain');
 const other=new Coordinator({dbFile:x.dbFile,model:x.model,workers:x.workers});await other.idle();assert.equal(other.get(d.id).actions[0].state,'uncertain');assert.equal(x.writes(),1);await other.close();
});
test('worker terminal creates event, keeps original session and does not claim experimental acceptance',async t=>{
 const x=await setup(t),task=x.c.create({instruction:'测试'});await x.c.idle();const d=x.c.get(task.id);await x.c.approve({id:d.id,approvalId:d.approvals[0].id,decision:'accept'});x.model.turn=async()=>({role:'assistant',content:'已收到本轮结果，请验收。'});
 x.setDetail({id:'mini~desktop:x',status:'Completed',messages:[{id:'r',role:'agent',type:'text',text:'结果'}]});await x.c.checkProgress();await x.c.idle();assert(d.assignments[0].finished);assert(d.messages.some(m=>m.text.includes('尚不代表验收通过')));assert.equal(x.writes(),1);
});
test('watchdog only warns; it never kills or resubmits an unchanged worker',async t=>{
 const x=await setup(t),task=x.c.create({instruction:'测试'});await x.c.idle();const d=x.c.get(task.id);await x.c.approve({id:d.id,approvalId:d.approvals[0].id,decision:'accept'});await x.c.checkProgress();await new Promise(r=>setTimeout(r,5));await x.c.checkProgress();await x.c.checkProgress();assert.equal(d.messages.filter(m=>m.text.includes('长时间没有')).length,1);assert.equal(x.writes(),1);
});
test('model call budget is persistent and finite',async t=>{
 const x=await setup(t,{modelLimit:1,reply:()=>({role:'assistant',content:'答复'})});x.c.create({instruction:'a'});await x.c.idle();const b=x.c.create({instruction:'b'});await x.c.idle();assert.match(x.c.get(b.id).error,/上限/);
});
test('worker allowlist rejects wrong computer/session and forces native desktop mode with stable request id',async()=>{
 let request;const w=new Workers([{id:'mini',devices:['mini'],url:'https://localhost',token:'x'}],async(p,route,args)=>{request={route,args};return {ok:true};});assert.throws(()=>w.profile('other/mini'));await assert.rejects(w.detail('mini/mini','laptop~desktop:x'));
 await w.execute('propose_create',{worker:'mini/mini',toolId:'codex',projectId:'p',instruction:'hi'},'same-id');assert.equal(request.args.body.mode,'desktop');assert.equal(request.args.requestId,'same-id');assert.equal(request.args.body.model,undefined);
 const sent=await w.execute('propose_send',{worker:'mini/mini',session:'mini~desktop:x',instruction:'hi'},'same-id');assert.equal(sent.id,'mini~desktop:x');
});
test('provider uses requested model/low effort; does not echo sensitive provider failure',async()=>{
 let body;const model=new RouterModel({baseUrl:'https://example.com/v1',model:'gpt-6.1-sol',key:'secret',effort:'low'},async(u,options)=>{body=JSON.parse(options.body);return {ok:false,status:403,json:()=>({error:'secret'})};});await assert.rejects(model.turn([],[]),e=>!e.message.includes('secret'));assert.equal(body.reasoning_effort,'low');assert.equal(body.model,'gpt-6.1-sol');
});

test('history trimming preserves complete tool exchanges',()=>{
 const history=[{role:'user',content:'old'},...Array.from({length:45},(_,i)=>({role:i%2?'tool':'assistant',content:''})),{role:'user',content:'latest'},{role:'assistant',content:'ok'}];
 const trimmed=boundedConversation(history);assert.equal(trimmed[0].content,'latest');assert.equal(trimmed.length,2);
});
test('new instruction during approval validation prevents stale external write',async t=>{
 const x=await setup(t),task=x.c.create({instruction:'first'});await x.c.idle();const d=x.c.get(task.id);
 let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 x.workers.validate=async()=>{enter();await gate;};
 const approving=x.c.approve({id:d.id,approvalId:d.approvals[0].id,decision:'accept'});
 await entered;x.c.send({id:d.id,instruction:'changed'});release();await approving;await x.c.idle();
 assert.equal(x.writes(),0);assert.equal(d.actions[0].state,'superseded');
});
