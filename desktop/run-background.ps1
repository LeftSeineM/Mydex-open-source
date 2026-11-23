$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$node=Join-Path $root 'runtime/node.exe'
$kind=if(Test-Path -LiteralPath (Join-Path $root 'gateway/private/agent.json')){'agent'}else{'server'}
$config=Join-Path $root ('gateway/private/'+$(if($kind -eq 'agent'){'agent'}else{'config'})+'.json')
$log=Join-Path $root 'gateway/private/service.log'
Set-Location -LiteralPath (Join-Path $root 'gateway')
$ErrorActionPreference='Continue' # Windows PowerShell treats native stderr as ErrorRecord.
while($true){
  if((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 5MB){Move-Item -LiteralPath $log -Destination "$log.previous" -Force}
  & $node (Join-Path $root "gateway/$kind.mjs") $config >> $log 2>&1
  Start-Sleep -Seconds 10
}
