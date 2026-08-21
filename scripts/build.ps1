[CmdletBinding()]
param([switch]$Silent)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$started = Get-Date
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Write-Host '[build] Phase 1/3: downloading and verifying dependencies.'
& (Join-Path $PSScriptRoot 'download-dependencies.ps1') -Silent:$Silent
$npm = Join-Path (Split-Path -Parent (Get-Command node.exe).Source) 'npm.cmd'

Write-Host '[build] Phase 2/3: packaging the runnable application directory.'
Push-Location $repoRoot
try {
  & $npm run package:app
  if ($LASTEXITCODE -ne 0) { throw "Application packaging failed with exit code $LASTEXITCODE." }
} finally { Pop-Location }

Write-Host '[build] Phase 3/3: verifying the runnable package.'
$packageRoot = Join-Path $repoRoot 'dist\squirrel-windows\win-unpacked'
$executable = Join-Path $packageRoot 'material-ffmpeg.exe'
$required = @(
  $executable,
  (Join-Path $packageRoot 'resources\app.asar'),
  (Join-Path $packageRoot 'resources\ffmpeg\ffmpeg.exe'),
  (Join-Path $packageRoot 'resources\ffmpeg\ffprobe.exe'),
  (Join-Path $packageRoot 'resources\build-metadata.json')
)
$missing = $required | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) }
if ($missing) { throw "Runnable package is incomplete. Missing: $($missing -join ', ')" }
$commit = (& git -C $repoRoot rev-parse HEAD).Trim()
$metadata = Get-Content -LiteralPath (Join-Path $packageRoot 'resources\build-metadata.json') -Raw | ConvertFrom-Json
if ($metadata.commit -ne $commit) { throw "Runnable package commit mismatch. Expected $commit, got $($metadata.commit)." }
$hash = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
$elapsed = (Get-Date) - $started
Write-Host "[build] Ready: $executable"
Write-Host "[build] SHA-256: $hash"
Write-Host ("[build] Duration: {0:hh\:mm\:ss}." -f $elapsed)

if (-not $Silent) {
  $answer = Read-Host 'Run material-ffmpeg now? [y/N]'
  if ($answer -match '^(?i:y|yes)$') { Start-Process -FilePath $executable }
}
