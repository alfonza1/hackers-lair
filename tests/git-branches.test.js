const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { gitBranchForDirectory, gitBranchesForProject } = require('../lib/git-branches');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hackers-lair-git-'));
}

test('finds the checked-out branch from a nested project directory', (t) => {
  const project = temporaryDirectory();
  t.after(() => fs.rmSync(project, { force: true, recursive: true }));
  fs.mkdirSync(path.join(project, '.git'));
  fs.writeFileSync(path.join(project, '.git', 'HEAD'), 'ref: refs/heads/feature/status-panel\n');
  const nested = path.join(project, 'apps', 'desktop');
  fs.mkdirSync(nested, { recursive: true });

  assert.equal(gitBranchForDirectory(nested), 'feature/status-panel');
});

test('supports Git worktrees whose .git marker points elsewhere', (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const worktree = path.join(root, 'worktree');
  const metadata = path.join(root, 'metadata');
  fs.mkdirSync(worktree);
  fs.mkdirSync(metadata);
  fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: ../metadata\n');
  fs.writeFileSync(path.join(metadata, 'HEAD'), 'ref: refs/heads/chore/worktree-check\n');

  assert.equal(gitBranchForDirectory(worktree), 'chore/worktree-check');
});

test('reports detached HEADs and ignores non-Git directories', (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const repository = path.join(root, 'repository');
  const plainDirectory = path.join(root, 'plain');
  fs.mkdirSync(path.join(repository, '.git'), { recursive: true });
  fs.mkdirSync(plainDirectory);
  fs.writeFileSync(path.join(repository, '.git', 'HEAD'), '1234567890abcdef1234567890abcdef12345678\n');

  assert.equal(gitBranchForDirectory(repository), 'detached @ 1234567');
  assert.equal(gitBranchForDirectory(plainDirectory), null);
});

test('deduplicates branches shared by project components', (t) => {
  const first = temporaryDirectory();
  const second = temporaryDirectory();
  t.after(() => fs.rmSync(first, { force: true, recursive: true }));
  t.after(() => fs.rmSync(second, { force: true, recursive: true }));
  fs.mkdirSync(path.join(first, '.git'));
  fs.mkdirSync(path.join(second, '.git'));
  fs.mkdirSync(path.join(first, 'client'));
  fs.writeFileSync(path.join(first, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(second, '.git', 'HEAD'), 'ref: refs/heads/release/candidate\n');

  assert.deepEqual(gitBranchesForProject({ components: [
    { cwd: first },
    { cwd: path.join(first, 'client') },
    { cwd: second },
  ] }), ['main', 'release/candidate']);
});
