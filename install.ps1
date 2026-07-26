# Registers the Hacker's Lair desktop app in Windows Search / Start menu and
# on the Desktop, then starts its local service silently when you log in.
# Re-run this any time you move the folder.
[CmdletBinding()]
param(
    [switch]$NoStartup
)

$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$name = "Hacker's Lair"

# Make sure the icon exists (generate it if missing).
$icon = Join-Path $dir 'icon.ico'
if (-not (Test-Path $icon)) { & (Join-Path $dir 'make-icon.ps1') | Out-Null }

$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'

# Remove shortcuts from the previous visible names.
foreach ($old in @(
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Project Manager.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Project Manager.lnk'),
    (Join-Path $startup 'Project Manager.lnk'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Localhost Manager.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Localhost Manager.lnk'),
    (Join-Path $startup 'Localhost Manager.lnk')
)) { if (Test-Path $old) { Remove-Item $old -Force } }
if ($NoStartup) {
    $currentStartup = Join-Path $startup "Hacker's Lair.lnk"
    if (Test-Path -LiteralPath $currentStartup) {
        Remove-Item -LiteralPath $currentStartup -Force
    }
}

# Install the offline CLI shim in a stable per-user folder and add it to the
# user PATH once. The command delegates to the verified local token/port file.
$cliDirectory = Join-Path $env:LOCALAPPDATA 'HackersLair\bin'
New-Item -ItemType Directory -Path $cliDirectory -Force | Out-Null
$cliScript = Join-Path $dir 'bin\lair.js'
$cliCommand = Join-Path $cliDirectory 'lair.cmd'
$cliBody = "@echo off`r`nnode `"$cliScript`" %*`r`n"
Set-Content -LiteralPath $cliCommand -Value $cliBody -Encoding Ascii
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathEntries = @($userPath -split ';' | Where-Object { $_ })
if ($pathEntries -notcontains $cliDirectory) {
    [Environment]::SetEnvironmentVariable('Path', (($pathEntries + $cliDirectory) -join ';'), 'User')
}

$electron = Join-Path $dir 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) {
    throw 'Electron is not installed. Run npm install before install.ps1.'
}

# Electron writes the same AppUserModelID to each shortcut that the running
# desktop process uses. Windows needs that shared identity to associate a pin
# with the correct window and native icon.
$shortcutInstaller = Join-Path $dir 'scripts\install-shortcuts.js'
$shortcutArguments = @("`"$shortcutInstaller`"")
if ($NoStartup) { $shortcutArguments += '--no-startup' }
$installerProcess = Start-Process -FilePath $electron -ArgumentList $shortcutArguments -WindowStyle Hidden -Wait -PassThru
if ($installerProcess.ExitCode -ne 0) {
    throw "Shortcut installation failed with exit code $($installerProcess.ExitCode)."
}

Write-Output ''
Write-Output "Done. Press the Windows key and type `"$name`" to launch it."
if ($NoStartup) {
    Write-Output 'Login startup was skipped.'
} else {
    Write-Output 'It will also start automatically (in the background) each time you log in.'
}
Write-Output 'Open a new terminal and run "lair ls" to use the CLI.'
