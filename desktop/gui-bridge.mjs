import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import crypto from 'node:crypto';
import readline from 'node:readline';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createHub,discoverCodex,discoverThread,migrateCodexExecutable} from './setup.mjs';
import {DesktopUpdater} from './updater.mjs';
import {MacUpdater} from './macos/updater.mjs';
import {startRelayClient} from '../gateway/relay-client.mjs';
import {tunnelIdentity,startTunnelHost} from '../gateway/tunnel-host.mjs';
import {startLanDiscovery} from '../gateway/lan-discovery.mjs';
import {ToolRegistry} from '../gateway/tool-registry.mjs';
import {Desktop} from '../gateway/desktop.mjs';
import {NativeFollower} from '../gateway/native.mjs';
import {desktopAccess,MacDesktopNavigation} from '../gateway/mac-desktop-navigation.mjs';
import {claudeCompatibilityInstalled,claudeInstallationState,restoreClaude} from './bridges/restore.mjs';
import {findClaude,installClaude} from './bridges/install-claude.mjs';
import {launchStoreCopy} from './bridges/claude-store.mjs';
import {assertClaudeClosed} from './bridges/install-claude.mjs';
import {electronInstalled,electronInstallationState,findElectron,installElectron,restoreElectron} from './bridges/install-electron.mjs';
import {geminiInstalled,findGemini,installGemini,restoreGemini} from './bridges/install-gemini.mjs';
import {createRequire} from 'node:module';
import {gatewayFailure} from './gateway-diagnostics.mjs';
const QRCode=createRequire(new URL('../gateway/package.json',import.meta.url))('qrcode');

