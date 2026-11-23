import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
let cached=[],at=0;
export function parseMacProcesses(text){
 const found=[];
 for(const line of text.split('\n')){
  const match=/^\s*(\d+)\s+(.+?)\s*$/.exec(line);if(!match)continue;
  const executable=match[2];let toolId;
  if(/\/Codex\.app\/Contents\/(MacOS\/Codex|Resources\/codex)$/.test(executable)||/\/codex$/.test(executable))toolId='codex';
  else if(/\/DeepSeek Harness\.app\/Contents\/MacOS\/DeepSeek Harness$/.test(executable))toolId='deepseek';
  else if(/\/Claude\.app\/Contents\/MacOS\/Claude$/.test(executable))toolId='claude-desktop';
  else if(/\/ZCode\.app\/Contents\/MacOS\/ZCode$/.test(executable))toolId='zcode';
  else {const name=executable.split('/').at(-1);if(['claude','gemini','opencode','openclaw','kimi'].includes(name))toolId=name;}
  if(toolId)found.push({toolId,pid:Number(match[1]),executable,sessionId:null});
 }
 return found;
}
export async function codingProcesses(){
 if(Date.now()-at<10000)return cached;
 if(process.platform==='darwin'){
  // comm contains executable names only, never full argv or provider tokens.
  try{const r=await run('/bin/ps',['-axo','pid=,comm='],{timeout:5000,maxBuffer:1024*1024});cached=parseMacProcesses(r.stdout);}catch{cached=[];}
  at=Date.now();return cached;
 }
 if(process.platform!=='win32')return [];
 // Extract only tool identity and session ID in the child; never export command lines or secrets.
 const script=`$out=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(codex|claude|zcode|gemini|opencode|node|Kimi Code|DeepSeek Harness)\\.exe$' } | ForEach-Object {
 $p=$_; $tool=$null; $exe=$p.ExecutablePath
 if($p.Name -eq 'codex.exe'){$tool='codex'}
 elseif($p.Name -eq 'Kimi Code.exe'){$tool='kimi'}
 elseif($p.Name -eq 'DeepSeek Harness.exe'){$tool='deepseek'}
 elseif($p.Name -eq 'ZCode.exe'){$tool='zcode'}
 elseif($p.Name -eq 'claude.exe'){$tool=if($exe -match 'claude-code|ClaudeCode'){ 'claude' }else{'claude-desktop'}}
 elseif($p.Name -match '^(gemini|opencode)\\.exe$'){$tool=$p.Name.Replace('.exe','')}
 elseif($p.CommandLine -match 'node_modules[\\\\/](?:@anthropic-ai[\\\\/])?claude-code'){$tool='claude';$exe=$null}
 if($tool){$session=$null;if($p.CommandLine -match '--(?:resume|session-id)\\s+"?([a-f0-9-]{36})'){$session=$Matches[1]};[pscustomobject]@{toolId=$tool;pid=$p.ProcessId;executable=$exe;sessionId=$session}}
 });ConvertTo-Json -InputObject $out -Compress`;
 try{const r=await run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:12000,maxBuffer:1024*1024});cached=JSON.parse(r.stdout||'[]');at=Date.now();}catch{cached=[];at=Date.now();}
 return cached;
}
