import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFile,spawn} from 'node:child_process';import {promisify} from 'node:util';
import {appRoot,controlRoot,protect} from './local-state.mjs';
const operations=path.join(controlRoot,'operations');
export async function lifecycle(action,packageDirectory){
 if(!['install','update','uninstall','start-service','stop-service'].includes(action))throw Error('Unknown lifecycle operation');
 if(action==='update'&&!packageDirectory)throw Error('A verified release package directory is required');
 protect(operations);const id=crypto.randomBytes(16).toString('hex');const receipt=path.join(operations,id+'.json');
 if(process.platform!=='win32'){
  if(!['linux','darwin'].includes(process.platform))throw Error('Unsupported platform');
  const root=process.env.MYDEX_INSTALL_ROOT;if(!root)throw Error('Run install.sh first');
  // Copy the helper and its verification dependencies outside replaceable slots.
  const helper=path.join(operations,id);fs.mkdirSync(helper,{mode:0o700});
  for(const file of ['manage-posix.mjs','verify-package.mjs','posix-service.mjs'])fs.copyFileSync(path.join(appRoot,'desktop/headless',file),path.join(helper,file));
  const argv=[path.join(helper,'manage-posix.mjs'),'--action',action,'--root',root,'--receipt',receipt];
  if(packageDirectory||action==='install')argv.push('--package',path.resolve(packageDirectory||appRoot));
  if(action==='uninstall')argv.push('--wait-pid',String(process.pid));
  const child=spawn(process.execPath,argv,{detached:true,stdio:'ignore',windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
  return {operation:id,receipt,started:true,completed:false,...(action==='uninstall'?{agentTransportWillClose:true}:{})};
 }
 // Keep the helper outside release slots so it survives uninstall and rollback.
 const script=path.join(operations,id+'.ps1');fs.copyFileSync(path.join(appRoot,'desktop/headless/manage.ps1'),script);
 const q=s=>"'"+s.replaceAll("'","''")+"'";
 const root=process.env.MYDEX_INSTALL_ROOT||'D:/Software/MydexAgent';
 const argv=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Action',action,'-Root',root,'-Receipt',receipt];
 if(packageDirectory)argv.push('-Package',path.resolve(packageDirectory));else if(action==='install')argv.push('-Package',appRoot);
 if(action==='uninstall')argv.push('-WaitPid',String(process.pid));
 const ps='Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList @('+argv.map(a=>q('"'+a+'"')).join(',')+')';
 await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{windowsHide:true});
 return {operation:id,receipt,started:true,completed:false,...(action==='uninstall'?{agentTransportWillClose:true}: {})};
}
export function operation(id){if(!/^[a-f0-9]{32}$/.test(id))throw Error('Invalid operation id');const file=path.join(operations,id+'.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{pending:true};}
