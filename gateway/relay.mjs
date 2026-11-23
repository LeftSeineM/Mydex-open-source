import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {promisify} from 'node:util';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';
import {emailSender} from './relay-mail.mjs';
const scrypt=promisify(crypto.scrypt), random=()=>crypto.randomBytes(32).toString('base64url');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const MAX=24*1024*1024;
export const allowedPath=p=>/^\/api\/(devices|tools|projects|tasks|devices\/[^/?]+\/models|tasks\/[^/?]+(?:\/(?:messages|approve|interrupt|controls|settings|queue|goal|side-chats|prediction|content))?|images\/[^/?]+\/[a-f0-9]{64})(?:\?[^\r\n]*)?$/.test(p);

export function createRelay({origin,allowedOrigins=[],dataFile,secureCookies=true,mailConfigFile,sendVerification,requireVerifiedEmail=false}) {
  if(new URL(origin).origin!==origin)throw Error('Invalid origin');
  const acceptedOrigins=new Set([origin,...allowedOrigins]);
  let db=fs.existsSync(dataFile)?JSON.parse(fs.readFileSync(dataFile,'utf8')):{users:[],devices:[]};
  const save=()=>{fs.mkdirSync(path.dirname(dataFile),{recursive:true});fs.writeFileSync(dataFile+'.tmp',JSON.stringify(db),{mode:0o600});fs.renameSync(dataFile+'.tmp',dataFile);};
  const deliver=sendVerification||emailSender(mailConfigFile), challenges=new Map(), mailRates=new Map();
  // Persist only one-way hashes of random login tokens, never cookies/passwords.
  const sessionDays=30;
  const sessions=new Map((db.sessions||[]).filter(([key,value])=>/^[a-f0-9]{64}$/.test(key)&&value.expires>Date.now()&&db.users.some(u=>u.id===value.user&&hash(u.digest)===value.accountVersion)));
  const saveSessions=()=>{db.sessions=[...sessions];save();};
  const pairs=new Map(),hosts=new Map(),pending=new Map(),channels=new Map(),tickets=new Map(),rates=new Map();
  const cookieName=secureCookies?'__Host-mydex':'mydex_test';
  const csrfCookie=secureCookies?'__Host-mydex-csrf':'mydex_csrf_test';
  const readCookie=(req,name)=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
  function verifiedBrowser(req){
    if(acceptedOrigins.has(req.headers.origin))return true;
    if(req.headers.origin&&req.headers.origin!=='null')return false;
    const token=req.headers['x-mydex-csrf'],cookie=readCookie(req,csrfCookie);
    return typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token)&&cookie.length===43&&crypto.timingSafeEqual(Buffer.from(token),Buffer.from(cookie));
  }
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  function session(req){const match=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='));const key=match?hash(match.slice(cookieName.length+1)):'';const s=sessions.get(key);return s&&s.expires>Date.now()&&db.users.some(u=>u.id===s.user&&hash(u.digest)===s.accountVersion)?{...s,key}:null;}
  function limit(req,kind,max){const key=kind+':'+req.socket.remoteAddress;let r=rates.get(key);if(!r||r.end<Date.now()){r={count:0,end:Date.now()+60000};rates.set(key,r);}return ++r.count<=max;}
  async function body(req){let size=0,parts=[];for await(const part of req){size+=part.length;if(size>131072)throw Object.assign(Error('请求过大'),{status:413});parts.push(part);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}
  const send=(ws,value)=>{if(ws?.readyState!==1||ws.bufferedAmount>MAX)return false;ws.send(JSON.stringify(value));return true;};
  function closeChannel(id){const c=channels.get(id);if(!c)return;channels.delete(id);c.socket?.close(1000);send(hosts.get(c.device),{type:'close',channel:id});}
  function forward(device,message){const host=hosts.get(device);if(!host||host.readyState!==1)return Promise.reject(Object.assign(Error('电脑离线，请打开 Mydex'),{status:503}));return new Promise((resolve,reject)=>{const id=random();const timer=setTimeout(()=>{pending.delete(id);reject(Object.assign(Error('电脑响应超时；发送结果可能尚未确认'),{status:504}));},55000);pending.set(id,{device,resolve,reject,timer});if(!send(host,{...message,id})){clearTimeout(timer);pending.delete(id);reject(Error('电脑连接繁忙'));}});}
  function signIn(req,res,user){
        const previous=session(req);if(previous){sessions.delete(previous.key);for(const[id,c]of channels)if(c.session===previous.key)closeChannel(id);}
        const token=random();sessions.set(hash(token),{user:user.id,expires:Date.now()+sessionDays*86400000,accountVersion:hash(user.digest)});
        saveSessions();
        res.setHeader('Set-Cookie',`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionDays*86400}${secureCookies?'; Secure':''}`);
        return json(res,200,{ok:true});
  }
  const server=http.createServer(async(req,res)=>{
    try{
      const u=new URL(req.url,origin);
      if(req.method==='GET'&&u.pathname==='/health')return json(res,200,{ok:true});
      if(['GET','HEAD'].includes(req.method)&&['/connect/','/connect/app.js','/connect/style.css','/connect/qr-decoder.js','/connect/session-guard.js'].includes(u.pathname)){
        const file={'/connect/':'index.html','/connect/app.js':'app.js','/connect/style.css':'style.css','/connect/qr-decoder.js':'qr-decoder.js','/connect/session-guard.js':'session-guard.js'}[u.pathname];
        const nonce=random();
        let content=fs.readFileSync(new URL(file==='qr-decoder.js'?'./node_modules/jsqr/dist/jsQR.js':'./portal/'+file,import.meta.url));
        if(file==='index.html'){
          const css=fs.readFileSync(new URL('./portal/style.css',import.meta.url),'utf8');
          const js=fs.readFileSync(new URL('./portal/app.js',import.meta.url),'utf8');
          content=Buffer.from(content.toString().replace('<link rel="stylesheet" href="/connect/style.css">',()=>'<style nonce="'+nonce+'">'+css+'</style>').replace('<script src="/connect/app.js" defer></script>',()=>'<script nonce="'+nonce+'">'+js+'</script>'));
        }
        const compressed=/\bgzip\b/.test(req.headers['accept-encoding']||'');if(compressed)content=gzipSync(content);
        res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Content-Length':content.length,...(compressed?{'Content-Encoding':'gzip'}:{}),'Vary':'Accept-Encoding','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'nonce-"+nonce+"'; style-src 'self' 'nonce-"+nonce+"'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});return res.end(req.method==='HEAD'?undefined:content);
      }
      // Browser mutations require the exact origin. Desktop pairing endpoints
      // instead require unpredictable request secrets, never cookies.
      const desktop=['/relay/pair/start','/relay/pair/poll'].includes(u.pathname);
      if(req.method!=='GET'&&!desktop&&!verifiedBrowser(req))return json(res,403,{error:'网页来源不匹配'});
      if(req.method==='GET'&&u.pathname==='/relay/auth/config'){
        let csrfToken=readCookie(req,csrfCookie);if(!/^[A-Za-z0-9_-]{43}$/.test(csrfToken))csrfToken=random();
        res.setHeader('Set-Cookie',`${csrfCookie}=${csrfToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secureCookies?'; Secure':''}`);
        return json(res,200,{emailRegistration:!!deliver,emailCodeLogin:!!deliver,csrfToken});
      }
      if(req.method==='POST'&&['/relay/register/code','/relay/register','/relay/login/code','/relay/login/verify'].includes(u.pathname)){
        if(!deliver)return json(res,503,{error:'邮箱注册暂未就绪，请稍后再试'});
        if(!limit(req,'registration',20))return json(res,429,{error:'尝试过多，请稍后再试'});
        const b=await body(req),email=String(b.email||'').trim().toLowerCase();
        if(email.length>80||! /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email))return json(res,400,{error:'请填写有效的邮箱地址（最多 80 字符）'});
        const now=Date.now(),loginCode=u.pathname.startsWith('/relay/login/'),challengeKey=(loginCode?'login:':'register:')+email;
        if(u.pathname.endsWith('/code')){
          // Per-email cooldown plus global budget: behind a tunnel, do not trust arbitrary forwarded IP headers.
          let r=mailRates.get(email);if(!r||r.end<now)r={count:0,next:0,end:now+3600000};
          let g=mailRates.get('*');if(!g||g.end<now)g={count:0,end:now+3600000};
          if(r.next>now||r.count>=5||g.count>=100||challenges.size>=5000)return json(res,429,{error:'发送过于频繁，请稍后重试'});
          r.count++;r.next=now+60000;g.count++;mailRates.set(email,r);mailRates.set('*',g);
          // Uniform response avoids disclosing whether an email has an account.
          if(loginCode?db.users.some(x=>x.name===email&&x.emailVerifiedAt):!db.users.some(x=>x.name===email)){
            const code=crypto.randomInt(100000,1000000).toString(),salt=random();
            const challenge={digest:hash(salt+code),salt,expires:now+600000,attempts:0};challenges.set(challengeKey,challenge);
            try{await deliver({email,code,purpose:loginCode?'login':'register'});}catch{if(challenges.get(challengeKey)===challenge)challenges.delete(challengeKey);return json(res,503,{error:'邮件暂时发送失败，请稍后重试'});}
          }
          return json(res,200,{ok:true,message:loginCode?'若此邮箱已完成注册，登录验证码已发送，10 分钟内有效；尚未注册请先选择邮箱注册':'若此邮箱可以注册，验证码已发送，10 分钟内有效；已有账号请直接登录',retryAfter:60});
        }
        if(!loginCode&&(typeof b.password!=='string'||b.password.length<8||b.password.length>200||!/[A-Za-z]/.test(b.password)||!/[0-9]/.test(b.password)))return json(res,400,{error:'密码至少 8 位（最多 200 位），须包含字母和数字，符号可选'});
        const c=challenges.get(challengeKey);
        if(!c||c.expires<=now||c.attempts>=5)return json(res,400,{error:'验证码无效或已过期，请重新获取'});
        c.attempts++;
        if(!/^\d{6}$/.test(String(b.code||''))||!crypto.timingSafeEqual(Buffer.from(c.digest,'hex'),Buffer.from(hash(c.salt+String(b.code)),'hex')))return json(res,400,{error:'验证码不正确'});
        challenges.delete(challengeKey); // Consume before any asynchronous work: parallel requests cannot reuse it.
        if(loginCode){const user=db.users.find(x=>x.name===email&&x.emailVerifiedAt);if(!user)return json(res,400,{error:'请先完成邮箱注册'});return signIn(req,res,user);}
        const salt=random(),digest=(await scrypt(b.password,salt,64)).toString('hex');
        if(db.users.some(x=>x.name===email))return json(res,409,{error:'请使用已有账号登录'});
        db.users.push({id:random(),name:email,email,emailVerifiedAt:new Date().toISOString(),salt,digest});save();
        return json(res,201,{ok:true,message:'邮箱验证成功，请登录后配对自己的电脑'});
      }
      if(req.method==='POST'&&u.pathname==='/relay/login'){
        if(!limit(req,'auth',20))return json(res,429,{error:'尝试过多，请稍后再试'});
        const b=await body(req),name=String(b.username||'').trim().toLowerCase(),password=b.password;
        if(name.length<3||name.length>80||typeof password!=='string'||password.length<1||password.length>200)return json(res,400,{error:'请填写有效账号与密码'});
        let user=db.users.find(x=>x.name===name);
        const digest=await scrypt(password,user?.salt||'invalid-account-salt',64);
        if(!user||(requireVerifiedEmail&&!user.emailVerifiedAt)||!crypto.timingSafeEqual(digest,Buffer.from(user.digest,'hex')))return json(res,401,{error:'账号或密码不正确'});
        return signIn(req,res,user);
      }
      if(req.method==='POST'&&u.pathname==='/relay/pair/start'){
        if(!limit(req,'pair',10)||pairs.size>=1000)return json(res,429,{error:'请求过多，请稍后重试'});
        const b=await body(req),code=random(),secret=random(),expires=Date.now()+5*60000;
        const name=String(b.name||'我的电脑').slice(0,80),check=crypto.randomInt(100000,1000000).toString();
        const computerId=/^[a-f0-9]{64}$/.test(b.computerId||'')?b.computerId:null;
        const previous=db.devices.find(d=>d.id===b.previousDeviceId&&typeof b.previousToken==='string'&&d.tokenHash===hash(b.previousToken));
        pairs.set(hash(code),{secret:hash(secret),expires,name,check,computerId,previousDevice:previous?.id});
        return json(res,200,{code,secret,expiresAt:expires,check,url:origin+'/connect/#pair='+code});
      }
      if(req.method==='POST'&&u.pathname==='/relay/pair/poll'){
        if(!limit(req,'poll',120))return json(res,429,{error:'请求过多'});
        const b=await body(req),key=hash(String(b.code)),p=pairs.get(key);
        if(!p||p.secret!==hash(String(b.secret))||p.expires<Date.now())return json(res,410,{error:'配对已过期，请重新生成二维码'});
        if(!p.device)return json(res,200,{pending:true});
        pairs.delete(key);return json(res,200,{deviceId:p.device,token:p.token,origin});
      }
      const s=session(req);if(!s)return json(res,401,{error:'请先登录 Mydex'});
      const own=id=>db.devices.find(d=>d.id===id&&d.owner===s.user);
      if(req.method==='GET'&&u.pathname==='/relay/me')return json(res,200,{username:db.users.find(x=>x.id===s.user)?.name,devices:db.devices.filter(d=>d.owner===s.user).map(d=>({id:d.id,name:d.name,online:hosts.get(d.id)?.readyState===1}))});
      if(req.method==='POST'&&u.pathname==='/relay/account/delete'){
        const b=await body(req),user=db.users.find(x=>x.id===s.user);
        if(!limit(req,'delete',5)||typeof b.password!=='string'||b.password.length>200)return json(res,400,{error:'请填写密码'});
        const digest=await scrypt(b.password,user.salt,64);
        if(!crypto.timingSafeEqual(digest,Buffer.from(user.digest,'hex')))return json(res,401,{error:'密码不正确'});
        const ids=new Set(db.devices.filter(d=>d.owner===s.user).map(d=>d.id));
        db.users=db.users.filter(x=>x.id!==s.user);db.devices=db.devices.filter(d=>d.owner!==s.user);save();
        for(const id of ids)hosts.get(id)?.close(1008,'revoked');
        for(const[key,value]of sessions)if(value.user===s.user)sessions.delete(key);
        saveSessions();
        for(const[id,c]of channels)if(ids.has(c.device))closeChannel(id);
        return json(res,200,{ok:true});
      }
      if(req.method==='POST'&&u.pathname==='/relay/logout'){
        sessions.delete(s.key);saveSessions();for(const[id,c]of channels)if(c.session===s.key)closeChannel(id);
        res.setHeader('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookies?'; Secure':''}`);return json(res,200,{ok:true});
      }
      if(req.method==='POST'&&u.pathname==='/relay/pair/inspect'){
        const b=await body(req),p=pairs.get(hash(String(b.code)));
        if(!p||p.expires<Date.now()||p.device)return json(res,410,{error:'二维码已过期或已使用'});
        return json(res,200,{name:p.name,check:p.check});
      }
      if(req.method==='POST'&&u.pathname==='/relay/pair/approve'){
        const b=await body(req),p=pairs.get(hash(String(b.code)));
        if(!p||p.expires<Date.now()||p.device||p.check!==String(b.check))return json(res,410,{error:'配对码无效或已使用'});
        const existing=db.devices.find(d=>d.owner===s.user&&((p.computerId&&d.computerId===p.computerId)||d.id===p.previousDevice));
        if(!existing&&db.devices.filter(d=>d.owner===s.user).length>=50)return json(res,400,{error:'已达到每账号 50 台电脑的限制'});
        const id=existing?.id||random(),token=random();
        if(existing){existing.name=p.name;existing.tokenHash=hash(token);if(p.computerId)existing.computerId=p.computerId;}
        else db.devices.push({id,owner:s.user,name:p.name,tokenHash:hash(token),...(p.computerId?{computerId:p.computerId}:{})});
        save();if(existing){hosts.get(id)?.close(1008,'paired again');for(const[channel,c]of channels)if(c.device===id)closeChannel(channel);}
        p.device=id;p.token=token;return json(res,200,{ok:true,reused:!!existing});
      }
      if(req.method==='POST'&&u.pathname==='/relay/device/revoke'){
        const b=await body(req);if(!own(b.id))return json(res,404,{error:'电脑不存在'});
        db.devices=db.devices.filter(d=>d.id!==b.id);save();hosts.get(b.id)?.close(1008,'revoked');
        for(const[id,c]of channels)if(c.device===b.id)closeChannel(id);return json(res,200,{ok:true});
      }
      const match=u.pathname.match(/^\/c\/([a-zA-Z0-9_-]{43})(\/.*)$/);
      if(!match||!own(match[1]))return json(res,404,{error:'电脑不存在'});
      const device=match[1],route=match[2];
      if(req.method==='POST'&&route==='/api/web/ticket'){
        if(tickets.size>5000)return json(res,429,{error:'连接过多'});
        const ticket=random();tickets.set(hash(ticket),{device,session:s.key,expires:Date.now()+30000});return json(res,200,{ticket});
      }
      if(!['GET','POST'].includes(req.method)||!allowedPath(route+u.search))return json(res,404,{error:'接口不可用'});
      if(!limit(req,'api',600)||pending.size>=1000)return json(res,429,{error:'请求过多'});
      const result=await forward(device,{type:'http',method:req.method,path:route+u.search,body:req.method==='POST'?await body(req):null,requestId:req.headers['idempotency-key']});
      const bytes=Buffer.from(result.data||'','base64');if(bytes.length>MAX)throw Error('响应过大');
      res.writeHead(Number.isInteger(result.status)&&result.status>=200&&result.status<=599?result.status:502,{'Content-Type':/^image\/(png|jpeg|webp|gif)$/.test(result.mime)?result.mime:'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);
    }catch(e){if(!res.headersSent)json(res,e.status||502,{error:e.status?e.message:'中继暂时无法完成请求，请稍后重试'});else res.destroy();}
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:34*1024*1024});
  server.on('upgrade',(req,socket,head)=>{
    const u=new URL(req.url,origin);let device,kind,sessionKey;
    if(u.pathname==='/relay/host'){
      const token=(req.headers.authorization||'').replace(/^Bearer /,'');device=db.devices.find(d=>d.id===u.searchParams.get('device')&&d.tokenHash===hash(token))?.id;kind='host';
    }else{
      const m=u.pathname.match(/^\/c\/([a-zA-Z0-9_-]{43})\/ws$/),s=session(req),key=hash(u.searchParams.get('ticket')||''),t=tickets.get(key);
      if(m&&s&&acceptedOrigins.has(req.headers.origin)&&t?.device===m[1]&&t.session===s.key&&t.expires>Date.now()&&db.devices.some(d=>d.id===m[1]&&d.owner===s.user)){device=m[1];kind='client';sessionKey=s.key;tickets.delete(key);}
    }
    if(!device){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}
    wss.handleUpgrade(req,socket,head,ws=>{
      ws.alive=true;ws.on('pong',()=>ws.alive=true);ws.on('error',()=>{});
      if(kind==='host'){
        hosts.get(device)?.close(1000,'replaced');hosts.set(device,ws);
        ws.on('message',raw=>{if(hosts.get(device)!==ws)return;try{const m=JSON.parse(raw);if(m.type==='response'){const p=pending.get(m.id);if(p?.device===device){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error('电脑连接服务返回错误')):p.resolve(m);}}else if(m.type==='event'){const c=channels.get(m.channel);if(c?.device===device&&c.socket.bufferedAmount<MAX)c.socket.send(m.data);}else if(m.type==='closed'){const c=channels.get(m.channel);if(c?.device===device)closeChannel(m.channel);}}catch{ws.close(1003);}});
        ws.on('close',()=>{if(hosts.get(device)!==ws)return;hosts.delete(device);for(const[id,c]of channels)if(c.device===device)closeChannel(id);for(const[id,p]of pending)if(p.device===device){clearTimeout(p.timer);pending.delete(id);p.reject(Object.assign(Error('电脑连接中断'),{status:503}));}});
      }else{
        const id=random();channels.set(id,{device,session:sessionKey,socket:ws});
        if(!send(hosts.get(device),{type:'open',channel:id})){closeChannel(id);return;}
        ws.on('message',raw=>{if(raw.length>65536){ws.close(1009);return;}try{const m=JSON.parse(raw);if(m.type!=='subscribe'||!(m.taskId===null||typeof m.taskId==='string'))return;send(hosts.get(device),{type:'message',channel:id,data:JSON.stringify(m)});}catch{ws.close(1003);}});
        ws.on('close',()=>closeChannel(id));
      }
    });
  });
  const timer=setInterval(()=>{const now=Date.now();for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}for(const map of [sessions,pairs,tickets,challenges])for(const[k,v]of map)if(v.expires<now)map.delete(k);for(const map of [rates,mailRates])for(const[k,v]of map)if(v.end<now)map.delete(k);for(const[id,c]of channels)if(!sessions.has(c.session))closeChannel(id);},15000);timer.unref();
  server.on('close',()=>{clearInterval(timer);for(const ws of wss.clients)ws.terminate();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('中继停止'));}});
  return {server,close:()=>{for(const ws of wss.clients)ws.terminate();server.close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  createRelay(config).server.listen(config.port||18083,config.host||'127.0.0.1',()=>console.log('Mydex relay ready'));
}
