import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {ensureMacDSH} from './mac-dsh-discovery.mjs';

export class DeepSeekDesktop {
  constructor(config={}){this.config=config;this.directory=config.bridgeDirectory||path.join(config.homeDir||os.homedir(),'.mydex/desktop-bridges');}
  async rpc(method,request,namespace='session') {
    if(!['session','workspace'].includes(namespace))throw Error('DSH 接口范围无效');
    const discovery=await ensureMacDSH(this.config);
    if(discovery?.connected===false)throw new Error('DeepSeek 原会话尚未接通：'+discovery.reason);
    const c=JSON.parse(fs.readFileSync(path.join(this.directory,'deepseek.json'),'utf8'));
    if(c.toolId!=='deepseek'||!/^http:\/\/127\.0\.0\.1:\d+$/.test(c.base)||!c.cookie)throw new Error('DeepSeek 桌面连接信息无效');
    const rpcId=crypto.randomUUID();
    const r=await fetch(c.base+'/api/'+namespace+'/'+method,{method:'POST',headers:{Cookie:c.cookie,'Content-Type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method:namespace+'/'+method,payload:{args:{[method==='list'?'_request':'request']:request}}}),signal:AbortSignal.timeout(15000),redirect:'error'});
    const j=await r.json();if(!r.ok||j.rpcId!==rpcId||j.result?.ok!==true)throw new Error('DeepSeek 原会话请求失败：'+(j.result?.error?.code||r.status));
    return j.result.value;
  }
  session(s){const v=s.projections?.values||{};return {sessionId:s.sessionId,title:v.title,cwd:s.cwd||v.workingDirectory,isRunning:s.running,lastActivityAt:s.updatedAt,model:v.modelSelection?.next?.model||v.modelSelection?.lastUsed?.model};}
  async rawSessions({includeBlank=false}={}){const rows=[];let cursor;const seen=new Set();do {const r=await this.rpc('list',cursor?{cursor}:{});rows.push(...r.items);cursor=r.nextCursor||r.cursor;if(cursor&&seen.has(cursor))throw new Error('DeepSeek 会话分页异常');seen.add(cursor);}while(cursor&&rows.length<10000);return rows.filter(s=>(includeBlank||!s.blank)&&!s.parentSessionId);}
  async sessions(){return (await this.rawSessions()).map(s=>this.session(s));}
  async detail(id){
    const s=(await this.rawSessions({includeBlank:true})).find(s=>s.sessionId===id);if(!s)throw new Error('原会话不存在');
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
    const submittedRequests=rows.flatMap(({event:e})=>e.type==='user/message'&&e.data.source?.kind==='user'&&typeof e.data.source.rpcId==='string'?[e.data.source.rpcId]:[]);
    return {session:this.session(s),messages,submittedRequests};
  }
  async send(id,instruction,requestId=crypto.randomUUID()){
    if(!(await this.rawSessions({includeBlank:true})).some(s=>s.sessionId===id))throw new Error('原会话不存在');
    return this.rpc('prompt',{sessionId:id,requestId,mode:'queue',content:[{type:'text',text:instruction}]});
  }
  async create(cwd,requestId=crypto.randomUUID()){
    if(typeof cwd!=='string'||!path.isAbsolute(cwd)||!fs.statSync(cwd).isDirectory())throw Error('请选择存在的本机工作目录');
    if(!/^[a-f0-9-]{36}$/i.test(requestId))throw Error('新建请求标识无效');
    // Use the ORIGINAL running desktop controller, which owns account/model
    // defaults and native history. No subprocess, SDK resume or transcript copy.
    // Session creation with cwd alone is not attached to the desktop sidebar.
    // Resolve/register the same native workspace first (idempotent by path),
    // then let the native session controller attach the new session to it.
    const {workspace}=await this.rpc('create',{path:cwd},'workspace');
    if(typeof workspace?.workspaceId!=='string')throw Error('DSH 未确认原桌面工作区，未创建会话');
    const created=await this.rpc('create',{workspaceId:workspace.workspaceId,sessionId:'session-'+requestId});
    if(typeof created?.sessionId!=='string')throw Error('DSH 已收到新建请求，但未确认会话标识；请刷新，不要重复创建');
    return created;
  }
}
