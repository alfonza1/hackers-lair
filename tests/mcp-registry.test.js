const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { listMcpServers } = require('../lib/mcp-registry');

test('MCP inventory reads user and project definitions without exposing environment values', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-mcp-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const claudeHome = path.join(root, 'claude');
  const project = path.join(root, 'project');
  fs.mkdirSync(claudeHome, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(claudeHome, 'settings.json'), JSON.stringify({
    mcpServers: {
      localDocs: { command: 'node', args: ['docs-server.js'], env: { SECRET: 'hidden' } },
    },
  }));
  fs.writeFileSync(path.join(project, '.mcp.json'), JSON.stringify({
    mcpServers: {
      remoteDocs: { type: 'http', url: 'https://example.invalid/mcp' },
    },
  }));

  const servers = listMcpServers({ claudeHome, projectFolders: [project] });
  assert.deepEqual(
    servers.map(({ name, transport, scope }) => ({ name, transport, scope })),
    [
      { name: 'localDocs', transport: 'stdio', scope: 'user' },
      { name: 'remoteDocs', transport: 'http', scope: 'project' },
    ],
  );
  assert.equal(servers[0].command, 'node');
  assert.equal(servers[0].estimatedTokens, 200);
  assert.doesNotMatch(JSON.stringify(servers), /hidden|SECRET/);
});

test('MCP inventory skips malformed configuration and missing roots', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-mcp-bad-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const claudeHome = path.join(root, 'claude');
  fs.mkdirSync(claudeHome);
  fs.writeFileSync(path.join(claudeHome, 'settings.json'), '{broken');
  assert.deepEqual(listMcpServers({ claudeHome }), []);
});
