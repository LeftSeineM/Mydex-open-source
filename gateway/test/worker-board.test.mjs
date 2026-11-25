import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createGateway} from '../server.mjs';
import {workerBoard,workerJob} from '../worker-board.mjs';

function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-worker-board-'));
 fs.writeFileSync(path.join(dir,'tiers.json'),JSON.stringify({tiers:{strong:{label:'强档',model:'glm-5.4',price:{input:4,output:16,cacheRead:0.8}},light:{label:'轻档',model:'glm-5.3-flash'}},limits:{budgetCny:20}}));
 const job=(id,extra)=>{fs.mkdirSync(path.join(dir,id));fs.writeFileSync(path.join(dir,id,'job.json'),JSON.stringify({id,title:id,tier:'light',state:'done',createdAt:'2026-11-25T01:00:00Z',costCny:0.01,tokens:{inputTokens:1000,outputTokens:100},brief:'secret-ish brief body',...extra}));};
 job('w261125-aaaaaa',{});job('w261125-bbbbbb',{parent:'w261125-aaaaaa',createdAt:'2026-11-25T02:00:00Z'});
 fs.writeFileSync(path.join(dir,'w261125-aaaaaa','brief.md'),'# 简报');fs.writeFileSync(path.join(dir,'w261125-aaaaaa','receipt.md'),'x'.repeat(70000));
 fs.writeFileSync(path.join(dir,'ledger.jsonl'),'{"event":"dispatched","id":"w261125-aaaaaa"}\nnot json\n');
 fs.mkdirSync(path.join(dir,'notes'));
 return dir;
}

test('board lists jobs as a tree with spend and never leaks full job records',()=>{
 const dir=fixture(),b=workerBoard(dir);
 assert.equal(b.available,true);assert.deepEqual(b.jobs.map(j=>j.id),['w261125-aaaaaa','w261125-bbbbbb']);
 assert.equal(b.jobs[1].parent,'w261125-aaaaaa');assert.equal(b.jobs[0].brief,undefined);
 assert.ok(Math.abs(b.spentCny-0.02)<1e-9);assert.ok(b.allStrongCny>0);assert.equal(b.ledger.length,1);
 assert.deepEqual(workerBoard(path.join(dir,'missing')),{available:false,jobs:[],ledger:[]});
 const j=workerJob(dir,'w261125-aaaaaa');assert.equal(j.brief,'# 简报');assert.ok(j.receipt.length<61000);assert.equal(j.partial,null);
 for(const bad of ['../x','notes','w261125-zzzzzz',null])assert.equal(workerJob(dir,bad),null);
});

test('phone worker API requires the owner token and is read-only',async t=>{
 const dir=fixture(),adapter=new EventEmitter();adapter.dispatch=async()=>({tasks:[]});
 const token='test-worker-token-at-least-24-characters';
 const {server}=createGateway({local:{id:'main'},devices:[{id:'main'}],token,workersDir:dir},adapter);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();});
 const url='http://127.0.0.1:'+server.address().port,headers={Authorization:'Bearer '+token};
 assert.equal((await fetch(url+'/api/workers')).status,401);
 const board=await (await fetch(url+'/api/workers',{headers})).json();assert.equal(board.jobs.length,2);
 assert.equal((await (await fetch(url+'/api/workers/job?id=w261125-bbbbbb',{headers})).json()).id,'w261125-bbbbbb');
 assert.equal((await fetch(url+'/api/workers/job?id=..%2Fx',{headers})).status,404);
 assert.notEqual((await fetch(url+'/api/workers',{method:'POST',headers,body:'{}'})).status,200);
 assert.deepEqual(fs.readdirSync(dir).sort(),['ledger.jsonl','notes','tiers.json','w261125-aaaaaa','w261125-bbbbbb']);
});
