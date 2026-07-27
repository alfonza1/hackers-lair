const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  briefDescription,
  firstContentParagraph,
  frontmatterField,
} = require('./skill-registry');

const MAX_COMMAND_BYTES = 512 * 1024;
const MAX_COMMAND_DEPTH = 10;
const MAX_COMMAND_FILES = 500;
const DESCRIPTION_MIN_LENGTH = 20;

function nestedMarkdownFiles(root) {
  const files = [];
  const pending = [{ directory: root, depth: 0 }];
  while (pending.length && files.length < MAX_COMMAND_FILES) {
    const { directory, depth } = pending.pop();
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      const child = path.join(directory, entry.name);
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(child);
      else if (entry.isDirectory() && depth < MAX_COMMAND_DEPTH && !entry.name.startsWith('.')) {
        pending.push({ directory: child, depth: depth + 1 });
      }
      if (files.length >= MAX_COMMAND_FILES) break;
    }
  }
  return files;
}

function readCommand(file, root, metadata, { includeFiles = false } = {}) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_COMMAND_BYTES) return null;
    const source = fs.readFileSync(file, 'utf8');
    const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const frontmatter = match?.[1] || '';
    const body = match ? source.slice(match[0].length) : source;
    const relative = path.relative(root, file).slice(0, -3).split(path.sep).join('/');
    const rawDescription = frontmatterField(frontmatter, 'description')
      || firstContentParagraph(body);
    const findings = rawDescription.length >= DESCRIPTION_MIN_LENGTH
      ? []
      : [{
          code: rawDescription ? 'description-short' : 'description-missing',
          level: rawDescription ? 'warn' : 'error',
          message: rawDescription
            ? `Description is ${rawDescription.length} characters; use at least ${DESCRIPTION_MIN_LENGTH}.`
            : 'Command description is missing.',
        }];
    const record = {
      id: `command-${crypto.createHash('sha256').update(path.resolve(file)).digest('hex').slice(0, 20)}`,
      name: relative,
      description: briefDescription(rawDescription, relative),
      scope: metadata.scope,
      project: metadata.project || '',
      modifiedAt: stat.mtime.toISOString(),
      lint: {
        level: findings.some((finding) => finding.level === 'error')
          ? 'error'
          : findings.length ? 'warn' : 'ok',
        findings,
      },
    };
    return includeFiles ? { ...record, file } : record;
  } catch {
    return null;
  }
}

function listCommands({
  claudeHome,
  projectFolders = [],
  includeFiles = false,
} = {}) {
  const sources = [
    { root: path.join(path.resolve(claudeHome || ''), 'commands'), scope: 'user', project: '' },
    ...projectFolders.map((projectFolder) => ({
      root: path.join(path.resolve(projectFolder), '.claude', 'commands'),
      scope: 'project',
      project: path.basename(path.resolve(projectFolder)),
    })),
  ];
  return sources.flatMap((source) => (
    nestedMarkdownFiles(source.root)
      .map((file) => readCommand(file, source.root, source, { includeFiles }))
      .filter(Boolean)
  )).sort((left, right) => (
    Number(left.scope !== 'user') - Number(right.scope !== 'user')
    || left.name.localeCompare(right.name)
    || left.project.localeCompare(right.project)
  ));
}

module.exports = {
  MAX_COMMAND_BYTES,
  MAX_COMMAND_DEPTH,
  MAX_COMMAND_FILES,
  listCommands,
  nestedMarkdownFiles,
  readCommand,
};
