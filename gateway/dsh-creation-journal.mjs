import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reject=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
export function nativeCreationId(requestId){
  if(typeof requestId!=='string'||!/^[A-Za-z0-9-]{16,100}$/.test(requestId))reject('无效的新建请求号',400);
  const h=digest(['mydex.dsh.native-create.v1',requestId]);
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}

// Use only inside the one existing gateway owner. The adapter is the ORIGINAL
// DSH desktop controller, not an SDK/CLI. Intent is durable before native I/O.
export class DshCreationJournal {
  constructor({directory,client}){
    if(!path.isAbsolute(directory))reject('新建记录需要绝对私有目录',400);
    this.directory=directory;this.client=client;this.pending=new Map();this.bySession=new Map();
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    for(const name of fs.readdirSync(directory))if(/^[a-f0-9]{64}\.json$/.test(name)){
      try{const record=JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
        if(record.sessionId)this.bySession.set(record.sessionId,record.requestId);
      }catch{} // The exact request still fails closed in read(); other tools remain usable.
    }
  }
  file(requestId){nativeCreationId(requestId);return path.join(this.directory,digest(requestId)+'.json');}
  read(requestId){const file=this.file(requestId);return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;}
  save(record){
    const file=this.file(record.requestId),temporary=file+'.'+crypto.randomUUID()+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify(record),{flag:'wx',mode:0o600,flush:true});fs.renameSync(temporary,file);
    if(record.sessionId)this.bySession.set(record.sessionId,record.requestId);
  }
  requestForSession(sessionId){return this.bySession.get(sessionId);}
  result(record){return {requestId:record.requestId,sessionId:record.sessionId||null,state:record.state,initialDelivery:record.state==='complete'?'acknowledged':record.sessionId?'unknown':'not-confirmed'};}
  async inspect(requestId,observed){
    const record=this.read(requestId);if(!record)return {requestId,state:'not-found',sessionId:null};
    if(!record.sessionId){
      const rows=await this.client.rawSessions({includeBlank:true});
      const latest=this.read(requestId);if(latest?.sessionId)return this.result(latest);
      const found=rows.find(s=>s.sessionId===record.expectedSessionId);
      if(found){
        const actual=path.resolve(found.cwd||found.projections?.values?.workingDirectory||'');
        const expected=path.resolve(record.cwd);
        if((process.platform==='win32'?actual.toLowerCase():actual)!==(process.platform==='win32'?expected.toLowerCase():expected))reject('新建记录与原会话目录不匹配');
        record.sessionId=found.sessionId;
        // A read/reconnect NEVER sends a model prompt. The original caller may
        // explicitly resume the same request after its native identity is known.
        record.state='created';this.save(record);
      }
    }
    const latest=this.read(requestId);
    if(latest.sessionId&&['prompt_submitting','prompt_unknown'].includes(latest.state)){
      try{
        const detail=observed||(this.client.detail?await this.client.detail(latest.sessionId):null);
        if(detail?.submittedRequests?.includes(latest.nativeId)){
          const current=this.read(requestId);current.state='complete';this.save(current);return this.result(current);
        }
      }catch{}
    }
    return this.result(latest);
  }
  async createAndPrompt({cwd,instruction,requestId}){
    nativeCreationId(requestId);
    if(typeof cwd!=='string'||!path.isAbsolute(cwd)||!fs.statSync(cwd).isDirectory())reject('请选择存在的原生工作目录',400);
    if(typeof instruction!=='string'||!instruction.trim()||instruction.length>50000)reject('请输入有效任务',400);
    const input={cwd:fs.realpathSync(cwd),instruction},fingerprint=digest(input);
    if(this.pending.has(requestId)){
      const record=this.read(requestId);if(record&&record.fingerprint!==fingerprint)reject('请求号已用于其他新建任务');
      return this.pending.get(requestId);
    }
    const operation=this.exclusive({input,requestId,fingerprint});this.pending.set(requestId,operation);
    try{return await operation;}finally{this.pending.delete(requestId);}
  }
  async exclusive(args){
    const file=this.file(args.requestId)+'.owner';let fd;
    try{fd=fs.openSync(file,'wx');}
    catch(e){
      if(e.code!=='EEXIST')throw e;
      const pid=Number(fs.readFileSync(file,'utf8'));let alive=false;
      try{process.kill(pid,0);alive=true;}catch(error){if(error.code!=='ESRCH')throw error;}
      if(alive){const record=this.read(args.requestId);if(record&&record.fingerprint!==args.fingerprint)reject('请求号已用于其他新建任务');return record?this.result(record):{requestId:args.requestId,state:'creating',sessionId:null,initialDelivery:'not-confirmed'};}
      fs.unlinkSync(file);fd=fs.openSync(file,'wx');
    }
    fs.writeFileSync(fd,String(process.pid));
    try{return await this.run(args);}finally{fs.closeSync(fd);fs.unlinkSync(file);}
  }
  async run({input,requestId,fingerprint}){
    let record=this.read(requestId),fresh=false;
    if(record){if(record.fingerprint!==fingerprint)reject('请求号已用于其他新建任务');}
    else{
      const nativeId=nativeCreationId(requestId);
      record={schemaVersion:1,requestId,fingerprint,cwd:input.cwd,nativeId,expectedSessionId:'session-'+nativeId,state:'creating',createdAt:Date.now()};
      try{fs.writeFileSync(this.file(requestId),JSON.stringify(record),{flag:'wx',mode:0o600,flush:true});fresh=true;}
      catch(e){if(e.code!=='EEXIST')throw e;record=this.read(requestId);if(record.fingerprint!==fingerprint)reject('请求号已用于其他新建任务');}
    }
    if(fresh){
      try{
        const created=await this.client.create(input.cwd,record.nativeId);
        if(typeof created?.sessionId!=='string'||!created.sessionId)throw Error('Missing native identity');
        record.sessionId=created.sessionId;record.state='created';this.save(record);
      }catch{
        record.state='creation_unknown';this.save(record);
        // Never retry native create, even if its response was lost. In DSH,
        // reusing a nonblank ID may create ANOTHER session instead of deduping.
        try{await this.inspect(requestId);}catch{}
        return this.result(this.read(requestId));
      }
    }else if(!record.sessionId){
      await this.inspect(requestId);record=this.read(requestId);
      if(!record.sessionId)return this.result(record);
    }
    if(record.state!=='created')return this.result(record);
    record.state='prompt_submitting';this.save(record);
    try{
      const receipt=await this.client.send(record.sessionId,input.instruction,record.nativeId);
      if(receipt?.accepted===false)throw Error('Native prompt rejected');
      record.state='complete';
    }catch{record.state='prompt_unknown';}
    this.save(record);return this.result(record);
  }
}
