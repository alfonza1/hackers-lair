const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function runStopHarness(mockFunctions) {
  const installer = fs.readFileSync(path.join(root, 'install.ps1'), 'utf8');
  const executionMarker = "if (-not $env:LOCALAPPDATA) {";
  const markerIndex = installer.indexOf(executionMarker);
  assert.notEqual(markerIndex, -1, 'Installer execution marker is missing.');

  const functionsOnly = installer.slice(0, markerIndex);
  const harness = [
    functionsOnly,
    ...mockFunctions,
    "Stop-InstalledProcesses 'C:\\LairSmoke'",
  ].join('\n');
  const encodedHarness = Buffer.from(harness, 'utf16le').toString('base64');
  return spawnSync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    encodedHarness,
  ], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('repeat install tolerates an Electron sibling that already exited', {
  skip: process.platform !== 'win32',
}, () => {
  const result = runStopHarness([
    'function Get-CimInstance {',
    '  @(',
    "    [pscustomobject]@{ ExecutablePath = 'C:\\LairSmoke\\HackersLair.exe'; ProcessId = 101 },",
    "    [pscustomobject]@{ ExecutablePath = 'C:\\LairSmoke\\HackersLair.exe'; ProcessId = 102 }",
    '  )',
    '}',
    'function Stop-Process {',
    '  param([int]$Id, [switch]$Force, [object]$ErrorAction)',
    '  if ($Id -eq 102) { throw "Cannot find a process with the process identifier 102." }',
    '}',
    'function Get-Process {',
    '  param([int]$Id, [object]$ErrorAction)',
    '  if ($Id -eq 101) { return [pscustomobject]@{ Id = 101 } }',
    '  return $null',
    '}',
  ]);

  assert.equal(result.status, 0, [result.stdout, result.stderr].filter(Boolean).join('\n'));
  assert.match(result.stdout, /PID 102 exited before the installer reached it/);
});

test('repeat install preserves a real process-stop failure', {
  skip: process.platform !== 'win32',
}, () => {
  const result = runStopHarness([
    'function Get-CimInstance {',
    "  [pscustomobject]@{ ExecutablePath = 'C:\\LairSmoke\\HackersLair.exe'; ProcessId = 201 }",
    '}',
    'function Stop-Process {',
    '  param([int]$Id, [switch]$Force, [object]$ErrorAction)',
    '  throw "Access denied while stopping process 201."',
    '}',
    'function Get-Process {',
    '  param([int]$Id, [object]$ErrorAction)',
    '  return [pscustomobject]@{ Id = $Id }',
    '}',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Access denied while stopping process 201/);
});
