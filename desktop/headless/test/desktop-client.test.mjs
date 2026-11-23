import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createControlServer} from '../control-server.mjs';
import {SharedDesktopClient} from '../desktop-client.mjs';
import {spawn} from 'node:child_process';import readline from 'node:readline';import {fileURLToPath} from 'node:url';

async function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-shared-client-'));
 const control=path.join(directory,'agent-control');fs.mkdirSync(control);
 const configPath=path.join(directory,'gateway/private/config.json');
 const calls=[];const token='a'.repeat(48),desktopToken='d'.repeat(48);
 const server=createControlServer({token,desktopToken,agentVersion:'test',owner:{call:async(action,args)=>{
  calls.push({action,args});if(args.hang)await new Promise(r=>setTimeout(r,150));
  return {action,connected:true};
 }}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;
 const descriptor={protocol:1,port,token:desktopToken,configPath};
 const file=path.join(control,'desktop-endpoint.json');
 fs.writeFileSync(file,JSON.stringify(descriptor));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});});
 return {directory,calls,port,token,desktopToken,file,descriptor,client:()=>new SharedDesktopClient({directory:control,configPath,timeout:50})};
}

test('two desktop clients share owner and closing either leaves service available',async t=>{
 const f=await fixture(t),a=f.client(),b=f.client();
 const status=await a.call('status');assert.equal(status.sharedOwner,true);assert.equal(status.owned,false);
 a.close();assert.equal((await b.call('status')).connected,true);
 b.close();assert.equal((await f.client().call('status')).connected,true);
 assert.deepEqual(f.calls.map(c=>c.action),['status','status','status']);
});

test('Agent and desktop credentials cannot cross routes or invoke lifecycle takeover',async t=>{
 const f=await fixture(t);
 const post=(route,token,action,origin)=>fetch(`http://127.0.0.1:${f.port}${route}`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify({action})});
 assert.equal((await post('/desktop',f.token,'pairing')).status,403);
 assert.equal((await post('/rpc',f.desktopToken,'status')).status,403);
 assert.equal((await post('/rpc',f.token,'pairing')).status,400);
 assert.equal((await post('/desktop',f.desktopToken,'status','https://example.test')).status,403);
 for(const action of ['shutdown','attach','installUpdate','router','exec'])assert.equal((await post('/desktop',f.desktopToken,action)).status,400);
 assert.equal(f.calls.length,0);
 assert.equal((await post('/desktop',f.desktopToken,'pairing')).status,200);
});

test('config mismatch, unavailable owner and uncertain sends never fall back or replay',async t=>{
 const f=await fixture(t),client=f.client();
 fs.writeFileSync(f.file,JSON.stringify({...f.descriptor,configPath:f.descriptor.configPath+'.other'}));
 await assert.rejects(client.call('start'),/不匹配/);assert.equal(f.calls.length,0);
 fs.writeFileSync(f.file,JSON.stringify(f.descriptor));
 await assert.rejects(client.call('start',{hang:true}),/不会自动重发/);
 await new Promise(r=>setTimeout(r,180));assert.equal(f.calls.length,1);
 fs.unlinkSync(f.file);await assert.rejects(client.call('start'),/未启动替代网关/);
 assert.equal(f.calls.length,1);
});

test('distinct desktop token is mandatory when desktop endpoint is enabled',()=>{
 assert.throws(()=>createControlServer({owner:{},token:'a'.repeat(48),desktopToken:'a'.repeat(48)}),/separate/);
});

test('actual desktop entry exits with window while persistent owner stays callable',async t=>{
 const f=await fixture(t);
 const child=spawn(process.execPath,[fileURLToPath(new URL('../../connection-entry.mjs',import.meta.url))],{env:{...process.env,MYDEX_DATA_DIR:f.directory},windowsHide:true,stdio:['pipe','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();});
 const lines=readline.createInterface({input:child.stdout});child.stderr.resume();
 const reply=new Promise(resolve=>lines.once('line',line=>resolve(JSON.parse(line))));
 child.stdin.write(JSON.stringify({id:1,action:'status',args:null})+'\n');
 assert.equal((await reply).result.sharedOwner,true);
 const exited=new Promise(resolve=>child.once('exit',resolve));child.stdin.end();await exited;lines.close();
 assert.equal(child.exitCode,0);
 assert.equal((await f.client().call('status')).connected,true);
 assert.deepEqual(f.calls.map(c=>c.action),['status','status']);
});
