const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { lastTouchedForSkills } = require('../lib/skill-git');

test('git age resolves the latest commit for each personal skill in one repository', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-skill-git-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: root, windowsHide: true });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  const skillDirectory = path.join(root, 'skills', 'verify');
  fs.mkdirSync(skillDirectory, { recursive: true });
  fs.writeFileSync(path.join(skillDirectory, 'SKILL.md'), '# verify');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'add fixture skill'], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-06-01T12:00:00Z',
      GIT_COMMITTER_DATE: '2026-06-01T12:00:00Z',
    },
  });

  const result = await lastTouchedForSkills([{
    id: 'verify',
    directory: skillDirectory,
  }], { cache: false });
  assert.equal(result.get('verify'), '2026-06-01T12:00:00.000Z');
});

test('git age fails soft outside a repository', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-skill-nogit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(
    [...(await lastTouchedForSkills([{ id: 'none', directory: root }], { cache: false })).entries()],
    [],
  );
});
