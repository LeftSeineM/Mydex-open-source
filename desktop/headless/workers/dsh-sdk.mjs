import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

// One DeepSeek Harness SDK runtime (stdio JSON-RPC) per Worker job. The user's
// desktop model profile is applied as a read-only overlay; credentials stay in
// DSH's own store and never pass through Mydex.
export function locateDsh(config={}){
 const root=config.root||process.env.MYDEX_DSH_ROOT||(process.platform==='win32'?'D:/Software/DeepSeekHarness':null);
 if(!root)return null;
 const exe=path.join(root,process.platform==='win32'?'DeepSeek Harness.exe':'deepseek-harness');
 const cli=path.join(root,'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js');
 const patch=config.profilePatch||path.join(os.homedir(),'.dsh','profiles','desktop','cordis.patch.yml');
 return fs.existsSync(exe)&&fs.existsSync(patch)?{exe,cli,patch}:null;
}

export class DshClient {
 constructor({dsh,permissionMode,onEvent}){
  this.onEvent=onEvent||(()=>{});this.pending=new Map();this.nextId=1;this.buf='';this.stderr='';this.exited=false;
  this.child=spawn(dsh.exe,['--expose-internals',dsh.cli,'--profile','sdk','--patch',dsh.patch],{
   env:{...process.env,ELECTRON_RUN_AS_NODE:'1',...(permissionMode?{DSH_PERMISSION_MODE:permissionMode}:{})},stdio:['pipe','pipe','pipe'],windowsHide:true});
  this.child.stdout.setEncoding('utf8');this.child.stdout.on('data',d=>this.read(d));
  this.child.stderr.on('data',d=>{this.stderr=(this.stderr+d).slice(-4000);});
  this.child.on('error',e=>this.fail(e.message));
  this.child.on('exit',code=>{this.exited=true;this.fail('DSH runtime exited with code '+code);});
 }
 fail(message){for(const p of this.pending.values())p.reject(Error(message));this.pending.clear();}
 read(d){
  this.buf+=d;let i;
  while((i=this.buf.indexOf('\n'))>=0){
   const line=this.buf.slice(0,i);this.buf=this.buf.slice(i+1);if(!line.trim())continue;
   let m;try{m=JSON.parse(line);}catch{continue;}
   if(m.id!==undefined&&!m.method){const p=this.pending.get(m.id);this.pending.delete(m.id);if(p)m.error?p.reject(Error(m.error.message||'DSH request failed')):p.resolve(m.result);}
   else if(m.method)this.onEvent(m);
  }
 }
 call(method,params){
  if(this.exited)return Promise.reject(Error('DSH runtime exited'));
  return new Promise((resolve,reject)=>{const id=this.nextId++;this.pending.set(id,{resolve,reject});this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 }
 async close(){
  try{await Promise.race([this.call('shutdown',{}),new Promise(r=>setTimeout(r,5000))]);}catch{}
  try{this.child.stdin.end();}catch{}
  setTimeout(()=>{if(!this.exited)this.child.kill();},3000).unref();
 }
 kill(){if(!this.exited)this.child.kill();}
}

// Runs one job to completion. Returns the final assistant text and summed usage.
export async function runDshJob({dsh,permissionMode,cwd,provider,model,reasoningEffort,prompt,onProgress,signal}){
 const usage={inputTokens:0,outputTokens:0,cacheReadTokens:0};let last='';
 const client=new DshClient({dsh,permissionMode,onEvent:m=>{
  const ev=m.params?.event;if(m.method!=='session.event'||ev?.type!=='assistant/message')return;
  const u=ev.data?.usage;if(u)for(const k of Object.keys(usage))usage[k]+=u[k]||0;
  const text=(ev.data?.message?.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n').trim();if(text)last=text;
  onProgress?.({...usage});
 }});
 const abort=()=>client.kill();signal?.addEventListener('abort',abort,{once:true});
 try{
  await client.call('initialize',{cwd,provider,model,...(reasoningEffort?{reasoningEffort}:{})});
  const sessionId=crypto.randomUUID();
  await client.call('session/prompt',{sessionId,contentBlocks:[{type:'text',text:prompt}]});
  await client.call('session/wait',{sessionId});
  return {text:last,usage};
 }catch(e){throw Object.assign(e,{partial:last,usage,stderr:client.stderr});}
 finally{signal?.removeEventListener('abort',abort);void client.close();}
}
