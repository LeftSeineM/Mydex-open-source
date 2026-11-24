import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setGlobalProxyFromEnv} from 'node:http';
export const desktopVersion='0.4.27';
export const updateOrigin='https://app.leftseinem.com';
export const legacyUpdateOrigin='https://app.leftseinem.dpdns.org';
const publicKey=`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAhbTNjX6AGrlT5tlbCNaLVK7eD/RJzi8PxZGZeYxv/FA=
-----END PUBLIC KEY-----`;
export const githubManifest='https://raw.githubusercontent.com/LeftSeineM/Mydex-mobile/main/updates/desktop-stable.json';
export const githubPackage=version=>`https://github.com/LeftSeineM/Mydex-mobile/releases/download/desktop-v${version}/Mydex-${version}-Setup.exe`;
export async function startUpdateHelper(script,ready){
 const q=v=>"'"+String(v).replaceAll("'","''")+"'";
 const launcher=`$ErrorActionPreference='Stop'; Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+${q(script)}+'"')) -WindowStyle Hidden`;
 try{await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(launcher,'utf16le').toString('base64')],{windowsHide:true,timeout:10000});}
 catch{throw Error('更新助手无法启动，Mydex 将保持打开。请稍后重试或手动安装。');}
 for(let i=0;i<80&&!fs.existsSync(ready);i++)await new Promise(resolve=>setTimeout(resolve,100));
 if(!fs.existsSync(ready))throw Error('更新助手没有响应，Mydex 将保持打开。请稍后重试或手动安装。');
}
export function renderInstallScript({root,installer,sha256,version,pids,notifyErrors=true}){
 const q=v=>"'"+String(v).replaceAll("'","''")+"'";
 return `$ErrorActionPreference='Stop'
$appRoot=${q(root)}
$installer=${q(installer)}
$expected=${q(sha256)}
$result=Join-Path $PSScriptRoot 'result.json'
$backup=Join-Path $PSScriptRoot 'backup'
try {
 $env:PSModulePath=(Join-Path $PSHOME 'Modules')+';'+$env:PSModulePath
 Import-Module Microsoft.PowerShell.Management,Microsoft.PowerShell.Utility -ErrorAction Stop
 [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'helper-ready'),'ready')
 foreach($pidToWait in @(${pids.map(Number).join(',')})) { $p=Get-Process -Id $pidToWait -ErrorAction SilentlyContinue; if($p -and !$p.WaitForExit(30000)){throw 'Mydex 尚未退出，未执行安装'} }
 Start-Sleep -Seconds 2
 if((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLower() -ne $expected){throw '安装文件校验失败'}
 New-Item -ItemType Directory -Force $backup | Out-Null
 foreach($name in @('Mydex.exe','desktop','gateway','runtime')) { $src=Join-Path $appRoot $name; if(Test-Path -LiteralPath $src){Copy-Item -LiteralPath $src -Destination $backup -Recurse -Force} }
 $setup=Start-Process -FilePath $installer -ArgumentList ('/S /D='+$appRoot) -WindowStyle Hidden -Wait -PassThru
 if($setup.ExitCode -ne 0){throw ('安装未完成，退出码 '+$setup.ExitCode)}
 $exe=Join-Path $appRoot 'Mydex.exe'
 if((Get-Item -LiteralPath $exe).VersionInfo.FileVersion -ne ${q(version+'.0')}){throw '安装后版本不匹配'}
 Start-Process -FilePath $exe -WorkingDirectory $appRoot -WindowStyle Normal | Out-Null
 [IO.File]::WriteAllText($result,'{"ok":true}')
} catch {
 $failure=$_.Exception.Message
 if(Test-Path -LiteralPath $backup){ Get-ChildItem -LiteralPath $backup | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $appRoot -Recurse -Force -ErrorAction SilentlyContinue} }
 [IO.File]::WriteAllText($result,(@{ok=$false;error=$failure}|ConvertTo-Json))
 ${notifyErrors?"Add-Type -AssemblyName System.Windows.Forms\n [System.Windows.Forms.MessageBox]::Show('更新未完成：'+$failure+'。详情已保存至 '+$result,'Mydex 更新') | Out-Null":''}
 $exe=Join-Path $appRoot 'Mydex.exe'; if(Test-Path -LiteralPath $exe){Start-Process -FilePath $exe -WorkingDirectory $appRoot -WindowStyle Normal}
}
`;
}
export async function releaseFetch(url,options={},fetcher=fetch){
 const initial=new URL(url);let current=initial;
 for(let i=0;i<5;i++){
  // Respect an existing proxy for GitHub only. Keep the owned server and
  // loopback traffic on their original routes. Restore global agents before
  // yielding, so concurrent bridge operations do not inherit this setting.
  let request,restore;
  try{
    if(['github.com','raw.githubusercontent.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(current.hostname))restore=setGlobalProxyFromEnv(process.env);
    request=fetcher(current.href,{...options,redirect:'manual'});
  }finally{restore?.();}
  const response=await request;
  if(![301,302,303,307,308].includes(response.status))return response;
  const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('更新地址重定向无效');
  const next=new URL(location,current);
  const allowed=next.origin===initial.origin||initial.hostname==='github.com'&&['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(next.hostname);
  if(next.protocol!=='https:'||next.username||next.password||next.port||!allowed)throw Error('更新地址跳转到未授权站点');current=next;
 }
 throw Error('更新地址跳转过多');
}
export function newer(a,b){
  if(!/^\d+\.\d+\.\d+$/.test(a)||!/^\d+\.\d+\.\d+$/.test(b))return false;
  const aa=a.split('.').map(Number),bb=b.split('.').map(Number);
  for(let i=0;i<3;i++){if(aa[i]!==bb[i])return aa[i]>bb[i];}return false;
}
export function verifyManifest(envelope,key=publicKey){
  if(typeof envelope?.payload!=='string'||envelope.payload.length>40000||typeof envelope.signature!=='string')throw Error('更新清单格式无效');
  const raw=Buffer.from(envelope.payload,'base64');
  if(!crypto.verify(null,raw,key,Buffer.from(envelope.signature,'base64')))throw Error('更新签名验证失败，已停止更新');
  const m=JSON.parse(raw),url=new URL(m.url);
  if(!/^\d+\.\d+\.\d+$/.test(m.version)||![updateOrigin,legacyUpdateOrigin].includes(url.origin)||url.pathname!==`/downloads/Mydex-${m.version}-Setup.exe`||url.search||url.hash||url.username||!Number.isSafeInteger(m.size)||m.size<1000||m.size>256*1024*1024||!/^[a-f0-9]{64}$/.test(m.sha256)||typeof m.notes!=='string'||m.notes.length>8000)throw Error('更新包信息无效');
  return m;
}
export class DesktopUpdater {
  constructor(root,version=desktopVersion){this.version=version;this.root=path.resolve(root);this.state={current:version,phase:'idle',message:'可在这里检查和安装新版本',progress:0};this.release=null;this.file=null;}
  async check(){
    if(['checking','downloading','ready','installing'].includes(this.state.phase))return this.state;
    this.state={...this.state,phase:'checking',message:'正在检查更新…'};
    try{
      let failure;
      for(const url of [updateOrigin+'/updates/desktop-stable.json',legacyUpdateOrigin+'/updates/desktop-stable.json',githubManifest]){
       try{
        const response=await releaseFetch(url,{signal:AbortSignal.timeout(10000),cache:'no-store'});
        if(!response.ok)throw Error('更新服务暂不可用，请稍后重试');
        const reader=response.body.getReader();let size=0,parts=[];for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>65536){await reader.cancel();throw Error('更新清单过大');}parts.push(r.value);}
        this.release=verifyManifest(JSON.parse(Buffer.concat(parts).toString()));failure=null;break;
       }catch(e){failure=e;}
      }
      if(failure)throw failure;
      const available=newer(this.release.version,this.version);
      this.state={current:this.version,latest:this.release.version,notes:this.release.notes,phase:available?'available':'current',message:available?'发现新版本 '+this.release.version:'当前已是最新版本',progress:0};
    }catch(e){this.state={...this.state,phase:'error',message:e.name==='TimeoutError'?'检查更新超时，请稍后再试':e.message};}
    return this.state;
  }
  beginDownload(){
    if(!this.release||!newer(this.release.version,this.version))throw Error('请先检查是否有新版本');
    if(['downloading','ready','installing'].includes(this.state.phase))return this.state;
    this.state={...this.state,phase:'downloading',progress:0,message:'正在下载安装包…'};
    void this.download().catch(e=>{this.state={...this.state,phase:'error',message:e.message};});return this.state;
  }
  async download(){
    const release=this.release;
    const cacheRoot=fs.existsSync('D:/')?'D:/Software/MydexDownloads':path.join(path.dirname(this.root),'MydexDownloads');
    const dir=path.join(cacheRoot,'desktop-'+release.version+'-'+crypto.randomBytes(6).toString('hex'));
    fs.mkdirSync(dir,{recursive:true});const partial=path.join(dir,'update.partial');
    let fd,lastError;
    for(const url of [...new Set([release.url.replace(legacyUpdateOrigin,updateOrigin),release.url.replace(updateOrigin,legacyUpdateOrigin),githubPackage(release.version)])]){
    try{
      const response=await releaseFetch(url,{signal:AbortSignal.timeout(300000)});
      if(!response.ok)throw Error('安装包下载失败');
      fd=fs.openSync(partial,'wx');const hash=crypto.createHash('sha256');let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>release.size)throw Error('安装包大小不匹配');hash.update(chunk);fs.writeSync(fd,chunk);this.state={...this.state,progress:Math.floor(size/release.size*100),message:'正在下载 '+Math.floor(size/release.size*100)+'%'};}
      fs.closeSync(fd);fd=null;
      if(size!==release.size||hash.digest('hex')!==release.sha256)throw Error('安装包校验失败，已停止更新');
      this.file=path.join(dir,`Mydex-${release.version}-Setup.exe`);fs.renameSync(partial,this.file);
      this.state={...this.state,phase:'ready',progress:100,message:'下载并校验完成，可安装并重启'};return;
    }catch(e){if(fd!==undefined&&fd!==null)fs.closeSync(fd);fd=null;if(fs.existsSync(partial))fs.unlinkSync(partial);lastError=e;this.state={...this.state,message:'正在尝试备用下载源…'};}
    }
    throw lastError;
  }
  async install(){
    if(process.platform!=='win32')throw Error('此更新器适用于 Windows');
    if(this.state.phase!=='ready'||!this.file)throw Error('请先完成下载');
    if(crypto.createHash('sha256').update(fs.readFileSync(this.file)).digest('hex')!==this.release.sha256)throw Error('安装文件发生变化，已停止更新');
    const script=path.join(path.dirname(this.file),'Install-Update.ps1');
    const ready=path.join(path.dirname(this.file),'helper-ready');
    try{fs.unlinkSync(ready);}catch(e){if(e.code!=='ENOENT')throw e;}
    const source=renderInstallScript({root:this.root,installer:this.file,sha256:this.release.sha256,version:this.release.version,pids:[process.ppid,process.pid]});
    fs.writeFileSync(script,'\ufeff'+source);
    // A detached Node child can exit before PowerShell executes its script on
    // Windows. Launch through Start-Process, then wait for an explicit signal
    // before allowing the UI to close. The helper remains hidden in background.
    await startUpdateHelper(script,ready);
    this.state={...this.state,phase:'installing',message:'即将退出并安装更新'};return {ok:true};
  }
}
