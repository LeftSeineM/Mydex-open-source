import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPatch,NativeFollower} from '../native.mjs';
import {Adapter,subagentMessage} from '../adapter.mjs';
import {TaskTransport} from '../transport.mjs';
import {Controls} from '../controls.mjs';

test('creating a side chat uses an attached native fork without permissions overrides or automatic prompts',async()=>{
 const c=Object.create(Controls.prototype),calls=[];
 c.rpc=async(method,args)=>{calls.push({method,args});return method==='thread/fork'?{thread:{id:'child'}}:{data:[]};};
 const r=await c.sideChat('desktop:parent');assert.equal(r.id,'child');const fork=calls.find(c=>c.method==='thread/fork');assert.equal(fork.args.threadId,'parent');assert.equal(fork.args.attachToSource,true);assert.equal(fork.args.approvalPolicy,undefined);assert.equal(calls.some(c=>c.method==='turn/start'),false);
});

test('message-embedded async questions appear and their native answer retires them',async()=>{
 const a=Object.create(Adapter.prototype);a.summaries=new Map();a.registerImages=()=>{};
 const question={id:'call-q',type:'agentMessage',text:'请选择',questions:[{title:'选哪一个？',options:['一','二']}]};
 const state={id:'parent',turns:[{turnId:'turn',status:'inProgress',items:[question]}]};
 const pending=a.fromNative(state).approvals[0];assert.equal(pending.questions[0].options[0].label,'一');assert.equal(pending.blocking,false);
 let sent;a.native={states:new Map([['parent',{value:state}]]),send:async(id,text)=>{sent={id,text};return {accepted:true};}};
 const qid=pending.questions[0].id;await a.approve('desktop:parent',{approvalId:pending.id,answers:{[qid]:{answers:['二']}}});assert.equal(sent.id,'parent');assert.match(sent.text,/send_user_message_question_reply/);
 state.turns[0].items.push({id:'reply',type:'userMessage',text:sent.text});assert.equal(a.fromNative(state).approvals.length,0);
});

test('side chat listing rejects unverified global rows and only returns this exact parent',async()=>{
 const c=Object.create(Controls.prototype);c.pending={};const calls=[];
 c.adapter={detail:async()=>({}),native:{states:new Map()},savedSideChats:parent=>({supported:true,hasMore:false,data:[{id:'side-id',parentId:parent,title:'侧聊'},{id:'wrong',parentId:'another'}]}),liveSideChats:{list:async()=>[{id:'wrong-live',parentId:'another'},{id:'unverified'},{id:'valid-live',parentId:'parent-id'}]}};
 c.rpc=async(method,args)=>{calls.push({method,args});if(method==='thread/list')return {data:[{id:'unrelated'}]};throw Error('not available');};
 const state=await c.read('desktop:parent-id');assert.equal(state.capabilities.sideChats,true);assert.deepEqual(state.sideChats.map(t=>t.id),['side-id','valid-live']);assert.equal(state.sideChatsParentId,'parent-id');assert.equal(calls.some(x=>x.method==='thread/list'),false);
});

test('subagent activity retains identity, state and prompt in native snapshots',()=>{
 const a=Object.create(Adapter.prototype);a.summaries=new Map();a.registerImages=()=>{};
 const item={id:'agent-call',type:'collabAgentToolCall',tool:'spawnAgent',status:'inProgress',prompt:'检查问题',senderThreadId:'main',receiverThreadIds:['child'],agentsStates:{child:{status:'running',message:'正在检查'}}};
 const t=a.fromNative({id:'main',turns:[{turnId:'t',status:'inProgress',items:[item]}]});
 assert.equal(t.messages[0].type,'subagent');assert.equal(t.messages[0].agents[0].status,'running');assert.equal(t.messages[0].prompt,'检查问题');
 assert.equal(subagentMessage({id:'a',type:'subAgentActivity',agentThreadId:'child',agentPath:'/root/review',kind:'started'}).agents[0].name,'/root/review');
 const page=new TaskTransport(()=>{},'test').page(t,'task');assert.equal(page.messages[0].agents[0].message,'正在检查');assert.equal(page.messages[0].prompt,'检查问题');
});

