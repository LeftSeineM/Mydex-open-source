import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {installClaude} from '../../desktop/bridges/install-claude.mjs';
import {inspectInstallation} from '../../desktop/bridges/install-state.mjs';
test('failed copy rolls back truthfully and can retry without deleting recovery backups',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-install-retry-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const app=path.join(root,'app'),directory=path.join(root,'bridge');fs.mkdirSync(path.join(app,'resources'),{recursive:true});
 const pkg=Buffer.from(JSON.stringify({version:'test'})),module=Buffer.from('exports.claudeCodeSessionManager={};');
 const header={files:{'package.json':{size:pkg.length,offset:'0'},'.vite':{files:{build:{files:{'index.js':{size:module.length,offset:String(pkg.length)}}}}}}};const raw=Buffer.from(JSON.stringify(header));const inner=Buffer.alloc(4+raw.length+(4-(4+raw.length)%4)%4);inner.writeUInt32LE(raw.length);raw.copy(inner,4);const prefix=Buffer.alloc(12);prefix.writeUInt32LE(4);prefix.writeUInt32LE(inner.length+4,4);prefix.writeUInt32LE(inner.length,8);const asar=Buffer.concat([prefix,inner,pkg,module]);
 const marker=Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'),tail=Buffer.alloc(7);tail[6]=49;const exe=Buffer.concat([Buffer.from(crypto.createHash('sha256').update(raw).digest('hex')),marker,tail]);
 const exePath=path.join(app,'claude.exe'),asarPath=path.join(app,'resources/app.asar');fs.writeFileSync(exePath,exe);fs.writeFileSync(asarPath,asar);
 const originalCopy=fs.copyFileSync;t.mock.method(fs,'copyFileSync',(src,dst,...args)=>{if(dst===exePath&&src.includes('staged'))throw Error('simulated locked executable');return originalCopy(src,dst,...args);});
 await assert.rejects(installClaude(app,{directory,ensureClosed:async()=>{}}),/安装未完成/);const record=path.join(directory,'claude-install.json');assert.equal(inspectInstallation(record).state,'notApplied');assert.equal(JSON.parse(fs.readFileSync(record)).phase,'failed');assert.deepEqual(fs.readFileSync(asarPath),asar);assert.deepEqual(fs.readFileSync(exePath),exe);
 t.mock.restoreAll();const result=await installClaude(app,{directory,ensureClosed:async()=>{}});assert(result.ok);assert(inspectInstallation(record).installed);assert(fs.readdirSync(directory).some(n=>n.startsWith('claude-install.json.not-applied-')));assert.equal(JSON.parse(fs.readFileSync(record)).phase,'filesVerified');
});
