const fs = require('fs');
const path = require('path');

const DETACHED_SHA_LENGTH = 7;

function gitDirectoryFor(directory) {
  if (!directory) return null;

  let current;
  try {
    current = path.resolve(directory);
    if (!fs.statSync(current).isDirectory()) return null;
  } catch {
    return null;
  }

  while (true) {
    const marker = path.join(current, '.git');
    try {
      const markerStats = fs.statSync(marker);
      if (markerStats.isDirectory()) return marker;
      if (markerStats.isFile()) {
        const match = fs.readFileSync(marker, 'utf8').trim().match(/^gitdir:\s*(.+)$/i);
        return match ? path.resolve(current, match[1]) : null;
      }
    } catch {
      // This directory is not a worktree root, so keep walking upward.
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function gitBranchForDirectory(directory) {
  const gitDirectory = gitDirectoryFor(directory);
  if (!gitDirectory) return null;

  try {
    const head = fs.readFileSync(path.join(gitDirectory, 'HEAD'), 'utf8').trim();
    const branch = head.match(/^ref:\s+refs\/heads\/(.+)$/);
    if (branch) return branch[1];
    if (/^[0-9a-f]{7,40}$/i.test(head)) return `detached @ ${head.slice(0, DETACHED_SHA_LENGTH)}`;
  } catch {
    // Treat unreadable or incomplete Git metadata as an uninitialized project.
  }
  return null;
}

function gitBranchesForProject(project) {
  const branches = new Set();
  for (const component of project.components || []) {
    const branch = gitBranchForDirectory(component.cwd);
    if (branch) branches.add(branch);
  }
  return [...branches];
}

module.exports = { gitBranchForDirectory, gitBranchesForProject, gitDirectoryFor };
