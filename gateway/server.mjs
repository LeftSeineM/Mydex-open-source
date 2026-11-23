import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import {WebSocketServer} from 'ws';
import {Adapter} from './adapter.mjs';
import {WebAccess} from './web-access.mjs';
import {PairingInvitations} from './pairing.mjs';
import {Predictions} from './predictions.mjs';
import {TaskTransport,summary} from './transport.mjs';

export function authorized(header, token) {
  if(typeof token!=='string'||token.length<24)return false;
  const a=Buffer.from(header||''),b=Buffer.from('Bearer '+token);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
export function createGateway(config,localAdapter) {
  const invitations = new PairingInvitations();
  const webAccess = new WebAccess(config.webOrigins || []);
  const predictions = new Predictions(config.predictionFile);
  const adapters=new Map(),devices=new Map(),cache=new Map(),clients=new Set(),requests=new Map();
  let seq=0;
  const local=localAdapter||new Adapter(config.local);
  const publicTask=(t,d)=>({...t,id:d+'~'+t.id,deviceId:d});
  const broadcast=data=>{const text=JSON.stringify(data);for(const c of clients)if(c.readyState===1&&c.bufferedAmount<2e6)c.send(text);};
  for(const d of config.devices)devices.set(d.id,{id:d.id,name:d.name,online:false,desktopOnline:false,lastSeen:null});
  const update=(id,online,desktopOnline)=>{const d=devices.get(id);if(!d)return;Object.assign(d,{online,desktopOnline:desktopOnline??d.desktopOnline});if(online)d.lastSeen=Date.now();broadcast({type:'devices',devices:[...devices.values()]});};
  adapters.set(config.local.id,{call:(m,a)=>local.dispatch(m,a)});update(config.local.id,true);
  local.on('change',e=>broadcast({type:'task',task:publicTask(transport.page(e.task,config.local.id+'~'+e.task.id),config.local.id)}));
  async function call(id,method,args){const a=adapters.get(id);if(!a)throw Object.assign(new Error('这台电脑当前离线'),{status:503});return a.call(method,args);}
  async function refresh(){
    await Promise.all([...adapters.keys()].map(async id=>{
      try{const r=await call(id,'list',{});cache.set(id,r.tasks.map(t=>publicTask(summary(t),id)));update(id,true,r.desktopOnline);}
      catch{update(id,adapters.has(id),false);}
    }));
    broadcast({type:'tasks',tasks:[...cache.values()].flat()});
  }
  let refreshing=false;
  const timer=setInterval(async()=>{if(refreshing)return;refreshing=true;try{await refresh();}finally{refreshing=false;}},6000);
  timer.unref();
  const parseId=id=>{const at=id.indexOf('~');if(at<1)throw Object.assign(new Error('任务标识无效'),{status:400});return [id.slice(0,at),id.slice(at+1)];};
  const transport=new TaskTransport(async(task,cursor)=>{const[d,id]=parseId(task);return call(d,'detail',{id,cursor:cursor||undefined});},config.token);
  const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
  async function body(req){let b='';for await(const chunk of req){b+=chunk;if(Buffer.byteLength(b)>131072)throw Object.assign(new Error('指令过长'),{status:413});}try{return JSON.parse(b||'{}');}catch{throw Object.assign(new Error('JSON 格式无效'),{status:400});}}
  // Idempotency records survive restart, so an ambiguous mobile retry cannot repeat a task.
  const ledgerFile=config.ledgerFile;let ledger={};if(ledgerFile&&fs.existsSync(ledgerFile))ledger=JSON.parse(fs.readFileSync(ledgerFile,'utf8'));
  const saveLedger=()=>{if(ledgerFile){fs.writeFileSync(ledgerFile+'.tmp',JSON.stringify(ledger));fs.renameSync(ledgerFile+'.tmp',ledgerFile);}};
  async function handle(req,res){
    if(!webAccess.cors(req,res))return json(res,403,{error:'此网页来源尚未获电脑授权'});
    if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
    // QR exchange is the only unauthenticated API. It requires HTTPS and a
    // random, short-lived invitation created locally with existing credentials.
    if(req.method==='POST' && req.url==='/api/pairing/redeem'){
      if(!req.socket.encrypted)return json(res,400,{error:'扫码配对必须使用 HTTPS'});
      try{
        const b=await body(req);
        if(!invitations.redeem(b.code))return json(res,410,{error:'二维码已过期或已使用，请在电脑上刷新'});
        return json(res,200,{token:config.token,name:config.devices.find(d=>d.id===config.local.id)?.name||'我的电脑'});
      }catch(e){return json(res,e.status||400,{error:e.message});}
    }
    if(!authorized(req.headers.authorization,config.token))return json(res,401,{error:'鉴权失败，请核对访问令牌'});
    if(req.method==='POST'&&req.url==='/api/web/ticket'){
      const ticket=webAccess.issue(req.headers.origin);
      return ticket?json(res,200,{ticket}):json(res,403,{error:'网页来源未授权或连接请求过多'});
    }
    const u=new URL(req.url,'http://localhost');let key;
    try{
      if(req.method==='POST'&&u.pathname==='/api/pairing/create'){
        if(!req.socket.encrypted||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return json(res,403,{error:'请在本机生成二维码'});
        return json(res,200,invitations.create());
      }
      if(req.method==='GET'&&['/api/update','/api/update/apk'].includes(u.pathname)){
        const dir=path.resolve(config.updateDir||path.join(path.dirname(config.ledgerFile||'private/requests.json'),'updates'));
        const manifest=path.join(dir,'manifest.json'),apk=path.join(dir,'update.apk');
        if(!fs.existsSync(manifest)||!fs.existsSync(apk))return json(res,404,{error:'主机尚未发布更新'});
        const m=JSON.parse(fs.readFileSync(manifest,'utf8'));
        if(u.pathname==='/api/update')return json(res,200,m);
        res.writeHead(200,{'Content-Type':'application/vnd.android.package-archive','Content-Length':fs.statSync(apk).size,'Cache-Control':'no-store'});
        const stream=fs.createReadStream(apk);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return;
      }
      if(req.method==='GET'&&u.pathname==='/api/devices')return json(res,200,{devices:[...devices.values()],connectedPhones:clients.size});
      if(req.method==='GET'&&u.pathname==='/api/tools'){
        const all=[];await Promise.all([...adapters.keys()].map(async id=>{try{for(const t of await call(id,'tools',{}))all.push({...t,deviceId:id});}catch{}}));return json(res,200,{tools:all});
      }
      const modelMatch=u.pathname.match(/^\/api\/devices\/([^/]+)\/models$/);
      const usageMatch=u.pathname.match(/^\/api\/devices\/([^/]+)\/usage$/);
      if(req.method==='GET'&&usageMatch)return json(res,200,await call(decodeURIComponent(usageMatch[1]),'usage',{toolId:u.searchParams.get('tool')||'codex'}));
      if(req.method==='GET'&&modelMatch)return json(res,200,{models:await call(decodeURIComponent(modelMatch[1]),'models',{})});
      if(req.method==='GET'&&u.pathname==='/api/projects'){
        const projects=[];await Promise.all([...adapters.keys()].map(async id=>{try{for(const p of await call(id,'projects',{}))projects.push({...p,deviceId:id});}catch{}}));return json(res,200,{projects});
      }
      if(req.method==='GET'&&u.pathname==='/api/tasks'){if(!cache.size)await refresh();return json(res,200,{tasks:[...cache.values()].flat(),devices:[...devices.values()]});}
      const contentMatch=u.pathname.match(/^\/api\/tasks\/([^/]+)\/content$/);
      if(req.method==='GET'&&contentMatch)return json(res,200,await transport.content(decodeURIComponent(contentMatch[1]),u.searchParams.get('ref')||'',Number(u.searchParams.get('offset')||0)));
      const imageMatch=u.pathname.match(/^\/api\/images\/([^/]+)\/([a-f0-9]{64})$/);
      const predictionMatch=u.pathname.match(/^\/api\/tasks\/([^/]+)\/prediction$/);
      if(req.method==='POST'&&predictionMatch){
        const [d,id]=parseId(decodeURIComponent(predictionMatch[1]));
        if(d!==config.local.id)return json(res,200,{available:false,reason:'请直接连接会话所在电脑'});
        const task=await call(d,'detail',{id});
        return json(res,200,await predictions.suggest(task));
      }
      if(req.method==='GET'&&imageMatch){const r=await call(imageMatch[1],'image',{key:imageMatch[2]});res.writeHead(200,{'Content-Type':r.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(Buffer.from(r.data,'base64'));}
      const match=u.pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(messages|approve|interrupt|controls|settings|queue|goal|side-chats))?$/);
      if(req.method==='GET'&&match?.[2]==='controls'){const[d,id]=parseId(decodeURIComponent(match[1]));return json(res,200,await call(d,'controls',{id}));}
      if(req.method==='GET'&&match&&!match[2]){const [d,id]=parseId(decodeURIComponent(match[1]));return json(res,200,publicTask(await transport.detail(d+'~'+id,u.searchParams.get('cursor')),d));}
      if(req.method!=='POST')return json(res,404,{error:'接口不存在'});
      const b=await body(req);
      key=req.headers['idempotency-key'];if(typeof key!=='string'||!/^[a-zA-Z0-9-]{16,100}$/.test(key))return json(res,400,{error:'缺少有效的 Idempotency-Key'});
      const digest=crypto.createHash('sha256').update(req.url+JSON.stringify(b)).digest('hex');
      if(ledger[key]){const old=ledger[key];if(old.digest!==digest)return json(res,409,{error:'请求标识已用于另一操作'});return json(res,old.status||409,old.body||{error:'该请求已发送，结果尚未确认；请先查看会话，不要重复发送'});}
      if((u.pathname==='/api/tasks'||match?.[2]==='messages')&&(typeof b.instruction!=='string'||!b.instruction.trim()||b.instruction.length>50000))return json(res,400,{error:'请填写有效指令'});
      ledger[key]={digest,at:Date.now()};saveLedger();
      let result;
      if(u.pathname==='/api/tasks'){if(!devices.has(b.deviceId))throw Object.assign(new Error('请选择电脑'),{status:400});result=publicTask(summary(await call(b.deviceId,'create',b)),b.deviceId);}
      else if(match&&['messages','approve','interrupt','settings','queue','goal','side-chats'].includes(match[2])){const [d,id]=parseId(decodeURIComponent(match[1]));result=await call(d,({messages:'send',approve:'approve',interrupt:'interrupt',settings:'settings',queue:'queue',goal:'goal','side-chats':'sideChat'})[match[2]],{...b,id});if(match[2]==='side-chats')result={...result,id:d+'~desktop:'+result.id,parentId:d+'~desktop:'+result.parentId};}
      else throw Object.assign(new Error('接口不存在'),{status:404});
      if(result?.messages)result=summary(result);
      ledger[key].status=200;ledger[key].body=result;saveLedger();json(res,200,result);void refresh();
    }catch(e){const status=e.status||502;const payload={error:e.message||'连接服务失败'};if(key&&ledger[key]){ledger[key].status=status;ledger[key].body=payload;saveLedger();}if(!res.headersSent)json(res,status,payload);else res.end();}
  }
  const server=config.tls?https.createServer({key:fs.readFileSync(config.tls.key),cert:fs.readFileSync(config.tls.cert)},handle):http.createServer(handle);
  const wss=new WebSocketServer({noServer:true,maxPayload:24*1024*1024});
  server.on('upgrade',(req,socket,head)=>{
    const url=new URL(req.url,'http://localhost');const device=url.searchParams.get('device');
    const token=url.pathname==='/agent'?config.devices.find(d=>d.id===device)?.token:config.token;
    const browserAllowed=!req.headers.origin || webAccess.accepts(req.headers.origin);
    const ticketAllowed=url.pathname==='/ws'&&webAccess.redeem(url.searchParams.get('ticket'),req.headers.origin);
    if(!browserAllowed||!['/ws','/agent'].includes(url.pathname)||!(authorized(req.headers.authorization,token)||ticketAllowed)){socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  wss.on('connection',(ws,req)=>{
    ws.alive=true;ws.on('pong',()=>ws.alive=true);
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/agent'){
      const id=url.searchParams.get('device');if(id===config.local.id){ws.close(1008);return;}
      const old=adapters.get(id);old?.socket?.close(1000,'replaced');
      const adapter={socket:ws,call:(method,args)=>new Promise((resolve,reject)=>{
        const requestId=String(++seq);const timeout=setTimeout(()=>{requests.delete(requestId);reject(new Error('电脑响应超时；请核对会话后重试'));},45000);
        requests.set(requestId,{resolve,reject,timeout,device:id});ws.send(JSON.stringify({id:requestId,method,args}));
      })};adapters.set(id,adapter);update(id,true);void refresh();
      ws.on('message',data=>{try{const m=JSON.parse(data);if(m.type==='change')broadcast({type:'task',task:publicTask(transport.page(m.task,id+'~'+m.task.id),id)});else if(requests.get(m.id)?.device===id){const p=requests.get(m.id);requests.delete(m.id);clearTimeout(p.timeout);m.error?p.reject(new Error(m.error)):p.resolve(m.result);}}catch{ws.close(1003);}});
      ws.on('close',()=>{if(adapters.get(id)!==adapter)return;adapters.delete(id);update(id,false,false);for(const[k,p]of requests)if(p.device===id){clearTimeout(p.timeout);p.reject(new Error('电脑连接中断'));requests.delete(k);}});
    }else{
      clients.add(ws);ws.send(JSON.stringify({type:'devices',devices:[...devices.values()]}));ws.send(JSON.stringify({type:'tasks',tasks:[...cache.values()].flat()}));
      let selected=null,busy=false,last='';
      const detailTimer=setInterval(async()=>{if(!selected||busy||ws.readyState!==1)return;busy=true;try{const selectedAtStart=selected;const[d,id]=parseId(selectedAtStart);const t=publicTask(await transport.detail(selectedAtStart),d);if(selected!==selectedAtStart)return;const serialized=JSON.stringify(t);if(serialized!==last){last=serialized;ws.send(JSON.stringify({type:'task',task:t}));}}catch{}finally{busy=false;}},1200);
      ws.on('message',data=>{try{const m=JSON.parse(data);if(m.type==='subscribe'&&(typeof m.taskId==='string'||m.taskId===null)){selected=m.taskId;last='';}}catch{ws.close(1003);}});
      ws.on('close',()=>{clearInterval(detailTimer);clients.delete(ws);});
    }
  });
  const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}},15000);heartbeat.unref();
  server.on('close',()=>{clearInterval(timer);clearInterval(heartbeat);for(const ws of wss.clients)ws.terminate();});
  return {server,refresh,devices,adapters};
}
if(process.argv[1]&&import.meta.url===new URL('file:///'+process.argv[1].replaceAll('\\','/')).href){
  const config=JSON.parse(fs.readFileSync(process.argv[2]||'private/config.json','utf8'));
  const {server,refresh}=createGateway(config);server.listen(config.port,config.host,()=>{console.log('Mydex gateway listening on '+config.port);void refresh();});
}
