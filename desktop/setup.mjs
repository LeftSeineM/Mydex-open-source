import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {isIP} from 'node:net';
import readline from 'node:readline/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'gateway/package.json'));
const forge=require('node-forge');

export function discoverCodex(home=os.homedir(),platform=process.platform){
 if(platform==='darwin'){
  const candidates=['/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex','/Applications/Codex.app/Contents/Resources/codex',path.join(home,'Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'),path.join(home,'Applications/Codex.app/Contents/Resources/codex'),'/opt/homebrew/bin/codex','/usr/local/bin/codex',path.join(home,'.local/bin/codex')];
  return candidates.find(p=>{try{fs.accessSync(p,fs.constants.X_OK);return fs.statSync(p).isFile();}catch{return false;}})||'';
 }
 const bin=path.join(home,'AppData/Local/OpenAI/Codex/bin');
 try{return fs.readdirSync(bin).map(n=>path.join(bin,n,'codex.exe')).filter(p=>fs.existsSync(p)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0]||'';}catch{return '';}
}
// Fill only missing macOS CLI paths. Preserve credentials, device identity and
// explicit executable choices; keep a private backup before the atomic write.
export function migrateCodexExecutable(file,config,{platform=process.platform,discover=discoverCodex}={}){
 if(platform!=='darwin'||!config.local||config.local.codexExecutable)return false;
 const executable=discover();if(!executable)return false;
 const backup=file+'.before-codex-path-migration';
 if(!fs.existsSync(backup))fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);
 const next={...config,local:{...config.local,codexExecutable:executable}};
 fs.writeFileSync(file+'.tmp',JSON.stringify(next,null,2),{mode:0o600});
 fs.renameSync(file+'.tmp',file);config.local.codexExecutable=executable;return true;
}
export function discoverThread(home=os.homedir()){
 let db;try{const {DatabaseSync}=require('node:sqlite');const dir=process.env.CODEX_HOME||path.join(home,'.codex');const file=fs.readdirSync(dir).filter(n=>/^state_\d+\.sqlite$/.test(n)).sort((a,b)=>Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]))[0];if(!file)return '';
  db=new DatabaseSync(path.join(dir,file),{readOnly:true});return db.prepare('SELECT id FROM threads WHERE archived=0 ORDER BY updated_at DESC LIMIT 1').get()?.id||'';
 }catch{return '';}finally{db?.close();}
}
export function createCertificate(host,dir){
 const keys=forge.pki.rsa.generateKeyPair(2048);const cert=forge.pki.createCertificate();cert.publicKey=keys.publicKey;
 cert.serialNumber='01'+crypto.randomBytes(15).toString('hex');cert.validity.notBefore=new Date(Date.now()-300000);cert.validity.notAfter=new Date(Date.now()+365*86400000);
 const attributes=[{name:'commonName',value:'Mydex Private Gateway'}];cert.setSubject(attributes);cert.setIssuer(attributes);
 const hosts=[...new Set([host,'localhost','127.0.0.1'])];
 cert.setExtensions([{name:'basicConstraints',cA:true},{name:'keyUsage',digitalSignature:true,keyEncipherment:true,keyCertSign:true},{name:'extKeyUsage',serverAuth:true},{name:'subjectAltName',altNames:hosts.map(h=>isIP(h)?{type:7,ip:h}:{type:2,value:h})}]);
 cert.sign(keys.privateKey,forge.md.sha256.create());
 const pem=forge.pki.certificateToPem(cert);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'server-key.pem'),forge.pki.privateKeyToPem(keys.privateKey),{mode:0o600});fs.writeFileSync(path.join(dir,'server-cert.pem'),pem);
 return {pem,fingerprint:new crypto.X509Certificate(pem).fingerprint256.replaceAll(':','').toLowerCase()};
}
export function createHub({directory,address,name='我的电脑',codexExecutable='',callerThreadId='',standalone=false}){
 const gateway=path.join(directory,'gateway'),priv=path.join(gateway,'private');
 if(fs.existsSync(path.join(priv,'config.json')))throw new Error('已有网关配置，未覆盖。请先备份或选择添加电脑。');
 const url=new URL(address);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/')throw new Error('地址必须为 https://主机:端口');
 const port=Number(url.port)||443;if(port<1024)throw new Error('请选择 1024–65535 的用户端口');
 const token=crypto.randomBytes(36).toString('base64url'),agentToken=crypto.randomBytes(36).toString('base64url');
 const tls=createCertificate(url.hostname.replace(/^\[|\]$/g,''),priv);fs.mkdirSync(path.join(directory,'workspace'),{recursive:true});
 const config={host:'0.0.0.0',port,token,tls:{key:path.join(priv,'server-key.pem'),cert:path.join(priv,'server-cert.pem')},ledgerFile:path.join(priv,'requests.json'),
  local:{id:'main',dataDir:path.join(priv,'main-state'),workspace:path.join(directory,'workspace'),codexExecutable,callerThreadId},
  devices:standalone?[{id:'main',name}]:[{id:'main',name},{id:'computer-2',name:'第二台电脑',token:agentToken}]};
 fs.writeFileSync(path.join(priv,'config.json'),JSON.stringify(config,null,2),{mode:0o600});
 if(!standalone)fs.writeFileSync(path.join(priv,'pair-computer-2.json'),JSON.stringify({gateway:url.origin,token:agentToken,deviceId:'computer-2',name:'第二台电脑',certificate:tls.pem},null,2),{mode:0o600});
 fs.writeFileSync(path.join(priv,'手机连接信息.txt'),`Mydex 私人连接信息，请勿公开分享\n\n后端地址：${url.origin}\n访问令牌：${token}\n证书 SHA-256 指纹：${tls.fingerprint}\n\n将此信息填入手机设置。外网连接还需主机端口可达。\n`,{mode:0o600});
 return config;
}
async function main(){
 console.log('\nMydex 桌面连接程序 · 0.2.0\n配置保存在当前文件夹，不修改模型供应商或账号。\n');
 const rl=readline.createInterface({input:process.stdin,output:process.stdout});
 const ask=async(q,fallback='')=>(await rl.question(q+(fallback?` [${fallback}]`:'')+'：')).trim()||fallback;
 try{
  const role=await ask('1 主机 / 2 连接另一台主机 / 3 为现有主机增加电脑','1');
  const priv=path.join(root,'gateway/private');fs.mkdirSync(priv,{recursive:true});
  if(role==='3'){
   const file=path.join(priv,'config.json'),c=JSON.parse(fs.readFileSync(file));
   const id='computer-'+crypto.randomBytes(4).toString('hex'),name=await ask('电脑名称','另一台电脑');
   const address=await ask('主机 HTTPS 地址');const url=new URL(address);if(url.protocol!=='https:')throw new Error('请填写 HTTPS 地址');
   const token=crypto.randomBytes(36).toString('base64url');c.devices.push({id,name,token});
   fs.writeFileSync(file,JSON.stringify(c,null,2));fs.writeFileSync(path.join(priv,'pair-'+id+'.json'),JSON.stringify({gateway:url.origin,token,deviceId:id,name,certificate:fs.readFileSync(c.tls.cert,'utf8')},null,2));
   console.log('已创建配对文件。重启本主机连接程序后，将 private 内对应 pair 文件私下交给另一台电脑。');return;
  }
  const codexExecutable=await ask('Codex 可执行文件（自动检测，可留空）',discoverCodex());
  const callerThreadId=await ask('Codex 已有会话 ID（自动检测）',discoverThread());
  if(role==='1'){
   const ip=Object.values(os.networkInterfaces()).flat().find(a=>a.family==='IPv4'&&!a.internal)?.address||'127.0.0.1';
   const address=await ask('手机可访问的 HTTPS 地址',`https://${ip}:18443`);
   createHub({directory:root,address,name:await ask('本机名称',os.hostname()),codexExecutable,callerThreadId});
   console.log('配置完成。手机连接信息和第二台电脑配对文件在 gateway/private。运行 start.cmd；若防火墙拦截，只放行配置中的 TCP 端口。');
  }else if(role==='2'){
   const file=await ask('主机生成的配对 JSON 文件路径');const p=JSON.parse(fs.readFileSync(file.replace(/^"|"$/g,''),'utf8'));
   if(new URL(p.gateway).protocol!=='https:'||typeof p.token!=='string'||p.token.length<24||!p.deviceId)throw new Error('配对文件无效');
   const target=path.join(priv,'agent.json');if(fs.existsSync(target))throw new Error('已有代理配置，未覆盖。请先备份。');
   new crypto.X509Certificate(p.certificate);fs.writeFileSync(path.join(priv,'server-cert.pem'),p.certificate);
   const workspace=path.join(root,'workspace');fs.mkdirSync(workspace,{recursive:true});
   fs.writeFileSync(target,JSON.stringify({gateway:p.gateway,token:p.token,caFile:path.join(priv,'server-cert.pem'),local:{id:p.deviceId,dataDir:path.join(priv,p.deviceId+'-state'),workspace,codexExecutable,callerThreadId}},null,2),{mode:0o600});
   console.log('配对完成，运行 start.cmd 即可连接。');
  }else throw new Error('请选择 1、2 或 3');
 }finally{rl.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error('设置未完成：'+e.message);process.exitCode=1;});
