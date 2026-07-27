const fs = require('fs');
const path = require('path');

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const MAX_SKILL_BACKUPS = 10;

function validateSkillName(name) {
  const normalized = String(name || '').trim();
  if (!SKILL_NAME_PATTERN.test(normalized)) {
    throw new Error('Skill names must use 2–64 lowercase letters, numbers, or hyphens.');
  }
  return normalized;
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeSkillDirectory(skillsRoot, name) {
  const normalized = validateSkillName(name);
  const target = path.resolve(skillsRoot, normalized);
  if (!isInside(skillsRoot, target)) throw new Error('Skill path escapes the personal Skills directory.');
  return { name: normalized, target };
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function skillTemplate(name) {
  return `---
name: ${name}
description: Use this skill for a focused repeatable workflow; replace this sentence with precise routing guidance.
---

# ${name}

## Workflow

1. Inspect the relevant files read-only.
2. Make the smallest safe change.
3. Verify the result through the public interface.
`;
}

function scaffoldSkill({ skillsRoot, name }) {
  const skill = safeSkillDirectory(skillsRoot, name);
  if (fs.existsSync(skill.target)) throw new Error(`Skill "${skill.name}" already exists.`);
  fs.mkdirSync(path.resolve(skillsRoot), { recursive: true });
  fs.mkdirSync(skill.target, { recursive: false });
  const skillFile = path.join(skill.target, 'SKILL.md');
  try {
    atomicWrite(skillFile, skillTemplate(skill.name));
  } catch (error) {
    try { fs.rmdirSync(skill.target); } catch { /* best effort */ }
    throw error;
  }
  return { name: skill.name, directory: skill.target, skillFile };
}

function timestampedBackupDirectory(backupRoot, source, name) {
  fs.mkdirSync(backupRoot, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let destination = path.join(backupRoot, `${timestamp}-${name}`);
  let collision = 0;
  while (fs.existsSync(destination)) {
    collision += 1;
    destination = path.join(backupRoot, `${timestamp}-${name}-${collision}`);
  }
  fs.cpSync(source, destination, { recursive: true, errorOnExist: true });
  const backups = fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = path.join(backupRoot, entry.name);
      return { directory, modifiedAt: fs.statSync(directory).mtimeMs };
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  for (const stale of backups.slice(MAX_SKILL_BACKUPS)) {
    fs.rmSync(stale.directory, { recursive: true, force: true });
  }
  return destination;
}

function assertMovableSkill(skillsRoot, directory) {
  if (!fs.existsSync(path.join(directory, 'SKILL.md'))) {
    throw new Error('The selected folder does not contain SKILL.md.');
  }
  if (fs.lstatSync(directory).isSymbolicLink()) {
    throw new Error('Linked skill directories cannot be moved by Hacker’s Lair.');
  }
  const realRoot = fs.realpathSync(skillsRoot);
  const realDirectory = fs.realpathSync(directory);
  if (!isInside(realRoot, realDirectory)) {
    throw new Error('The selected skill resolves outside the personal Skills directory.');
  }
}

function archiveSkill({ skillsRoot, backupRoot, name }) {
  const skill = safeSkillDirectory(skillsRoot, name);
  assertMovableSkill(skillsRoot, skill.target);
  const archiveRoot = path.join(path.resolve(skillsRoot), '.archive');
  const destination = path.join(archiveRoot, skill.name);
  if (fs.existsSync(destination)) throw new Error(`Archived skill "${skill.name}" already exists.`);
  const backupDirectory = timestampedBackupDirectory(backupRoot, skill.target, skill.name);
  fs.mkdirSync(archiveRoot, { recursive: true });
  fs.renameSync(skill.target, destination);
  return { name: skill.name, directory: destination, backupDirectory };
}

function unarchiveSkill({ skillsRoot, backupRoot, name }) {
  const skill = safeSkillDirectory(skillsRoot, name);
  const archiveRoot = path.join(path.resolve(skillsRoot), '.archive');
  const source = path.join(archiveRoot, skill.name);
  if (!isInside(archiveRoot, source)) throw new Error('Archived skill path is invalid.');
  if (fs.existsSync(skill.target)) throw new Error(`Active skill "${skill.name}" already exists.`);
  assertMovableSkill(archiveRoot, source);
  const backupDirectory = timestampedBackupDirectory(backupRoot, source, skill.name);
  fs.renameSync(source, skill.target);
  return { name: skill.name, directory: skill.target, backupDirectory };
}

function listArchivedSkills(skillsRoot) {
  const archiveRoot = path.join(path.resolve(skillsRoot), '.archive');
  try {
    return fs.readdirSync(archiveRoot, { withFileTypes: true })
      .filter((entry) => (
        entry.isDirectory()
        && SKILL_NAME_PATTERN.test(entry.name)
        && fs.existsSync(path.join(archiveRoot, entry.name, 'SKILL.md'))
      ))
      .map((entry) => ({
        id: `archived-workspace-${entry.name}`,
        name: entry.name,
        kind: 'archived',
        origin: 'Workspace archive',
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

module.exports = {
  SKILL_NAME_PATTERN,
  archiveSkill,
  isInside,
  listArchivedSkills,
  scaffoldSkill,
  unarchiveSkill,
  validateSkillName,
};
