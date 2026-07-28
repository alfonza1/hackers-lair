[CmdletBinding()]
param(
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\HackersLair'),
    [string]$ReleaseApi = 'https://api.github.com/repos/hackerslairhq/desktop/releases/latest',
    [string]$ReleaseDownloadBase = 'https://github.com/hackerslairhq/desktop/releases/latest/download',
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
}

function Add-UserPath([string]$Directory) {
    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @($current -split ';' | Where-Object { $_ })
    if ($entries.TrimEnd('\') -notcontains $Directory.TrimEnd('\')) {
        [Environment]::SetEnvironmentVariable('Path', (($entries + $Directory) -join ';'), 'User')
    }
}

function Get-Sha256Hex([string]$File) {
    $stream = [System.IO.File]::OpenRead($File)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha256.ComputeHash($stream)
        return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

function Test-IsElevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function New-ApplicationShortcut(
    [string]$ShortcutPath,
    [string]$Executable,
    [string]$WorkingDirectory,
    $Shell
) {
    $parent = Split-Path -Parent $ShortcutPath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $shortcut = $Shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $Executable
    $shortcut.Arguments = ''
    $shortcut.WorkingDirectory = $WorkingDirectory
    $shortcut.IconLocation = "$Executable,0"
    $shortcut.Description = 'Local developer process control'
    $shortcut.Save()
}

function Test-LegacyLauncherShortcut([string]$ShortcutPath, $Shell) {
    if (-not (Test-Path -LiteralPath $ShortcutPath)) {
        return $false
    }
    try {
        $shortcut = $Shell.CreateShortcut($ShortcutPath)
        $hostName = [System.IO.Path]::GetFileName($shortcut.TargetPath)
        $usesScriptHost = $hostName -in @('wscript.exe', 'cscript.exe')
        $usesRetiredLauncher = $shortcut.Arguments -match '(?i)(?:^|[\\/])launcher\.vbs(?:"|\s|$)'
        return $usesScriptHost -and $usesRetiredLauncher
    } catch {
        return $false
    }
}

function Backup-LegacyShortcut([string]$ShortcutPath, [string]$Label) {
    $backupDirectory = Join-Path $env:APPDATA 'HackersLair\shortcut-backups'
    New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
    $backupName = '{0}-{1}.lnk' -f $Label, (Get-Date -Format 'yyyyMMdd-HHmmssfff')
    Copy-Item -LiteralPath $ShortcutPath -Destination (Join-Path $backupDirectory $backupName) -Force
}

function Repair-LegacyShortcuts(
    [string]$Executable,
    [string]$WorkingDirectory,
    $Shell
) {
    $taskbarShortcut = Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Hacker's Lair.lnk"
    $desktopDirectory = if (
        $env:LAIR_INSTALLER_SMOKE -eq '1' -and
        $env:LAIR_DESKTOP_DIRECTORY
    ) {
        [IO.Path]::GetFullPath($env:LAIR_DESKTOP_DIRECTORY)
    } else {
        [Environment]::GetFolderPath('Desktop')
    }
    $repairTargets = @(
        @{ Path = $taskbarShortcut; Label = 'taskbar' }
    )
    if ($desktopDirectory) {
        $repairTargets += @{
            Path = (Join-Path $desktopDirectory "Hacker's Lair.lnk")
            Label = 'desktop'
        }
    }
    foreach ($target in $repairTargets) {
        if (Test-LegacyLauncherShortcut $target.Path $Shell) {
            Backup-LegacyShortcut $target.Path $target.Label
            New-ApplicationShortcut $target.Path $Executable $WorkingDirectory $Shell
            Write-Output "Repaired legacy $($target.Label) shortcut."
        }
    }

    $startupShortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\Hacker's Lair.lnk"
    if (Test-LegacyLauncherShortcut $startupShortcut $Shell) {
        Backup-LegacyShortcut $startupShortcut 'startup'
        Remove-Item -LiteralPath $startupShortcut -Force
        Write-Output 'Removed retired launch-at-login shortcut. Enable launch at login inside the app if wanted.'
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
    $releaseLabel = 'latest release'
    $downloadBase = $ReleaseDownloadBase.TrimEnd('/')
    $archiveUrl = "$downloadBase/$AssetName"
    $checksumUrl = "$downloadBase/$ChecksumName"
    try {
        $release = Invoke-RestMethod -Uri $ReleaseApi -Headers $headers
        $archiveAsset = $release.assets | Where-Object name -eq $AssetName | Select-Object -First 1
        $checksumAsset = $release.assets | Where-Object name -eq $ChecksumName | Select-Object -First 1
        if (-not $archiveAsset -or -not $checksumAsset) {
            throw "Release $($release.tag_name) does not contain $AssetName and $ChecksumName."
        }
        $releaseLabel = $release.tag_name
        $archiveUrl = $archiveAsset.browser_download_url
        $checksumUrl = $checksumAsset.browser_download_url
    } catch {
        Write-Warning "Release API lookup failed; using stable latest-download URLs. $($_.Exception.Message)"
    }

    Write-Output "Downloading Hacker's Lair $releaseLabel..."
    Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -Headers $headers
    Invoke-WebRequest -Uri $checksumUrl -OutFile $checksumPath -Headers $headers

    $escapedName = [Regex]::Escape($AssetName)
    $checksumLine = Get-Content -LiteralPath $checksumPath |
        Where-Object { $_ -match "^(?<hash>[A-Fa-f0-9]{64})\s+\*?$escapedName$" } |
        Select-Object -First 1
    if (-not $checksumLine) {
        throw "$ChecksumName does not contain a SHA256 entry for $AssetName."
    }
    $expectedHash = ([Regex]::Match($checksumLine, '^[A-Fa-f0-9]{64}')).Value.ToLowerInvariant()
    $actualHash = Get-Sha256Hex $archivePath
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
        $shortcutPath = Join-Path $programs "$ApplicationName.lnk"
        $shell = New-Object -ComObject WScript.Shell
        New-ApplicationShortcut $shortcutPath $installedExecutable $installRoot $shell
        Repair-LegacyShortcuts $installedExecutable $installRoot $shell
    }

    Write-Output ''
    Write-Output "Installed $ApplicationName to $installRoot."
    Write-Output 'Launch at login remains off; enable it inside the app if wanted.'
    Write-Output 'Open a new terminal and run "lair doctor".'
    if (-not $NoLaunch) {
        if (Test-IsElevated) {
            Write-Output 'Administrator PowerShell detected: automatic launch was skipped.'
            Write-Output "Open $ApplicationName from the Start menu to run it without administrator privileges."
        } else {
            Start-Process -FilePath $installedExecutable -WorkingDirectory $installRoot
        }
    }
} finally {
    if (
        (Test-Path -LiteralPath $temporaryRoot) -and
        $temporaryRoot.StartsWith([System.IO.Path]::GetTempPath(), [System.StringComparison]::OrdinalIgnoreCase)
    ) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
