const fs = require('fs');
const path = require('path');

const MAX_CONTEXT_SOURCE_BYTES = 512 * 1024;
const MAX_MEMORY_FILES = 100;

function estimateTokens(value) {
  const length = String(value || '').length;
  return length ? Math.ceil(length / 4) : 0;
}

function readableFile(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size <= MAX_CONTEXT_SOURCE_BYTES;
  } catch {
    return false;
  }
}

function sourceRecord(kind, label, file, content) {
  return {
    kind,
    label,
    path: file,
    chars: content.length,
    tokens: estimateTokens(content),
  };
}

function addFileSource(sources, seen, kind, label, file, transform = (value) => value) {
  const resolved = path.resolve(file);
  if (seen.has(resolved) || !readableFile(resolved)) return;
  try {
    const content = transform(fs.readFileSync(resolved, 'utf8'));
    if (!content) return;
    seen.add(resolved);
    sources.push(sourceRecord(kind, label, resolved, content));
  } catch {
    // A malformed or concurrently removed optional source contributes nothing.
  }
}

function nestedFiles(root, filenamePattern, limit = MAX_MEMORY_FILES) {
  if (!root || !fs.existsSync(root)) return [];
  const files = [];
  const pending = [root];
  while (pending.length && files.length < limit) {
    const directory = pending.pop();
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && filenamePattern.test(entry.name)) files.push(target);
      if (files.length >= limit) break;
    }
  }
  return files;
}

function mcpOnly(source) {
  try {
    const parsed = JSON.parse(source);
    const mcp = parsed.mcpServers || parsed.mcp || parsed.servers;
    return mcp && typeof mcp === 'object' ? JSON.stringify(mcp) : '';
  } catch {
    return '';
  }
}

function contextCost({
  workspaceRoots = [],
  skills = [],
  claudeHome = '',
  codexHome = '',
  warnTokens = 8000,
} = {}) {
  const sources = [];
  const seen = new Set();
  for (const workspace of [...new Set(workspaceRoots.filter(Boolean).map((value) => path.resolve(value)))]) {
    addFileSource(sources, seen, 'instructions', 'Workspace AGENTS.md', path.join(workspace, 'AGENTS.md'));
    addFileSource(sources, seen, 'mcp', 'Workspace MCP config', path.join(workspace, '.mcp.json'), mcpOnly);
  }
  for (const skill of skills) {
    const description = String(skill.description || '');
    if (!description) continue;
    sources.push({
      kind: 'skill',
      label: skill.name,
      path: skill.skillFile || '',
      chars: description.length,
      tokens: estimateTokens(description),
    });
  }
  for (const memoryFile of nestedFiles(path.join(claudeHome, 'projects'), /\.md$/i)) {
    if (!/[\\/]memory[\\/]/i.test(memoryFile)) continue;
    addFileSource(sources, seen, 'memory', 'Claude memory', memoryFile);
  }
  addFileSource(sources, seen, 'mcp', 'Claude settings MCP config', path.join(claudeHome, 'settings.json'), mcpOnly);
  addFileSource(sources, seen, 'mcp', 'Claude user MCP config', `${claudeHome}.json`, mcpOnly);
  addFileSource(sources, seen, 'mcp', 'Codex MCP config', path.join(codexHome, 'config.json'), mcpOnly);

  const totalTokens = sources.reduce((sum, source) => sum + source.tokens, 0);
  return {
    totalTokens,
    warn: totalTokens >= Math.max(1, Number(warnTokens) || 8000),
    warnTokens: Math.max(1, Number(warnTokens) || 8000),
    sources,
  };
}

module.exports = {
  MAX_CONTEXT_SOURCE_BYTES,
  contextCost,
  estimateTokens,
};