const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const updater=process.platform==='darwin'?new MacUpdater(appRoot):new DesktopUpdater(appRoot);
if(process.env.MYDEX_HEADLESS!=='1'){
 setTimeout(()=>void updater.check(),15000).unref();
 setInterval(()=>void updater.check(),6*3600000).unref();
}
const data=process.env.MYDEX_DATA_DIR||path.join(appRoot,'data');
fs.mkdirSync(data,{recursive:true});
const profileFile=path.join(data,'desktop-profile.json');
let profile=fs.existsSync(profileFile)?JSON.parse(fs.readFileSync(profileFile)):{root:data};
let child=null,retry=null,wanted=false,connected=false,lastError='',tools=[],toolsAt=0,claudeInstalling=false;
const relayFile=path.join(data,'relay-device.json');
let relayClient=null,relayOnline=false,relayPair=null,relayPoll=null,relayBusy=false;
let tunnelClient=null,tunnelOnline=false,lanDiscovery=null;
function tunnelConfig(){
 const file=path.join(appRoot,'desktop/app-relay.json');
 const origin=process.env.MYDEX_APP_RELAY||(fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')).origin:'');
 if(!origin)throw Error('免账号连接服务尚未配置，请安装发布版连接器');
 return {origin,identity:tunnelIdentity(path.join(data,'tunnel-identity.json'))};
}
function ensureTunnel(){if(tunnelClient)return;const c=config();if(!c)return;const t=tunnelConfig();tunnelClient=startTunnelHost({...t,port:c.value.port,onState:v=>tunnelOnline=v});if(!lanDiscovery)lanDiscovery=startLanDiscovery({port:c.value.port,fingerprint:new crypto.X509Certificate(fs.readFileSync(c.value.tls.cert)).fingerprint256.replaceAll(':','').toLowerCase()});}
function currentDirectUrls(c){return [...new Set([...Object.entries(os.networkInterfaces()).filter(([name])=>!/(vmware|virtual|wsl|tailscale|loopback)/i.test(name)).flatMap(([,entries])=>entries||[]).filter(i=>i.family==='IPv4'&&!i.internal&&!i.address.startsWith('169.254.')).map(i=>'https://'+i.address+':'+c.value.port),...(profile.address?[profile.address]:[])])].slice(0,8);}
function tunnelPairingFields(){ensureTunnel();const t=tunnelConfig();return {baseUrl:'https://pc-'+tunnelClient.room.slice(0,32)+'.'+tunnelClient.room.slice(32)+'.mydex.invalid',relayUrl:t.origin,relayToken:t.identity.clientSecret,directUrls:currentDirectUrls(config())};}
const relayOrigin=process.env.MYDEX_RELAY_ORIGIN||'https://app.leftseinem.dpdns.org';
async function relayApi(route,body){
 const response=await fetch(relayOrigin+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const value=await response.json();if(!response.ok)throw new Error(value.error||'中继连接失败');return value;
}
function ensureRelay(){if(relayClient||!fs.existsSync(relayFile))return;const c=config();if(!c)return;relayClient=startRelayClient(c.value,JSON.parse(fs.readFileSync(relayFile)),online=>relayOnline=online);}
async function pollRelay(){
 if(!relayPair||relayBusy)return;if(relayPair.expiresAt<Date.now()){clearInterval(relayPoll);relayPair=null;return;}
 relayBusy=true;try{const value=await relayApi('/relay/pair/poll',{code:relayPair.code,secret:relayPair.secret});if(!value.pending){fs.writeFileSync(relayFile,JSON.stringify(value),{mode:0o600});clearInterval(relayPoll);relayPair=null;relayClient?.stop();relayClient=null;ensureRelay();}}catch{}finally{relayBusy=false;}
}
const save=()=>fs.writeFileSync(profileFile,JSON.stringify(profile,null,2));
function config(){const priv=path.join(profile.root,'gateway/private');const file=path.join(priv,'config.json');return fs.existsSync(file)?{kind:'server',file,value:JSON.parse(fs.readFileSync(file))}:null;}
process.once('SIGTERM',()=>{stop();process.exit(0);});
process.once('SIGINT',()=>{stop();process.exit(0);});
function stop(){lanDiscovery?.stop();lanDiscovery=null;tunnelClient?.stop();tunnelClient=null;tunnelOnline=false;relayClient?.stop();relayClient=null;relayOnline=false;clearInterval(relayPoll);wanted=false;clearTimeout(retry);child?.kill();child=null;connected=false;}
function start(){
 if(child)return;const c=config();if(!c)throw new Error('请先完成电脑连接配置');migrateCodexExecutable(c.file,c.value);wanted=true;
 const entry=process.platform==='darwin'?path.join(appRoot,'desktop/macos/gateway.mjs'):path.join(appRoot,'gateway',c.kind+'.mjs');
 child=spawn(process.execPath,[entry,c.file],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 const instance=child;
 child.stdout.resume();child.stderr.on('data',raw=>{const message=gatewayFailure(raw.toString());if(message)lastError=message;});
 child.on('message',m=>{if(m?.type==='connection'){connected=m.connected===true;if(connected)lastError='';}});
 child.on('error',()=>{lastError='连接程序启动失败，请检查程序文件与路径';});
 child.on('exit',()=>{if(child!==instance)return;child=null;connected=false;if(wanted){lastError||='连接服务启动后退出，正在重试';retry=setTimeout(start,10000);}});
}
async function hubState(c){
 return new Promise(resolve=>{const req=https.get('https://127.0.0.1:'+c.value.port+'/api/devices',{ca:fs.readFileSync(c.value.tls.cert),headers:{Authorization:'Bearer '+c.value.token}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>{try{resolve(res.statusCode===200?JSON.parse(text):null);}catch{resolve(null);}});});req.on('error',()=>resolve(null));req.setTimeout(1800,()=>{req.destroy();resolve(null);});});
}
async function meshAddress(c){
 const run=promisify(execFile);
 const candidates=process.platform==='win32'?['D:/Software/Tailscale/tailscale.exe','C:/Program Files/Tailscale/tailscale.exe','tailscale.exe']:['/Applications/Tailscale.app/Contents/MacOS/Tailscale','/usr/local/bin/tailscale','tailscale'];
 for(const executable of candidates){try{const {stdout}=await run(executable,['status','--json'],{timeout:3500,windowsHide:true,maxBuffer:1048576});const value=JSON.parse(stdout);if(value.BackendState!=='Running'||value.Self?.Online===false)throw new Error('MYDEX_MESH_OFFLINE');const ip=(value.TailscaleIPs||value.Self?.TailscaleIPs||[]).find(x=>/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/.test(x));if(ip)return 'https://'+ip+':'+c.value.port;}catch(e){if(e.message==='MYDEX_MESH_OFFLINE')throw new Error('请先在电脑登录 Tailscale 并连接网络');}}
 const ip=Object.entries(os.networkInterfaces()).filter(([name])=>/tailscale/i.test(name)).flatMap(([,items])=>items).find(x=>x.family==='IPv4'&&/^100\./.test(x.address));
 if(ip)return 'https://'+ip.address+':'+c.value.port;
 throw new Error('未发现在线 Tailscale 地址，请先在电脑登录并连接 Tailscale');
}
async function execute(m){
 const b=m.args||{};
 if(m.action==='prepareTool'){
  const c=config();if(!c||c.kind!=='server')throw Error('本机连接服务尚未配置');
  const payload=JSON.stringify({tool:b.tool});
  return new Promise((resolve,reject)=>{const req=https.request({hostname:'127.0.0.1',port:c.value.port,path:'/api/tools/prepare',method:'POST',ca:fs.readFileSync(c.value.tls.cert),checkServerIdentity:()=>undefined,headers:{Authorization:'Bearer '+c.value.token,'Content-Type':'application/json'}},res=>{
   let text='';res.on('data',d=>{if(text.length<16384)text+=d;});res.on('end',()=>{try{const value=JSON.parse(text);if(res.statusCode!==200)return reject(Error('原应用尚未就绪，请查看连接能力'));resolve(value);}catch{reject(Error('无法核对应用状态'));}});
  });req.on('error',()=>reject(Error('连接服务尚未就绪')));req.setTimeout(55000,()=>req.destroy());req.end(payload);});
 }
 if(m.action==='authorizeCodexDesktop'&&process.platform==='darwin')return desktopAccess({action:'authorize'});
 if(m.action==='checkUpdate')return updater.check();
 if(m.action==='downloadUpdate')return updater.beginDownload();
 if(m.action==='installUpdate')return updater.install(process.platform==='darwin'?{pids:child?[child.pid]:[]}:undefined);
 if(m.action==='defaults'){
  const addresses=Object.entries(os.networkInterfaces()).filter(([name])=>!/(vmware|virtual|tailscale|wsl|loopback|hyper-v)/i.test(name)).flatMap(([,items])=>items).filter(x=>x.family==='IPv4'&&!x.internal);
  return {name:os.hostname(),address:'https://'+(addresses[0]?.address||'127.0.0.1')+':18443',codex:discoverCodex(),thread:discoverThread()};
 }
 if(m.action==='configureHub'){
  if(config())throw new Error('已有配置，未覆盖。请使用新的数据目录或导入现有连接。');
  createHub({directory:profile.root,address:b.address,name:b.name,codexExecutable:b.codex||discoverCodex(),callerThreadId:b.thread||discoverThread(),standalone:true});profile.address=new URL(b.address).origin;save();return {ok:true};
 }
 if(m.action==='attach'){
  if(child)throw new Error('请先停止由本应用启动的连接');
  const file=path.resolve(b.file);if(path.basename(file)!=='config.json'||path.basename(path.dirname(file))!=='private')throw new Error('请选择 gateway/private/config.json');
  const value=JSON.parse(fs.readFileSync(file));if(!value.local?.dataDir)throw new Error('不是 Mydex 配置');
  profile={root:path.dirname(path.dirname(path.dirname(file))),address:b.address||''};save();return {ok:true};
 }
 if(m.action==='start'){start();return {ok:true};}
 if(m.action==='restoreClaude'){const result=await restoreClaude();toolsAt=0;return result;}
 if(m.action==='bridgeDiagnostics'){
  if(!['claude','deepseek','zcode'].includes(b.id))throw Error('请选择 Claude、DSH 或 ZCode');
  const found=b.id==='claude'?await findClaude():await findElectron(b.id);
  const install=b.id==='claude'?claudeInstallationState():electronInstallationState(b.id);
  const current=await new ToolRegistry(config()?.value.local||{}).tools();
  const connected=current.some(t=>t.id===(b.id==='claude'?'claude-desktop':b.id)&&t.capabilities?.send===true);
  return {detected:!!found.app,app:found.app,source:found.source,store:found.store,processRunning:found.running,files:install.state,connected,message:connected?'原会话接口已接通':install.message,lastError:install.lastError||''};
 }
 if(m.action==='findClaude')return findClaude();
 if(m.action==='installClaude'){if(claudeInstalling)throw Error('Claude 连接桥正在安装，请等待完成');if(typeof b.app!=='string'||!b.app.trim())throw Error('请选择 Claude 安装目录');claudeInstalling=true;try{const result=await installClaude(b.app,{profileDirectory:b.profile,storeDirectory:b.storeDirectory});toolsAt=0;if(result.storeCopy){try{await launchStoreCopy({ensureClosed:assertClaudeClosed});return {...result,launched:true};}catch(e){return {...result,launched:false,launchError:String(e.message)};}}return result;}finally{claudeInstalling=false;}}
 if(m.action==='launchClaudeCompatibility')return launchStoreCopy({ensureClosed:assertClaudeClosed});
 if(m.action==='findToolBridge'){if(b.id==='gemini')return findGemini();return findElectron(b.id);}
 if(m.action==='installToolBridge'){if(typeof b.app!=='string'||!b.app.trim())throw Error('请选择工具安装目录');const result=b.id==='gemini'?await installGemini(b.app):await installElectron(b.id,b.app);toolsAt=0;return result;}
 if(m.action==='restoreToolBridge'){const result=b.id==='gemini'?await restoreGemini():await restoreElectron(b.id);toolsAt=0;return result;}
 if(m.action==='configureTool'){
  const c=config();if(!c)throw new Error('请先配置电脑连接');
  if(!['claude','gemini','opencode','openclaw'].includes(b.toolId)||!fs.existsSync(b.executable)||!/[.](exe|cmd|mjs|cjs|js)$/i.test(b.executable))throw new Error('请选择支持的工具启动文件');
  c.value.local.toolExecutables={...c.value.local.toolExecutables,[b.toolId]:path.resolve(b.executable)};fs.writeFileSync(c.file,JSON.stringify(c.value,null,2));toolsAt=0;
  if(child){stop();start();}return {ok:true};
 }
 if(m.action==='stop'){stop();return {ok:true};}
 if(m.action==='relayPairing'){
  const c=config();if(!c)throw new Error('请先配置本机并启动连接');
  const previous=fs.existsSync(relayFile)?JSON.parse(fs.readFileSync(relayFile,'utf8')):{};
  const computerId=new crypto.X509Certificate(fs.readFileSync(c.value.tls.cert)).fingerprint256.replaceAll(':','').toLowerCase();
  relayPair=await relayApi('/relay/pair/start',{name:c.value.devices.find(d=>d.id===c.value.local.id)?.name||os.hostname(),computerId,previousDeviceId:previous.deviceId,previousToken:previous.token});
  clearInterval(relayPoll);relayPoll=setInterval(()=>void pollRelay(),2500);
  return {image:(await QRCode.toBuffer(relayPair.url,{width:320,margin:4})).toString('base64'),expiresAt:relayPair.expiresAt,name:'确认码 '+relayPair.check,url:relayPair.url};
 }
 if(m.action==='pairingPreview'){
  const payload={schema:'mydex.pair.v1',name:'演示电脑',baseUrl:'https://192.0.2.1:18443',fingerprint:'0'.repeat(64),code:'x'.repeat(43),expiresAt:Date.now()+120000};
  return {image:(await QRCode.toBuffer(JSON.stringify(payload),{width:320,margin:4})).toString('base64'),expiresAt:payload.expiresAt,name:'演示电脑'};
 }
 if(m.action==='pairingQr'||m.action==='meshPairingQr'||m.action==='tunnelPairingQr'){
  const c=config();if(!c||!profile.address)throw new Error('请先配置本机地址并启动连接服务');
  const mesh=m.action==='meshPairingQr';
  const tunnel=m.action==='tunnelPairingQr'?tunnelPairingFields():null;
  const baseUrl=mesh?await meshAddress(c):new URL(profile.address).origin;if(!baseUrl.startsWith('https://'))throw new Error('扫码配对需要 HTTPS 地址');
  const invitation=await new Promise((resolve,reject)=>{
   const req=https.request('https://127.0.0.1:'+c.value.port+'/api/pairing/create',{method:'POST',ca:fs.readFileSync(c.value.tls.cert),headers:{Authorization:'Bearer '+c.value.token}},res=>{let raw='';res.on('data',b=>raw+=b);res.on('end',()=>{try{const value=JSON.parse(raw);res.statusCode===200?resolve(value):reject(new Error(value.error||'二维码生成失败'));}catch{reject(new Error('请更新并启动电脑连接服务'));}});});
   req.on('error',()=>reject(new Error('请先启动本机连接服务')));req.setTimeout(5000,()=>req.destroy(new Error('连接超时')));req.end();
  });
  const payload={schema:tunnel?'mydex.pair.v2':'mydex.pair.v1',baseUrl,...(mesh?{mesh:true}:{}),...tunnel,name:c.value.devices.find(d=>d.id===c.value.local.id)?.name||os.hostname(),fingerprint:new crypto.X509Certificate(fs.readFileSync(c.value.tls.cert)).fingerprint256.replaceAll(':','').toLowerCase(),...invitation};
  return {image:(await QRCode.toBuffer(JSON.stringify(payload),{type:'png',width:320,margin:4,errorCorrectionLevel:'M'})).toString('base64'),expiresAt:invitation.expiresAt,name:payload.name};
 }
 if(m.action==='tunnelPairing'){
  const c=config();if(!c)throw Error('请先启动本机连接服务');
  const fields=tunnelPairingFields(),fingerprint=new crypto.X509Certificate(fs.readFileSync(c.value.tls.cert)).fingerprint256.replaceAll(':','').toLowerCase();
  return {bundle:'MYDEX-CONNECTION\n'+JSON.stringify({schema:'mydex.connection.v2',...fields,name:c.value.devices.find(d=>d.id===c.value.local.id)?.name||os.hostname(),token:c.value.token,fingerprint},null,2)};
 }
 if(m.action==='pairing'||m.action==='meshPairing'){
  const c=config();if(!c)throw new Error('请先配置这台电脑的连接地址');
  const mesh=m.action==='meshPairing';const address=mesh?await meshAddress(c):profile.address||'';const fingerprint=new crypto.X509Certificate(fs.readFileSync(c.value.tls.cert)).fingerprint256.replaceAll(':','').toLowerCase();
  return {address,token:c.value.token,fingerprint,bundle:'MYDEX-CONNECTION\n'+JSON.stringify({schema:'mydex.connection.v1',...(mesh?{mesh:true}:{}),name:c.value.devices.find(d=>d.id===c.value.local.id)?.name||os.hostname(),baseUrl:address,token:c.value.token,fingerprint},null,2)};
 }
 if(m.action==='status'){
  if(b.force)toolsAt=0;
  const c=config();let devices=[];
  if(c?.kind==='server'){const r=await hubState(c);connected=!!r;devices=r?.devices||[];}
  if(connected)ensureRelay();else if(relayClient){relayClient.stop();relayClient=null;relayOnline=false;}
  if(connected){try{ensureTunnel();}catch{}}
  if(Date.now()-toolsAt>15000){tools=await new ToolRegistry(c?.value.local||{}).tools();toolsAt=Date.now();}
  if(process.platform==='darwin'){
   let desktopReady=false;try{await new Desktop(c?.value.local?.callerThreadId).discover();desktopReady=true;}catch{}
   let followerReady=false;
   if(!desktopReady){const follower=new NativeFollower();try{await follower.connect();followerReady=true;}catch{}finally{follower.close();}}
   const canCreate=followerReady&&await new MacDesktopNavigation(null,null).capability();
   tools=tools.map(t=>t.id==='codex'?{...t,capabilities:{...t.capabilities,send:desktopReady||followerReady,create:desktopReady||!!canCreate},note:desktopReady?'已发现原桌面接口；原会话联调待确认':followerReady?'已连接桌面原会话，可自动载入；新建需在设置中授权辅助功能（预览）':'未发现原桌面接口；请打开 Codex，当前不可续聊'}:t);
  }
  const bridgeStates={claude:claudeInstallationState(),deepseek:electronInstallationState('deepseek'),zcode:electronInstallationState('zcode')};
  for(const [id,item] of Object.entries(bridgeStates)){item.connected=tools.some(t=>t.id===(id==='claude'?'claude-desktop':id)&&t.capabilities?.send===true);if(item.connected)item.message='原会话接口已接通';else if(item.installed)item.message=item.mode==='storeCopy'?'兼容副本已安装；请使用“打开 Claude 兼容版”启动，再检查原会话接口':'桥接文件已写入，但原会话接口未接通；请完全退出并重新打开原应用后检查';}
  if(process.platform==='darwin')updater.acknowledge();
  return {bridgeStates,update:updater.state,tunnelOnline,relayOnline,relayPaired:fs.existsSync(relayFile),configured:!!c,role:c?.kind||'',owned:!!child,retrying:wanted&&!child,connected,error:lastError,tools,devices,claudeCompatibility:claudeCompatibilityInstalled(),toolBridgeInstalled:{deepseek:electronInstalled('deepseek'),zcode:electronInstalled('zcode'),gemini:geminiInstalled()},address:profile.address||c?.value.gateway||'',dataRoot:profile.root};
 }
 throw new Error('未知操作');
}
let queue=Promise.resolve();
readline.createInterface({input:process.stdin}).on('line',line=>{queue=queue.then(async()=>{let m;try{m=JSON.parse(line);const result=await execute(m);process.stdout.write(JSON.stringify({id:m.id,result})+'\n');}catch(e){process.stdout.write(JSON.stringify({id:m?.id,error:e.message})+'\n');}});}).on('close',()=>{queue.finally(()=>{stop();});});
