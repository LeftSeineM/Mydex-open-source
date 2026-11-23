import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {threadLink} from './mac-desktop-navigation.mjs';

const exec=promisify(execFile);
// Open only an existing, validated desktop thread. Never create a CLI writer.
export class WindowsDesktopNavigation {
 constructor(native,{open=async url=>{
  await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Start-Process -FilePath '${url}'`],{windowsHide:true,timeout:10000});
 },sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}={}){
  Object.assign(this,{native,open,sleep,now});this.opening=new Map();this.failedAt=new Map();
 }
 async ensure(id){
  const url=threadLink(id);
  if(this.opening.has(id))return this.opening.get(id);
  const work=this.ensureOnce(id,url).catch(e=>{this.failedAt.set(id,this.now());throw e;}).finally(()=>this.opening.delete(id));
  this.opening.set(id,work);return work;
 }
 async ensureOnce(id,url){
  const snapshot=async()=>{
   const state=await this.native.snapshot(id);
   if(state.id!==id)throw Error('桌面返回的会话标识不匹配');
   return state;
  };
  try{return await snapshot();}catch{}
  if(this.failedAt.has(id)&&this.now()-this.failedAt.get(id)<60000)throw Error('原会话尚未载入，请稍后刷新或在电脑打开');
  await this.open(url);
  const deadline=this.now()+10000;
  do{try{const state=await snapshot();this.failedAt.delete(id);return state;}catch{}await this.sleep(250);}while(this.now()<deadline);
  throw Error('无法确认这条桌面原会话已载入，请检查电脑 Codex 后刷新；未发送消息');
 }
}
