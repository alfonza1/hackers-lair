const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { exportWorkflowBundle } = require('../lib/workflow-export');

test('workflow export copies skills, instructions, hook JSON, and a manifest', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-export-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const skills = path.join(root, 'skills');
  const instructions = path.join(root, 'AGENTS.md');
  fs.mkdirSync(path.join(skills, 'verify'), { recursive: true });
  fs.writeFileSync(path.join(skills, 'verify', 'SKILL.md'), '# Verify');
  const skillsLink = path.join(root, 'skills-link');
  fs.symlinkSync(skills, skillsLink, process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(instructions, '# Instructions');
  const result = exportWorkflowBundle({
    exportsDirectory: path.join(root, 'exports'),
    skillsDirectory: skillsLink,
    instructionFiles: [instructions],
    hooks: { PostToolUse: [] },
    now: new Date('2026-07-27T12:34:56Z'),
  });
  assert.ok(fs.existsSync(path.join(result.directory, 'skills', 'verify', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(result.directory, 'instructions', 'AGENTS.md')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.directory, 'hooks.json'))), {
    PostToolUse: [],
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.directory, 'manifest.json'))).version, 1);
});
