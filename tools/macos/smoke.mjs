import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {once} from 'node:events';

const engine=path.resolve(process.argv[2],'Contents/Resources/engine');
// Headless CI verifies the packaged helper can report permission status. This
// does not simulate or claim a real Codex GUI send.
const access=spawn(path.join(engine,'desktop/macos/MydexDesktopAccess'),[],{stdio:['pipe','pipe','pipe']});
let accessOutput='';access.stdout.on('data',b=>accessOutput+=b);
const accessExit=once(access,'exit');access.stdin.end(JSON.stringify({action:'status'}));
assert.equal((await accessExit)[0],0);assert.equal(typeof JSON.parse(accessOutput).trusted,'boolean');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-mac-smoke-'));
const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;await new Promise(r=>server.close(r));
const child=spawn(path.join(engine,'runtime/node'),[path.join(engine,'desktop/macos/bridge.mjs')],{env:{...process.env,MYDEX_DATA_DIR:temp},stdio:['pipe','pipe','ignore']});
const exit=once(child,'exit');
let sequence=0;const pending=new Map();
readline.createInterface({input:child.stdout}).on('line',line=>{
 const r=JSON.parse(line),p=pending.get(r.id);if(!p)return;
 pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(new Error(r.error)):p.resolve(r.result);
});
function call(action,args={}){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Smoke timed out: '+action));},30000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,action,args})+'\n');});}
function devices(pair,ca){return new Promise((resolve,reject)=>{
 const req=https.get(pair.address+'/api/devices',{ca,headers:{Authorization:'Bearer '+pair.token}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>{try{assert.equal(res.statusCode,200);resolve(JSON.parse(text));}catch(e){reject(e);}});});req.on('error',reject);req.setTimeout(2000,()=>req.destroy(new Error('HTTP timeout')));
});}
try{
 assert.equal((await call('status')).configured,false);
 await call('configureHub',{address:'https://127.0.0.1:'+port,name:'Mydex QA Mac'});
 const pair=await call('pairing');const bundle=JSON.parse(pair.bundle.split('\n').slice(1).join('\n'));
 assert.equal(bundle.schema,'mydex.connection.v1');assert.equal(bundle.baseUrl,pair.address);assert.equal(bundle.token,pair.token);
 assert.match(bundle.fingerprint,/^[a-f0-9]{64}$/);
 await call('start');
 const ca=fs.readFileSync(path.join(temp,'gateway/private/server-cert.pem'));
 let result;
 for(let n=0;n<20;n++){try{result=await devices(pair,ca);break;}catch{await new Promise(r=>setTimeout(r,250));}}
 assert.equal(result?.devices?.length,1);assert.equal(result.devices[0].name,'Mydex QA Mac');
 assert.equal((await call('status')).connected,true);
 await call('stop');
 let closed=false;for(let n=0;n<20;n++){try{await devices(pair,ca);}catch{closed=true;break;}await new Promise(r=>setTimeout(r,100));}
 assert(closed,'Owned gateway must stop');
 child.stdin.end();
 const deadline=setTimeout(()=>child.kill(),5000);const [code]=await exit;clearTimeout(deadline);assert.equal(code,0);
 console.log('Bundled macOS engine: configure, pair, TLS auth, single-computer topology, start/stop/exit passed.');
}finally{
 if(child.exitCode===null){child.kill();await exit;}
 for(const p of pending.values())clearTimeout(p.timer);
 assert(path.basename(temp).startsWith('mydex-mac-smoke-'));
 fs.rmSync(temp,{recursive:true,force:true});
}
