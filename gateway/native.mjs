import {socketCandidates} from './platform-sockets.mjs';
import net from 'node:net';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';

// Optional desktop follower protocol. This attaches to the running desktop's
// in-memory conversation, including partial text; it never takes task ownership.
export class NativeFollower extends EventEmitter {
  constructor({requestTimeout=5000,snapshotTimeout=3000}={}){super();this.requestTimeout=requestTimeout;this.snapshotTimeout=snapshotTimeout;}
  socket=null;clientId='initializing-client';pending=new Map();states=new Map();owners=new Map();watched=new Set();ready=null;
  async connect(){
    if(this.ready)return this.ready;
    this.ready=new Promise((resolve,reject)=>{
      const endpoint=socketCandidates('native')[0];if(!endpoint){reject(new Error('未发现桌面实时连接接口'));queueMicrotask(()=>this.ready=null);return;}
      const socket=net.connect(endpoint);this.socket=socket;let buffer=Buffer.alloc(0);
      socket.on('connect',async()=>{try{const r=await this.request('initialize',{clientType:'mydex-mobile'},0);this.clientId=r.result.clientId;resolve();}catch(e){reject(e);socket.destroy();}});
      socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4){const n=buffer.readUInt32LE(0);if(n>64*1024*1024||n===0){socket.destroy();return;}if(buffer.length<n+4)return;const raw=buffer.subarray(4,n+4);buffer=buffer.subarray(n+4);try{this.message(JSON.parse(raw));}catch{}}});
      socket.on('error',e=>reject(e));
      socket.on('close',()=>{reject(new Error('Desktop stream disconnected'));this.ready=null;this.socket=null;this.states.clear();this.owners.clear();this.watched.clear();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Desktop stream disconnected'));}this.pending.clear();this.emit('disconnected');});
    });return this.ready;
  }
  write(m){if(!this.socket?.writable)throw new Error('Desktop stream disconnected');const b=Buffer.from(JSON.stringify(m));const h=Buffer.alloc(4);h.writeUInt32LE(b.length);this.socket.write(Buffer.concat([h,b]));}
  request(method,params,version=1,targetClientId){
    const requestId=crypto.randomUUID();return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new Error('Desktop stream timed out'));},this.requestTimeout);
      this.pending.set(requestId,{resolve,reject,timer});
      try{this.write({type:'request',requestId,sourceClientId:this.clientId,method,params,version,targetClientId,timeoutMs:Math.max(200,this.requestTimeout-500)});}catch(e){clearTimeout(timer);this.pending.delete(requestId);reject(e);}
    });
  }
  broadcast(method,params,targetClientIds){this.write({type:'broadcast',sourceClientId:this.clientId,method,params,version:1,targetClientIds});}
  async watch(id){
    await this.connect();if(this.watched.has(id))return;
    if(this.watched.size>=8){const oldest=this.watched.values().next().value;this.broadcast('thread-stream-following-changed',{hostId:'local',conversationId:oldest,following:false},[this.owners.get(oldest)]);this.watched.delete(oldest);this.states.delete(oldest);this.owners.delete(oldest);}
    const r=await this.request('thread-owner-discovery',{hostId:'local',conversationId:id});
    if(r.resultType!=='success'||!r.handledByClientId)throw new Error('Conversation has no active desktop owner');
    this.owners.set(id,r.handledByClientId);this.watched.add(id);
    this.broadcast('thread-stream-following-changed',{hostId:'local',conversationId:id,following:true},[r.handledByClientId]);
  }
  message(m){
    if(m.type==='response'){const p=this.pending.get(m.requestId);if(p){clearTimeout(p.timer);this.pending.delete(m.requestId);p.resolve(m);}return;}
    if(m.type==='client-discovery-request'){this.write({type:'client-discovery-response',requestId:m.requestId,response:{canHandle:false}});return;}
    if(m.type!=='broadcast'||(m.targetClientIds&&!m.targetClientIds.includes(this.clientId)))return;
    const p=m.params||{};
    if(m.method==='thread-stream-following-status-requested'&&this.watched.has(p.conversationId)){this.broadcast('thread-stream-following-changed',{...p,following:true},[m.sourceClientId]);return;}
    if(m.method!=='thread-stream-state-changed'||!this.watched.has(p.conversationId))return;
    const change=p.change;let state=this.states.get(p.conversationId);
    if(change?.type==='snapshot')state={revision:change.revision,value:change.conversationState};
    else if(change?.type==='patches'&&state&&state.revision===change.baseRevision){
      try{for(const patch of change.patches||[])state.value=applyPatch(state.value,patch);state.revision=change.revision;}catch{state=null;}
    }else state=null;
    if(state){this.states.set(p.conversationId,state);this.emit('state',{id:p.conversationId,state:state.value});}
    else{this.states.delete(p.conversationId);this.watched.delete(p.conversationId);void this.watch(p.conversationId).catch(()=>{});}
  }
  async approve(id,requestId,decision,kind){
    await this.watch(id);const method=kind==='file'?'thread-follower-file-approval-decision':'thread-follower-command-approval-decision';
    const r=await this.request(method,{conversationId:id,requestId,decision},1,this.owners.get(id));
    if(r.resultType!=='success')throw new Error(r.error||'Approval not acknowledged');return {accepted:true};
  }
  async control(id,method,params={},version=1){
    await this.watch(id);
    const r=await this.request(method,{conversationId:id,...params},version,this.owners.get(id));
    if(r.resultType!=='success'){
      if(/request-version-mismatch/i.test(r.error||''))throw new Error('当前 Codex 桌面与此操作的协议版本不兼容，请更新 Codex 后重试；未切换到其他执行进程');
      throw new Error(r.error||'当前桌面版本不支持此操作');
    }
    return r.result?.result??r.result;
  }
  async snapshot(id){
    await this.watch(id);
    if(this.states.has(id))return this.states.get(id).value;
    return new Promise((resolve,reject)=>{
      const done=()=>{clearTimeout(timer);this.off('state',onState);this.off('disconnected',onDisconnect);};
      const onState=e=>{if(e.id===id){done();resolve(e.state);}};
      const onDisconnect=()=>{done();reject(new Error('Desktop stream disconnected'));};
      const timer=setTimeout(()=>{done();reject(new Error('请先在电脑 Codex 中打开这条对话，再在手机刷新'));},this.snapshotTimeout);
      this.on('state',onState);
      this.once('disconnected',onDisconnect);
    });
  }
  async send(id,text){
    const state=await this.snapshot(id);
    const input=[{type:'text',text,text_elements:[]}];
    const status=typeof state.threadRuntimeStatus==='string'?state.threadRuntimeStatus:state.threadRuntimeStatus?.type;
    if(['active','running','inProgress'].includes(status)){
      await this.control(id,'thread-follower-steer-turn',{input,restoreMessage:{context:{}},clientUserMessageId:crypto.randomUUID()},1);
    }else if(['idle','completed'].includes(status)){
      await this.control(id,'thread-follower-start-turn',{turnStart:{request:{threadId:id,input},context:{inheritThreadSettings:true}}},2);
    }else throw new Error('桌面对话状态尚未就绪或正在等待审批，请在电脑确认后重试');
    return {accepted:true};
  }
  close(){this.socket?.destroy();}
}

// Immer patches use array paths. Reject prototype keys even though the producer is local.
export function applyPatch(root,p){
  const keys=Array.isArray(p.path)?p.path:String(p.path).split('/').slice(1).map(x=>x.replaceAll('~1','/').replaceAll('~0','~'));
  if(keys.some(k=>['__proto__','prototype','constructor'].includes(String(k))))throw new Error('Invalid patch');
  if(!keys.length)return p.op==='remove'?null:p.value;
  let obj=root;for(const k of keys.slice(0,-1)){if(obj==null)throw new Error('Invalid patch path');obj=obj[k];}
  const key=keys.at(-1);if(p.op==='remove'){if(Array.isArray(obj))obj.splice(Number(key),1);else delete obj[key];}
  else if(p.op==='add'&&Array.isArray(obj)){if(key==='-')obj.push(p.value);else obj.splice(Number(key),0,p.value);}
  else if(p.op==='add'||p.op==='replace')obj[key]=p.value;else throw new Error('Unknown patch');
  return root;
}
