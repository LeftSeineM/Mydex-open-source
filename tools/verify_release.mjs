// Read-only verification. Credentials are read from a private file, never printed.
import fs from 'node:fs';
import https from 'node:https';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../gateway/package.json',import.meta.url));
const {WebSocket}=require('ws');
const [file,baseUrl,certificate]=process.argv.slice(2);
const config=JSON.parse(fs.readFileSync(file,'utf8'));
const options={ca:fs.readFileSync(certificate||config.tls.cert),headers:{Authorization:'Bearer '+config.token}};
function get(endpoint,hash=false){return new Promise((resolve,reject)=>{
 const r=https.get(baseUrl+endpoint,options,res=>{
  if(res.statusCode!==200){res.resume();reject(new Error(endpoint+' HTTP '+res.statusCode));return;}
  let chunks=[];const digest=crypto.createHash('sha256');let bytes=0;
  res.on('data',b=>{bytes+=b.length;if(hash)digest.update(b);else chunks.push(b);});
  res.on('end',()=>{try{resolve(hash?{bytes,sha256:digest.digest('hex')}:JSON.parse(Buffer.concat(chunks)));}catch(e){reject(e);}});
  res.on('error',reject);
 });r.setTimeout(20000,()=>r.destroy(new Error('request timed out')));r.on('error',reject);
});}
const devices=await get('/api/devices');
const tasks=await get('/api/tasks');
const tools=await get('/api/tools');
const update=await get('/api/update');
const apk=await get('/api/update/apk',true);
if(apk.sha256!==update.sha256||apk.bytes!==update.size)throw new Error('APK does not match manifest');
const event=await new Promise((resolve,reject)=>{
 const ws=new WebSocket(baseUrl.replace(/^https:/,'wss:')+'/ws',options);
 const timeout=setTimeout(()=>{ws.terminate();reject(new Error('WebSocket timeout'));},10000);
 ws.once('error',e=>{clearTimeout(timeout);reject(e);});
 ws.once('message',raw=>{clearTimeout(timeout);ws.close();resolve(JSON.parse(raw).type);});
});
console.log(JSON.stringify({devices:devices.devices.map(d=>({id:d.id,online:d.online,desktopOnline:d.desktopOnline})),tasks:tasks.tasks.length,tools:tools.tools.length,webSocketFirstEvent:event,update:{version:update.version,versionCode:update.versionCode,...apk}},null,2));
