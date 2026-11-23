import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { execFile } from 'node:child_process';
import rtc from 'node-datachannel';

const html = fs.readFileSync(new URL('./test.html', import.meta.url));
const route = '/' + crypto.randomBytes(24).toString('hex');
let session;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function closeSession() {
  session?.peer.close();
  session = undefined;
}

async function offer(stun) {
  if (typeof stun !== 'string' || (stun && !/^stun:[a-z0-9.-]+:\d{1,5}$/i.test(stun))) throw Error('请输入 stun:主机名:端口，或留空测试局域网');
  closeSession();
  const peer = new rtc.PeerConnection('Mydex P2P Lab', { iceServers: stun ? [stun] : [] });
  const state = session = { peer, replies: 0, created: Date.now(), answered: false };
  const channel = peer.createDataChannel('mydex-p2p-lab');
  channel.onMessage(message => {
    if (typeof message === 'string' && /^ping:[a-f0-9-]{36}$/.test(message)) {
      channel.sendMessage('pong:' + message.slice(5));
      state.replies++;
    }
  });
  for (let i = 0; i < 64 && session === state && peer.gatheringState() !== 'complete'; i++) await delay(125);
  if (session !== state) throw Error('本次探测已结束');
  const description = peer.localDescription();
  if (!description?.sdp.includes('a=candidate:')) throw Error('没有可用的网络候选地址');
  return { ...description, stun };
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 65536) throw Error('配对信息过长');
  }
  return JSON.parse(body);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const home = `http://127.0.0.1:${server.address().port}`;
  if (req.headers.host !== new URL(home).host || !req.url.startsWith(route + '/')) {
    res.writeHead(404).end();
    return;
  }
  const operation = req.url.slice(route.length + 1);
  if (!operation && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.method !== 'POST' || req.headers.origin !== home || req.headers['content-type'] !== 'application/json') {
      res.writeHead(403).end('{}');
      return;
    }
    const input = await readJson(req);
    let result;
    if (operation === 'offer') result = await offer(input.stun);
    else if (operation === 'answer') {
      if (!session || session.answered || input.type !== 'answer' || typeof input.sdp !== 'string') throw Error('请生成新的邀请，再粘贴手机应答');
      session.peer.setRemoteDescription(input.sdp, 'answer');
      const mid = input.sdp.match(/^a=mid:([^\r\n]+)/m)?.[1];
      if (mid) for (const candidate of input.sdp.match(/^a=candidate:[^\r\n]+/gm) || []) session.peer.addRemoteCandidate(candidate.slice(2), mid);
      session.answered = true;
      result = { accepted: true };
    } else if (operation === 'status') {
      const pair = session?.peer.getSelectedCandidatePair();
      result = { state: session?.peer.state() ?? 'idle', replies: session?.replies ?? 0, candidateTypes: pair ? [pair.local.type, pair.remote.type] : [] };
    } else if (operation === 'exit') {
      result = { closed: true };
      setTimeout(() => { closeSession(); process.exit(0); }, 350).unref();
    } else {
      res.writeHead(404).end('{}');
      return;
    }
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(400).end(JSON.stringify({ error: error instanceof SyntaxError ? '粘贴的测试信息无效' : String(error.message).split('\n')[0].slice(0, 200) }));
  }
});
server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}${route}/`;
  if (process.argv.includes('--automated-check')) console.log(url);
  else execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true });
});
setInterval(() => { if (session && Date.now() - session.created > 5 * 60_000) closeSession(); }, 1000).unref();
setTimeout(() => { closeSession(); process.exit(0); }, 15 * 60_000).unref();
