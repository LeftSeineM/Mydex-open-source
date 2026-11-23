import fs from 'node:fs';
import https from 'node:https';
import {WebSocket} from 'ws';
import {allowedPath} from './relay.mjs';

// This connector can reach ONLY the configured loopback gateway. It cannot
// accept an arbitrary destination URL, executable command or local file path.
export function startRelayClient(local,credentials,onState=()=>{}) {
  if(new URL(credentials.origin).protocol!=='https:')throw Error('中继需要 HTTPS');
  const ca=fs.readFileSync(local.tls.cert),headers={Authorization:'Bearer '+local.token};
  const sockets=new Map(),requests=new Set();let stopped=false,retry,ws,delay=1000,lastPing=Date.now();
  const send=value=>{if(ws?.readyState===1&&ws.bufferedAmount<34*1024*1024)ws.send(JSON.stringify(value));};
  function connect(){
    if(stopped)return;
    const url=new URL('/relay/host',credentials.origin);url.protocol='wss:';url.searchParams.set('device',credentials.deviceId);
    ws=new WebSocket(url,{headers:{Authorization:'Bearer '+credentials.token},handshakeTimeout:15000,maxPayload:34*1024*1024});
    ws.on('ping',()=>lastPing=Date.now());
    ws.on('open',()=>{lastPing=Date.now();delay=1000;onState(true);});
    ws.on('error',()=>{});
    ws.on('message',async raw=>{
      let m;try{
        m=JSON.parse(raw);
        if(m.type==='http'){
          if(!allowedPath(m.path)||!['GET','POST'].includes(m.method)||requests.size>=32)throw Error('Invalid request');
          const payload=m.body==null?null:JSON.stringify(m.body);
          if(payload&&Buffer.byteLength(payload)>131072)throw Error('Request too large');
          const h={...headers};if(payload){h['Content-Type']='application/json';h['Idempotency-Key']=String(m.requestId||'');}
          const req=https.request({hostname:'127.0.0.1',port:local.port,path:m.path,method:m.method,ca,headers:h},res=>{
            let size=0,parts=[];res.on('data',part=>{size+=part.length;if(size>24*1024*1024){req.destroy(Error('Response too large'));return;}parts.push(part);});
            res.on('end',()=>send({type:'response',id:m.id,status:res.statusCode,mime:res.headers['content-type']?.split(';')[0],data:Buffer.concat(parts).toString('base64')}));
            res.on('error',()=>send({type:'response',id:m.id,error:'Local response interrupted'}));
          });requests.add(req);req.on('close',()=>requests.delete(req));req.on('error',()=>send({type:'response',id:m.id,error:'Local gateway unavailable'}));req.setTimeout(50000,()=>req.destroy());req.end(payload);return;
        }
        if(m.type==='open'){
          if(sockets.size>=32)throw Error('Too many streams');
          const socket=new WebSocket('wss://127.0.0.1:'+local.port+'/ws',{ca,headers,maxPayload:24*1024*1024});sockets.set(m.channel,socket);socket.pending=[];
          socket.on('open',()=>{for(const value of socket.pending)socket.send(value);socket.pending=[];});
          socket.on('message',data=>send({type:'event',channel:m.channel,data:data.toString()}));
          socket.on('error',()=>{});socket.on('close',()=>{sockets.delete(m.channel);send({type:'closed',channel:m.channel});});return;
        }
        if(m.type==='message'){
          const socket=sockets.get(m.channel);if(!socket)return;
          if(socket.readyState===1)socket.send(m.data);else if(socket.readyState===0&&socket.pending.length<10)socket.pending.push(m.data);return;
        }
        if(m.type==='close'){sockets.get(m.channel)?.close();sockets.delete(m.channel);}
      }catch{if(m?.id)send({type:'response',id:m.id,error:'Relay request rejected'});}
    });
    ws.on('close',code=>{if(code===1008)stopped=true;onState(false);for(const socket of sockets.values())socket.terminate();sockets.clear();for(const req of requests)req.destroy();if(!stopped){retry=setTimeout(connect,delay+Math.random()*500);delay=Math.min(30000,delay*2);}});
  }
  const heartbeat=setInterval(()=>{if(ws?.readyState===1&&Date.now()-lastPing>45000)ws.terminate();},15000);heartbeat.unref();connect();
  return {stop(){stopped=true;clearTimeout(retry);clearInterval(heartbeat);ws?.close();for(const socket of sockets.values())socket.terminate();for(const req of requests)req.destroy();}};
}
