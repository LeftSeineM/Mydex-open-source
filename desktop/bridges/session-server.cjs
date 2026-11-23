'use strict';
// Runs inside the desktop application. The application continues to own every
// session, provider, model credential, execution and permission decision.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function projectSession(s) {
  return {sessionId:s.sessionId,title:s.title,cwd:s.cwd,cliSessionId:s.cliSessionId,
    isRunning:!!s.isRunning,isArchived:!!s.isArchived,model:s.model,
    createdAt:s.createdAt,lastActivityAt:s.lastActivityAt};
}
function textBlocks(value) {
  if(typeof value==='string')return value;
  if(!Array.isArray(value))return [];
  return value.flatMap(b=>{
    if(b?.type==='text'&&typeof b.text==='string')return [{type:'text',text:b.text}];
    if(b?.type==='tool_use')return [{type:'tool_use',id:b.id,name:b.name,input:b.input}];
    if(b?.type==='tool_result')return [{type:'tool_result',tool_use_id:b.tool_use_id,content:textBlocks(b.content)}];
    return [];
  });
}
function projectTranscript(rows) {
  if(!Array.isArray(rows))throw new Error('Unsupported desktop transcript format');
  return rows.flatMap((r,i)=>{
    const m=r.message||r,role=m.role||r.type;
    if(!['user','assistant','toolResult'].includes(role))return [];
    return [{uuid:r.uuid||r.id||String(i),message:{role,content:textBlocks(m.content??m.text??'')}}];
  });
}
async function startSessionServer({manager,descriptorPath,toolId='claude-desktop'}) {
  for(const method of ['getAllSessions','getSession','getTranscript','sendMessage'])
    if(typeof manager?.[method]!=='function')throw new Error('Incompatible desktop session manager: '+method);
  const token=crypto.randomBytes(32).toString('hex'),instance=crypto.randomUUID();
  const pending=new Map(); // Ambiguous sends are never replayed in this process.
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const server=http.createServer(async(req,res)=>{
    const expected=Buffer.from('Bearer '+token),given=Buffer.from(req.headers.authorization||'');
    if(req.headers.origin||given.length!==expected.length||!crypto.timingSafeEqual(expected,given))return json(res,401,{error:'Unauthorized'});
    if(req.headers.host!==`127.0.0.1:${server.address().port}`)return json(res,400,{error:'Invalid host'});
    try {
      if(req.method==='GET'&&req.url==='/v1/health')return json(res,200,{protocol:1,toolId,instance,sessionOwner:'desktop'});
      if(req.method==='GET'&&req.url==='/v1/sessions')return json(res,200,{sessions:(await manager.getAllSessions()).filter(s=>!s.isArchived).map(projectSession)});
      if(req.method!=='POST'||!['/v1/detail','/v1/send'].includes(req.url))return json(res,404,{error:'Not found'});
      if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return json(res,415,{error:'JSON required'});
      const chunks=[];let size=0;
      for await(const part of req){size+=part.length;if(size>128*1024){json(res,413,{error:'Request too large'});req.destroy();return;}chunks.push(part);}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(typeof input.sessionId!=='string'||!input.sessionId||input.sessionId.length>200)return json(res,400,{error:'Invalid session'});
      const session=await manager.getSession(input.sessionId);
      if(!session||session.isArchived)return json(res,404,{error:'Desktop session unavailable'});
      if(req.url==='/v1/detail')return json(res,200,{session:projectSession(session),messages:projectTranscript(await manager.getTranscript(input.sessionId))});
      if(typeof input.instruction!=='string'||!input.instruction.trim()||input.instruction.length>60000||!/^[-a-z0-9]{36}$/i.test(input.requestId||''))return json(res,400,{error:'Invalid message'});
      const fingerprint=crypto.createHash('sha256').update(JSON.stringify([input.sessionId,input.instruction])).digest('hex');
      let item=pending.get(input.requestId);
      if(item&&item.fingerprint!==fingerprint)return json(res,409,{error:'Request identity conflict'});
      if(!item){
        if(pending.size>=10000)return json(res,503,{error:'Send ledger full; restart desktop when idle'});
        // The desktop method retains its ordinary execution and approval policy.
        const result=Promise.resolve().then(()=>manager.sendMessage(input.sessionId,input.instruction,undefined,{messageUuid:input.requestId}));
        item={fingerprint,result};pending.set(input.requestId,item);
      }
      const result=await item.result;
      if(result?.delivered!==true)return json(res,409,{error:result?.reason||'Desktop did not accept the message'});
      return json(res,200,{accepted:true,queued:!!result.queued,sessionId:input.sessionId,requestId:input.requestId});
    } catch { if(!res.headersSent)json(res,500,{error:'Desktop session operation failed; inspect the conversation before retrying'}); }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const descriptor={protocol:1,toolId,instance,pid:process.pid,port:server.address().port,token};
  try {
    fs.mkdirSync(path.dirname(descriptorPath),{recursive:true,mode:0o700});
    fs.writeFileSync(descriptorPath,JSON.stringify(descriptor),{mode:0o600});
  } catch(e){server.close();throw e;}
  server.unref();
  return {server,descriptor,close:async()=>{
    try{if(JSON.parse(fs.readFileSync(descriptorPath)).instance===instance)fs.unlinkSync(descriptorPath);}catch{}
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }};
}
module.exports={startSessionServer,projectSession,projectTranscript};
