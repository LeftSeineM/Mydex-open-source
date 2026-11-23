const assert = require('assert/strict');
const http = require('http');
const { listApiModels } = require('../dist/apiModels');
const key = 'qa-local-placeholder';
let seen = 0;
const server = http.createServer((req, res) => {
  assert.equal(req.headers.authorization, 'Bearer ' + key); seen++;
  if (req.url === '/ok/models') return res.end(JSON.stringify({ data: [{id:'b'}, {id:'a'}, {id:'b'}, {id:9}, {id:'bad\nvalue'}] }));
  if (req.url === '/empty/models') return res.end('{"data":[]}');
  if (req.url === '/redirect/models') { res.writeHead(302, {Location:'/ok/models'}); return res.end(); }
  if (req.url === '/denied/models') { res.writeHead(401); return res.end('Sensitive upstream message: ' + key); }
  if (req.url === '/large/models') return res.end(' '.repeat(2_000_001));
  res.end('{not json');
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.deepEqual(await listApiModels(base + '/ok', key), ['a','b']);
    assert.deepEqual(await listApiModels(base + '/empty/', key), []);
    await assert.rejects(() => listApiModels(base + '/denied', key), error => /401/.test(error.message) && !error.message.includes(key));
    const before=seen; await assert.rejects(() => listApiModels(base + '/redirect', key), /连接失败/); assert.equal(seen, before + 1);
    await assert.rejects(() => listApiModels(base + '/bad', key), /格式无效/);
    await assert.rejects(() => listApiModels(base + '/large', key), /过大/);
    await assert.rejects(() => listApiModels('http://example.com/v1', key), /HTTPS/);
    await assert.rejects(() => listApiModels('https://user:password@example.com/v1', key), /HTTPS/);
    await assert.rejects(() => listApiModels(base + '/ok', ''), /保存 API Key/);
    console.log('PASS models: authenticated discovery, filtering/deduplication, empty list, redacted HTTP error, no redirect, invalid/oversized JSON, URL validation.');
  } finally { server.closeAllConnections(); server.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
