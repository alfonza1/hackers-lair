const fs = require('fs');
const path = require('path');

function previousColdSkills(reportsDirectory, currentFile) {
  let files;
  try {
    files = fs.readdirSync(reportsDirectory)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name) && name !== path.basename(currentFile))
      .sort((left, right) => right.localeCompare(left));
  } catch {
    return [];
  }
  for (const name of files) {
    try {
      const match = fs.readFileSync(path.join(reportsDirectory, name), 'utf8')
        .match(/## Cold skill snapshot\r?\n([\s\S]*?)(?:\r?\n## |\s*$)/);
      if (match) {
        return match[1].split(/\r?\n/)
          .filter((line) => line.startsWith('- ') && line !== '- None.')
          .map((line) => line.slice(2));
      }
    } catch {
      // An older or malformed report is not a reason to block a new report.
    }
  }
  return [];
}

function generateWorkflowReport({
  reportsDirectory,
  date = new Date(),
  usage = [],
  coldSkills = [],
  frictionGroups = [],
  counts = {},
  skillsRepo = {},
} = {}) {
  fs.mkdirSync(reportsDirectory, { recursive: true });
  const day = date.toISOString().slice(0, 10);
  const file = path.join(reportsDirectory, `${day}.md`);
  const currentColdSkills = [...new Set(coldSkills)].sort();
  const previousCold = new Set(previousColdSkills(reportsDirectory, file));
  const newlyColdSkills = currentColdSkills.filter((name) => !previousCold.has(name));
  const lines = [
    `# Hacker's Lair workflow report — ${day}`,
    '',
    '## Usage leaderboard',
    ...(usage.length ? usage.map((entry) => `- ${entry.name}: ${entry.count}`) : ['- No usage data yet.']),
    '',
    '## Newly cold skills',
    ...(newlyColdSkills.length ? newlyColdSkills.map((name) => `- ${name}`) : ['- None.']),
    '',
    '## Friction hot spots',
    ...(frictionGroups.length
      ? frictionGroups.map((group) => `- ${group.tag}: ${group.count}`)
      : ['- No recurring friction.']),
    '',
    '## Maintenance counts',
    `- Lint findings: ${counts.lint || 0}`,
    `- Drift findings: ${counts.drift || 0}`,
    `- Stale findings: ${counts.stale || 0}`,
    `- Coverage gaps: ${counts.coverage || 0}`,
    '',
    '## Skills repository',
    `- Dirty files: ${skillsRepo.dirtyFiles || 0}`,
    `- Unpushed commits: ${skillsRepo.unpushedCommits || 0}`,
    '',
    '## Cold skill snapshot',
    ...(currentColdSkills.length ? currentColdSkills.map((name) => `- ${name}`) : ['- None.']),
    '',
  ];
  const markdown = `${lines.join('\n')}\n`;
  fs.writeFileSync(file, markdown, { encoding: 'utf8', mode: 0o600 });
  return { file, markdown };
}

module.exports = { generateWorkflowReport, previousColdSkills };
