import {socketCandidates} from './platform-sockets.mjs';
import net from 'node:net';
import crypto from 'node:crypto';

// Desktop compatibility adapter. It never reads auth.json or any model key.
export class Desktop {
  pipe = null;
  constructor(callerThreadId) { this.callerThreadId = callerThreadId; }
  rpc(pipe, method, params, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const socket = net.connect(pipe);
      let buffer = Buffer.alloc(0), finished = false;
      const finish = (error, value) => {
        if (finished) return; finished = true;
        clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(() => finish(new Error('桌面响应超时；发送结果可能未知，请先查看会话。')), timeout);
      socket.on('error', e => finish(e));
      socket.on('close', () => finish(new Error('Codex 桌面工具接口已关闭或拒绝此客户端')));
      socket.on('connect', () => {
        const data = Buffer.from(JSON.stringify({jsonrpc:'2.0', id:1, method, params}));
        const header = Buffer.alloc(4); header.writeUInt32LE(data.length);
        socket.write(Buffer.concat([header, data]));
      });
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length < 4) return;
        const length = buffer.readUInt32LE(0);
        if (length > 32 * 1024 * 1024) return finish(new Error('桌面响应过大'));
        if (buffer.length < length + 4) return;
        try { const r = JSON.parse(buffer.subarray(4, length + 4)); r.error ? finish(new Error(r.error.message)) : finish(null, r.result); }
        catch (e) { finish(e); }
      });
    });
  }
  async discover() {
    const names = socketCandidates('tools');
    for (const name of names) {
      try {
        const r = await this.rpc(name, 'tools/list', {threadStartKind:'all'}, 1200);
        if (r.tools?.some(t => t.namespace === 'codex_app' && t.name === 'list_threads')) { this.pipe = name; return; }
      } catch {}
    }
    throw new Error('Codex 桌面未运行或当前版本不支持连接');
  }
  async call(tool, args, requestId) {
    if (!this.pipe) await this.discover();
    let r;
    try {
      r = await this.rpc(this.pipe, 'tools/call', {
        callerSource:'codex', namespace:'codex_app', threadId:this.callerThreadId,
        callId:'mydex-'+(requestId||crypto.randomUUID()), turnId:'mydex-'+(requestId||crypto.randomUUID()), tool, arguments:args,
      });
    } catch (e) { this.pipe = null; throw e; } // Never replay writes after an ambiguous timeout.
    if (r.success === false || r.isError) {
      const message = (r.contentItems || r.content || []).some(b =>
        /^Tool response exceeds the size limit\./.test(b.text || ''));
      throw Object.assign(new Error('Codex 桌面拒绝或未完成请求'),
        message ? {code:'DESKTOP_RESPONSE_TOO_LARGE'} : {});
    }
    const blocks = r.contentItems || r.content || [];
    for (const b of blocks) if (b.text) { try { return JSON.parse(b.text); } catch {} }
    return r;
  }
}
