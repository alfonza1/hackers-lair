const { findAvailableRelease } = require('./update-policy');

const RELEASES_URL = 'https://api.github.com/repos/hackerslairhq/desktop/releases?per_page=20';
const RELEASE_CHECK_TIMEOUT_MS = 10_000;

async function fetchAvailableRelease({
  currentVersion,
  fetchImpl = globalThis.fetch,
  timeoutMs = RELEASE_CHECK_TIMEOUT_MS,
}) {
  if (typeof fetchImpl !== 'function') throw new Error('Release checks require fetch support.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetchImpl(RELEASES_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Hackers-Lair-Desktop',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub release check returned HTTP ${response.status || 'error'}.`);
    return findAvailableRelease(await response.json(), currentVersion);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  fetchAvailableRelease,
  RELEASES_URL,
};
