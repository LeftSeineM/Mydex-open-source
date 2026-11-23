import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const appRoot=path.resolve(import.meta.dirname,'../..');
export const dataRoot=path.resolve(process.env.MYDEX_DATA_DIR||path.join(appRoot,'data'));
export const controlRoot=path.join(dataRoot,'agent-control');
export function protect(directory){
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 if(process.platform==='win32'){
  const user=execFileSync('whoami.exe',[],{encoding:'utf8',windowsHide:true}).trim();
  execFileSync('icacls.exe',[directory,'/inheritance:r','/grant:r',user+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F'],{windowsHide:true,stdio:'pipe'});
 }else fs.chmodSync(directory,0o700);
}
export function writePrivate(file,value){const temp=file+'.'+crypto.randomBytes(6).toString('hex');fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600});fs.renameSync(temp,file);}
export async function rpc(action,args={},directory=controlRoot){
 const state=JSON.parse(fs.readFileSync(path.join(directory,'endpoint.json'),'utf8'));
 if(!Number.isInteger(state.port)||state.port<1024||state.port>65535||typeof state.token!=='string')throw Error('Invalid local service descriptor');
 const r=await fetch('http://127.0.0.1:'+state.port+'/rpc',{method:'POST',headers:{Authorization:'Bearer '+state.token,'Content-Type':'application/json'},body:JSON.stringify({action,args}),signal:AbortSignal.timeout(310000)});
 const value=await r.json();if(!r.ok)throw Error(value.error||'Local service operation failed');return value.result;
}
