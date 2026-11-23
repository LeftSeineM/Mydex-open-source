import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {DesktopServiceUpdate} from '../desktop-update.mjs';import {verifyPackage} from '../verify-package.mjs';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-ui-update-')),dataRoot=path.join(root,'data'),pkg=path.join(root,'candidate');
 fs.mkdirSync(dataRoot);fs.mkdirSync(pkg);fs.writeFileSync(path.join(root,'current.json'),JSON.stringify({version:'0.1.17'}));fs.writeFileSync(path.join(root,'mydex-agent-install.json'),'{}');
 const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
 const names=['runtime/node.exe','desktop/gui-bridge.mjs','desktop/headless/service.mjs','desktop/headless/manage.ps1','desktop/headless/mcp.mjs'];
 const files=names.map(name=>{const file=path.join(pkg,name);fs.mkdirSync(path.dirname(file),{recursive:true});const bytes=Buffer.from('fixture');fs.writeFileSync(file,bytes);return {path:name,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};});
 const payload=Buffer.from(JSON.stringify({product:'mydex-agent-windows',version:'0.1.18',files}));fs.writeFileSync(path.join(pkg,'agent-package.json'),JSON.stringify({payload:payload.toString('base64'),signature:crypto.sign(null,payload,privateKey).toString('base64')}));
 const calls=[];const updater=new DesktopServiceUpdate({root,dataRoot,verify:dir=>verifyPackage(dir,publicKey),launch:async(...args)=>{calls.push(args);return {operation:'test-operation'};},receipt:id=>({pending:true,id})});
 t.after(()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 return {root,dataRoot,pkg,updater,calls};
}
test('signed preview and repeated install clicks launch one supervisor operation',async t=>{
 const f=fixture(t);assert.deepEqual(f.updater.inspect(f.pkg),{current:'0.1.17',version:'0.1.18',verified:true});
 const [a,b]=await Promise.all([f.updater.install(),f.updater.install()]);assert.equal(a.operation,b.operation);
 assert.deepEqual(f.calls,[['update',fs.realpathSync(f.pkg)]]);
 assert.equal(f.updater.status(a.operation).pending,true);
});
test('altered package after confirmation never reaches supervisor',async t=>{
 const f=fixture(t);f.updater.inspect(f.pkg);fs.writeFileSync(path.join(f.pkg,'runtime/node.exe'),'tampered');
 await assert.rejects(f.updater.install(),/checksum/);assert.equal(f.calls.length,0);
});
test('wrong profile and absent installation root cannot fall back to another installation',async t=>{
 const f=fixture(t);f.updater.root=undefined;assert.throws(()=>f.updater.inspect(f.pkg),/未绑定/);
 f.updater.root=f.root;f.updater.dataRoot=f.pkg;assert.throws(()=>f.updater.inspect(f.pkg),/不一致/);
 assert.equal(f.calls.length,0);
});
test('uncertain launch is retained rather than retried by another click',async t=>{
 const f=fixture(t);let calls=0;f.updater.launch=async()=>{calls++;throw Error('unknown result');};f.updater.inspect(f.pkg);
 await assert.rejects(f.updater.install(),/unknown/);await assert.rejects(f.updater.install(),/unknown/);assert.equal(calls,1);
});
