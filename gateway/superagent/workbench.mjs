import crypto from 'node:crypto';
const copy=x=>JSON.parse(JSON.stringify(x));
const text=(v,max=100)=>typeof v==='string'?v.trim().slice(0,max):'';

// This is an authenticated virtual-device API. The existing gateway's controls
// and settings envelopes carry it, so no new public relay paths are required.
export class Workbench {
 constructor(coordinator){
  this.c=coordinator;const db=coordinator.db;
  db.exec('CREATE TABLE IF NOT EXISTS workbench_projects(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
  this.projects=new Map(db.prepare('SELECT data FROM workbench_projects').all().map(r=>{const p=JSON.parse(r.data);return [p.id,p];}));
 }
 persist(p){p.updatedAt=Date.now();this.c.db.prepare('INSERT OR REPLACE INTO workbench_projects(id,data) VALUES(?,?)').run(p.id,JSON.stringify(p));this.projects.set(p.id,p);return copy(p);}
 project(id){const p=this.projects.get(id);if(!p)throw Error('项目不存在，请刷新工作台');return p;}
 branch(id){const t=this.c.get(id);if(!t.workbench)throw Error('这不是工作台分支');return t;}
 present(t){
  const pending=t.approvals.filter(a=>!a.resolved),assignments=t.assignments.map(a=>({id:a.id,worker:a.worker,session:a.session,startedAt:a.startedAt,lastProgress:a.lastProgress,lastObserved:a.lastObserved,finished:a.finished,latest:a.latest||'',result:a.result||null,offline:!!a.offlineNotified,stale:!!a.staleNotified}));
  const result=assignments.filter(a=>a.result).at(-1)?.result;
  let state=t.routerActive?'coordinating':pending.length?'approval':assignments.some(a=>!a.finished)?'running':t.error?'blocked':result?(t.workbench.review==='accepted'?'accepted':t.workbench.review==='changes'?'changes':'review'):'ready';
  if(assignments.some(a=>!a.finished&&a.offline))state='offline';
  return {id:t.id,title:t.title,projectId:t.workbench.projectId,goal:t.workbench.goal,target:t.workbench.target,updatedAt:t.updatedAt,status:state,error:t.error||null,review:t.workbench.review||null,reviewNote:t.workbench.reviewNote||'',approvals:copy(pending),assignments,latest:assignments.at(-1)?.latest||t.messages.filter(m=>m.role==='agent').at(-1)?.text||'工作分支已保存',result:result||null};
 }
 snapshot(){return {schema:1,updatedAt:Date.now(),refreshSeconds:5,coordinator:{model:'gpt-6.1-sol',effort:'low'},projects:[...this.projects.values()].map(copy),branches:[...this.c.tasks.values()].filter(t=>t.workbench).map(t=>this.present(t)),legacyCount:[...this.c.tasks.values()].filter(t=>!t.workbench).length};}
 async options({worker,toolId}){
  const all=await this.c.workers.list();
  if(!worker)return {workers:all};
  const selected=all.find(w=>w.id===worker);if(!selected)throw Error('电脑未授权');
  const projects=await this.c.workers.projects(worker),sessions=await this.c.workers.sessions(worker);
  let models=[];
  if(toolId==='codex'&&this.c.workers.models)try{models=await this.c.workers.models(worker);}catch{}
  const tool=selected.tools?.find(t=>t.id===toolId);
  return {workers:all,projects:projects.filter(p=>!toolId||p.toolId===toolId),sessions:sessions.filter(s=>!toolId||s.toolId===toolId).slice(0,60),models,canCreate:!!(selected.online&&selected.desktopOnline&&toolId==='codex'&&tool?.capabilities?.create),modelSelection:toolId==='codex'&&models.length>0};
 }
 async command(a){
  if(a.operation==='options')return this.options(a);
  if(a.operation==='create_project'){
   const name=text(a.name),goal=text(a.goal,2000);if(!name)throw Error('请填写项目名称');if(this.projects.size>=100)throw Error('测试版项目数量已达上限');
   return {project:this.persist({id:crypto.randomUUID(),name,goal,createdAt:Date.now()})};
  }
  if(a.operation==='create_branch'){
   this.project(a.projectId);const title=text(a.title),goal=text(a.goal,20000);if(!title||!goal)throw Error('请填写分支名称与目标');if(this.c.tasks.size>=200)throw Error('测试版分支数量已达上限');
   const target={worker:text(a.worker,200),toolId:text(a.toolId,100),projectId:text(a.desktopProjectId,300),session:text(a.session,300),model:text(a.model,200),effort:text(a.effort,50)};
   const name=target.session?'propose_send':'propose_create';
   if(target.session&&(target.model||target.effort))throw Error('继续原会话沿用原模型；模型切换请在原会话中操作');
   const args={...target,instruction:goal};await this.c.workers.validate(name,args);
   const t={id:crypto.randomUUID(),title,messages:[],conversation:[],actions:[],assignments:[],approvals:[],routerActive:false,createdAt:Date.now(),workbench:{projectId:a.projectId,goal,target,review:null}};
   this.c.msg(t,goal,'user');t.conversation.push({role:'user',content:goal});this.c.save(t,'workbench-created');await this.c.tool(t,name,args);return {branch:this.present(t)};
  }
  if(a.operation==='branch_detail'){
   const t=this.branch(a.branchId),events=this.c.db.prepare('SELECT kind,at FROM events WHERE task=? ORDER BY id DESC LIMIT 40').all(t.id).reverse();
   return {branch:this.present(t),events,notes:t.messages.filter(m=>m.role==='agent').slice(-12)};
  }
  if(a.operation==='original'){
   const t=this.branch(a.branchId),assignment=t.assignments.find(x=>x.id===a.assignmentId);if(!assignment)throw Error('原会话关联不存在');
   const detail=await this.c.workers.detail(assignment.worker,assignment.session);
   return {worker:assignment.worker,session:assignment.session,task:{...detail,messages:(detail.messages||[]).slice(-60)}};
  }
  if(a.operation==='approve'){const t=this.branch(a.branchId);await this.c.approve({id:t.id,approvalId:a.approvalId,decision:a.decision});return {branch:this.present(t)};}
  if(a.operation==='review'){
   const t=this.branch(a.branchId);if(t.assignments.some(x=>!x.finished)||!t.assignments.some(x=>x.result))throw Error('请等执行结果返回后再验收');
   if(!['accepted','changes'].includes(a.decision))throw Error('验收选项无效');
   t.workbench.review=a.decision;t.workbench.reviewNote=text(a.note,2000);this.c.msg(t,a.decision==='accepted'?'用户已验收本轮结果。':'用户要求继续改进：'+t.workbench.reviewNote);this.c.save(t,'human-review');return {branch:this.present(t)};
  }
  if(a.operation==='continue_branch'){
   const t=this.branch(a.branchId),last=t.assignments.at(-1),instruction=text(a.instruction,20000);if(!last||!instruction)throw Error('请填写追加要求');
   if(t.approvals.some(a=>!a.resolved)||t.assignments.some(x=>!x.finished))throw Error('请先处理当前审批或等待执行完成');
   await this.c.workers.validate('propose_send',{worker:last.worker,session:last.session,instruction});t.error=null;t.workbench.review=null;this.c.msg(t,instruction,'user');t.conversation.push({role:'user',content:instruction});
   await this.c.tool(t,'propose_send',{worker:last.worker,session:last.session,instruction});return {branch:this.present(t)};
  }
  throw Error('工作台操作不存在');
 }
}
