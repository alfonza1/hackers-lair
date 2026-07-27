const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const CACHE_TTL_MS = 5 * 60 * 1000;
const cacheEntries = new Map();

async function git(directory, args) {
  const { stdout } = await execFileAsync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

function normalizeGitPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\/+/, '');
}

function parseBatchedGitLog(stdout, requested) {
  const result = new Map();
  let commitDate = '';
  for (const rawLine of String(stdout || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('@@')) {
      const parsed = new Date(line.slice(2));
      commitDate = Number.isFinite(parsed.getTime()) ? parsed.toISOString() : line.slice(2);
      continue;
    }
    if (!line || !commitDate) continue;
    const file = normalizeGitPath(line);
    for (const item of requested) {
      const prefix = item.relativeDirectory.endsWith('/')
        ? item.relativeDirectory
        : `${item.relativeDirectory}/`;
      if (!result.has(item.id) && (file === item.relativeDirectory || file.startsWith(prefix))) {
        result.set(item.id, commitDate);
      }
    }
  }
  return result;
}

async function repositoryLocation(directory) {
  try {
    const output = await git(directory, ['rev-parse', '--show-toplevel', '--show-prefix']);
    const [root, ...prefixLines] = output.split(/\r?\n/);
    if (!root) return null;
    const relativeDirectory = normalizeGitPath(prefixLines.join('')).replace(/\/+$/, '') || '.';
    return {
      root: path.resolve(root),
      relativeDirectory,
    };
  } catch {
    return null;
  }
}

async function lastTouchedForSkills(skills, {
  cache = true,
  now = Date.now(),
} = {}) {
  const candidates = skills.filter((skill) => skill.id && skill.directory);
  if (!candidates.length) return new Map();
  const signature = candidates
    .map((skill) => `${skill.id}:${path.resolve(skill.directory)}`)
    .sort()
    .join('|');
  const cached = cacheEntries.get(signature);
  if (cache && cached && now - cached.at < CACHE_TTL_MS) return new Map(cached.value);

  const locations = await Promise.all(candidates.map(async (skill) => ({
    ...skill,
    repository: await repositoryLocation(skill.directory),
  })));
  const groups = new Map();
  for (const skill of locations.filter((item) => item.repository)) {
    const group = groups.get(skill.repository.root) || [];
    group.push({ id: skill.id, relativeDirectory: skill.repository.relativeDirectory });
    groups.set(skill.repository.root, group);
  }

  const result = new Map();
  await Promise.all([...groups.entries()].map(async ([root, requested]) => {
    try {
      const paths = requested.map((item) => item.relativeDirectory);
      const stdout = await git(root, [
        'log',
        '--format=@@%cI',
        '--name-only',
        '--',
        ...paths,
      ]);
      for (const [id, date] of parseBatchedGitLog(stdout, requested)) result.set(id, date);
    } catch {
      // Git metadata is optional; one broken repository must not hide skills.
    }
  }));
  cacheEntries.set(signature, { at: now, value: new Map(result) });
  return result;
}

module.exports = {
  CACHE_TTL_MS,
  lastTouchedForSkills,
  parseBatchedGitLog,
};
