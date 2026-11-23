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

test('large download drains all TLS bytes before either peer closes', {timeout:20000}, async t=>{
  const payload=crypto.randomBytes(18*1024*1024);
  const gateway=https.createServer({cert,key},(_,res)=>{res.writeHead(200,{'Content-Length':payload.length,'Connection':'close'});res.end(payload);});
  const port=await listen(gateway),relay=createTunnelRelay({heartbeatMs:50,idleTimeoutMs:500}),relayPort=await listen(relay.server);
  let host,ws;
  t.after(()=>{ws?.terminate();host?.stop();relay.close();gateway.closeAllConnections();gateway.close();});
  await new Promise(resolve=>{host=startTunnelHost({origin:'http://127.0.0.1:'+relayPort,identity,port,allowInsecure:true,onState:on=>on&&resolve()});});
  ws=new WebSocket(`ws://127.0.0.1:${relayPort}/v1/connect/${room}`,{headers:{Authorization:'Bearer '+identity.clientSecret}});
  await once(ws,'message');
  const socket=tls.connect({socket:createWebSocketStream(ws),ca:cert,servername:'localhost'});
  socket.on('error',()=>{});await once(socket,'secureConnect');
  socket.write('GET /apk HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
  socket.pause();await new Promise(r=>setTimeout(r,200));
  const chunks=[];
  for await(const b of socket){chunks.push(b);await new Promise(r=>setTimeout(r,1));}
  const result=Buffer.concat(chunks),start=result.indexOf('\r\n\r\n')+4;
  assert.equal(result.length-start,payload.length);
  assert.equal(crypto.createHash('sha256').update(result.subarray(start)).digest('hex'),crypto.createHash('sha256').update(payload).digest('hex'));
});

test('our own heartbeat bytes do not keep an unresponsive peer alive', {timeout:2000}, async t=>{
  const relay=createTunnelRelay({heartbeatMs:20,idleTimeoutMs:100}),port=await listen(relay.server);
  const ws=new WebSocket(`ws://127.0.0.1:${port}/v1/host/${room}`,{autoPong:false,headers:{Authorization:'Bearer '+identity.hostSecret}});
  t.after(()=>{ws.terminate();relay.close();});await once(ws,'open');
  ws.send(JSON.stringify({type:'hello',clientHash:crypto.createHash('sha256').update(identity.clientSecret).digest('hex')}));
  await once(ws,'message');const start=Date.now();await once(ws,'close');
  assert.ok(Date.now()-start>=80);assert.ok(Date.now()-start<1000);
});

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
