module.exports = {
  packagerConfig: {
    asar: true,
    icon: 'icon',
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
  makers: [{
    name: '@electron-forge/maker-zip',
    platforms: ['win32'],
  }],
};
