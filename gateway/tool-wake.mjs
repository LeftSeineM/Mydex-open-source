import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import crypto from 'node:crypto';
import {discoverApplication} from '../desktop/bridges/discovery.mjs';
const applications={codex:['codex','Codex.exe'],deepseek:['deepseek','DeepSeek Harness.exe'],kimi:['kimi','Kimi Code.exe'],'claude-desktop':['claude','claude.exe'],zcode:['zcode','ZCode.exe']};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function discoverWakeTarget(tool){const def=applications[tool];if(!def)return null;const found=await discoverApplication(def[0]);return found.app?{executable:path.join(found.app,def[1]),running:found.running}:null;}
export function launchOriginalApplication(target){
 const exe=target.executable;
 if(!path.isAbsolute(exe)||!fs.existsSync(exe)||!fs.existsSync(path.join(path.dirname(exe),'resources/app.asar')))throw Error('Original desktop application not found');
 return new Promise((resolve,reject)=>{const child=spawn(exe,[],{cwd:path.dirname(exe),windowsHide:true,detached:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
}

// Preparing an original application never creates a conversation or executes a
// model prompt. No commands/paths/credentials can arrive from remote callers.
export class ToolWake {
 constructor({directory,probe,discover=discoverWakeTarget,launch=launchOriginalApplication,clock=Date.now,pause=sleep,timeout=25000,platform=process.platform}){
  Object.assign(this,{directory,probe,discover,launch,clock,pause,timeout,platform});this.pending=new Map();
 }
 prepare(tool){
  if(!Object.hasOwn(applications,tool))return Promise.resolve({tool,state:'unsupported',ready:false,message:'此工具尚无原应用唤醒适配，不启动替代命令行'});
  if(this.pending.has(tool))return this.pending.get(tool);
  const work=this.run(tool).finally(()=>this.pending.delete(tool));this.pending.set(tool,work);return work;
 }
 async run(tool){
  const check=async()=>{try{return await this.probe(tool);}catch{return false;}};
  if(await check())return {tool,state:'ready',ready:true,launched:false};
  if(this.platform!=='win32')return {tool,state:'unsupported_platform',ready:false,message:'本版自动启动先支持Windows'};
  const target=await this.discover(tool);
  if(!target)return {tool,state:'not_installed',ready:false,message:'未找到已安装的原应用，不会下载替代应用'};
  let launched=false;
  if(!target.running){
   fs.mkdirSync(this.directory,{recursive:true});const file=path.join(this.directory,tool+'.json');let previous;
   try{previous=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')return {tool,state:'recovery_required',ready:false,message:'启动记录不可用，未重复启动'};}
   if(previous&&(!Number.isFinite(previous.at)||typeof previous.attemptId!=='string'))return {tool,state:'recovery_required',ready:false,message:'启动记录无效，未重复启动'};
   if(previous&&this.clock()-previous.at<45000)return {tool,state:'starting',ready:false,message:'原应用正在准备，请稍后刷新；没有重复启动'};
   const record={attemptId:crypto.randomUUID(),at:this.clock(),state:'submitting'};
   const temp=file+'.'+record.attemptId;fs.writeFileSync(temp,JSON.stringify(record),{mode:0o600});fs.renameSync(temp,file);
   try{await this.launch(target);launched=true;}catch{return {tool,state:'launch_failed',ready:false,message:'原应用启动失败，请检查系统登录状态或安装路径'};}
  }
  const until=this.clock()+this.timeout;
  do{if(await check())return {tool,state:'ready',ready:true,launched};await this.pause(500);}while(this.clock()<until);
  return {tool,state:'interface_not_ready',ready:false,launched,message:'原应用尚未就绪，可能需要登录、授权或已有接口适配；没有执行任务'};
 }
}
