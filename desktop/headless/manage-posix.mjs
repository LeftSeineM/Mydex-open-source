import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyPackage} from './verify-package.mjs';import {serviceDefinition} from './posix-service.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const atomic=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+crypto.randomUUID();fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600});fs.renameSync(temp,file);};
function run(command,optional=false){if(!command)return;try{execFileSync(command[0],command[1],{stdio:'pipe',timeout:20000});}catch{if(!optional)throw Error('Cannot configure the user service; check systemd --user or the logged-in macOS launchd session');}}
export async function managePosix({action,root,packageDirectory,receipt,waitPid=0}){
 if(!['linux','darwin'].includes(process.platform))throw Error('POSIX manager requires Linux or macOS');
 root=path.resolve(root);if([path.parse(root).root,os.homedir()].includes(root))throw Error('Choose a dedicated installation directory');
 const marker=path.join(root,'mydex-agent-install.json'),current=path.join(root,'current.json'),data=path.join(root,'data');
 const definition=serviceDefinition({root,home:os.homedir(),platform:process.platform,uid:process.getuid()});
 const owned=()=>{const m=JSON.parse(fs.readFileSync(marker,'utf8'));if(m.product!=='mydex-agent'||m.root!==root)throw Error('Not a Mydex-owned installation');};
 const rpc=async action=>{const e=JSON.parse(fs.readFileSync(path.join(data,'agent-control/endpoint.json'),'utf8'));const r=await fetch('http://127.0.0.1:'+e.port+'/rpc',{method:'POST',headers:{Authorization:'Bearer '+e.token,'Content-Type':'application/json'},body:JSON.stringify({action}),signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error('Management operation unavailable');return (await r.json()).result;};
 async function ready(){for(let i=0;i<80;i++){try{const status=await rpc('status');if(!status.configured||status.connected)return status;}catch{}await wait(250);}throw Error('Installed service did not become ready');}
 async function stop(){run(definition.stop,true);try{await rpc('shutdown');}catch{}}
 const complete=result=>{if(receipt)atomic(receipt,result);return result;};
 if(waitPid){for(let i=0;i<120;i++){try{process.kill(waitPid,0);}catch{break;}if(i===119)throw Error('Caller has not disconnected');await wait(500);}}
 if(['start-service','stop-service','uninstall'].includes(action)){
  owned();if(action==='start-service'){if(definition.kind==='launchd')run(definition.stop,true);run(definition.start);const state=await ready();return complete({ok:true,started:true,configured:state.configured,connected:state.connected});}
  await stop();if(action==='stop-service')return complete({ok:true,stopped:true});
  run(definition.remove,true);
  if(fs.existsSync(definition.file)){if(!fs.readFileSync(definition.file,'utf8').includes(root.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'))&&!fs.readFileSync(definition.file,'utf8').includes(root))throw Error('Service ownership mismatch');fs.unlinkSync(definition.file);}
  run(definition.reload,true);
  for(const name of ['releases','runtime-node','mydex-agent','agent-entry.mjs','mydex-mcp.json','current.json','mydex-agent-install.json']){const target=path.join(root,name);if(!target.startsWith(root+path.sep))throw Error('Unsafe removal');fs.rmSync(target,{recursive:name==='releases',force:true});}
  atomic(path.join(root,'mydex-agent-data.json'),{product:'mydex-agent',configurationPreserved:true});return complete({ok:true,uninstalled:true,configurationPreserved:true});
 }
 if(!['install','update'].includes(action))throw Error('Unknown lifecycle operation');
 const pkg=fs.realpathSync(packageDirectory),manifest=verifyPackage(pkg);
 if(fs.existsSync(marker))owned();else if(fs.existsSync(root)&&fs.readdirSync(root).some(n=>!['data','mydex-agent-data.json'].includes(n)))throw Error('Choose an empty or existing Mydex directory');
 // A public package must never replace the private Router testing channel.
 const profileFile=path.join(data,'desktop-profile.json');
 if(manifest.features?.router===false&&fs.existsSync(profileFile)){
  const profile=JSON.parse(fs.readFileSync(profileFile));const file=path.join(profile.root,'gateway/private/config.json');const config=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};
  if(config.router?.enabled)throw Error('Keep this private Router installation on its private update channel');
 }
 fs.mkdirSync(root,{recursive:true,mode:0o700});fs.mkdirSync(data,{recursive:true,mode:0o700});
 const lock=path.join(root,'.installation-lock');let fd;
 try{fd=fs.openSync(lock,'wx');}catch(error){
  if(error.code!=='EEXIST')throw error;
  const pid=Number(fs.readFileSync(lock,'utf8'));if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Invalid installer lock; inspect before recovery');
  let gone=false;try{process.kill(pid,0);}catch(e){gone=e.code==='ESRCH';}if(!gone)throw Error('Another installation may be running');
  fs.unlinkSync(lock);fd=fs.openSync(lock,'wx');
 }fs.writeFileSync(fd,String(process.pid));
 let previous=null;
 try{
  if(fs.existsSync(current))previous=JSON.parse(fs.readFileSync(current));
  const slot=manifest.version+'-'+crypto.randomUUID().slice(0,8),dest=path.join(root,'releases',slot);fs.mkdirSync(dest,{recursive:true,mode:0o700});
  for(const f of manifest.files){const to=path.join(dest,f.path);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(pkg,f.path),to);}
  fs.copyFileSync(path.join(pkg,'agent-package.json'),path.join(dest,'agent-package.json'));fs.chmodSync(path.join(dest,'runtime/bin/node'),0o755);verifyPackage(dest);
  await stop();
  fs.writeFileSync(path.join(root,'mydex-agent'),'#!/bin/sh\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$ROOT/runtime-node" "$ROOT/agent-entry.mjs" "$@"\n',{mode:0o755});
  fs.writeFileSync(path.join(root,'agent-entry.mjs'),`import fs from 'node:fs';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';\nconst root=path.dirname(fileURLToPath(import.meta.url));process.env.MYDEX_INSTALL_ROOT=root;process.env.MYDEX_DATA_DIR=path.join(root,'data');const p=JSON.parse(fs.readFileSync(path.join(root,'current.json')));if(!/^[0-9.]+-[a-f0-9-]+$/.test(p.slot))throw Error('Invalid release pointer');const entry=path.join(root,'releases',p.slot,'desktop/headless',process.argv[2]==='--mcp'?'mcp.mjs':process.argv[2]==='service'?'service.mjs':'cli.mjs');if(process.argv[2]==='--mcp'||process.argv[2]==='service')process.argv.splice(2,1);await import(pathToFileURL(entry));\n`,{mode:0o600});
  const link=path.join(root,'runtime-node');try{fs.unlinkSync(link);}catch(e){if(e.code!=='ENOENT')throw e;}fs.symlinkSync(path.join(dest,'runtime/bin/node'),link);
  atomic(current,{version:manifest.version,slot});atomic(marker,{product:'mydex-agent',root,service:definition.label});
  atomic(path.join(root,'mydex-mcp.json'),{mcpServers:{mydex:{command:path.join(root,'mydex-agent'),args:['--mcp']}}});
  fs.mkdirSync(path.dirname(definition.file),{recursive:true});fs.writeFileSync(definition.file,definition.content,{mode:0o600});run(definition.reload);run(definition.start);
  const state=await ready();return complete({ok:true,installed:true,version:manifest.version,autostart:true,configurationPreserved:true,configured:state.configured,connected:state.connected});
 }catch(error){
  await stop();
  if(previous){atomic(current,previous);const link=path.join(root,'runtime-node');try{fs.unlinkSync(link);}catch{}fs.symlinkSync(path.join(root,'releases',previous.slot,'runtime/bin/node'),link);run(definition.start,true);}
  else {run(definition.remove,true);if(fs.existsSync(definition.file))fs.unlinkSync(definition.file);run(definition.reload,true);}
  throw error;
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
 try{console.log(JSON.stringify(await managePosix({action:args.action,root:args.root,packageDirectory:args.package,receipt:args.receipt,waitPid:Number(args['wait-pid']||0)})));}
 catch{if(args.receipt)atomic(args.receipt,{ok:false,error:'Lifecycle failed; inspect the user service and retained configuration before retrying'});console.error('Mydex lifecycle failed. Configuration retained; check platform, service session and package verification.');process.exitCode=1;}
}
