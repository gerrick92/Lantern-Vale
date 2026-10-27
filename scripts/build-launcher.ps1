$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    throw 'The Windows .NET Framework C# compiler is missing. Enable .NET Framework 4.8, or use npm run dev.'
}
$launcherSource = Join-Path $PSScriptRoot 'launcher/Launcher.cs'
$launcherOutput = Join-Path $projectRoot 'Lantern Vale.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ "/out:$launcherOutput" $launcherSource
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $digest = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($launcherOutput))).Replace('-', '').ToLowerInvariant()
    Write-Output "SHA-256: $digest"
} finally { $sha.Dispose() }
Write-Output 'Built Lantern Vale.exe. No services were started and no dependencies were downloaded.'
