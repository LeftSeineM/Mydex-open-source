import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const percentage=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=100?x:null;
export function codexUsage(value){
 const limits=value.rateLimitsByLimitId?Object.entries(value.rateLimitsByLimitId):[['codex',value.rateLimits]];
 const windows=[];
 for(const [id,limit]of limits)for(const kind of ['primary','secondary']){
  const w=limit?.[kind],used=percentage(w?.usedPercent);if(used===null)continue;
  windows.push({label:`${id} · ${w.windowDurationMins?`${w.windowDurationMins} 分钟`:kind==='primary'?'主要窗口':'次要窗口'}`,usedPercent:used,remainingPercent:100-used,resetsAt:typeof w.resetsAt==='number'?new Date(w.resetsAt*1000).toISOString():null});
 }
 const rawCredits=value.rateLimits?.credits||limits.map(([,l])=>l?.credits).find(Boolean);
 const rawBalance=rawCredits?.balance;
 const balance=typeof rawBalance==='string'&&rawBalance.length<=40&&/^-?\d+(?:\.\d+)?$/.test(rawBalance)?rawBalance:null;
 const credits=rawCredits&&(rawCredits.hasCredits===true||rawCredits.unlimited===true)?{unlimited:rawCredits.unlimited===true,balance}:null;
 const available=windows.length>0||credits!==null;
 return {available,kind:'subscription',windows,credits,source:'Codex 本机账号接口',message:available?'':'当前账号未返回订阅额度；API 账号用量与订阅额度不同'};
}
export function claudeUsage(value){
 const windows=[];
 for(const [key,label]of Object.entries({five_hour:'5 小时',seven_day:'7 天',seven_day_opus:'Opus · 7 天',seven_day_sonnet:'Sonnet · 7 天'})){
  const w=value?.[key],used=percentage(w?.utilization);if(used===null)continue;
  windows.push({label,usedPercent:used,remainingPercent:100-used,resetsAt:typeof w.resets_at==='string'&&Number.isFinite(Date.parse(w.resets_at))?new Date(w.resets_at).toISOString():null});
 }
 return {available:windows.length>0,kind:'subscription',windows,source:'Claude 官方订阅接口',message:windows.length?'':'账号未返回可查询的订阅窗口'};
}
export class UsageQueries{
 constructor(adapter,{home=os.homedir(),fetcher=fetch,now=Date.now}={}){Object.assign(this,{adapter,home,fetcher,now});this.cache=new Map();this.pending=new Map();}
 async read(toolId='codex'){
  const key=toolId;
  if(!['codex','claude'].includes(key))return {available:false,toolId,message:key==='claude-desktop'?'Claude Desktop 账号额度尚未接入；Claude Code 登录可能属于不同账号，请选择 Claude Code 单独查询':'该工具暂未提供已适配的额度接口'};
  const cached=this.cache.get(key);if(cached&&this.now()-cached.at<30000)return cached.data;
  if(this.pending.has(key))return this.pending.get(key);
  const work=this.query(key).then(data=>{const result={...data,toolId,updatedAt:new Date(this.now()).toISOString()};this.cache.set(key,{at:this.now(),data:result});return result;}).finally(()=>this.pending.delete(key));this.pending.set(key,work);return work;
 }
 async query(tool){
  try{
   if(tool==='codex')return codexUsage(await Promise.race([this.adapter.controls.rpc('account/rateLimits/read',{}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('timeout')),10000);timer.unref?.();})]));
   if(tool==='claude'){
    const file=path.join(process.env.CLAUDE_CONFIG_DIR||path.join(this.home,'.claude'),'.credentials.json');
    if(!fs.existsSync(file)||fs.statSync(file).size>65536)return {available:false,message:'未找到本机 Claude OAuth 登录信息；请先在电脑登录 Claude Code。仅 API 配置无法查询订阅额度'};
    const oauth=JSON.parse(fs.readFileSync(file,'utf8')).claudeAiOauth;
    if(!oauth?.accessToken||oauth.expiresAt&&oauth.expiresAt<=this.now())return {available:false,message:'本机 Claude 订阅登录不可用或已过期，请在电脑重新登录'};
    const r=await this.fetcher('https://api.anthropic.com/api/oauth/usage',{headers:{Authorization:`Bearer ${oauth.accessToken}`,'anthropic-beta':'oauth-2025-04-20'},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!r.ok){await r.body?.cancel();return {available:false,message:r.status===401||r.status===403?'账号未授权额度查询，请检查电脑登录状态':'官方额度接口暂不可用，请稍后重试'};}
    const raw=await r.text();if(raw.length>65536)throw Error('large');return claudeUsage(JSON.parse(raw));
   }
   return {available:false,message:'该工具暂未提供已适配的额度接口；不会用本地 Token 统计推算订阅余额'};
  }catch{return {available:false,message:'额度暂时查询失败，请确认电脑网络和账号登录状态后重试'};}
 }
}
