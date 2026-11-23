import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
// Operator-configured read-only probes. HTTP clients cannot supply commands.
export class ResourceQueries {
  constructor(definitions=[]){this.definitions=definitions;this.cache=new Map();this.pending=new Map();}
  list(){return this.definitions.map(r=>({id:r.id,name:r.name,kind:'resource',
    agentRequired:false,status:this.cache.get(r.id)?.status||'unknown',
    observedAt:this.cache.get(r.id)?.observedAt||null,description:r.description}));}
  async read(id){
    const r=this.definitions.find(r=>r.id===id);if(!r)throw Error('Resource not registered');
    const old=this.cache.get(id);if(old&&Date.now()-old.observedAt<15000)return old;
    if(this.pending.has(id))return this.pending.get(id);
    const p=(async()=>{try{
      const {stdout}=await run('ssh.exe',['-o','BatchMode=yes','-o','ConnectTimeout=8',r.sshHost,r.command],{windowsHide:true,timeout:20000,maxBuffer:128*1024});
      const data=JSON.parse(stdout.replace(/^\uFEFF/,''));
      const value={...data,id,status:data.status||'observed',observedAt:Date.now()};this.cache.set(id,value);return value;
    }catch{const value={id,status:'unavailable',observedAt:Date.now(),error:'本次资源查询失败，不代表作业已停止。'};this.cache.set(id,value);return value;}
    finally{this.pending.delete(id);}})();this.pending.set(id,p);return p;
  }
}
