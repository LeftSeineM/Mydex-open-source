import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {prepareClaude,installClaude} from '../../desktop/bridges/install-claude.mjs';
import {restoreClaude} from '../../desktop/bridges/restore.mjs';

const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const encodeAsar=(version='2.42304.0',source='exports.claudeCodeSessionManager=manager;')=>{
 const pkg=Buffer.from(JSON.stringify({version})),src=Buffer.from(source),tail=Buffer.from('unrelated-file');
 const entry={size:src.length,offset:String(pkg.length),integrity:{algorithm:'SHA256',hash:digest(src),blockSize:16,blocks:[]}};
 const header={files:{'package.json':{size:pkg.length,offset:'0'},'.vite':{files:{build:{files:{'index.chunk-Bn6onBlX.js':entry}}}},other:{size:tail.length,offset:String(pkg.length+src.length)}}};
 const raw=Buffer.from(JSON.stringify(header)),padding=(4-(4+raw.length)%4)%4,inner=Buffer.alloc(4+raw.length+padding);inner.writeUInt32LE(raw.length);raw.copy(inner,4);
 const prefix=Buffer.alloc(12);prefix.writeUInt32LE(4,0);prefix.writeUInt32LE(4+inner.length,4);prefix.writeUInt32LE(inner.length,8);
 const exe=Buffer.concat([Buffer.from('exe '+digest(raw)+' '),Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'),Buffer.from('abcdef1')]);
 return {exe,asar:Buffer.concat([prefix,inner,pkg,src,tail])};
};
const unpack=asar=>{const header=JSON.parse(asar.subarray(16,16+asar.readUInt32LE(12)));return {header,body:asar.subarray(8+asar.readUInt32LE(4))};};
test('bridge preserves other ASAR content and integrity metadata',()=>{
 const original=encodeAsar(),result=prepareClaude(original.exe,original.asar,'/app','/runtime','/descriptor'),{header,body}=unpack(result.asar);
 const target=header.files['.vite'].files.build.files['index.chunk-Bn6onBlX.js'],patched=body.subarray(Number(target.offset),Number(target.offset)+target.size),other=header.files.other;
 assert.match(patched.toString(),/Mydex native bridge/);assert.equal(target.integrity.hash,digest(patched));
 assert.deepEqual(target.integrity.blocks,Array.from({length:Math.ceil(patched.length/16)},(_,i)=>digest(patched.subarray(i*16,(i+1)*16))));
 assert.equal(body.subarray(Number(other.offset),Number(other.offset)+other.size).toString(),'unrelated-file');
 assert.equal(result.manifest.original.exe,digest(original.exe));assert.equal(result.manifest.modified.asar,digest(result.asar));
 assert.ok(result.exe.includes(Buffer.from(digest(result.asar.subarray(16,16+result.asar.readUInt32LE(12))))));
});
test('different version uses structural detection; changed modules and unexpected digest are rejected',()=>{
 const other=encodeAsar('9.0.0');assert.equal(prepareClaude(other.exe,other.asar,'a','r','d').manifest.version,'9.0.0');
 const modified=encodeAsar('2.42304.0','[Mydex native bridge]');assert.throws(()=>prepareClaude(modified.exe,modified.asar,'a','r','d'),/无法唯一识别/);
 const valid=encodeAsar();assert.throws(()=>prepareClaude(Buffer.from('bad'),valid.asar,'a','r','d'),/完整性/);
});
test('locally backed up supported vendor bundle can be staged without changing it',t=>{
 const record=path.join(os.homedir(),'.mydex','desktop-bridges','claude-install.json');if(!fs.existsSync(record)){t.skip('No local Claude backup');return;}
 const root=JSON.parse(fs.readFileSync(record,'utf8')).bridgeRoot,exe=fs.readFileSync(path.join(root,'original','claude.exe')),asar=fs.readFileSync(path.join(root,'original','app.asar'));
 const before=[digest(exe),digest(asar)],result=prepareClaude(exe,asar,'/app','/runtime','/descriptor');
 assert.equal(result.manifest.version,'2.42304.0');assert.deepEqual([digest(exe),digest(asar)],before);assert.notEqual(digest(result.asar),before[1]);
});
test('install backs up and restores original files, refuses overwritten files',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-claude-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const app=path.join(root,'app'),dir=path.join(root,'private'),original=encodeAsar();fs.mkdirSync(path.join(app,'resources'),{recursive:true});
 const exe=path.join(app,'claude.exe'),asar=path.join(app,'resources','app.asar'),rec=path.join(dir,'claude-install.json');fs.writeFileSync(exe,original.exe);fs.writeFileSync(asar,original.asar);
 const options={directory:dir,ensureClosed:async()=>{}};await installClaude(app,options);assert.ok(fs.existsSync(rec));assert.notEqual(digest(fs.readFileSync(exe)),digest(original.exe));
 const modified=fs.readFileSync(exe);fs.writeFileSync(exe,'external update');await assert.rejects(restoreClaude({recordPath:rec,ensureClosed:async()=>{}}),/其他更新修改/);assert.equal(fs.readFileSync(exe,'utf8'),'external update');
 fs.writeFileSync(exe,modified);await restoreClaude({recordPath:rec,ensureClosed:async()=>{}});assert.deepEqual(fs.readFileSync(exe),original.exe);assert.deepEqual(fs.readFileSync(asar),original.asar);assert.ok(!fs.existsSync(rec));
});
test('real backed-up Claude files install and restore in an isolated copy',async t=>{
 const record=path.join(os.homedir(),'.mydex','desktop-bridges','claude-install.json');if(!fs.existsSync(record)){t.skip('No local Claude backup');return;}
 const original=path.join(JSON.parse(fs.readFileSync(record,'utf8')).bridgeRoot,'original');if(!fs.existsSync(path.join(original,'app.asar'))){t.skip('No original application backup');return;}
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-claude-real-copy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const app=path.join(root,'app'),dir=path.join(root,'private');fs.mkdirSync(path.join(app,'resources'),{recursive:true});
 const exe=path.join(app,'claude.exe'),asar=path.join(app,'resources','app.asar');fs.copyFileSync(path.join(original,'claude.exe'),exe);fs.copyFileSync(path.join(original,'app.asar'),asar);
 const before=[digest(fs.readFileSync(exe)),digest(fs.readFileSync(asar))],start=Date.now();await installClaude(app,{directory:dir,ensureClosed:async()=>{}});
 assert.ok(Date.now()-start<30000,'bridge UI timeout exceeded');await restoreClaude({recordPath:path.join(dir,'claude-install.json'),ensureClosed:async()=>{}});
 assert.deepEqual([digest(fs.readFileSync(exe)),digest(fs.readFileSync(asar))],before);
});
