import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Discover only sockets owned by the current user. Explicit overrides retain
// priority; support both legacy flat paths and current desktop directories.
export function socketCandidates(kind, {platform=process.platform, env=process.env, temp=os.tmpdir(), uid=process.getuid?.()}={}) {
 if(platform==='win32') {
  if(kind==='native')return ['\\\\.\\pipe\\codex-ipc'];
  try{return fs.readdirSync('\\\\.\\pipe\\').filter(n=>/^codex-(app-tools-|browser-use-)/.test(n)).map(n=>'//./pipe/'+n);}catch{return [];}
 }
 const explicit=env[kind==='native'?'MYDEX_CODEX_IPC_SOCKET':'MYDEX_CODEX_TOOLS_SOCKET'];
 const codexHome=env.CODEX_HOME||path.join(os.homedir(),'.codex');
 const roots=[...new Set([temp,'/tmp',codexHome])];
 const candidates=explicit?[explicit]:[];
 const owned=(p,socket=false)=>{try{const s=fs.lstatSync(p);return (socket?s.isSocket():s.isDirectory())&&(uid===undefined||s.uid===uid);}catch{return false;}};
 if(kind==='native'&&owned(path.join(codexHome,'ipc')))candidates.push(path.join(codexHome,'ipc','ipc.sock'));
 for(const root of roots){
  try{for(const n of fs.readdirSync(root))if(kind==='native'?/^codex-ipc(?:[.-].*)?$/.test(n):/^codex-(app-tools-|browser-use-)/.test(n))candidates.push(path.join(root,n));}catch{}
  if(kind!=='native')for(const name of ['codex-app-tools','codex-browser-use']){
   const dir=path.join(root,name);if(!owned(dir))continue;
   try{for(const n of fs.readdirSync(dir))if(n.endsWith('.sock'))candidates.push(path.join(dir,n));}catch{}
  }
 }
 return [...new Set(candidates)].filter(p=>owned(p,true));
}
