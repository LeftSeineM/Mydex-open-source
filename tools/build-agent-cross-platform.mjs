import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
import {verifyPackage} from '../desktop/headless/verify-package.mjs';
// Build only from an existing signed public baseline, never a private Router slot.
const [baseline,runtimes,keyFile,output,version='0.1.9']=process.argv.slice(2);
if(!baseline||!runtimes||!keyFile||!output)throw Error('Usage: node tools/build-agent-cross-platform.mjs PUBLIC_BASELINE NODE_ARCHIVES SIGNING_KEY NEW_OUTPUT [VERSION]');
const src=path.resolve(import.meta.dirname,'..'),base=path.resolve(baseline),work=path.resolve(output),runtimeDirectory=path.resolve(runtimes);
verifyPackage(base,undefined,{platform:'win32',arch:'x64'});fs.mkdirSync(work,{recursive:true});
const key=fs.readFileSync(keyFile);
const hashes=fs.readFileSync(path.join(runtimeDirectory,'SHASUMS256.txt'),'utf8');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const targets=[['win32','x64'],['linux','x64'],['linux','arm64'],['darwin','x64'],['darwin','arm64']];
const assets={};
for(const [platform,arch] of targets){
 const id=platform+'-'+arch,root=path.join(work,'Mydex-Agent-'+version+'-'+id);if(fs.existsSync(root))throw Error('Output exists: '+id);
 fs.cpSync(base,root,{recursive:true,filter:p=>!['agent-package.json'].includes(path.basename(p))});
 const copy=(file)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(path.join(src,file),path.join(root,file));};
 for(const file of ['desktop/headless/verify-package.mjs','desktop/headless/lifecycle.mjs','desktop/headless/manage-posix.mjs','desktop/headless/posix-service.mjs','desktop/headless/open-pairing.mjs','desktop/headless/releases.mjs','desktop/headless/install.sh'])copy(file);
 const mcp=path.join(root,'desktop/headless/mcp.mjs');let text=fs.readFileSync(mcp,'utf8');
 text=text.replace("import {rpc} from './local-state.mjs';","import {rpc} from './local-state.mjs';\nimport {openPairing} from './open-pairing.mjs';\nimport {latestRelease} from './releases.mjs';");
 text=text.replace(/const ps="Start-Process[\s\S]*?return \{opened:true,mode:r.mode,expiresAt:r.expiresAt\};/,"return {...await openPairing(r.file),mode:r.mode,expiresAt:r.expiresAt};");
 text=text.replace('independent Windows background service','independent background service');
 text=text.replace("await server.connect(new StdioServerTransport());","tool('mydex_check_update','Read the signed public Agent update index for this OS and CPU. Download and verify the indicated archive, then use mydex_update; does not change the running installation.',{},latestRelease);\nawait server.connect(new StdioServerTransport());");fs.writeFileSync(mcp,text);
 const pkg=path.join(root,'desktop/headless/package.json'),p=JSON.parse(fs.readFileSync(pkg));p.version=version;fs.writeFileSync(pkg,JSON.stringify(p,null,2));
 // Keep the public stable core; never copy private Router engines or coordinator tools.
 if(fs.existsSync(path.join(root,'desktop/headless/router-mcp.mjs'))||fs.existsSync(path.join(root,'gateway/router/engine.mjs')))throw Error('Private code in public baseline');
 let gui=fs.readFileSync(path.join(root,'desktop/gui-bridge.mjs'),'utf8');gui=gui.replaceAll('https://app.leftseinem.dpdns.org','https://app.leftseinem.com').replace("process.platform==='darwin'?path.join(appRoot,'desktop/macos/gateway.mjs')","process.platform!=='win32'?path.join(appRoot,'desktop/posix-gateway.mjs')");fs.writeFileSync(path.join(root,'desktop/gui-bridge.mjs'),gui);
 fs.writeFileSync(path.join(root,'desktop/posix-gateway.mjs'),"import fs from 'node:fs';import {createGateway} from '../gateway/server.mjs';import {migrateCodexExecutable} from './setup.mjs';const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));migrateCodexExecutable(process.argv[2],config);const {server,refresh}=createGateway(config);server.listen(config.port,config.host,()=>{void refresh();});\n");
 let setup=fs.readFileSync(path.join(root,'desktop/setup.mjs'),'utf8');setup=setup.replace(" if(platform==='darwin'){"," if(platform==='linux'){return [...(process.env.PATH||'').split(path.delimiter),path.join(home,'.local/bin')].map(d=>path.join(d,'codex')).find(p=>{try{fs.accessSync(p,fs.constants.X_OK);return fs.statSync(p).isFile();}catch{return false;}})||'';}\n if(platform==='darwin'){").replace("platform!=='darwin'||!config.local","!['darwin','linux'].includes(platform)||!config.local");fs.writeFileSync(path.join(root,'desktop/setup.mjs'),setup);
 // Retain the tested full-download fix in the public transport.
 for(const f of ['gateway/tunnel-host.mjs','gateway/tunnel-relay.mjs'])copy(f);
 const host=path.join(root,'gateway/tunnel-host.mjs');fs.writeFileSync(host,fs.readFileSync(host,'utf8').replace("process.env.MYDEX_TUNNEL_IPV4==='1'?4:undefined",'4'));
 if(platform!=='win32'){
  fs.rmSync(path.join(root,'runtime'),{recursive:true});fs.mkdirSync(path.join(root,'runtime/bin'),{recursive:true});
  const ext=platform==='linux'?'tar.xz':'tar.gz',name='node-v24.22.3-'+platform+'-'+arch,archive=path.join(runtimeDirectory,name+'.'+ext);
  const expected=hashes.split(/\r?\n/).find(l=>l.endsWith(name+'.'+ext))?.split(/\s+/)[0];if(hash(fs.readFileSync(archive))!==expected)throw Error('Official Node checksum mismatch');
  const extract=path.join(work,'node-'+id);fs.mkdirSync(extract,{recursive:true});execFileSync('tar.exe',['-xf',archive,'-C',extract,name+'/bin/node',name+'/LICENSE'],{windowsHide:true});
  fs.copyFileSync(path.join(extract,name,'bin/node'),path.join(root,'runtime/bin/node'));fs.copyFileSync(path.join(extract,name,'LICENSE'),path.join(root,'runtime/LICENSE'));
 }
 const skill=fs.readFileSync(path.join(base,'desktop/headless/skill/SKILL.md'),'utf8').replace('independent Windows phone connector','independent Windows, Linux and macOS phone connector').replace('Choose a directory under D:/Software unless the user specifies another location.','Detect OS and CPU, choose its matching signed package. Use a user-chosen dedicated directory; on Windows prefer a non-C drive. Linux requires a working systemd user session, macOS a logged-in graphical launchd session. On Linux/macOS run `sh <package>/desktop/headless/install.sh <absolute-install-directory>` instead of PowerShell. The installed `<root>/mydex-agent` supports `status`, `start`, `configureHub`, `pair` and lifecycle commands. Use `<root>/mydex-mcp.json` to merge the MCP entry. Do not run sudo or create console windows. The Windows instructions below apply only on Windows.').replace('Use `mydex_update` with an extracted, signed Agent package directory','Use `mydex_check_update` to select the current OS/CPU release from the signed stable index. Download its URL, verify SHA-256, extract, then use `mydex_update` with the extracted, signed Agent package directory');
 fs.writeFileSync(path.join(root,'desktop/headless/skill/SKILL.md'),skill);
 fs.writeFileSync(path.join(root,'desktop/headless/README.md'),'# Mydex-agent '+version+'\n\nWindows x64 / Linux x64 & arm64 / macOS Intel & Apple Silicon. Read skill/SKILL.md before installing. Linux uses systemd --user; macOS uses launchd in the logged-in user session. No sudo, third-party AI SDK or new Coding application. Configuration is retained on update/uninstall.\n\nLinux x64 lifecycle tested under WSL; macOS and ARM builds are previews without real-device end-to-end validation. Original conversation capabilities depend on each tool and its official/existing interface; detection alone is not control. No private Router/Superagent release in these packages.\n');
 if(platform==='win32'){
  const file=path.join(root,'desktop/headless/manage.ps1');let s=fs.readFileSync(file,'utf8');const guard=`\n$profileFile=Join-Path $Root 'data/desktop-profile.json'\nif(($manifest.features.router -eq $false) -and (Test-Path -LiteralPath $profileFile)){\n $profile=Get-Content -LiteralPath $profileFile -Raw|ConvertFrom-Json\n $privateConfig=Join-Path $profile.root 'gateway/private/config.json'\n if((Test-Path -LiteralPath $privateConfig) -and ((Get-Content -LiteralPath $privateConfig -Raw|ConvertFrom-Json).router.enabled -eq $true)){throw 'Keep private Router installation on its private update channel'}\n}\n`;
  if(!s.includes('Keep private Router installation'))s=s.replace('$slot=$manifest.version',guard+'$slot=$manifest.version');fs.writeFileSync(file,s);
 }
 const files=[];function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Symlink');if(e.isDirectory())scan(f);else {const b=fs.readFileSync(f);files.push({path:path.relative(root,f).replaceAll('\\','/'),size:b.length,sha256:hash(b)});}}}scan(root);
 const payload=Buffer.from(JSON.stringify({product:platform==='win32'?'mydex-agent-windows':'mydex-agent-'+platform,version,platform,arch,features:{router:false},files}));fs.writeFileSync(path.join(root,'agent-package.json'),JSON.stringify({payload:payload.toString('base64'),signature:crypto.sign(null,payload,key).toString('base64')}));verifyPackage(root,undefined,{platform,arch});
 const filename='Mydex-Agent-'+version+'-'+id+'.zip',archive=path.join(work,filename);execFileSync('tar.exe',['-a','-cf',archive,'-C',root,'.'],{windowsHide:true});const b=fs.readFileSync(archive);assets[id]={url:'https://app.leftseinem.com/downloads/'+filename,size:b.length,sha256:hash(b),preview:platform!=='win32'};console.log(JSON.stringify({id,...assets[id]}));
}
const manifest={schemaVersion:1,product:'mydex-agent',version,assets},raw=Buffer.from(JSON.stringify(manifest));fs.writeFileSync(path.join(work,'latest.json'),JSON.stringify({...manifest,payload:raw.toString('base64'),signature:crypto.sign(null,raw,key).toString('base64')},null,2));
