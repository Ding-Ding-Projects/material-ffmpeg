function Test-PeHasAuthenticodeCertificate {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$LiteralPath)

  $stream = [IO.File]::Open($LiteralPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $reader = New-Object IO.BinaryReader($stream)
  try {
    if ($stream.Length -lt 256 -or $reader.ReadUInt16() -ne 0x5a4d) { throw "Not a valid PE file: $LiteralPath" }
    $stream.Position = 0x3c
    $peOffset = $reader.ReadInt32()
    if ($peOffset -lt 0 -or $peOffset + 256 -gt $stream.Length) { throw "Invalid PE header offset: $LiteralPath" }
    $stream.Position = $peOffset
    if ($reader.ReadUInt32() -ne 0x00004550) { throw "PE signature is missing: $LiteralPath" }
    $optionalHeader = $peOffset + 24
    $stream.Position = $optionalHeader
    $magic = $reader.ReadUInt16()
    if ($magic -eq 0x10b) {
      $numberOfDirectoriesOffset = $optionalHeader + 92
      $directoriesOffset = $optionalHeader + 96
    } elseif ($magic -eq 0x20b) {
      $numberOfDirectoriesOffset = $optionalHeader + 108
      $directoriesOffset = $optionalHeader + 112
    } else {
      throw "Unsupported PE optional-header magic 0x$('{0:x}' -f $magic): $LiteralPath"
    }
    $stream.Position = $numberOfDirectoriesOffset
    $directoryCount = $reader.ReadUInt32()
    if ($directoryCount -le 4) { return $false }
    $stream.Position = $directoriesOffset + (4 * 8)
    $certificateOffset = $reader.ReadUInt32()
    $certificateSize = $reader.ReadUInt32()
    return $certificateOffset -ne 0 -and $certificateSize -ne 0
  } finally {
    $reader.Dispose()
    $stream.Dispose()
  }
}

function Assert-PeUnsigned {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$LiteralPath)
  if (Test-PeHasAuthenticodeCertificate -LiteralPath $LiteralPath) {
    throw "Permanent unsigned policy violation: Authenticode certificate table is present in $LiteralPath."
  }
}
