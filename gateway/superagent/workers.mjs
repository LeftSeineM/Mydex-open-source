import https from 'node:https';import fs from 'node:fs';

export function gatewayRequest(config,route,{method='GET',body,requestId}={}){
 return new Promise((resolve,reject)=>{
  const u=new URL(route,config.url);if(u.origin!==new URL(config.url).origin||!route.startsWith('/api/'))return reject(Error('目标不在允许范围'));
  const payload=body===undefined?null:JSON.stringify(body);
  const req=https.request(u,{method,ca:config.caFile?fs.readFileSync(config.caFile):undefined,headers:{Authorization:'Bearer '+config.token,...(payload?{'Content-Type':'application/json','Idempotency-Key':requestId}:{} )}},res=>{
   let size=0,parts=[];res.on('data',p=>{size+=p.length;if(size>4*1024*1024){req.destroy(Error('响应过大'));return;}parts.push(p);});
   res.on('end',()=>{try{if(res.statusCode!==200)return reject(Error('电脑网关响应 '+res.statusCode));resolve(JSON.parse(Buffer.concat(parts).toString()));}catch{reject(Error('电脑返回格式无效'));}});res.on('error',()=>reject(Error('电脑响应中断')));
  });req.setTimeout(35000,()=>req.destroy(Error('电脑响应超时')));req.on('error',()=>reject(Error('电脑暂不可用')));req.end(payload);
 });
}
export class Workers {
 constructor(profiles,request=gatewayRequest){this.profiles=profiles;this.request=request;}
 profile(worker){const at=worker.indexOf('/'),p=this.profiles.find(p=>p.id===worker.slice(0,at)),device=worker.slice(at+1);if(!p||!p.devices.includes(device))throw Error('电脑未授权');return {p,device};}
 async list(){const out=[];for(const p of this.profiles){try{const [{devices},{tools}]=await Promise.all([this.request(p,'/api/devices'),this.request(p,'/api/tools')]);for(const d of devices.filter(d=>p.devices.includes(d.id)))out.push({id:p.id+'/'+d.id,name:d.name,online:d.online,desktopOnline:d.desktopOnline,tools:tools.filter(t=>t.deviceId===d.id).map(t=>({id:t.id,name:t.name,capabilities:t.capabilities,note:t.note}))});}catch{for(const id of p.devices)out.push({id:p.id+'/'+id,name:p.name||p.id,online:false});}}return out;}
 async projects(worker){const {p,device}=this.profile(worker);const r=await this.request(p,'/api/projects');return r.projects.filter(t=>t.deviceId===device);}
 async sessions(worker,{all=false}={}){const {p,device}=this.profile(worker);const r=await this.request(p,'/api/tasks');return r.tasks.filter(t=>t.deviceId===device&&(all||t.source==='desktop'));}
 async models(worker){const {p,device}=this.profile(worker);return (await this.request(p,'/api/devices/'+encodeURIComponent(device)+'/models')).models||[];}
 async detail(worker,session){const {p,device}=this.profile(worker);if(typeof session!=='string'||!session.startsWith(device+'~'))throw Error('会话不属于指定电脑');return this.request(p,'/api/tasks/'+encodeURIComponent(session));}
 async validate(name,args){
  const {p,device}=this.profile(args.worker),workers=await this.list(),w=workers.find(w=>w.id===args.worker);if(!w?.online)throw Error('电脑离线');
  if(name==='propose_create'){
   // Current adapters only guarantee native desktop creation for Codex. Never
   // fall back to managed/CLI sessions just because another executable exists.
   if(args.toolId!=='codex'||!w.desktopOnline||!w.tools?.some(t=>t.id==='codex'&&t.capabilities?.create))throw Error('该工具尚不支持原桌面新建');
   const projects=await this.projects(args.worker);if(!args.projectId||!projects.some(x=>x.id===args.projectId&&x.toolId==='codex'))throw Error('新建必须指定真实项目');
   if(args.model){const models=await this.models(args.worker),m=models.find(m=>m.id===args.model);if(!m||args.effort&&!m.efforts?.includes(args.effort))throw Error('模型或强度不属于所选电脑');}
  }else if(name==='propose_send'){
   const detail=await this.detail(args.worker,args.session);if(detail.source!=='desktop'||detail.readOnly===true||detail.status==='Running'||detail.status==='AwaitingApproval')throw Error('原会话不可追加或仍在运行');
   if(!w.tools?.some(t=>t.id===detail.toolId&&t.capabilities?.send))throw Error('原桌面接口未接通');
  }else throw Error('操作未授权');
 }
 async execute(name,args,requestId){const {p,device}=this.profile(args.worker);if(name==='propose_create')return this.request(p,'/api/tasks',{method:'POST',requestId,body:{deviceId:device,projectId:args.projectId,toolId:args.toolId,mode:'desktop',instruction:args.instruction,...(args.model?{model:args.model}:{}),...(args.model&&args.effort?{effort:args.effort}:{})}});const result=await this.request(p,'/api/tasks/'+encodeURIComponent(args.session)+'/messages',{method:'POST',requestId,body:{instruction:args.instruction}});return {...result,id:args.session};}
}
