const fs = require('fs');
const path = require('path');

const CHANNEL_DETAILS = Object.freeze({
  source: {
    label: 'Source checkout',
    upgradeCommand: 'git pull && npm ci',
  },
  squirrel: {
    label: 'Windows Squirrel installer',
    upgradeCommand: '',
  },
  powershell: {
    label: 'PowerShell portable install',
    upgradeCommand: 'irm https://alfonza1.github.io/hackers-lair/install.ps1 | iex',
  },
  scoop: {
    label: 'Scoop',
    upgradeCommand: 'scoop update hackerslair',
  },
  'windows-portable': {
    label: 'Windows portable ZIP',
    upgradeCommand: 'irm https://alfonza1.github.io/hackers-lair/install.ps1 | iex',
  },
  'linux-deb': {
    label: 'Debian/Ubuntu package',
    upgradeCommand: 'sudo apt install --only-upgrade hackers-lair',
  },
  'linux-rpm': {
    label: 'Fedora/RHEL package',
    upgradeCommand: 'sudo dnf upgrade hackers-lair',
  },
  'linux-portable': {
    label: 'Linux portable archive',
    upgradeCommand: 'See the latest tarball command in the Hacker’s Lair install docs.',
  },
  portable: {
    label: 'Portable package',
    upgradeCommand: 'See the Hacker’s Lair install docs for the current package command.',
  },
});

function platformPath(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function normalizedExecutablePath(executablePath, platform) {
  return platformPath(platform)
    .resolve(String(executablePath || ''))
    .replaceAll('\\', '/')
    .toLowerCase();
}

function markerChannel(
  executablePath,
  platform,
  exists = fs.existsSync,
  readFile = fs.readFileSync,
) {
  const pathApi = platformPath(platform);
  const marker = pathApi.join(pathApi.dirname(executablePath), 'install-channel.txt');
  if (!exists(marker)) return '';
  try {
    const value = String(readFile(marker, 'utf8')).trim().toLowerCase();
    return Object.hasOwn(CHANNEL_DETAILS, value) ? value : '';
  } catch {
    return '';
  }
}

function detectInstallChannel({
  isPackaged,
  platform = process.platform,
  executablePath = process.execPath,
  exists = fs.existsSync,
  readFile = fs.readFileSync,
}) {
  if (!isPackaged) return 'source';

  const pathApi = platformPath(platform);
  const normalized = normalizedExecutablePath(executablePath, platform);
  if (platform === 'win32') {
    const updateExecutable = pathApi.resolve(pathApi.dirname(executablePath), '..', 'Update.exe');
    if (exists(updateExecutable) && /\/app-[^/]+\/hackerslair\.exe$/.test(normalized)) {
      return 'squirrel';
    }
    const marker = markerChannel(executablePath, platform, exists, readFile);
    if (marker) return marker;
    if (/\/scoop\/apps\/hackerslair\//.test(normalized)) return 'scoop';
    return 'windows-portable';
  }

  if (platform === 'linux') {
    if (normalized.startsWith('/usr/lib/hackers-lair/')) {
      if (exists('/etc/debian_version')) return 'linux-deb';
      if (exists('/etc/redhat-release')) return 'linux-rpm';
    }
    return 'linux-portable';
  }
  return 'portable';
}

function installChannelDetails(channel) {
  return {
    id: Object.hasOwn(CHANNEL_DETAILS, channel) ? channel : 'portable',
    ...(CHANNEL_DETAILS[channel] || CHANNEL_DETAILS.portable),
  };
}

module.exports = {
  CHANNEL_DETAILS,
  detectInstallChannel,
  installChannelDetails,
};
