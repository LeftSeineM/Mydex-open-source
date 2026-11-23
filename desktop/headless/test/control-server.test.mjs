import test from 'node:test';import assert from 'node:assert/strict';import {createControlServer} from '../control-server.mjs';
test('local control requires authentication, rejects browser origins, and never exports credentials',async t=>{
 let calls=0;const token='t'.repeat(48);const server=createControlServer({token,owner:{call:async action=>{calls++;return {action,connected:true}}}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}));const url='http://127.0.0.1:'+server.address().port+'/rpc';const call=(body,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await call({action:'status'})).status,403);
 assert.equal((await call({action:'status'},{Authorization:'Bearer '+token,Origin:'https://evil.example'})).status,403);
 for(const action of ['pairing','tunnelPairing','installUpdate','exec'])assert.equal((await call({action},{Authorization:'Bearer '+token})).status,400);
 assert.equal(calls,0);const response=await call({action:'status'},{Authorization:'Bearer '+token});assert.equal(response.status,200);assert.equal((await response.json()).result.connected,true);assert.equal(calls,1);
});

test('original application patch is never installed without separate explicit consent',async t=>{
 const token='p'.repeat(48);const calls=[];
 const server=createControlServer({token,owner:{call:async action=>{calls.push(action);if(action==='findClaude')return {app:process.cwd()};throw Error('Unexpected mutation');}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}));
 const response=await fetch('http://127.0.0.1:'+server.address().port+'/rpc',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'bridgeInstall',args:{tool:'claude'}})});
 assert.equal(response.status,200);const result=(await response.json()).result;
 assert.equal(result.state,'requires-explicit-patch-consent');assert.equal(result.changed,false);assert.deepEqual(calls,['findClaude']);
});
