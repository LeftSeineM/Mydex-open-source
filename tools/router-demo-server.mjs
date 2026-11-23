// Isolated private web front-end. Does not modify or restart Mydex Agent.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../gateway/package.json',import.meta.url));
const {WebSocket,WebSocketServer}=require('ws');
export function createDemo(config){
 const agent=JSON.parse(fs.readFileSync(config.agentConfig,'utf8'));
 const ca=fs.readFileSync(agent.tls.cert), tickets=new Map();
 const origin=config.origin;
 const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
 const cookieName='__Host-mydex-demo';
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 function request(url,options={},body){return new Promise((resolve,reject)=>{
  const r=https.request(url,options,res=>{const parts=[];let n=0;res.on('data',b=>{n+=b.length;if(n>24*1024*1024){r.destroy(Error('Response too large'));return;}parts.push(b);});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(parts)}));res.on('error',reject);});
  r.setTimeout(55000,()=>r.destroy(Error('Upstream timeout')));r.on('error',reject);r.end(body);
 });}
 async function identity(req){
  const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
  return cookie&&config.inviteHash&&hash(cookie)===config.inviteHash?{username:'private-demo-owner'}:null;
 }
 const bodyOf=async(req)=>{let n=0,parts=[];for await(const p of req){n+=p.length;if(n>131072)throw Error('Request too large');parts.push(p);}return Buffer.concat(parts);};
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  res.setHeader('Cache-Control','no-store');
  try{
   const u=new URL(req.url,origin);
   if(req.headers.origin&&req.headers.origin!==origin)return json(res,403,{error:'来源未授权'});
   if(req.method==='POST'&&req.headers.origin!==origin)return json(res,403,{error:'来源未授权'});
   if(u.pathname==='/health')return json(res,200,{product:'Mydex private tree demo',version:'0.2.24-tree.1',private:true});
   if(u.pathname==='/enter'&&req.method==='POST'){
    const value=JSON.parse((await bodyOf(req)).toString());
    if(typeof value.key!=='string'||hash(value.key)!==config.inviteHash)return json(res,403,{error:'私测链接无效'});
    res.setHeader('Set-Cookie',cookieName+'='+value.key+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000');return json(res,200,{okay:true});
   }
   if(u.pathname==='/'||u.pathname==='/connect/'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Referrer-Policy':'no-referrer'});
    return res.end(`<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mydex 私测</title><body style="font:16px system-ui;padding:40px;background:#f6f8fa"><h2>Mydex · 树状工作台私测</h2><p id="status">正在打开私测工作台…</p><script>(async()=>{try{const key=new URLSearchParams(location.hash.slice(1)).get('key');history.replaceState(null,'','/');if(key){const r=await fetch('/enter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});if(!r.ok)throw Error();}const me=await fetch('/relay/me');if(!me.ok)throw Error();const p={name:'本机 · Router 私测',baseUrl:location.origin+'/c/local/',token:'mydex-cookie-session-placeholder-0000',fingerprint:''};sessionStorage.setItem('mydex.connection',JSON.stringify(p));sessionStorage.setItem('mydex.profiles',JSON.stringify([p]));sessionStorage.setItem('mydex.testFeatures','true');location.replace('/web/');}catch{document.getElementById('status').textContent='请使用提供给你的完整私测链接打开。此入口不公开电脑与对话数据。';}})();</script></body></html>`);
   }
   if(u.pathname.startsWith('/relay/')){
    if(u.pathname==='/relay/me'){
      const me=await identity(req);if(!me)return json(res,401,{error:'请使用获准的私测账号登录'});
      return json(res,200,{...me,devices:[{id:'local',name:'本机 · Router 私测',online:true}]});
    }
    if(u.pathname==='/relay/logout'&&req.method==='POST'){res.setHeader('Set-Cookie',cookieName+'=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');return json(res,200,{okay:true});}
    return json(res,403,{error:'仅专用私测链接可用，不开放账号注册'});
   }
   if(u.pathname.startsWith('/c/local/')){
    const me=await identity(req);if(!me)return json(res,401,{error:'未授权的私测账号'});
    const route=u.pathname.slice('/c/local'.length)+u.search;
    if(route==='/api/web/ticket'&&req.method==='POST'){
      for(const [k,v] of tickets)if(v.expires<Date.now())tickets.delete(k);
      if(tickets.size>100)return json(res,429,{error:'请稍后重试'});
      const ticket=crypto.randomBytes(32).toString('base64url');tickets.set(ticket,{cookie:req.headers.cookie,expires:Date.now()+30000});return json(res,200,{ticket});
    }
    if(!/^\/api\/(?:router|devices|tools|projects|tasks|images)(?:[/?]|$)/.test(route)||!['GET','POST'].includes(req.method))return json(res,404,{error:'接口不可用'});
    const body=await bodyOf(req);
    const r=await request('https://127.0.0.1:'+agent.port+route,{method:req.method,ca,headers:{Authorization:'Bearer '+agent.token,'Content-Type':'application/json',...(req.headers['idempotency-key']?{'Idempotency-Key':req.headers['idempotency-key']}:{})}},body.length?body:undefined);
    res.writeHead(r.status,{'Content-Type':r.headers['content-type']||'application/json'});return res.end(r.bytes);
   }
   if(u.pathname==='/'){res.writeHead(302,{Location:'/connect/'});return res.end();}
   const connect=u.pathname.startsWith('/connect/');
   if(!connect&&!u.pathname.startsWith('/web/'))return json(res,404,{error:'Not found'});
   const root=path.resolve(connect?config.portal:config.web);
   const relative=decodeURIComponent(u.pathname.slice(connect?9:5))||'index.html';
   const file=path.resolve(root,relative);
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found'});
   const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.woff2':'font/woff2'};
   const zipped=/\bgzip\b/.test(req.headers['accept-encoding']||'')&&fs.existsSync(file+'.gz');
   const target=zipped?file+'.gz':file;
   res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream',
     'Content-Length':fs.statSync(target).size,...(zipped?{'Content-Encoding':'gzip','Vary':'Accept-Encoding'}:{}),
     'Cache-Control':/\.(wasm|woff2|ttf|png)$/.test(file)?'private, max-age=86400':'no-cache'});fs.createReadStream(target).pipe(res);
  }catch{json(res,502,{error:'私测连接暂时不可用；没有自动重发请求。'});}
 });
 const wss=new WebSocketServer({noServer:true,maxPayload:24*1024*1024});
 server.on('upgrade',async(req,socket,head)=>{
  try{const u=new URL(req.url,origin);const t=tickets.get(u.searchParams.get('ticket'));tickets.delete(u.searchParams.get('ticket'));
   if(u.pathname!=='/c/local/ws'||req.headers.origin!==origin||!t||t.expires<Date.now()||t.cookie!==req.headers.cookie||!await identity(req)){socket.destroy();return;}
   wss.handleUpgrade(req,socket,head,client=>{
    const upstream=new WebSocket('wss://127.0.0.1:'+agent.port+'/ws',{ca,headers:{Authorization:'Bearer '+agent.token}});
    const queue=[];client.on('message',(data,binary)=>{if(upstream.readyState===1)upstream.send(data,{binary});else if(queue.length<20)queue.push([data,binary]);else client.close();});
    upstream.on('open',()=>{for(const [data,binary]of queue)upstream.send(data,{binary});queue.length=0;});
    upstream.on('message',(data,binary)=>{if(client.readyState===1)client.send(data,{binary});});
    const close=()=>{clearInterval(check);client.close();upstream.close();};
    const check=setInterval(()=>identity(req).then(me=>{if(!me)close();}).catch(close),30000);check.unref();
    client.on('close',close);upstream.on('close',close);client.on('error',close);upstream.on('error',close);
   });
  }catch{socket.destroy();}
 });
 return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 createDemo(config).listen(config.port||18700,'127.0.0.1',()=>console.log('Private demo listening on loopback'));
}
