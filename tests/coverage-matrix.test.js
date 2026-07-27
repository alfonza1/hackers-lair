const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { projectCoverageMatrix } = require('../lib/coverage-matrix');

test('coverage matrix reports instructions, run/verify guidance, git, and components', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-coverage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Run with npm start. Verify with npm test.');
  const [row] = projectCoverageMatrix([{
    name: 'Fixture',
    components: [{ name: 'web', cwd: root }],
  }]);
  assert.equal(row.hasAgents, true);
  assert.equal(row.hasClaude, false);
  assert.equal(row.hasRunInstructions, true);
  assert.equal(row.hasVerifyInstructions, true);
  assert.equal(row.isGitRepo, true);
  assert.equal(row.componentCount, 1);
  assert.deepEqual(row.gaps, ['CLAUDE.md']);
});
