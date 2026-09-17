# Starts Orglet in development mode with renderer hot reload.
# Uses node from PATH, or ORGLET_NODE_DIR when node is not installed globally.
# Forge's pnpm version check is skipped through a private USERPROFILE flag folder, so pnpm is not required.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $nodeDir = if ($env:ORGLET_NODE_DIR) { $env:ORGLET_NODE_DIR } else { Join-Path $HOME 'Documents\Eris\tool\runtime\node-v24.19.0-win-x64' }
  if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) { throw "Không tìm thấy node. Cài Node 24 hoặc đặt ORGLET_NODE_DIR." }
  $env:PATH = "$nodeDir;$env:PATH"
}
$flagHome = Join-Path $env:TEMP 'orglet-forge-home'
New-Item -ItemType Directory -Force $flagHome | Out-Null
New-Item -ItemType File -Force (Join-Path $flagHome '.skip-forge-system-check') | Out-Null
# The app restores the real home at startup (main/index.ts) so harness CLIs still find their logins.
$env:ORGLET_USERPROFILE = $env:USERPROFILE
$env:USERPROFILE = $flagHome
Set-Location $root
node node_modules/@electron-forge/cli/dist/electron-forge.js start
