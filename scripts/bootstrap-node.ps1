[CmdletBinding()]
param([switch]$Silent)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ProgressPreference = 'SilentlyContinue'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manifest = Get-Content -LiteralPath (Join-Path $repoRoot 'dependencies.json') -Raw | ConvertFrom-Json
$spec = $manifest.dependencies.node
$expectedVersion = "v$($spec.version)"

function Use-Node([string]$Root) {
  $script:NodeRoot = $Root
  $env:Path = "$Root;$env:Path"
}

$installed = Get-Command node.exe -ErrorAction SilentlyContinue
if ($installed) {
  $found = (& $installed.Source --version).Trim()
  if ($found -eq $expectedVersion) {
    Use-Node (Split-Path -Parent $installed.Source)
    Write-Host "[dependencies] Node.js $found already available at $($installed.Source)."
    return
  }
}

$toolchainRoot = Join-Path $env:LOCALAPPDATA "material-ffmpeg\toolchains\node-v$($spec.version)-win-x64"
$nodeExe = Join-Path $toolchainRoot 'node.exe'
if (Test-Path -LiteralPath $nodeExe -PathType Leaf) {
  $found = (& $nodeExe --version).Trim()
  if ($found -eq $expectedVersion) {
    Use-Node $toolchainRoot
    Write-Host "[dependencies] Reusing portable Node.js $found at $toolchainRoot."
    return
  }
}

$cacheRoot = Join-Path $repoRoot '.cache\node'
$archivePath = Join-Path $cacheRoot $spec.archive
New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
if ((Test-Path -LiteralPath $archivePath) -and ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $spec.sha256)) {
  Remove-Item -LiteralPath $archivePath -Force
}
if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
  Write-Host "[dependencies] Downloading Node.js $($spec.version) from nodejs.org."
  Invoke-WebRequest -UseBasicParsing -Uri $spec.url -OutFile $archivePath
}
$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $spec.sha256) {
  Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
  throw "Node.js SHA-256 mismatch. Expected $($spec.sha256), got $actualHash."
}

$staging = Join-Path $cacheRoot 'extract'
if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null
Expand-Archive -LiteralPath $archivePath -DestinationPath $staging -Force
$source = Get-ChildItem -LiteralPath $staging -Directory | Select-Object -First 1
if ($null -eq $source -or -not (Test-Path -LiteralPath (Join-Path $source.FullName 'node.exe'))) {
  throw 'The verified Node.js archive did not contain node.exe.'
}
if (Test-Path -LiteralPath $toolchainRoot) { Remove-Item -LiteralPath $toolchainRoot -Recurse -Force }
New-Item -ItemType Directory -Path (Split-Path -Parent $toolchainRoot) -Force | Out-Null
Move-Item -LiteralPath $source.FullName -Destination $toolchainRoot
Remove-Item -LiteralPath $staging -Recurse -Force
Use-Node $toolchainRoot
$found = (& $nodeExe --version).Trim()
if ($found -ne $expectedVersion) { throw "Portable Node.js version check failed: expected $expectedVersion, got $found." }
Write-Host "[dependencies] Installed verified portable Node.js $found at $toolchainRoot."
