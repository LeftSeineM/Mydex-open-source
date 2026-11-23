import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const validId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const executable = process.argv[2];
const data = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
if (!data || !process.env.ANTIGRAVITY_LS_ADDRESS || !path.isAbsolute(executable ?? '')) {
  throw Error('Run through an enabled Antigravity Sidecar');
}
const token = crypto.randomBytes(32).toString('hex');
const active = new Set();
const server = http.createServer(async (request, response) => {
  const json = (status, result) => {
    response.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'});
    response.end(JSON.stringify(result));
  };
  const actual = Buffer.from(request.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${token}`);
  if (request.method !== 'POST' || request.url !== '/agy' || request.headers.origin || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return json(403,{});
  let id, claimed = false;
  try {
    let raw = '';
    for await (const chunk of request) { raw += chunk; if (raw.length > 26000) return json(413,{}); }
    const params = JSON.parse(raw);
    if (params.operation === 'status') return json(200,{ready:true});
    id = params.id;
    if (!validId.test(id) || !['check','send'].includes(params.operation)) return json(400,{});
    if (active.size >= 4 || active.has(id)) return json(409,{error:'Antigravity 会话正在处理请求'});
    active.add(id); claimed = true;
    await run(executable, ['agentapi','get-conversation-metadata',id], {windowsHide:true,timeout:5000,maxBuffer:256*1024});
    if (params.operation === 'check') return json(200,{ready:true});
    const text = params.text;
    if (typeof text !== 'string' || !text.trim() || text.length > 6000 || text.includes('\0')) return json(400,{error:'消息长度无效'});
    await run(executable, ['agentapi','send-message','--',id,text], {windowsHide:true,timeout:10000,maxBuffer:256*1024});
    return json(200,{accepted:true});
  } catch {
    return json(502,{error:'Antigravity 未确认请求结果，请在原会话核对后再操作'});
  } finally { if (claimed) active.delete(id); }
});
server.requestTimeout = 15000;
server.listen(0,'127.0.0.1',()=>{
  fs.mkdirSync(data,{recursive:true,mode:0o700});
  const file = path.join(data,'mydex-endpoint.json');
  const temporary = file + '.' + process.pid;
  fs.writeFileSync(temporary,JSON.stringify({port:server.address().port,token}),{mode:0o600,flag:'wx'});
  fs.renameSync(temporary,file);
});
