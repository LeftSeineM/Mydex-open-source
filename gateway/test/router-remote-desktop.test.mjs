import test from 'node:test';import assert from 'node:assert/strict';
import {readRemoteDesktop, RemoteDesktopCatalog} from '../router/remote-desktop.mjs';
import {ResourceQueries} from '../router/resources.mjs';
import {GatewayRouterAdapter} from '../router/gateway-adapter.mjs';
test('remote identity is explicit and read-only; foreign hosts rejected',async()=>{
 const ref={hostId:'remote-host',threadId:'exact-thread'};let args;
 const desktop={call:async(method,a)=>{assert.equal(method,'read_thread');args=a;return {thread:{id:ref.threadId,hostId:ref.hostId,title:'CAP',status:{type:'active'}},turns:[{id:'turn',items:[{type:'agentMessage',id:'m',text:'progress'}]}]};}};
 const t=await readRemoteDesktop(desktop,ref);assert.equal(args.hostId,'remote-host');assert.equal(t.readOnly,true);assert.equal(t.messages[0].text,'progress');
 await assert.rejects(readRemoteDesktop({call:async()=>({thread:{id:ref.threadId,hostId:'other'}})},ref),/identity mismatch/);
 const adapter=new GatewayRouterAdapter({devices:new Map([['main',{id:'main',online:true}]]),call:async(_,m)=>m==='list'?{tasks:[t]}:m==='tools'?[{id:'codex',capabilities:{send:true}}]:[]});
 const n=(await adapter.catalog()).sessions[0];assert.equal(n.mode,'original-live');assert.equal(n.hostId,ref.hostId);assert.equal(n.capabilities.send,'unsupported');assert.equal(n.capabilities.approve,'unsupported');
});
test('resource queries never accept arbitrary resource identities',async()=>{
 const q=new ResourceQueries([{id:'gpu',name:'GPU'}]);assert.equal(q.list()[0].status,'unknown');assert.equal(q.list()[0].agentRequired,false);
 await assert.rejects(q.read('unregistered'),/not registered/);
});
test('desktop discovery preserves old bindings, pages remote history and separates equal IDs on different hosts',async()=>{
 const thread=(hostId,id)=>({hostId,id,kind:'codex',title:id});
 const catalog=new RemoteDesktopCatalog([{hostId:'host-a',threadId:'same'}]);
 const hosts=catalog.registerRows([thread('local','local-only'),thread('host-a','same'),thread('host-b','same')]);
 const queries=[];
 await catalog.expand({call:async(_,args)=>{
   queries.push([args.hostId,args.cursor]);
   if(args.hostId==='host-b')throw Error('offline');
   return args.cursor?{threads:[thread('host-a','older'),thread('foreign','wrong')]}:
     {threads:[thread('host-a','same')],nextCursor:'next'};
 }},hosts);
 assert.deepEqual(queries,[['host-a',undefined],['host-a','next'],['host-b',undefined]]);
 assert.equal(catalog.rows.size,3);
 assert.equal(catalog.rows.get('desktop:same').hostId,'host-a');
 const remote=[...catalog.rows.values()].find(t=>t.hostId==='host-b');
 assert.match(remote.id,/^desktop:remote:/);
 assert.equal(remote.readOnly,true);
 const detail=await readRemoteDesktop({call:async()=>({thread:thread('host-b','same')})},catalog.refs.get(remote.id));
 assert.equal(detail.id,remote.id);
});
