import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import net from 'node:net';
import {BridgeOwner} from './bridge-owner.mjs';
import {createControlServer} from './control-server.mjs';
import {routerRequest} from './router-client.mjs';
import {WorkerEngine} from './workers/engine.mjs';
import {processOwnsLock} from '../../gateway/router/process-lock.mjs';
import {appRoot,dataRoot,controlRoot,protect,writePrivate} from './local-state.mjs';
protect(controlRoot);
const profilePath=path.join(dataRoot,'desktop-profile.json');
const profile=fs.existsSync(profilePath)?JSON.parse(fs.readFileSync(profilePath,'utf8')):{root:dataRoot};
const configPath=path.join(profile.root,'gateway/private/config.json');
if(fs.existsSync(configPath)){
 const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
 const busy=await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port:config.port});const done=value=>{socket.destroy();resolve(value);};socket.once('connect',()=>done(true));socket.once('error',()=>done(false));socket.setTimeout(2000,()=>done(false));});
 if(busy)throw Error('Configured gateway port is already in use; explicitly stop the existing owner before handover');
}
const lock=path.join(controlRoot,'service.lock');
try{const fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,String(process.pid));fs.closeSync(fd);}catch(e){
 if(e.code!=='EEXIST')throw e;const pid=Number(fs.readFileSync(lock,'utf8'));
 const live=processOwnsLock(pid,lock);
 if(live)throw Error('Mydex Agent service already running');
 fs.unlinkSync(lock);const fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,String(process.pid));fs.closeSync(fd);
}
const owner=new BridgeOwner({script:path.join(appRoot,'desktop/gui-bridge.mjs'),env:{...process.env,MYDEX_DATA_DIR:dataRoot,MYDEX_HEADLESS:'1'}});
const token=crypto.randomBytes(48).toString('base64url');
const desktopToken=crypto.randomBytes(48).toString('base64url');
const packageVersion=JSON.parse(fs.readFileSync(path.join(appRoot,'desktop/headless/package.json'),'utf8')).version;
const workers=new WorkerEngine({dir:path.join(dataRoot,'workers')});
const server=createControlServer({owner,token,desktopToken,onShutdown:()=>void shutdown(),pairingDirectory:controlRoot,agentVersion:packageVersion,routerRequest:(operation,args,requestId)=>routerRequest(configPath,operation,args,requestId),workers});
let closing=false,busy=false,timer;
async function shutdown(code=0){if(closing)return;closing=true;clearInterval(timer);workers.close();server.closeAllConnections();server.close();await owner.close();for(const file of ['endpoint.json','desktop-endpoint.json','service.lock'])try{fs.unlinkSync(path.join(controlRoot,file));}catch{}process.exit(typeof code==='number'?code:0);}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
try{
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
const first=await owner.call('status');
// Refuse to create a second owner for an existing gateway. Existing EXE must
// hand over explicitly, or use an isolated profile for installation testing.
if(first.connected){await shutdown();}else if(first.configured)await owner.call('start');
writePrivate(path.join(controlRoot,'endpoint.json'),{pid:process.pid,port:server.address().port,token});
writePrivate(path.join(controlRoot,'desktop-endpoint.json'),{protocol:1,pid:process.pid,port:server.address().port,token:desktopToken,configPath:path.resolve(configPath)});
}catch{
 console.error('Mydex service initialization failed; closing owner and clearing descriptors.');
 await shutdown(1);
}
timer=setInterval(async()=>{if(busy||closing)return;busy=true;try{if(owner.closed){await shutdown();return;}await owner.call('status');}catch{}finally{busy=false;}},5000);
console.log('Mydex independent service ready');
