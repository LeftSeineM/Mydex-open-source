import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {NativeFollower} from './native.mjs';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function codexLogRoots({home=os.homedir(),local=process.env.LOCALAPPDATA||path.join(home,'AppData','Local'),platform=process.platform}={}){
 if(platform==='win32'){
  const roots=[path.join(local,'Codex','Logs')],packages=path.join(local,'Packages');
  try{for(const name of fs.readdirSync(packages).filter(n=>/^OpenAI\.Codex_[\w]+$/.test(n)).slice(0,4))roots.push(path.join(packages,name,'LocalCache','Local','Codex','Logs'));}catch{}
  return roots;
 }
 if(platform==='darwin')return [path.join(home,'Library','Logs','Codex'),path.join(home,'Library','Application Support','Codex','Logs')];
 return [path.join(home,'.local','state','codex','logs')];
}

// Logs supply only candidate UUIDs. Never forward log text or trust it as proof
// of a parent relationship; the live desktop owner must confirm that separately.
export function sideCandidates(roots,parent,{now=Date.now(),maxFiles=4,maxBytes=1024*1024}={}){
 const files=[];
 for(const root of roots)for(const offset of [0,86400000]){
  const d=new Date(now-offset),dir=path.join(root,String(d.getUTCFullYear()),String(d.getUTCMonth()+1).padStart(2,'0'),String(d.getUTCDate()).padStart(2,'0'));
  try{for(const name of fs.readdirSync(dir).filter(n=>/^codex-desktop-.*\.log$/.test(n))){const file=path.join(dir,name),stat=fs.lstatSync(file);if(stat.isFile()&&!stat.isSymbolicLink())files.push({file,time:stat.mtimeMs});}}catch{}
 }
 const ids=new Set();
 for(const {file}of files.sort((a,b)=>b.time-a.time).slice(0,maxFiles)){
  let fd;try{fd=fs.openSync(file,'r');const size=fs.fstatSync(fd).size,buffer=Buffer.alloc(Math.min(size,maxBytes));fs.readSync(fd,buffer,0,buffer.length,Math.max(0,size-buffer.length));const matches=[...buffer.toString('utf8').matchAll(/(?:threadId|conversationId)["']?[:=]\s*["']?([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})/gi)];for(const m of matches.reverse())if(m[1]!==parent)ids.add(m[1]);}catch{}finally{if(fd!==undefined)fs.closeSync(fd);}
 }
 return [...ids].slice(0,10);
}

export class LiveSideChats {
 constructor({roots=codexLogRoots(),follower=()=>new NativeFollower({requestTimeout:750,snapshotTimeout:750}),now=Date.now,candidates=sideCandidates}={}){
  Object.assign(this,{roots,follower,now,candidates});this.cache=new Map();this.pending=new Map();
 }
 async list(parent){
  if(!uuid.test(parent))return [];
  const cached=this.cache.get(parent);if(cached&&this.now()-cached.at<15000)return cached.data;
  if(this.pending.has(parent))return this.pending.get(parent);
  const work=this.scan(parent).then(data=>{this.cache.set(parent,{at:this.now(),data});if(this.cache.size>30)this.cache.delete(this.cache.keys().next().value);return data;}).finally(()=>this.pending.delete(parent));
  this.pending.set(parent,work);return work;
 }
 async scan(parent){
  const ids=this.candidates(this.roots,parent,{now:this.now()});if(!ids.length)return [];
  const native=this.follower(),found=[];
  try{for(const id of ids){if(!uuid.test(id)||id===parent)continue;try{
   const s=await native.snapshot(id);
   if(s.id!==id||s.sideConversation!==true||s.forkedFromId!==parent)continue;
   found.push({id,parentId:parent,title:s.title||'桌面侧聊',status:s.threadRuntimeStatus||null,ephemeral:s.ephemeral===true});
  }catch{}}}finally{native.close();}
  return found;
 }
}
