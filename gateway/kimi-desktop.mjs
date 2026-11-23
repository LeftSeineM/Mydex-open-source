import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// Connect only to the server started by Kimi Desktop. Never start a second agent.
export class KimiDesktop {
  constructor(config={}) { this.config=config; }
  connection() {
    const homes=[this.config.kimiHome,process.env.KIMI_CODE_HOME,'D:/Software/KimiCode/data',path.join(this.config.homeDir||os.homedir(),'.kimi')].filter(Boolean);
    for(const home of homes)try {
      const log=fs.readFileSync(path.join(home,'logs/kimi-code-desktop.log'),'utf8');
      const matches=[...log.matchAll(/embedded server listening on (http:\/\/127\.0\.0\.1:\d+)/g)];
      if(!matches.length)continue;
      const token=fs.readFileSync(path.join(home,'server.token'),'utf8').trim();
      if(token)return {base:matches.at(-1)[1],token};
    } catch {}
    throw new Error('请先启动 Kimi Code 桌面客户端');
  }
  async request(route,body) {
    const c=this.connection();
    const r=await fetch(c.base+'/api/v1/'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+c.token,...body?{'Content-Type':'application/json'}:{}},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(body?20000:5000)});
    const j=await r.json();
    if(!r.ok||j.code!==0)throw new Error('Kimi 桌面请求失败，请在原会话检查状态');
    return j.data;
  }
  session(s) {return {sessionId:s.id,title:s.title,cwd:s.metadata?.cwd||'',projectId:s.workspace_id,isRunning:!!s.busy,isArchived:!!s.archived,model:s.agent_config?.model,createdAt:Date.parse(s.created_at)||0,lastActivityAt:Date.parse(s.updated_at)||0,status:s.pending_interaction==='approval'?'AwaitingApproval':s.busy?'Running':s.last_turn_reason==='failed'?'Failed':'Completed'};}
  async sessions() {
    const rows=[];let cursor;const seen=new Set();
    do {const r=await this.request('sessions?page_size=100'+(cursor?'&before_id='+encodeURIComponent(cursor):''));rows.push(...r.items);if(!r.has_more)break;cursor=r.items.at(-1)?.id;if(!cursor||seen.has(cursor))throw new Error('Kimi 会话分页异常');seen.add(cursor);}while(rows.length<10000);
    return rows.map(s=>this.session(s));
  }
  async detail(id) {
    const s=await this.request('sessions/'+encodeURIComponent(id));
    const rows=[];let cursor;const seen=new Set();
    do {const r=await this.request('sessions/'+encodeURIComponent(id)+'/messages?page_size=100'+(cursor?'&before_id='+encodeURIComponent(cursor):''));rows.push(...r.items);if(!r.has_more)break;cursor=r.items.at(-1)?.id;if(!cursor||seen.has(cursor))throw new Error('Kimi 消息分页异常');seen.add(cursor);}while(rows.length<5000);
    const messages=rows.reverse().filter(m=>m.metadata?.origin?.kind!=='injection'&&['user','assistant','tool'].includes(m.role)).map(m=>({id:m.id,message:{role:m.role==='tool'?'toolResult':m.role,content:(m.content||[]).flatMap(b=>b.type==='text'?[b]:b.type==='tool_use'?[{type:'tool_use',name:b.tool_name,input:b.input}]:b.type==='tool_result'?[{text:typeof b.output==='string'?b.output:JSON.stringify(b.output)}]:[])}}));
    return {session:this.session(s),messages};
  }
  async send(id,instruction,requestId=crypto.randomUUID()) {
    const s=await this.request('sessions/'+encodeURIComponent(id));
    if(s.archived)throw new Error('原会话已归档');
    // Preserve the desktop's model and permission configuration. No retries on
    // ambiguous network failure: inspect the same conversation before resending.
    await this.request('sessions/'+encodeURIComponent(id)+'/prompts',{content:[{type:'text',text:instruction}],prompt_id:requestId});
    return {accepted:true,sessionId:id,requestId};
  }
}
