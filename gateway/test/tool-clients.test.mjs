import test from 'node:test';
import assert from 'node:assert/strict';
import {KimiDesktop} from '../kimi-desktop.mjs';
import {DeepSeekDesktop} from '../deepseek-desktop.mjs';
import {ToolRegistry} from '../tool-registry.mjs';

test('Kimi paginates original history and preserves provider configuration on send',async()=>{
 const c=new KimiDesktop();const calls=[];
 c.request=async(route,body)=>{
  calls.push({route,body});
  if(route.endsWith('/prompts'))return {};
  if(!route.includes('/messages'))return {id:'original',metadata:{cwd:'D:/project'},agent_config:{model:'existing/model'}};
  if(route.includes('before_id'))return {items:[{id:'old',role:'user',content:[{type:'text',text:'first'}]}],has_more:false};
  return {items:[{id:'new',role:'assistant',content:[{type:'text',text:'second'}]},{id:'injected',role:'user',metadata:{origin:{kind:'injection'}},content:[{type:'text',text:'internal context'}]}],has_more:true};
 };
 const d=await c.detail('original');assert.deepEqual(d.messages.map(m=>m.id),['old','new']);
 await c.send('original','continue');const body=calls.at(-1).body;
 assert.equal(body.content[0].text,'continue');assert(!('model' in body));assert(!('permission_mode' in body));assert(body.prompt_id);
});

test('DeepSeek reads original events and excludes injected runtime context',async()=>{
 const c=new DeepSeekDesktop();c.rawSessions=async()=>[{sessionId:'same',projections:{asOfSeq:4}}];
 c.rpc=async(method)=>method==='projections'?{asOfSeq:4}:{hasMore:false,records:[
  {event:{type:'user/message',seq:1,data:{id:'u',role:'user',source:{kind:'user'},content:[{type:'text',text:'hello'}]}}},
  {event:{type:'user/message',seq:2,data:{role:'user',source:{kind:'runtime-context'},content:[{type:'text',text:'private context'}]}}},
  {event:{type:'assistant/message',seq:3,data:{message:{id:'a',role:'assistant',content:[{type:'text',text:'reply'}]}}}}
 ]};
 assert.deepEqual((await c.detail('same')).messages.map(m=>m.id),['u','a']);
});

test('same directory in different coding tools creates isolated projects',()=>{
 const r=Object.create(ToolRegistry.prototype);
 const a=r.nativeTask('kimi',{cwd:'D:/work',sessionId:'a'},'a');
 const b=r.nativeTask('zcode',{cwd:'D:/work',sessionId:'b'},'b');
 assert.notEqual(a.projectId,b.projectId);
 for(const tool of ['kimi','deepseek','gemini','zcode'])assert.equal(r.nativeRef('native:'+tool+':same').toolId,tool);
});
