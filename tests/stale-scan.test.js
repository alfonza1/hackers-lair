const assert = require('node:assert/strict');
const test = require('node:test');
const { scanStaleContent } = require('../lib/stale-scan');

test('stale scanner flags retired model ids, old dates, and old Node pins', () => {
  const findings = scanStaleContent(
    'Use claude-3-opus, Node 18, and review the 2023-01-10 guide.',
    { now: new Date('2026-07-27T00:00:00Z') },
  );
  assert.deepEqual(
    findings.map((finding) => finding.code).sort(),
    ['old-date', 'old-model-id', 'old-node-pin'],
  );
});

test('stale scanner stays quiet for current neutral instructions', () => {
  assert.deepEqual(scanStaleContent('Use the supported runtime and current model alias.'), []);
});
