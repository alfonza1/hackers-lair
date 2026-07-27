const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { listInstructions } = require('../lib/instruction-registry');

test('instruction registry deduplicates known roots and reports size and token cost', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-instructions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  const nested = path.join(project, 'client');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(project, 'AGENTS.md'), 'A'.repeat(40));
  fs.writeFileSync(path.join(nested, 'CLAUDE.md'), 'C'.repeat(20));

  const instructions = listInstructions({
    workspaceRoot: project,
    projectFolders: [nested, project],
    workspaceFolders: [project],
  });
  assert.deepEqual(instructions.map((item) => item.name), ['AGENTS.md', 'CLAUDE.md']);
  assert.deepEqual(instructions.map((item) => item.tokens), [10, 5]);
  assert.ok(instructions.every((item) => path.isAbsolute(item.path)));
  assert.ok(instructions.every((item) => item.id && item.modifiedAt));
});

test('instruction registry tolerates missing and unreadable roots', () => {
  assert.deepEqual(listInstructions({
    workspaceRoot: path.resolve('missing-workspace'),
    projectFolders: [],
    workspaceFolders: [],
  }), []);
});
