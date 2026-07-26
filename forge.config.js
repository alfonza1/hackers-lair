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
    ignore: [
      /^\/\.git(?:\/|$)/,
      /^\/docs(?:\/|$)/,
      /^\/tests(?:\/|$)/,
      /^\/out(?:\/|$)/,
      /^\/projects\.json$/,
      /^\/scripts\.json$/,
      /^\/settings\.json$/,
      /^\/(?:started|stopped|project-activity)\.json$/,
      /^\/logs(?:\/|$)/,
    ],
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
