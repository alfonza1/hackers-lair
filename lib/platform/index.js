const { createLinuxPlatform } = require('./linux');
const { createWin32Platform } = require('./win32');

function createPlatform(platform = process.platform) {
  if (platform === 'win32') return createWin32Platform();
  if (platform === 'linux') return createLinuxPlatform();
  throw new Error(`Hacker's Lair does not support ${platform}.`);
}

module.exports = { createPlatform };
