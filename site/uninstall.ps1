[CmdletBinding()]
param(
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\HackersLair'),
    [switch]$DeleteData,
    [switch]$KeepData,
    [switch]$NoShortcut,
    [switch]$NoPath
)

$ErrorActionPreference = 'Stop'
if ($DeleteData -and $KeepData) {
    throw 'Use either -DeleteData or -KeepData, not both.'
}

function Get-NormalizedPath([string]$PathValue) {
    return [System.IO.Path]::GetFullPath($PathValue).TrimEnd('\')
}

function Test-PathWithin([string]$Candidate, [string]$Parent) {
    $candidatePath = Get-NormalizedPath $Candidate
    $parentPath = Get-NormalizedPath $Parent
    return $candidatePath.StartsWith(
        $parentPath + [System.IO.Path]::DirectorySeparatorChar,
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

$installRoot = Get-NormalizedPath $InstallDirectory
$allowedParent = Get-NormalizedPath (Join-Path $env:LOCALAPPDATA 'Programs')
if (-not (Test-PathWithin $installRoot $allowedParent)) {
    throw "InstallDirectory must be a child of $allowedParent."
}

$processes = Get-CimInstance Win32_Process -Filter "Name='HackersLair.exe'" |
    Where-Object {
        $_.ExecutablePath -and (Test-PathWithin $_.ExecutablePath $installRoot)
    }
foreach ($process in $processes) {
    try {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
        Write-Output "Stopped verified Hacker's Lair process PID $($process.ProcessId)."
    } catch {
        if (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue) {
            throw
        }
        Write-Output "Verified Hacker's Lair process PID $($process.ProcessId) had already exited."
    }
}

if (-not $NoShortcut) {
    $shortcutPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Hacker's Lair.lnk"
    if (Test-Path -LiteralPath $shortcutPath) {
        Remove-Item -LiteralPath $shortcutPath -Force
    }
}

if (-not $NoPath) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($userPath) {
        $cleanPath = @($userPath -split ';' | Where-Object {
            $_ -and $_.TrimEnd('\') -ne $installRoot.TrimEnd('\')
        }) -join ';'
        [Environment]::SetEnvironmentVariable('Path', $cleanPath, 'User')
    }
}

if (Test-Path -LiteralPath $installRoot) {
    Remove-Item -LiteralPath $installRoot -Recurse -Force
    Write-Output "Removed application files: $installRoot"
}

$dataDirectory = Get-NormalizedPath (Join-Path $env:APPDATA 'HackersLair')
if (-not $DeleteData -and -not $KeepData) {
    $answer = Read-Host "Delete Hacker's Lair config, logs, and backups at `"$dataDirectory`"? [y/N]"
    $DeleteData = $answer -match '^(?i)y(?:es)?$'
}
if ($DeleteData -and (Test-Path -LiteralPath $dataDirectory)) {
    $expectedData = Get-NormalizedPath (Join-Path $env:APPDATA 'HackersLair')
    if ($dataDirectory -ne $expectedData) {
        throw "Refusing to remove unexpected data path: $dataDirectory"
    }
    Remove-Item -LiteralPath $dataDirectory -Recurse -Force
    Write-Output "Removed user data: $dataDirectory"
} else {
    Write-Output "Kept user data: $dataDirectory"
}

Write-Output "Hacker's Lair was uninstalled."
