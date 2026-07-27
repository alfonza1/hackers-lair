const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  archiveSkill,
  listArchivedSkills,
  scaffoldSkill,
  unarchiveSkill,
} = require('../lib/skill-maintenance');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-skill-maintenance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    skillsRoot: path.join(root, '.agents', 'skills'),
    backupRoot: path.join(root, 'backups'),
  };
}

test('scaffold creates a lint-clean personal skill and rejects unsafe names', (t) => {
  const paths = fixture(t);
  const created = scaffoldSkill({ skillsRoot: paths.skillsRoot, name: 'release-helper' });
  assert.equal(created.name, 'release-helper');
  assert.ok(fs.existsSync(path.join(paths.skillsRoot, 'release-helper', 'SKILL.md')));
  assert.match(fs.readFileSync(created.skillFile, 'utf8'), /description:.{20,}/);
  assert.throws(
    () => scaffoldSkill({ skillsRoot: paths.skillsRoot, name: '../escape' }),
    /lowercase letters/i,
  );
  assert.throws(
    () => scaffoldSkill({ skillsRoot: paths.skillsRoot, name: 'release-helper' }),
    /already exists/i,
  );
});

test('archive and unarchive stay inside the personal root and snapshot before moves', (t) => {
  const paths = fixture(t);
  scaffoldSkill({ skillsRoot: paths.skillsRoot, name: 'archive-me' });
  const archived = archiveSkill({
    skillsRoot: paths.skillsRoot,
    backupRoot: paths.backupRoot,
    name: 'archive-me',
  });
  assert.ok(archived.backupDirectory);
  assert.ok(fs.existsSync(archived.backupDirectory));
  assert.equal(fs.existsSync(path.join(paths.skillsRoot, 'archive-me')), false);
  assert.deepEqual(listArchivedSkills(paths.skillsRoot).map((skill) => skill.name), ['archive-me']);

  const restored = unarchiveSkill({
    skillsRoot: paths.skillsRoot,
    backupRoot: paths.backupRoot,
    name: 'archive-me',
  });
  assert.ok(restored.backupDirectory);
  assert.ok(fs.existsSync(path.join(paths.skillsRoot, 'archive-me', 'SKILL.md')));
  assert.deepEqual(listArchivedSkills(paths.skillsRoot), []);
});

test('archive rejects traversal and a non-skill folder', (t) => {
  const paths = fixture(t);
  fs.mkdirSync(path.join(paths.skillsRoot, 'empty'), { recursive: true });
  assert.throws(() => archiveSkill({
    skillsRoot: paths.skillsRoot,
    backupRoot: paths.backupRoot,
    name: '..',
  }), /lowercase letters/i);
  assert.throws(() => archiveSkill({
    skillsRoot: paths.skillsRoot,
    backupRoot: paths.backupRoot,
    name: 'empty',
  }), /SKILL\.md/i);
});
