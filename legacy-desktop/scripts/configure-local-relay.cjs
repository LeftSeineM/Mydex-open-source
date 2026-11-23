// One-time local relay setup. Secrets stay in memory and OS-encrypted storage.
// Does not create keys, alter quotas, import OAuth credentials, or print secrets.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const deploy = 'E:\\AAAA课程学习\\软件设计\\AAAA黑客松\\sub2api-deploy';
const base = 'http://127.0.0.1:18080';
app.setName('My Harness');
app.setPath('userData', path.join(app.getPath('appData'), 'My Harness'));
for (const stream of [process.stdout, process.stderr]) stream.on('error', error => { if (error.code !== 'EPIPE') throw error; });
const secrets = [];
const clean = value => secrets.reduce((s, secret) => secret ? s.split(secret).join('[redacted]') : s, String(value)).replace(/sk-[\w-]{20,}/g, '[redacted]');
async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  let body; try { body = await response.json(); } catch { throw new Error('Non-JSON response, HTTP ' + response.status); }
  if (!response.ok) throw new Error('HTTP ' + response.status + ' (' + (body.code || body.error?.code || 'request_failed') + ')');
  if (body.code !== undefined && body.code !== 0) throw new Error('Relay code ' + body.code);
  return body.data ?? body;
}
async function relayAccess() {
  // Read only the named deployment's bootstrap admin credentials.
  const env = fs.readFileSync(path.join(deploy, '.env'), 'utf8');
  function field(name) {
    const line = env.split(/\r?\n/).find(value => value.startsWith(name + '='));
    const value = line?.slice(name.length + 1).trim() || '';
    return value.replace(/^(['"])(.*)\1$/, '$2');
  }
  const email = field('ADMIN_EMAIL'), password = field('ADMIN_PASSWORD');
  if (!email || !password) throw new Error('Deployment admin credentials are missing');
  secrets.push(password);
  const auth = await json(base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (auth.requires_2fa || !auth.access_token) throw new Error('Interactive administrator authentication required');
  secrets.push(auth.access_token);
  const headers = { Authorization: 'Bearer ' + auth.access_token };
  // User/key identifiers were verified in the existing relay task's test record.
  const record = await json(base + '/api/v1/admin/users/2/api-keys', { headers });
  const keys = Array.isArray(record) ? record : (record.items || record.data || []);
  const key = keys.find(k => k.id === 2 && k.status === 'active');
  if (!key || !key.key || (key.expires_at && Date.parse(key.expires_at) <= Date.now())) throw new Error('The previously tested key is absent, inactive, or expired; no configuration changed');
  if (key.quota > 0 && key.quota_used >= key.quota) throw new Error('Existing key quota exhausted; no configuration changed');
  secrets.push(key.key);
  const models = await json(base + '/v1/models', { headers: { Authorization: 'Bearer ' + key.key } });
  const modelIds = (Array.isArray(models) ? models : models.data || []).map(m => m.id);
  return { key: key.key, keyId: key.id, keyName: key.name, quota: key.quota, quotaUsed: key.quota_used, models: modelIds };
}
app.whenReady().then(async () => {
  let engine;
  const timeout = setTimeout(() => { console.error('Verification deadline exceeded'); engine?.dispose(); app.exit(1); }, 180000);
  try {
    const relay = await relayAccess();
    console.log(JSON.stringify({ relay: base, keyId: relay.keyId, keyName: relay.keyName, quota: relay.quota, quotaUsed: relay.quotaUsed, models: relay.models, secretExposed: false }));
    if (!process.argv.includes('--configure')) return;
    const { SettingsStore } = require('../dist/settingsStore');
    const store = new SettingsStore();
    await store.load();
    const folder = app.getPath('userData');
    const backup = path.join(folder, 'before-relay-' + new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(backup, { recursive: true });
    for (const file of ['settings.json', 'api-key.enc']) if (fs.existsSync(path.join(folder, file))) fs.copyFileSync(path.join(folder, file), path.join(backup, file));
    await store.saveApiKey(relay.key);
    const workspace = path.join(__dirname, '..', 'connection-check');
    fs.mkdirSync(workspace, { recursive: true });
    const settings = await store.update({ localExecutable: '', apiBaseUrl: base + '/v1', model: 'gpt-5.6-sol', reasoningEffort: 'medium', cwd: workspace });
    const { MydexAppServer } = require('../dist/mydexAppServer');
    engine = new MydexAppServer(() => store.get(), () => store.readApiKey());
    let responseText = ''; let deltaCount = 0;
    engine.on('request', request => engine.respondError(request.id, -32601, 'Connection check must not request tools or permissions'));
    engine.on('log', () => {});
    await engine.initializeState();
    const thread = await engine.startThread({ ...settings, sandbox: 'read-only', approvalPolicy: 'untrusted' });
    await engine.manageThread('rename', thread.id, '中转站连接验证');
    const finished = new Promise((resolve, reject) => {
      engine.on('notification', event => {
        const p = event.params || {};
        if (p.threadId && p.threadId !== thread.id) return;
        if (event.method === 'item/agentMessage/delta') { deltaCount++; responseText += p.delta || ''; }
        if (event.method === 'item/completed' && p.item?.type === 'agentMessage') responseText = p.item.text || responseText;
        if (event.method === 'turn/completed') p.turn?.status === 'completed' ? resolve() : reject(new Error(p.turn?.error?.message || p.turn?.status || 'Turn failed'));
      });
    });
    await engine.startTurn(thread.id, '这是 My Harness 通过我自己的中转 API 发出的真实连接测试。不要调用任何工具、不要读取或修改文件。只回复这一行：MYDEX_RELAY_OK，连接成功。', { ...settings, sandbox: 'read-only', approvalPolicy: 'untrusted' });
    await finished;
    if (!responseText.includes('MYDEX_RELAY_OK')) throw new Error('Reply received without expected verification text');
    const report = { verifiedAt: new Date().toISOString(), baseUrl: settings.apiBaseUrl, model: settings.model, keyId: relay.keyId, threadId: thread.id, text: responseText, deltaCount, profile: folder, backup };
    fs.writeFileSync(path.join(__dirname, '..', 'qa-artifacts', 'relay-live-verification.json'), JSON.stringify(report, null, 2));
    console.log('PASS REAL RELAY ' + JSON.stringify(report));
  } catch (error) {
    console.error(clean(error.message));
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout); engine?.dispose(); app.exit(process.exitCode || 0);
  }
});
