[CmdletBinding()]
param(
  [switch]$Silent
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'hash.ps1')

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manifestPath = Join-Path $repoRoot 'dependencies.json'
$cacheRoot = Join-Path $repoRoot '.cache\ffmpeg'
$targetRoot = Join-Path $repoRoot 'resources\ffmpeg'
$localSevenZip = Join-Path $repoRoot 'node_modules\7zip-bin\win\x64\7za.exe'

function Write-Phase([string]$Message) {
  if (-not $Silent) { Write-Host "[ffmpeg] $Message" }
}

function Get-Manifest {
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Dependency manifest is missing: $manifestPath"
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1 -or $null -eq $manifest.dependencies.ffmpeg) {
    throw 'dependencies.json has an unsupported schema or missing ffmpeg entry.'
  }
  return $manifest.dependencies.ffmpeg
}

function Get-Sha256([string]$Path) {
  return Get-FileSha256 -LiteralPath $Path
}

function Get-VersionBanner([string]$Executable) {
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $Executable
  $startInfo.Arguments = '-version'
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = [Diagnostics.Process]::Start($startInfo)
  try {
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "$Executable -version exited with code $($process.ExitCode)." }
    return "$stdout`n$stderr"
  } finally {
    $process.Dispose()
  }
}

function Ensure-Directory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Find-SevenZip {
  if (Test-Path -LiteralPath $localSevenZip -PathType Leaf) { return $localSevenZip }
  $commands = @('7z.exe', '7zz.exe', '7zr.exe')
  foreach ($name in $commands) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($null -ne $command) { return $command.Source }
  }
  $known = @(
    (Join-Path $env:ProgramFiles '7-Zip\7z.exe'),
    (Join-Path ${env:ProgramFiles(x86)} '7-Zip\7z.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\7-Zip\7z.exe')
  )
  foreach ($path in $known) {
    if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) { return $path }
  }
  return $null
}

function Ensure-SevenZip {
  $existing = Find-SevenZip
  if ($existing) { return $existing }

  throw "No 7-Zip extractor was found. Run download-dependencies.bat to install the pinned 7zip-bin package, then retry."
}

function Invoke-SevenZip([string]$Executable, [string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "7-Zip failed with exit code $LASTEXITCODE." }
}

$spec = Get-Manifest
if ($spec.version -ne '9.0.1' -or $spec.platform -ne 'windows-x64') {
  throw 'The FFmpeg manifest must pin version 9.0.1 for windows-x64.'
}

Ensure-Directory $cacheRoot
Ensure-Directory (Split-Path -Parent $targetRoot)
$existingFfmpeg = Join-Path $targetRoot 'ffmpeg.exe'
$existingFfprobe = Join-Path $targetRoot 'ffprobe.exe'
if ((Test-Path -LiteralPath $existingFfmpeg -PathType Leaf) -and (Test-Path -LiteralPath $existingFfprobe -PathType Leaf)) {
  $existingFfmpegVersion = Get-VersionBanner $existingFfmpeg
  $existingFfprobeVersion = Get-VersionBanner $existingFfprobe
  if ($existingFfmpegVersion -match '(?m)^ffmpeg version 9\.0\.1(?:-|\s|$)' -and $existingFfprobeVersion -match '(?m)^ffprobe version 9\.0\.1(?:-|\s|$)') {
    Write-Phase "Already ready: $targetRoot (FFmpeg $($spec.version))."
    exit 0
  }
}
$archivePath = Join-Path $cacheRoot $spec.archive
$archiveHash = if (Test-Path -LiteralPath $archivePath -PathType Leaf) { Get-Sha256 $archivePath } else { $null }
if ($archiveHash -ne $spec.sha256.ToLowerInvariant()) {
  Write-Phase "Downloading FFmpeg $($spec.version) archive."
  Invoke-WebRequest -Uri $spec.url -OutFile $archivePath
  $archiveHash = Get-Sha256 $archivePath
  if ($archiveHash -ne $spec.sha256.ToLowerInvariant()) {
    Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
    throw "FFmpeg archive SHA-256 mismatch. Expected $($spec.sha256), got $archiveHash."
  }
} else {
  Write-Phase 'Using the verified FFmpeg archive cache.'
}

$sevenZip = Ensure-SevenZip
$staging = Join-Path $cacheRoot 'extract'
if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
Ensure-Directory $staging
Write-Phase 'Extracting the FFmpeg executables and license evidence.'
$patterns = @('*\bin\ffmpeg.exe', '*\bin\ffprobe.exe', '*\LICENSE*', '*\README*', '*\build-info*')
Invoke-SevenZip $sevenZip (@('x', $archivePath, "-o$staging", '-y') + $patterns)

$ffmpeg = Get-ChildItem -LiteralPath $staging -Filter 'ffmpeg.exe' -Recurse -File | Select-Object -First 1
$ffprobe = Get-ChildItem -LiteralPath $staging -Filter 'ffprobe.exe' -Recurse -File | Select-Object -First 1
if ($null -eq $ffmpeg -or $null -eq $ffprobe) { throw 'The archive did not contain both ffmpeg.exe and ffprobe.exe.' }

Ensure-Directory $targetRoot
Get-ChildItem -LiteralPath $targetRoot -Force | Where-Object { $_.Name -ne 'README.md' } | Remove-Item -Recurse -Force
Copy-Item -LiteralPath $ffmpeg.FullName -Destination (Join-Path $targetRoot 'ffmpeg.exe')
Copy-Item -LiteralPath $ffprobe.FullName -Destination (Join-Path $targetRoot 'ffprobe.exe')
Get-ChildItem -LiteralPath $staging -Recurse -File | Where-Object { $_.Name -match '^(LICENSE|README|build-info)' } | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $targetRoot $_.Name) -Force
}

$ffmpegVersion = Get-VersionBanner (Join-Path $targetRoot 'ffmpeg.exe')
$ffprobeVersion = Get-VersionBanner (Join-Path $targetRoot 'ffprobe.exe')
if ($ffmpegVersion -notmatch '(?m)^ffmpeg version 9\.0\.1(?:-|\s|$)' -or $ffprobeVersion -notmatch '(?m)^ffprobe version 9\.0\.1(?:-|\s|$)') {
  throw "Extracted FFmpeg version check failed. ffmpeg='$ffmpegVersion'; ffprobe='$ffprobeVersion'."
}

Remove-Item -LiteralPath $staging -Recurse -Force
Write-Phase "Ready: $targetRoot (FFmpeg $($spec.version), SHA-256 verified)."
