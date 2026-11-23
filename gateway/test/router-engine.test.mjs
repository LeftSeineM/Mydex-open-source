import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {NativeRouter,interactionRevision} from '../router/engine.mjs';

const key=()=>crypto.randomUUID();
test('on-demand preparation requires execution grant and never runs during research',async t=>{
 const f=fixture(t),a=await f.assignment();let wakes=0;
 f.adapter.prepare=async()=>{wakes++;return {ready:true,launched:false};};
 await f.engine.readSession({jobId:a.job,sessionKey:f.node.key});assert.equal(wakes,0);
 f.engine.setExecution({jobId:a.job,expectedRevision:1,sessions:[],workspaces:[]},key(),'human');
 await assert.rejects(f.engine.prepareTool({jobId:a.job,sessionKey:f.node.key},key()),/authorization required/);
 await assert.rejects(f.engine.dispatch(a.id),/authorization required/);assert.equal(wakes,0);
});
test('only an unsent queued Worker may adopt the app instance awakened by Mydex',async t=>{
 const f=fixture(t),a=await f.assignment();
 f.adapter.prepare=async()=>{f.states.get(f.node.key).generation='awakened-instance';return {ready:true,launched:true};};
 const sent=await f.engine.dispatch(a.id);assert.equal(sent.node.generation,'awakened-instance');assert.equal(f.sends,1);
 f.states.get(f.node.key).generation='another-instance';await f.engine.reconcile(a.id);
 assert.equal(f.engine.task(a.id).state,'human_intervention');assert.equal(f.sends,1);
});
test('phone distinguishes persisted updates from Router read acknowledgements across restart',async t=>{
 const f=fixture(t),a=await f.assignment();
 const status=()=>f.engine.snapshot(a.job).jobs[0].routerReading;
 const before=status();assert.equal(before.status,'unread');assert.ok(before.unread>0);assert.equal(before.lastReadAt,null);
 const briefing=await f.engine.request('briefing',{jobId:a.job});
 assert.deepEqual(status(),before); // Fetching or viewing is not a Router acknowledgement.
 await assert.rejects(f.engine.request('ack_briefing',{jobId:a.job,digest:briefing.digest,through:briefing.through},key(),{authority:'human'}),/Only the Router/);
 await f.engine.request('ack_briefing',{jobId:a.job,digest:briefing.digest,through:briefing.through},key());
 const read=status();assert.equal(read.status,'caught_up');assert.equal(read.unread,0);assert.ok(read.lastReadAt>0);
 f.restart();assert.deepEqual(status(),read);
 f.engine.pause(a.job,key());assert.equal(status().status,'unread');assert.equal(status().unread,1);
 assert.equal(status().acknowledged,read.acknowledged);assert.equal(f.sends,0);
});
test('only user can confirm exact restarted instance without native writes or accepting results',async t=>{
 const f=fixture(t),task=await f.assignment();await f.engine.dispatch(task.id);
 f.states.get(f.node.key).generation='instance-2';await f.engine.reconcile(task.id);
 const args={taskId:task.id,previousGeneration:'instance-1',generation:'instance-2'},id=key();
 await assert.rejects(f.engine.request('confirm_instance',args,id),/authenticated user/);
 await assert.rejects(f.engine.request('confirm_instance',{...args,generation:'wrong'},id,{authority:'human'}),/restarted again/);
 const result=await f.engine.request('confirm_instance',args,id,{authority:'human'});
 assert.equal(result.state,'awaiting_observation');assert.equal(result.node.generation,'instance-2');
 f.restart();const replay=await f.engine.request('confirm_instance',args,id,{authority:'human'});
 assert.equal(replay.id,task.id);assert.equal(f.sends,1);assert.equal(f.answers,0);
 assert.equal(f.engine.events({jobId:task.job}).filter(e=>e.kind==='instance_confirmed').length,1);
});

