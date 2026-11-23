import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {permissionState,permissionPreset} from './permissions.mjs';
import {savedSideChats} from './saved-side-chats.mjs';

// PC-only control adapter. Values come from this host, never a mobile model list.
export class Controls {
  constructor(adapter){this.adapter=adapter;this.cached=null;this.at=0;this.pendingFile=path.join(adapter.config.dataDir,'thread-settings.json');this.pending=fs.existsSync(this.pendingFile)?JSON.parse(fs.readFileSync(this.pendingFile)):{};}
  async rpc(method,params){await this.adapter.codex.start();return this.adapter.codex.request(method,params);}
  async catalog(){
    if(this.cached&&Date.now()-this.at<60000)return this.cached;
    const r=await this.rpc('model/list',{includeHidden:false,limit:100});
    this.cached=(r.data||[]).map(m=>({id:m.model||m.id,name:m.displayName||m.model||m.id,
      efforts:(m.supportedReasoningEfforts||[]).map(e=>e.reasoningEffort),
      defaultEffort:m.defaultReasoningEffort,isDefault:m.isDefault,
      serviceTiers:m.serviceTiers||[],fast:(m.serviceTiers||[]).some(t=>t.id==='priority')||(m.additionalSpeedTiers||[]).includes('fast')}));
    this.at=Date.now();return this.cached;
  }
  raw(id){if(!id.startsWith('desktop:'))throw new Error('此工具暂不支持 Codex 会话控制');return id.slice(8);}
  async read(id){
    const raw=this.raw(id);await this.adapter.detail(id);
    const s=this.adapter.native.states.get(raw)?.value;
    const result={model:s?.latestModel||this.pending[id]?.model||null,effort:s?.latestReasoningEffort||this.pending[id]?.effort||null,
      fast:s?.latestThreadSettings?.serviceTier==='priority',goal:s?.threadGoal||null,queue:[],permissions:permissionState(s),
      sideChats:[],sideChatCreateNote:'当前连接可读取已保存侧聊；手机新建原生侧聊尚未打通。',capabilities:{settings:true,fastSettings:!!s,goal:false,queue:false,sideChats:false,sideChatCreate:false}};
    const sides=new Map();
    await Promise.all([
      this.rpc('thread/goal/get',{threadId:raw}).then(r=>{result.goal=r.goal;result.capabilities.goal=true;}).catch(()=>{}),
      this.rpc('thread/queue/list',{threadId:raw,limit:100}).then(r=>{result.queue=(r.data||[]).map(q=>({id:q.id,text:(q.input||[]).filter(i=>i.type==='text').map(i=>i.text).join('\n')}));result.capabilities.queue=true;}).catch(()=>{}),
      Promise.resolve().then(()=>{const r=(this.adapter.savedSideChats||savedSideChats)(raw);for(const t of r.data)if(t.parentId===raw&&t.id!==raw)sides.set(t.id,t);result.capabilities.sideChats=r.supported;result.sideChatsHasMore=r.hasMore;}).catch(()=>{}),
      Promise.resolve(this.adapter.liveSideChats?.list(raw)||[]).then(rows=>{for(const t of rows)if(t.parentId===raw&&t.id!==raw)sides.set(t.id,t);if(rows.length)result.capabilities.sideChats=true;}).catch(()=>{})
    ]);
    result.sideChats=[...sides.values()];
    result.sideChatsParentId=raw;
    return result;
  }
  async settings(id,b){
    if(b.permissionMode!==undefined){
      const raw=this.raw(id),patch=permissionPreset(b.permissionMode,b.confirmed);
      if(this.adapter.macNavigation)await this.adapter.macNavigation.ensure(raw);
      const state=await this.adapter.native.snapshot(raw);
      const previous=state.latestThreadSettings||{};
      const threadSettings={...previous,...patch};delete threadSettings.permissions;
      const r=await this.adapter.native.control(raw,'thread-follower-update-thread-settings',{threadSettings},2);
      if(r?.applied!==true)throw Error('电脑未确认权限修改，请刷新后核对');
      return {accepted:true,appliedToDesktop:true,nextTurn:true,message:'已保存到桌面，后续消息使用此权限模式'};
    }
    const raw=this.raw(id),models=await this.catalog();
    const model=models.find(m=>m.id===b.model);if(!model)throw new Error('所选模型不在这台电脑的模型列表中');
    if(b.effort&&!model.efforts.includes(b.effort))throw new Error('该模型不支持所选思考强度');
    if(b.fast===true&&!model.fast)throw new Error('该模型没有提供快速模式');
    const threadSettings={model:model.id,effort:b.effort||model.defaultEffort,serviceTier:b.fast?'priority':null};
    let applied=false;
    try{const r=await this.adapter.native.control(raw,'thread-follower-update-thread-settings',{threadSettings},2);applied=r?.applied!==false;}
    catch(e){if(!/no active desktop owner|no-client-found|not being streamed/i.test(e.message))throw e;if(b.fast)throw new Error('此会话未在桌面载入，先发送一条消息后再启用快速模式');}
    this.pending[id]=threadSettings;fs.mkdirSync(path.dirname(this.pendingFile),{recursive:true});fs.writeFileSync(this.pendingFile,JSON.stringify(this.pending));
    return {accepted:true,appliedToDesktop:applied,...threadSettings};
  }
  async sideChat(id){
    const raw=this.raw(id);
    await this.rpc('thread/list',{attachedToThreadId:raw,limit:1,modelProviders:[]});
    let r;
    try{r=await this.rpc('thread/fork',{threadId:raw,attachToSource:true,excludeTurns:true,developerInstructions:'This is a side chat connected to the source conversation. Answer the user’s side questions. Do not continue the source task or execute its pending work unless the user explicitly asks in this side chat.'});}
    catch(e){if(/active writer/i.test(e.message))throw Error('该会话正由 Codex 桌面管理，当前连接接口暂不支持从手机新建侧聊；请在桌面创建后从手机侧聊列表打开。');throw e;}
    if(!r.thread?.id)throw Error('桌面尚未确认侧聊标识，请刷新侧聊列表，不要重复创建');
    return {id:r.thread.id,parentId:raw,title:r.thread.name||'侧聊'};
  }
  async queue(id,b){
    const threadId=this.raw(id);
    if(b.action==='add'){
      if(typeof b.instruction!=='string'||!b.instruction.trim()||b.instruction.length>50000)throw new Error('请输入队列指令');
      return this.rpc('thread/queue/add',{threadId,clientUserMessageId:crypto.randomUUID(),input:[{type:'text',text:b.instruction.trim(),text_elements:[]}]});
    }
    const r=await this.rpc('thread/queue/list',{threadId,limit:100});
    if(!r.data?.some(q=>q.id===b.queueId))throw new Error('队列项不存在或不属于当前会话');
    if(b.action==='remove')return this.rpc('thread/queue/delete',{threadId,queuedSubmissionId:b.queueId});
    throw new Error('不支持的队列操作');
  }
  async goal(id,b){
    const threadId=this.raw(id);
    if(b.action==='clear')return this.rpc('thread/goal/clear',{threadId,origin:'user'});
    if(!['active','paused','complete'].includes(b.status))throw new Error('目标状态无效');
    const p={threadId,status:b.status,origin:'user'};
    if(b.objective!==undefined){if(typeof b.objective!=='string'||!b.objective.trim()||b.objective.length>4000)throw new Error('目标需要 1–4000 字');p.objective=b.objective.trim();}
    if(b.tokenBudget!==undefined&&b.tokenBudget!==null){if(!Number.isSafeInteger(b.tokenBudget)||b.tokenBudget<=0)throw new Error('预算必须是正整数');p.tokenBudget=b.tokenBudget;}
    const previous=await this.rpc('thread/goal/get',{threadId}).catch(()=>({goal:null}));
    let result;
    try{result=await this.rpc('thread/goal/set',p);}
    catch(e){
      // Preserve the original writer; ask its agent to apply this user request.
      if(!/active writer/i.test(e.message))throw e;
      await this.adapter.desktop.call('send_message_to_thread',{threadId,prompt:'手机端用户请求更新本会话的原生目标。请求数据：'+JSON.stringify({objective:p.objective,status:p.status,tokenBudget:p.tokenBudget})+'。请读取原生目标，使用原生目标工具落实这个明确请求；不要创建其他会话。若状态为 paused，仅保存/暂停目标，不执行目标内容。请简短报告实际结果。'});
      return {accepted:true,pending:true,message:'目标变更已发送到原桌面对话，等待电脑确认'};
    }
    if(b.status==='active'&&previous.goal?.status!=='active'){
      const t=await this.adapter.detail(id);
      if(t.status!=='Running'&&t.status!=='AwaitingApproval')await this.adapter.desktop.call('send_message_to_thread',{threadId,prompt:'请继续执行当前已设置的目标：'+result.goal.objective+'。请根据实际进展更新原生目标状态，完成时将目标标记完成。'});
    }
    return result;
  }
}
