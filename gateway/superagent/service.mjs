import fs from 'node:fs';import {WebSocket} from 'ws';
import {RouterModel} from './provider.mjs';import {Coordinator} from './coordinator.mjs';import {Workers} from './workers.mjs';

const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),provider=JSON.parse(fs.readFileSync(config.providerFile,'utf8'));
const coordinator=new Coordinator({dbFile:config.dbFile,model:new RouterModel(provider),workers:new Workers(config.workers),maxCallsPerHour:config.maxCallsPerHour||30});
let socket,retry,stopped=false,delay=1000,lastPong=Date.now();
const send=value=>{if(socket?.readyState===1&&socket.bufferedAmount<2*1024*1024)socket.send(JSON.stringify(value));};
coordinator.on('change',({task})=>send({type:'change',task}));
function connect(){
 if(stopped)return;const url=new URL('/agent',config.gateway.url);url.protocol='wss:';url.searchParams.set('device','superagent');
 socket=new WebSocket(url,{ca:fs.readFileSync(config.gateway.caFile),headers:{Authorization:'Bearer '+config.gateway.agentToken},maxPayload:4*1024*1024,handshakeTimeout:15000});
 socket.on('open',()=>{delay=1000;lastPong=Date.now();console.log('Superagent private test connected');});socket.on('pong',()=>lastPong=Date.now());socket.on('error',()=>{});
 socket.on('message',async raw=>{let m;try{m=JSON.parse(raw);if(!m.id||typeof m.method!=='string')return;const result=await coordinator.dispatch(m.method,m.args);send({id:m.id,result});}catch(e){if(m?.id)send({id:m.id,error:/[\u4e00-\u9fff]/.test(e.message)?e.message.slice(0,250):'协调请求未完成，请查看任务状态后继续'});}});
 socket.on('close',()=>{if(!stopped){retry=setTimeout(connect,delay);delay=Math.min(delay*2,30000);}});
}
const progress=setInterval(()=>{void coordinator.checkProgress();void coordinator.tracker.poll();},15000);progress.unref();
const heartbeat=setInterval(()=>{if(socket?.readyState===1){if(Date.now()-lastPong>45000)socket.terminate();else socket.ping();}},15000);heartbeat.unref();
connect();
async function stop(){if(stopped)return;stopped=true;clearTimeout(retry);clearInterval(progress);clearInterval(heartbeat);socket?.close();await coordinator.close();process.exit(0);}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
