[CmdletBinding()]
param([switch]$Silent)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'hash.ps1')
$started = Get-Date
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Write-Host '[dependencies] Phase 1/3: resolving the pinned Node.js toolchain.'
& (Join-Path $PSScriptRoot 'bootstrap-node.ps1') -Silent:$Silent
$npm = Join-Path (Split-Path -Parent (Get-Command node.exe).Source) 'npm.cmd'
if (-not (Test-Path -LiteralPath $npm -PathType Leaf)) { throw "npm.cmd is missing beside the resolved Node.js executable: $npm" }

Write-Host '[dependencies] Phase 2/3: restoring exact npm dependencies from package-lock.json.'
$lockPath = Join-Path $repoRoot 'package-lock.json'
if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) { throw "package-lock.json is missing: $lockPath" }
$lockHash = Get-FileSha256 -LiteralPath $lockPath
$marker = Join-Path $repoRoot '.cache\npm-package-lock.sha256'
$currentMarker = if (Test-Path -LiteralPath $marker) { (Get-Content -LiteralPath $marker -Raw).Trim() } else { '' }
$electronPackage = Join-Path $repoRoot 'node_modules\electron\package.json'
$sevenZipBinary = Join-Path $repoRoot 'node_modules\7zip-bin\win\x64\7za.exe'
if ($currentMarker -eq $lockHash -and (Test-Path -LiteralPath $electronPackage) -and (Test-Path -LiteralPath $sevenZipBinary)) {
  Write-Host '[dependencies] npm dependency tree matches the current lockfile; restore skipped.'
} else {
  $env:npm_config_audit = 'false'
  $env:npm_config_fund = 'false'
  $env:npm_config_update_notifier = 'false'
  Push-Location $repoRoot
  try {
    & $npm ci --no-audit --no-fund $(if ($Silent) { '--loglevel=error' } else { '--loglevel=notice' })
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }
  } finally { Pop-Location }
  New-Item -ItemType Directory -Path (Split-Path -Parent $marker) -Force | Out-Null
  Set-Content -LiteralPath $marker -Value $lockHash -Encoding Ascii
}

Write-Host '[dependencies] Phase 3/3: materializing the verified FFmpeg 9.0.1 runtime.'
& (Join-Path $PSScriptRoot 'download-ffmpeg.ps1') -Silent:$Silent
$elapsed = (Get-Date) - $started
Write-Host ("[dependencies] Ready in {0:hh\:mm\:ss}." -f $elapsed)
