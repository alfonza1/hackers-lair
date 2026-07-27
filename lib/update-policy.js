function managedTargetsRunning(projects = []) {
  return projects
    .filter((project) => project.running || project.starting)
    .map((project) => project.name);
}

function releaseVersion(releaseName, fallback = '') {
  const match = String(releaseName || '').match(/v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match ? match[1] : fallback;
}

function releaseNotesForVersion(changelog, version) {
  const lines = String(changelog || '').split(/\r?\n/);
  const header = `## [${version}]`;
  const start = lines.findIndex((line) => line.startsWith(header));
  if (start < 0) return '';
  const nextRelease = lines.findIndex((line, index) => (
    index > start && /^## \[[^\]]+\]/.test(line)
  ));
  const end = nextRelease < 0 ? lines.length : nextRelease;
  return lines.slice(start + 1, end).join('\n').trim();
}

function updateStateForChannel(channel, details, currentVersion, releaseNotes = '') {
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
    releaseNotes: String(releaseNotes || '').trim(),
    managedTargets: [],
  };
}

module.exports = {
  managedTargetsRunning,
  releaseNotesForVersion,
  releaseVersion,
  updateStateForChannel,
};
