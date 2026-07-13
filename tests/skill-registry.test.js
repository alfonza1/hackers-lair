const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { listSkills, readSkillFile } = require('../lib/skill-registry');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hackers-lair-skills-'));
}

function writeSkill(skillFile, name, description) {
  fs.mkdirSync(path.dirname(skillFile), { recursive: true });
  fs.writeFileSync(skillFile, `---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n`);
}

test('reads skill metadata and keeps descriptions brief', (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const skillFile = path.join(root, 'SKILL.md');
  writeSkill(skillFile, 'workspace-audit', `${'Inspect the workspace carefully and report actionable findings. '.repeat(8)}`);

  const skill = readSkillFile(skillFile, 'fallback');
  assert.equal(skill.name, 'workspace-audit');
  assert.ok(skill.description.length <= 240);
  assert.match(skill.description, /^Inspect the workspace/);
});

test('lists personal skills separately for Claude and Codex', (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const codexHome = path.join(root, '.codex');
  const claudeHome = path.join(root, '.claude');
  writeSkill(path.join(codexHome, 'skills', 'release-check', 'SKILL.md'), 'release-check', 'Check whether a release is ready.');
  writeSkill(path.join(claudeHome, 'skills', 'review-notes', 'SKILL.md'), 'review-notes', 'Turn review notes into a concise checklist.');

  const personal = listSkills({ codexHome, claudeHome }).filter((skill) => skill.kind === 'personal');
  assert.deepEqual(personal.map(({ name, llm, invocation }) => ({ name, llm, invocation })), [
    { name: 'review-notes', llm: 'Claude', invocation: '/review-notes' },
    { name: 'release-check', llm: 'Codex', invocation: '$release-check' },
  ]);
  assert.ok(personal.every((skill) => !('path' in skill)));
});

test('discovers Codex system and plugin skills behind the default classification', (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const codexHome = path.join(root, '.codex');
  const claudeHome = path.join(root, '.claude');
  writeSkill(path.join(codexHome, 'skills', '.system', 'imagegen', 'SKILL.md'), 'imagegen', 'Generate bitmap artwork.');
  writeSkill(path.join(codexHome, 'plugins', 'cache', 'curated', 'github', '1.0.0', 'skills', 'publish', 'SKILL.md'), 'publish', 'Publish a branch through a pull request.');

  const defaults = listSkills({ codexHome, claudeHome }).filter((skill) => skill.llm === 'Codex');
  assert.deepEqual(defaults.map(({ name, kind, origin }) => ({ name, kind, origin })), [
    { name: 'github:publish', kind: 'default', origin: 'Plugin' },
    { name: 'imagegen', kind: 'default', origin: 'System' },
  ]);
});

test('rescans personal skill folders on every request', (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const codexHome = path.join(root, '.codex');
  const claudeHome = path.join(root, '.claude');
  assert.equal(listSkills({ codexHome, claudeHome }).filter((skill) => skill.kind === 'personal').length, 0);

  writeSkill(path.join(claudeHome, 'skills', 'new-skill', 'SKILL.md'), 'new-skill', 'A newly installed skill.');
  const personal = listSkills({ codexHome, claudeHome }).filter((skill) => skill.kind === 'personal');
  assert.equal(personal.length, 1);
  assert.equal(personal[0].name, 'new-skill');
});

test('includes the current Claude bundled skills as hidden defaults', (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));

  const defaults = listSkills({
    codexHome: path.join(root, '.codex'),
    claudeHome: path.join(root, '.claude'),
  }).filter((skill) => skill.llm === 'Claude' && skill.kind === 'default');

  assert.deepEqual(defaults.map((skill) => skill.name), [
    'batch',
    'claude-api',
    'code-review',
    'dataviz',
    'debug',
    'design-sync',
    'doctor',
    'fewer-permission-prompts',
    'loop',
    'run',
    'run-skill-generator',
    'simplify',
    'verify',
  ]);
  assert.ok(defaults.every((skill) => skill.description.length > 20));
});
