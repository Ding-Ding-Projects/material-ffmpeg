[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$paths = & git -C $repoRoot ls-files
if ($LASTEXITCODE -ne 0) { throw 'git ls-files failed.' }

function Get-Category([string]$Path) {
  if ($Path -like 'design/*') { return 'Design reference' }
  if ($Path -eq 'package-lock.json') { return 'Generated' }
  if ($Path -like 'tests/*' -or $Path -match '\.(test|spec)\.') { return 'Tests' }
  if ($Path -like 'docs/*') { return 'Documentation/site' }
  if ($Path -like 'scripts/*' -or $Path -like '.github/*' -or $Path -match '\.(bat|ps1|yml|yaml)$') { return 'Build/tooling' }
  if ($Path -match '\.(css|scss|html|svg)$') { return 'Styles/markup' }
  if ($Path -like 'src/*' -or $Path -match '\.(js|mjs|cjs|ts|tsx)$') { return 'Source' }
  return 'Project records'
}

$rows = @{}
$agentLines = 0
$peopleLines = 0
foreach ($relativePath in $paths) {
  $absolutePath = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) { continue }
  $bytes = [IO.File]::ReadAllBytes($absolutePath)
  if ($bytes -contains 0) { continue }
  $text = [Text.Encoding]::UTF8.GetString($bytes)
  if ($text.Length -eq 0) {
    $lines = @()
  } else {
    $lines = [regex]::Split($text, "\r\n|\n|\r")
    if ($text -match "(?:\r\n|\n|\r)$") { $lines = $lines[0..($lines.Count - 2)] }
  }
  $total = $lines.Count
  $nonBlank = @($lines | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
  $category = Get-Category $relativePath
  if (-not $rows.ContainsKey($category)) { $rows[$category] = [ordered]@{ Files = 0; Total = 0; NonBlank = 0 } }
  $rows[$category].Files += 1
  $rows[$category].Total += $total
  $rows[$category].NonBlank += $nonBlank

  $authors = & git -C $repoRoot blame --line-porcelain HEAD -- $relativePath 2>$null | Where-Object { $_ -like 'author *' }
  if ($authors.Count -eq $total) {
    foreach ($author in $authors) {
      if ($author -eq 'author Claude Fable 5') { $agentLines += 1 } else { $peopleLines += 1 }
    }
  } else {
    throw "Attribution count mismatch for $relativePath: $($authors.Count) blame lines versus $total file lines."
  }
}

$orderedCategories = @('Source', 'Tests', 'Styles/markup', 'Documentation/site', 'Build/tooling', 'Project records', 'Generated', 'Design reference')
Write-Output '| Category | Files | Total lines | Non-blank lines |'
Write-Output '|---|---:|---:|---:|'
foreach ($category in $orderedCategories) {
  if ($rows.ContainsKey($category)) {
    $row = $rows[$category]
    Write-Output "| $category | $($row.Files) | $($row.Total) | $($row.NonBlank) |"
  }
}
$projectCategories = @('Source', 'Tests', 'Styles/markup', 'Documentation/site', 'Build/tooling', 'Project records')
$projectTotal = ($projectCategories | Where-Object { $rows.ContainsKey($_) } | ForEach-Object { $rows[$_].Total } | Measure-Object -Sum).Sum
$projectNonBlank = ($projectCategories | Where-Object { $rows.ContainsKey($_) } | ForEach-Object { $rows[$_].NonBlank } | Measure-Object -Sum).Sum
$grandTotal = ($rows.Values | ForEach-Object { $_.Total } | Measure-Object -Sum).Sum
$grandNonBlank = ($rows.Values | ForEach-Object { $_.NonBlank } | Measure-Object -Sum).Sum
Write-Output "| **Project total** |  | **$projectTotal** | **$projectNonBlank** |"
Write-Output "| **Grand total** |  | **$grandTotal** | **$grandNonBlank** |"
Write-Output ''
Write-Output '| Surviving-line attribution | Lines |'
Write-Output '|---|---:|'
Write-Output "| Claude Fable 5 | $agentLines |"
Write-Output "| People | $peopleLines |"
Write-Output ''
Write-Output 'Excluded from the project total but visible in the table: generated lockfiles and supplied design reference files. Dependency directories, build output, caches, and bundled binaries are not tracked and are not counted.'
