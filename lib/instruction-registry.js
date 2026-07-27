const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { estimateTokens } = require('./context-cost');

const INSTRUCTION_FILENAMES = ['AGENTS.md', 'CLAUDE.md'];

function instructionId(file) {
  return crypto.createHash('sha256').update(path.resolve(file)).digest('hex').slice(0, 20);
}

function listInstructions({
  workspaceRoot = '',
  projectFolders = [],
  workspaceFolders = [],
} = {}) {
  const roots = [...new Set([
    workspaceRoot,
    ...projectFolders,
    ...workspaceFolders,
  ].filter(Boolean).map((root) => path.resolve(root)))];
  const records = new Map();
  for (const root of roots) {
    for (const name of INSTRUCTION_FILENAMES) {
      const file = path.join(root, name);
      try {
        const stat = fs.statSync(file);
        if (!stat.isFile()) continue;
        const content = fs.readFileSync(file, 'utf8');
        const resolved = fs.realpathSync(file);
        records.set(resolved, {
          id: instructionId(resolved),
          name,
          path: resolved,
          directory: path.dirname(resolved),
          size: stat.size,
          tokens: estimateTokens(content),
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch {
        // Optional or unreadable instruction roots are skipped independently.
      }
    }
  }
  return [...records.values()].sort((left, right) => (
    left.path.localeCompare(right.path) || left.name.localeCompare(right.name)
  ));
}

module.exports = {
  INSTRUCTION_FILENAMES,
  instructionId,
  listInstructions,
};
