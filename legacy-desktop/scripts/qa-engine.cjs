const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const assert = require('assert/strict');
// A launcher may close its console while Electron is still alive. Never let a
// closed log pipe turn into a native "uncaught exception" dialog.
for (const stream of [process.stdout, process.stderr]) stream.on('error', error => {
  if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') throw error;
});
const { MydexAppServer } = require('../dist/mydexAppServer');
fs.mkdirSync(path.join(__dirname, '..', 'qa-artifacts'), { recursive: true });
const root = fs.mkdtempSync(path.join(__dirname, '..', 'qa-artifacts', 'engine-'));
const referenceDirectory = path.join(root, '引用目录 with spaces');
fs.mkdirSync(referenceDirectory);
const referenceFile = path.join(referenceDirectory, 'context.txt');
fs.writeFileSync(referenceFile, 'MYDEX_REFERENCED_FOLDER_READ_OK');
const referenceReadCommand = "Write-Output MYDEX_TOOL_OK\nGet-Content -LiteralPath '" + referenceFile.replace(/'/g, "''") + "'";
process.env.MY_HARNESS_ENGINE_HOME = path.join(root, 'engine');
app.setPath('userData', path.join(root, 'data'));
const requests = [];
let engine;
let turnNumber = 0;
let failureMode = false;
let parallelMode = false;
const parallelReplies = [];
const fixturePatch = '*** Begin Patch\n*** Add File: qa-generated.txt\n+MYDEX_FILE_OK\n*** End Patch\n';
const server = http.createServer(async (req, res) => {
  if (!req.url.endsWith('/responses')) { res.writeHead(404).end(); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); requests.push(body);
  console.log('REQUEST', req.url, body.model, JSON.stringify((body.tools || []).map(t => ({ type: t.type, name: t.name }))));
  assert.equal(req.headers.authorization, 'Bearer qa-not-a-real-key');
  if (failureMode) { res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'QA invalid API key', type: 'invalid_request_error', code: 'invalid_api_key' } })); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const id = `resp_${requests.length}`;
  send('response.created', { response: { id, object: 'response', status: 'in_progress', output: [] } });
  if (requests.length <= 2) {
    const item = requests.length === 1 ? { type: 'function_call', id: 'fc_qa_1', call_id: 'call_qa_1', name: 'exec_command', arguments: JSON.stringify({ cmd: referenceReadCommand, max_output_tokens: 1000, yield_time_ms: 1000 }) } : { type: 'custom_tool_call', id: 'ct_qa_2', call_id: 'call_qa_2', name: 'apply_patch', input: fixturePatch };
    send('response.output_item.added', { output_index: 0, item });
    send('response.output_item.done', { output_index: 0, item });
    send('response.completed', { response: { id, status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 } } });
    res.end(); return;
  }
  const text = parallelMode ? (JSON.stringify(body.input).includes('PARALLEL_A') ? 'PARALLEL_REPLY_A' : 'PARALLEL_REPLY_B') : 'MYDEX_API_OK 流式链路正常';
  const item = { type: 'message', id: `msg_${requests.length}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
  send('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
  send('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
  send('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: 'MYDEX_API_OK ' });
  const finish = () => {
    send('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: '流式链路正常' });
    send('response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text });
    send('response.output_item.done', { output_index: 0, item });
    send('response.completed', { response: { id, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 } } });
    res.end();
  };
  if (parallelMode) { parallelReplies.push(finish); if (parallelReplies.length === 2) parallelReplies.splice(0).forEach(done => done()); }
  else setTimeout(finish, 50);
});
const timeout = setTimeout(() => { console.error('QA timeout'); engine?.dispose(); server.close(); app.exit(1); }, 60_000);
app.whenReady().then(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const settings = { localExecutable: '', cwd: root, model: 'gpt-5.2-codex', sandbox: 'workspace-write', approvalPolicy: 'on-request', theme: 'light', activeWebProfile: 'doubao', confirmWebSend: false, maxWebMessagesPerMinute: 3, lastMode: 'agent', agentEngine: 'local', apiBaseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKeyConfigured: true, reasoningEffort: 'medium', projects: [root] };
    engine = new MydexAppServer(() => settings, async () => 'qa-not-a-real-key');
    const events = [];
    engine.on('notification', event => { events.push(event); console.log('EVENT', event.method); });
    engine.on('log', log => console.log('ENGINE', log));
    engine.on('request', request => { console.log('APPROVAL', request.method); engine.respond(request.id, { decision: ['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(request.method) ? 'accept' : 'decline' }); });
    await engine.initializeState();
    const thread = await engine.startThread(settings);
    const complete = new Promise((resolve, reject) => {
      engine.on('notification', event => {
        if (event.method === 'turn/completed') event.params.turn.status === 'completed' ? resolve() : reject(new Error(JSON.stringify(event.params.turn.error)));
      });
    });
    const {referenceFolder,prepareFolderPrompt}=require('../dist/folderReferences');
    const folderRef=await referenceFolder(root,referenceDirectory);
    const referencePrompt=await prepareFolderPrompt(root,'Reply MYDEX_API_OK',[folderRef]);
    await engine.startTurn(thread.id, referencePrompt, settings);
    await complete;
    assert.ok(events.some(e => e.method === 'item/agentMessage/delta' && e.params.delta.includes('MYDEX_API_OK')));
    assert.ok(requests.length >= 2);
    assert.ok(JSON.stringify(requests[0].input).includes('引用目录 with spaces'));
    assert.ok(!JSON.stringify(requests[0].input).includes('MYDEX_REFERENCED_FOLDER_READ_OK'));
    assert.ok(requests[1].input.some(item=>item.type==='function_call_output'&&JSON.stringify(item.output).includes('MYDEX_REFERENCED_FOLDER_READ_OK')));
    assert.ok(requests[1].input.some(item => item.type === 'function_call_output' && JSON.stringify(item.output).includes('MYDEX_TOOL_OK')));
    console.log('TOOL OUTPUTS', JSON.stringify(requests.at(-1).input.filter(item => item.type === 'function_call_output')));
    assert.equal(fs.readFileSync(path.join(root, 'qa-generated.txt'), 'utf8').trim(), 'MYDEX_FILE_OK');
    const resumed = await engine.resumeThread(thread.id, { ...settings, cwd: path.dirname(root) });
    assert.equal(path.resolve(resumed.cwd), path.resolve(root), 'Restoring a thread must not silently change its project');
    assert.ok(JSON.stringify(resumed.turns).includes('引用目录 with spaces'));
    assert.ok(resumed.turns.some(turn => turn.items.some(item => item.type === 'agentMessage' && item.text.includes('MYDEX_API_OK'))));
    await engine.manageThread('rename', thread.id, 'QA 任务');
    assert.ok((await engine.listThreads(root)).some(t => t.id === thread.id && t.name === 'QA 任务'));
    const fork = await engine.manageThread('fork', thread.id);
    assert.notEqual(fork.thread.id, thread.id);
    await engine.manageThread('archive', thread.id);
    assert.ok(!(await engine.listThreads(root)).some(t => t.id === thread.id));
    parallelMode = true;
    const originalRequest=engine.request.bind(engine),wire=[];
    engine.request=(method,params)=>{wire.push({method,params});return originalRequest(method,params);};
    const [parallelA,parallelB]=await Promise.all([engine.startThread(settings),engine.startThread({...settings,sandbox:'read-only'})]);
    const completed = id => new Promise((resolve,reject)=>{
      const handler=e=>{if(e.method==='turn/completed'&&e.params.threadId===id){engine.off('notification',handler);e.params.turn.status==='completed'?resolve(e.params.turn):reject(new Error(JSON.stringify(e.params.turn)));}};
      engine.on('notification',handler);
    });
    const finishedA=completed(parallelA.id),finishedB=completed(parallelB.id);
    await Promise.all([engine.startTurn(parallelA.id,'PARALLEL_A',settings),engine.startTurn(parallelB.id,'PARALLEL_B',{...settings,sandbox:'read-only'})]);
    const [resultA,resultB]=await Promise.all([finishedA,finishedB]);
    assert.ok(JSON.stringify(resultA).includes('PARALLEL_REPLY_A'));assert.ok(!JSON.stringify(resultA).includes('PARALLEL_REPLY_B'));
    assert.ok(JSON.stringify(resultB).includes('PARALLEL_REPLY_B'));assert.ok(!JSON.stringify(resultB).includes('PARALLEL_REPLY_A'));
    assert.equal(wire.find(v=>v.method==='turn/start'&&v.params.threadId===parallelA.id).params.sandboxPolicy.type,'workspaceWrite');
    assert.equal(wire.find(v=>v.method==='turn/start'&&v.params.threadId===parallelB.id).params.sandboxPolicy.type,'readOnly');
    engine.request=originalRequest;parallelMode=false;
    console.log('PASS real-core concurrency: simultaneous A/B Responses requests, isolated completions, exact per-thread sandbox policy payloads.');
    failureMode = true;
    const failed = new Promise(resolve => {
      const handler = event => { if (event.method === 'turn/completed') { engine.off('notification', handler); resolve(event.params.turn); } };
      engine.on('notification', handler);
    });
    await engine.startTurn(fork.thread.id, 'An authentication failure must not be reported as success', settings);
    assert.equal((await failed).status, 'failed');
    const { SettingsStore } = require('../dist/settingsStore');
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ agentEngine: 'web:doubao', activeWebProfile: 'doubao', lastMode: 'web', confirmWebSend: true, model: 'legacy-model' }));
    const store = new SettingsStore(); const migrated = await store.load();
    assert.equal(migrated.model, 'legacy-model');
    for (const key of ['agentEngine', 'activeWebProfile', 'lastMode', 'confirmWebSend']) assert.equal(key in migrated, false);
    await store.saveApiKey('qa-secret-storage');
    await store.update({ model: 'qa' });
    assert.equal(await store.readApiKey(), 'qa-secret-storage');
    assert.ok(!fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8').includes('qa-secret-storage'));
    assert.ok(!fs.readFileSync(path.join(app.getPath('userData'), 'api-key.enc')).includes(Buffer.from('qa-secret-storage')));
    await store.saveApiKey(''); assert.equal(await store.readApiKey(), '');
    const stopped = new Promise(resolve => engine.once('status', resolve));
    engine.process.stdin.emit('error', Object.assign(new Error('QA closed pipe'), { code: 'EPIPE' }));
    assert.equal((await stopped).state, 'stopped');
    await engine.initializeState();
    console.log('PASS engine: initialize, custom API auth, SSE deltas, real command + patch roundtrip, file creation + diff events, turn completion, persisted history, rename, fork, archive, 401 failure classification, encrypted key storage, EPIPE recovery');
    process.exitCode = 0;
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(timeout); engine?.dispose(); server.close(); app.exit(process.exitCode || 0); }
});
