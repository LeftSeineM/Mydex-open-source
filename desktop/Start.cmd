@echo off
chcp 65001 >nul
cd /d "%~dp0.."
if exist "gateway\private\agent.json" (
  "runtime\node.exe" "gateway\agent.mjs" "gateway\private\agent.json"
) else if exist "gateway\private\config.json" (
  "runtime\node.exe" "gateway\server.mjs" "gateway\private\config.json"
) else (
  "runtime\node.exe" "desktop\setup.mjs"
  echo 配置完成后，请再次双击 Start.cmd。
)
pause
