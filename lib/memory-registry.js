const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MEMORY_STALE_DAYS = 90;
const MAX_MEMORY_FILES = 500;

function memoryFiles(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
      .slice(0, MAX_MEMORY_FILES)
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

function listMemoryEntries({
  projectFolders = [],
  now = new Date(),
} = {}) {
  const sources = [
    ...projectFolders.map((projectFolder) => ({
      directory: path.join(path.resolve(projectFolder), '.claude', 'memory'),
      project: path.basename(path.resolve(projectFolder)),
      scope: 'project',
    })),
  ];
  return sources.flatMap((source) => memoryFiles(source.directory).map((file) => {
    const stat = fs.statSync(file);
    const ageDays = Math.floor((now.getTime() - stat.mtimeMs) / 86_400_000);
    return {
      id: `memory-${crypto.createHash('sha256').update(file).digest('hex').slice(0, 20)}`,
      name: path.basename(file),
      project: source.project,
      scope: source.scope,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      ageDays: Math.max(0, ageDays),
      stale: ageDays > MEMORY_STALE_DAYS,
    };
  })).sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

module.exports = {
  MEMORY_STALE_DAYS,
  listMemoryEntries,
};
