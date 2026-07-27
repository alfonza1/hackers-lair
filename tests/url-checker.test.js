const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { checkFileUrls, extractHttpUrls } = require('../lib/url-checker');

test('URL checker is explicit, HEAD-only, and caches results for seven days', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-urls-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'SKILL.md');
  const cacheFile = path.join(root, 'cache.json');
  fs.writeFileSync(file, 'See https://example.invalid/guide and https://example.invalid/guide.');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { status: 204, ok: true };
  };
  const first = await checkFileUrls(file, { cacheFile, fetchImpl });
  const second = await checkFileUrls(file, { cacheFile, fetchImpl });
  assert.equal(first.results.length, 1);
  assert.equal(second.results[0].cached, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'HEAD');
  assert.equal(calls[0].options.redirect, 'follow');
});

test('URL extraction accepts only HTTP and HTTPS links', () => {
  assert.deepEqual(
    extractHttpUrls('https://example.com/a ftp://example.com/b http://localhost:3000/x).'),
    ['https://example.com/a', 'http://localhost:3000/x'],
  );
});
