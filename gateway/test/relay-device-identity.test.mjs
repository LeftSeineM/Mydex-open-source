import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRelay} from '../relay.mjs';

test('repeat pairing reuses device identity, preserves namesakes and isolates owners',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-pair-id-'));
 const password='fixture-password-only-123';
 const users=['alice','bob'].map(name=>({id:name,name,salt:name,digest:crypto.scryptSync(password,name,64).toString('hex')}));
 const dataFile=path.join(dir,'accounts.json');fs.writeFileSync(dataFile,JSON.stringify({users,devices:[]}));
 const relay=createRelay({origin:'https://test.example',dataFile,secureCookies:false});
 await new Promise(r=>relay.server.listen(0,'127.0.0.1',r));
 t.after(()=>{relay.close();fs.rmSync(dir,{recursive:true,force:true});});
 const request=(route,body,cookie)=>fetch('http://127.0.0.1:'+relay.server.address().port+route,{method:body?'POST':'GET',headers:{Origin:'https://test.example',...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const login=async name=>(await request('/relay/login',{username:name,password})).headers.get('set-cookie').split(';')[0];
 const alice=await login('alice'),bob=await login('bob');
 async function pair(cookie,identity){
  const started=await request('/relay/pair/start',{name:'Same computer name',...identity});assert.equal(started.status,200);
  const p=await started.json();const approved=await request('/relay/pair/approve',{code:p.code,check:p.check},cookie);assert.equal(approved.status,200);
  return {...await approved.json(),...await(await request('/relay/pair/poll',{code:p.code,secret:p.secret})).json()};
 }
 const first=await pair(alice,{computerId:'a'.repeat(64)});
 const repeat=await pair(alice,{computerId:'a'.repeat(64)});
 assert.equal(repeat.deviceId,first.deviceId);assert.equal(repeat.reused,true);assert.notEqual(repeat.token,first.token);
 const namesake=await pair(alice,{computerId:'b'.repeat(64)});assert.notEqual(namesake.deviceId,first.deviceId);
 const otherOwner=await pair(bob,{computerId:'a'.repeat(64)});assert.notEqual(otherOwner.deviceId,first.deviceId);
 const legacy=await pair(alice,{});
 const migrated=await pair(alice,{computerId:'c'.repeat(64),previousDeviceId:legacy.deviceId,previousToken:legacy.token});assert.equal(migrated.deviceId,legacy.deviceId);
 const devices=(await(await request('/relay/me',null,alice)).json()).devices;assert.equal(devices.length,3);
 assert.equal((await request('/relay/device/revoke',{id:first.deviceId},bob)).status,404);
 assert.equal((await request('/relay/device/revoke',{id:first.deviceId},alice)).status,200);
 assert.equal((await(await request('/relay/me',null,alice)).json()).devices.length,2);
});
