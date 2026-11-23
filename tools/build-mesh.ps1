param(
  [string]$GoRoot = 'D:/Software/MydexGo/go',
  [string]$GoPath = 'D:/Software/MydexGo/path',
  [string]$AndroidSdk = 'D:/Software/NFSeeBuild/android-sdk',
  [string]$JavaHome = 'D:/Software/NFSeeBuild/java/jdk-21.0.12.1+1'
)
$ErrorActionPreference = 'Stop'
$env:GOROOT = $GoRoot
$env:GOPATH = $GoPath
$env:GOCACHE = 'D:/Software/MydexGo/cache'
$env:ANDROID_HOME = $AndroidSdk
$env:ANDROID_NDK_HOME = Join-Path $AndroidSdk 'ndk/28.2.13676358'
$env:JAVA_HOME = $JavaHome
$env:PATH = "$GoRoot/bin;$GoPath/bin;$JavaHome/bin;" + $env:PATH
$source = Join-Path $PSScriptRoot '../native/mesh'
$output = Join-Path $PSScriptRoot '../android/app/libs/mydex-mesh.aar'
New-Item -ItemType Directory -Force (Split-Path $output) | Out-Null
Push-Location $source
try {
  & go install golang.org/x/mobile/cmd/gomobile@v0.0.0-20261011034528-197770444867
  if ($LASTEXITCODE) { throw 'gomobile install failed' }
  & go install golang.org/x/mobile/cmd/gobind@v0.0.0-20261011034528-197770444867
  if ($LASTEXITCODE) { throw 'gobind install failed' }
  & gomobile bind '-target=android/arm64,android/arm,android/amd64' '-ldflags=-s -w' -trimpath -androidapi 23 -o $output .
  if ($LASTEXITCODE) { throw 'Android mesh library build failed' }
} finally { Pop-Location }
