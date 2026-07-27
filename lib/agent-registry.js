const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  briefDescription,
  firstContentParagraph,
  frontmatterField,
} = require('./skill-registry');

const MAX_AGENT_BYTES = 512 * 1024;
const DESCRIPTION_MIN_LENGTH = 20;

function fileId(file) {
  return crypto.createHash('sha256').update(path.resolve(file)).digest('hex').slice(0, 20);
}

function parseTools(value) {
  return String(value || '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((tool) => tool.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function lintAgent({ fileName, frontmatterName, description }) {
  const findings = [];
  if (!description) {
    findings.push({
      code: 'description-missing',
      level: 'error',
      message: 'Frontmatter description is missing or empty.',
    });
  } else if (description.length < DESCRIPTION_MIN_LENGTH) {
    findings.push({
      code: 'description-short',
      level: 'warn',
      message: `Description is ${description.length} characters; use at least ${DESCRIPTION_MIN_LENGTH}.`,
    });
  }
  if (!frontmatterName || frontmatterName !== fileName) {
    findings.push({
      code: 'name-file-mismatch',
      level: frontmatterName ? 'warn' : 'error',
      message: frontmatterName
        ? `Frontmatter name "${frontmatterName}" does not match file "${fileName}.md".`
        : 'Frontmatter name is missing.',
    });
  }
  return {
    level: findings.some((finding) => finding.level === 'error')
      ? 'error'
      : findings.length ? 'warn' : 'ok',
    findings,
  };
}

function readAgent(file, metadata, { includeFiles = false } = {}) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_AGENT_BYTES) return null;
    const source = fs.readFileSync(file, 'utf8');
    const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const frontmatter = match?.[1] || '';
    const body = match ? source.slice(match[0].length) : source;
    const fileName = path.basename(file, '.md');
    const frontmatterName = frontmatterField(frontmatter, 'name');
    const rawDescription = frontmatterField(frontmatter, 'description')
      || firstContentParagraph(body);
    const name = frontmatterName || fileName;
    const record = {
      id: `agent-${fileId(file)}`,
      name,
      description: briefDescription(rawDescription, name),
      tools: parseTools(frontmatterField(frontmatter, 'tools')),
      model: frontmatterField(frontmatter, 'model') || 'inherit',
      scope: metadata.scope,
      project: metadata.project || '',
      modifiedAt: stat.mtime.toISOString(),
      lint: lintAgent({ fileName, frontmatterName, description: rawDescription }),
    };
    return includeFiles ? { ...record, file } : record;
  } catch {
    return null;
  }
}

function markdownFiles(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

function listAgents({
  claudeHome,
  projectFolders = [],
  includeFiles = false,
} = {}) {
  const sources = [
    { directory: path.join(path.resolve(claudeHome || ''), 'agents'), scope: 'user', project: '' },
    ...projectFolders.map((projectFolder) => ({
      directory: path.join(path.resolve(projectFolder), '.claude', 'agents'),
      scope: 'project',
      project: path.basename(path.resolve(projectFolder)),
    })),
  ];
  return sources.flatMap((source) => (
    markdownFiles(source.directory)
      .map((file) => readAgent(file, source, { includeFiles }))
      .filter(Boolean)
  )).sort((left, right) => (
    Number(left.scope !== 'user') - Number(right.scope !== 'user')
    || left.name.localeCompare(right.name)
    || left.project.localeCompare(right.project)
  ));
}

module.exports = {
  MAX_AGENT_BYTES,
  lintAgent,
  listAgents,
  parseTools,
  readAgent,
};
