const { execFile } = require('child_process');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const CACHE_TTL_MS = 30_000;
const cacheEntries = new Map();

async function defaultRunGit(args) {
  return execFileAsync('git', args, {
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true,
  });
}

async function skillsRepoStatus(skillsDirectory, {
  runGit = defaultRunGit,
  cache = true,
  now = Date.now(),
} = {}) {
  const cacheKey = path.resolve(skillsDirectory);
  const cached = cacheEntries.get(cacheKey);
  if (cache && cached && now - cached.at < CACHE_TTL_MS) return { ...cached.value };
  try {
    const root = (await runGit(['-C', skillsDirectory, 'rev-parse', '--show-toplevel'])).stdout.trim();
    const status = (await runGit(['-C', root, 'status', '--porcelain'])).stdout;
    let unpushedCommits = 0;
    try {
      const output = await runGit(['-C', root, 'rev-list', '--count', '@{upstream}..HEAD']);
      unpushedCommits = Number.parseInt(output.stdout.trim(), 10) || 0;
    } catch {
      // A repository without an upstream has no comparable unpublished count.
    }
    const value = {
      available: true,
      root,
      dirtyFiles: status.split(/\r?\n/).filter(Boolean).length,
      unpushedCommits,
      error: '',
    };
    cacheEntries.set(cacheKey, { at: now, value });
    return { ...value };
  } catch (error) {
    const value = {
      available: false,
      root: '',
      dirtyFiles: 0,
      unpushedCommits: 0,
      error: error.message,
    };
    cacheEntries.set(cacheKey, { at: now, value });
    return { ...value };
  }
}

module.exports = { CACHE_TTL_MS, skillsRepoStatus };
