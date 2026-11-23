import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {TaskTransport,summary} from '../transport.mjs';
import {createGateway} from '../server.mjs';
import {WebSocket} from 'ws';
const secret='transport-tests-only-token-long-enough';
test('large multilingual history is lossless across pages, lazy text chunks and moving tail',async()=>{
 const raw={id:'long',status:'Completed',messages:Array.from({length:180},(_,i)=>({id:'m'+i,role:'agent',type:'step',title:'script',text:'日志🙂'.repeat(16000)}))};
 assert.ok(Buffer.byteLength(JSON.stringify(raw))>24*1024*1024);
 const wire=new TaskTransport(async()=>raw,secret);
 assert.equal(summary(raw).messages,undefined);
 let page=await wire.detail('pc~long'); assert.equal(page.messages.length,60);assert.ok(Buffer.byteLength(JSON.stringify(page))<1024*1024);
 const latest=page.messages[0];const ref=new URL(latest.contentPath,'http://localhost').searchParams.get('ref');
 let offset=0,full='';do{const chunk=await wire.content('pc~long',ref,offset);full+=chunk.text;offset=chunk.nextOffset;}while(offset!==null);
 assert.equal(full,raw.messages[120].text);
 const ids=page.messages.map(m=>m.id);raw.messages.push({id:'new',type:'text',text:'new'});
 while(page.nextCursor){page=await wire.detail('pc~long',page.nextCursor);ids.unshift(...page.messages.map(m=>m.id));}
 assert.deepEqual(ids,Array.from({length:180},(_,i)=>'m'+i));
 await assert.rejects(wire.content('other~long',ref,0));
 raw.messages[120].text+='changed';await assert.rejects(wire.content('pc~long',ref,0),/正在更新/);
});
test('HTTP list, detail, mutations and websocket updates stay bounded',async t=>{
 const task={id:'long',status:'Completed',messages:[{id:'big',role:'agent',type:'text',text:'x'.repeat(25*1024*1024)}]};
 const adapter=new EventEmitter();adapter.dispatch=async(method)=>method==='list'?{tasks:[task],desktopOnline:true}:task;
 const {server,refresh}=createGateway({local:{id:'pc'},devices:[{id:'pc'}],token:secret},adapter);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 await refresh();const base='http://127.0.0.1:'+server.address().port,headers={Authorization:'Bearer '+secret};
 const list=await(await fetch(base+'/api/tasks',{headers})).json();assert.equal(list.tasks[0].messages,undefined);
 const detail=await(await fetch(base+'/api/tasks/pc~long',{headers})).json();assert.equal(detail.messages[0].text.length,8000);
 assert.equal((await fetch(base+detail.messages[0].contentPath)).status,401);
 const content=await(await fetch(base+detail.messages[0].contentPath,{headers})).json();assert.equal(content.text.length,16000);
 const sent=await(await fetch(base+'/api/tasks/pc~long/messages',{method:'POST',headers:{...headers,'Content-Type':'application/json','Idempotency-Key':'unique-transport-request-1'},body:JSON.stringify({instruction:'continue'})})).json();assert.equal(sent.messages,undefined);
 const ws=new WebSocket(base.replace('http:','ws:')+'/ws',{headers});t.after(()=>ws.terminate());
 const update=new Promise((resolve,reject)=>{ws.on('error',reject);ws.on('message',b=>{const j=JSON.parse(b);assert.ok(b.length<1024*1024);if(j.type==='task')resolve(j);});});
 await new Promise(r=>ws.once('open',r));adapter.emit('change',{task});assert.equal((await update).task.messages[0].text.length,8000);
});