test('restarted instance cannot erase native human input or missing dispatch evidence',async t=>{
 const f=fixture(t),task=await f.assignment();await f.engine.dispatch(task.id);
 const native=f.states.get(f.node.key);native.generation='instance-2';await f.engine.reconcile(task.id);
 const args={taskId:task.id,previousGeneration:'instance-1',generation:'instance-2'};
 native.messages.push({id:'new-human',role:'user',text:'Change requirements'});
 await assert.rejects(f.engine.request('confirm_instance',args,key(),{authority:'human'}),/user input changed/);
 native.messages=[];
 await assert.rejects(f.engine.request('confirm_instance',args,key(),{authority:'human'}),/evidence unavailable/);
 assert.equal(f.engine.task(task.id).node.generation,'instance-1');assert.equal(f.sends,1);
});
test('restarted Worker reports one generation transition without polling event flood',async t=>{
 const f=fixture(t),task=await f.assignment();await f.engine.dispatch(task.id);
 f.states.get(f.node.key).generation='instance-2';
 await f.engine.reconcile(task.id);f.restart();
 for(let n=0;n<6;n++)await f.engine.reconcile(task.id);
 assert.equal(f.engine.events({jobId:task.job}).filter(e=>e.kind==='generation_changed').length,1);
 assert.equal(f.engine.task(task.id).state,'human_intervention');
 assert.equal(f.engine.task(task.id).node.generation,'instance-1');assert.equal(f.sends,1);
 f.states.get(f.node.key).generation='instance-3';await f.engine.reconcile(task.id);
 assert.equal(f.engine.events({jobId:task.job}).filter(e=>e.kind==='generation_changed').length,2);
});
test('read-only command recovery survives restart and never implies safe retry',async t=>{
 const f=fixture(t),requestId=key();
 const created=await f.engine.createJob({name:'receipt',scope:[f.node.key]},requestId);
 f.restart();
 f.adapter.catalog=async()=>{throw Error('offline');};
 const receipt=await f.engine.request('command_receipt',{requestId},undefined,{authority:'human'});
 assert.equal(receipt.status,'recorded');assert.equal(receipt.result.id,created.id);
 assert.equal(receipt.retryAllowed,false);assert.equal(f.engine.snapshot().jobs.length,1);
 const missing=await f.engine.request('command_receipt',{requestId:key()},undefined,{authority:'human'});
 assert.equal(missing.status,'not_observed');assert.equal(missing.retryAllowed,false);
 await assert.rejects(f.engine.request('command_receipt',{requestId,authority:'human'}),/authenticated user/);
 assert.equal(f.sends,0);
});

test('dispatch recovery reads stable outbox without reconciling or sending',async t=>{
 const f=fixture(t),task=await f.assignment();f.uncertain=true;
 await f.engine.dispatch(task.id);f.restart();
 f.adapter.inspect=async()=>{throw Error('must not inspect');};
 const receipt=await f.engine.request('command_receipt',{requestId:task.dispatchId},undefined,{authority:'human'});
 assert.equal(receipt.status,'delivery_unknown');assert.equal(receipt.task.id,task.id);
 assert.equal(receipt.retryAllowed,false);assert.equal(f.sends,1);
});

