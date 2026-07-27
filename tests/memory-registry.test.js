const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { listMemoryEntries } = require('../lib/memory-registry');

test('memory registry lists project memory and marks entries stale after 90 days', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-memory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  const memory = path.join(project, '.claude', 'memory');
  fs.mkdirSync(memory, { recursive: true });
  const file = path.join(memory, 'decisions.md');
  fs.writeFileSync(file, '# Decisions');
  fs.utimesSync(file, new Date('2025-01-01'), new Date('2025-01-01'));
  const entries = listMemoryEntries({
    projectFolders: [project],
    now: new Date('2026-07-27'),
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].stale, true);
  assert.equal(entries[0].name, 'decisions.md');
});
