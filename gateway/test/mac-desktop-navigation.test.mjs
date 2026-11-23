import test from 'node:test';
import assert from 'node:assert/strict';
import {MacDesktopNavigation,threadLink,newThreadLink} from '../mac-desktop-navigation.mjs';
const id='11111111-2222-3333-4444-555555555555';
const other='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
test('navigation uses a validated thread ID and encoded Codex composer link',()=>{
 assert.equal(threadLink(id),'codex://threads/'+id);
 assert.throws(()=>threadLink('../new?prompt=wrong'));
 const url=new URL(newThreadLink('hello & 中文\nnext','/Users/test/My Project'));
 assert.equal(url.searchParams.get('prompt'),'hello & 中文\nnext');assert.equal(url.searchParams.get('mode'),'codex');assert.equal(url.searchParams.get('path'),'/Users/test/My Project');
 assert.throws(()=>newThreadLink('hi','relative'));assert.throws(()=>newThreadLink('x'.repeat(12001)));
});
test('cold original thread is opened once, followed by exact-ID owner confirmation',async()=>{
 let attempts=0,opens=0;const ids=[];
 const n=new MacDesktopNavigation({snapshot:async raw=>{ids.push(raw);if(++attempts===1)throw Error('no owner');return {id:raw};}},null,{open:async url=>{opens++;assert.equal(url,threadLink(id));},sleep:async()=>{}});
 const result=await Promise.all([n.ensure(id),n.ensure(id)]);assert.equal(opens,1);assert.equal(result[0].id,id);assert.deepEqual(ids,[id,id]);
});
test('failure to confirm owner never proceeds as another thread',async()=>{
 let time=0;const n=new MacDesktopNavigation({snapshot:async()=>{throw Error('no owner');}},null,{open:async()=>{},sleep:async()=>{time+=11000;},now:()=>time});
 await assert.rejects(n.ensure(id),/无法自动载入/);
});
test('new conversation is created only by desktop UI and correlated by exact first input',async()=>{
 const calls=[];let lists=0,pressed=0;
 const codex={start:async()=>{},request:async(method,args)=>{calls.push(method);if(method==='thread/list')return {data:++lists===1?[{id:other}]:[{id:other},{id,cwd:'/project'}]};if(method==='thread/read')return {thread:{turns:[{items:[{type:'userMessage',content:[{type:'text',text:'hello'}]}]}]}};throw Error('Unexpected CLI method '+method);}};
 const n=new MacDesktopNavigation({snapshot:async raw=>({id:raw})},codex,{app:'/Applications/ChatGPT.app',ui:async req=>{pressed++;assert.equal(req.action,'create');return {pressed:true};},sleep:async()=>{}});
 assert.equal((await n.create('hello','/project')).id,id);assert.equal(pressed,1);assert(calls.every(m=>['thread/list','thread/read'].includes(m)));
});
test('ambiguous desktop submission is not retried or replaced by CLI creation',async()=>{
 let pressed=0;const codex={start:async()=>{},request:async method=>{assert.equal(method,'thread/list');return {data:[]};}};
 const n=new MacDesktopNavigation({},codex,{ui:async()=>{pressed++;throw Error('ambiguous');}});
 await assert.rejects(n.create('hello'),/ambiguous/);assert.equal(pressed,1);assert.equal(n.busy,false);
});
test('new thread with mismatched text is never returned and submission happens once',async()=>{
 let time=0,pressed=0,lists=0;const codex={start:async()=>{},request:async method=>method==='thread/list'?{data:++lists===1?[]:[{id}]}:{thread:{turns:[{items:[{type:'userMessage',content:[{type:'text',text:'different'}]}]}]}}};
 const n=new MacDesktopNavigation({},codex,{ui:async()=>{pressed++;return {pressed:true};},sleep:async()=>{time+=13000;},now:()=>time});
 await assert.rejects(n.create('hello'),/新会话尚未确认/);assert.equal(pressed,1);
});
