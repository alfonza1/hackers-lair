const fs = require('fs');
const path = require('path');
const { gitDirectoryFor } = require('./git-branches');

function instructionContent(directory, fileName) {
  try { return fs.readFileSync(path.join(directory, fileName), 'utf8'); }
  catch { return ''; }
}

function projectCoverageMatrix(projects) {
  return (projects || []).map((project) => {
    const directories = [...new Set((project.components || [])
      .map((component) => component.cwd)
      .filter(Boolean)
      .map((directory) => path.resolve(directory)))];
    const hasAgents = directories.some((directory) => fs.existsSync(path.join(directory, 'AGENTS.md')));
    const hasClaude = directories.some((directory) => fs.existsSync(path.join(directory, 'CLAUDE.md')));
    const content = directories.flatMap((directory) => [
      instructionContent(directory, 'AGENTS.md'),
      instructionContent(directory, 'CLAUDE.md'),
    ]).join('\n');
    const hasRunInstructions = /\b(?:run|start|launch|serve)\b/i.test(content);
    const hasVerifyInstructions = /\b(?:verify|test|check|validate)\b/i.test(content);
    const isGitRepo = directories.some((directory) => Boolean(gitDirectoryFor(directory)));
    const gaps = [];
    if (!hasAgents) gaps.push('AGENTS.md');
    if (!hasClaude) gaps.push('CLAUDE.md');
    if (!hasRunInstructions) gaps.push('run instructions');
    if (!hasVerifyInstructions) gaps.push('verify instructions');
    if (!isGitRepo) gaps.push('Git repository');
    if (!(project.components || []).length) gaps.push('registered components');
    return {
      name: project.name,
      directory: directories[0] || '',
      hasAgents,
      hasClaude,
      hasRunInstructions,
      hasVerifyInstructions,
      isGitRepo,
      componentCount: (project.components || []).length,
      gaps,
    };
  });
}

module.exports = { projectCoverageMatrix };
