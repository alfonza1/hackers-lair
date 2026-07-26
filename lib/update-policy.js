function managedTargetsRunning(projects = []) {
  return projects
    .filter((project) => project.running || project.starting)
    .map((project) => project.name);
}

function releaseVersion(releaseName, fallback = '') {
  const match = String(releaseName || '').match(/v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match ? match[1] : fallback;
}

function updateStateForChannel(channel, details, currentVersion) {
  const internal = channel === 'squirrel';
  return {
    channel,
    channelLabel: details.label,
    currentVersion,
    mode: internal ? 'internal' : 'manual',
    status: internal ? 'checking' : 'manual',
    version: '',
    message: internal
      ? 'Checking GitHub Releases for a Squirrel update.'
      : `Updates use the ${details.label} channel.`,
    upgradeCommand: details.upgradeCommand,
    releaseUrl: 'https://github.com/hackerslairhq/desktop/releases',
    managedTargets: [],
  };
}

module.exports = {
  managedTargetsRunning,
  releaseVersion,
  updateStateForChannel,
};
