const assert = require('node:assert/strict');
const test = require('node:test');
const { CACHE_TTL_MS, skillsRepoStatus } = require('../lib/skills-repo-status');

test('skills repo status reports dirty and unpublished counts from local Git only', async () => {
  const commands = [];
  const runGit = async (args) => {
    commands.push(args);
    if (args.includes('--show-toplevel')) return { stdout: 'C:/workspace\n' };
    if (args.includes('--porcelain')) return { stdout: ' M skills/a/SKILL.md\n?? skills/b/\n' };
    return { stdout: '3\n' };
  };
  const status = await skillsRepoStatus('C:/workspace/skills', { runGit, cache: false });
  assert.deepEqual(status, {
    available: true,
    root: 'C:/workspace',
    dirtyFiles: 2,
    unpushedCommits: 3,
    error: '',
  });
  assert.ok(commands.every((args) => !args.includes('fetch')));
});

test('skills repo status fails soft outside Git', async () => {
  const status = await skillsRepoStatus('missing', {
    runGit: async () => { throw new Error('not a repository'); },
    cache: false,
  });
  assert.equal(status.available, false);
  assert.match(status.error, /not a repository/);
});

test('skills repo status caches local Git work across frequent UI polls', async () => {
  let calls = 0;
  const runGit = async (args) => {
    calls += 1;
    if (args.includes('--show-toplevel')) return { stdout: 'C:/cache-test\n' };
    if (args.includes('--porcelain')) return { stdout: '' };
    return { stdout: '0\n' };
  };
  const options = { runGit, now: 1_000 };
  await skillsRepoStatus('C:/cache-test/skills', options);
  await skillsRepoStatus('C:/cache-test/skills', { ...options, now: 2_000 });
  assert.equal(calls, 3);
  await skillsRepoStatus('C:/cache-test/skills', {
    ...options,
    now: 1_000 + CACHE_TTL_MS,
  });
  assert.equal(calls, 6);
});
