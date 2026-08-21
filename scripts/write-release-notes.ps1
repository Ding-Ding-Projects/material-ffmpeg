[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$LineCountPath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [Parameter(Mandatory = $true)][string]$Tag
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $env:GITHUB_REPOSITORY -or -not $env:GITHUB_RUN_ID -or -not $env:GITHUB_SHA) {
  throw 'GITHUB_REPOSITORY, GITHUB_RUN_ID, and GITHUB_SHA are required.'
}
$runJson = & gh api "repos/$env:GITHUB_REPOSITORY/actions/runs/$env:GITHUB_RUN_ID"
if ($LASTEXITCODE -ne 0) { throw 'Unable to read the current GitHub Actions run timing.' }
$run = $runJson | ConvertFrom-Json
$started = ([DateTimeOffset]$run.run_started_at).ToUniversalTime()
$completed = [DateTimeOffset]::UtcNow
$duration = $completed - $started
$durationHours = [int64][math]::Floor($duration.TotalHours)
$durationText = '{0:D2}:{1:D2}:{2:D2}' -f $durationHours, $duration.Minutes, $duration.Seconds
$lineCounts = Get-Content -LiteralPath $LineCountPath -Raw
$version = (Get-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'package.json') -Raw | ConvertFrom-Json).version
$notes = @"
# material-ffmpeg $version

Built from commit ``$env:GITHUB_SHA`` and published as ``$Tag``.

## Download

- Unsigned Squirrel.Windows setup executable
- Squirrel ``RELEASES`` update index
- Full NuGet package containing the application, FFmpeg 9.0.1, FFprobe 9.0.1, and upstream license/build information
- ``SHA256SUMS.txt``

> [!WARNING]
> These files are intentionally unsigned and may trigger a Windows unknown-publisher or SmartScreen warning. No code-signing certificate is used.

## Verification boundary

This workflow builds, packages, validates required files, confirms the setup executable is unsigned, checks the bundled runtime and source commit, and publishes the resulting assets. It does not run tests, lint, type checking, static analysis, accessibility checks, or screenshots.

## Workflow timing

- Workflow started: ``$($started.ToString('yyyy-MM-ddTHH:mm:ssZ'))``
- Workflow completed: ``$($completed.ToString('yyyy-MM-ddTHH:mm:ssZ'))``
- Workflow duration: ``$durationText``

## Line count

Reproduce with ``npm run count:lines`` at this commit.

$lineCounts
"@
New-Item -ItemType Directory -Path (Split-Path -Parent $OutputPath) -Force | Out-Null
Set-Content -LiteralPath $OutputPath -Value $notes -Encoding UTF8
Write-Host "[release] Wrote release notes for $Tag with measured workflow timing."
