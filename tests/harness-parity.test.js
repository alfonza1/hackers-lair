const assert = require('node:assert/strict');
const test = require('node:test');
const { harnessParity } = require('../lib/harness-parity');

test('harness parity flags skills visible to only one harness', () => {
  const parity = harnessParity([
    { name: 'shared', harnesses: ['agents', 'codex'] },
    { name: 'claude-only', harnesses: ['claude'] },
  ]);
  assert.deepEqual(parity.counts, { agents: 1, claude: 1, codex: 1 });
  assert.deepEqual(parity.exclusive, [{ name: 'claude-only', harness: 'claude' }]);
});
