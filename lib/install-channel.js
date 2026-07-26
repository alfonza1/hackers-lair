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
    upgradeCommand: 'irm https://hackerslairhq.github.io/desktop/install.ps1 | iex',
  },
  scoop: {
    label: 'Scoop',
    upgradeCommand: 'scoop update hackerslair',
  },
  'windows-portable': {
    label: 'Windows portable ZIP',
    upgradeCommand: 'irm https://hackerslairhq.github.io/desktop/install.ps1 | iex',
  },
  'linux-deb': {
    label: 'Debian/Ubuntu package',
    upgradeCommand: 'curl -fLO https://github.com/hackerslairhq/desktop/releases/latest/download/hackers-lair_amd64.deb && sudo apt install ./hackers-lair_amd64.deb',
  },
  'linux-rpm': {
    label: 'Fedora/RHEL package',
    upgradeCommand: 'curl -fLO https://github.com/hackerslairhq/desktop/releases/latest/download/hackers-lair_x86_64.rpm && sudo rpm -U ./hackers-lair_x86_64.rpm',
  },
  'linux-portable': {
    label: 'Linux portable archive',
    upgradeCommand: 'curl -fLO https://github.com/hackerslairhq/desktop/releases/latest/download/hackers-lair-linux-x64.tar.gz && mkdir -p "$HOME/.local/opt/hackers-lair" && tar -xzf hackers-lair-linux-x64.tar.gz -C "$HOME/.local/opt/hackers-lair" --strip-components=1',
  },
  portable: {
    label: 'Portable package',
    upgradeCommand: 'Open the Hacker’s Lair installation guide for this platform.',
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