test('cancel recovery distinguishes confirmed original turn from an unknown receipt',async t=>{
 for(const confirmed of [true,false]){
  const f=fixture(t),task=await f.assignment(),requestId=key();await f.engine.dispatch(task.id);
  let calls=0;f.adapter.cancel=async()=>{calls++;return {interruptedTurnId:confirmed?'turn-1':'another-turn'};};
  await f.engine.cancel(task.id,requestId);f.restart();
  const receipt=await f.engine.request('command_receipt',{requestId},undefined,{authority:'human'});
  assert.equal(receipt.status,confirmed?'recorded':'delivery_unknown');
  assert.equal(receipt.task.state,confirmed?'cancelled':'cancel_requested');assert.equal(calls,1);
 }
});
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-router-')),file=path.join(dir,'state.sqlite');
  const node={key:'local~desktop:worker',device:'local',session:'desktop:worker',toolId:'codex',mode:'original-live',generation:'instance-1',capabilities:{send:'supported',cancel:'supported',approve:'supported',answer:'supported'}};
  const other={...node,key:'local~native:deepseek:other',session:'native:deepseek:other',toolId:'deepseek'};
  const states=new Map([node,other].map(n=>[n.key,{generation:n.generation,busy:false,messages:[],interactions:[],turnId:'turn-1'}]));
  let sends=0,answers=0,cancels=0,uncertain=false;
  states.set('local~desktop:router',{busy:false,messages:[],interactions:[]});
  const adapter={catalog:async()=>({sessions:[node,other]}),inspect:async n=>structuredClone(states.get(n.key||n.device+'~'+n.session)),send:async(n,text,id)=>{sends++;states.get(n.key||n.device+'~'+n.session).messages.push({id:'u-'+id,role:'user',text});if(uncertain)throw Error('lost receipt');return {accepted:true,requestId:id};},answer:async()=>{answers++;},cancel:async(n,turn)=>{cancels++;return {interruptedTurnId:turn};}};
  let engine=new NativeRouter({file,router:{device:'local',session:'desktop:router'},adapter});
  t.after(()=>{engine.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {node,other,states,adapter,get engine(){return engine;},file,get sends(){return sends;},get answers(){return answers;},get cancels(){return cancels;},set uncertain(v){uncertain=v;},restart(){engine.close();engine=new NativeRouter({file,router:{device:'local',session:'desktop:router'},adapter});return engine;},async assignment(target=node.key){const job=await engine.createJob({name:'test',scope:[target]},key());engine.setExecution({jobId:job.id,expectedRevision:0,sessions:[target],workspaces:[]},key(),'human');return engine.assign({jobId:job.id,sessionKey:target,package:{schemaVersion:1,contextRevision:1,goal:'Read an empty test directory',acceptance:'Return observed file count',constraints:['Do not modify files'],sources:[{kind:'user',ref:'test-request'}]}},key());}};
}

test('scope and exact identity reject unrelated or Router sessions',async t=>{
 const f=fixture(t);await assert.rejects(f.engine.createJob({name:'x',scope:['local~desktop:router']},key()),/eligible/);
 const a=await f.assignment();await assert.rejects(f.engine.assign({jobId:a.job,sessionKey:f.other.key,package:a.package},key()),/not selected/);assert.equal(f.sends,0);
});

test('selected scope is observe-only, and execution grants are exact, durable and user-only',async t=>{
 const f=fixture(t),j=await f.engine.createJob({name:'observe',scope:[f.node.key,f.other.key]},key());
 const args={jobId:j.id,sessionKey:f.node.key,package:{schemaVersion:1,contextRevision:1,goal:'Read',acceptance:'Evidence',constraints:[],sources:[]}};
 await f.engine.readSession({jobId:j.id,sessionKey:f.node.key});
 await assert.rejects(f.engine.assign(args,key()),/Observe-only/);
 const grant={jobId:j.id,expectedRevision:0,sessions:[f.node.key],workspaces:[]};
 await assert.rejects(f.engine.request('set_execution',{...grant,authority:'human'},key()),/authenticated user/);
 f.engine.setExecution(grant,key(),'human');f.restart();
 await assert.rejects(f.engine.assign({...args,sessionKey:f.other.key},key()),/Observe-only/);
 const a=await f.engine.assign(args,key());
 f.engine.setExecution({...grant,expectedRevision:1,sessions:[]},key(),'human');f.restart();
 await assert.rejects(f.engine.dispatch(a.id),/Observe-only/);assert.equal(f.sends,0);
 assert.throws(()=>f.engine.setExecution(grant,key(),'human'),/changed/);
});

test('revocation while native inspection is in flight blocks dispatch',async t=>{
 const f=fixture(t),a=await f.assignment(),inspect=f.adapter.inspect;
 f.adapter.inspect=async n=>{f.engine.setExecution({jobId:a.job,expectedRevision:1,sessions:[],workspaces:[]},key(),'human');return inspect(n);};
 await assert.rejects(f.engine.dispatch(a.id),/Observe-only/);assert.equal(f.sends,0);
});

test('Router cannot answer human interactions even with a forged body authority',async t=>{
 const f=fixture(t),a=await f.assignment();await f.engine.dispatch(a.id);
 for(const kind of ['approval','question']){
   const i={id:kind+'-human',kind,requiresHuman:true};f.states.get(f.node.key).interactions=[i];
   await assert.rejects(f.engine.request('answer',{taskId:a.id,interactionId:i.id,revision:interactionRevision(i),response:{decision:'accept'},authority:'human'},key()),/authenticated user/);
 }
 assert.equal(f.answers,0);
});
test('stable dispatch and task package survive restart without replay',async t=>{
 const f=fixture(t),a=await f.assignment();await f.engine.dispatch(a.id);f.restart();await f.engine.dispatch(a.id);assert.equal(f.sends,1);assert.equal(f.engine.task(a.id).dispatchId,a.dispatchId);
});

test('concurrent different operations never receive another operation receipt',async t=>{
 const f=fixture(t),a=await f.assignment(),inspect=f.adapter.inspect;
 let release;const waiting=new Promise(r=>release=r);f.adapter.inspect=async n=>{await waiting;return inspect(n);};
 const sending=f.engine.dispatch(a.id),sameSend=f.engine.dispatch(a.id);
 await assert.rejects(f.engine.reconcile(a.id),/Another operation/);
 await assert.rejects(f.engine.cancel(a.id,key()),/Another operation/);
 release();assert.equal((await sending).id,a.id);assert.equal((await sameSend).id,a.id);assert.equal(f.sends,1);assert.equal(f.cancels,0);
});

test('one branch revision preserves old evidence and leaves the other branch untouched',async t=>{
 const f=fixture(t),j=await f.engine.createJob({name:'two branches',scope:[f.node.key,f.other.key]},key());
 f.engine.setExecution({jobId:j.id,expectedRevision:0,sessions:j.scope,workspaces:[]},key(),'human');
 const p={schemaVersion:1,contextRevision:1,goal:'Original goal',acceptance:'Original evidence',constraints:[],sources:[{kind:'user',ref:'goal-1'}]};
 const a=await f.engine.assign({jobId:j.id,sessionKey:f.node.key,package:p},key());
 const b=await f.engine.assign({jobId:j.id,sessionKey:f.other.key,package:p},key());
 const before=JSON.stringify(f.engine.task(b.id)),k=key(),args={taskId:a.id,expectedPackageRevision:1,package:{...p,goal:'Corrected goal',sources:[{kind:'user',ref:'correction-2'}]}};
 const next=await f.engine.request('revise_task',args,k);
 assert.equal(next.packageRevision,2);assert.equal(next.branchId,a.id);assert.equal(next.supersedes,a.id);
 assert.equal(f.engine.task(a.id).package.goal,'Original goal');assert.equal(f.engine.task(a.id).state,'superseded');
 assert.equal(JSON.stringify(f.engine.task(b.id)),before);assert.equal(f.engine.job(j.id).contextRevision,1);
 f.restart();assert.equal((await f.engine.request('revise_task',args,k)).id,next.id);
 await f.engine.dispatch(a.id);assert.equal(f.sends,0);
 await f.engine.dispatch(next.id);await f.engine.dispatch(b.id);assert.equal(f.sends,2);
 await assert.rejects(f.engine.reviseTask({taskId:next.id,expectedPackageRevision:2,package:p},key()),/cancellation or completion/);
 const state=f.states.get(f.node.key);state.messages.push({id:'answer-v2',role:'agent',text:'Evidence v2'});await f.engine.reconcile(next.id);
 const v3=await f.engine.reviseTask({taskId:next.id,expectedPackageRevision:2,package:{...p,goal:'Check evidence'}},key());
 assert.equal(v3.packageRevision,3);assert.ok(f.engine.task(next.id).observed.messageRefs.includes('answer-v2'));
 assert.equal(JSON.stringify(f.engine.task(b.id).package),JSON.stringify(p));
});
test('lost receipt reconciles from exact native evidence and never blindly retries',async t=>{
 const f=fixture(t),a=await f.assignment();f.uncertain=true;assert.equal((await f.engine.dispatch(a.id)).state,'delivery_unknown');f.restart();await f.engine.dispatch(a.id);assert.equal(f.sends,1);assert.equal((await f.engine.reconcile(a.id)).state,'awaiting_result');
});
test('absence of delivery evidence remains unknown after restart',async t=>{
 const f=fixture(t),a=await f.assignment();f.adapter.send=async()=>{throw Error('network')};await f.engine.dispatch(a.id);f.restart();assert.equal((await f.engine.reconcile(a.id)).state,'delivery_unknown');assert.equal((await f.engine.dispatch(a.id)).state,'delivery_unknown');
});
test('accepted native request with delayed history is pending observation, not failed delivery',async t=>{
 const f=fixture(t),a=await f.assignment();await f.engine.dispatch(a.id);const messages=f.states.get(f.node.key).messages;f.states.get(f.node.key).messages=[];
 assert.equal((await f.engine.reconcile(a.id)).state,'awaiting_observation');await f.engine.dispatch(a.id);assert.equal(f.sends,1);f.states.get(f.node.key).messages=messages;assert.equal((await f.engine.reconcile(a.id)).state,'awaiting_result');
});
test('one native session has one execution owner, across jobs',async t=>{
 const f=fixture(t),a=await f.assignment();await assert.rejects(f.assignment(),/execution owner/);assert.equal(a.state,'queued');
});
test('human native input pauses task and blocks new ownership',async t=>{
 const f=fixture(t),a=await f.assignment();await f.engine.dispatch(a.id);f.states.get(f.node.key).messages.push({id:'human',role:'user',text:'Stop and discuss'});assert.equal((await f.engine.reconcile(a.id)).state,'human_intervention');await assert.rejects(f.assignment(),/owner/);
});
test('worker generation change and readonly fallback prevent native writes',async t=>{
 const f=fixture(t),a=await f.assignment();f.states.get(f.node.key).generation='instance-2';await assert.rejects(f.engine.dispatch(a.id),/generation/);assert.equal(f.sends,0);f.states.get(f.node.key).generation='instance-1';f.states.get(f.node.key).readOnly=true;await assert.rejects(f.engine.dispatch(a.id),/live owner/);
});
test('busy worker does not receive queued assignment',async t=>{
 const f=fixture(t),a=await f.assignment();f.states.get(f.node.key).busy=true;await assert.rejects(f.engine.dispatch(a.id),/busy/);assert.equal(f.sends,0);assert.equal(f.engine.task(a.id).state,'queued');
});

test('offline observations persist without claiming failure or repeating native sends',async t=>{
 const f=fixture(t),a=await f.assignment();await f.engine.dispatch(a.id);
 const inspect=f.adapter.inspect;await f.engine.reconcile(a.id);const state=f.engine.task(a.id).state;
 f.adapter.inspect=async()=>{throw Object.assign(Error('private transport details must not be recorded'),{status:503});};
 await f.engine.reconcile(a.id);await f.engine.reconcile(a.id);f.restart();
 const saved=f.engine.task(a.id);assert.equal(saved.state,state);assert.equal(saved.observation.status,'unavailable');assert.ok(saved.observation.lastSuccessAt);
 assert.equal(f.engine.events({jobId:a.job}).filter(e=>e.kind==='observation_unavailable').length,1);
 assert.equal(f.engine.briefing({jobId:a.job}).branches[0].needsAttention,true);
 assert.ok(!JSON.stringify(saved).includes('private transport details'));
 await f.engine.dispatch(a.id);assert.equal(f.sends,1);
 f.adapter.inspect=inspect;await f.engine.reconcile(a.id);assert.equal(f.engine.task(a.id).observation.status,'available');
 assert.equal(f.engine.events({jobId:a.job}).filter(e=>e.kind==='observation_restored').length,1);
});

test('streamed changes on the same native message create bounded sourced incremental reports',async t=>{
 const f=fixture(t),a=await f.assignment();await f.engine.dispatch(a.id);
 const native=f.states.get(f.node.key);native.busy=true;
 native.messages.push({id:'stream-1',role:'agent',type:'text',text:'Checking constraints'});await f.engine.reconcile(a.id);
 const first=f.engine.events({jobId:a.job}).filter(e=>e.kind==='native_observed').at(-1);
 native.messages.at(-1).text='Checking constraints; first result available';await f.engine.reconcile(a.id);
 const second=f.engine.events({jobId:a.job}).filter(e=>e.kind==='native_observed').at(-1);
 assert.notEqual(first.id,second.id);assert.equal(second.data.updates[0].ref,'stream-1');assert.equal(second.data.updates[0].sessionKey,a.session);
 assert.ok(second.data.updates[0].excerpt.includes('first result'));
 f.restart();await f.engine.reconcile(a.id);assert.equal(f.engine.events({jobId:a.job}).filter(e=>e.kind==='native_observed').at(-1).id,second.id);
 for(let i=0;i<6;i++)native.messages.push({id:'bounded-'+i,role:'agent',text:'x'.repeat(4000)+'Bearer example-sensitive-token-123'});
 await f.engine.reconcile(a.id);
 const last=f.engine.events({jobId:a.job}).filter(e=>e.kind==='native_observed').at(-1);
 assert.equal(last.data.updates.length,4);assert.equal(last.data.omittedUpdates,2);
 assert.ok(last.data.updates.every(u=>u.excerpt.length<=1200&&u.truncated));
 assert.ok(!JSON.stringify(last).includes('example-sensitive-token-123'));assert.equal(f.sends,1);
});

test('polling is fair across quiet workers and does not flood events',async t=>{
 const f=fixture(t);let clock=1000;f.engine.clock=()=>++clock;
 const nodes=Array.from({length:10},(_,i)=>({...f.node,key:'local~desktop:fair-'+i,session:'desktop:fair-'+i}));
 for(const n of nodes)f.states.set(n.key,{generation:n.generation,busy:false,messages:[],interactions:[]});
 f.adapter.catalog=async()=>({sessions:nodes});
 const j=await f.engine.createJob({name:'fair polling',scope:nodes.map(n=>n.key)},key());
 f.engine.setExecution({jobId:j.id,expectedRevision:0,sessions:j.scope,workspaces:[]},key(),'human');
 for(const n of nodes){const a=await f.engine.assign({jobId:j.id,sessionKey:n.key,package:{schemaVersion:1,contextRevision:1,goal:'Read',acceptance:'Evidence',constraints:[],sources:[]}},key());await f.engine.dispatch(a.id);f.states.get(n.key).busy=true;}
 await f.engine.tick();await f.engine.tick();
 assert.ok(f.engine.snapshot(j.id).tasks.every(t=>t.observation?.lastSuccessAt));
 const events=f.engine.events({jobId:j.id}).length;
 await f.engine.tick();assert.equal(f.engine.events({jobId:j.id}).length,events);
});
test('round completion never means accepted success; acceptance needs evidence',async t=>{
 const f=fixture(t),a=await f.assignment();await f.engine.dispatch(a.id);assert.equal((await f.engine.reconcile(a.id)).state,'awaiting_result');f.states.get(f.node.key).messages.push({id:'result',role:'agent',text:'Observed 0 files.'});assert.equal((await f.engine.reconcile(a.id)).state,'completion_claim');await assert.rejects(f.engine.accept({taskId:a.id,evidence:[],verdict:'done'},key()),/evidence/);await assert.rejects(f.engine.accept({taskId:a.id,evidence:[{ref:'fake',verified:true}],verdict:'done'},key()),/evidence/);const done=await f.engine.accept({taskId:a.id,evidence:[{ref:'result',verified:true}],verdict:'Checked return value'},key());assert.equal(done.state,'succeeded');await f.assignment();
});

test('acceptance rechecks original state and rejects own prompts, offline claims and human changes',async t=>{
 const f=fixture(t),a=await f.assignment();await f.engine.dispatch(a.id);
 const messages=f.states.get(f.node.key).messages;messages.push({id:'worker-evidence',role:'agent',text:'Observed evidence'});
 await f.engine.reconcile(a.id);
 await assert.rejects(f.engine.accept({taskId:a.id,evidence:[{ref:messages[0].id,verified:true}],verdict:'own prompt'},key()),/evidence/);
 const args={taskId:a.id,evidence:[{ref:'worker-evidence',verified:true}],verdict:'checked'};
 const inspect=f.adapter.inspect;f.adapter.inspect=async()=>{throw Object.assign(Error('offline'),{status:503});};
 await assert.rejects(f.engine.accept(args,key()),/unavailable/);assert.equal(f.engine.task(a.id).state,'completion_claim');
 f.adapter.inspect=inspect;messages.push({id:'human-correction',role:'user',text:'Wait, change the goal'});
 await assert.rejects(f.engine.accept(args,key()),/completion claim/);assert.equal(f.engine.task(a.id).state,'human_intervention');
});
test('same key different package conflicts, same request has same result',async t=>{
 const f=fixture(t),k=key(),args={name:'x',scope:[f.node.key]};const a=await f.engine.createJob(args,k);assert.equal((await f.engine.createJob(args,k)).id,a.id);await assert.rejects(f.engine.createJob({...args,name:'y'},k),/different payload/);
});
test('approval revision and exact task prevent stale/foreign response',async t=>{
 const f=fixture(t),a=await f.assignment();await f.engine.dispatch(a.id);const i={id:'approval-1',kind:'approval',operation:'read test directory'};f.states.get(f.node.key).interactions=[i];await f.engine.reconcile(a.id);
 await assert.rejects(f.engine.answer({taskId:a.id,interactionId:i.id,revision:'old',response:{decision:'accept'}},key()),/expired/);
 await f.engine.answer({taskId:a.id,interactionId:i.id,revision:interactionRevision(i),response:{decision:'decline'}},key(),'human');assert.equal(f.answers,1);
});

test('one native interaction is never submitted twice under a different request key',async t=>{
 const f=fixture(t),a=await f.assignment();await f.engine.dispatch(a.id);
 const i={id:'native-approval-once',kind:'approval'};f.states.get(f.node.key).interactions=[i];
 const args={taskId:a.id,interactionId:i.id,revision:interactionRevision(i),response:{decision:'accept'}},k=key();
 const first=await f.engine.answer(args,k,'human');assert.equal(first.lastInteraction.state,'acknowledged');
 assert.equal(f.engine.db.prepare('SELECT state FROM router_outbox WHERE id=?').get(k).state,'acknowledged');
 await assert.rejects(f.engine.answer(args,key(),'human'),/already submitted/);
 await assert.rejects(f.engine.answer({...args,response:{decision:'decline'}},key(),'human'),/already submitted/);
 f.restart();f.states.get(f.node.key).interactions=[];
 f.adapter.inspect=async()=>{throw Error('now disconnected');};
 const replay=await f.engine.answer(args,k,'human');assert.equal(replay.lastInteraction.state,'acknowledged');assert.equal(f.answers,1);
 await assert.rejects(f.engine.answer(args,k,'coordinator'),/authenticated user/);
 await assert.rejects(f.engine.answer({...args,response:{decision:'decline'}},k,'human'),/different payload/);
});

test('uncertain interaction receipt survives restart and cannot be retried with a new key',async t=>{
 const f=fixture(t),a=await f.assignment();await f.engine.dispatch(a.id);
 const i={id:'native-question-unknown',kind:'question',questions:[{id:'q'}]};f.states.get(f.node.key).interactions=[i];
 let submissions=0;f.adapter.answer=async()=>{submissions++;throw Error('receipt lost');};
 const args={taskId:a.id,interactionId:i.id,revision:interactionRevision(i),response:{decision:'answer',answers:{q:{answers:['only once']}}}},k=key();
 const first=await f.engine.answer(args,k,'human');assert.equal(first.state,'delivery_unknown');assert.equal(first.lastInteraction.state,'unknown');
 f.restart();const same=await f.engine.answer(args,k,'human');assert.equal(same.lastInteraction.state,'unknown');
 await assert.rejects(f.engine.answer(args,key(),'human'),/already submitted/);
 assert.equal(submissions,1);assert.equal(f.engine.db.prepare('SELECT state FROM router_outbox WHERE id=?').get(k).state,'unknown');
});
test('cancel is acknowledged only for original expected turn, never replayed',async t=>{
 const f=fixture(t),a=await f.assignment();await f.engine.dispatch(a.id);const k=key();assert.equal((await f.engine.cancel(a.id,k)).state,'cancelled');assert.equal(f.cancels,1);
});
test('two tools keep task ownership, report cursor and native evidence isolated',async t=>{
 const f=fixture(t),a=await f.assignment(),b=await f.assignment(f.other.key);await Promise.all([f.engine.dispatch(a.id),f.engine.dispatch(b.id)]);assert.equal(f.sends,2);assert.equal(f.states.get(f.node.key).messages.length,1);assert.equal(f.states.get(f.other.key).messages.length,1);const events=f.engine.events({jobId:a.job});assert.ok(events.every(e=>e.job===a.job));assert.equal(f.engine.events({jobId:a.job,after:events.at(-1).id}).length,0);
});
test('single database owner rejects duplicate gateway attachment',t=>{
 const f=fixture(t);assert.throws(()=>new NativeRouter({file:f.file,router:{device:'local',session:'desktop:router'},adapter:f.adapter}),/owner/);
});
test('job pause persists and blocks dispatch after coordinator restart',async t=>{
 const f=fixture(t),a=await f.assignment();f.engine.pause(a.job,key());f.restart();await assert.rejects(f.engine.dispatch(a.id),/paused/);assert.equal(f.sends,0);
});
test('Router wake survives lost receipt and advances cursor only after native evidence',async t=>{
 const f=fixture(t);await f.assignment();f.uncertain=true;assert.equal((await f.engine.wake()).state,'delivery_unknown');f.restart();assert.equal((await f.engine.wake()).state,'acknowledged');assert.equal((await f.engine.wake()).state,'idle');assert.equal(f.sends,1);
});

test('wake uses references instead of replaying progress excerpts into the Router prompt',async t=>{
 const f=fixture(t),a=await f.assignment();
 for(let i=0;i<90;i++)f.engine.event(a,'native_observed',{state:'running',refs:['ref-'+i],updates:[{excerpt:'PRIVATE-LONG-PROGRESS-'.repeat(500)}]});
 await f.engine.wake();
 const prompt=f.states.get('local~desktop:router').messages[0].text;
 assert.ok(prompt.length<25000);assert.ok(!prompt.includes('PRIVATE-LONG-PROGRESS'));
 assert.ok(prompt.includes('ack_briefing'));assert.equal(f.sends,1);
});
test('native creation requires selected workspace, verifies cwd, and is persistent idempotent',async t=>{
 const f=fixture(t),workspace={key:'local~p',device:'local',projectId:'p',toolId:'codex',path:'D:/Software/Test'};
 f.adapter.catalog=async()=>({sessions:[f.node],workspaces:[workspace]});let created=0;
 f.adapter.create=async()=>{created++;return f.other;};f.states.get(f.other.key).cwd=workspace.path;
 const j=await f.engine.createJob({name:'create test',scope:[],workspaceScope:[workspace.key]},key());
 await assert.rejects(f.engine.createSession({jobId:j.id,workspaceKey:'unselected',instruction:'fixture'},key()),/not selected/);
 f.engine.setExecution({jobId:j.id,expectedRevision:0,sessions:[],workspaces:[workspace.key]},key(),'human');
 const k=key(),args={jobId:j.id,workspaceKey:workspace.key,instruction:'Only return the current directory'};
 assert.equal((await f.engine.createSession(args,k)).state,'created');f.restart();assert.equal((await f.engine.createSession(args,k)).state,'created');assert.equal(created,1);
});
test('cancel queued assignment never cancels an unrelated native turn',async t=>{
 const f=fixture(t),a=await f.assignment();assert.equal((await f.engine.cancel(a.id,key())).state,'cancelled');assert.equal(f.cancels,0);await f.assignment();
});

test('project briefing stays isolated, bounded and survives restart without dispatch',async t=>{
 const f=fixture(t),a=await f.assignment(),b=await f.assignment(f.other.key);
 const page=f.engine.briefing({jobId:a.job,limit:1});
 assert.equal(page.events.length,1);assert.equal(page.hasMore,true);assert.ok(page.branches.every(x=>x.taskId===a.id));assert.ok(page.events.every(x=>x.job===a.job));
 assert.equal(f.engine.briefing({jobId:b.job}).acknowledged,0);
 // Merely reading never marks reports consumed.
 assert.equal(f.engine.briefing({jobId:a.job,limit:1}).acknowledged,0);
 const folders=fs.readdirSync(path.join(path.dirname(f.file),'handoffs'));
 assert.equal(folders.length,2);
 const projections=folders.map(x=>JSON.parse(fs.readFileSync(path.join(path.dirname(f.file),'handoffs',x,'briefing.json'),'utf8')));
 assert.ok(projections.some(p=>p.job.id===a.job&&p.branches.every(t=>t.taskId===a.id)));
 const current=f.engine.briefing({jobId:a.job,limit:1});
 f.engine.acknowledgeBriefing({jobId:a.job,through:current.through,digest:current.digest},key());
 f.restart();const next=f.engine.briefing({jobId:a.job});assert.equal(next.after,current.through);assert.ok(next.events.every(e=>e.id>current.through));assert.equal(f.sends,0);
 assert.throws(()=>f.engine.acknowledgeBriefing({jobId:a.job,through:999,digest:'invented'},key()),/receipt/);
 assert.throws(()=>f.engine.briefing({jobId:'missing'}),/not found/);
});

test('briefing readers do not invalidate each other or skip unread pages',async t=>{
 const f=fixture(t),a=await f.assignment();
 const first=f.engine.briefing({jobId:a.job,limit:1});
 const second=f.engine.briefing({jobId:a.job,after:first.through,limit:1});
 assert.throws(()=>f.engine.acknowledgeBriefing({jobId:a.job,through:second.through,digest:second.digest},key()),/earlier events/);
 await assert.rejects(f.engine.request('ack_briefing',{jobId:a.job,through:first.through,digest:first.digest},key(),{authority:'human'}),/Only the Router/);
 f.engine.acknowledgeBriefing({jobId:a.job,through:first.through,digest:first.digest},key());
 f.restart();f.engine.acknowledgeBriefing({jobId:a.job,through:second.through,digest:second.digest},key());
 assert.equal(f.engine.briefing({jobId:a.job}).acknowledged,second.through);
});

test('project router identity persists independently and cannot also be its Worker',async t=>{
 const f=fixture(t);
 const j=await f.engine.createJob({name:'Other entry',routerKey:f.other.key,scope:[f.node.key]},key());
 assert.equal(j.router.session,f.other.session);f.restart();
 assert.equal(f.engine.job(j.id).router.session,f.other.session);
 await assert.rejects(f.engine.createJob({name:'bad',routerKey:f.other.key,scope:[f.other.key]},key()),/not eligible/);
 f.other.capabilities.send='unsupported';
 await assert.rejects(f.engine.createJob({name:'bad',routerKey:f.other.key,scope:[f.node.key]},key()),/Router must/);
 assert.equal((await f.engine.wake()).state,'idle');assert.equal(f.sends,0);
});
test('new-window budget includes unknown delivery after restart and user can revoke',async t=>{
 const f=fixture(t),w={key:'local~p',device:'local',toolId:'codex',path:'D:/Test'};
 f.adapter.catalog=async()=>({sessions:[f.node],workspaces:[w]});let count=0;
 f.adapter.create=async()=>{count++;throw Error('receipt lost');};
 const j=await f.engine.createJob({name:'bounded',scope:[],workspaceScope:[w.key]},key());
 f.engine.setExecution({jobId:j.id,expectedRevision:0,sessions:[],workspaces:[w.key],maxNewWindows:1},key(),'human');
 const args={jobId:j.id,workspaceKey:w.key,instruction:'fixture'},id=key();
 assert.equal((await f.engine.createSession(args,id)).state,'delivery_unknown');f.restart();
 assert.equal((await f.engine.createSession(args,id)).state,'delivery_unknown');
 await assert.rejects(f.engine.createSession(args,key()),/budget exhausted/);assert.equal(count,1);
 f.engine.setExecution({jobId:j.id,expectedRevision:1,sessions:[],workspaces:[],maxNewWindows:3},key(),'human');
 await assert.rejects(f.engine.createSession(args,key()),/authorization required/);assert.equal(count,1);
});
test('server selection is exact and does not require a native Worker',async t=>{
 const f=fixture(t);f.engine.resources={list:()=>[{id:'gpu-a'},{id:'gpu-b'}],read:async id=>({id})};
 const j=await f.engine.createJob({name:'server only',scope:[],resourceScope:['gpu-a']},key());
 assert.deepEqual((await f.engine.request('snapshot')).jobs[0].resources,[{id:'gpu-a'}]);
 assert.deepEqual(await f.engine.request('read_resource',{jobId:j.id,resourceId:'gpu-a'}),{id:'gpu-a'});
 await assert.rejects(f.engine.request('read_resource',{jobId:j.id,resourceId:'gpu-b'}),/not selected/);
});

test('project snapshot uses timestamped display cache while live catalog is slow',async t=>{
 const f=fixture(t);await f.engine.createJob({name:'fast display',scope:[f.node.key]},key());f.restart();
 let release;f.adapter.catalog=()=>new Promise(r=>{release=r;});
 f.engine.clock=()=>Date.now()+10000;
 const snapshot=await f.engine.request('snapshot');
 assert.equal(snapshot.jobs[0].nodes[0].key,f.node.key);assert.equal(snapshot.catalogRefreshing,true);
 assert.ok(snapshot.catalogUpdatedAt < f.engine.clock());
 release({sessions:[f.node],workspaces:[]});await f.engine.catalogPending;
});
