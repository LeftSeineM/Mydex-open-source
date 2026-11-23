import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseMacProcesses} from '../process-discovery.mjs';
import {socketCandidates} from '../platform-sockets.mjs';

test('macOS discovery distinguishes desktop hosts from helpers without command arguments',()=>{
 const rows=parseMacProcesses('  42 /Applications/Claude.app/Contents/MacOS/Claude\n43 /Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper\n44 /Users/demo/My Apps/Codex.app/Contents/MacOS/Codex\n45 /usr/local/bin/claude\n46 /Applications/ZCode.app/Contents/MacOS/ZCode');
 assert.deepEqual(rows.map(r=>r.toolId),['claude-desktop','codex','claude','zcode']);
 assert.equal(rows[1].executable,'/Users/demo/My Apps/Codex.app/Contents/MacOS/Codex');
 assert(rows.every(r=>r.sessionId===null));
});
test('Unix discovery accepts only owned sockets and rejects files and symlinks',{skip:process.platform==='win32'},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-socket-'));
 const endpoint=path.join(dir,'codex-app-tools-test.sock');
 const server=net.createServer();await new Promise(resolve=>server.listen(endpoint,resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
 const regular=path.join(dir,'codex-app-tools-file');fs.writeFileSync(regular,'not a socket');
 const link=path.join(dir,'codex-app-tools-link');fs.symlinkSync(endpoint,link);
 const options={platform:'darwin',temp:dir,env:{},uid:process.getuid()};
 const result=socketCandidates('tools',options);
 assert(result.includes(endpoint));assert(!result.includes(regular));assert(!result.includes(link));
 assert(!socketCandidates('tools',{...options,uid:process.getuid()+1}).includes(endpoint));
});
