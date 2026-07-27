const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { listAgents } = require('../lib/agent-registry');

test('subagent inventory merges user and project scopes with frontmatter health', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-agents-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const claudeHome = path.join(root, 'claude');
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(claudeHome, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(project, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(claudeHome, 'agents', 'reviewer.md'), [
    '---',
    'name: reviewer',
    'description: Review repository changes for correctness and safety.',
    'tools: Read, Grep',
    'model: inherit',
    '---',
    '',
    '# Reviewer',
  ].join('\n'));
  fs.writeFileSync(path.join(project, '.claude', 'agents', 'weak.md'), [
    '---',
    'name: different-name',
    'description: short',
    '---',
  ].join('\n'));

  const agents = listAgents({ claudeHome, projectFolders: [project] });
  assert.deepEqual(
    agents.map(({ name, scope }) => ({ name, scope })),
    [
      { name: 'reviewer', scope: 'user' },
      { name: 'different-name', scope: 'project' },
    ],
  );
  assert.deepEqual(agents[0].tools, ['Read', 'Grep']);
  assert.equal(agents[0].model, 'inherit');
  assert.equal(agents[0].lint.level, 'ok');
  assert.deepEqual(
    agents[1].lint.findings.map((finding) => finding.code).sort(),
    ['description-short', 'name-file-mismatch'],
  );
  assert.ok(agents.every((agent) => !('file' in agent)));
});

test('subagent inventory tolerates absent and oversized sources', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-agents-empty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const agentsDirectory = path.join(root, 'claude', 'agents');
  fs.mkdirSync(agentsDirectory, { recursive: true });
  fs.writeFileSync(path.join(agentsDirectory, 'huge.md'), 'x'.repeat(600 * 1024));
  assert.deepEqual(listAgents({ claudeHome: path.join(root, 'claude') }), []);
  assert.deepEqual(listAgents({ claudeHome: path.join(root, 'missing') }), []);
});
