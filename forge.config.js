const fs = require('fs');
const path = require('path');
const packageMetadata = require('./package.json');
const windowsSigning = (
  process.env.WINDOWS_SIGN_CERTIFICATE_FILE
  && process.env.WINDOWS_SIGN_CERTIFICATE_PASSWORD
)
  ? {
    certificateFile: process.env.WINDOWS_SIGN_CERTIFICATE_FILE,
    certificatePassword: process.env.WINDOWS_SIGN_CERTIFICATE_PASSWORD,
  }
  : null;

const PACKAGED_RUNTIME_PATHS = new Set([
  'app-config.js',
  'bin',
  'desktop.js',
  'icon.ico',
  'icon.png',
  'lib',
  'LICENSE',
  'package.json',
  'preload.js',
  'projects.example.json',
  'public',
  'schemas',
  'scripts.example.json',
  'server.js',
  'settings.example.json',
]);
const PACKAGED_NODE_MODULES = new Set([
  'github-url-to-object',
  'is-url',
  'ms',
  'update-electron-app',
]);

function ignoreNonRuntimePath(file) {
  if (!file) return false;
  const segments = file
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .split('/');
  const [topLevelPath] = segments;
  if (topLevelPath === 'node_modules') {
    if (segments.length === 1) return false;
    const packageName = segments[1].startsWith('@')
      ? `${segments[1]}/${segments[2] || ''}`
      : segments[1];
    return !PACKAGED_NODE_MODULES.has(packageName);
  }
  return !PACKAGED_RUNTIME_PATHS.has(topLevelPath);
}

function writeCliCompanion({ platform, outputPaths }) {
  for (const outputPath of outputPaths) {
    if (platform === 'win32') {
      fs.writeFileSync(path.join(outputPath, 'lair.cmd'), [
        '@echo off',
        'set "ELECTRON_RUN_AS_NODE=1"',
        '"%~dp0HackersLair.exe" "%~dp0resources\\app.asar\\bin\\lair.js" %*',
        '',
      ].join('\r\n'), 'ascii');
      continue;
    }
    const shim = path.join(outputPath, 'lair');
    fs.writeFileSync(shim, [
      '#!/bin/sh',
      'root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
      'ELECTRON_RUN_AS_NODE=1 "$root/HackersLair" "$root/resources/app.asar/bin/lair.js" "$@"',
      '',
    ].join('\n'), { encoding: 'utf8', mode: 0o755 });
  }
}

module.exports = {
  packagerConfig: {
    asar: true,
    icon: process.platform === 'win32'
      ? path.resolve(__dirname, 'icon.ico')
      : path.resolve(__dirname, 'icon.png'),
    executableName: 'HackersLair',
    ...(windowsSigning ? { windowsSign: windowsSigning } : {}),
    ignore: ignoreNonRuntimePath,
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'hackers_lair',
        authors: packageMetadata.author,
        description: packageMetadata.description,
        exe: 'HackersLair.exe',
        noMsi: true,
        setupExe: `HackersLair-${packageMetadata.version}-Setup.exe`,
        setupIcon: path.resolve(__dirname, 'icon.ico'),
        shortcutName: "Hacker's Lair",
        ...(windowsSigning || {}),
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32', 'linux'],
    },
    {
      name: '@electron-forge/maker-deb',
      platforms: ['linux'],
      config: {
        options: {
          name: 'hackers-lair',
          productName: "Hacker's Lair",
          bin: 'HackersLair',
          genericName: 'Developer process console',
          maintainer: packageMetadata.author,
          homepage: packageMetadata.homepage,
          icon: path.resolve(__dirname, 'icon.png'),
          categories: ['Development', 'Utility'],
        },
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      platforms: ['linux'],
      config: {
        options: {
          name: 'hackers-lair',
          productName: "Hacker's Lair",
          bin: 'HackersLair',
          genericName: 'Developer process console',
          homepage: packageMetadata.homepage,
          icon: path.resolve(__dirname, 'icon.png'),
          categories: ['Development', 'Utility'],
        },
      },
    },
  ],
  hooks: {
    postPackage: async (_forgeConfig, packageResult) => {
      writeCliCompanion(packageResult);
    },
  },
};

module.exports.ignoreNonRuntimePath = ignoreNonRuntimePath;
module.exports.PACKAGED_NODE_MODULES = PACKAGED_NODE_MODULES;
