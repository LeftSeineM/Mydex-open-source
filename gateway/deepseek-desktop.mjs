import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {ensureMacDSH} from './mac-dsh-discovery.mjs';

export class DeepSeekDesktop {
  constructor(config={}){this.config=config;this.directory=config.bridgeDirectory||path.join(config.homeDir||os.homedir(),'.mydex/desktop-bridges');}
  async rpc(method,request) {
    const discovery=await ensureMacDSH(this.config);
    if(discovery?.connected===false)throw new Error('DeepSeek 原会话尚未接通：'+discovery.reason);
    const c=JSON.parse(fs.readFileSync(path.join(this.directory,'deepseek.json'),'utf8'));
    if(c.toolId!=='deepseek'||!/^http:\/\/127\.0\.0\.1:\d+$/.test(c.base)||!c.cookie)throw new Error('DeepSeek 桌面连接信息无效');
    const rpcId=crypto.randomUUID();
    const r=await fetch(c.base+'/api/session/'+method,{method:'POST',headers:{Cookie:c.cookie,'Content-Type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method:'session/'+method,payload:{args:{[method==='list'?'_request':'request']:request}}}),signal:AbortSignal.timeout(15000),redirect:'error'});
    const j=await r.json();if(!r.ok||j.rpcId!==rpcId||j.result?.ok!==true)throw new Error('DeepSeek 原会话请求失败：'+(j.result?.error?.code||r.status));
    return j.result.value;
  }
  session(s){const v=s.projections?.values||{};return {sessionId:s.sessionId,title:v.title,cwd:s.cwd||v.workingDirectory,isRunning:s.running,lastActivityAt:s.updatedAt,model:v.modelSelection?.next?.model||v.modelSelection?.lastUsed?.model};}
  async rawSessions(){const rows=[];let cursor;const seen=new Set();do {const r=await this.rpc('list',cursor?{cursor}:{});rows.push(...r.items);cursor=r.nextCursor||r.cursor;if(cursor&&seen.has(cursor))throw new Error('DeepSeek 会话分页异常');seen.add(cursor);}while(cursor&&rows.length<10000);return rows.filter(s=>!s.blank&&!s.parentSessionId);}
  async sessions(){return (await this.rawSessions()).map(s=>this.session(s));}
  async detail(id){
    const s=(await this.rawSessions()).find(s=>s.sessionId===id);if(!s)throw new Error('原会话不存在');
    const projection=await this.rpc('projections',{sessionId:id});
    const throughSeq=projection.asOfSeq??s.projections?.asOfSeq;
    if(!Number.isInteger(throughSeq))throw new Error('DeepSeek 会话版本不可用');
    const rows=[];let beforeSeq;
    do {const p=await this.rpc('page',{address:{kind:'session',sessionId:id},throughSeq,maxMessages:100,...beforeSeq===undefined?{}:{beforeSeq}});rows.unshift(...p.records);if(!p.hasMore)break;const next=p.records[0]?.event.seq;if(!Number.isInteger(next)||next===beforeSeq)throw new Error('DeepSeek 历史分页异常');beforeSeq=next;}while(rows.length<20000);
    const messages=rows.flatMap(({event:e})=>{
      const m=e.type==='assistant/message'?e.data.message:e.type==='user/message'&&e.data.source?.kind==='user'?e.data:null;
      if(!m)return [];
      return [{id:m.id||String(e.seq),message:{role:m.role,content:(m.content||[]).filter(b=>['text','tool_use'].includes(b.type))}}];
    });
    return {session:this.session(s),messages};
  }
  async send(id,instruction){
    if(!(await this.rawSessions()).some(s=>s.sessionId===id))throw new Error('原会话不存在');
    return this.rpc('prompt',{sessionId:id,requestId:crypto.randomUUID(),mode:'queue',content:[{type:'text',text:instruction}]});
  }
}
