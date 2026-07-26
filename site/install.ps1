[CmdletBinding()]
param(
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\HackersLair'),
    [string]$ReleaseApi = 'https://api.github.com/repos/alfonza1/hackers-lair/releases/latest',
    [switch]$NoLaunch,
    [switch]$NoStartup,
    [switch]$NoShortcut,
    [switch]$NoPath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$AssetName = 'hackers-lair-win32-x64.zip'
$ChecksumName = 'checksums.txt'
$ApplicationName = "Hacker's Lair"

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

function Stop-InstalledProcesses([string]$Directory) {
    $installRoot = Get-NormalizedPath $Directory
    $processes = Get-CimInstance Win32_Process -Filter "Name='HackersLair.exe'" |
        Where-Object {
            $_.ExecutablePath -and (Test-PathWithin $_.ExecutablePath $installRoot)
        }
    foreach ($process in $processes) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
        Write-Output "Stopped verified Hacker's Lair process PID $($process.ProcessId)."
    }
}

function Add-UserPath([string]$Directory) {
    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @($current -split ';' | Where-Object { $_ })
    if ($entries.TrimEnd('\') -notcontains $Directory.TrimEnd('\')) {
        [Environment]::SetEnvironmentVariable('Path', (($entries + $Directory) -join ';'), 'User')
    }
}

if (-not $env:LOCALAPPDATA) {
    throw 'LOCALAPPDATA is unavailable. Hacker''s Lair installs per user on Windows.'
}

$installRoot = Get-NormalizedPath $InstallDirectory
$allowedParent = Get-NormalizedPath (Join-Path $env:LOCALAPPDATA 'Programs')
if (-not (Test-PathWithin $installRoot $allowedParent)) {
    throw "InstallDirectory must be a child of $allowedParent."
}

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("hackers-lair-install-" + [Guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $temporaryRoot $AssetName
$checksumPath = Join-Path $temporaryRoot $ChecksumName
$stagingPath = Join-Path $temporaryRoot 'staging'

try {
    New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
    $headers = @{
        Accept = 'application/vnd.github+json'
        'User-Agent' = 'Hackers-Lair-Installer'
    }
    $release = Invoke-RestMethod -Uri $ReleaseApi -Headers $headers
    $archiveAsset = $release.assets | Where-Object name -eq $AssetName | Select-Object -First 1
    $checksumAsset = $release.assets | Where-Object name -eq $ChecksumName | Select-Object -First 1
    if (-not $archiveAsset -or -not $checksumAsset) {
        throw "Release $($release.tag_name) does not contain $AssetName and $ChecksumName."
    }

    Write-Output "Downloading Hacker's Lair $($release.tag_name)..."
    Invoke-WebRequest -Uri $archiveAsset.browser_download_url -OutFile $archivePath -Headers $headers
    Invoke-WebRequest -Uri $checksumAsset.browser_download_url -OutFile $checksumPath -Headers $headers

    $escapedName = [Regex]::Escape($AssetName)
    $checksumLine = Get-Content -LiteralPath $checksumPath |
        Where-Object { $_ -match "^(?<hash>[A-Fa-f0-9]{64})\s+\*?$escapedName$" } |
        Select-Object -First 1
    if (-not $checksumLine) {
        throw "$ChecksumName does not contain a SHA256 entry for $AssetName."
    }
    $expectedHash = ([Regex]::Match($checksumLine, '^[A-Fa-f0-9]{64}')).Value.ToLowerInvariant()
    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
        throw "SHA256 mismatch for $AssetName. Nothing was installed or unblocked."
    }
    Write-Output "SHA256 verified: $actualHash"

    Unblock-File -LiteralPath $archivePath
    New-Item -ItemType Directory -Path $stagingPath -Force | Out-Null
    Expand-Archive -LiteralPath $archivePath -DestinationPath $stagingPath -Force
    $stagedExecutable = Get-ChildItem -LiteralPath $stagingPath -Filter 'HackersLair.exe' -File -Recurse |
        Select-Object -First 1
    if (-not $stagedExecutable) {
        throw 'The verified archive does not contain HackersLair.exe.'
    }
    $payloadRoot = $stagedExecutable.Directory.FullName

    Stop-InstalledProcesses $installRoot
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    Get-ChildItem -LiteralPath $installRoot -Force | Remove-Item -Recurse -Force
    Copy-Item -Path (Join-Path $payloadRoot '*') -Destination $installRoot -Recurse -Force

    $installedExecutable = Join-Path $installRoot 'HackersLair.exe'
    $applicationArchive = Join-Path $installRoot 'resources\app.asar'
    if (-not (Test-Path -LiteralPath $installedExecutable) -or -not (Test-Path -LiteralPath $applicationArchive)) {
        throw 'The installed package is incomplete.'
    }

    $cliCommand = Join-Path $installRoot 'lair.cmd'
    $cliBody = @(
        '@echo off'
        'set "ELECTRON_RUN_AS_NODE=1"'
        '"%~dp0HackersLair.exe" "%~dp0resources\app.asar\bin\lair.js" %*'
    ) -join "`r`n"
    Set-Content -LiteralPath $cliCommand -Value $cliBody -Encoding Ascii
    Set-Content -LiteralPath (Join-Path $installRoot 'install-channel.txt') -Value 'powershell' -Encoding Ascii
    if (-not $NoPath) {
        Add-UserPath $installRoot
    }

    if (-not $NoShortcut) {
        $programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
        New-Item -ItemType Directory -Path $programs -Force | Out-Null
        $shortcutPath = Join-Path $programs "$ApplicationName.lnk"
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $installedExecutable
        $shortcut.WorkingDirectory = $installRoot
        $shortcut.IconLocation = "$installedExecutable,0"
        $shortcut.Description = 'Local developer process control'
        $shortcut.Save()
    }

    Write-Output ''
    Write-Output "Installed $ApplicationName to $installRoot."
    Write-Output 'Launch at login remains off; enable it inside the app if wanted.'
    Write-Output 'Open a new terminal and run "lair doctor".'
    if (-not $NoLaunch) {
        Start-Process -FilePath $installedExecutable -WorkingDirectory $installRoot
    }
} finally {
    if (
        (Test-Path -LiteralPath $temporaryRoot) -and
        $temporaryRoot.StartsWith([System.IO.Path]::GetTempPath(), [System.StringComparison]::OrdinalIgnoreCase)
    ) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
