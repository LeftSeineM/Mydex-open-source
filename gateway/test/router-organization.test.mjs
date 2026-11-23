import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {NativeRouter} from '../router/engine.mjs';
import {validateOrganization,organizationView} from '../router/organization.mjs';
const key=()=>crypto.randomUUID();
const branch=(id,sessionKey,dependsOn=[])=>({id,sessionKey,dependsOn,role:id,goal:'Return a result',acceptance:'Verify the result',requiredCapabilities:['send']});
const a={key:'main~a',device:'main',session:'a',mode:'original-live',capabilities:{send:'supported'}};
const b={...a,key:'main~b',session:'b'};
const org={schemaVersion:1,branches:[branch('implement',a.key),branch('review',b.key,['implement'])]};
test('new Worker inheritance requires opt-in, verified workspace and unchanged human grant',async t=>{
 for(const scenario of ['opt-in','default','revoked','wrong-cwd']){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-inherit-'));
  const w={key:'main~workspace',device:'main',toolId:'codex',path:'D:/Software/Test'};
  let engine;
  const adapter={catalog:async()=>({sessions:[a,b],workspaces:[w]}),
    create:async()=>{if(scenario==='revoked')engine.setExecution({jobId:job.id,expectedRevision:1,sessions:[],workspaces:[]},key(),'human');return a;},
    inspect:async()=>({cwd:scenario==='wrong-cwd'?'D:/Other':w.path})};
  engine=new NativeRouter({file:path.join(root,'router.db'),router:{device:'main',session:'router'},adapter});
  try{
   const jobResult=await engine.createJob({name:'inherit',scope:[],workspaceScope:[w.key]},key());
   var job=jobResult;
   engine.setExecution({jobId:job.id,expectedRevision:0,sessions:[],workspaces:[w.key],inheritCreatedWorkers:scenario!=='default'},key(),'human');
   const result=await engine.createSession({jobId:job.id,workspaceKey:w.key,instruction:'Only return OK'},key());
   assert.equal(engine.job(job.id).execution.sessions.includes(a.key),scenario==='opt-in');
   assert.equal(result.state,scenario==='wrong-cwd'?'created_workspace_unverified':'created');
  }finally{engine.close();fs.rmSync(root,{recursive:true,force:true});}
 }
});
test('portable contract rejects cycles, unknown dependencies and scope escapes',()=>{
 const job={scope:[a.key,b.key]};
 assert.throws(()=>validateOrganization({...org,branches:[branch('a',a.key,['b']),branch('b',b.key,['a'])]},job),/cycle/);
 assert.throws(()=>validateOrganization({...org,branches:[branch('a',a.key,['missing'])]},job),/Unknown/);
 assert.throws(()=>validateOrganization(org,{scope:[a.key]}),/scope/);
});
test('completion claims do not unlock dependent workers; grants and capabilities are independent',()=>{
 const job={scope:[a.key,b.key],organization:org,execution:{sessions:[a.key,b.key]}};
 const tasks=[{id:'t',session:a.key,package:{organizationBranch:'implement'},state:'completion_claim'}];
 assert.equal(organizationView(job,tasks,{sessions:[a,b]}).branches[1].ready,false);
 tasks[0].state='succeeded';assert.equal(organizationView(job,tasks,{sessions:[a,b]}).branches[1].ready,true);
 job.execution.sessions=[];assert.ok(organizationView(job,tasks,{sessions:[a,b]}).branches[1].blockers.includes('execution_grant_required'));
 assert.ok(organizationView(job,tasks,{sessions:[a,{...b,capabilities:{}}]}).branches[1].blockers.includes('unsupported:send'));
});
test('organization persists and engine blocks premature assignment and dispatch',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-org-'));let engine;
 t.after(()=>{engine?.close();fs.rmSync(root,{recursive:true,force:true});});
 const open=()=>new NativeRouter({file:path.join(root,'router.db'),router:{device:'main',session:'router'},adapter:{catalog:async()=>({sessions:[a,b],workspaces:[]})}});
 engine=open();const j=await engine.createJob({name:'Reusable local organization',scope:[a.key,b.key]},key());
 const args={jobId:j.id,expectedRevision:0,organization:org},id=key();engine.saveOrganization(args,id);
 engine.close();engine=open();assert.equal(engine.saveOrganization(args,id).revision,1);
 assert.throws(()=>engine.saveOrganization(args,key()),/revision/);
 engine.setExecution({jobId:j.id,expectedRevision:0,sessions:[a.key,b.key],workspaces:[]},key(),'human');
 const p={schemaVersion:1,contextRevision:1,organizationBranch:'review',goal:'review',acceptance:'verified',constraints:[],sources:[]};
 await assert.rejects(engine.assign({jobId:j.id,sessionKey:b.key,package:p},key()),/Dependency not accepted/);
 const task={id:key(),job:j.id,session:b.key,node:b,package:p,state:'queued'};engine.storeTask(task);
 await assert.rejects(engine.dispatch(task.id),/Dependency not accepted/);
});
