const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { workflowLinkHealth } = require('../lib/doctor');

test('Doctor link health verifies shared skill roots and linked instructions', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-links-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const agentsHome = path.join(root, '.agents');
  const claudeHome = path.join(root, '.claude');
  const skills = path.join(root, 'skills');
  fs.mkdirSync(agentsHome);
  fs.mkdirSync(claudeHome);
  fs.mkdirSync(skills);
  fs.symlinkSync(skills, path.join(agentsHome, 'skills'), 'junction');
  fs.symlinkSync(skills, path.join(claudeHome, 'skills'), 'junction');
  const first = path.join(root, 'AGENTS.md');
  const second = path.join(root, 'linked-AGENTS.md');
  fs.writeFileSync(first, '# Shared');
  fs.linkSync(first, second);
  const checks = workflowLinkHealth({
    agentsHome,
    claudeHome,
    instructionFiles: [first, second],
  });
  assert.equal(checks.find((check) => check.id === 'workflow-skill-links').level, 'pass');
  assert.equal(checks.find((check) => check.id === 'workflow-instruction-links').level, 'pass');
});
