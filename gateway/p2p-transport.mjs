import net from 'node:net';
import { createRequire } from 'node:module';

const stun = 'stun:stun.cloudflare.com:3478';
const block = 16 * 1024;

// This optional private module shares only the gateway's fixed loopback TLS port.
export function createP2pTransport(port) {
  let rtc;
  try { rtc = createRequire(new URL('../desktop/headless/p2p-lab/server.mjs', import.meta.url))('node-datachannel'); }
  catch { return null; }
  const peers = new Set();
  const handles = new Set();
  async function answer(sdp) {
    if (typeof sdp !== 'string' || sdp.length > 24000 || (sdp.match(/^m=/gm) || []).length !== 1 || !/^m=application /m.test(sdp) || (sdp.match(/^a=candidate:/gm) || []).length > 32) throw Error('无效的P2P协商信息');
    if (peers.size >= 4) throw Error('P2P连接数已达上限');
    const peer = new rtc.PeerConnection('Mydex private', { iceServers:[stun] });
    peers.add(peer);
    let timer;
    function finish() {
      if (!peers.delete(peer)) return;
      clearTimeout(timer);
      peer.close();
    }
    timer = setTimeout(finish, 25000);
    timer.unref();
    peer.onStateChange(state => {
      if (state === 'connected') { clearTimeout(timer); timer = setTimeout(finish, 30 * 60_000); timer.unref(); }
      else if (['failed','closed','disconnected'].includes(state)) finish();
    });
    peer.onDataChannel(channel => {
      if (channel.getLabel() !== 'mydex-tls-v1' || handles.size >= 16) { channel.close(); return; }
      const socket = net.createConnection({host:'127.0.0.1',port,allowHalfOpen:true});
      handles.add(socket);
      let closed = false;
      let announced = false;
      function close() {
        if (closed) return;
        closed = true;
        handles.delete(socket);
        socket.destroy();
        channel.close();
      }
      function ready() {
        if (announced || !channel.isOpen() || socket.connecting || closed) return;
        announced = true;
        try { channel.sendMessage('ready'); } catch { close(); }
      }
      socket.once('connect',ready);
      channel.onOpen(ready);
      channel.onClosed(close);
      channel.onError(close);
      socket.on('error', close);
      socket.setTimeout(120000,close);
      channel.setBufferedAmountLowThreshold(128 * 1024);
      channel.onBufferedAmountLow(() => socket.resume());
      socket.on('data', bytes => {
        try {
          for (let offset=0; offset<bytes.length; offset+=block) channel.sendMessageBinary(bytes.subarray(offset,offset+block));
          if (channel.bufferedAmount()>256*1024) socket.pause();
        } catch { close(); }
      });
      socket.on('end', () => { if (channel.isOpen()) channel.sendMessage('end'); });
      channel.onMessage(data => {
        if (data === 'end') { socket.end(); return; }
        if (!Buffer.isBuffer(data) || data.length>block || socket.writableLength>1024*1024 || socket.writableEnded) { close(); return; }
        socket.write(data);
      });
    });
    try {
      peer.setRemoteDescription(sdp,'offer');
      for (let i=0;i<48 && peers.has(peer) && peer.gatheringState()!=='complete';i++) await new Promise(resolve=>setTimeout(resolve,125));
      const description=peers.has(peer)&&peer.localDescription();
      if (!description?.sdp.includes('a=candidate:')) throw Error('P2P 未找到候选地址');
      return {sdp:description.sdp};
    } catch(error) { finish(); throw error; }
  }
  return { answer, close() { for (const socket of handles) socket.destroy(); for (const peer of [...peers]) peer.close(); peers.clear(); } };
}
