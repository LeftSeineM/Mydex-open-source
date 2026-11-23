import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {spawn} from 'node:child_process';import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {inspectInstallation} from './install-state.mjs';
export const isStoreApp=app=>/[\\/]WindowsApps[\\/]/i.test(app);
export function compatibilityRoot(){return path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..','MydexClaudeBridge');}
export function claudeProfiles(app,{env=process.env}={}){
 const local=env.LOCALAPPDATA||path.join(os.homedir(),'AppData/Local'),roaming=env.APPDATA||path.join(os.homedir(),'AppData/Roaming');
 const pkg=app.split(/[\\/]/).find(s=>/^Claude_[^\\/]+__[^\\/]+$/i.test(s));
 const family=pkg?'Claude_'+pkg.split('__').at(-1):null;
 const candidates=[{label:'API 配置版',path:path.join(local,'Claude-3p')},{label:'账号登录版',path:path.join(roaming,'Claude')},{label:'本机账号版',path:path.join(local,'Claude')}];
 if(family)for(const base of ['Roaming','Local'])for(const name of ['Claude','Claude-3p'])candidates.push({label:name==='Claude-3p'?'商店 API 配置版':'商店账号版',path:path.join(local,'Packages',family,'LocalCache',base,name)});
 const unique=new Map();for(const item of candidates){if(['Local State','Preferences','claude-code-sessions'].some(n=>fs.existsSync(path.join(item.path,n))))unique.set(path.resolve(item.path).toLowerCase(),item);}
 return [...unique.values()];
}
export async function installStoreCopy(source,{directory,ensureClosed,install,storeDirectory=compatibilityRoot(),profileDirectory,env=process.env}={}){
 source=path.resolve(source);await ensureClosed(source);
 if(fs.existsSync(path.join(directory,'claude-store-pending.json')))throw Error('上次副本安装未完成，请先点击一键回退清理后重试');
 const previous=inspectInstallation(path.join(directory,"claude-install.json"));
 if(previous.recovery&&previous.state!=="notApplied")throw Error("已有 Claude 桥接恢复记录，请先检查并还原原版后重装。");
 const profiles=claudeProfiles(source,{env});
 const profile=profileDirectory?profiles.find(p=>path.resolve(p.path).toLowerCase()===path.resolve(profileDirectory).toLowerCase()):profiles.length===1?profiles[0]:null;
 if(!profile)throw Error(profiles.length?'检测到多个 Claude 数据目录，请在安装窗口选择要沿用的账号':'没有找到现有 Claude 数据目录，请先在 Claude 中完成初始化后重试');
 // Copy program files only. Existing account/session storage is never copied,
 // moved or patched, and the protected WindowsApps package stays unchanged.
 storeDirectory=path.resolve(storeDirectory);if(inside(source,storeDirectory)||inside(profile.path,storeDirectory))throw Error('副本不能存放在原程序或账号数据目录内，请选择其他位置');
 fs.mkdirSync(storeDirectory,{recursive:true});const root=fs.realpathSync(fs.mkdtempSync(path.join(storeDirectory,'claude-compat-'))),app=path.join(root,'app'),ownershipId=crypto.randomUUID();
 fs.writeFileSync(path.join(root,'mydex-compatibility.json'),JSON.stringify({kind:'mydex-claude-copy',ownershipId,root,sourceApp:source,userDataDir:profile.path}),{flag:'wx',mode:0o600});
 const pending=path.join(directory,'claude-store-pending.json');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(pending,JSON.stringify({mode:'storeCopy',ownershipId,sourceApp:source,userDataDir:profile.path,compatibilityRoot:root,phase:'copying'}),{flag:'wx',mode:0o600});
 try{
 await fs.promises.cp(source,app,{recursive:true,force:false,errorOnExist:true,dereference:false});
 const result=await install(app,{directory,ensureClosed,backupDirectory:path.join(root,'recovery'),recordMetadata:{mode:'storeCopy',sourceApp:source,userDataDir:profile.path,compatibilityRoot:root,ownershipId}});
 const recordPath=path.join(directory,'claude-install.json'),rec=JSON.parse(fs.readFileSync(recordPath,'utf8'));
 rec.mode='storeCopy';rec.sourceApp=source;rec.userDataDir=profile.path;rec.compatibilityRoot=root;
 fs.writeFileSync(recordPath,JSON.stringify(rec),{mode:0o600});
 fs.unlinkSync(pending);return {...result,storeCopy:true,app,profileLabel:profile.label};
 }catch(e){try{const r=JSON.parse(fs.readFileSync(pending));fs.writeFileSync(pending,JSON.stringify({...r,phase:'failed',error:String(e.message).slice(0,600)}));}catch{}throw e;}
}
export async function launchStoreCopy({directory=path.join(os.homedir(),'.mydex/desktop-bridges'),ensureClosed,spawnApp=spawn}={}){
 const recordPath=path.join(directory,'claude-install.json'),rec=JSON.parse(fs.readFileSync(recordPath,'utf8'));
 if(rec.mode!=='storeCopy'||!rec.sourceApp||!rec.userDataDir||!inspectInstallation(recordPath).installed)throw Error('没有可用的 Claude 兼容副本，请先安装');
 await ensureClosed(rec.sourceApp);
 const m=JSON.parse(fs.readFileSync(path.join(rec.bridgeRoot,'staged/manifest.json'),'utf8'));
 await ensureClosed(m.appDirectory);
 const p=spawnApp(path.join(m.appDirectory,'claude.exe'),['--user-data-dir='+rec.userDataDir],{cwd:m.appDirectory,detached:true,stdio:'ignore',windowsHide:false});
 await new Promise((resolve,reject)=>{p.once('spawn',resolve);p.once('error',reject);});p.unref();
 return {launched:true};
}

function same(a,b){return path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();}
function inside(parent,child){const r=path.relative(path.resolve(parent).toLowerCase(),path.resolve(child).toLowerCase());return !r||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));}
function assertNoLinks(root){for(const name of fs.readdirSync(root)){const p=path.join(root,name),s=fs.lstatSync(p);if(s.isSymbolicLink())throw Error('副本包含链接，已停止自动删除，请检查目录');if(s.isDirectory())assertNoLinks(p);}}
// Delete only the generated program container. Neither the chosen parent
// folder, the vendor installation nor the shared account directory is removed.
export async function removeStoreCopy({recordPath,ensureClosed}={}){
 const rec=JSON.parse(fs.readFileSync(recordPath,'utf8')),root=path.resolve(rec.compatibilityRoot||'');
 if(rec.mode!=='storeCopy'||!rec.sourceApp||!rec.userDataDir||!/^claude-compat-[a-zA-Z0-9]+$/.test(path.basename(root)))throw Error('兼容副本归属无法确认，未删除任何文件');
 if(inside(root,rec.sourceApp)||inside(root,rec.userDataDir)||inside(rec.sourceApp,root)||inside(rec.userDataDir,root))throw Error('副本与原程序或数据目录重叠，已停止删除');
 await ensureClosed(path.join(root,'app'));
 if(fs.existsSync(root)){
  if(fs.lstatSync(root).isSymbolicLink()||!same(fs.realpathSync(root),root))throw Error('兼容目录已被重定向，已停止删除');
  const ownerPath=path.join(root,'mydex-compatibility.json');
  if(fs.existsSync(ownerPath)){
   const owner=JSON.parse(fs.readFileSync(ownerPath,'utf8'));
   if(owner.kind!=='mydex-claude-copy'||!rec.ownershipId||owner.ownershipId!==rec.ownershipId||!same(owner.root,root)||!same(owner.sourceApp,rec.sourceApp)||!same(owner.userDataDir,rec.userDataDir))throw Error('兼容副本归属校验失败，未删除');
  }else{
   // 0.4.22 copies predate ownership markers. Require their exact known layout
   // and recovery manifest before offering the same one-click rollback.
   if(rec.ownershipId)throw Error('副本归属标记缺失，未删除');
   const m=JSON.parse(fs.readFileSync(path.join(rec.bridgeRoot,'staged/manifest.json'),'utf8'));
   if(!same(m.appDirectory,path.join(root,'app'))||!inside(path.join(root,'recovery'),rec.bridgeRoot)||fs.readdirSync(root).some(n=>!['app','recovery'].includes(n)))throw Error('旧版副本结构变化，未删除');
   const state=inspectInstallation(recordPath);if(!['installed','notApplied'].includes(state.state))throw Error('旧版副本文件发生变化，未删除');
  }
  assertNoLinks(root);
  // Keep the ownership marker until both owned trees have been removed,
  // so a locked-file failure remains safely retryable.
  for(const name of fs.readdirSync(root)){if(name==='mydex-compatibility.json')continue;if(!['app','recovery'].includes(name))throw Error('副本包含未知文件，未删除');}
  if(!rec.ownershipId){
   rec.ownershipId=crypto.randomUUID();
   fs.writeFileSync(ownerPath,JSON.stringify({kind:'mydex-claude-copy',ownershipId:rec.ownershipId,root,sourceApp:rec.sourceApp,userDataDir:rec.userDataDir}),{flag:'wx',mode:0o600});
   const temp=recordPath+'.removing-'+rec.ownershipId;
   try{fs.writeFileSync(temp,JSON.stringify(rec),{flag:'wx',mode:0o600});fs.renameSync(temp,recordPath);}catch(e){fs.unlinkSync(ownerPath);throw e;}
  }
  for(const name of ['app','recovery']){const target=path.join(root,name);if(!inside(root,target)||same(root,target))throw Error('删除路径不安全');fs.rmSync(target,{recursive:true,force:true});}
  if(fs.existsSync(ownerPath))fs.unlinkSync(ownerPath);fs.rmdirSync(root);
 }
 fs.renameSync(recordPath,recordPath+'.removed-'+Date.now());
 return {ok:true,removed:true,originalPreserved:true,historyPreserved:true};
}
