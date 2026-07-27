const fs = require('fs');
const path = require('path');

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
  const lines = [
    `# Hacker's Lair workflow report — ${day}`,
    '',
    '## Usage leaderboard',
    ...(usage.length ? usage.map((entry) => `- ${entry.name}: ${entry.count}`) : ['- No usage data yet.']),
    '',
    '## Newly cold skills',
    ...(coldSkills.length ? coldSkills.map((name) => `- ${name}`) : ['- None.']),
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
  ];
  const markdown = `${lines.join('\n')}\n`;
  const file = path.join(reportsDirectory, `${day}.md`);
  fs.writeFileSync(file, markdown, { encoding: 'utf8', mode: 0o600 });
  return { file, markdown };
}

module.exports = { generateWorkflowReport };
