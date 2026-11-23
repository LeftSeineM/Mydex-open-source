import {interactionRevision} from './engine.mjs';

// Reuses the gateway's existing device connections. No sockets, accounts or
// agent runtimes are started here. Capabilities are conservative and separate.
export class GatewayRouterAdapter {
  constructor({call,devices}){this.call=call;this.devices=devices;}
  prepare(node){return this.call(node.device,'prepareTool',{toolId:node.toolId});}
  async catalog(){
    const sessions=[],devices=[],workspaces=[];
    for(const d of this.devices.values()){
      if(!d.online){devices.push({id:d.id,online:false});continue;}
      try{
        const [{tasks},tools,projects]=await Promise.all([this.call(d.id,'list',{}),this.call(d.id,'tools',{}),this.call(d.id,'projects',{}).catch(()=>[])]);
        devices.push({id:d.id,name:d.name,online:true,tools});
        for(const p of projects)if(['codex','deepseek'].includes(p.toolId)&&p.path&&tools.some(t=>t.id===p.toolId&&t.capabilities?.create))workspaces.push({key:d.id+'~'+p.id,device:d.id,projectId:p.id,toolId:p.toolId,path:p.path,name:p.name});
        for(const t of tasks){
          const remote=t.routerOriginal===true;
          const live=t.source==='desktop'&&(!t.readOnly||remote)&&(t.id.startsWith('desktop:')||t.id.startsWith('native:'));
          const tool=tools.find(x=>x.id===t.toolId);
          const codex=live&&!remote&&t.id.startsWith('desktop:')&&t.toolId==='codex'&&tool?.capabilities?.send===true;
          sessions.push({key:d.id+'~'+t.id,device:d.id,session:t.id,hostId:t.hostId,hostName:t.remoteHostName,toolId:t.toolId,title:t.title,cwd:t.cwd,status:t.status,mode:live?'original-live':'read-only',
            capabilities:{read:'supported',send:live&&!remote&&tool?.capabilities?.send?'supported':'unsupported',create:live&&!remote&&tool?.capabilities?.create?'supported':'unsupported',cancel:codex?'supported':'unsupported',approve:codex?'supported':'unsupported',answer:codex?'supported':'unsupported'},
            evidence:'source-reviewed',limitation:'原会话能力需逐项实测；非 Codex 的取消、审批尚未接通。'});
        }
      }catch{devices.push({id:d.id,online:true,controlAvailable:false});}
    }
    return {devices,sessions,workspaces};
  }
  async inspect(node){
    const t=await this.call(node.device,'routerInspect',{id:node.session});
    if(t.id!==node.session)throw Error('Native session identity mismatch');
    return {busy:t.status==='Running',failed:t.status==='Failed',readOnly:t.readOnly===true,turnId:t.turnId,cwd:t.cwd,model:t.model,
      generation:t.instance,messages:(t.messages||[]).map(m=>({id:m.id,role:m.role,type:m.type,title:m.title,text:m.text||''})),
      interactions:(t.approvals||[]).filter(a=>!a.resolved).map(a=>({...a,kind:a.questions?.length?'question':'approval',revision:interactionRevision({...a,kind:a.questions?.length?'question':'approval'})}))};
  }
  send(node,instruction,dispatchId){return this.call(node.device,'routerSend',{id:node.session,instruction,requestId:dispatchId,expectedGeneration:node.generation});}
  async create(workspace,instruction,requestId){const t=await this.call(workspace.device,'create',{mode:'desktop',toolId:workspace.toolId,projectId:workspace.projectId,instruction,requestId});const codex=workspace.toolId==='codex';if(!(codex?t.id?.startsWith('desktop:'):t.id?.startsWith('native:deepseek:')))throw Error('No original desktop identity returned');return {key:workspace.device+'~'+t.id,device:workspace.device,session:t.id,toolId:workspace.toolId,mode:'original-live',initialDelivery:t.initialDelivery,capabilities:{send:'supported',cancel:codex?'supported':'unsupported',approve:codex?'supported':'unsupported',answer:codex?'supported':'unsupported'}};}
  cancel(node,turnId,requestId){return this.call(node.device,'interrupt',{id:node.session,expectedTurnId:turnId,requestId});}
  answer(node,interaction,response,requestId){return this.call(node.device,'approve',{id:node.session,approvalId:interaction.id,decision:response.decision,answers:response.answers,requestId});}
}
