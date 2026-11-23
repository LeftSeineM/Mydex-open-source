import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {discoverApplication} from './discovery.mjs';
import {inspectInstallation} from './install-state.mjs';

const directory=()=>path.join(os.homedir(),'.mydex','desktop-bridges');
const runtimeDir=path.dirname(fileURLToPath(import.meta.url));
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const defs={deepseek:{name:'DeepSeek Harness',exe:'DeepSeek Harness.exe',roots:['D:/Software/DeepSeekHarness']},zcode:{name:'ZCode',exe:'ZCode.exe',roots:['D:/Software/ZCode']}};
const def=id=>{if(!Object.hasOwn(defs,id))throw Error('不支持的工具');return defs[id];};
function* entries(node){for(const entry of Object.values(node.files||{})){if(entry.files)yield* entries(entry);else if(entry.offset!==undefined)yield entry;}}
const record=(id,dir)=>path.join(dir,id+'-install.json');
export const electronInstallationState=(id,dir=directory())=>inspectInstallation(record(id,dir),{manifestName:'manifest.json',exeName:def(id).exe});
export const electronInstalled=(id,dir=directory())=>electronInstallationState(id,dir).installed;

// Structural hooks follow the previously tested desktop-owned adapters.
// No model credentials or vendor applications are included in Mydex.
export function prepareElectron(id,exe,asar,app,runtime,descriptor){
 const d=def(id),raw=asar.subarray(16,16+asar.readUInt32LE(12)),header=JSON.parse(raw),body=asar.subarray(8+asar.readUInt32LE(4));
 const pkg=header.files?.['package.json'];if(!pkg)throw Error(d.name+' 程序结构不兼容');
 const version=JSON.parse(body.subarray(Number(pkg.offset),Number(pkg.offset)+pkg.size)).version;
 const target=id==='deepseek'?header.files?.lib?.files?.['main.js']:header.files?.out?.files?.host?.files?.['index.js'];
 if(!target||target.offset===undefined||!Number.isSafeInteger(target.size))throw Error(d.name+' 会话模块不兼容，未修改程序。');
 const start=Number(target.offset),source=body.subarray(start,start+target.size),text=source.toString('utf8');
 if(text.includes('[Mydex native bridge]'))throw Error(d.name+' 已存在兼容桥；请勿重复安装。');
 let modified;
 if(id==='deepseek'){
  const needle='hostCookie = await authenticateWebHost(ready.url);';if(text.split(needle).length!==2)throw Error('DeepSeek 会话接口已变化，未修改程序。');
  const payload='\n/* [Mydex native bridge] */ mkdirSync('+JSON.stringify(path.dirname(path.resolve(descriptor)))+',{recursive:true});writeFileSync('+JSON.stringify(path.resolve(descriptor))+',JSON.stringify({protocol:1,toolId:"deepseek",pid:process.pid,base:new URL(ready.url).origin,cookie:hostCookie}),{mode:384});\n';
  modified=Buffer.from(text.replace(needle,needle+payload));
 }else{
  if(!text.includes('Gt?.getOptional(Zr)'))throw Error('ZCode 会话接口已变化，未修改程序。');
  const payload='\n/* [Mydex native bridge] */\nimport('+JSON.stringify(pathToFileURL(path.resolve(runtime)).href)+').then(m=>m.default.start({taskService:()=>Gt?.getOptional(Zr),descriptorPath:'+JSON.stringify(path.resolve(descriptor))+'})).catch(e=>console.error("Mydex bridge",e.message));\n';
  modified=Buffer.concat([source,Buffer.from(payload)]);
 }
 const delta=modified.length-source.length;for(const e of entries(header))if(Number(e.offset)>start)e.offset=String(Number(e.offset)+delta);target.size=modified.length;
 if(target.integrity){const i=target.integrity;if(i.algorithm!=='SHA256'||!Number.isSafeInteger(i.blockSize)||i.blockSize<=0)throw Error('不支持的完整性算法');i.hash=digest(modified);i.blocks=[];for(let n=0;n<modified.length;n+=i.blockSize)i.blocks.push(digest(modified.subarray(n,n+i.blockSize)));}
 const hdr=Buffer.from(JSON.stringify(header)),pad=(4-(4+hdr.length)%4)%4,inner=Buffer.alloc(4+hdr.length+pad);inner.writeUInt32LE(hdr.length);hdr.copy(inner,4);const prefix=Buffer.alloc(12);prefix.writeUInt32LE(4);prefix.writeUInt32LE(inner.length+4,4);prefix.writeUInt32LE(inner.length,8);
 const outAsar=Buffer.concat([prefix,inner,body.subarray(0,start),modified,body.subarray(start+source.length)]);
 const old=Buffer.from(digest(raw)),next=Buffer.from(digest(hdr)),pos=exe.indexOf(old);if(pos>=0&&exe.indexOf(old,pos+1)>=0)throw Error('程序完整性信息不唯一，未修改程序。');
 const marker=Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'),fuse=exe.indexOf(marker);if(fuse>=0&&exe[fuse+marker.length+6]===49&&pos<0)throw Error('程序启用完整性验证但摘要未找到，未修改程序。');
 const outExe=Buffer.from(exe);if(pos>=0)next.copy(outExe,pos);
 return {exe:outExe,asar:outAsar,manifest:{id,version,appDirectory:path.resolve(app),exeName:d.exe,original:{exe:digest(exe),asar:digest(asar)},modified:{exe:digest(outExe),asar:digest(outAsar)}}};
}
export async function assertToolClosed(id){
 const d=def(id);if(process.platform!=='win32')throw Error('此兼容桥仅支持 Windows。');
 const query="$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter \"Name='"+d.exe+"'\"; if ($p) { exit 7 }";
 try{await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(query,'utf16le').toString('base64')],{windowsHide:true,timeout:15000});}catch(e){if(e.code===7)throw Error('请先完全退出 '+d.name+'，然后重试。');throw Error('无法确认程序是否已退出，请检查系统权限后重试。');}
}
export async function findElectron(id){def(id);return discoverApplication(id);}
export async function installElectron(id,app,{dir=directory(),ensureClosed=assertToolClosed}={}){
 const d=def(id),rec=record(id,dir);if(fs.existsSync(rec)){if(electronInstallationState(id,dir).state==='notApplied')fs.renameSync(rec,rec+'.not-applied-'+Date.now());else throw Error('此工具已有桥接恢复记录，请先检查并还原。');}await ensureClosed(id);
 app=path.resolve(app);const exe=path.join(app,d.exe),asar=path.join(app,'resources','app.asar');if(!fs.existsSync(exe)||!fs.existsSync(asar))throw Error('未找到 '+d.name+' 程序，请选择正确的安装目录。');
 const origExe=fs.readFileSync(exe),origAsar=fs.readFileSync(asar),staged=prepareElectron(id,origExe,origAsar,app,path.join(runtimeDir,'zcode-session.cjs'),path.join(dir,id+'.json'));
 fs.mkdirSync(dir,{recursive:true});const root=fs.mkdtempSync(path.join(dir,id+'-backup-'));fs.mkdirSync(path.join(root,'original'));fs.mkdirSync(path.join(root,'staged'));
 for(const [folder,name,data] of [['original','app.exe',origExe],['original','app.asar',origAsar],['staged','app.exe',staged.exe],['staged','app.asar',staged.asar]])fs.writeFileSync(path.join(root,folder,name),data);
 fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(staged.manifest,null,2));fs.writeFileSync(rec,JSON.stringify({bridgeRoot:root}),{flag:'wx'});
 try{await ensureClosed(id);if(digest(fs.readFileSync(exe))!==staged.manifest.original.exe||digest(fs.readFileSync(asar))!==staged.manifest.original.asar)throw Error('程序文件发生变化，已停止安装。');fs.copyFileSync(path.join(root,'staged','app.asar'),asar);fs.copyFileSync(path.join(root,'staged','app.exe'),exe);if(!electronInstallationState(id,dir).installed)throw Error('安装后文件校验失败');}
 catch(e){try{if([staged.manifest.original.asar,staged.manifest.modified.asar].includes(digest(fs.readFileSync(asar))))fs.copyFileSync(path.join(root,'original','app.asar'),asar);if([staged.manifest.original.exe,staged.manifest.modified.exe].includes(digest(fs.readFileSync(exe))))fs.copyFileSync(path.join(root,'original','app.exe'),exe);}catch{}throw Error('安装未完成：'+e.message+'。备份已保留，可点击还原。');}
 return {ok:true,version:staged.manifest.version};
}
export async function restoreElectron(id,{dir=directory(),ensureClosed=assertToolClosed}={}){
 const d=def(id),rec=record(id,dir);if(!fs.existsSync(rec))throw Error('未找到 Mydex 安装记录，不能还原其他方式安装的桥。');await ensureClosed(id);
 const root=JSON.parse(fs.readFileSync(rec)).bridgeRoot,m=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));if(m.id!==id||m.exeName!==d.exe)throw Error('备份记录不匹配，已停止还原。');
 const exe=path.join(m.appDirectory,d.exe),asar=path.join(m.appDirectory,'resources','app.asar');for(const [key,dest,source] of [['exe',exe,'app.exe'],['asar',asar,'app.asar']]){if(digest(fs.readFileSync(path.join(root,'original',source)))!==m.original[key])throw Error('原版备份校验失败，未还原。');if(![m.original[key],m.modified[key]].includes(digest(fs.readFileSync(dest))))throw Error('程序已被其他更新修改，请勿覆盖。');}
 fs.copyFileSync(path.join(root,'original','app.asar'),asar);fs.copyFileSync(path.join(root,'original','app.exe'),exe);fs.renameSync(rec,rec+'.restored-'+Date.now());return {ok:true};
}
