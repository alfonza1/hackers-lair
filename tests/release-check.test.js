const assert = require('node:assert/strict');
const test = require('node:test');

const { fetchAvailableRelease } = require('../lib/release-check');

test('passive release check reads official GitHub releases without installing', async () => {
  let request = null;
  const release = await fetchAvailableRelease({
    currentVersion: '2.1.0-beta.2',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => [{
          tag_name: 'v2.1.0-beta.3',
          prerelease: true,
          draft: false,
          html_url: 'https://github.com/hackerslairhq/desktop/releases/tag/v2.1.0-beta.3',
          body: 'A quiet update notice.',
        }],
      };
    },
  });

  assert.equal(
    request.url,
    'https://api.github.com/repos/hackerslairhq/desktop/releases?per_page=20',
  );
  assert.equal(request.options.headers.Accept, 'application/vnd.github+json');
  assert.equal(release.version, '2.1.0-beta.3');
  assert.equal(release.releaseNotes, 'A quiet update notice.');
});
