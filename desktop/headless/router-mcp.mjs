import {z} from 'zod';
import {rpc} from './local-state.mjs';
import {normalizeRouterCall} from './router-call.mjs';

export function registerRouterTools(server){
  server.registerTool('mydex_router',{
    description:'Mydex-superagent·灰度测试: control selected ORIGINAL desktop conversations through the existing background owner. Before answering project progress, call briefing with jobId, page until hasMore=false, and acknowledge each consumed page with ack_briefing using its digest and through. Briefings contain persisted observations with timestamps, not live guarantees. First catalog and use exact user-selected session keys. New jobs are observe-only: the authenticated user must grant execution from the phone before assign/create/dispatch. You cannot grant yourself permission or answer human-required approvals/questions. To change only one branch use revise_task with taskId, expectedPackageRevision and package; a running branch must first have confirmed cancellation/completion. Old packages/evidence remain available. Never broadcast. Native writes require a stable requestId. Safe observations (catalog, snapshot, events, read_session, reconcile) can omit it. After an uncertain send use reconcile, never a fresh dispatch. A completion_claim is NOT accepted success. Unsupported native create/cancel/approval must remain unsupported. The user-designated native Router is identified by the selected job.router (snapshot.router is only the default), never by title. When asked to organize a project, read its selected sessions and registered read_resource nodes, infer responsibilities and dependencies with evidence and timestamps, clearly mark uncertain roles, and keep the report in the original Router conversation. Resource nodes do not require an Agent.',
    inputSchema:{operation:z.enum(['prepare_tool','organization','save_organization','catalog','snapshot','events','read_session','read_resource','briefing','ack_briefing','create_session','wake','create_job','assign','revise_task','dispatch','reconcile','pause','resume','cancel','answer','accept']),args:z.record(z.string(),z.unknown()).default({}),requestId:z.string().regex(/^[A-Za-z0-9-]{16,100}$/).optional()}
  },async input=>{
    let request;try{request=normalizeRouterCall(input);}catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}
    try{return {content:[{type:'text',text:JSON.stringify(await rpc('router',request))}]};}
    catch{return {isError:true,content:[{type:'text',text:'Router operation unavailable or not confirmed. Inspect persisted state before retrying; never assume a native write was rolled back.'}]};}
  });
}
