const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CACHE_TTL_MS = 8_000;
const ROOT_CACHE_TTL_MS = 60_000;
const rootCache = new Map();
const statusCache = new Map();

function runGit(directory, args) {
  return execFileSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 1_500,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  }).trim();
}

function repositoryRoot(directory) {
  if (!directory || !fs.existsSync(directory)) return null;
  const resolvedDirectory = path.resolve(directory);
  const cached = rootCache.get(resolvedDirectory);
  if (cached && Date.now() - cached.readAt < ROOT_CACHE_TTL_MS) return cached.root;
  try {
    const root = path.resolve(runGit(resolvedDirectory, ['rev-parse', '--show-toplevel']));
    rootCache.set(resolvedDirectory, { readAt: Date.now(), root });
    return root;
  } catch {
    rootCache.set(resolvedDirectory, { readAt: Date.now(), root: null });
    return null;
  }
}

function parsePorcelainStatus(output, root = '') {
  const status = {
    root,
    branch: '',
    detached: false,
    upstream: '',
    ahead: 0,
    behind: 0,
    dirty: false,
    changedPaths: 0,
  };

  for (const line of String(output || '').split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim();
      status.detached = head === '(detached)';
      status.branch = status.detached ? 'detached' : head;
    } else if (line.startsWith('# branch.upstream ')) {
      status.upstream = line.slice('# branch.upstream '.length).trim();
    } else if (line.startsWith('# branch.ab ')) {
      const match = line.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        status.ahead = Number(match[1]);
        status.behind = Number(match[2]);
      }
    } else if (/^(1|2|u|\?)\s/.test(line)) {
      status.changedPaths += 1;
    }
  }
  status.dirty = status.changedPaths > 0;
  return status;
}

function repositoryStatus(directory) {
  const root = repositoryRoot(directory);
  if (!root) return null;

  const cached = statusCache.get(root);
  if (cached && Date.now() - cached.readAt < CACHE_TTL_MS) return cached.value;

  try {
    const output = runGit(root, ['status', '--porcelain=v2', '--branch', '--untracked-files=normal']);
    const value = parsePorcelainStatus(output, root);
    statusCache.set(root, { readAt: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

function summarizeRepositories(repositories) {
  const summary = {
    level: 'clean',
    dirtyRepositories: 0,
    changedPaths: 0,
    ahead: 0,
    behind: 0,
    withoutUpstream: 0,
    protectedBranchDirty: false,
    detached: false,
  };

  for (const repository of repositories) {
    if (repository.dirty) summary.dirtyRepositories += 1;
    summary.changedPaths += repository.changedPaths || 0;
    summary.ahead += repository.ahead || 0;
    summary.behind += repository.behind || 0;
    if (!repository.upstream) summary.withoutUpstream += 1;
    if (repository.detached) summary.detached = true;
    if (repository.dirty && ['main', 'master'].includes(repository.branch)) {
      summary.protectedBranchDirty = true;
    }
  }

  if (summary.protectedBranchDirty || summary.detached) summary.level = 'critical';
  else if (summary.dirtyRepositories || summary.ahead || summary.behind || summary.withoutUpstream) summary.level = 'attention';
  return summary;
}

function gitAttentionForProject(project, resolveStatus = repositoryStatus) {
  const repositories = [];
  const seenRoots = new Set();
  for (const component of project.components || []) {
    const status = resolveStatus(component.cwd);
    if (!status || seenRoots.has(status.root)) continue;
    seenRoots.add(status.root);
    repositories.push(status);
  }
  return { repositories, summary: summarizeRepositories(repositories) };
}

module.exports = {
  gitAttentionForProject,
  parsePorcelainStatus,
  repositoryStatus,
  summarizeRepositories,
};
