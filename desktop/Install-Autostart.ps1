$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$node=Join-Path $root 'runtime/node.exe'
if(!(Test-Path -LiteralPath $node)){throw '请使用包含 runtime 的桌面便携包'}
$config=if(Test-Path -LiteralPath (Join-Path $root 'gateway/private/agent.json')){'agent'}elseif(Test-Path -LiteralPath (Join-Path $root 'gateway/private/config.json')){'server'}else{throw '请先运行 Setup.cmd'}
$script=Join-Path $root "gateway/$config.mjs"
$file=Join-Path $root ('gateway/private/'+$(if($config -eq 'agent'){'agent'}else{'config'})+'.json')
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$suffix=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($root)).Replace('/','_').Replace('+','-').TrimEnd('=')
$name='Mydex-Portable-'+$suffix.Substring([Math]::Max(0,$suffix.Length-16))
$runner=Join-Path $PSScriptRoot 'run-background.ps1'
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$runner+'"') -WorkingDirectory (Join-Path $root 'gateway')
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "已配置登录自启：$name。若不需要，可在任务计划程序删除该项。"
