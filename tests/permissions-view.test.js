const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { permissionsView } = require('../lib/permissions-view');

test('permissions view reports merged rules, duplicates, and allow-deny shadows', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-permissions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const claudeHome = path.join(root, 'claude');
  const project = path.join(root, 'project');
  fs.mkdirSync(claudeHome, { recursive: true });
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(claudeHome, 'settings.json'), JSON.stringify({
    permissions: { allow: ['Read', 'Bash(npm test)'], deny: ['WebFetch'] },
  }));
  fs.writeFileSync(path.join(project, '.claude', 'settings.json'), JSON.stringify({
    permissions: { allow: ['Read'], deny: ['Bash(npm test)'] },
  }));
  fs.writeFileSync(path.join(project, '.claude', 'settings.local.json'), JSON.stringify({
    permissions: { allow: ['Read'] },
  }));

  const view = permissionsView({ claudeHome, projectFolders: [project] });
  assert.equal(view.rules.length, 6);
  assert.ok(view.findings.some((finding) => finding.code === 'duplicate-rule' && finding.rule === 'Read'));
  assert.ok(view.findings.some(
    (finding) => finding.code === 'shadowed-rule' && finding.rule === 'Bash(npm test)',
  ));
  assert.ok(view.rules.every((rule) => ['user', 'project', 'project-local'].includes(rule.scope)));
});

test('permissions view fails soft on malformed files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-permissions-bad-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'claude'));
  fs.writeFileSync(path.join(root, 'claude', 'settings.json'), '{bad');
  assert.deepEqual(permissionsView({ claudeHome: path.join(root, 'claude') }), {
    rules: [],
    findings: [],
  });
});
