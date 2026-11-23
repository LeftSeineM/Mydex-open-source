param([ValidateSet('install','update','uninstall','start-service','stop-service')][string]$Action='install',[string]$Package,[string]$Root=$env:MYDEX_INSTALL_ROOT,[int]$WaitPid=0,[string]$Receipt)
$ErrorActionPreference='Stop'
trap {if($Receipt){[IO.File]::WriteAllText($Receipt,'{"ok":false,"error":"Lifecycle operation failed; prior configuration is retained. Inspect installation state before retrying."}')};Write-Error $_ -ErrorAction Continue;exit 1}
function Done($value){if($Receipt){[IO.File]::WriteAllText($Receipt,($value|ConvertTo-Json -Compress))};$value|ConvertTo-Json -Compress}
function Verify-WithNode([string]$Exe,[string]$Verifier,[string]$Directory){
 $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$Exe;$info.Arguments='"'+$Verifier+'" "'+$Directory+'"';$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.RedirectStandardInput=$true
 $p=[Diagnostics.Process]::new();$p.StartInfo=$info;$p.Start()|Out-Null;$p.StandardInput.Close();$stdout=$p.StandardOutput.ReadToEndAsync();$stderr=$p.StandardError.ReadToEndAsync();$p.WaitForExit();if($p.ExitCode -ne 0){throw 'Package signature or contents verification failed'};$stdout.Result;$p.Dispose()
}
if($WaitPid -gt 0){$caller=Get-Process -Id $WaitPid -ErrorAction SilentlyContinue;if($caller -and !$caller.WaitForExit(60000)){throw 'Agent caller has not disconnected; not removing a running runtime'}}
if(!$Root){$Root='D:\Software\MydexAgent'}
$Root=[IO.Path]::GetFullPath($Root).TrimEnd('\')
if($Root -eq [IO.Path]::GetPathRoot($Root).TrimEnd('\')){throw 'Installation cannot target a drive root'}
$marker=Join-Path $Root 'mydex-agent-install.json'
$task='Mydex-Agent-'+([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($Root.ToLowerInvariant()))).Replace('-','').Substring(0,16))
$mutex=[Threading.Mutex]::new($false,('Local\'+$task+'-Maintenance'))
if(!$mutex.WaitOne(0)){throw 'Another Mydex installation/update/removal operation is already running'}
function Read-Current { Get-Content -LiteralPath (Join-Path $Root 'current.json') -Raw|ConvertFrom-Json }
function Stop-Agent {
 $endpoint=Join-Path $Root 'data/agent-control/endpoint.json'
 if(Test-Path -LiteralPath $endpoint){
  $e=Get-Content -LiteralPath $endpoint -Raw|ConvertFrom-Json
  if($e.port -lt 1024 -or $e.port -gt 65535){throw 'Invalid service descriptor'}
  try{Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:'+$e.port+'/rpc') -Headers @{Authorization=('Bearer '+$e.token)} -ContentType 'application/json' -Body '{"action":"shutdown"}' -TimeoutSec 10|Out-Null}catch{}
  for($n=0;$n -lt 60 -and (Test-Path -LiteralPath $endpoint);$n++){Start-Sleep -Milliseconds 200}
 }
 if(Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue){Stop-ScheduledTask -TaskName $task}
}
function Start-Agent {
 Start-ScheduledTask -TaskName $task
 $endpoint=Join-Path $Root 'data/agent-control/endpoint.json'
 for($n=0;$n -lt 90;$n++){
  if(Test-Path -LiteralPath $endpoint){try{$e=Get-Content -LiteralPath $endpoint -Raw|ConvertFrom-Json;$v=Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:'+$e.port+'/rpc') -Headers @{Authorization=('Bearer '+$e.token)} -ContentType 'application/json' -Body '{"action":"status"}' -TimeoutSec 5;if($v.result -and (!$v.result.configured -or $v.result.connected)){return}}catch{}}
  Start-Sleep -Milliseconds 300
 }
 throw 'Independent service did not become ready; configuration and previous release are retained'
}
if($Action -ne 'install' -and !(Test-Path -LiteralPath $marker)){throw 'This directory is not a Mydex Agent installation'}
if($Action -eq 'stop-service'){Stop-Agent;Done @{ok=$true;stopped=$true};exit}
if($Action -eq 'start-service'){Start-Agent;Done @{ok=$true;started=$true};exit}
if($Action -eq 'uninstall'){
 Stop-Agent
 if(Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue){Unregister-ScheduledTask -TaskName $task -Confirm:$false}
 # Only the two installation-owned paths are removed; data/ and bridge backups remain.
 $owned=Join-Path $Root 'releases';$resolved=[IO.Path]::GetFullPath($owned)
 if($resolved -ne ($Root+'\releases')){throw 'Unsafe removal target'}
 if(Test-Path -LiteralPath $owned){if((Get-Item -LiteralPath $owned).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Refusing to remove linked directory'};Remove-Item -LiteralPath $owned -Recurse -Force}
 foreach($name in @('Mydex-Agent.ps1','Mydex-AgentHost.exe','runner.ps1','current.json','mydex-agent-install.json','mydex-mcp.json')){$p=Join-Path $Root $name;if(Test-Path -LiteralPath $p){for($retry=0;$retry -lt 20;$retry++){try{Remove-Item -LiteralPath $p -Force;break}catch{if($retry -eq 19){throw};Start-Sleep -Milliseconds 200}}}}
 [IO.File]::WriteAllText((Join-Path $Root 'mydex-agent-data.json'),'{"product":"mydex-agent","schema":1}')
 Done @{ok=$true;uninstalled=$true;userDataPreserved=$true;applicationBridgesPreserved=$true};exit
}
if(!$Package){$Package=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)}
$Package=(Resolve-Path -LiteralPath $Package).Path
if((Test-Path -LiteralPath $Root) -and !(Test-Path -LiteralPath $marker) -and (Get-ChildItem -LiteralPath $Root -Force|Measure-Object).Count){
 $retained=Join-Path $Root 'mydex-agent-data.json'
 if(!(Test-Path -LiteralPath $retained) -or ((Get-Content -LiteralPath $retained -Raw|ConvertFrom-Json).product -ne 'mydex-agent') -or @(Get-ChildItem -LiteralPath $Root -Force|Where-Object Name -notin @('data','mydex-agent-data.json')).Count){throw 'Choose an empty directory or an existing Mydex Agent installation'}
}
$node=Join-Path $Package 'runtime/node.exe'
$verify=Join-Path $Package 'desktop/headless/verify-package.mjs'
if(Test-Path -LiteralPath $marker){$previous=Read-Current;$verify=Join-Path $Root ('releases/'+$previous.slot+'/desktop/headless/verify-package.mjs');$node=Join-Path $Root ('releases/'+$previous.slot+'/runtime/node.exe')}
Verify-WithNode $node $verify $Package
$envelope=Get-Content -LiteralPath (Join-Path $Package 'agent-package.json') -Raw|ConvertFrom-Json
$manifest=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($envelope.payload))|ConvertFrom-Json

$profileFile=Join-Path $Root 'data/desktop-profile.json'
if(($manifest.features.router -eq $false) -and (Test-Path -LiteralPath $profileFile)){
 $profile=Get-Content -LiteralPath $profileFile -Raw|ConvertFrom-Json
 $privateConfig=Join-Path $profile.root 'gateway/private/config.json'
 if((Test-Path -LiteralPath $privateConfig) -and ((Get-Content -LiteralPath $privateConfig -Raw|ConvertFrom-Json).router.enabled -eq $true)){throw 'Keep private Router installation on its private update channel'}
}
$slot=$manifest.version+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
$dest=Join-Path $Root ('releases/'+$slot)
New-Item -ItemType Directory -Path $dest -Force|Out-Null
foreach($entry in $manifest.files){$to=Join-Path $dest $entry.path;New-Item -ItemType Directory -Path (Split-Path -Parent $to) -Force|Out-Null;Copy-Item -LiteralPath (Join-Path $Package $entry.path) -Destination $to}
Copy-Item -LiteralPath (Join-Path $Package 'agent-package.json') -Destination $dest
Verify-WithNode (Join-Path $dest 'runtime/node.exe') (Join-Path $dest 'desktop/headless/verify-package.mjs') $dest
New-Item -ItemType Directory -Path (Join-Path $Root 'data') -Force|Out-Null
$runner=@'
$ErrorActionPreference='Continue'
$root=$PSScriptRoot
$env:MYDEX_INSTALL_ROOT=$root
$env:MYDEX_DATA_DIR=Join-Path $root 'data'
while($true){
 $c=Get-Content -LiteralPath (Join-Path $root 'current.json') -Raw|ConvertFrom-Json
 $release=Join-Path $root ('releases/'+$c.slot)
 $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=Join-Path $release 'runtime/node.exe';$info.Arguments='"'+(Join-Path $release 'desktop/headless/service.mjs')+'"';$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.RedirectStandardInput=$true
 $process=[Diagnostics.Process]::new();$process.StartInfo=$info;$process.Start()|Out-Null;$process.StandardInput.Close();$out=$process.StandardOutput.ReadToEndAsync();$err=$process.StandardError.ReadToEndAsync();$process.WaitForExit();$process.Dispose()
 Start-Sleep -Seconds 10
}
'@
$launcher=@'
param([switch]$Mcp,[Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
$ErrorActionPreference='Stop'
$env:MYDEX_INSTALL_ROOT=$PSScriptRoot
$env:MYDEX_DATA_DIR=Join-Path $PSScriptRoot 'data'
$c=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'current.json') -Raw|ConvertFrom-Json
$release=Join-Path $PSScriptRoot ('releases/'+$c.slot)
$entry=if($Mcp){'mcp.mjs'}else{'cli.mjs'}
if(!$Mcp){$env:MYDEX_CLI_ARGUMENTS=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject @($Arguments) -Compress)))}
& (Join-Path $release 'runtime/node.exe') (Join-Path $release ('desktop/headless/'+$entry))
exit $LASTEXITCODE
'@
if(Test-Path -LiteralPath $marker){Stop-Agent}
[IO.File]::WriteAllText((Join-Path $Root 'runner.ps1'),$runner)
[IO.File]::WriteAllText((Join-Path $Root 'Mydex-Agent.ps1'),$launcher)
if(!(Test-Path -LiteralPath (Join-Path $Root 'Mydex-AgentHost.exe'))){Copy-Item -LiteralPath (Join-Path $dest 'desktop/headless/Mydex-AgentHost.exe') -Destination (Join-Path $Root 'Mydex-AgentHost.exe')}
[IO.File]::WriteAllText((Join-Path $Root 'mydex-mcp.json'),(@{mcpServers=@{mydex=@{command=(Join-Path $Root 'Mydex-AgentHost.exe');args=@('--mcp')}}}|ConvertTo-Json -Depth 6))
[IO.File]::WriteAllText($marker,(@{schema=1;task=$task}|ConvertTo-Json))
[IO.File]::WriteAllText((Join-Path $Root 'current.json'),(@{version=$manifest.version;slot=$slot}|ConvertTo-Json))
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$a=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $Root 'runner.ps1')+'"') -WorkingDirectory $Root
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $task -Action $a -Trigger $trigger -Principal $principal -Settings $settings -Force|Out-Null
try{Start-Agent}catch{Stop-Agent;if($previous){[IO.File]::WriteAllText((Join-Path $Root 'current.json'),($previous|ConvertTo-Json));Start-Agent};throw}
Done @{ok=$true;installed=$true;version=$manifest.version;root=$Root;configurationPreserved=$true}
