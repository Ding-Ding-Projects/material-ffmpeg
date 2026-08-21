[CmdletBinding()]
param([switch]$Silent)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$started = Get-Date
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Write-Host '[installer] Phase 1/3: downloading and verifying dependencies.'
& (Join-Path $PSScriptRoot 'download-dependencies.ps1') -Silent:$Silent
$npm = Join-Path (Split-Path -Parent (Get-Command node.exe).Source) 'npm.cmd'

Write-Host '[installer] Phase 2/3: building unsigned Squirrel.Windows artifacts.'
Push-Location $repoRoot
try {
  & $npm run dist
  if ($LASTEXITCODE -ne 0) { throw "Installer packaging failed with exit code $LASTEXITCODE." }
} finally { Pop-Location }

Write-Host '[installer] Phase 3/3: verifying artifacts, source commit, runtime contents, and unsigned state.'
& (Join-Path $PSScriptRoot 'collect-release.ps1') -Silent:$Silent
$elapsed = (Get-Date) - $started
Write-Host '[installer] Complete. Artifacts are unsigned and may trigger an unknown-publisher warning.'
Write-Host ("[installer] Duration: {0:hh\:mm\:ss}." -f $elapsed)
