import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const helper=fileURLToPath(new URL('../desktop/macos/MydexDesktopAccess',import.meta.url));
export function codexApp(home=os.homedir()){
 return ['/Applications/ChatGPT.app','/Applications/Codex.app',path.join(home,'Applications/ChatGPT.app'),path.join(home,'Applications/Codex.app')].find(p=>fs.existsSync(path.join(p,'Contents/Info.plist')));
}
export function threadLink(id){
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))throw Error('无效的桌面会话 ID');
 return 'codex://threads/'+id;
}
export function newThreadLink(text,cwd){
 if(typeof text!=='string'||!text.trim()||text.length>12000)throw Error('Mac 桌面新建指令须为 1–12000 字符');
 const url=new URL('codex://threads/new');url.searchParams.set('mode','codex');url.searchParams.set('prompt',text);
 if(cwd){if(!path.posix.isAbsolute(cwd)||cwd.includes('\0'))throw Error('无效的 Mac 项目路径');url.searchParams.set('path',cwd);}
 return url.href;
}
export function desktopAccess(request){
 return new Promise((resolve,reject)=>{
  const child=spawn(helper,[],{stdio:['pipe','pipe','ignore']});let output='',done=false;
  const finish=(e,v)=>{if(done)return;done=true;clearTimeout(timer);e?reject(e):resolve(v);};
  const timer=setTimeout(()=>{child.kill();finish(Error('Mac 桌面操作结果尚未确认，请检查会话，不要重复提交'));},18000);
  child.on('error',()=>finish(Error('Mac 桌面辅助程序不可用，请重新安装 Mydex')));
  child.stdout.on('data',b=>{output+=b;if(output.length>65536){child.kill();finish(Error('桌面辅助程序响应异常'));}});
  child.on('exit',()=>{try{const r=JSON.parse(output);r.error?finish(Error(r.error)):finish(null,r);}catch{finish(Error('Mac 桌面操作结果未知，请检查会话，不要重复提交'));}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request));
 });
}
// Only deep links and the real app's Accessibility send button are used here.
// The CLI reads its index for correlation; it never creates/resumes/runs a turn.
export class MacDesktopNavigation {
 constructor(native,codex,{app=codexApp(),open=async url=>{if(!app)throw Error('未找到 Codex 桌面应用');await exec('/usr/bin/open',['-a',app,url]);},ui=desktopAccess,sleep=pause,now=Date.now}={}){
  Object.assign(this,{native,codex,app,open,ui,sleep,now});this.busy=false;this.opening=new Map();
 }
 async capability(){if(!this.app||!fs.existsSync(helper))return false;try{return (await this.ui({action:'status'})).trusted===true;}catch{return false;}}
 async ensure(id){
  if(this.opening.has(id))return this.opening.get(id);
  const work=this.ensureOnce(id).finally(()=>this.opening.delete(id));this.opening.set(id,work);return work;
 }
 async ensureOnce(id){
  const url=threadLink(id);
  try{return await this.native.snapshot(id);}catch{}
  await this.open(url);
  const deadline=this.now()+10000;let error;
  do{try{return await this.native.snapshot(id);}catch(e){error=e;}await this.sleep(250);}while(this.now()<deadline);
  throw Error('无法自动载入这条桌面原会话：'+(error?.message||'未确认原会话身份'));
 }
 async index(){await this.codex.start();const r=await this.codex.request('thread/list',{limit:100,sortKey:'created_at',archived:false,modelProviders:[]});return r.data||[];}
 async create(text,cwd){
  if(this.busy)throw Error('正在创建桌面对话，请等待结果');this.busy=true;
  try{
   const url=newThreadLink(text,cwd);
   const before=new Set((await this.index()).map(t=>t.id));
   // Exactly one UI submission. A timeout is ambiguous and must never replay.
   const result=await this.ui({action:'create',appPath:this.app,url,text});
   if(result.pressed!==true)throw Error('桌面未确认发送，请检查辅助功能权限');
   const deadline=this.now()+12000;
   do{
    const candidates=(await this.index()).filter(t=>!before.has(t.id)&&(!cwd||t.cwd===cwd));
    const matches=[];
    for(const t of candidates){
     const r=await this.codex.request('thread/read',{threadId:t.id,includeTurns:true});
     const first=(r.thread?.turns||[]).flatMap(turn=>turn.items||[]).find(i=>i.type==='userMessage');
     const input=(first?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
     if(input===text)matches.push(t);
    }
    if(matches.length>1)throw Error('出现多条相同的新对话，无法确认目标；请查看桌面，不要重复提交');
    if(matches.length===1){await this.ensure(matches[0].id);return matches[0];}
    await this.sleep(300);
   }while(this.now()<deadline);
   throw Error('指令已交给桌面，但新会话尚未确认；请刷新列表，不要重复提交');
  }finally{this.busy=false;}
 }
}
