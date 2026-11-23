import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {codingProcesses} from './process-discovery.mjs';
import {DesktopSessionBridge} from './desktop-session-bridge.mjs';
const require=createRequire(import.meta.url);

// Tool-level switching mirrors CC Switch. No provider keys are read or exposed.
export const definitions=[
 {id:'codex',name:'Codex',commands:['codex'],dirs:['.codex'],roots:[]},
 {id:'claude',name:'Claude Code',commands:['claude'],dirs:['.claude'],roots:['.claude/projects']},
 {id:'gemini',name:'Gemini CLI',commands:['gemini'],dirs:['.gemini'],roots:['.gemini/tmp']},
 {id:'opencode',name:'OpenCode',commands:['opencode'],dirs:['.config/opencode','.local/share/opencode'],roots:[]},
 {id:'openclaw',name:'OpenClaw',commands:['openclaw','openclaw-cn','clawdbot-cn'],dirs:['.openclaw','.openclaw-cn','.clawdbot'],roots:['.openclaw/agents','.openclaw-cn/agents','.clawdbot/agents']},
 {id:'hermes',name:'Hermes Agent',commands:['hermes'],dirs:['.hermes'],roots:[]},
 {id:'pi',name:'Pi',commands:['pi'],dirs:['.pi'],roots:['.pi/agent/sessions']},
 {id:'deepseek',name:'DeepSeek Harness',commands:[],dirs:['.dsh'],roots:[]},
 {id:'kimi',name:'Kimi Code',commands:['kimi'],dirs:['.kimi'],roots:[]},
 {id:'grokbuild',name:'Grok Build',commands:['grok'],dirs:['.grok'],roots:[]},
 {id:'mcode',name:'MiniMax Code',commands:['mcode'],dirs:['.mcode'],roots:[]},
 {id:'omp',name:'Oh My Pi',commands:['omp'],dirs:['.omp'],roots:[]},
 {id:'claude-desktop',name:'Claude Desktop · Code',commands:[],dirs:['AppData/Roaming/Claude','AppData/Local/Claude-3p'],roots:['.claude/projects']},
 {id:'zcode',name:'ZCode',commands:['zcode'],dirs:['.zcode','AppData/Roaming/ZCode'],roots:[]},
 {id:'droid',name:'Droid',commands:['droid'],dirs:['.factory'],roots:['.factory/sessions']}
];
function files(dir,depth=0,out=[]){
 if(depth>5||out.length>=1500)return out;
 try{for(const f of fs.readdirSync(dir,{withFileTypes:true})){if(f.isSymbolicLink())continue;const p=path.join(dir,f.name);if(f.isDirectory())files(p,depth+1,out);else if(f.name.endsWith('.jsonl')||/^session-.*\.json$/.test(f.name))out.push(p);if(out.length>=1500)break;}}catch{}
 return out;
}
export function normalizeTranscript(records){
 const messages=new Map();let cwd='',sessionId='';
 for(const [i,r] of records.entries()){
  cwd=r.cwd||cwd;sessionId=r.sessionId||r.session_id||sessionId;
  const m=r.message||r;const role=m.role||m.type;
  if(!['user','assistant','gemini','toolResult'].includes(role))continue;
  const content=m.content??m.parts??m.text??'';
  const blocks=Array.isArray(content)?content:[typeof content==='string'?{text:content}:content];
  const text=blocks.filter(Boolean).map(b=>b.text||b.content||'').filter(v=>typeof v==='string'&&v.length).join('\n');
  const id=r.uuid||r.id||m.id||String(i);
  if(text)messages.set(id,{id,role:role==='user'?'user':'agent',type:role==='toolResult'?'step':'text',title:m.toolName||'工具输出',text});
  for(const [k,b] of blocks.entries())if(b?.type==='tool_use'||b?.functionCall)messages.set(id+':'+k,{id:id+':'+k,role:'agent',type:'step',title:b.name||b.functionCall?.name||'工具调用',text:JSON.stringify(b.input||b.functionCall?.args||{},null,2)});
 }
 return {messages:[...messages.values()],cwd,sessionId};
}
export class ToolRegistry {
 constructor(config){this.config=config;this.home=config.homeDir||os.homedir();this.index=new Map();this.tasks=[];this.at=0;this.bridge=new DesktopSessionBridge(config);this.nativeTools=new Set();}
 executable(def){
  const explicit=this.config.toolExecutables?.[def.id]||(def.id==='codex'?this.config.codexExecutable:null);if(explicit&&fs.existsSync(explicit))return explicit;
  const running=this.processes?.find(p=>p.toolId===def.id&&p.executable&&fs.existsSync(p.executable));if(running)return running.executable;
  if(def.id==='zcode'&&fs.existsSync('D:/Software/ZCode/ZCode.exe'))return 'D:/Software/ZCode/ZCode.exe';
  if(def.id==='claude'){const p='D:/Software/ClaudeCode/node_modules/@anthropic-ai/claude-code/bin/claude.exe';if(fs.existsSync(p))return p;}
  const dirs=[...(process.env.PATH||'').split(path.delimiter),path.join(this.home,'.local/bin'),path.join(this.home,'AppData/Roaming/npm')];
  for(const dir of dirs)for(const name of def.commands)for(const ext of process.platform==='win32'?['.exe','.cmd','']:['']){const p=path.join(dir,name+ext);if(fs.existsSync(p)&&fs.statSync(p).isFile())return p;}
  return null;
 }
 configuredTypes(){
  const dbFile=path.join(this.home,'.cc-switch/cc-switch.db');if(!fs.existsSync(dbFile))return new Set();
  let db;try{const {DatabaseSync}=require('node:sqlite');db=new DatabaseSync(dbFile,{readOnly:true});return new Set(db.prepare('SELECT DISTINCT app_type FROM providers').all().map(r=>r.app_type));}catch{return new Set();}finally{db?.close();}
 }
 async tools(){
  this.processes=await codingProcesses();
  const types=this.configuredTypes();
  const history=await this.list();
  return definitions.map(d=>{const executable=this.executable(d),configured=types.has(d.id)||d.dirs.some(p=>fs.existsSync(path.join(this.home,p)));return{id:d.id,name:d.name,sessionCount:history.filter(t=>t.toolId===d.id).length,installed:!!executable||this.nativeTools.has(d.id),configured,running:this.nativeTools.has(d.id)||this.processes.some(p=>p.toolId===d.id),processCount:this.processes.filter(p=>p.toolId===d.id).length,available:d.id==='codex'||this.nativeTools.has(d.id)||!!executable||configured,
   capabilities:{history:d.id==='codex'||this.nativeTools.has(d.id)||d.roots.length>0,send:this.nativeTools.has(d.id)||d.id==='codex',create:d.id==='codex'||d.id==='deepseek'&&this.nativeTools.has('deepseek'),models:d.id==='codex'},
   note:this.nativeTools.has(d.id)?'已连接原桌面会话；可续聊，操作审批请在桌面完成':d.id==='codex'?'原桌面实时连接':d.id==='claude-desktop'?'可查看 Code 原会话与日志更新；原进程发送尚未接通':d.id==='zcode'?'可识别安装与进程；原会话协议尚未接通':d.roots.length?'读取本机历史；桌面续聊尚未接通':'已发现配置，尚无可用桌面会话适配器'};}).filter(d=>d.available);
 }
 read(file){
  const stat=fs.statSync(file);const max=8*1024*1024;let text;
  if(stat.size>max&&file.endsWith('.jsonl')){const fd=fs.openSync(file,'r');try{const b=Buffer.alloc(max);fs.readSync(fd,b,0,max,stat.size-max);text=b.toString('utf8');text=text.slice(text.indexOf('\n')+1);}finally{fs.closeSync(fd);}}
  else{if(stat.size>24*1024*1024)throw new Error('会话元数据过大');text=fs.readFileSync(file,'utf8');}let records=[];
  if(file.endsWith('.json')){const j=JSON.parse(text);records=j.messages||[];}else for(const line of text.split('\n')){try{records.push(JSON.parse(line));}catch{}}
  return {...normalizeTranscript(records),truncated:stat.size>max};
 }
 async list(){
  if(Date.now()-this.at<15000)return this.tasks;
  const tasks=[];
  const nativeSessionIds=new Set();this.nativeTools.clear();
  const nativeResults=await Promise.allSettled(['claude-desktop','zcode','kimi','deepseek','gemini'].map(async toolId=>({toolId,sessions:await this.bridge.sessions(toolId)})));
  for(const result of nativeResults)if(result.status==='fulfilled'){
   const {toolId,sessions}=result.value;if(!Array.isArray(sessions))continue;
   this.nativeTools.add(toolId);
   for(const s of sessions){if(typeof s.sessionId!=='string'||s.isArchived)continue;
    const id='native:'+toolId+':'+encodeURIComponent(s.sessionId);this.index.set(id,{toolId,sessionId:s.sessionId});
    nativeSessionIds.add(s.sessionId);
    if(s.cliSessionId)nativeSessionIds.add(s.cliSessionId);
    tasks.push(this.nativeTask(toolId,s,id));
   }
  }
  this.processes=await codingProcesses();
  const desktopSessions=new Map();
  for(const root of ['AppData/Local/Claude-3p/claude-code-sessions','AppData/Roaming/Claude/claude-code-sessions','D:/Software/ClaudeDesktop/data/claude-code-sessions']){
   const walk=(dir,depth=0)=>{if(depth>4)return;try{for(const f of fs.readdirSync(dir,{withFileTypes:true})){if(f.isSymbolicLink())continue;const p=path.join(dir,f.name);if(f.isDirectory())walk(p,depth+1);else if(/^local_.*\.json$/.test(f.name)){try{const m=JSON.parse(fs.readFileSync(p));if(m.cliSessionId&&!m.isArchived)desktopSessions.set(m.cliSessionId,{title:m.title,cwd:m.cwd,nativeSessionId:m.sessionId||path.basename(f.name,'.json')});}catch{}}}}catch{}};walk(path.isAbsolute(root)?root:path.join(this.home,root));
  }
  for(const d of definitions)for(const root of d.roots)for(const file of files(path.join(this.home,root))){
   const session=path.basename(file,'.jsonl');const meta=desktopSessions.get(session);
   if(['claude','claude-desktop'].includes(d.id)&&(nativeSessionIds.has(session)||nativeSessionIds.has(meta?.nativeSessionId)))continue;
   if(d.id==='claude-desktop'&&!meta)continue;
   try{const stat=fs.statSync(file),key='tool:'+d.id+':'+crypto.createHash('sha256').update(file).digest('hex').slice(0,24);this.index.set(key,{file,toolId:d.id});
    const cached=this.tasks.find(t=>t.id===key&&t.updatedAt===stat.mtimeMs);if(cached){tasks.push(cached);continue;}
    const r=this.read(file);if(!r.messages.length)continue;
    tasks.push({id:key,toolId:d.id,title:(meta?.title||r.messages.find(m=>m.role==='user')?.text||d.name+' 会话').slice(0,70),status:'Completed',processAttached:this.processes.some(p=>p.sessionId===session),updatedAt:stat.mtimeMs,cwd:meta?.cwd||r.cwd,projectId:null,source:'history',readOnly:true});
   }catch{}
  }
  this.at=Date.now();this.tasks=tasks.sort((a,b)=>b.updatedAt-a.updatedAt);return this.tasks;
 }
 nativeTask(toolId,s,id){return {id,toolId,title:s.title||'桌面对话',status:s.status||(s.isRunning?'Running':'Completed'),updatedAt:s.lastActivityAt||s.createdAt||0,cwd:s.cwd||'',projectId:s.cwd?toolId+':'+crypto.createHash('sha256').update(s.cwd.replaceAll('\\','/').toLowerCase()).digest('hex').slice(0,16):null,source:'desktop',readOnly:false,canApprove:false,approvals:[],syncMode:'desktop-bridge',model:s.model};}
 async nativeDetail(id){const ref=this.nativeRef(id);const r=await this.bridge.detail(ref.toolId,ref.sessionId);return {...this.nativeTask(ref.toolId,r.session,id),messages:normalizeTranscript(r.messages).messages,submittedRequests:r.submittedRequests,hasMore:false};}
 nativeRef(id){const m=/^native:(claude-desktop|zcode|kimi|deepseek|gemini):(.+)$/.exec(id);if(!m)throw new Error('无效的桌面会话');return {toolId:m[1],sessionId:decodeURIComponent(m[2])};}
 send(id,instruction,requestId){const ref=this.nativeRef(id);return this.bridge.send(ref.toolId,ref.sessionId,instruction,requestId);}
 async detail(id){if(id.startsWith('native:'))return this.nativeDetail(id);if(!this.index.has(id))await this.list();const ref=this.index.get(id);if(!ref)throw new Error('会话不存在');const r=this.read(ref.file);if(r.truncated)r.messages.unshift({id:'history-window',role:'agent',type:'text',text:'当前显示这段长会话的最近内容，完整日志保留在电脑上。'});return {...this.tasks.find(t=>t.id===id),...r,readOnly:true,canApprove:false,approvals:[],hasMore:false};}
}
