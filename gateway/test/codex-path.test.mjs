import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {resolveCodexExecutable} from '../codex-path.mjs';
test('replaces expired official version path but preserves explicit custom paths and existing choices',t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-codex-path-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const root=path.join(home,'AppData','Local','OpenAI','Codex','bin');const current=path.join(root,'new','codex.exe');fs.mkdirSync(path.dirname(current),{recursive:true});fs.writeFileSync(current,'fixture');const args={home,platform:'win32'};
 assert.equal(resolveCodexExecutable(path.join(root,'removed','codex.exe'),args),current);
 assert.equal(resolveCodexExecutable('',args),current);
 const custom=path.join(home,'custom','codex.exe');assert.equal(resolveCodexExecutable(custom,args),custom);
 assert.equal(resolveCodexExecutable(current,args),current);
 assert.equal(resolveCodexExecutable('/custom/codex',{home,platform:'darwin'}),'/custom/codex');
});
