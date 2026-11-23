import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const definitions={claude:{exe:'claude.exe',names:['Claude','AnthropicClaude'],roots:['D:/Software/ClaudeDesktop']},zcode:{exe:'ZCode.exe',names:['ZCode'],roots:['D:/Software/ZCode']},deepseek:{exe:'DeepSeek Harness.exe',names:['DeepSeek Harness','DeepSeekHarness'],roots:['D:/Software/DeepSeekHarness']}};
const run=promisify(execFile);
export async function windowsInventory(){
 if(process.platform!=='win32')return [];
 // Export installation metadata only. Never inspect command lines, credentials,
 // uninstall commands or other application's conversation content.
 const ps=`$ErrorActionPreference='SilentlyContinue';$rows=@();Get-CimInstance Win32_Process | Where-Object {$_.Name -match '^(claude|zcode|DeepSeek Harness)[.]exe$' -and $_.ExecutablePath} | ForEach-Object {$rows+=[pscustomobject]@{exe=$_.ExecutablePath;source='running'}};Get-AppxPackage | Where-Object {$_.Name -match 'Claude|ZCode|DeepSeek'} | ForEach-Object {$rows+=[pscustomobject]@{app=$_.InstallLocation;source='store'}};foreach($root in @('HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/*','HKLM:/Software/Microsoft/Windows/CurrentVersion/Uninstall/*','HKLM:/Software/WOW6432Node/Microsoft/Windows/CurrentVersion/Uninstall/*')){Get-ItemProperty $root | Where-Object {$_.DisplayName -match 'Claude|ZCode|DeepSeek'} | ForEach-Object {$rows+=[pscustomobject]@{app=$_.InstallLocation;icon=$_.DisplayIcon;source='registry'}}};ConvertTo-Json -InputObject @($rows) -Compress`;
 try{const r=await run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{windowsHide:true,timeout:15000,maxBuffer:1024*1024});const value=JSON.parse(r.stdout.trim()||'[]');return Array.isArray(value)?value:[];}catch{return [];}
}
export async function discoverApplication(id,{inventory=windowsInventory,env=process.env,roots}={}){
 const def=definitions[id];if(!def)throw Error('不支持的桌面工具');
 const candidates=new Map();
 const add=(app,source)=>{if(typeof app!=='string'||!app.trim())return;app=path.resolve(app);const exe=path.join(app,def.exe);if(!fs.existsSync(exe)||!fs.existsSync(path.join(app,'resources/app.asar')))return;const key=app.toLowerCase(),priority={running:100,store:80,registry:60,directory:40}[source]||0;const old=candidates.get(key);if(!old||priority>old.priority)candidates.set(key,{app,source,priority,running:source==='running',store:/[\\/]WindowsApps[\\/]/i.test(app)});};
 const expand=(root,source)=>{add(root,source);add(path.join(root,'app'),source);try{for(const d of fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()&&/^app-/i.test(d.name)).sort((a,b)=>b.name.localeCompare(a.name,undefined,{numeric:true})))add(path.join(root,d.name),source);}catch{}};
 for(const row of await inventory()){
  if(row.exe&&path.basename(row.exe).toLowerCase()===def.exe.toLowerCase())add(path.dirname(row.exe),row.source);
  if(row.app)expand(row.app,row.source);
  if(typeof row.icon==='string'){const icon=row.icon.trim().replace(/^"([^"]+)"(?:,\s*-?\d+)?$/,'$1').replace(/,\s*-?\d+$/,'');if(path.basename(icon).toLowerCase()===def.exe.toLowerCase())add(path.dirname(icon),row.source);}
 }
 for(const root of roots??[...def.roots,...def.names.flatMap(name=>[env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,name),env.ProgramFiles&&path.join(env.ProgramFiles,name),env['ProgramFiles(x86)']&&path.join(env['ProgramFiles(x86)'],name)]).filter(Boolean)])expand(root,'directory');
 const found=[...candidates.values()].sort((a,b)=>b.priority-a.priority||b.app.localeCompare(a.app,undefined,{numeric:true}));
 return {app:found[0]?.app||'',source:found[0]?.source||'',running:found[0]?.running||false,store:found[0]?.store||false,candidates:found.map(({priority,...item})=>item)};
}
