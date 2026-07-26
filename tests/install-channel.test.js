const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  detectInstallChannel,
  installChannelDetails,
} = require('../lib/install-channel');

function fakeFilesystem(existingPaths, fileContents = {}) {
  const normalize = (value) => String(value).replaceAll('\\', '/').toLowerCase();
  const normalized = new Set(existingPaths.map(normalize));
  return {
    exists: (value) => normalized.has(normalize(value)),
    readFile: (value) => fileContents[normalize(value)] || '',
  };
}

test('detects Squirrel, PowerShell, Scoop, portable, and source channels', () => {
  const squirrelExe = 'C:\\Profiles\\developer\\AppData\\Local\\HackersLair\\app-2.1.0\\HackersLair.exe';
  const squirrel = fakeFilesystem([
    'C:\\Profiles\\developer\\AppData\\Local\\HackersLair\\Update.exe',
  ]);
  assert.equal(detectInstallChannel({
    isPackaged: true,
    platform: 'win32',
    executablePath: squirrelExe,
    exists: squirrel.exists,
  }), 'squirrel');

  const portableExe = 'C:\\Tools\\HackersLair\\HackersLair.exe';
  const marker = path.win32.join(path.win32.dirname(portableExe), 'install-channel.txt');
  const powershell = fakeFilesystem([marker], {
    [marker.replaceAll('\\', '/').toLowerCase()]: 'powershell\n',
  });
  assert.equal(detectInstallChannel({
    isPackaged: true,
    platform: 'win32',
    executablePath: portableExe,
    exists: powershell.exists,
    readFile: powershell.readFile,
  }), 'powershell');
  assert.equal(detectInstallChannel({
    isPackaged: true,
    platform: 'win32',
    executablePath: 'C:\\Profiles\\developer\\scoop\\apps\\hackerslair\\current\\HackersLair.exe',
    exists: () => false,
  }), 'scoop');
  assert.equal(detectInstallChannel({
    isPackaged: true,
    platform: 'win32',
    executablePath: portableExe,
    exists: () => false,
  }), 'windows-portable');
  assert.equal(detectInstallChannel({ isPackaged: false }), 'source');
});

test('only Squirrel has an internal updater; other channels expose commands', () => {
  assert.equal(installChannelDetails('squirrel').upgradeCommand, '');
  for (const channel of ['powershell', 'scoop', 'windows-portable', 'linux-deb', 'linux-rpm']) {
    assert.ok(installChannelDetails(channel).upgradeCommand, channel);
  }
  assert.match(installChannelDetails('linux-deb').upgradeCommand, /releases\/latest\/download\/hackers-lair_amd64\.deb/);
  assert.match(installChannelDetails('linux-rpm').upgradeCommand, /sudo rpm -U /);
  assert.match(installChannelDetails('linux-portable').upgradeCommand, /--strip-components=1/);
});
