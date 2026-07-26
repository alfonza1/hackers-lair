const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { finalizeReleaseAssets } = require('../scripts/finalize-release-assets');

test('release finalization hashes every package and generates channel manifests', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hackers-lair-release-'));
  const assets = path.join(root, 'assets');
  const manifests = path.join(root, 'manifests');
  const version = '2.1.0-beta.1';
  fs.mkdirSync(assets);
  for (const filename of [
    `HackersLair-${version}-Setup.exe`,
    'hackers-lair-win32-x64.zip',
    'hackers-lair_amd64.deb',
    'hackers-lair_x86_64.rpm',
    'hackers-lair-linux-x64.tar.gz',
    'hackers-lair-linux-x64.zip',
  ]) {
    fs.writeFileSync(path.join(assets, filename), `fixture:${filename}`);
  }

  finalizeReleaseAssets({ version, assetDirectory: assets, manifestDirectory: manifests });

  const checksums = fs.readFileSync(path.join(assets, 'checksums.txt'), 'utf8');
  assert.match(checksums, /^[a-f0-9]{64}  HackersLair-2\.1\.0-beta\.1-Setup\.exe/m);
  assert.equal(checksums.trim().split('\n').length, 6);

  const wingetDirectory = path.join(
    manifests,
    'winget',
    'manifests',
    'a',
    'Alfonza1',
    'HackersLair',
    version,
  );
  const installer = fs.readFileSync(
    path.join(wingetDirectory, 'Alfonza1.HackersLair.installer.yaml'),
    'utf8',
  );
  assert.match(installer, /Scope: user/);
  assert.match(installer, /InstallerType: exe/);
  assert.match(installer, /winget-manifest\.installer\.1\.12\.0\.schema\.json/);
  assert.match(installer, /ManifestVersion: 1\.12\.0/);
  assert.match(installer, /InstallerSha256: [A-F0-9]{64}/);
  assert.match(installer, /HackersLair-2\.1\.0-beta\.1-Setup\.exe/);

  const scoop = JSON.parse(fs.readFileSync(
    path.join(manifests, 'scoop', 'hackerslair.json'),
    'utf8',
  ));
  assert.equal(scoop.version, version);
  assert.equal(scoop.bin, 'lair.cmd');
  assert.match(scoop.architecture['64bit'].hash, /^[a-f0-9]{64}$/);
});
