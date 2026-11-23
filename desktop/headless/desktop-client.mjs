import fs from 'node:fs';
import path from 'node:path';

// A desktop window is a client of the persistent owner. It never spawns a
// replacement service after a timeout, nor stops one when the window closes.
export class SharedDesktopClient {
 constructor({directory,configPath,timeout=310000}) {
  this.file=path.join(directory,'desktop-endpoint.json');
  this.configPath=path.resolve(configPath);this.timeout=timeout;
 }
 async call(action,args={}) {
  let state;
  try{state=JSON.parse(fs.readFileSync(this.file,'utf8'));}
  catch{throw Error('共享后台未就绪，请检查服务状态；未启动替代网关。');}
  if(state.protocol!==1||!Number.isInteger(state.port)||state.port<1024||state.port>65535||typeof state.token!=='string'||state.token.length<32||typeof state.configPath!=='string'||path.resolve(state.configPath)!==this.configPath)
   throw Error('共享后台身份或配置不匹配，未执行操作。');
  let response;
  try{
   response=await fetch('http://127.0.0.1:'+state.port+'/desktop',{
    method:'POST',headers:{Authorization:'Bearer '+state.token,'Content-Type':'application/json'},
    body:JSON.stringify({action,args}),signal:AbortSignal.timeout(this.timeout),
   });
  }catch{throw Error('共享后台连接中断，操作结果待核对；不会自动重发。');}
  let value;try{value=await response.json();}catch{throw Error('共享后台回执无法解析，操作结果待核对；不会自动重发。');}
  if(!response.ok)throw Error(value.error||'共享后台操作失败，请核对状态。');
  return value.result;
 }
 close() {} // UI lifetime must not own the service lifetime.
}
