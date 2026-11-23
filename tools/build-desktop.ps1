param([Parameter(Mandatory=$true)][string]$NodeExe,[string]$Makensis)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$out=Join-Path $root 'build/desktop-v0426'
$node=(Resolve-Path -LiteralPath $NodeExe).Path
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if(!(Test-Path $compiler)){throw 'Install the Windows .NET Framework compiler first'}
if(!(Test-Path "$root/gateway/node_modules/ws")){throw 'Run npm ci in gateway first'}
New-Item -ItemType Directory -Force $out,"$out/runtime","$out/desktop","$out/gateway","$root/dist" | Out-Null
Copy-Item -LiteralPath $node -Destination "$out/runtime/node.exe" -Force
foreach($name in @('gui-bridge.mjs','updater.mjs','setup.mjs','app-relay.json','Mydex.ico','README.md','THIRD-PARTY-NODE.txt')){Copy-Item -LiteralPath "$root/desktop/$name" -Destination "$out/desktop/$name" -Force}
Copy-Item -LiteralPath "$root/desktop/bridges" -Destination "$out/desktop" -Recurse -Force
New-Item -ItemType Directory -Force "$out/desktop/macos" | Out-Null
Copy-Item -LiteralPath "$root/desktop/macos/updater.mjs" -Destination "$out/desktop/macos/updater.mjs" -Force
Get-ChildItem "$root/gateway/*.mjs" | Copy-Item -Destination "$out/gateway" -Force
Copy-Item "$root/gateway/package*.json" "$out/gateway" -Force
Copy-Item "$root/gateway/node_modules" "$out/gateway" -Recurse -Force
Copy-Item "$root/LICENSE" "$out/LICENSE.txt" -Force
$binary=[IO.Path]::GetFullPath((Join-Path $out 'Mydex.exe'))
$icon=[IO.Path]::GetFullPath((Join-Path $root 'desktop\Mydex.ico'))
$manifest=[IO.Path]::GetFullPath((Join-Path $root 'desktop\Mydex.manifest'))
$source=[IO.Path]::GetFullPath((Join-Path $root 'desktop\Mydex.cs'))
& $compiler /nologo /target:winexe /platform:x64 "/out:$binary" "/win32icon:$icon" "/win32manifest:$manifest" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll $source
if($LASTEXITCODE){throw 'Desktop compilation failed'}
if($Makensis){Push-Location $root;try{& $Makensis /V2 desktop/installer.nsi;if($LASTEXITCODE){throw 'Installer build failed'}}finally{Pop-Location}}
Write-Output "Ready: $out/Mydex.exe"
