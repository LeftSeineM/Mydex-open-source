import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { AntigravityHistory } from '../antigravity-history.mjs';
import { ToolRegistry } from '../tool-registry.mjs';

test('Antigravity exposes its saved sessions and excerpts through the normal tool registry', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(),'mydex-antigravity-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const store = new AntigravityHistory(home);
  assert.deepEqual(store.list(), []);
  fs.mkdirSync(path.dirname(store.file),{recursive:true});
  const db = new DatabaseSync(store.file);
  db.exec(`CREATE TABLE conversation_summaries(conversation_id TEXT PRIMARY KEY,title TEXT,workspace_uris TEXT,last_modified_time TEXT,preview TEXT);
    CREATE VIRTUAL TABLE conversations_fts USING fts5(conversation_id UNINDEXED,chunk_index UNINDEXED,archived UNINDEXED,user_body,agent_body)`);
  const id = 'c0ffee00-0000-4000-8000-000000000001';
  const archived = 'c0ffee00-0000-4000-8000-000000000002';
  const workspace = path.join(home,'Example');
  const row = db.prepare('INSERT INTO conversation_summaries VALUES(?,?,?,?,?)');
  for (const key of [id,archived]) row.run(key,'Saved AGY chat',JSON.stringify([pathToFileURL(workspace).href]),'2026-11-20T12:00:00Z','fallback preview');
  const excerpt = db.prepare('INSERT INTO conversations_fts VALUES(?,?,?,?,?)');
  excerpt.run(id,0,0,'User excerpt','Agent excerpt');
  excerpt.run(archived,-1,1,'','');
  db.close();
  const registry = new ToolRegistry({homeDir:home});
  registry.bridge.sessions = async ()=>null;
  const items = (await registry.list()).filter(item=>item.toolId==='agy');
  assert.equal(items.length,1);
  assert.equal(items[0].id,`tool:agy:${id}`);
  assert.equal(items[0].cwd,workspace);
  assert.match(items[0].projectId,/^agy:/);
  const detail = await registry.detail(items[0].id);
  assert.deepEqual(detail.messages.slice(1).map(message=>[message.role,message.text]),[['user','User excerpt'],['agent','Agent excerpt']]);
  assert.equal(detail.readOnly,true);
  assert.equal(detail.canApprove,false);
  const tool = (await registry.tools()).find(entry=>entry.id==='agy');
  assert.deepEqual(tool.capabilities,{history:true,send:false,create:false,models:false});
  await assert.rejects(registry.detail(`tool:agy:${archived}`));
  await assert.rejects(registry.detail('tool:agy:../private'));

  // Exercise the actual Sidecar transport and exact argument handling without
  // adding a test message to the user's saved conversations.
  const fixture = path.join(home,'agentapi');
  const sentFile = path.join(home,'sent.json');
  fs.writeFileSync(fixture,`const fs = require('node:fs');
    const [operation,...args] = process.argv.slice(2);
    if (operation === 'get-conversation-metadata' && args[0] === ${JSON.stringify(id)}) process.exit(0);
    if (operation !== 'send-message' || args[0] !== '--' || args[1] !== ${JSON.stringify(id)}) process.exit(1);
    fs.writeFileSync(${JSON.stringify(sentFile)},JSON.stringify(args.slice(1)));`);
  const script = new URL('../antigravity-sidecar.mjs', import.meta.url);
  const {fileURLToPath} = await import('node:url');
  const child = spawn(process.execPath,[fileURLToPath(script),process.execPath],{
    cwd:home,windowsHide:true,stdio:'ignore',
    env:{...process.env,ANTIGRAVITY_EXECUTABLE_DATA_DIR:path.dirname(registry.antigravitySend.endpoint),ANTIGRAVITY_LS_ADDRESS:'fixture'}
  });
  try {
    for(let i=0;i<40 && !await registry.antigravitySend.ready();i++) await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal((await registry.detail(items[0].id)).readOnly,false);
    const message = '中文 "quoted" & newline\nexample';
    assert.deepEqual(await registry.send(items[0].id,message),{accepted:true});
    assert.deepEqual(JSON.parse(fs.readFileSync(sentFile)),[id,message]);
    await assert.rejects(registry.send(`tool:agy:${archived}`,'wrong conversation'));
  } finally {
    const stopped = once(child,'exit');child.kill();await stopped;
  }
});
