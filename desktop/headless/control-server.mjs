import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
// Lifecycle installation/update is intentionally handled by a separate supervisor.
// Never expose raw credential export or arbitrary shell execution to Agent clients.
export const actions=new Set(['status','defaults','configureHub','start','stop','prepareTool','bridgeDiagnostics','findClaude','findToolBridge','configureTool','restoreClaude','restoreToolBridge','bridgeInstall']);
// Separate local credential: adding desktop UI operations must not broaden
// the Agent/MCP endpoint (in particular, credential export and raw patching).
const desktopActions=new Set(['status','defaults','start','stop','bridgeDiagnostics','findClaude','findToolBridge','configureTool','restoreClaude','restoreToolBridge','installClaude','installToolBridge','launchClaudeCompatibility','pairing','meshPairing','tunnelPairing','pairingQr','meshPairingQr','tunnelPairingQr','relayPairing']);
export function createControlServer({owner,token,desktopToken,onShutdown,pairingDirectory,agentVersion,routerRequest}){
 if(typeof token!=='string'||token.length<32)throw Error('A strong local control token is required');
 if(desktopToken!==undefined&&(typeof desktopToken!=='string'||desktopToken.length<32||desktopToken===token))throw Error('A separate strong desktop token is required');
 const expected=Buffer.from('Bearer '+token);
 const desktopExpected=desktopToken&&Buffer.from('Bearer '+desktopToken);
 const server=http.createServer(async(req,res)=>{
   const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
   const provided=Buffer.from(req.headers.authorization||'');
   const desktop=req.url==='/desktop';
   const credential=desktop?desktopExpected:expected;
   // Browser pages must not be able to mutate the local service.
   if(req.headers.origin||!credential||provided.length!==credential.length||!crypto.timingSafeEqual(provided,credential))return reply(403,{error:'Local authorization required'});
   if(req.method!=='POST'||!['/rpc','/desktop'].includes(req.url))return reply(404,{error:'Unknown endpoint'});
   let size=0,parts=[];
   try{
     for await(const part of req){size+=part.length;if(size>65536){reply(413,{error:'Request too large'});return;}parts.push(part);}
     let m;try{m=JSON.parse(Buffer.concat(parts).toString());}catch{return reply(400,{error:'Invalid JSON'});}
     if(desktop){
       if(!m||typeof m!=='object'||!desktopActions.has(m.action))return reply(400,{error:'共享后台不支持该窗口操作；切换配置、更新与服务交接需使用专用管理入口。'});
       if(m.args!==undefined&&(!m.args||typeof m.args!=='object'||Array.isArray(m.args)))return reply(400,{error:'Invalid arguments'});
       const result=await owner.call(m.action,m.args||{});
       if(m.action==='status')return reply(200,{result:{...result,owned:false,sharedOwner:true,agentVersion}});
       return reply(200,{result});
     }
     if(!m||typeof m!=='object'||!(actions.has(m.action)||m.action==='shutdown'&&onShutdown||m.action==='pair'&&pairingDirectory||m.action==='router'&&routerRequest))return reply(400,{error:'Unsupported management operation'});
     if(m.args!==undefined&&(!m.args||typeof m.args!=='object'||Array.isArray(m.args)))return reply(400,{error:'Invalid arguments'});
     if(m.action==='shutdown'){reply(200,{result:{stopping:true}});setImmediate(onShutdown);return;}
     if(m.action==='router')return reply(200,{result:await routerRequest(m.args?.operation,m.args?.args,m.args?.requestId)});
     if(m.action==='bridgeInstall'){
       const {preflight}=await import('./bridge-preflight.mjs');
       const id=m.args?.tool;
       if(!['claude','deepseek','zcode','gemini'].includes(id))return reply(400,{error:'Unknown tool; diagnostic and reversible adapter development required'});
       const found=await owner.call(id==='claude'?'findClaude':'findToolBridge',{id});
       if(!found?.app)return reply(409,{error:'Original application not installed. No application will be downloaded.'});
       const app=fs.realpathSync(found.app);
       if(id==='claude'&&/[\\/]WindowsApps[\\/]/i.test(app))return reply(409,{error:'This installation requires a compatibility copy, which is disabled in Agent mode. Original application was not modified.'});
       const check=preflight(id,app);
       if(check.state==='already-patched')return reply(200,{result:{...check,changed:false,sessionConnectivityVerified:false}});
       if(check.state==='unsupported')return reply(409,{error:check.message});
       // Original application changes are an explicit exception, never automatic setup.
       if(m.args?.allowOriginalAppPatch!==true)return reply(200,{result:{state:'requires-explicit-patch-consent',changed:false,sessionConnectivityVerified:false,message:'Prefer official or existing application interfaces. This adapter modifies original application files; obtain separate user consent before enabling allowOriginalAppPatch.'}});
       const result=await owner.call(id==='claude'?'installClaude':'installToolBridge',{id,app});
       return reply(200,{result:{...result,sessionConnectivityVerified:false}});
     }
     if(m.action==='pair'){
       const mode=m.args?.mode;
       if(!['android','web'].includes(mode))return reply(400,{error:'Choose android or web pairing'});
       const result=await owner.call(mode==='web'?'relayPairing':'tunnelPairingQr');
       if(!/^[A-Za-z0-9+/=]+$/.test(result.image)||result.image.length>1000000)throw Error('Invalid QR image');
       const escaped=String(result.name||'Mydex').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
       const file=path.join(pairingDirectory,'pairing.html');
       fs.writeFileSync(file,`<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Mydex 配对手机</title><style>body{font:18px system-ui;text-align:center;margin:48px;background:#fafafa}img{width:320px;max-width:90vw}</style><h1>Mydex 配对手机</h1><p>${escaped}</p><img alt="临时配对二维码" src="data:image/png;base64,${result.image}"><p>请使用${mode==='web'?'手机网页版':'Android 应用版'}扫码。二维码过期后重新生成。</p><p>有效期至 ${new Date(result.expiresAt).toISOString()}</p>`,{mode:0o600});
       return reply(200,{result:{file,expiresAt:result.expiresAt,mode}});
     }
     const result=await owner.call(m.action,m.args||{});
     if(m.action==='status'&&agentVersion)result.update={current:agentVersion,channel:'agent',message:'Use a signed Mydex Agent package to update this background service'};
     reply(200,{result});
   }catch{return reply(503,{error:'Operation failed; check local service status before retrying'});}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;
 return server;
}
