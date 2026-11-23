import fs from 'node:fs';
import path from 'node:path';

export class AntigravitySend {
  constructor(home) {
    this.endpoint = path.join(home,'.gemini/antigravity/sidecar_data/mydex/data/mydex-endpoint.json');
  }

  async call(operation, id, text) {
    try {
      const {port,token} = JSON.parse(fs.readFileSync(this.endpoint,'utf8'));
      if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[a-f0-9]{64}$/.test(token)) throw Error();
      const reply = await fetch(`http://127.0.0.1:${port}/agy`, {
        method:'POST',redirect:'error',signal:AbortSignal.timeout(operation==='send'?17000:6000),
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({operation,id,text})
      });
      const result = await reply.json();
      if (reply.ok) return result;
    } catch {}
    throw Error('Antigravity 未确认请求结果，请在原会话核对后再操作');
  }

  async ready(id) {
    try { return (await this.call(id?'check':'status',id)).ready === true; }
    catch { return false; }
  }
}
