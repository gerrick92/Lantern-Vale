param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
$packageRoot = [System.IO.Path]::GetFullPath($Source).TrimEnd('\')
$archivePath = [System.IO.Path]::GetFullPath($Destination)
$stream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::CreateNew)
try {
  $archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create, $true)
  try {
    $paths = [string[]](Get-ChildItem -LiteralPath $packageRoot -Recurse -File | ForEach-Object { $_.FullName.Substring($packageRoot.Length + 1).Replace('\', '/') })
    [Array]::Sort($paths, [StringComparer]::Ordinal)
    foreach ($path in $paths) {
      $entry = $archive.CreateEntry($path, [System.IO.Compression.CompressionLevel]::Optimal)
      $entry.LastWriteTime = [DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
      $inputStream = [System.IO.File]::OpenRead([System.IO.Path]::Combine($packageRoot, $path))
      $outputStream = $entry.Open()
      try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
    }
  } finally { $archive.Dispose() }
} finally { $stream.Dispose() }