test('older indexed threads map to the most specific project without overriding explicit membership',()=>{
  const a=Object.create(Adapter.prototype);a.projectCache=[{id:'parent',path:'D:/Work'},{id:'child',path:'D:/Work/App'}];
  assert.equal(a.desktopTask({id:'x',cwd:'d:\\work\\app\\src'}).projectId,'child');
  assert.equal(a.desktopTask({id:'x',cwd:'D:/Work/App',projectId:null}).projectId,null);
});

test('mobile instructions remain visible in original desktop history',()=>{
  const a=Object.create(Adapter.prototype);a.summaries=new Map();a.registerImages=()=>{};
  const t=a.fromNative({id:'x',turns:[{turnId:'t',items:[{id:'u',type:'functionCallOutput',namespace:'codex_app',name:'send_message_to_thread',output:'<codex_delegation><input>继续检查</input></codex_delegation>'}]}]});
  assert.equal(t.messages[0].role,'user');assert.equal(t.messages[0].text,'继续检查');
});

test('incremental patches update partial text without losing adjacent messages',()=>{
  const data={turns:[{items:[{text:'hello'},{text:'next'}]}]};
  applyPatch(data,{op:'replace',path:['turns',0,'items',0,'text'],value:'hello world'});
  assert.equal(data.turns[0].items[0].text,'hello world');assert.equal(data.turns[0].items[1].text,'next');
  assert.throws(()=>applyPatch(data,{op:'add',path:['__proto__','bad'],value:true}));
});

test('an incompatible desktop operation reports a protocol mismatch without retrying a write',async()=>{
 const n=new NativeFollower();let calls=0;
 n.watch=async()=>{};n.request=async()=>{calls++;return {resultType:'error',error:'request-version-mismatch'};};
 await assert.rejects(n.control('thread','thread-follower-interrupt-turn',{},4),/协议版本不兼容/);
 assert.equal(calls,1);
});

test('rendering history does not reorder the native array addressed by subsequent stream patches',()=>{
 const a=Object.create(Adapter.prototype);a.summaries=new Map();a.registerImages=()=>{};
 const state={id:'one',turns:[{turnId:'latest',turnStartedAtMs:2,items:[]},{turnId:'older',turnStartedAtMs:1,items:[]}]};
 a.fromNative(state);
 assert.deepEqual(state.turns.map(t=>t.turnId),['latest','older']);
 applyPatch(state,{op:'replace',path:['turns',0,'status'],value:'inProgress'});
 assert.equal(state.turns[0].turnId,'latest');
});
test('native snapshots normalize real user messages and approvals',()=>{
  const a=Object.create(Adapter.prototype);a.summaries=new Map();a.registerImages=()=>{};
  const t=a.fromNative({id:'one',title:'Test',turns:[{turnId:'turn',status:'inProgress',items:[
    {id:'u',type:'userMessage',content:[{type:'text',text:'Please inspect'}]},
    {id:'a',type:'agentMessage',text:'Inspecting…'}
  ]}],requests:[{id:12,method:'item/commandExecution/requestApproval',params:{threadId:'one',command:'echo hello'}}]});
  assert.equal(t.status,'AwaitingApproval');assert.equal(t.messages[0].role,'user');assert.equal(t.approvals[0].rpcId,12);
});
test('native approval rejects stale / different-task IDs before dispatch',async()=>{
  const a=Object.create(Adapter.prototype);a.native={states:new Map([['one',{value:{}}]]),approve:()=>{throw new Error('must not dispatch');}};a.fromNative=()=>({approvals:[]});
  await assert.rejects(a.approve('desktop:one',{approvalId:'wrong',decision:'accept'}),/失效/);
});
