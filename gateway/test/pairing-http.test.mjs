import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {createHub} from '../../desktop/setup.mjs';
import {createGateway} from '../server.mjs';

test('HTTPS QR exchange needs local authenticated creation and never permits replay', async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-qr-test-'));
 const config=createHub({directory:dir,address:'https://127.0.0.1:18443',standalone:true,name:'QR test'});
 const adapter=new EventEmitter();adapter.dispatch=async()=>({tasks:[]});
 const {server}=createGateway(config,adapter);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();assert(path.basename(dir).startsWith('mydex-qr-test-'));assert.equal(path.dirname(dir),os.tmpdir());fs.rmSync(dir,{recursive:true,force:true});});
 const request=(endpoint,body={},auth=false)=>new Promise((resolve,reject)=>{
  const req=https.request({hostname:'127.0.0.1',port:server.address().port,path:endpoint,method:'POST',ca:fs.readFileSync(config.tls.cert),headers:auth?{Authorization:'Bearer '+config.token}:{}},res=>{let raw='';res.on('data',d=>raw+=d);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(raw)}));});req.on('error',reject);req.end(JSON.stringify(body));
 });
 assert.equal((await request('/api/pairing/create')).status,401);
 const invitation=await request('/api/pairing/create',{},true);assert.equal(invitation.status,200);assert.equal(invitation.data.token,undefined);
 assert.equal((await request('/api/pairing/redeem',{code:'bad'})).status,410);
 const redeemed=await request('/api/pairing/redeem',{code:invitation.data.code});assert.equal(redeemed.status,200);assert.equal(redeemed.data.token,config.token);
 assert.equal((await request('/api/pairing/redeem',{code:invitation.data.code})).status,410);
});
