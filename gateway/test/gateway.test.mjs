import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {WebSocket} from 'ws';
import {createGateway,authorized} from '../server.mjs';
import {taskStatus} from '../adapter.mjs';
const token='test-only-32-character-credential';
class Fake extends EventEmitter{count=0;async dispatch(method,args){if(method==='list')return {tasks:[{id:'one',title:'Test',status:'Running'}],desktopOnline:true};if(method==='detail')return {id:args.id,messages:[]};if(method==='create'){this.count++;return{id:'new',title:args.instruction};}return[];}}
test('auth fails closed and status maps active',()=>{assert(!authorized('',token));assert(!authorized('Bearer '+token,'short'));assert(authorized('Bearer '+token,token));assert.equal(taskStatus('active'),'Running');});
test('HTTP/WS auth, task isolation and deduplication',async t=>{
  const fake=new Fake();const g=createGateway({local:{id:'mini'},token,devices:[{id:'mini',name:'Mini'},{id:'laptop',name:'Laptop',token:'other-device-secret-32-characters'}]},fake);
  await new Promise(r=>g.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>g.server.close(r)));
  const base='http://127.0.0.1:'+g.server.address().port;const headers={Authorization:'Bearer '+token};
  assert.equal((await fetch(base+'/api/tasks')).status,401);
  const listing=await(await fetch(base+'/api/tasks',{headers})).json();assert.equal(listing.tasks[0].id,'mini~one');
  assert.equal((await fetch(base+'/api/tasks/laptop~one',{headers})).status,503);
  const send=()=>fetch(base+'/api/tasks',{method:'POST',headers:{...headers,'Content-Type':'application/json','Idempotency-Key':'same-request-key-123456'},body:JSON.stringify({deviceId:'mini',instruction:'hello'})});
  assert.equal((await send()).status,200);assert.equal((await send()).status,200);assert.equal(fake.count,1);
  const altered=await fetch(base+'/api/tasks',{method:'POST',headers:{...headers,'Idempotency-Key':'same-request-key-123456'},body:JSON.stringify({deviceId:'mini',instruction:'different'})});assert.equal(altered.status,409);
  const socket=new WebSocket(base.replace('http','ws')+'/ws',{headers});
  const first=await new Promise((resolve,reject)=>{socket.once('message',d=>resolve(JSON.parse(d)));socket.once('error',reject);});assert.equal(first.type,'devices');socket.close();
  await new Promise((resolve,reject)=>{const ws=new WebSocket(base.replace('http','ws')+'/ws');ws.on('unexpected-response',(req,res)=>{assert.equal(res.statusCode,401);ws.terminate();resolve();});ws.on('error',()=>{});setTimeout(()=>reject(Error('Expected auth rejection')),1500).unref();});
});
