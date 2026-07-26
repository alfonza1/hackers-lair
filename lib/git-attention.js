const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const ROOT_CACHE_TTL_MS = 60_000;
const rootCache = new Map();
const directorySnapshots = new Map();
let refreshInFlight = null;

async function runGit(directory, args) {
  const { stdout } = await execFileAsync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    timeout: 1_500,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}

async function repositoryRoot(directory) {
  if (!directory || !fs.existsSync(directory)) return null;
  const resolvedDirectory = path.resolve(directory);
  const cached = rootCache.get(resolvedDirectory);
  if (cached && Date.now() - cached.readAt < ROOT_CACHE_TTL_MS) return cached.root;
  try {
    const root = path.resolve(await runGit(resolvedDirectory, ['rev-parse', '--show-toplevel']));
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

async function repositoryStatus(directory) {
  const root = await repositoryRoot(directory);
  if (!root) return null;
  try {
    const output = await runGit(root, ['status', '--porcelain=v2', '--branch', '--untracked-files=normal']);
    let commitCount = 0;
    try {
      commitCount = Number(await runGit(root, ['rev-list', '--count', 'HEAD'])) || 0;
    } catch {
      // An initialized repository without a first commit has zero commits.
    }
    return { ...parsePorcelainStatus(output, root), commitCount };
  } catch {
    return null;
  }
}

function cachedRepositoryStatus(directory) {
  if (!directory) return null;
  return directorySnapshots.get(path.resolve(directory)) || null;
}

async function refreshGitAttention(projects) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const directories = [...new Set((projects || [])
      .flatMap((project) => project.components || [])
      .map((component) => component.cwd)
      .filter(Boolean)
      .map((directory) => path.resolve(directory)))];

    const statuses = await Promise.all(directories.map(async (directory) => ({
      directory,
      status: await repositoryStatus(directory),
    })));
    for (const { directory, status } of statuses) directorySnapshots.set(directory, status);
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

function summarizeRepositories(repositories) {
  const summary = {
    level: 'clean',
    dirtyRepositories: 0,
    changedPaths: 0,
    ahead: 0,
    behind: 0,
    localCommits: 0,
    withoutUpstream: 0,
    protectedBranchDirty: false,
    detached: false,
  };

  for (const repository of repositories) {
    if (repository.dirty) summary.dirtyRepositories += 1;
    summary.changedPaths += repository.changedPaths || 0;
    summary.ahead += repository.ahead || 0;
    summary.behind += repository.behind || 0;
    summary.localCommits += repository.commitCount || 0;
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

function gitAttentionForProject(project, resolveStatus = cachedRepositoryStatus) {
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
  refreshGitAttention,
  repositoryStatus,
  summarizeRepositories,
};
