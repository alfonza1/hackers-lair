const assert = require('node:assert/strict');
const test = require('node:test');
const { skillsRepoStatus } = require('../lib/skills-repo-status');

test('skills repo status reports dirty and unpublished counts from local Git only', async () => {
  const commands = [];
  const runGit = async (args) => {
    commands.push(args);
    if (args.includes('--show-toplevel')) return { stdout: 'C:/workspace\n' };
    if (args.includes('--porcelain')) return { stdout: ' M skills/a/SKILL.md\n?? skills/b/\n' };
    return { stdout: '3\n' };
  };
  const status = await skillsRepoStatus('C:/workspace/skills', { runGit });
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
  });
  assert.equal(status.available, false);
  assert.match(status.error, /not a repository/);
});
