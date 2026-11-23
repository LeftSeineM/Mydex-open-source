// Offline integration fixture. Never reads a user configuration or conversation.
import fs from 'node:fs';import https from 'node:https';import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {createTunnelRelay} from '../../gateway/tunnel-relay.mjs';
import {startTunnelHost} from '../../gateway/tunnel-host.mjs';
import {startLanDiscovery} from '../../gateway/lan-discovery.mjs';
const require=createRequire(new URL('../../gateway/package.json',import.meta.url));
const {WebSocketServer}=require('ws');
const cert=fs.readFileSync(new URL('mesh-cert.pem',import.meta.url)),key=fs.readFileSync(new URL('mesh-key.pem',import.meta.url));
const listen=async (s,bind='127.0.0.1')=>{await new Promise(r=>s.listen(0,bind,r));return s.address().port;};
const gateway=https.createServer({cert,key},(req,res)=>{
 res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer fixture-only'){res.writeHead(401);res.end('{}');return;}
 if(req.url==='/api/update/apk'){res.end(Buffer.alloc(2*1024*1024,42));return;} res.end(JSON.stringify({ok:true,method:req.method,url:req.url}));
});const gwPort=await listen(gateway,'0.0.0.0');
const live=new WebSocketServer({server:gateway});live.on('connection',ws=>{ws.send(JSON.stringify({type:'devices'}));ws.on('message',raw=>ws.send(raw.toString()));});
const relay=createTunnelRelay(),relayPort=await listen(relay.server);
const secure=https.createServer({cert,key},(_,res)=>res.end('{}'));
secure.on('upgrade',(req,socket,head)=>relay.server.emit('upgrade',req,socket,head));const securePort=await listen(secure);
const identity={hostSecret:crypto.randomBytes(32).toString('base64url'),clientSecret:crypto.randomBytes(32).toString('base64url')};
let host;await new Promise(resolve=>{host=startTunnelHost({origin:'http://127.0.0.1:'+relayPort,identity,port:gwPort,allowInsecure:true,onState:v=>v&&resolve()});});
const fingerprint=new crypto.X509Certificate(cert).fingerprint256.replaceAll(':','').toLowerCase();
console.log(JSON.stringify({baseUrl:'https://pc-'+host.room.slice(0,32)+'.'+host.room.slice(32)+'.mydex.invalid',relayUrl:'https://localhost:'+securePort,relayToken:identity.clientSecret,fingerprint,directTestUrl:'https://127.0.0.1:'+gwPort}));
let lan;
process.stdin.resume();process.stdin.on('data',raw=>{if(raw.toString().trim()==='lan'){lan=startLanDiscovery({port:gwPort,fingerprint});return;}host.stop();lan?.stop();relay.close();secure.close();gateway.closeAllConnections();gateway.close();for(const c of live.clients)c.terminate();setTimeout(()=>process.exit(),50);});
