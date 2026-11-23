import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {discoverApplication} from '../../desktop/bridges/discovery.mjs';
import {inspectInstallation} from '../../desktop/bridges/install-state.mjs';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-bridge-discovery-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function app(dir,name){const p=path.join(dir,name);fs.mkdirSync(path.join(p,'resources'),{recursive:true});fs.writeFileSync(path.join(p,'claude.exe'),'original exe');fs.writeFileSync(path.join(p,'resources/app.asar'),'original asar');return p;}
test('running desktop wins over stale conventional path; CLI executable is excluded',async t=>{
 const root=fixture(t),old=app(root,'old'),running=app(root,'WindowsApps/Claude_4/app');
 const found=await discoverApplication('claude',{roots:[old],inventory:async()=>[{exe:path.join(running,'claude.exe'),source:'running'},{exe:path.join(root,'cli/claude.exe'),source:'running'}]});
 assert.equal(found.app,running);assert(found.running);assert(found.store);assert.equal(found.candidates.length,2);
});
test('installed AppX is found without a running process and latest version directory is chosen',async t=>{
 const root=fixture(t);const store=app(root,'Store/Claude/app');const f=await discoverApplication('claude',{roots:[],inventory:async()=>[{app:path.dirname(store),source:'store'}]});assert.equal(f.app,store);
 const local=path.join(root,'Claude');app(local,'app-2.9');const latest=app(local,'app-2.10');const v=await discoverApplication('claude',{roots:[local],inventory:async()=>[]});assert.equal(v.app,latest);
});
test('a recovery record alone never proves installation; cache follows files and remains immutable',t=>{
 const root=fixture(t),dir=app(root,'app'),backup=path.join(root,'backup');fs.mkdirSync(path.join(backup,'staged'),{recursive:true});const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
 const m={appDirectory:dir,version:'test',original:{exe:hash('original exe'),asar:hash('original asar')},modified:{exe:hash('patched exe'),asar:hash('patched asar')}};
 fs.writeFileSync(path.join(backup,'staged/manifest.json'),JSON.stringify(m));const record=path.join(root,'claude-install.json');fs.writeFileSync(record,JSON.stringify({bridgeRoot:backup}));
 assert.equal(inspectInstallation(record).state,'notApplied');assert.equal(inspectInstallation(record).installed,false);
 fs.writeFileSync(path.join(dir,'claude.exe'),'patched exe');fs.writeFileSync(path.join(dir,'resources/app.asar'),'patched asar');assert.equal(inspectInstallation(record).installed,true);
 const state=inspectInstallation(record);state.message='connected';assert.notEqual(inspectInstallation(record).message,'connected');
 fs.writeFileSync(path.join(dir,'resources/app.asar'),'vendor update');assert.equal(inspectInstallation(record).state,'changed');
});
