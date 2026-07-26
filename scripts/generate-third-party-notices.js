#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

function licenseText(packageDirectory) {
  const candidates = fs.readdirSync(packageDirectory)
    .filter((name) => /^(licen[cs]e|copying)(?:\.|$)/i.test(name))
    .sort();
  if (!candidates.length) return 'License text is available from the package repository.';
  return fs.readFileSync(path.join(packageDirectory, candidates[0]), 'utf8').trim();
}

function productionPackages() {
  const names = new Set();
  const queue = Object.keys(lock.packages['']?.dependencies || {});
  while (queue.length) {
    const name = queue.shift();
    if (names.has(name)) continue;
    names.add(name);
    const metadata = lock.packages[`node_modules/${name}`] || {};
    queue.push(...Object.keys(metadata.dependencies || {}));
  }
  return [...names].sort().map((name) => {
    const directory = path.join(root, 'node_modules', ...name.split('/'));
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    return {
      name,
      version: metadata.version,
      license: metadata.license || 'See included license text',
      text: licenseText(directory),
    };
  });
}

function generateThirdPartyNotices() {
  const electronDirectory = path.join(root, 'node_modules', 'electron');
  const electron = JSON.parse(fs.readFileSync(path.join(electronDirectory, 'package.json'), 'utf8'));
  const sections = [
    "HACKER'S LAIR THIRD-PARTY NOTICES",
    '',
    'This product bundles Electron and open-source JavaScript packages.',
    'Chromium’s complete generated notices are distributed as LICENSES.chromium.html',
    'next to the Hacker’s Lair executable in every desktop package.',
    '',
    `================================================================================`,
    `Electron ${electron.version} — ${electron.license || 'MIT'}`,
    `================================================================================`,
    licenseText(electronDirectory),
  ];
  for (const dependency of productionPackages()) {
    sections.push(
      '',
      '================================================================================',
      `${dependency.name} ${dependency.version} — ${dependency.license}`,
      '================================================================================',
      dependency.text,
    );
  }
  const output = `${sections.join('\n').trim()}\n`;
  fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), output, 'utf8');
  return output;
}

if (require.main === module) {
  const output = generateThirdPartyNotices();
  console.log(`Generated THIRD_PARTY_NOTICES.txt (${Buffer.byteLength(output)} bytes).`);
}

module.exports = { generateThirdPartyNotices, productionPackages };
