const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_SCAN_DEPTH = 10;
const MAX_DESCRIPTION_LENGTH = 240;

const CLAUDE_BUNDLED_SKILLS = [
  { name: 'batch', description: 'Break a large repository change into parallel worktree tasks and coordinate the resulting pull requests.' },
  { name: 'claude-api', description: 'Load Claude API guidance, migrate SDK integrations, and onboard Managed Agents.' },
  { name: 'code-review', description: 'Review a diff for correctness, reuse, simplification, and efficiency, with optional fixes or PR comments.' },
  { name: 'dataviz', description: 'Apply chart, dashboard, palette, interaction, and accessibility guidance to data visualizations.' },
  { name: 'debug', description: 'Enable session debug logging and investigate Claude Code runtime problems.' },
  { name: 'design-sync', description: "Upload a React design system so Claude-generated designs can use the project's real components." },
  { name: 'doctor', description: 'Diagnose Claude Code installation, configuration, skill, plugin, hook, and context-cost issues.' },
  { name: 'fewer-permission-prompts', description: 'Find common read-only commands in transcripts and add a prioritized allowlist to the project Claude settings.' },
  { name: 'loop', description: 'Run a prompt repeatedly on an interval or let Claude pace recurring maintenance work.' },
  { name: 'run', description: 'Launch and drive the project application to verify changes in the real running interface.' },
  { name: 'run-skill-generator', description: 'Create project instructions that teach the run and verify skills how to build, launch, and drive the application.' },
  { name: 'simplify', description: 'Review changed code for cleanup, reuse, efficiency, and abstraction improvements, then apply fixes.' },
  { name: 'verify', description: 'Build, run, and observe the application to confirm behavior beyond tests and type checks.' },
];

function stripQuotes(value) {
  const trimmed = String(value || '').trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed); } catch { return trimmed.slice(1, -1); }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

function frontmatterField(frontmatter, field) {
  const lines = frontmatter.split(/\r?\n/);
  const fieldPattern = new RegExp(`^${field}:\\s*(.*)$`);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(fieldPattern);
    if (!match) continue;
    const value = match[1].trim();
    if (!['>', '>-', '|', '|-'].includes(value)) return stripQuotes(value);

    const continuation = [];
    for (let next = index + 1; next < lines.length && /^\s+/.test(lines[next]); next += 1) {
      continuation.push(lines[next].trim());
    }
    return continuation.join(value.startsWith('>') ? ' ' : '\n').trim();
  }
  return '';
}

function firstContentParagraph(markdown) {
  return markdown
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim())
    .find((paragraph) => paragraph && !paragraph.startsWith('```')) || '';
}

function briefDescription(value, skillName) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
    || `Reusable instructions for ${skillName}.`;
  if (text.length <= MAX_DESCRIPTION_LENGTH) return text;
  const sentenceEnd = text.lastIndexOf('.', MAX_DESCRIPTION_LENGTH);
  if (sentenceEnd >= Math.floor(MAX_DESCRIPTION_LENGTH * 0.55)) return text.slice(0, sentenceEnd + 1);
  const truncated = text.slice(0, MAX_DESCRIPTION_LENGTH - 1);
  const wordEnd = truncated.lastIndexOf(' ');
  return `${truncated.slice(0, wordEnd > 0 ? wordEnd : truncated.length).trimEnd()}...`;
}

function readSkillFile(skillFile, fallbackName) {
  try {
    const content = fs.readFileSync(skillFile, 'utf8');
    const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
    const frontmatter = match?.[1] || '';
    const body = match ? content.slice(match[0].length) : content;
    const name = frontmatterField(frontmatter, 'name') || fallbackName;
    const description = frontmatterField(frontmatter, 'description') || firstContentParagraph(body);
    return {
      name,
      description: briefDescription(description, name),
      modifiedAt: fs.statSync(skillFile).mtimeMs,
    };
  } catch {
    return null;
  }
}

function personalSkillFiles(skillsDirectory) {
  try {
    return fs.readdirSync(skillsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => path.join(skillsDirectory, entry.name, 'SKILL.md'))
      .filter((skillFile) => fs.existsSync(skillFile));
  } catch {
    return [];
  }
}

