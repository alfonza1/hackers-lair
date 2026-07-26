[CmdletBinding()]
param(
    [switch]$DeleteData,
    [switch]$KeepData
)

$ErrorActionPreference = 'Stop'
if ($DeleteData -and $KeepData) {
    throw 'Use either -DeleteData or -KeepData, not both.'
}

$installDirectory = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$serverScript = [System.IO.Path]::GetFullPath((Join-Path $installDirectory 'server.js'))
$escapedServerScript = [Regex]::Escape($serverScript)
$serverProcesses = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object {
        $_.CommandLine -and (
            $_.CommandLine -match ('(?i)"?' + $escapedServerScript + '"?')
        )
    }

foreach ($serverProcess in $serverProcesses) {
    Stop-Process -Id $serverProcess.ProcessId -Force -ErrorAction Stop
    Write-Output "Stopped verified Hacker's Lair server PID $($serverProcess.ProcessId)."
}

$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$targets = @(
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Hacker's Lair.lnk"),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) "Hacker's Lair.lnk"),
    (Join-Path $startup "Hacker's Lair.lnk"),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Project Manager.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Project Manager.lnk'),
    (Join-Path $startup 'Project Manager.lnk'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Localhost Manager.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Localhost Manager.lnk')
)
foreach ($shortcut in $targets) {
    if (Test-Path -LiteralPath $shortcut) {
        Remove-Item -LiteralPath $shortcut -Force
        Write-Output "Removed: $shortcut"
    }
}

$iconCache = Join-Path $env:APPDATA "Hacker's Lair\icons"
if (Test-Path -LiteralPath $iconCache) {
    Remove-Item -LiteralPath $iconCache -Recurse -Force
    Write-Output "Removed icon cache: $iconCache"
}

$dataDirectory = Join-Path $env:APPDATA 'HackersLair'
if (-not $DeleteData -and -not $KeepData) {
    $answer = Read-Host "Delete Hacker's Lair user configuration and logs at `"$dataDirectory`"? [y/N]"
    $DeleteData = $answer -match '^(?i)y(?:es)?$'
}
if ($DeleteData -and (Test-Path -LiteralPath $dataDirectory)) {
    $resolvedData = [System.IO.Path]::GetFullPath($dataDirectory).TrimEnd('\')
    $expectedData = [System.IO.Path]::GetFullPath((Join-Path $env:APPDATA 'HackersLair')).TrimEnd('\')
    if ($resolvedData -ne $expectedData) {
        throw "Refusing to remove unexpected data path: $resolvedData"
    }
    Remove-Item -LiteralPath $resolvedData -Recurse -Force
    Write-Output "Removed user data: $resolvedData"
} else {
    Write-Output "Kept user data: $dataDirectory"
}

Write-Output "Hacker's Lair shortcuts were removed."
