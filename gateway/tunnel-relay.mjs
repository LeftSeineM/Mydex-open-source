// Opaque TLS byte relay. This service never receives gateway tokens, session
// content or TLS private keys. It cannot request an arbitrary TCP destination.
import http from 'node:http';
import crypto from 'node:crypto';
import {WebSocketServer,createWebSocketStream} from 'ws';
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const secret=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{43}$/.test(s);
export function createTunnelRelay({maxHosts=1000,maxStreams=16}={}) {
  const hosts=new Map(),streams=new Map(),rates=new Map();
  const server=http.createServer((req,res)=>{const ok=['/health','/v1/health'].includes(req.url);res.writeHead(ok?200:404,{'Content-Type':'application/json'});res.end(JSON.stringify({ok}));});
  const wss=new WebSocketServer({noServer:true,maxPayload:256*1024,perMessageDeflate:false});
  const reject=(socket,status=403)=>socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  function closeStream(id){const s=streams.get(id);if(!s)return;streams.delete(id);clearTimeout(s.timer);s.phone.terminate();s.host?.terminate();hosts.get(s.room)?.streams.delete(id);}
  function dropHost(room,entry){if(hosts.get(room)!==entry)return;hosts.delete(room);for(const id of entry.streams)closeStream(id);entry.socket.terminate();}
  server.on('upgrade',(req,socket,head)=>{
    const ip=req.socket.remoteAddress,now=Date.now();let rate=rates.get(ip);
    if(!rate||rate.until<now){rate={n:0,until:now+60000};rates.set(ip,rate);}
    if(++rate.n>180)return reject(socket,429);
    const u=new URL(req.url,'http://relay.invalid');
    const m=/^\/v1\/(host|connect|stream)\/([a-f0-9]{64})$/.exec(u.pathname);
    const token=req.headers.authorization?.replace(/^Bearer /,'');
    if(!m||!secret(token))return reject(socket);
    const [,kind,room]=m,entry=hosts.get(room);
    if(kind==='host'){
      if(digest(token)!==room||(!entry&&hosts.size>=maxHosts))return reject(socket);
    }else if(kind==='connect'){
      if(!entry?.clientHash||digest(token)!==entry.clientHash)return reject(socket);
      if(entry.streams.size>=maxStreams)return reject(socket,429);
    }else{
      const s=streams.get(u.searchParams.get('id'));
      if(!entry||digest(token)!==room||!s||s.room!==room||s.host)return reject(socket);
    }
    wss.handleUpgrade(req,socket,head,ws=>{
      ws.alive=true;ws.on('pong',()=>ws.alive=true);ws.on('error',()=>{});
      if(kind==='host'){
        if(entry)dropHost(room,entry);
        const e={socket:ws,streams:new Set(),clientHash:null};hosts.set(room,e);
        const hello=setTimeout(()=>{if(!e.clientHash)dropHost(room,e);},10000);hello.unref();
        ws.on('message',(data,binary)=>{try{const m=JSON.parse(data);if(binary||m.type!=='hello'||!/^[a-f0-9]{64}$/.test(m.clientHash))throw Error();e.clientHash=m.clientHash;clearTimeout(hello);ws.send(JSON.stringify({type:'ready'}));}catch{dropHost(room,e);}});
        ws.on('close',()=>{clearTimeout(hello);dropHost(room,e);});return;
      }
      if(kind==='connect'){
        const id=crypto.randomBytes(32).toString('base64url');
        const s={room,phone:ws,host:null,timer:setTimeout(()=>closeStream(id),12000)};
        streams.set(id,s);entry.streams.add(id);
        ws.on('close',()=>closeStream(id));
        ws.on('message',()=>closeStream(id)); // no bytes before host is ready
        entry.socket.send(JSON.stringify({type:'open',id}));return;
      }
      const id=u.searchParams.get('id'),s=streams.get(id);if(!s){ws.terminate();return;}
      s.host=ws;clearTimeout(s.timer);s.phone.send(JSON.stringify({type:'ready'}));
      ws.on('close',()=>closeStream(id));
      s.phone.removeAllListeners('message');
      for(const peer of [s.phone,ws])peer.on('message',(_,binary)=>{if(!binary)closeStream(id);});
      // Streaming backpressure matters for APK downloads and slow mobile links.
      const a=createWebSocketStream(s.phone),b=createWebSocketStream(ws);
      a.on('error',()=>closeStream(id));b.on('error',()=>closeStream(id));
      a.pipe(b).pipe(a);
    });
  });
  const timer=setInterval(()=>{
    for(const ws of wss.clients){if(!ws.alive)ws.terminate();else{ws.alive=false;ws.ping();}}
    for(const [ip,r] of rates)if(r.until<Date.now())rates.delete(ip);
  },20000);timer.unref();
  return {server,close(){clearInterval(timer);for(const ws of wss.clients)ws.terminate();wss.close();server.close();}};
}