function projectSkillRecords(workspaceRoot) {
  try {
    return fs.readdirSync(workspaceRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .flatMap((entry) => {
        const skillsDirectory = path.join(workspaceRoot, entry.name, '.agents', 'skills');
        return recordsFromFiles(personalSkillFiles(skillsDirectory), () => ({
          kind: 'personal',
          origin: `Project: ${entry.name}`,
        }));
      });
  } catch {
    return [];
  }
}

function nestedSkillFiles(rootDirectory) {
  if (!fs.existsSync(rootDirectory)) return [];
  const files = [];
  const pending = [{ directory: rootDirectory, depth: 0 }];
  while (pending.length) {
    const { directory, depth } = pending.pop();
    const skillFile = path.join(directory, 'SKILL.md');
    if (fs.existsSync(skillFile)) {
      files.push(skillFile);
      continue;
    }
    if (depth >= MAX_SCAN_DEPTH) continue;
    try {
      const children = fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => right.name.localeCompare(left.name));
      for (const child of children) {
        pending.push({ directory: path.join(directory, child.name), depth: depth + 1 });
      }
    } catch {
      // An unreadable plugin cache entry should not hide the rest of the registry.
    }
  }
  return files;
}

function pluginNamespace(skillFile, cacheDirectory) {
  const segments = path.relative(cacheDirectory, skillFile).split(path.sep);
  return segments.length >= 2 ? segments[1] : '';
}

function fileRecord(skillFile, { kind, origin, namespace = '' }) {
  const parsed = readSkillFile(skillFile, path.basename(path.dirname(skillFile)));
  if (!parsed) return null;
  const name = namespace ? `${namespace}:${parsed.name}` : parsed.name;
  return {
    id: `${kind}-${origin.toLowerCase()}-${name.toLowerCase()}`,
    name,
    description: parsed.description,
    kind,
    origin,
    modifiedAt: parsed.modifiedAt,
  };
}

function recordsFromFiles(files, metadataForFile) {
  return files.map((skillFile) => fileRecord(skillFile, metadataForFile(skillFile))).filter(Boolean);
}

function latestUniqueRecords(records) {
  const unique = new Map();
  for (const record of records) {
    const key = `${record.kind}:${record.origin}:${record.name}`.toLowerCase();
    const previous = unique.get(key);
    if (!previous || record.modifiedAt > previous.modifiedAt) unique.set(key, record);
  }
  return [...unique.values()]
    .map(({ modifiedAt, ...record }) => record)
    .sort((left, right) => (
      Number(left.kind === 'default') - Number(right.kind === 'default')
      || left.name.localeCompare(right.name)
      || left.origin.localeCompare(right.origin)
    ));
}

function listSkills(options = {}) {
  const agentsHome = options.agentsHome || process.env.AGENTS_HOME || path.resolve(__dirname, '..', '..', '.agents');
  const workspaceRoot = options.workspaceRoot || path.dirname(agentsHome);
  const codexHome = options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const claudeHome = options.claudeHome || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const codexSkills = path.join(codexHome, 'skills');
  const codexPluginCache = path.join(codexHome, 'plugins', 'cache');
  const claudePluginCache = path.join(claudeHome, 'plugins', 'cache');

  const records = [
    ...recordsFromFiles(personalSkillFiles(path.join(agentsHome, 'skills')), () => ({ kind: 'personal', origin: 'Workspace' })),
    ...projectSkillRecords(workspaceRoot),
    ...recordsFromFiles(nestedSkillFiles(path.join(codexSkills, '.system')), () => ({ kind: 'default', origin: 'System' })),
    ...recordsFromFiles(nestedSkillFiles(codexPluginCache), (skillFile) => ({
      kind: 'default',
      origin: 'Plugin',
      namespace: pluginNamespace(skillFile, codexPluginCache),
    })),
    ...recordsFromFiles(nestedSkillFiles(claudePluginCache), (skillFile) => ({
      kind: 'default',
      origin: 'Plugin',
      namespace: pluginNamespace(skillFile, claudePluginCache),
    })),
    ...CLAUDE_BUNDLED_SKILLS.map((skill) => ({
      id: `claude-default-${skill.name}`,
      name: skill.name,
      description: skill.description,
      kind: 'default',
      origin: 'Bundled',
      modifiedAt: 0,
    })),
  ];

  return latestUniqueRecords(records);
}

module.exports = { listSkills, readSkillFile };
