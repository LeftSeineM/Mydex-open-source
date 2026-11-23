import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {Desktop} from './desktop.mjs';
import {readRemoteDesktop, RemoteDesktopCatalog, remotePrefix} from './router/remote-desktop.mjs';
import {Codex} from './codex.mjs';
import {NativeFollower} from './native.mjs';
import {Controls} from './controls.mjs';
import {ToolRegistry} from './tool-registry.mjs';
import {CliAdapter} from './cli-adapter.mjs';
import {MacDesktopNavigation} from './mac-desktop-navigation.mjs';
import {WindowsDesktopNavigation} from './windows-desktop-navigation.mjs';
import {LiveSideChats} from './live-side-chats.mjs';
import {UsageQueries} from './usage.mjs';
import {DshCreationJournal,nativeCreationId} from './dsh-creation-journal.mjs';
import {permissionState,interaction,validateAnswers,messageQuestions,answeredMessageQuestions} from './permissions.mjs';
import {ToolWake} from './tool-wake.mjs';

export function taskStatus(value) {
  const s = typeof value === 'object' ? value?.type : value;
  return ({active:'Running',running:'Running',inProgress:'Running',waitingForApproval:'AwaitingApproval',needsAttention:'AwaitingApproval',completed:'Completed',idle:'Completed',failed:'Failed',error:'Failed',interrupted:'Failed',pending:'Pending',notLoaded:'Completed'})[s] || 'Pending';
}
export function subagentMessage(item){
 if(item.type==='collabAgentToolCall'){
  const states=item.agentsStates&&typeof item.agentsStates==='object'?item.agentsStates:{};
  return {id:item.id,role:'agent',type:'subagent',operation:item.tool,status:item.status,model:item.model||'',effort:item.reasoningEffort||'',prompt:typeof item.prompt==='string'?item.prompt:'',agents:(Array.isArray(item.receiverThreadIds)?item.receiverThreadIds:[]).map(id=>({id,status:states[id]?.status||'',message:states[id]?.message||''}))};
 }
 if(item.type==='subAgentActivity')return {id:item.id,role:'agent',type:'subagent',operation:item.kind,status:({started:'running',completed:'completed',interrupted:'interrupted'})[item.kind]||'',model:item.model||'',effort:item.reasoningEffort||'',prompt:'',agents:[{id:item.agentThreadId||'',name:item.agentPath||'',status:({started:'running',completed:'completed',interrupted:'interrupted'})[item.kind]||'',message:''}]};
 return null;
}
export class Adapter extends EventEmitter {
  managed = new Map(); images = new Map(); loaded = new Set(); desktopOk = false; indexed=[]; indexedAt=0; indexPromise=null; summaries=new Map();projectCache=[];
  constructor(config) {
    super(); this.config = config;
    this.desktop = new Desktop(config.callerThreadId);
    this.remoteDesktop = new RemoteDesktopCatalog(config.remoteDesktopSessions);
    this.controls = new Controls(this);
    this.usageQueries = new UsageQueries(this);
    this.liveSideChats = new LiveSideChats();
    this.toolbox = new ToolRegistry(config);
    this.toolWake=new ToolWake({directory:path.join(config.dataDir,'application-wake'),probe:async tool=>{
      if(tool==='codex'){try{await this.desktop.discover();return true;}catch{try{await this.native.connect();return true;}catch{return false;}}}
      await this.toolbox.bridge.sessions(tool);return true;
    }});
    this.dshCreations=new DshCreationJournal({directory:path.join(config.dataDir,'dsh-creations'),client:this.toolbox.bridge.deepseek});
    this.codex = new Codex(config.codexExecutable, config.workspace);
    this.native = new NativeFollower();this.nativeTasks=new Map();this.nativeTimers=new Map();
    this.macNavigation=process.platform==='darwin'?new MacDesktopNavigation(this.native,this.codex):null;
    this.desktopNavigation=this.macNavigation||(process.platform==='win32'?new WindowsDesktopNavigation(this.native):null);
    this.native.on('state',({id,state})=>{
      this.nativeTasks.set(id,this.fromNative(state));
      if(!this.nativeTimers.has(id))this.nativeTimers.set(id,setTimeout(()=>{this.nativeTimers.delete(id);const task=this.nativeTasks.get(id);if(task)this.emit('change',{taskId:task.id,task});},100));
    });
    this.stateFile = path.join(config.dataDir,'tasks.json');
    fs.mkdirSync(config.dataDir,{recursive:true});
    this.cli = new CliAdapter(config,this.toolbox);
    this.cli.on('change',e=>this.emit('change',e));
    if (fs.existsSync(this.stateFile)) {
      for (const t of JSON.parse(fs.readFileSync(this.stateFile,'utf8'))) {
        if (['Running','AwaitingApproval'].includes(t.status)) {
          t.status = 'Failed'; t.error = '连接服务曾重启，请查看历史后继续任务。';
          t.approvals = [];
        }
        this.managed.set(t.id,t);
      }
    }
    this.codex.on('event', m => this.onEvent(m));
    this.codex.on('offline', () => {
      this.loaded.clear();
      for (const t of this.managed.values()) if (['Running','AwaitingApproval'].includes(t.status)) {t.status='Failed';t.approvals=[];t.error='Codex 连接中断';this.changed(t);}
    });
  }
  persist() { fs.writeFileSync(this.stateFile+'.tmp',JSON.stringify([...this.managed.values()]));fs.renameSync(this.stateFile+'.tmp',this.stateFile); }
  changed(t) { t.updatedAt = Date.now(); clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.persist(),250);this.emit('change',{taskId:t.id,task:t}); }
  desktopTask(t) {
    const normalize=p=>String(p||'').replaceAll('\\','/').replace(/\/$/,'').toLowerCase();
    const cwd=normalize(t.cwd);
    const inferred=t.projectId===undefined?(this.projectCache||[]).filter(p=>p.path&&(cwd===normalize(p.path)||cwd.startsWith(normalize(p.path)+'/'))).sort((a,b)=>b.path.length-a.path.length)[0]?.id:null;
    return {id:'desktop:'+t.id,toolId:'codex',title:t.title||'未命名会话',projectId:t.projectId||inferred||null,status:taskStatus(t.status),updatedAt:(t.updatedAt||0)*1000,source:'desktop',cwd:t.cwd||'',approvals:[],canApprove:false};
  }
  refreshDesktopList() {
    if (this.desktopListPending || Date.now()-(this.desktopListAt||0)<=30000) return;
    this.desktopListAt=Date.now();
    this.desktopListPending=this.desktop.call('list_threads',{limit:50}).then(r=>{
      const threads=[...(r.pinnedThreads||[]),...(r.threads||[])];
      this.desktopListed=threads.filter(t=>t.kind==='codex'&&(!t.hostId||t.hostId==='local')).map(t=>this.desktopTask(t));
      const hosts=this.remoteDesktop.registerRows(threads);
      if (!this.remoteHistoryPending && Date.now()-(this.remoteHistoryAt||0)>120000 && hosts.size) {
        this.remoteHistoryAt=Date.now();
        this.remoteHistoryPending=this.remoteDesktop.expand(this.desktop,hosts)
          .catch(()=>{}).finally(()=>this.remoteHistoryPending=null);
      }
    }).catch(()=>{}).finally(()=>this.desktopListPending=null);
  }
  async remoteRef(id) {
    if (!id.startsWith(remotePrefix)) return this.remoteDesktop.refs.get(id);
    if (!this.remoteDesktop.refs.has(id)) {
      this.refreshDesktopList();
      await this.desktopListPending;
      if (!this.remoteDesktop.refs.has(id)) await this.remoteHistoryPending;
    }
    const ref=this.remoteDesktop.refs.get(id);
    if (!ref) throw Object.assign(Error('远程会话当前不可用，请确认 Codex 桌面已连接该主机'),{status:404});
    return ref;
  }
  async list() {
    if(this.config.remoteDesktopSessions?.length && !this.remoteListPending && Date.now()-(this.remoteListAt||0)>15000){
      this.remoteListPending=Promise.all(this.config.remoteDesktopSessions.map(async ref=>{
        try{return await readRemoteDesktop(this.desktop,ref,{limit:1});}catch{return null;}
      })).then(rows=>{this.remoteListed=rows.filter(Boolean);this.remoteListAt=Date.now();}).finally(()=>this.remoteListPending=null);
    }
    if(!this.remoteListed && this.remoteListPending)await this.remoteListPending;
    // Global desktop listing can wait on an unrelated offline remote host.
    // Probe the local endpoint independently and keep local history responsive.
    try {await this.desktop.discover();this.desktopOk=true;}catch{this.desktopOk=false;}
    this.nativeOk=false;
    if(!this.desktopOk)try{await this.native.connect();this.nativeOk=true;}catch{}
    if(this.desktopOk)this.refreshDesktopList();
    const desktop=[...(this.desktopListed||[]),...(this.remoteListed||[]),...this.remoteDesktop.rows.values()];
    if(this.config.codexExecutable&&Date.now()-this.indexedAt>60000&&!this.indexPromise){
      this.indexPromise=this.loadIndex().catch(()=>{}).finally(()=>this.indexPromise=null);
    }
    const combined=new Map(this.indexed.map(t=>[t.id,t]));for(const t of desktop)combined.set(t.id,t);for(const t of this.nativeTasks.values())combined.set(t.id,t);this.summaries=combined;
    const other=await this.toolbox.list();
    // Other tools retain their own workspace identities; never borrow Codex projects.
    return {tasks:[...this.managed.values(),...this.cli.tasks.values(),...combined.values(),...other].sort((a,b)=>b.updatedAt-a.updatedAt),desktopOnline:this.desktopOk||this.nativeOk};
  }
  async loadIndex(){
    // Read every persisted native thread, independently of its model provider.
    try{await this.dispatch('projects');}catch{}
    await this.codex.start();const all=[];let cursor=null;const seen=new Set();
    do{
      const r=await this.codex.request('thread/list',{limit:100,cursor,sortKey:'updated_at',archived:false,modelProviders:[]});
      for(const t of r.data||[]){if(!this.managed.has(t.id))all.push(this.desktopTask({...t,title:t.name||t.preview?.slice(0,70)||'未命名会话'}));}
      cursor=r.nextCursor;if(cursor&&seen.has(cursor))break;if(cursor)seen.add(cursor);
    }while(cursor&&all.length<10000);
    this.indexed=all;this.indexedAt=Date.now();
  }
  async detail(id,cursor) {
    const remote=await this.remoteRef(id);
    if(remote)return readRemoteDesktop(this.desktop,remote,{cursor,limit:10});
    if(id.startsWith('cli:')){const t=this.cli.tasks.get(id);if(!t)throw new Error('任务不存在');return t;}
    if(id.startsWith('tool:')||id.startsWith('native:')){
      const task=await this.toolbox.detail(id);
      if(id.startsWith('native:deepseek:')){
        const requestId=this.dshCreations.requestForSession(this.toolbox.nativeRef(id).sessionId);
        if(requestId){const r=await this.dshCreations.inspect(requestId,task);task.creationRequestId=requestId;task.initialDelivery=r.initialDelivery;}
      }
      return task;
    }
    if (!id.startsWith('desktop:')) {
      const t=this.managed.get(id);if(!t)throw new Error('任务不存在');return t;
    }
    if(!cursor){
      if(this.desktopNavigation)try{await this.desktopNavigation.ensure(id.slice(8));}catch{}
      try{await this.native.snapshot(id.slice(8));const live=this.nativeTasks.get(id.slice(8));if(live)return live;}catch{}
    }
    let r;
    try{r=await this.desktop.call('read_thread',{threadId:id.slice(8),turnLimit:10,includeOutputs:true,maxOutputCharsPerItem:20000,...(cursor&&cursor!=='native-older'?{cursor}:{})});}
    catch(error){
      if(cursor)throw error;
      await this.codex.start();const stored=await this.codex.request('thread/read',{threadId:id.slice(8),includeTurns:true});
      if(stored.thread?.id!==id.slice(8))throw Error('返回的会话标识不匹配');
      const view=this.fromNative({...stored.thread,threadRuntimeStatus:stored.thread.status||'idle'});
      view.readOnly=true;view.canApprove=false;view.canInterrupt=false;view.approvals=[];view.syncMode='stored-thread';return view;
    }
    // A native snapshot can arrive while the fallback reader is awaiting IPC.
    // Never overwrite a newer stream snapshot with that older fallback response.
    if(!cursor&&this.native.states.has(id.slice(8))&&this.nativeTasks.has(id.slice(8)))return this.nativeTasks.get(id.slice(8));
    const t=this.desktopTask(r.thread);t.id=id;t.messages=[];t.nextCursor=r.page?.nextCursor;t.hasMore=!!r.page?.hasMore;
    for (const turn of [...(r.turns||[])].reverse()) {
      for (const item of turn.items||[]) {
        if(item.type==='userMessage') t.messages.push({id:item.id,role:'user',type:'text',text:item.text||(item.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n')});
        else if(item.type==='agentMessage') t.messages.push({id:item.id,role:'agent',type:'text',text:item.text||''});
        else if(item.type==='functionCallOutput'&&item.namespace==='codex_app'&&['create_thread','send_message_to_thread'].includes(item.name)){
          const text=String(item.output||'').match(/<input>([\s\S]*)<\/input>/)?.[1];if(text)t.messages.push({id:item.id,role:'user',type:'text',text});
        }
        else if(subagentMessage(item))t.messages.push(subagentMessage(item));
        else if(['commandExecution','toolCall','fileChange','webSearch'].includes(item.type)) t.messages.push({id:item.id,role:'agent',type:'step',title:item.command||item.tool||item.type,status:item.status,text:JSON.stringify(item,null,2)});
      }
    }
    if (r.turns?.[0]) t.status=taskStatus(r.turns[0].status);
    this.registerImages(t);return t;
  }
  fromNative(s){
    const t=this.desktopTask({...s,status:s.threadRuntimeStatus||'idle',updatedAt:Math.floor(Date.now()/1000)});
    const summary=this.summaries.get(t.id);t.projectId=summary?.projectId??t.projectId;t.title=s.title||summary?.title||t.title;
    t.messages=[];t.approvals=[];t.canApprove=true;t.syncMode='native-stream';t.permissions=permissionState(s);
    const canonical=s.turnHistory?.history;
    let turns=canonical?Object.values(canonical.entitiesByKey||{}):s.turns||[];
    turns=[...turns].sort((a,b)=>(a.turnStartedAtMs||0)-(b.turnStartedAtMs||0));
    for(const turn of turns){
      const firstMessage=t.messages.length;
      const items=Array.isArray(turn.items)?turn.items:[];
      // Some older desktop versions keep the opening user input only in params.
      if(!items.some(i=>i.type==='userMessage')&&turn.params?.input?.length)t.messages.push({id:turn.turnId+':input',role:'user',type:'text',text:turn.params.input.filter(i=>i.type==='text').map(i=>i.text).join('\n')});
      for(const item of items){
        const question=messageQuestions(item);if(question)t.approvals.push(question);
        if(item.type==='userMessage'||item.type==='steeringUserMessage')t.messages.push({id:item.id,role:'user',type:'text',text:item.text||(item.content||item.input||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n')});
        else if(item.type==='functionCallOutput'&&item.namespace==='codex_app'&&['create_thread','send_message_to_thread'].includes(item.name)){
          const text=String(item.output||'').match(/<input>([\s\S]*)<\/input>/)?.[1];if(text)t.messages.push({id:item.id,role:'user',type:'text',text});
        }
        else if(item.type==='agentMessage'&&item.text?.trim())t.messages.push({id:item.id,role:'agent',type:'text',text:item.text});
        else if(subagentMessage(item))t.messages.push(subagentMessage(item));
        else if(item.type==='reasoning'){
          const text=(item.summary||[]).map(v=>typeof v==='string'?v:v.text||'').join('\n');
          if(text)t.messages.push({id:item.id,role:'agent',type:'step',title:'思考摘要',text});
        }else if(['commandExecution','fileChange','webSearch','mcpToolCall','dynamicToolCall'].includes(item.type)){
          t.messages.push({id:item.id,role:'agent',type:'step',title:item.command||item.tool||item.type,status:item.status,text:(item.aggregatedOutput||JSON.stringify(item,null,2))});
        }
      }
      for(const m of t.messages.slice(firstMessage)){m.turnId=turn.turnId||'turn-'+turns.indexOf(turn);if(Number.isFinite(turn.durationMs))m.durationMs=turn.durationMs;}
    }
    const answered=answeredMessageQuestions(t.messages);
    t.approvals=t.approvals.map(a=>({...a,questions:a.questions.filter(q=>!answered.has(q.id))})).filter(a=>a.questions.length);
    const last=turns.at(-1);if(last){t.status=taskStatus(last.status);t.error=last.error?.message;t.turnId=last.turnId;}
    for(const request of s.requests||[]){
      const a=interaction(request);if(a)t.approvals.push(a);
    }
    if(t.approvals.some(a=>a.blocking!==false))t.status='AwaitingApproval';
    t.canInterrupt=!!t.turnId&&['Running','AwaitingApproval'].includes(t.status);
    t.hasMore=canonical?!canonical.isComplete:!!s.turnsPagination?.hasMore;
    // Fallback history reader supplies a cursor when the native view is partial.
    t.nextCursor=t.hasMore?'native-older':null;
    this.registerImages(t);return t;
  }
  registerImages(t) {
    for(const m of [...(t.messages||[])]) {
      if(m.type!=='text'||m.role!=='agent')continue;
      const matches=[...(m.text||'').matchAll(/!\[[^\]]*\]\(([^)]+\.(?:png|jpg|jpeg|webp))\)/gi)];
      for(const match of matches){
        const file=match[1];if(!path.isAbsolute(file)||!fs.existsSync(file))continue;
        const key=crypto.createHash('sha256').update(file).digest('hex');this.images.set(key,file);
        const imageId=m.id+':'+key;if(!t.messages.some(x=>x.id===imageId))t.messages.push({id:imageId,role:'agent',type:'image',imagePath:'/api/images/'+this.config.id+'/'+key,text:'Agent 截图'});
      }
    }
  }
  async create({instruction,projectId,mode,toolId,model,effort,requestId}) {
    if(this.toolWake&&mode!=='managed'&&['codex','deepseek'].includes(toolId||'codex'))await this.ensureTool(toolId||'codex');
    if(toolId==='deepseek'){
      if(mode==='managed'||model||effort)throw Error('DSH 新建沿用原桌面账号和默认模型，不使用独立执行进程或模型覆盖');
      const project=(await this.dispatch('projects')).find(p=>p.id===projectId&&p.toolId==='deepseek');
      if(!project?.path)throw Error('请选择 DSH 已识别的真实工作目录');
      if(!requestId)throw Error('DSH 新建需要持久请求号，请更新客户端');
      const result=await this.dshCreations.createAndPrompt({cwd:project.path,instruction,requestId});
      if(!result.sessionId)throw Object.assign(Error('原生新建结果尚未确认，请恢复原请求，不要重复创建'),{status:409});
      return {id:'native:deepseek:'+encodeURIComponent(result.sessionId),toolId:'deepseek',source:'desktop',cwd:project.path,projectId,title:instruction.slice(0,48),status:'Pending',initialDelivery:result.initialDelivery,creationRequestId:requestId,messages:[],updatedAt:Date.now()};
    }
    if(['claude-desktop','zcode'].includes(toolId))throw new Error('请先在电脑桌面新建对话，再在手机中打开并继续');
    if(toolId&&toolId!=='codex'){
      throw new Error('当前仅支持继续桌面原会话；不会新建独立命令行任务');
    }
    if(mode!=='managed') {
      if(process.platform==='darwin'&&!this.desktop.pipe){
        try{await this.desktop.discover();}catch{
          if(!this.macNavigation)throw new Error('Mac 桌面接入不可用');
          if(model||effort)throw new Error('辅助新建沿用电脑当前模型，请先清除手机的新建模型覆盖设置');
          let cwd=this.config.workspace;
          if(projectId){const projects=await this.dispatch('projects');const project=projects.find(p=>p.id===projectId);if(!project?.path)throw new Error('项目不存在或无可用本机路径');cwd=project.path;}
          const created=await this.macNavigation.create(instruction,cwd);
          return this.nativeTasks.get(created.id)||{...this.desktopTask(created),messages:[],approvals:[]};
        }
      }
      // Default: create inside the REAL desktop, preserving its provider and project.
      const target=projectId?{type:'project',projectId,environment:{type:'local'}}:{type:'projectless'};
      if(projectId){const projects=await this.dispatch('projects');if(!projects.some(p=>p.id===projectId))throw new Error('项目不存在或不属于本机');}
      if(model){const models=await this.controls.catalog();if(!models.some(m=>m.id===model&&(!effort||m.efforts.includes(effort))))throw new Error('模型或思考强度不属于当前电脑');}
      const r=await this.desktop.call('create_thread',{prompt:instruction,target,...(model?{model}:{}),...(effort?{thinking:effort}:{})},requestId);
      const id=r.threadId||r.thread?.id;
      if(!id)throw new Error('桌面已收到新建请求，但尚未返回会话标识；请刷新列表，不要重复提交');
      return {id:'desktop:'+id,title:instruction.slice(0,48),projectId,status:'Running',source:'desktop',messages:[],approvals:[],canApprove:false,updatedAt:Date.now()};
    }
    await this.codex.start();
    const r=await this.codex.request('thread/start',{cwd:this.config.workspace,approvalPolicy:'untrusted',sandbox:'workspace-write'});
    const id=r.thread.id;const t={id,title:instruction.slice(0,48),status:'Pending',source:'managed',cwd:this.config.workspace,messages:[],approvals:[],canApprove:true,updatedAt:Date.now()};
    this.managed.set(id,t);this.loaded.add(id);this.changed(t);
    await this.send(id,{instruction});return t;
  }
  async send(id,{instruction,requestId}) {
    if(this.toolWake&&id.startsWith('desktop:'))await this.ensureTool('codex');
    else if(this.toolWake&&id.startsWith('native:'))await this.ensureTool(id.split(':')[1]);
    if(id.startsWith('native:'))return this.toolbox.send(id,instruction,id.startsWith('native:deepseek:')&&requestId?nativeCreationId(requestId):undefined);
    if(id.startsWith('cli:'))return this.cli.send(id,instruction);
    if(id.startsWith('desktop:')) {
      const options=this.controls.pending[id];
      // Use the desktop's existing follower protocol when app-tools rejects
      // third-party clients. Never replay an ambiguous tool send as a follower.
      if(!this.desktop.pipe){
        try{await this.desktop.discover();}catch{
          if(this.desktopNavigation)await this.desktopNavigation.ensure(id.slice(8));
          if(options){
            const applied=await this.native.control(id.slice(8),'thread-follower-update-thread-settings',{threadSettings:options},2);
            if(applied?.applied===false)throw new Error('桌面尚未应用所选模型设置，请在电脑确认后重试');
          }
          return this.native.send(id.slice(8),instruction);
        }
      }
      await this.desktop.call('send_message_to_thread',{threadId:id.slice(8),prompt:instruction,...(options?.model?{model:options.model}:{}),...(options?.effort?{thinking:options.effort}:{})});
      return {accepted:true};
    }
    const t=this.managed.get(id);if(!t)throw new Error('任务不存在');
    if(['Running','AwaitingApproval'].includes(t.status))throw new Error('此任务仍在执行或等待审批');
    await this.codex.start();
    if(!this.loaded.has(id)){await this.codex.request('thread/resume',{threadId:id,approvalPolicy:'untrusted',sandbox:'workspace-write'});this.loaded.add(id);}
    t.messages.push({id:crypto.randomUUID(),role:'user',type:'text',text:instruction});t.status='Running';t.error=null;this.changed(t);
    try {const r=await this.codex.request('turn/start',{threadId:id,input:[{type:'text',text:instruction,text_elements:[]}],approvalPolicy:'untrusted'});t.turnId=r.turn.id;this.changed(t);return {accepted:true};}
    catch(e){t.status='Failed';t.error=e.message;this.changed(t);throw e;}
  }
  async approve(id,{approvalId,decision,answers}) {
    if(id.startsWith('desktop:')){
      const raw=id.slice(8);const state=this.native.states.get(raw)?.value;
      if(!state)throw new Error('实时会话已断开，请重新连接');
      const t=this.fromNative(state);const a=t.approvals.find(a=>a.id===approvalId);
      if(!a)throw new Error('审批已失效或不属于当前任务');
      if(a.source==='message-questions'){
        const validated=validateAnswers(a.questions,answers);
        const replies=a.questions.map(q=>({questionItemId:q.id,question:q.question,answer:validated.answers[q.id].answers[0]}));
        return this.native.send(raw,'<send_user_message_question_reply>\n'+JSON.stringify(replies)+'\n</send_user_message_question_reply>');
      }
      if(a.kind==='user-input')return this.native.control(raw,'thread-follower-submit-user-input',{requestId:a.rpcId,response:validateAnswers(a.questions,answers)},1);
      if(!['accept','decline'].includes(decision))throw new Error('审批决定无效');
      if(a.kind==='permissions')return this.native.control(raw,'thread-follower-permissions-request-approval-response',{requestId:a.rpcId,response:{permissions:decision==='accept'?a.permissions:{},scope:'turn'}},1);
      return this.native.approve(raw,a.rpcId,decision,a.kind);
    }
    const t=this.managed.get(id);const a=t?.approvals.find(a=>a.id===approvalId);
    if(!a||a.resolved)throw new Error('审批已失效或不属于当前任务');
    if(a.kind==='user-input'){this.codex.respond(a.rpcId,validateAnswers(a.questions,answers));a.resolved='answered';t.status=t.approvals.some(x=>!x.resolved&&x.blocking!==false)?'AwaitingApproval':'Running';this.changed(t);return {accepted:true};}
    if(!['accept','decline'].includes(decision))throw new Error('审批决定无效');
    this.codex.respond(a.rpcId,a.kind==='permissions'?{permissions:decision==='accept'?a.permissions:{},scope:'turn'}:{decision});a.resolved=decision;
    t.status=t.approvals.some(x=>!x.resolved)?'AwaitingApproval':'Running';this.changed(t);return {accepted:true};
  }
  async interrupt(id,expectedTurnId) {
    if(id.startsWith('desktop:')){
      const raw=id.slice(8),state=await this.native.snapshot(raw);
      const task=this.fromNative(state);
      if(!['Running','AwaitingApproval'].includes(task.status)||!task.turnId)throw Error('当前原会话没有可停止的运行轮次');
      if(expectedTurnId!==undefined&&expectedTurnId!==task.turnId)throw Error('运行轮次已变化，请刷新后再停止');
      const result=await this.native.control(raw,'thread-follower-interrupt-turn',{mode:'user-stop',expectedTurnId:task.turnId},4);
      if(result?.ok!==true||result.interruptedTurnId!==task.turnId)throw Error('桌面尚未确认停止此轮任务，请刷新后核对');
      return {accepted:true,interruptedTurnId:result.interruptedTurnId};
    }
    const t=this.managed.get(id);if(!t?.turnId)throw new Error('当前任务不可停止');await this.codex.request('turn/interrupt',{threadId:id,turnId:t.turnId});return {accepted:true};
  }
  onEvent(m) {
    const p=m.params||{};const t=this.managed.get(p.threadId);if(!t)return;
    if(m.id!==undefined){
      const a=interaction(m);if(a) {
        t.approvals.push(a);if(a.blocking!==false)t.status='AwaitingApproval';
      } else {this.codex.write({id:m.id,error:{code:-32601,message:'当前移动端不支持此交互，请使用桌面端'}});t.messages.push({id:crypto.randomUUID(),role:'agent',type:'text',text:'当前交互暂不受移动端支持，已拒绝继续操作：'+m.method});}
    } else if(m.method==='turn/started'){t.status='Running';t.turnId=p.turn.id;}
    else if(m.method==='turn/completed'){t.status=taskStatus(p.turn.status);t.error=p.turn.error?.message;t.approvals=t.approvals.map(a=>({...a,resolved:a.resolved||'expired'}));}
    else if(m.method==='error'){t.error=p.error?.message||'Codex 执行错误';}
    else if(m.method.endsWith('/delta')) {
      const id=p.itemId||p.turnId+':'+m.method;let item=t.messages.find(x=>x.id===id);
      if(!item){item={id,role:'agent',type:m.method.includes('agentMessage')?'text':'step',title:m.method.includes('reasoning')?'思考摘要':'执行输出',text:''};t.messages.push(item);}
      item.text+=(p.delta||'');
    } else if(['item/started','item/completed'].includes(m.method)) {
      const i=p.item;if(!i)return;let item=t.messages.find(x=>x.id===i.id);
      if(i.type==='userMessage')return;
      const val={id:i.id,role:'agent',type:i.type==='agentMessage'?'text':'step',title:i.command||i.type,status:i.status,text:i.text||i.aggregatedOutput||JSON.stringify(i,null,2)};
      if(item)Object.assign(item,val);else t.messages.push(val);
    }
    this.registerImages(t);this.changed(t);
  }
  async ensureTool(tool){
    const result=await this.toolWake.prepare(tool);
    if(!result.ready)throw Object.assign(Error(result.message||'原应用尚未就绪'),{status:503});
    this.toolbox.at=0;await this.toolbox.list();return result;
  }
  async dispatch(method,args={}) {
    const remoteOnly=typeof args.id==='string' &&
      (args.id.startsWith(remotePrefix)||this.remoteDesktop.refs.has(args.id));
    if(method==='prepareTool'){
      const result=await this.toolWake.prepare(args.toolId);
      if(result.ready){this.toolbox.at=0;await this.toolbox.list();}return result;
    }
    if(method==='prepareSession'){
      if(remoteOnly)return {ready:false,state:'remote_observe_only'};
      const tool=args.id.startsWith('desktop:')?'codex':/^native:(deepseek|kimi|claude-desktop|zcode):/.exec(args.id)?.[1];
      return tool?this.ensureTool(tool):{ready:false,state:'history_only'};
    }
    if(remoteOnly&&
      ['send','approve','interrupt','settings','queue','goal','sideChat','controls'].includes(method))throw Error('远端 Worker 当前仅观察，请使用原会话继续工作');
    if(method==='messageStatus'){
      if(!args.id.startsWith('native:deepseek:'))throw Error('仅支持 DSH 原会话');
      const task=await this.toolbox.nativeDetail(args.id);
      return {acknowledged:task.submittedRequests?.includes(nativeCreationId(args.requestId))===true};
    }
    if(method==='creationStatus'){
      const r=await this.dshCreations.inspect(args.requestId),record=this.dshCreations.read(args.requestId);
      return {...r,task:r.sessionId?{id:'native:deepseek:'+encodeURIComponent(r.sessionId),toolId:'deepseek',source:'desktop',cwd:record.cwd,status:'Pending',initialDelivery:r.initialDelivery,creationRequestId:args.requestId,updatedAt:Date.now()}:null};
    }
    // Router reads never navigate windows or restore a transcript in a new
    // Agent process. Writes preserve the exact native conversation and settings.
    if(method==='routerInspect'){
      const remote=await this.remoteRef(args.id);
      if(remote)return readRemoteDesktop(this.desktop,remote);
      if(args.id.startsWith('native:')){const ref=this.toolbox.nativeRef(args.id),before=this.toolbox.bridge.identity(ref.toolId),t=await this.toolbox.detail(args.id);if(before!==this.toolbox.bridge.identity(ref.toolId))throw Error('Native instance changed');return {...t,instance:before};}
      if(!args.id.startsWith('desktop:'))throw Error('Router requires an original desktop session');
      const raw=args.id.slice(8);
      try{await this.desktop.discover();}catch{}
      try{return {...this.fromNative(await this.native.snapshot(raw)),instance:this.desktop.pipe?crypto.createHash('sha256').update(this.desktop.pipe).digest('hex'):this.native.owners.get(raw)};}catch{}
      const r=await this.desktop.call('read_thread',{threadId:raw,hostId:'local',turnLimit:5,includeOutputs:false});
      if(r.thread?.id!==raw)throw Error('Native session identity mismatch');
      const task=this.desktopTask(r.thread);task.messages=[];
      for(const turn of [...(r.turns||[])].reverse())for(const item of turn.items||[]){
        if(['userMessage','agentMessage'].includes(item.type))task.messages.push({id:item.id,role:item.type==='userMessage'?'user':'agent',text:item.text||(item.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n')});
      }
      if(r.turns?.[0]){task.status=taskStatus(r.turns[0].status);task.turnId=r.turns[0].id;}
      task.instance=crypto.createHash('sha256').update(this.desktop.pipe||'').digest('hex');return task;
    }
    if(method==='routerSend'){
      if(remoteOnly)throw Error('Remote Worker is observation-only; use its original conversation for execution');
      if(args.id.startsWith('native:')){const ref=this.toolbox.nativeRef(args.id);if(args.expectedGeneration&&args.expectedGeneration!==this.toolbox.bridge.identity(ref.toolId))throw Error('Native instance changed');return this.toolbox.send(args.id,args.instruction,args.requestId);}
      if(!args.id.startsWith('desktop:'))throw Error('Router requires an original desktop session');
      if(args.expectedGeneration){const current=await this.dispatch('routerInspect',{id:args.id});if(current.instance!==args.expectedGeneration)throw Error('Native instance changed');}
      // Never change the selected model, start SDK resume, or navigate a window.
      await this.desktop.call('send_message_to_thread',{threadId:args.id.slice(8),hostId:'local',prompt:args.instruction},args.requestId);
      return {accepted:true,requestId:args.requestId};
    }
    if(method==='tools'){
      const tools=await this.toolbox.tools();
      if(process.platform!=='darwin')return tools;
      let desktopReady=false,nativeReady=false;
      try{await this.desktop.discover();desktopReady=true;}catch{}
      if(!desktopReady)try{await this.native.connect();nativeReady=true;}catch{}
      const canCreate=nativeReady&&await this.macNavigation?.capability();
      return tools.map(t=>t.id==='codex'?{...t,capabilities:{...t.capabilities,send:desktopReady||nativeReady,create:desktopReady||!!canCreate},note:desktopReady?t.note:nativeReady?'已连接桌面原会话；支持自动载入。新建需在 Mac 首次授权辅助功能（预览）':'请打开电脑 Codex 后刷新连接'}:t);
    }
    if(method==='models')return this.controls.catalog();
    if(method==='usage')return this.usageQueries.read(args.toolId);
    if(method==='controls')return this.controls.read(args.id);
    if(method==='sideChat')return this.controls.sideChat(args.id);
    if(method==='settings')return this.controls.settings(args.id,args);
    if(method==='queue')return this.controls.queue(args.id,args);
    if(method==='goal')return this.controls.goal(args.id,args);
    if(method==='projects'){
      try {
        const r=await this.desktop.call('list_projects',{});
        const all=Array.isArray(r)?r:[...(r.projects||[]),...(r.localProjects||[])];
        this.projectCache=all.filter(p=>(!p.hostId||p.hostId==='local')&&p.projectKind!=='chatgpt').map(p=>({id:p.projectId||p.id,toolId:'codex',name:p.label||p.name||p.title||p.path||'项目',path:p.path||p.cwd||''}));
      } catch { this.projectCache=[]; }
      const workspaces=new Map();
      for(const t of await this.toolbox.list())if(t.projectId&&t.cwd)workspaces.set(t.projectId,{id:t.projectId,toolId:t.toolId,name:path.basename(t.cwd.replaceAll('\\','/'))||t.cwd,path:t.cwd});
      return [...this.projectCache,...workspaces.values()];
    }
    if(method==='list')return this.list();
    if(method==='detail')return this.detail(args.id,args.cursor);
    if(method==='create')return this.create(args);
    if(method==='send')return this.send(args.id,args);
    if(method==='approve')return this.approve(args.id,args);
    if(method==='interrupt')return this.interrupt(args.id,args.expectedTurnId);
    if(method==='image'){
      const file=this.images.get(args.key);if(!file)throw new Error('图片不可用，请重新加载所属会话');
      const stat=fs.statSync(file);if(stat.size>12*1024*1024)throw new Error('图片超过 12 MB');
      return {data:fs.readFileSync(file).toString('base64'),mime:({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'})[path.extname(file).toLowerCase()]};
    }
    throw new Error('不支持的操作');
  }
}
