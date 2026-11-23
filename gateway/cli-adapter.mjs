import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';

export const runnableTools=new Set(['claude','gemini','opencode','openclaw']);
// Resolve npm Windows shims to their JS entry. User text never passes a shell.
export function launcher(executable){
 if(/\.(?:m?js|cjs)$/i.test(executable))return{command:process.execPath,prefix:[executable]};
 if(!/\.cmd$/i.test(executable))return{command:executable,prefix:[]};
 const source=fs.readFileSync(executable,'utf8');
 const relative=source.match(/"%dp0%[\\/]([^"\r\n]+\.(?:m?js|cjs))"/i)?.[1];
 if(!relative)throw new Error('此工具启动器尚不支持，请在电脑端配置实际 exe / JS 入口');
 const entry=path.resolve(path.dirname(executable),relative.replaceAll('\\',path.sep));
 if(!fs.existsSync(entry))throw new Error('工具启动入口不存在');
 return{command:process.execPath,prefix:[entry]};
}
export function cliArguments(tool,text,sessionId){
 switch(tool){
  case'claude':return{args:['-p','--verbose','--output-format','stream-json','--include-partial-messages',...(sessionId?['--resume',sessionId]:[])],stdin:text};
  case'gemini':return{args:['-p',text,'--output-format','stream-json',...(sessionId?['--resume',sessionId]:[])],stdin:''};
  case'opencode':return{args:['run','--format','json',...(sessionId?['--session',sessionId]:[]),text],stdin:''};
  case'openclaw':return{args:['agent','--agent','main','--session-id',sessionId||crypto.randomUUID(),'--message',text,'--json'],stdin:''};
  default:throw new Error('该工具没有启用执行适配器');
 }
}
export class CliAdapter extends EventEmitter {
 constructor(config,registry){super();this.config=config;this.registry=registry;this.tasks=new Map();this.running=new Map();this.file=path.join(config.dataDir,'cli-tasks.json');
  if(fs.existsSync(this.file))for(const t of JSON.parse(fs.readFileSync(this.file))){if(t.status==='Running'){t.status='Failed';t.error='连接服务曾重启，请先在原工具检查执行结果。';}this.tasks.set(t.id,t);}
 }
 save(t){t.updatedAt=Date.now();fs.writeFileSync(this.file+'.tmp',JSON.stringify([...this.tasks.values()]));fs.renameSync(this.file+'.tmp',this.file);this.emit('change',{task:t,taskId:t.id});}
 async create({toolId,instruction,cwd}){
  const def=(await import('./tool-registry.mjs')).definitions.find(d=>d.id===toolId);
  const exe=def&&this.registry.executable(def);if(!exe||!runnableTools.has(toolId))throw new Error('这台电脑未安装可执行的该工具');
  launcher(exe);
  const t={id:'cli:'+crypto.randomUUID(),toolId,title:instruction.slice(0,70),source:'cli',status:'Running',cwd:cwd||this.config.workspace,messages:[],approvals:[],canApprove:false,readOnly:true,...(toolId==='openclaw'?{nativeSessionId:crypto.randomUUID()}:{})};
  // Each run is isolated. Existing terminal sessions are never hijacked.
  this.tasks.set(t.id,t);return this.launch(t,instruction,def,exe);
 }
 async send(id,instruction){
  const t=this.tasks.get(id);if(!t||!t.nativeSessionId)throw new Error('此工具未返回可继续的会话标识，请新建任务');
  if(this.running.has(id))throw new Error('当前工具仍在执行，请等待完成');
  const def=(await import('./tool-registry.mjs')).definitions.find(d=>d.id===t.toolId);
  const exe=this.registry.executable(def);if(!exe)throw new Error('工具当前未安装');
  return this.launch(t,instruction,def,exe);
 }
 launch(t,instruction,def,exe){
  const l=launcher(exe),spec=cliArguments(t.toolId,instruction,t.nativeSessionId);
  t.messages.push({id:crypto.randomUUID(),role:'user',type:'text',text:instruction});t.status='Running';t.error=null;this.save(t);
  const child=spawn(l.command,[...l.prefix,...spec.args],{cwd:t.cwd,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  this.running.set(t.id,child);let buffer='',all='',lineNo=0;const response={id:crypto.randomUUID(),role:'agent',type:'text',text:'',agentName:def.name};
  t.messages.push(response);
  const accept=line=>{let r;try{r=JSON.parse(line);}catch{return;}lineNo++;
   if(r.session_id||r.sessionID)t.nativeSessionId=r.session_id||r.sessionID;
   if(r.type==='stream_event'&&r.event?.delta?.text)response.text+=r.event.delta.text;
   else if(r.type==='assistant'&&r.message?.content){const text=r.message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');if(text&&!response.text.endsWith(text))response.text+=(response.text?'\n':'')+text;}
   else if(r.type==='message'&&r.role==='assistant')response.text+=r.content||'';
   else if(r.type==='text'&&r.part?.text)response.text+=r.part.text;
   else if(r.type==='result'&&r.result&&!response.text)response.text=String(r.result);
   if(r.type==='tool_use'||r.type==='tool_result'||r.type==='tool')t.messages.push({id:response.id+'-step-'+lineNo,role:'agent',type:'step',title:r.tool_name||r.part?.tool||'工具执行',text:JSON.stringify(r,null,2).slice(0,20000)});
   this.save(t);
  };
  child.stdout.on('data',chunk=>{const text=chunk.toString();all=(all+text).slice(-4000000);buffer+=text;let at;while((at=buffer.indexOf('\n'))>=0){accept(buffer.slice(0,at));buffer=buffer.slice(at+1);}});
  // Never expose raw stderr: third-party tools sometimes print credentials there.
  child.stderr.resume();
  child.on('error',()=>{t.status='Failed';t.error='无法启动该工具，请检查电脑端安装与配置';this.running.delete(t.id);this.save(t);});
  child.on('close',code=>{clearTimeout(timer);if(buffer)accept(buffer);
   if(!response.text){try{const r=JSON.parse(all);response.text=(r.result?.payloads||r.payloads||[]).map(p=>p.text||'').join('\n')||r.response||r.result?.text||'';t.nativeSessionId=r.result?.meta?.agentMeta?.sessionId||r.meta?.agentMeta?.sessionId||t.nativeSessionId;}catch{}}
   t.readOnly=!t.nativeSessionId;
   if(t.status==='Running')t.status=code===0?'Completed':'Failed';
   if(code!==0)t.error='工具执行未成功（退出码 '+code+'），请在电脑上检查登录、配置或待授权操作';
   this.running.delete(t.id);this.save(t);
  });
  const timer=setTimeout(()=>{t.status='Failed';t.error='本次执行达到 30 分钟上限，请在电脑检查任务';child.kill();},30*60*1000);timer.unref();
  child.stdin.on('error',()=>{});child.stdin.end(spec.stdin);
  return t;
 }
}
