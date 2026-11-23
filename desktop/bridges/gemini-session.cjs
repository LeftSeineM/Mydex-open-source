'use strict';
const os=require('node:os'),path=require('node:path');
const {startSessionServer}=require('./session-server.cjs');
let view,started,pending=false,lastError='';
function session(){return {sessionId:view.config.getSessionId(),title:view.history.find(m=>m.type==='user')?.text?.slice(0,70)||'Gemini 当前会话',cwd:view.config.getTargetDir(),model:view.config.getModel(),isRunning:pending||view.streamingState!=='idle',lastActivityAt:view.updatedAt};}
// Called from the original interactive CLI's render. Both screen and phone use
// the exact same submit callback, history and ordinary desktop approval policy.
function update(next){
  const signature=JSON.stringify([next.history,next.pendingHistoryItems,next.streamingState]);
  next.updatedAt=signature===view?.signature?view.updatedAt:Date.now();next.signature=signature;view=next;
  if(started)return;
  const manager={
    async getAllSessions(){return [session()];},
    async getSession(id){return id===session().sessionId?session():null;},
    async getTranscript(id){
      if(id!==session().sessionId)throw new Error('Session changed');
      const rows=[...view.history,...view.pendingHistoryItems];
      const messages=rows.flatMap((m,i)=>{
        if(['user','gemini','gemini_content','error','info'].includes(m.type)&&typeof m.text==='string')return [{id:String(m.id??i),message:{role:m.type==='user'?'user':'assistant',content:m.text}}];
        if(m.type==='tool_group')return (m.tools||[]).map((t,k)=>({id:String(m.id??i)+':'+k,message:{role:'toolResult',content:t.name+'\n'+(typeof t.resultDisplay==='string'?t.resultDisplay:JSON.stringify(t.resultDisplay||''))}}));
        return [];
      });
      if(lastError)messages.push({id:'mydex-send-error',message:{role:'assistant',content:lastError}});
      return messages;
    },
    async sendMessage(id,text){
      if(id!==session().sessionId)return {delivered:false,reason:'Gemini 当前会话已切换'};
      if(pending||view.streamingState!=='idle')return {delivered:false,reason:'Gemini 正在处理或等待桌面审批，请稍后发送'};
      pending=true;lastError='';
      Promise.resolve().then(()=>view.submitQuery(text)).catch(()=>{lastError='发送失败，请在 Gemini 原窗口查看错误后重试';}).finally(()=>{pending=false;});
      return {delivered:true};
    }
  };
  started=startSessionServer({manager,toolId:'gemini',descriptorPath:path.join(os.homedir(),'.mydex/desktop-bridges/gemini.json')}).catch(()=>{started=null;});
}
module.exports={update};
