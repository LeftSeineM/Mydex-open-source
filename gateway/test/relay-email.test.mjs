import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRelay} from '../relay.mjs';

test('email registration verifies possession, limits guesses, consumes codes once and isolates users',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-email-')),dataFile=path.join(dir,'db.json'),mail=[];
 const relay=createRelay({origin:'https://app.example',dataFile,secureCookies:false,requireVerifiedEmail:true,sendVerification:async m=>mail.push(m)});
 await new Promise(r=>relay.server.listen(0,'127.0.0.1',r));t.after(()=>{relay.close();fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+relay.server.address().port;
 const req=(route,body,cookie)=>fetch(base+'/relay/'+route,{method:body?'POST':'GET',headers:{Origin:'https://app.example','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
 const password='test-password-with-20-chars';
 assert.equal((await req('register',{email:'alice@example.com',password,code:'123456'})).status,400);
 assert.equal((await req('register/code',{email:'not an email'})).status,400);
 assert.equal((await req('register/code',{email:'Alice@example.com'})).status,200);
 assert.equal(mail.length,1);assert.equal(mail[0].email,'alice@example.com');
 assert.equal((await req('register/code',{email:'alice@example.com'})).status,429);
 const code=mail[0].code;
 assert.equal((await req('register',{email:'alice@example.com',password,code:'000000'})).status,400);
 const parallel=await Promise.all([1,2].map(()=>req('register',{email:'alice@example.com',password,code})));
 assert.deepEqual(parallel.map(x=>x.status).sort(),[201,400]);
 const login=await req('login',{username:'alice@example.com',password});assert.equal(login.status,200);const alice=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await req('register/code',{email:'bob@example.com'})).status,200);
 assert.equal((await req('register',{email:'bob@example.com',password,code:mail[1].code})).status,201);
 const bobLogin=await req('login',{username:'bob@example.com',password});const bob=bobLogin.headers.get('set-cookie').split(';')[0];
 const invite=await(await req('pair/start',{name:'Alice laptop'})).json();assert.equal((await req('pair/approve',{code:invite.code,check:invite.check},alice)).status,200);
 assert.equal((await(await req('me',null,alice)).json()).devices.length,1);assert.equal((await(await req('me',null,bob)).json()).devices.length,0);
 const switched=await req('login',{username:'bob@example.com',password},alice);assert.equal(switched.status,200);assert.equal((await req('me',null,alice)).status,401);
 const disk=fs.readFileSync(dataFile,'utf8');assert(!disk.includes(password));assert(!disk.includes('"code"'));assert.equal(JSON.parse(disk).users.length,2);assert(JSON.parse(disk).users.every(u=>u.emailVerifiedAt));
});

test('unconfigured mail fails closed and legacy accounts can be disabled without deleting data',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-email-')),dataFile=path.join(dir,'db.json');
 fs.writeFileSync(dataFile,JSON.stringify({users:[{id:'legacy',name:'legacy',salt:'salt',digest:crypto.scryptSync('test-password-long','salt',64).toString('hex')}],devices:[]}));
 const relay=createRelay({origin:'https://app.example',dataFile,secureCookies:false,requireVerifiedEmail:true});await new Promise(r=>relay.server.listen(0,'127.0.0.1',r));t.after(()=>{relay.close();fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+relay.server.address().port;
 for(const route of ['register/code','register'])assert.equal((await fetch(base+'/relay/'+route,{method:'POST',headers:{Origin:'https://app.example'}})).status,503);
 const r=await fetch(base+'/relay/login',{method:'POST',headers:{Origin:'https://app.example','Content-Type':'application/json'},body:JSON.stringify({username:'legacy',password:'test-password-long'})});assert.equal(r.status,401);
 assert.equal(JSON.parse(fs.readFileSync(dataFile)).users.length,1);
 const html=await(await fetch(base+'/connect/')).text();assert(html.includes('扫描电脑配对码'));assert(html.includes('邮箱注册'));assert(!html.includes('测试账号登录'));
 const qr=await fetch(base+'/connect/qr-decoder.js');assert.equal(qr.status,200);assert((await qr.text()).includes('jsQR'));
});

test('five incorrect codes lock a challenge; delivery failure cannot create an account',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-email-')),mail=[];
 const relay=createRelay({origin:'https://app.example',dataFile:path.join(dir,'db.json'),secureCookies:false,sendVerification:async m=>{if(m.email==='fail@example.com')throw Error('private SMTP detail');mail.push(m);}});
 await new Promise(r=>relay.server.listen(0,'127.0.0.1',r));t.after(()=>{relay.close();fs.rmSync(dir,{recursive:true,force:true});});const base='http://127.0.0.1:'+relay.server.address().port;
 const req=(route,b)=>fetch(base+'/relay/'+route,{method:'POST',headers:{Origin:'https://app.example','Content-Type':'application/json'},body:JSON.stringify(b)});
 const fail=await req('register/code',{email:'fail@example.com'});assert.equal(fail.status,503);assert(!(await fail.text()).includes('private SMTP'));
 await req('register/code',{email:'guess@example.com'});
 for(let i=0;i<5;i++)assert.equal((await req('register',{email:'guess@example.com',password:'test-password-long',code:'000000'})).status,400);
 assert.equal((await req('register',{email:'guess@example.com',password:'test-password-long',code:mail[0].code})).status,400);
});

test('login OTP restores the right account, separates purposes, expires and rejects replay',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-otp-')),dataFile=path.join(dir,'db.json'),mail=[];
 const users=['alice','bob','expired'].map(name=>({id:name,name:name+'@example.com',emailVerifiedAt:'2026-11-01',salt:name,digest:crypto.scryptSync('test-password-long',name,64).toString('hex')}));
 fs.writeFileSync(dataFile,JSON.stringify({users,devices:[{id:'a'.repeat(43),owner:'alice',name:'Alice电脑',tokenHash:'unused'}]}));
 const relay=createRelay({origin:'https://app.example',dataFile,secureCookies:false,requireVerifiedEmail:true,sendVerification:async m=>mail.push(m)});await new Promise(r=>relay.server.listen(0,'127.0.0.1',r));t.after(()=>{relay.close();fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+relay.server.address().port,req=(route,b,cookie)=>fetch(base+'/relay/'+route,{method:b?'POST':'GET',headers:{Origin:'https://app.example','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:b?JSON.stringify(b):undefined});
 await req('login/code',{email:'alice@example.com'});const code=mail[0].code;assert.equal(mail[0].purpose,'login');
 assert.equal((await req('register',{email:'alice@example.com',password:'test-password-long',code})).status,400);
 assert.equal((await req('login/verify',{email:'bob@example.com',code})).status,400);
 const logged=await req('login/verify',{email:'alice@example.com',code});assert.equal(logged.status,200);const cookie=logged.headers.get('set-cookie').split(';')[0];const me=await(await req('me',null,cookie)).json();assert.equal(me.username,'alice@example.com');assert.equal(me.devices[0].name,'Alice电脑');
 assert.equal((await req('login/verify',{email:'alice@example.com',code})).status,400);
 await req('login/code',{email:'expired@example.com'});const original=Date.now;try{Date.now=()=>original()+600001;assert.equal((await req('login/verify',{email:'expired@example.com',code:mail[1].code})).status,400);}finally{Date.now=original;}
 await req('login/code',{email:'missing@example.com'});assert.equal(mail.length,2);assert.equal(JSON.parse(fs.readFileSync(dataFile)).users.length,3);
});
