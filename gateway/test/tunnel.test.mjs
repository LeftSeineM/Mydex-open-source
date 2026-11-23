import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import tls from 'node:tls';
import crypto from 'node:crypto';
import {once} from 'node:events';
import {WebSocket,createWebSocketStream} from 'ws';
import {createTunnelRelay} from '../tunnel-relay.mjs';
import {startTunnelHost} from '../tunnel-host.mjs';
const cert=fs.readFileSync(new URL('../../test/fixtures/mesh-cert.pem',import.meta.url));
const key=fs.readFileSync(new URL('../../test/fixtures/mesh-key.pem',import.meta.url));
const identity={hostSecret:crypto.randomBytes(32).toString('base64url'),clientSecret:crypto.randomBytes(32).toString('base64url')};
const room=crypto.createHash('sha256').update(identity.hostSecret).digest('hex');
const listen=async server=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));return server.address().port;};

test('opaque tunnel authenticates peers and carries pinned TLS across host reconnect',async t=>{
  const gateway=https.createServer({cert,key},(req,res)=>res.end('PRIVATE-CONTENT-'+req.url));
  const port=await listen(gateway),relay=createTunnelRelay(),relayPort=await listen(relay.server);
  const origin='http://127.0.0.1:'+relayPort;
  let host; t.after(()=>{host?.stop();relay.close();gateway.closeAllConnections();gateway.close();});
  async function start(){await new Promise(resolve=>{host=startTunnelHost({origin,identity,port,allowInsecure:true,onState:on=>on&&resolve()});});}
  await start();
  const unauthorized=new WebSocket(`ws://127.0.0.1:${relayPort}/v1/connect/${room}`,{headers:{Authorization:'Bearer '+'a'.repeat(43)}});
  await new Promise(resolve=>unauthorized.once('error',e=>{assert.match(e.message,/403/);resolve();}));
  async function request(){
    const ws=new WebSocket(`ws://127.0.0.1:${relayPort}/v1/connect/${room}`,{headers:{Authorization:'Bearer '+identity.clientSecret}});
    const [ready]=await once(ws,'message');assert.equal(JSON.parse(ready).type,'ready');
    const captured=[];ws.on('message',d=>captured.push(Buffer.from(d)));
    const stream=createWebSocketStream(ws);
    const socket=tls.connect({socket:stream,ca:cert,servername:'localhost'});
    socket.on('error',()=>{});await once(socket,'secureConnect');
    assert.equal(new crypto.X509Certificate(socket.getPeerCertificate().raw).fingerprint256,new crypto.X509Certificate(cert).fingerprint256);
    socket.write('GET /history HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    let result='';for await(const b of socket)result+=b;
    assert.match(result,/PRIVATE-CONTENT-\/history/);
    assert(!Buffer.concat(captured).includes(Buffer.from('PRIVATE-CONTENT')));
    ws.terminate();
  }
  await request();host.stop();await start();await request();
});
