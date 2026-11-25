import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {locateDsh,runDshJob} from './dsh-sdk.mjs';

// Router-owned background Workers. Unlike native desktop sessions, these are
// started by the Router itself, so they run without phone grants (user choice,
// 2026-11-25) but are bounded by budget, concurrency and a per-job timeout.
// Handoff is file based: brief.md in, receipt.md out, one folder per job.
const ACTIVE=new Set(['queued','running']);
const now=()=>new Date().toISOString();
const money=n=>Math.round((n||0)*10000)/10000;
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const text=(v,name,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail('Invalid '+name);return v.trim();};

const PROMPT=(job,brief,receipt)=>`你是 Mydex 的 Worker，任务编号 ${job.id}。
1. 先完整读取简报：${brief}
2. 严格按简报完成任务。你有完全访问权限，但只能在简报允许的范围内改动，不要扩大范围。
3. 遇到无法完成的情况，停下来如实说明，不要编造结果。
4. 完成后把回执写到：${receipt}
   回执必须包含这四个标题，内容写具体：
## 结论
## 证据
（改了哪些文件、跑了什么命令、关键数字，让别人能复核）
## 不确定
（没做完的、拿不准的、口径说明；没有就写“无”）
## 用时
5. 写完回执后，最后一条回复只需一句话说明回执已写好。`;

