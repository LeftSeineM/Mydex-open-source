// Read-only view of Router-owned Workers (desktop/headless/workers): task tree,
// briefs, receipts and spend. Shared by the phone API and the local workbench.
// Never writes, never dispatches; the engine owns every mutation.
import fs from 'node:fs';
import path from 'node:path';

const ID=/^[tw][0-9a-z-]{1,40}$/;
const MAX_TEXT=60000;
const readJson=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const clip=text=>text.length>MAX_TEXT?text.slice(0,MAX_TEXT)+'\n\n…（内容过长，已截断，完整内容在电脑交接文件夹）':text;

export function workersDir(config={}){
  if(config.workersDir)return path.resolve(config.workersDir);
  return process.env.MYDEX_DATA_DIR?path.join(process.env.MYDEX_DATA_DIR,'workers'):null;
}

function jobs(dir){
  return fs.readdirSync(dir).filter(n=>ID.test(n)).map(n=>{try{return readJson(path.join(dir,n,'job.json'));}catch{return null;}})
    .filter(Boolean).sort((a,b)=>a.createdAt<b.createdAt?-1:1);
}
function ledger(dir,limit){
  const f=path.join(dir,'ledger.jsonl');if(!fs.existsSync(f))return [];
  return fs.readFileSync(f,'utf8').trim().split('\n').slice(-limit).map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(Boolean);
}

export function workerBoard(dir,{ledgerLimit=200}={}){
  if(!dir||!fs.existsSync(path.join(dir,'tiers.json')))return {available:false,jobs:[],ledger:[]};
  const c=readJson(path.join(dir,'tiers.json')),list=jobs(dir),strong=c.tiers?.strong?.price;
  const spent=list.reduce((s,j)=>s+(j.costCny||0),0);
  // Same tokens at strong-tier prices: a rough reference, not a measurement.
  const allStrong=strong?list.reduce((s,j)=>{const t=j.tokens||{};return s+((t.inputTokens||0)*strong.input+(t.cacheReadTokens||0)*(strong.cacheRead??strong.input)+(t.outputTokens||0)*strong.output)/1e6;},0):null;
  return {available:true,updatedAt:Date.now(),handoff:dir,tiers:c.tiers,limits:c.limits,spentCny:spent,allStrongCny:allStrong,
    jobs:list.map(({id,title,why,parent,tier,provider,model,state,createdAt,startedAt,endedAt,costCny,tokens,error,review,receiptFallback,workdir})=>
      ({id,title,why,parent,tier,provider,model,state,createdAt,startedAt,endedAt,costCny,tokens,error,review,receiptFallback,workdir})),
    ledger:ledger(dir,ledgerLimit)};
}

export function workerJob(dir,id){
  if(!dir||typeof id!=='string'||!ID.test(id))return null;
  const jobDir=path.join(dir,id);if(!fs.existsSync(path.join(jobDir,'job.json')))return null;
  const read=f=>{const p=path.join(jobDir,f);return fs.existsSync(p)?clip(fs.readFileSync(p,'utf8')):null;};
  return {id,brief:read('brief.md'),receipt:read('receipt.md'),partial:read('partial.md'),files:fs.readdirSync(jobDir).map(f=>path.join(jobDir,f))};
}
