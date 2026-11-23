import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {discoverApplication} from './discovery.mjs';
import {inspectInstallation} from './install-state.mjs';
import {isStoreApp,installStoreCopy,claudeProfiles,compatibilityRoot} from './claude-store.mjs';

const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const bridgeDir=path.dirname(fileURLToPath(import.meta.url));
const privateDir=()=>path.join(os.homedir(),'.mydex','desktop-bridges');
function* entries(node){for(const entry of Object.values(node.files||{})){if(entry.files)yield* entries(entry);else if(entry.offset!==undefined)yield entry;}}

// Same ASAR transformation as the previously verified developer tool, but
// runs using Mydex's bundled Node instead of requiring a Python installation.
export function prepareClaude(exe,asar,app,runtime,descriptor){
 const headerSize=asar.readUInt32LE(12), bodyStart=8+asar.readUInt32LE(4);
 const rawHeader=asar.subarray(16,16+headerSize), header=JSON.parse(rawHeader.toString('utf8')), body=asar.subarray(bodyStart);
 const pkg=header.files['package.json'], version=JSON.parse(body.subarray(Number(pkg.offset),Number(pkg.offset)+pkg.size)).version;
 // Claude changes the chunk name across releases. Identify its session module
 // by content, and refuse ambiguous or changed layouts rather than patching
 // a random file. Runtime method checks provide another compatibility gate.
 const files=header.files?.['.vite']?.files?.build?.files;
 if(!files||typeof version!=='string')throw Error('Claude 程序结构不兼容，未修改原程序。');
 const matches=Object.entries(files).filter(([name,entry])=>name.endsWith('.js')&&entry.offset!==undefined&&Number.isSafeInteger(entry.size)&&body.subarray(Number(entry.offset),Number(entry.offset)+entry.size).includes(Buffer.from('exports.claudeCodeSessionManager=')));
 if(matches.length!==1)throw Error('无法唯一识别 Claude 会话模块，未修改原程序。');
 const target=matches[0][1];
 const start=Number(target.offset), source=body.subarray(start,start+target.size);
 if(!source.includes(Buffer.from('exports.claudeCodeSessionManager='))||source.includes(Buffer.from('[Mydex native bridge]')))throw Error('Claude 文件与受支持版本不匹配，未修改原程序。');
 const payload=Buffer.from('\n/* [Mydex native bridge] local compatibility build */\ntry { require('+JSON.stringify(path.resolve(runtime))+').startSessionServer({manager:exports.claudeCodeSessionManager,descriptorPath:'+JSON.stringify(path.resolve(descriptor))+'}).catch(e=>console.error("[Mydex native bridge]",e.message)); }catch(e){ console.error("[Mydex native bridge]",e.message); }\n');
 const modified=Buffer.concat([source,payload]);
 for(const entry of entries(header))if(Number(entry.offset)>start)entry.offset=String(Number(entry.offset)+payload.length);
 target.size=modified.length;
 if(target.integrity){const info=target.integrity;if(info.algorithm!=='SHA256')throw Error('不支持的文件完整性算法');info.hash=hash(modified);info.blocks=[];for(let i=0;i<modified.length;i+=info.blockSize)info.blocks.push(hash(modified.subarray(i,i+info.blockSize)));}
 const newHeader=Buffer.from(JSON.stringify(header)),pad=(4-(4+newHeader.length)%4)%4,inner=Buffer.alloc(4+newHeader.length+pad);inner.writeUInt32LE(newHeader.length);newHeader.copy(inner,4);
 const prefix=Buffer.alloc(12);prefix.writeUInt32LE(4,0);prefix.writeUInt32LE(4+inner.length,4);prefix.writeUInt32LE(inner.length,8);
 const newAsar=Buffer.concat([prefix,inner,body.subarray(0,start),modified,body.subarray(start+source.length)]);
 const oldHash=Buffer.from(hash(rawHeader)),newHash=Buffer.from(hash(newHeader));const at=exe.indexOf(oldHash);
 if(at<0||exe.indexOf(oldHash,at+1)>=0)throw Error('Claude 程序完整性校验信息不匹配，未修改原程序。');
 const marker=Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'),fuse=exe.indexOf(marker);
 if(fuse<0||exe[fuse+marker.length+6]!==49)throw Error('Claude 完整性验证状态不符合要求，未修改原程序。');
 const newExe=Buffer.from(exe);newHash.copy(newExe,at);
 return {exe:newExe,asar:newAsar,manifest:{version,preparedAt:new Date().toISOString(),appDirectory:path.resolve(app),runtime:path.resolve(runtime),original:{exe:hash(exe),asar:hash(asar)},modified:{exe:hash(newExe),asar:hash(newAsar)},integrityValidationEnabled:true,vendorSignaturePreserved:false}};
}

