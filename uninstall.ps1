# Removes the Start menu, Desktop, and Startup shortcuts. Leaves project files alone.
$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$targets = @(
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Hacker's Lair.lnk"),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) "Hacker's Lair.lnk"),
    (Join-Path $startup "Hacker's Lair.lnk"),
    # previous names
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Project Manager.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Project Manager.lnk'),
    (Join-Path $startup 'Project Manager.lnk'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Localhost Manager.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Localhost Manager.lnk')
)
foreach ($lnk in $targets) {
    if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Output "Removed: $lnk" }
}
$iconCache = Join-Path $env:APPDATA "Hacker's Lair\icons"
if (Test-Path $iconCache) { Remove-Item $iconCache -Recurse -Force; Write-Output "Removed: $iconCache" }
Write-Output 'Shortcuts removed. The background server (if running) keeps going until you stop it in the app or reboot.'
