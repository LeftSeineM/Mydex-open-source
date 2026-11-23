import {spawn} from 'node:child_process';
import readline from 'node:readline';

// One long-lived owner of the existing desktop bridge. Agent clients can attach
// and detach without closing its stdin or terminating phone connections.
export class BridgeOwner {
  constructor({node=process.execPath,script,env=process.env,timeout=300000}) {
    this.pending=new Map();this.sequence=0;this.closed=false;this.timeout=timeout;
    this.process=spawn(node,[script],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.process.stderr.resume(); // Never forward private diagnostics into MCP output.
    this.lines=readline.createInterface({input:this.process.stdout});
    this.lines.on('line',line=>{
      let message;try{message=JSON.parse(line);}catch{return;}
      const item=this.pending.get(message.id);if(!item)return;
      clearTimeout(item.timer);this.pending.delete(message.id);
      if(message.error)item.reject(new Error(message.error));else item.resolve(message.result);
    });
    const fail=()=>{this.closed=true;for(const item of this.pending.values()){
      clearTimeout(item.timer);item.reject(new Error('Mydex connection worker stopped; inspect status before retrying a mutation.'));
    }this.pending.clear();};
    this.process.on('error',fail);this.process.on('exit',fail);
    this.process.stdin.on('error',fail);
  }
  call(action,args={}) {
    if(this.closed)return Promise.reject(new Error('Mydex connection worker is stopped'));
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Mydex operation timed out; its outcome is unknown. Do not automatically repeat.'));},this.timeout);
      this.pending.set(id,{resolve,reject,timer});
      this.process.stdin.write(JSON.stringify({id,action,args})+'\n',error=>{
        if(error){clearTimeout(timer);this.pending.delete(id);reject(new Error('Unable to contact Mydex worker'));}
      });
    });
  }
  async close() {
    if(this.closing)return this.closing;
    this.closing=this.shutdown();
    return this.closing;
  }
  async shutdown() {
    // A broken pipe closes RPC, but does not prove the child has exited.
    // Still reap that child on service shutdown, including concurrent callers.
    if(!this.process.pid||this.process.exitCode!==null||this.process.signalCode!==null){this.lines.close();return;}
    // This is service shutdown only, never called when an Agent disconnects.
    const exited=new Promise(resolve=>this.process.once('exit',resolve));
    this.closed=true;
    if(!this.process.stdin.destroyed)this.process.stdin.end();
    else this.process.kill();
    const timer=setTimeout(()=>this.process.kill(),5000);
    try{await exited;}finally{clearTimeout(timer);this.lines.close();}
  }
}
