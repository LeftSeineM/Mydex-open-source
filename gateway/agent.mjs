import fs from 'node:fs';
import tls from 'node:tls';
import {WebSocket} from 'ws';
import {Adapter} from './adapter.mjs';
const c=JSON.parse(fs.readFileSync(process.argv[2]||'private/agent.json','utf8'));
const adapter=new Adapter(c.local);let delay=1000;
function connect(){
  const url=new URL('/agent',c.gateway);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('device',c.local.id);
  const opts={headers:{Authorization:'Bearer '+c.token},handshakeTimeout:10000};
  // Trust only the configured private CA. Never disable certificate verification.
  if(c.caFile)opts.ca=fs.readFileSync(c.caFile);
  opts.checkServerIdentity=tls.checkServerIdentity;
  const ws=new WebSocket(url,opts);
  const changed=e=>{if(ws.readyState===1)ws.send(JSON.stringify({type:'change',task:e.task}));};
  let lastPing=Date.now();ws.on('ping',()=>lastPing=Date.now());
  const timer=setInterval(()=>{if(Date.now()-lastPing>45000)ws.terminate();},15000);
  ws.on('open',()=>{delay=1000;lastPing=Date.now();adapter.on('change',changed);console.log('Mydex host connected');process.send?.({type:'connection',connected:true});});
  ws.on('message',async data=>{let m;try{m=JSON.parse(data);const result=await adapter.dispatch(m.method,m.args);if(ws.readyState===1)ws.send(JSON.stringify({id:m.id,result}));}catch(e){if(ws.readyState===1)ws.send(JSON.stringify({id:m?.id,error:e.message}));}});
  ws.on('error',()=>{});
  ws.on('close',()=>{process.send?.({type:'connection',connected:false});clearInterval(timer);adapter.off('change',changed);setTimeout(connect,delay+Math.random()*500);delay=Math.min(delay*2,30000);});
}
connect();
