import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Predictions} from '../predictions.mjs';
const task={id:'example',status:'Completed',messages:[{role:'user',type:'text',text:'解释项目'}, {role:'agent',type:'text',text:'可以先补充测试。'}]};
test('prediction is optional and never calls a provider for active/read-only conversations',async()=>{
 const p=new Predictions(null,()=>{throw Error('unexpected');});
 assert.equal((await p.suggest(task)).available,false);
});
test('bounded text-only request, concurrent cache, provider errors and rate limit',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-prediction-'));const file=path.join(dir,'config.json');
 fs.writeFileSync(file,JSON.stringify({baseUrl:'https://example.invalid/v1',key:'test-key',model:'test-model'}));
 try {
 let calls=0;let payload;
 const p=new Predictions(file,async(url,opts)=>{calls++;payload=JSON.parse(opts.body);assert.equal(opts.redirect,'error');assert.equal(url,'https://example.invalid/v1/chat/completions');return {ok:true,json:async()=>({choices:[{message:{content:'请补充边界测试。'}}]})};});
 assert.equal((await p.suggest({...task,status:'Running'})).available,false);
 assert.equal((await p.suggest({...task,readOnly:true})).available,false);assert.equal(calls,0);
 const answers=await Promise.all([p.suggest(task),p.suggest(task)]);assert.equal(calls,1);assert.equal(answers[0].text,'请补充边界测试。');assert.deepEqual(answers[0],answers[1]);assert.equal(payload.tools,undefined);
 await p.suggest({...task,id:'long',messages:[...Array.from({length:10},()=>({role:'user',type:'text',text:'x'.repeat(3000)})),{role:'agent',type:'step',text:'PRIVATE SCRIPT'},task.messages[1]]});assert.equal(payload.messages.length,7);assert.ok(payload.messages.slice(1).every(m=>m.content.length<=2000));assert.ok(!JSON.stringify(payload).includes('PRIVATE SCRIPT'));
 for(let i=0;i<4;i++)await p.suggest({...task,id:'other'+i});assert.equal((await p.suggest({...task,id:'limited'})).available,false);assert.equal(calls,6);
 const broken=new Predictions(file,async()=>{throw Error('test-key must not leak');});assert.ok(!JSON.stringify(await broken.suggest(task)).includes('test-key'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