export async function assertClaudeClosed(app){
 if(process.platform!=='win32')throw Error('此兼容桥仅支持 Windows。');
 // Fail closed when process enumeration fails; never terminate the user's work.
 const expected=path.join(path.resolve(app),'claude.exe').replaceAll("'","''");
 const ps="$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\"; foreach($item in $p){if(!$item.ExecutablePath){exit 8};if($item.ExecutablePath -ieq '"+expected+"'){exit 7}}";
 try{await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{windowsHide:true,timeout:15000});}catch(e){if(e.code===7)throw Error('请先在 Claude 的 File 菜单选择 Exit，关闭 Claude 后重试。');throw Error('无法确认 Claude 是否已退出，请检查系统权限后重试。');}
}

export async function findClaude(){
 const found=await discoverApplication('claude');return {...found,profiles:found.app?claudeProfiles(found.app):[],compatibilityRoot:compatibilityRoot()};
}

export async function installClaude(app,{ensureClosed=assertClaudeClosed,directory=privateDir(),storeDirectory,profileDirectory,env,backupDirectory,recordMetadata={}}={}){
 if(isStoreApp(app))return installStoreCopy(app,{directory,ensureClosed,install:installClaude,storeDirectory,profileDirectory,env});
 const installRecord=path.join(directory,'claude-install.json');
 await ensureClosed(app);
 if(fs.existsSync(installRecord)){
  const state=inspectInstallation(installRecord);
  if(state.state==='notApplied')fs.renameSync(installRecord,installRecord+'.not-applied-'+Date.now());
  else throw Error('已有 Claude 桥接恢复记录，请先检查并还原原版后重装。');
 }
 app=path.resolve(app);const exePath=path.join(app,'claude.exe'),asarPath=path.join(app,'resources','app.asar');
 if(!fs.existsSync(exePath)||!fs.existsSync(asarPath))throw Error('没有找到 Claude 程序文件，请选择包含 claude.exe 的目录。');
 const runtime=path.join(bridgeDir,'session-server.cjs'),descriptor=path.join(directory,'claude-desktop.json');
 const originalExe=fs.readFileSync(exePath),originalAsar=fs.readFileSync(asarPath);
 const staged=prepareClaude(originalExe,originalAsar,app,runtime,descriptor);
 fs.mkdirSync(directory,{recursive:true});const backups=backupDirectory||directory;fs.mkdirSync(backups,{recursive:true});const root=fs.mkdtempSync(path.join(backups,'claude-backup-'));fs.mkdirSync(path.join(root,'original'));fs.mkdirSync(path.join(root,'staged'));
 fs.writeFileSync(path.join(root,'original','claude.exe'),originalExe);fs.writeFileSync(path.join(root,'original','app.asar'),originalAsar);
 fs.writeFileSync(path.join(root,'staged','claude.exe'),staged.exe);fs.writeFileSync(path.join(root,'staged','app.asar'),staged.asar);fs.writeFileSync(path.join(root,'staged','manifest.json'),JSON.stringify(staged.manifest,null,2));
 // Record recovery information before touching vendor files. A failed copy is
 // recoverable by the same restore operation, including after a process crash.
 fs.writeFileSync(installRecord,JSON.stringify({...recordMetadata,bridgeRoot:root,phase:'prepared'}),{flag:'wx'});
 try{await ensureClosed(app);if(hash(fs.readFileSync(exePath))!==staged.manifest.original.exe||hash(fs.readFileSync(asarPath))!==staged.manifest.original.asar)throw Error('Claude 文件发生变化，已停止安装。');fs.copyFileSync(path.join(root,'staged','app.asar'),asarPath);fs.copyFileSync(path.join(root,'staged','claude.exe'),exePath);if(!inspectInstallation(installRecord).installed)throw Error('安装后文件校验失败');fs.writeFileSync(installRecord,JSON.stringify({...recordMetadata,bridgeRoot:root,phase:'filesVerified',verifiedAt:new Date().toISOString()}));}
 catch(e){try{if([staged.manifest.original.asar,staged.manifest.modified.asar].includes(hash(fs.readFileSync(asarPath))))fs.copyFileSync(path.join(root,'original','app.asar'),asarPath);if([staged.manifest.original.exe,staged.manifest.modified.exe].includes(hash(fs.readFileSync(exePath))))fs.copyFileSync(path.join(root,'original','claude.exe'),exePath);}catch{}try{fs.writeFileSync(installRecord,JSON.stringify({...recordMetadata,bridgeRoot:root,phase:'failed',error:String(e.message).slice(0,600),failedAt:new Date().toISOString()}));}catch{}throw Error('安装未完成：'+e.message+'。备份已保留，可点击还原。');}
 return {ok:true,version:staged.manifest.version};
}
