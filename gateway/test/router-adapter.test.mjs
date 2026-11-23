import test from 'node:test';
import assert from 'node:assert/strict';
import {GatewayRouterAdapter} from '../router/gateway-adapter.mjs';

test('interaction payload cannot override exact device, native session or request identity',async()=>{
 let captured;
 const adapter=new GatewayRouterAdapter({devices:new Map(),call:async(device,method,args)=>{captured={device,method,args};return {accepted:true};}});
 await adapter.answer({device:'allowed-computer',session:'desktop:allowed'}, {id:'approval-exact'}, {decision:'decline',id:'desktop:foreign',approvalId:'foreign',requestId:'foreign',device:'other'},'stable-key');
 assert.deepEqual(captured,{device:'allowed-computer',method:'approve',args:{id:'desktop:allowed',approvalId:'approval-exact',decision:'decline',answers:undefined,requestId:'stable-key'}});
});

test('read-only desktop records never advertise original-session control',async()=>{
 const adapter=new GatewayRouterAdapter({devices:new Map([['local',{id:'local',online:true}]]),call:async(_,method)=>{
   if(method==='list')return {tasks:[{id:'desktop:readonly',toolId:'codex',source:'desktop',readOnly:true}]};
   if(method==='tools')return [{id:'codex',capabilities:{send:true}}];
   if(method==='projects')return [];
 }});
 const node=(await adapter.catalog()).sessions[0];
 assert.equal(node.mode,'read-only');
 for(const key of ['send','cancel','approve','answer'])assert.equal(node.capabilities[key],'unsupported');
});
