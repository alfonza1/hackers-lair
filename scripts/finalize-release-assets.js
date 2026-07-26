#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${content.trim()}\n`);
}

function releaseUrl(version, filename) {
  return `https://github.com/alfonza1/hackers-lair/releases/download/v${version}/${filename}`;
}

function wingetManifests(version, installerHash) {
  const relative = path.join('winget', 'manifests', 'h', 'hackerslair', 'desktop', version);
  return new Map([
    [path.join(relative, 'hackerslair.desktop.yaml'), `
# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.1.12.0.schema.json
PackageIdentifier: hackerslair.desktop
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.12.0
`],
    [path.join(relative, 'hackerslair.desktop.installer.yaml'), `
# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.1.12.0.schema.json
PackageIdentifier: hackerslair.desktop
PackageVersion: ${version}
InstallerType: exe
Scope: user
InstallModes:
  - interactive
  - silent
  - silentWithProgress
UpgradeBehavior: install
ReleaseDate: ${new Date().toISOString().slice(0, 10)}
Installers:
  - Architecture: x64
    InstallerUrl: ${releaseUrl(version, `HackersLair-${version}-Setup.exe`)}
    InstallerSha256: ${installerHash.toUpperCase()}
    InstallerSwitches:
      Silent: --silent
      SilentWithProgress: --silent
ManifestType: installer
ManifestVersion: 1.12.0
`],
    [path.join(relative, 'hackerslair.desktop.locale.en-US.yaml'), `
# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.1.12.0.schema.json
PackageIdentifier: hackerslair.desktop
PackageVersion: ${version}
PackageLocale: en-US
Publisher: Hacker's Lair contributors
PublisherUrl: https://github.com/alfonza1
PublisherSupportUrl: https://github.com/alfonza1/hackers-lair/issues
PackageName: Hacker's Lair
PackageUrl: https://alfonza1.github.io/hackers-lair/
License: MIT
LicenseUrl: https://github.com/alfonza1/hackers-lair/blob/v${version}/LICENSE
ShortDescription: Local-first desktop console for coding projects, processes, ports, and logs.
Description: Start and stop complete local development projects, inspect localhost listeners, read logs, resolve port conflicts, and recover config without an account or cloud service.
Tags:
  - developer-tools
  - localhost
  - process-manager
ReleaseNotesUrl: https://github.com/alfonza1/hackers-lair/releases/tag/v${version}
ManifestType: defaultLocale
ManifestVersion: 1.12.0
`],
  ]);
}

function scoopManifest(version, archiveHash) {
  const archiveUrl = releaseUrl(version, 'hackers-lair-win32-x64.zip');
  return JSON.stringify({
    version,
    description: "Local-first desktop console for coding projects, processes, ports, and logs.",
    homepage: 'https://alfonza1.github.io/hackers-lair/',
    license: 'MIT',
    architecture: {
      '64bit': {
        url: archiveUrl,
        hash: archiveHash,
      },
    },
    bin: 'lair.cmd',
    shortcuts: [['HackersLair.exe', "Hacker's Lair"]],
    checkver: {
      github: 'https://github.com/alfonza1/hackers-lair',
    },
    autoupdate: {
      architecture: {
        '64bit': {
          url: 'https://github.com/alfonza1/hackers-lair/releases/download/v$version/hackers-lair-win32-x64.zip',
        },
      },
    },
  }, null, 2);
}

function finalizeReleaseAssets({ version, assetDirectory, manifestDirectory }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  const expectedFiles = [
    `HackersLair-${version}-Setup.exe`,
    'hackers-lair-win32-x64.zip',
    'hackers-lair_amd64.deb',
    'hackers-lair_x86_64.rpm',
    'hackers-lair-linux-x64.tar.gz',
    'hackers-lair-linux-x64.zip',
  ];
  const squirrelPackages = fs.existsSync(assetDirectory)
    ? fs.readdirSync(assetDirectory).filter((filename) => /-full\.nupkg$/i.test(filename))
    : [];
  if (squirrelPackages.length !== 1) {
    throw new Error(`Expected one Squirrel full nupkg, found ${squirrelPackages.length}.`);
  }
  expectedFiles.push('RELEASES', squirrelPackages[0]);
  const missing = expectedFiles.filter((filename) => (
    !fs.existsSync(path.join(assetDirectory, filename))
  ));
  if (missing.length) throw new Error(`Missing release assets: ${missing.join(', ')}`);

  const hashes = new Map(expectedFiles.map((filename) => [
    filename,
    sha256(path.join(assetDirectory, filename)),
  ]));
  write(
    path.join(assetDirectory, 'checksums.txt'),
    expectedFiles.map((filename) => `${hashes.get(filename)}  ${filename}`).join('\n'),
  );
  for (const [relative, content] of wingetManifests(
    version,
    hashes.get(`HackersLair-${version}-Setup.exe`),
  )) {
    write(path.join(manifestDirectory, relative), content);
  }
  write(
    path.join(manifestDirectory, 'scoop', 'hackerslair.json'),
    scoopManifest(version, hashes.get('hackers-lair-win32-x64.zip')),
  );
  console.log(`Finalized ${expectedFiles.length} release assets for v${version}.`);
}

function main() {
  finalizeReleaseAssets({
    version: argument('version', require('../package.json').version),
    assetDirectory: path.resolve(argument('assets', path.join(root, 'release-assets'))),
    manifestDirectory: path.resolve(argument('manifests', path.join(root, 'distribution'))),
  });
}

if (require.main === module) main();

module.exports = {
  finalizeReleaseAssets,
  releaseUrl,
  scoopManifest,
  wingetManifests,
};
