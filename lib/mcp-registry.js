const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MCP_CONTEXT_ESTIMATE_TOKENS = 200;

function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function serverDefinitions(value) {
  const definitions = value?.mcpServers;
  return definitions && typeof definitions === 'object' && !Array.isArray(definitions)
    ? definitions
    : {};
}

function listMcpServers({
  claudeHome,
  projectFolders = [],
} = {}) {
  const resolvedClaudeHome = path.resolve(claudeHome || '');
  const sources = [
    { file: path.join(resolvedClaudeHome, 'settings.json'), scope: 'user', project: '' },
    { file: path.join(path.dirname(resolvedClaudeHome), '.claude.json'), scope: 'user', project: '' },
    ...projectFolders.map((projectFolder) => ({
      file: path.join(path.resolve(projectFolder), '.mcp.json'),
      scope: 'project',
      project: path.basename(path.resolve(projectFolder)),
    })),
  ];
  const records = [];
  for (const source of sources) {
    const config = readJson(source.file);
    for (const [name, definition] of Object.entries(serverDefinitions(config))) {
      if (!definition || typeof definition !== 'object' || Array.isArray(definition)) continue;
      const transport = definition.type === 'http' || definition.type === 'sse' || definition.url
        ? String(definition.type || 'http')
        : 'stdio';
      records.push({
        id: `mcp-${crypto.createHash('sha256').update(`${source.file}:${name}`).digest('hex').slice(0, 20)}`,
        name,
        transport,
        command: transport === 'stdio' ? String(definition.command || '') : '',
        scope: source.scope,
        project: source.project,
        source: path.basename(source.file),
        estimatedTokens: MCP_CONTEXT_ESTIMATE_TOKENS,
      });
    }
  }
  return records.sort((left, right) => (
    Number(left.scope !== 'user') - Number(right.scope !== 'user')
    || left.name.localeCompare(right.name)
    || left.project.localeCompare(right.project)
  ));
}

module.exports = {
  MCP_CONTEXT_ESTIMATE_TOKENS,
  listMcpServers,
  readJson,
  serverDefinitions,
};
