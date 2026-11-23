import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Coordinator} from '../superagent/coordinator.mjs';import {validateOutline} from '../superagent/tracking-board.mjs';
const pause=()=>new Promise(r=>setTimeout(r,10));
async function ready(board){await pause();while(board.running||board.queue.size||[...board.projects.values()].some(p=>p.observing||p.organizing))await pause();}
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-tracking-')),file=path.join(dir,'state.sqlite');let calls=0,version=1,writes=0,reads=[];const prompts=[];
 const workers={list:async()=>[{id:'mini/mini',name:'小主机',online:true}],sessions:async()=>['a','b'].map(id=>({id:'mini~desktop:'+id,title:'会话'+id,projectId:'p',toolId:'codex',source:'desktop'})),projects:async()=>[{id:'p',name:'项目',toolId:'codex'}],detail:async(w,id)=>{reads.push(id);return {id,status:'Running',updatedAt:version,messages:[{id:'msg'+version,role:'agent',type:'text',text:'证据 '+id+' '+version}]};},execute:async()=>{writes++;throw Error('must not execute');}};
 const model={config:{model:'DeepSeek-V4.1-Flash-1017'},turn:async(messages,tools)=>{calls++;prompts.push({messages,tools});const input=JSON.parse(messages.at(-1).content);if(input.question)return {content:'仅针对选择的节点回答'};return {content:JSON.stringify({summary:'根据所选会话整理',groups:[{title:'工作分支',summary:'正在推进',sourceKeys:input.sources.map(s=>s.key)}],relations:[]})};}};
 const c=new Coordinator({dbFile:file,model,workers});t.after(async()=>{await c.close();fs.rmSync(dir,{recursive:true,force:true});});return {c,b:c.tracker,file,model,workers,prompts,getCalls:()=>calls,getWrites:()=>writes,getReads:()=>reads,setVersion:x=>version=x};
}
test('outline rejects invented keys, duplicate memberships and ungrounded relations',()=>{
 const sources=[{key:'a',messages:[{id:'m'}]},{key:'b',messages:[]}],outline=validateOutline({groups:[{title:'X',sourceKeys:['a','fake']},{title:'Y',sourceKeys:['a']}],relations:[{from:'a',to:'b',label:'依赖',evidence:[{sourceKey:'a',messageId:'fake'}]}]},sources);
 assert.deepEqual(outline.groups.map(g=>g.sourceKeys),[['a'],['b']]);assert.equal(outline.relations.length,0);
});
test('explicit import reads only selected sessions; grouping and observed events persist',async t=>{
 const x=setup(t);await x.b.catalog('mini/mini');const {project}=await x.b.command({operation:'tracking_import',name:'测试项目',sources:[{worker:'mini/mini',session:'mini~desktop:a'}]});await ready(x.b);
 assert.deepEqual(x.getReads(),['mini~desktop:a']);assert.equal(x.getWrites(),0);const p=x.b.get(project.id);assert.equal(p.outline.groups[0].sourceKeys[0],'mini/mini|mini~desktop:a');assert.equal(p.events.filter(e=>e.kind==='connected').length,1);assert.equal(x.b.snapshot().router.model,'DeepSeek-V4.1-Flash-1017');
 const other=new Coordinator({dbFile:x.file,model:x.model,workers:x.workers});assert.equal(other.tracker.get(p.id).sources.length,1);await other.close();
});
test('forged session IDs cannot bypass catalog membership',async t=>{const x=setup(t);await assert.rejects(x.b.importSources({name:'x',sources:[{worker:'mini/mini',session:'mini~desktop:fake'}]}));assert.deepEqual(x.getReads(),[]);});
test('no new evidence means no new model call or timeline event',async t=>{
 const x=setup(t),{project}=await x.b.importSources({name:'x',sources:[{worker:'mini/mini',session:'mini~desktop:a'}]});await ready(x.b);const n=x.getCalls(),events=x.b.get(project.id).events.length;await x.b.poll();await ready(x.b);assert.equal(x.getCalls(),n);assert.equal(x.b.get(project.id).events.length,events);
 x.setVersion(2);x.b.get(project.id).organizedAt=0;await x.b.poll();await ready(x.b);assert.equal(x.getCalls(),n+1);assert.equal(x.b.get(project.id).events.filter(e=>e.kind==='update').length,1);assert.equal(x.getWrites(),0);
});
test('discussion context and original evidence cannot reach an unselected conversation',async t=>{
 const x=setup(t),{project}=await x.b.importSources({name:'x',sources:[{worker:'mini/mini',session:'mini~desktop:a'},{worker:'mini/mini',session:'mini~desktop:b'}]});await ready(x.b);
 await x.b.discuss({projectId:project.id,question:'为什么卡住',sourceKeys:['mini/mini|mini~desktop:a']});const last=JSON.parse(x.prompts.at(-1).messages.at(-1).content);assert.equal(last.sources.length,1);assert.equal(last.sources[0].session,undefined);assert.deepEqual(x.prompts.at(-1).tools,[]);
 await assert.rejects(x.b.command({operation:'tracking_original',projectId:project.id,sourceKey:'other'}));
});
test('model parsing failure retains truthful source state without inventing progress',async t=>{
 const x=setup(t);x.model.turn=async()=>({content:'not json'});const {project}=await x.b.importSources({name:'x',sources:[{worker:'mini/mini',session:'mini~desktop:a'}]});await ready(x.b);const p=x.b.get(project.id);assert(p.error);assert.equal(p.sources[0].state,'Running');assert.equal(p.organizing,false);assert.equal(x.getWrites(),0);
});
test('removed conversations stop being polled and cannot be read from the project',async t=>{
 const x=setup(t),{project}=await x.b.importSources({name:'x',sources:[{worker:'mini/mini',session:'mini~desktop:a'},{worker:'mini/mini',session:'mini~desktop:b'}]});await ready(x.b);
 await x.b.importSources({projectId:project.id,sources:[{worker:'mini/mini',session:'mini~desktop:b'}]});await ready(x.b);const n=x.getReads().length;await x.b.poll();assert.deepEqual(x.getReads().slice(n),['mini~desktop:b']);await assert.rejects(x.b.command({operation:'tracking_original',projectId:project.id,sourceKey:'mini/mini|mini~desktop:a'}));
});
