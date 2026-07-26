const path = require('path');
const packageMetadata = require('./package.json');

module.exports = {
  packagerConfig: {
    asar: true,
    icon: process.platform === 'win32'
      ? path.resolve(__dirname, 'icon.ico')
      : path.resolve(__dirname, 'icon.png'),
    executableName: 'HackersLair',
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
};
