const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { listSkills, readSkillFile, skillRoots } = require('../lib/skill-registry');

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

test('lists personal skills from the shared workspace agent folder', (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const agentsHome = path.join(root, '.agents');
  const codexHome = path.join(root, '.codex');
  const claudeHome = path.join(root, '.claude');
  writeSkill(path.join(agentsHome, 'skills', 'release-check', 'SKILL.md'), 'release-check', 'Check whether a release is ready.');
  writeSkill(path.join(agentsHome, 'skills', 'review-notes', 'SKILL.md'), 'review-notes', 'Turn review notes into a concise checklist.');
  writeSkill(path.join(codexHome, 'skills', 'legacy-codex', 'SKILL.md'), 'legacy-codex', 'Should not be listed as personal.');
  writeSkill(path.join(claudeHome, 'skills', 'legacy-claude', 'SKILL.md'), 'legacy-claude', 'Should not be listed as personal.');

  const personal = listSkills({
    agentsHome,
    codexHome,
    claudeHome,
  }).filter((skill) => skill.kind === 'personal');
  assert.deepEqual(personal.map(({ name, origin }) => ({ name, origin })), [
    { name: 'release-check', origin: 'Workspace' },
    { name: 'review-notes', origin: 'Workspace' },
  ]);
  assert.ok(personal.every((skill) => !('path' in skill) && !('llm' in skill) && !('invocation' in skill)));

  const internal = listSkills({
    agentsHome,
    codexHome,
    claudeHome,
    includeFiles: true,
  }).find((skill) => skill.name === 'release-check');
  assert.equal(internal.directory, path.join(agentsHome, 'skills', 'release-check'));
  assert.equal(internal.skillFile, path.join(agentsHome, 'skills', 'release-check', 'SKILL.md'));
  assert.equal(internal.skillsRoot, path.join(agentsHome, 'skills'));
});

test('lists personal skills linked into the shared folder', (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const agentsHome = path.join(root, '.agents');
  const sourceSkill = path.join(root, 'sources', 'linked-check');
  const linkedSkill = path.join(agentsHome, 'skills', 'linked-check');
  writeSkill(
    path.join(sourceSkill, 'SKILL.md'),
    'linked-check',
    'Verify a reusable workflow linked from its canonical source directory.',
  );
  fs.mkdirSync(path.dirname(linkedSkill), { recursive: true });
  fs.symlinkSync(sourceSkill, linkedSkill, process.platform === 'win32' ? 'junction' : 'dir');

  const personal = listSkills({
    agentsHome,
    codexHome: path.join(root, '.codex'),
    claudeHome: path.join(root, '.claude'),
    includeFiles: true,
  }).filter((skill) => skill.kind === 'personal');

  assert.deepEqual(personal.map((skill) => skill.name), ['linked-check']);
  assert.equal(fs.realpathSync(personal[0].directory), fs.realpathSync(sourceSkill));
  assert.equal(personal[0].skillsRoot, path.join(agentsHome, 'skills'));
});

test('skill roots expose the same environment resolution used by the registry', () => {
  const roots = skillRoots({
    agentsHome: path.resolve('agents'),
    codexHome: path.resolve('codex'),
    claudeHome: path.resolve('claude'),
  });
  assert.equal(roots.personalSkills, path.join(path.resolve('agents'), 'skills'));
  assert.equal(roots.claudeSkills, path.join(path.resolve('claude'), 'skills'));
  assert.equal(roots.codexPluginCache, path.join(path.resolve('codex'), 'plugins', 'cache'));
  assert.equal(roots.claudePluginCache, path.join(path.resolve('claude'), 'plugins', 'cache'));
});

test('shared user skill roots expose every harness without duplicate cards', (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  writeSkill(
    path.join(root, 'skills', 'shared-check', 'SKILL.md'),
    'shared-check',
    'Check a shared workflow from every configured harness.',
  );
  const records = listSkills({
    agentsHome: root,
    codexHome: root,
    claudeHome: root,
  }).filter((skill) => skill.name === 'shared-check');
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].harnesses.sort(), ['agents', 'claude', 'codex']);
  assert.equal(records[0].kind, 'personal');
});

test('discovers Codex system and plugin skills behind the default classification', (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const codexHome = path.join(root, '.codex');
  const claudeHome = path.join(root, '.claude');
  writeSkill(path.join(codexHome, 'skills', '.system', 'imagegen', 'SKILL.md'), 'imagegen', 'Generate bitmap artwork.');
  writeSkill(path.join(codexHome, 'plugins', 'cache', 'curated', 'github', '1.0.0', 'skills', 'publish', 'SKILL.md'), 'publish', 'Publish a branch through a pull request.');

  const defaults = listSkills({ agentsHome: path.join(root, '.agents'), codexHome, claudeHome })
    .filter((skill) => ['Plugin', 'System'].includes(skill.origin));
  assert.deepEqual(defaults.map(({ name, kind, origin }) => ({ name, kind, origin })), [
    { name: 'github:publish', kind: 'default', origin: 'Plugin' },
    { name: 'imagegen', kind: 'default', origin: 'System' },
  ]);
});

test('rescans personal skill folders on every request', (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const agentsHome = path.join(root, '.agents');
  const codexHome = path.join(root, '.codex');
  const claudeHome = path.join(root, '.claude');
  assert.equal(listSkills({ agentsHome, codexHome, claudeHome }).filter((skill) => skill.kind === 'personal').length, 0);

  writeSkill(path.join(agentsHome, 'skills', 'new-skill', 'SKILL.md'), 'new-skill', 'A newly installed skill.');
  const personal = listSkills({ agentsHome, codexHome, claudeHome }).filter((skill) => skill.kind === 'personal');
  assert.equal(personal.length, 1);
  assert.equal(personal[0].name, 'new-skill');
});

test('includes the current Claude bundled skills as hidden defaults', (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));

  const defaults = listSkills({
    agentsHome: path.join(root, '.agents'),
    codexHome: path.join(root, '.codex'),
    claudeHome: path.join(root, '.claude'),
  }).filter((skill) => skill.kind === 'default' && skill.origin === 'Bundled');

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
