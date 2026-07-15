const assert = require('node:assert/strict');
const test = require('node:test');

const {
  gitAttentionForProject,
  parsePorcelainStatus,
  summarizeRepositories,
} = require('../lib/git-attention');

test('parses branch tracking and changed paths from porcelain v2', () => {
  const status = parsePorcelainStatus([
    '# branch.oid abc123',
    '# branch.head feature/git-attention',
    '# branch.upstream origin/feature/git-attention',
    '# branch.ab +3 -2',
    '1 .M N... 100644 100644 100644 abc abc app.js',
    '? notes.txt',
  ].join('\n'), 'C:\\Code\\app');

  assert.deepEqual(status, {
    root: 'C:\\Code\\app',
    branch: 'feature/git-attention',
    detached: false,
    upstream: 'origin/feature/git-attention',
    ahead: 3,
    behind: 2,
    dirty: true,
    changedPaths: 2,
  });
});

test('treats dirty protected branches and detached heads as critical', () => {
  const summary = summarizeRepositories([
    { branch: 'main', dirty: true, changedPaths: 2, ahead: 0, behind: 0, upstream: 'origin/main' },
    { branch: 'detached', detached: true, dirty: false, changedPaths: 0, ahead: 0, behind: 0, upstream: '' },
  ]);

  assert.equal(summary.level, 'critical');
  assert.equal(summary.protectedBranchDirty, true);
  assert.equal(summary.detached, true);
});

test('deduplicates components that belong to the same repository', () => {
  const status = { root: 'C:\\Code\\app', branch: 'feature/x', dirty: false, changedPaths: 0, upstream: 'origin/feature/x' };
  const result = gitAttentionForProject({ components: [{ cwd: 'client' }, { cwd: 'server' }] }, () => status);
  assert.equal(result.repositories.length, 1);
  assert.equal(result.summary.level, 'clean');
});
