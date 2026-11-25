import {z} from 'zod';
import {rpc} from '../local-state.mjs';

// Router-owned background Workers (DeepSeek Harness SDK runtimes). These never
// touch the user's original desktop sessions; use mydex_router for those.
const call=(operation,args)=>rpc('workers',{operation,args});
const reply=value=>({content:[{type:'text',text:JSON.stringify(value,null,1)}]});
function tool(server,name,description,inputSchema,fn){
 server.registerTool(name,{description,inputSchema},async args=>{try{return reply(await fn(args));}catch(error){return {isError:true,content:[{type:'text',text:String(error.message||'Worker operation failed; inspect mydex_worker_status before retrying')}]};}});
}

export function registerWorkerTools(server){
 tool(server,'mydex_worker_tiers','List Worker tiers (strong/mid/light → provider/model and estimated price), budget, concurrency limit, handoff folder and whether DeepSeek Harness is available.',{},()=>call('tiers',{}));
 tool(server,'mydex_worker_dispatch','Start a Router-owned background Worker and return its job id immediately. The brief must stand alone: what to do (absolute paths), what not to touch, known facts, and checkable completion criteria. Workers run with full access and no approvals; for code changes set workdir to a dedicated git worktree, never the main checkout. Do not delegate deletion, pushes, system changes or paid external actions; ask the user. Refused when budget or concurrency is exhausted.',
  {title:z.string().min(1).max(80).describe('Short name shown on the task tree'),brief:z.string().min(1).max(50000).describe('Markdown brief, saved as brief.md'),why:z.string().min(1).max(500).describe('One sentence: why this tier instead of doing it yourself or another tier'),tier:z.enum(['strong','mid','light']).optional(),provider:z.string().optional(),model:z.string().optional(),reasoningEffort:z.string().optional(),parent:z.string().optional().describe('Parent job id, for the task tree'),workdir:z.string().optional().describe('Worker working directory; defaults to its job folder')},
  a=>call('dispatch',a));
 tool(server,'mydex_worker_wait','Wait (at most 280 s per call) for jobs to finish. Returns state, cost and the receipt text. A receipt is the Worker\'s own claim: spot-check a key result before accepting.',{ids:z.array(z.string()).min(1).max(20),timeoutSeconds:z.number().min(1).max(280).optional()},a=>call('wait',a));
 tool(server,'mydex_worker_accept','Record your spot-check verdict on a finished job. passed=false with the reason when it fails; then fix it yourself or re-dispatch with the failure explained.',{id:z.string(),passed:z.boolean(),check:z.string().min(1).max(2000).describe('What you checked and the result')},a=>call('accept',a));
 tool(server,'mydex_worker_status','Show jobs, cost and remaining budget. Pass id for one job.',{id:z.string().optional()},a=>call('status',a));
 tool(server,'mydex_worker_cancel','Cancel a running Worker job.',{id:z.string()},a=>call('cancel',a));
}
