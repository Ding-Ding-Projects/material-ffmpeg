[CmdletBinding()]
param([switch]$Silent)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outputRoot = Join-Path $repoRoot 'dist\squirrel-windows'
$releaseRoot = Join-Path $repoRoot 'dist\release-assets'
if (-not $releaseRoot.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Unexpected release staging path: $releaseRoot" }
if (Test-Path -LiteralPath $releaseRoot) { Remove-Item -LiteralPath $releaseRoot -Recurse -Force }
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null

$setup = Get-ChildItem -LiteralPath $outputRoot -Filter '*setup*.exe' -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
$releases = Get-Item -LiteralPath (Join-Path $outputRoot 'RELEASES') -ErrorAction SilentlyContinue
$fullPackage = Get-ChildItem -LiteralPath $outputRoot -Filter '*-full.nupkg' -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if ($null -eq $setup -or $null -eq $releases -or $null -eq $fullPackage) {
  throw "Squirrel output is incomplete under $outputRoot. Expected Setup.exe, RELEASES, and a full .nupkg."
}
if ($setup.Length -le 0 -or $releases.Length -le 0 -or $fullPackage.Length -le 0) { throw 'One or more Squirrel outputs are empty.' }
$signature = Get-AuthenticodeSignature -LiteralPath $setup.FullName
if ($signature.Status -ne 'NotSigned') { throw "Permanent unsigned policy violation: setup signature status is $($signature.Status)." }
$releaseText = Get-Content -LiteralPath $releases.FullName -Raw
if ($releaseText -notmatch [regex]::Escape($fullPackage.Name)) { throw "RELEASES does not reference $($fullPackage.Name)." }

$verificationRoot = Join-Path $repoRoot ".cache\package-verification-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $verificationRoot -Force | Out-Null
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($fullPackage.FullName, $verificationRoot)
  $ffmpeg = Get-ChildItem -LiteralPath $verificationRoot -Filter 'ffmpeg.exe' -Recurse -File | Select-Object -First 1
  $ffprobe = Get-ChildItem -LiteralPath $verificationRoot -Filter 'ffprobe.exe' -Recurse -File | Select-Object -First 1
  $license = Get-ChildItem -LiteralPath $verificationRoot -Recurse -File | Where-Object { $_.Name -match '^LICENSE' } | Select-Object -First 1
  $metadataFile = Get-ChildItem -LiteralPath $verificationRoot -Filter 'build-metadata.json' -Recurse -File | Select-Object -First 1
  if ($null -eq $ffmpeg -or $null -eq $ffprobe -or $null -eq $license -or $null -eq $metadataFile) {
    throw 'The full Squirrel package is missing bundled FFmpeg, FFprobe, license evidence, or build metadata.'
  }
  $metadata = Get-Content -LiteralPath $metadataFile.FullName -Raw | ConvertFrom-Json
  $commit = (& git -C $repoRoot rev-parse HEAD).Trim()
  if ($metadata.commit -ne $commit) { throw "Squirrel package commit mismatch. Expected $commit, got $($metadata.commit)." }
} finally {
  if (Test-Path -LiteralPath $verificationRoot) { Remove-Item -LiteralPath $verificationRoot -Recurse -Force }
}

Copy-Item -LiteralPath $setup.FullName -Destination $releaseRoot
Copy-Item -LiteralPath $releases.FullName -Destination $releaseRoot
Copy-Item -LiteralPath $fullPackage.FullName -Destination $releaseRoot
$assets = Get-ChildItem -LiteralPath $releaseRoot -File | Sort-Object Name
$checksums = $assets | ForEach-Object { "{0}  {1}" -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.Name }
Set-Content -LiteralPath (Join-Path $releaseRoot 'SHA256SUMS.txt') -Value $checksums -Encoding Ascii
Write-Host "[release] Verified unsigned Squirrel assets: $releaseRoot"
$assets | ForEach-Object { Write-Host "[release] $($_.Name) ($($_.Length) bytes)" }
