function managedTargetsRunning(projects = []) {
  return projects
    .filter((project) => project.running || project.starting)
    .map((project) => project.name);
}

function releaseVersion(releaseName, fallback = '') {
  const match = String(releaseName || '').match(/v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match ? match[1] : fallback;
}

function parseVersion(value) {
  const match = String(value || '').trim().match(
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!match) return null;
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function comparePrerelease(left, right) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    if (left[index] === right[index]) continue;
    const leftNumber = /^\d+$/.test(left[index]);
    const rightNumber = /^\d+$/.test(right[index]);
    if (leftNumber && rightNumber) return Number(left[index]) > Number(right[index]) ? 1 : -1;
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
    return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) return null;
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] > right.core[index] ? 1 : -1;
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function isNewerVersion(candidate, currentVersion) {
  return compareVersions(candidate, currentVersion) === 1;
}

function findAvailableRelease(releases, currentVersion) {
  const current = parseVersion(currentVersion);
  if (!current || !Array.isArray(releases)) return {};
  const acceptsPrereleases = current.prerelease.length > 0;
  const candidates = releases
    .filter((release) => release && !release.draft)
    .map((release) => ({
      release,
      version: releaseVersion(release.tag_name || release.name),
    }))
    .filter(({ release, version }) => {
      const parsed = parseVersion(version);
      if (!parsed || !isNewerVersion(version, currentVersion)) return false;
      return acceptsPrereleases || (!release.prerelease && parsed.prerelease.length === 0);
    })
    .sort((left, right) => compareVersions(right.version, left.version));
  const selected = candidates[0];
  if (!selected) return {};
  const officialReleaseUrl = `https://github.com/hackerslairhq/desktop/releases/tag/v${selected.version}`;
  const suppliedReleaseUrl = String(selected.release.html_url || '');
  return {
    version: selected.version,
    releaseUrl: suppliedReleaseUrl.startsWith('https://github.com/hackerslairhq/desktop/releases/')
      ? suppliedReleaseUrl
      : officialReleaseUrl,
    releaseNotes: String(selected.release.body || '').trim(),
  };
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
  findAvailableRelease,
  isNewerVersion,
  managedTargetsRunning,
  releaseNotesForVersion,
  releaseVersion,
  updateStateForChannel,
};
