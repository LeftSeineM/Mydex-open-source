'use strict';
const {startSessionServer}=require('./session-server.cjs');
// The supplied accessor is captured inside the existing desktop host module.
// Session IDs are resolved against that host's task index, never arbitrary paths.
async function start({taskService,descriptorPath}) {
  const refs=new Map();
  const metadata=t=>({sessionId:t.taskId,title:t.title,cwd:t.workspacePath,model:t.model,isRunning:['running','pending'].includes(t.status),isArchived:t.archived,createdAt:t.createdAt,lastActivityAt:t.updatedAt});
  const manager={
    async getAllSessions(){
      const service=taskService();if(!service)throw new Error('Desktop host unavailable');
      const rows=[...await service.listTasks({}),...await service.listPinnedTasks({})];
      refs.clear();for(const t of rows)refs.set(t.taskId,t);
      return [...refs.values()].map(metadata);
    },
    async getSession(id){await this.getAllSessions();const t=refs.get(id);return t?metadata(t):null;},
    async getTranscript(id){
      const t=refs.get(id);if(!t)throw new Error('Unknown desktop session');
      const s=await taskService().getTaskSnapshot({taskId:id,workspacePath:t.workspacePath,workspaceIdentity:t.workspaceIdentity});
      return (s.messages||[]).map((m,i)=>({id:m.id||String(i),message:{role:m.role||m.type,content:m.content??m.text??''}}));
    },
    async sendMessage(id,text,_images,options){
      const t=refs.get(id);if(!t)throw new Error('Unknown desktop session');
      await taskService().sendPrompt({taskId:id,workspacePath:t.workspacePath,workspaceIdentity:t.workspaceIdentity,traceId:options.messageUuid,messageId:options.messageUuid,queryId:options.messageUuid,content:text});
      return {delivered:true};
    }
  };
  return startSessionServer({manager,descriptorPath,toolId:'zcode'});
}
module.exports={start};
