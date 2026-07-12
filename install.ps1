# Registers the Hacker's Lair desktop app in Windows Search / Start menu and
# on the Desktop, then starts its local service silently when you log in.
# Re-run this any time you move the folder.
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$name = "Hacker's Lair"

# Make sure the icon exists (generate it if missing).
$icon = Join-Path $dir 'icon.ico'
if (-not (Test-Path $icon)) { & (Join-Path $dir 'make-icon.ps1') | Out-Null }

$vbs = Join-Path $dir 'launcher.vbs'
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'

$shell = New-Object -ComObject WScript.Shell

# Remove shortcuts from the previous visible names.
foreach ($old in @(
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Project Manager.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Project Manager.lnk'),
    (Join-Path $startup 'Project Manager.lnk'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Localhost Manager.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Localhost Manager.lnk'),
    (Join-Path $startup 'Localhost Manager.lnk')
)) { if (Test-Path $old) { Remove-Item $old -Force } }

# name -> extra launcher arguments ('' = desktop app, 'boot' = background service only)
$shortcuts = @{
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$name.lnk")   = ''
    (Join-Path ([Environment]::GetFolderPath('Desktop')) "$name.lnk")            = ''
    (Join-Path $startup "$name.lnk")                                             = 'boot'
}

foreach ($lnk in $shortcuts.Keys) {
    $extra = $shortcuts[$lnk]
    $sc = $shell.CreateShortcut($lnk)
    $sc.TargetPath = $wscript
    $sc.Arguments = '"' + $vbs + '"' + $(if ($extra) { " $extra" } else { '' })
    $sc.WorkingDirectory = $dir
    $sc.IconLocation = $icon
    $sc.Description = "Open Hacker's Lair for projects, ports, and local scripts"
    $sc.WindowStyle = 1
    $sc.Save()
    Write-Output "Created: $lnk"
}

Write-Output ''
Write-Output "Done. Press the Windows key and type `"$name`" to launch it."
Write-Output "It will also start automatically (in the background) each time you log in."