export class WorkerEngine {
 constructor({dir,defaults=new URL('./tiers.default.json',import.meta.url),runner=runDshJob,locate=locateDsh}){
  this.dir=dir;this.runner=runner;this.locate=locate;this.jobs=new Map();this.waiters=new Map();this.controllers=new Map();
  fs.mkdirSync(dir,{recursive:true});
  this.configFile=path.join(dir,'tiers.json');
  if(!fs.existsSync(this.configFile))fs.copyFileSync(defaults,this.configFile);
  this.ledgerFile=path.join(dir,'ledger.jsonl');
  for(const name of fs.readdirSync(dir)){
   const file=path.join(dir,name,'job.json');if(!fs.existsSync(file))continue;
   try{
    const job=JSON.parse(fs.readFileSync(file,'utf8'));
    // A process restart cannot reattach to a DSH runtime: never re-run silently.
    if(ACTIVE.has(job.state)){job.state='lost';job.error='后台重启时任务仍在运行，结果未知。请查看工作目录后决定是否重派。';job.endedAt=now();this.save(job);this.ledger({event:'lost',id:job.id});}
    this.jobs.set(job.id,job);
   }catch{}
  }
 }
 config(){return JSON.parse(fs.readFileSync(this.configFile,'utf8'));}
 jobDir(id){return path.join(this.dir,id);}
 save(job){const file=path.join(this.jobDir(job.id),'job.json'),temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(job,null,2));fs.renameSync(temp,file);}
 ledger(row){fs.appendFileSync(this.ledgerFile,JSON.stringify({at:now(),...row})+'\n');}
 spent(){let s=0;for(const j of this.jobs.values())s+=j.costCny||0;return s;}
 running(){let n=0;for(const j of this.jobs.values())if(ACTIVE.has(j.state))n++;return n;}
 price(job,u){
  const p=this.config().tiers[job.tier]?.price;if(!p||!u)return 0;
  return ((u.inputTokens||0)*p.input+(u.cacheReadTokens||0)*(p.cacheRead??p.input)+(u.outputTokens||0)*p.output)/1e6;
 }
 summary(j){return {id:j.id,title:j.title,parent:j.parent,tier:j.tier,model:j.provider+'/'+j.model,state:j.state,costCny:money(j.costCny),tokens:j.tokens,createdAt:j.createdAt,endedAt:j.endedAt||null,receipt:j.state==='done'?path.join(this.jobDir(j.id),'receipt.md'):null,review:j.review||null,error:j.error||null};}
 get(id){const j=typeof id==='string'&&this.jobs.get(id);if(!j)fail('Unknown worker job',404);return j;}

 tiers(){const c=this.config();return {tiers:c.tiers,limits:c.limits,handoff:this.dir,dshAvailable:!!this.locate(c.dsh)};}

 dispatch(a={}){
  const c=this.config(),title=text(a.title,'title',80),brief=text(a.brief,'brief',50000),why=text(a.why,'why',500);
  let tier=a.tier,provider=a.provider,model=a.model;
  if(tier!==undefined){const t=c.tiers[tier];if(!t)fail('Unknown tier');provider=t.provider;model=t.model;}
  else if(typeof provider==='string'&&typeof model==='string')tier=Object.entries(c.tiers).find(([,t])=>t.provider===provider&&t.model===model)?.[0]||'custom';
  else fail('A tier, or both provider and model, is required');
  if(this.spent()>=c.limits.budgetCny)fail(`预算已用完（上限 ¥${c.limits.budgetCny}），未派出。请先问用户是否追加预算。`,409);
  if(this.running()>=c.limits.maxConcurrent)fail(`已有 ${this.running()} 个任务在跑，达到并发上限，未派出。先等待其中一个结束。`,409);
  if(a.parent!==undefined&&a.parent!==null)this.get(a.parent);
  const dsh=this.locate(c.dsh);if(!dsh)fail('找不到 DeepSeek Harness 或其桌面模型配置，无法派出 Worker。',409);
  const id='w'+now().slice(2,10).replaceAll('-','')+'-'+crypto.randomBytes(3).toString('hex');
  const dir=this.jobDir(id),custom=typeof a.workdir==='string'&&a.workdir?path.resolve(a.workdir):null;
  if(custom&&!(fs.existsSync(custom)&&fs.statSync(custom).isDirectory()))fail('Worker 工作目录不存在：'+custom);
  fs.mkdirSync(dir);const workdir=custom||dir;
  fs.writeFileSync(path.join(dir,'brief.md'),`# 简报 ${id}：${title}\n\n${brief}\n`);
  const job={id,title,why,parent:a.parent||null,tier,provider,model,reasoningEffort:typeof a.reasoningEffort==='string'?a.reasoningEffort:undefined,workdir,state:'queued',createdAt:now(),costCny:0,tokens:null};
  this.jobs.set(id,job);this.save(job);this.ledger({event:'dispatched',id,title,tier,provider,model,parent:job.parent,why});
  void this.run(job,dsh,c.limits);
  return {id,tier,model:provider+'/'+model,workdir,brief:path.join(dir,'brief.md'),budgetLeftCny:money(c.limits.budgetCny-this.spent())};
 }

 async run(job,dsh,limits){
  const dir=this.jobDir(job.id),brief=path.join(dir,'brief.md'),receipt=path.join(dir,'receipt.md');
  const controller=new AbortController();this.controllers.set(job.id,controller);
  const timer=setTimeout(()=>{job.timedOut=true;controller.abort();},limits.jobTimeoutMinutes*60000);timer.unref?.();
  job.state='running';job.startedAt=now();this.save(job);this.ledger({event:'started',id:job.id});
  let result;
  try{
   result=await this.runner({dsh,permissionMode:limits.permissionMode,cwd:job.workdir,provider:job.provider,model:job.model,reasoningEffort:job.reasoningEffort,
    prompt:PROMPT(job,brief,receipt),signal:controller.signal,onProgress:u=>{job.tokens=u;job.costCny=this.price(job,u);}});
   if(controller.signal.aborted)throw Error('aborted');
   const head=`# 回执 ${job.id}：${job.title}\n\n> ${this.config().tiers[job.tier]?.label||'自定义档'}，${job.provider}/${job.model}。这是 Worker 的自述，未经 Router 抽测。\n\n`;
   if(fs.existsSync(receipt)&&fs.statSync(receipt).size>20)fs.writeFileSync(receipt,head+fs.readFileSync(receipt,'utf8').replace(/^\s*#\s*回执[^\n]*\n+/,''));
   else{job.receiptFallback=true;fs.writeFileSync(receipt,head+'> Worker 没有写回执文件，以下是它的最后一条回复。\n\n'+(result.text||'（没有任何回复，需要 Router 自己核查）')+'\n');}
   job.state='done';
  }catch(e){
   job.state=job.cancelled?'cancelled':'failed';
   job.error=job.timedOut?`超过 ${limits.jobTimeoutMinutes} 分钟未完成，已终止`:job.cancelled?'已被 Router 取消':String(e.message||e).slice(0,500);
   if(e.partial)fs.writeFileSync(path.join(dir,'partial.md'),e.partial);
   result={usage:e.usage};
  }finally{
   clearTimeout(timer);this.controllers.delete(job.id);
   if(result?.usage){job.tokens=result.usage;job.costCny=this.price(job,result.usage);}
   job.endedAt=now();delete job.timedOut;this.save(job);
   this.ledger({event:job.state,id:job.id,tier:job.tier,model:job.model,tokens:job.tokens,costCny:money(job.costCny),error:job.error});
   for(const w of this.waiters.get(job.id)||[])w();this.waiters.delete(job.id);
  }
 }

 async wait({ids,timeoutSeconds=240}={}){
  if(!Array.isArray(ids)||!ids.length||ids.length>20)fail('ids must list 1-20 jobs');
  const list=ids.map(id=>this.get(id)),limit=Math.min(Math.max(Number(timeoutSeconds)||240,1),280)*1000;
  let timer;
  await Promise.race([
   Promise.all(list.filter(j=>ACTIVE.has(j.state)).map(j=>new Promise(r=>{const w=this.waiters.get(j.id)||[];w.push(r);this.waiters.set(j.id,w);}))),
   new Promise(r=>{timer=setTimeout(r,limit);}),
  ]);
  clearTimeout(timer);
  return list.map(j=>{
   const s=this.summary(j);
   if(j.state==='done')s.receiptText=fs.readFileSync(path.join(this.jobDir(j.id),'receipt.md'),'utf8').slice(0,20000);
   else if(ACTIVE.has(j.state))s.note='仍在运行，可以继续等待或先做别的事';
   return s;
  });
 }

 cancel({id}={}){
  const j=this.get(id);if(!ACTIVE.has(j.state))return this.summary(j);
  j.cancelled=true;this.controllers.get(id)?.abort();return {id,state:'cancelling'};
 }

 accept({id,passed,check}={}){
  const j=this.get(id);if(j.state!=='done')fail('只能验收已交回回执的任务',409);
  if(typeof passed!=='boolean')fail('passed must be boolean');const note=text(check,'check',2000);
  j.review={passed,check:note,at:now()};this.save(j);
  fs.appendFileSync(path.join(this.jobDir(id),'receipt.md'),`\n---\n**Router 抽测：${passed?'通过':'未通过'}**。${note}\n`);
  this.ledger({event:passed?'accepted':'rejected',id,check:note});
  return this.summary(j);
 }

 status({id}={}){
  const c=this.config(),base={spentCny:money(this.spent()),budgetCny:c.limits.budgetCny,running:this.running(),maxConcurrent:c.limits.maxConcurrent};
  if(id!==undefined){const j=this.get(id);return {...base,job:{...this.summary(j),why:j.why,workdir:j.workdir}};}
  return {...base,jobs:[...this.jobs.values()].sort((a,b)=>a.createdAt<b.createdAt?1:-1).slice(0,50).map(j=>this.summary(j))};
 }

 async call(operation,args={}){
  if(!args||typeof args!=='object'||Array.isArray(args))fail('Invalid arguments');
  if(operation==='dispatch')return this.dispatch(args);
  if(operation==='wait')return this.wait(args);
  if(operation==='status')return this.status(args);
  if(operation==='cancel')return this.cancel(args);
  if(operation==='accept')return this.accept(args);
  if(operation==='tiers')return this.tiers();
  fail('Unsupported worker operation');
 }

 close(){for(const c of this.controllers.values())c.abort();}
}
