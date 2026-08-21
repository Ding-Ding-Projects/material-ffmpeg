function Get-FileSha256 {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$LiteralPath)

  $stream = [IO.File]::Open($LiteralPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
      $digest = $sha256.ComputeHash($stream)
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
  return ([BitConverter]::ToString($digest).Replace('-', '').ToLowerInvariant())
}
