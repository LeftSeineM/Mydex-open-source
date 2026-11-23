import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {WebSocket,createWebSocketStream} from 'ws';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
export function tunnelIdentity(file){
  if(fs.existsSync(file))return JSON.parse(fs.readFileSync(file,'utf8'));
  const identity={hostSecret:crypto.randomBytes(32).toString('base64url'),clientSecret:crypto.randomBytes(32).toString('base64url')};
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(identity),{mode:0o600,flag:'wx'});return identity;
}
export function startTunnelHost({origin,identity,port,onState=()=>{},allowInsecure=false}){
  const base=new URL(origin);
  if(base.origin!==origin||(!allowInsecure&&base.protocol!=='https:'))throw Error('免账号连接需要 HTTPS 中继');
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid local gateway port');
  const room=hash(identity.hostSecret),active=new Set();let stopped=false,retry,ws,delay=1000,lastPing=Date.now();
  function url(kind,id){const u=new URL(`/v1/${kind}/${room}`,base);u.protocol=base.protocol==='https:'?'wss:':'ws:';if(id)u.searchParams.set('id',id);return u;}
  function connect(){
    if(stopped)return;
    ws=new WebSocket(url('host'),{headers:{Authorization:'Bearer '+identity.hostSecret},handshakeTimeout:10000,maxPayload:8192});
    ws.on('error',()=>{});ws.on('ping',()=>lastPing=Date.now());
    ws.on('open',()=>{lastPing=Date.now();ws.send(JSON.stringify({type:'hello',clientHash:hash(identity.clientSecret)}));});
    ws.on('message',raw=>{
      let m;try{m=JSON.parse(raw);}catch{return;}
      if(m.type==='ready'){delay=1000;onState(true);return;}
      if(m.type!=='open'||!/^[A-Za-z0-9_-]{43}$/.test(m.id)||active.size>=16)return;
      // Fixed loopback destination only. The relay has no control of host/port.
      const tcp=net.connect({host:'127.0.0.1',port});active.add(tcp);
      let data,stream;const cleanup=()=>{active.delete(tcp);tcp.destroy();data?.terminate();};
      tcp.setTimeout(90000,cleanup);tcp.on('error',cleanup);tcp.on('close',cleanup);
      tcp.once('connect',()=>{
        data=new WebSocket(url('stream',m.id),{headers:{Authorization:'Bearer '+identity.hostSecret},handshakeTimeout:10000,maxPayload:256*1024,perMessageDeflate:false});
        data.on('error',cleanup);data.on('close',cleanup);
        stream=createWebSocketStream(data);stream.on('error',cleanup);tcp.pipe(stream).pipe(tcp);
      });
    });
    ws.on('close',()=>{onState(false);for(const tcp of active)tcp.destroy();active.clear();if(!stopped){retry=setTimeout(connect,delay);delay=Math.min(delay*2,15000);}});
  }
  const timer=setInterval(()=>{if(ws?.readyState===1&&Date.now()-lastPing>45000)ws.terminate();},15000);timer.unref();connect();
  return {room,stop(){stopped=true;clearTimeout(retry);clearInterval(timer);ws?.terminate();for(const tcp of active)tcp.destroy();active.clear();}};
}
