const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { contextCost, estimateTokens } = require('../lib/context-cost');

test('token estimates use the documented characters divided by four rule', () => {
  assert.equal(estimateTokens('12345678'), 2);
  assert.equal(estimateTokens('12345'), 2);
  assert.equal(estimateTokens(''), 0);
});

test('context cost reports workspace, skill, memory, and MCP sources without network access', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-context-cost-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  const claudeHome = path.join(root, '.claude');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(path.join(claudeHome, 'projects', 'fixture', 'memory'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'AGENTS.md'), 'A'.repeat(40));
  fs.writeFileSync(path.join(workspace, '.mcp.json'), '{"mcpServers":{"local":{"command":"node"}}}');
  fs.writeFileSync(
    path.join(claudeHome, 'projects', 'fixture', 'memory', 'MEMORY.md'),
    'M'.repeat(20),
  );

  const result = contextCost({
    workspaceRoots: [workspace],
    skills: [{ name: 'verify', description: 'V'.repeat(16) }],
    claudeHome,
    warnTokens: 10,
  });
  assert.equal(result.warn, true);
  assert.ok(result.totalTokens >= 10 + 4 + 5);
  assert.deepEqual(
    [...new Set(result.sources.map((source) => source.kind))].sort(),
    ['instructions', 'mcp', 'memory', 'skill'].sort(),
  );
  assert.ok(result.sources.every((source) => !('content' in source)));
});
