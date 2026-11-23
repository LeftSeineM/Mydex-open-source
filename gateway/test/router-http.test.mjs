import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createGateway} from '../server.mjs';
import {coordinatorToken} from '../router/access.mjs';

test('Router uses existing authenticated gateway owner and exact selected original session',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-http-'));let writes=0;
 class Fake extends EventEmitter{async dispatch(method,args){
   if(method==='prepareTool')return {ready:true,launched:false};
   if(method==='list')return {tasks:[{id:'desktop:worker',source:'desktop',toolId:'codex',status:'Completed',title:'fixture'}],desktopOnline:true};
   if(method==='tools')return [{id:'codex',capabilities:{send:true,create:true}}];
   if(method==='routerInspect')return {id:args.id,status:'Completed',messages:[]};
   if(method==='routerSend'){writes++;assert.equal(args.id,'desktop:worker');return {accepted:true,requestId:args.requestId};}
   throw Error('Unsupported fixture call');
 }}
 const token='fixture-32-character-router-authorization';
 const config={local:{id:'local'},token,devices:[{id:'local',name:'fixture'}],router:{enabled:true,file:path.join(dir,'router.sqlite'),identity:{device:'local',session:'desktop:router'}}};
 const g=createGateway(config,new Fake());await new Promise(r=>g.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>g.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const url='http://127.0.0.1:'+g.server.address().port+'/api/router',headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
 assert.equal((await fetch(url)).status,401);
 const catalog=await (await fetch(url+'?operation=catalog',{headers})).json();assert.equal(catalog.sessions[0].key,'local~desktop:worker');
 const post=async(operation,args,key='fixture-'+operation.replaceAll('_','-')+'-idempotent-123')=>{const r=await fetch(url,{method:'POST',headers:{...headers,'Idempotency-Key':key},body:JSON.stringify({operation,args})});return {status:r.status,value:await r.json()};};
 assert.equal((await fetch(url,{method:'POST',headers,body:'{}'})).status,400);
 const j=(await post('create_job',{name:'fixture job',scope:['local~desktop:worker']})).value;
 const modelHeaders={...headers,Authorization:'Bearer '+coordinatorToken(token)};
 const modelPost=async(operation,args)=>fetch(url,{method:'POST',headers:{...modelHeaders,'Idempotency-Key':'model-request-'+crypto.randomUUID()},body:JSON.stringify({operation,args,authority:'human'})});
 assert.equal((await fetch(url+'?operation=catalog',{headers:modelHeaders})).status,200);
 assert.equal((await fetch(url.replace('/api/router','/api/tasks'),{headers:modelHeaders})).status,401);
 const recovered=await post('command_receipt',{requestId:'fixture-create-job-idempotent-123'});
 assert.equal(recovered.status,200);assert.equal(recovered.value.result.id,j.id);
 assert.equal(recovered.value.retryAllowed,false);
 assert.equal((await modelPost('command_receipt',{requestId:'fixture-create-job-idempotent-123',authority:'human'})).status,403);
 assert.equal((await modelPost('confirm_instance',{taskId:'task',previousGeneration:'old',generation:'new',authority:'human'})).status,403);
 const grant={jobId:j.id,expectedRevision:0,sessions:['local~desktop:worker'],workspaces:[]};
 assert.equal((await modelPost('set_execution',{...grant,authority:'human'})).status,403);
 const assignment={jobId:j.id,sessionKey:'local~desktop:worker',package:{schemaVersion:1,contextRevision:1,goal:'Read only',acceptance:'Evidence',constraints:[],sources:[]}};
 assert.equal((await modelPost('assign',assignment)).status,403);
 assert.equal(writes,0);
 assert.equal((await post('set_execution',grant)).status,200);
 const a=(await post('assign',{jobId:j.id,sessionKey:'local~desktop:worker',package:{schemaVersion:1,contextRevision:1,goal:'Return a fixture result',acceptance:'Check result',constraints:[],sources:[{kind:'user',ref:'fixture-request'}]}})).value;
 assert.equal((await post('dispatch',{taskId:a.id})).status,200);await post('dispatch',{taskId:a.id});assert.equal(writes,1);
 assert.equal((await post('read_session',{jobId:j.id,sessionKey:'local~desktop:foreign'})).status,403);
 assert.equal((await post('exec',{command:'anything'})).status,400);
 assert.equal((await fetch(url+'?operation=dispatch',{headers})).status,400);
});
