const path = require('path');

function normalizedWorkspaceFolders(workspaceFolders = []) {
  return [...new Set(workspaceFolders
    .map((folder) => String(folder || '').trim())
    .filter((folder) => folder && path.isAbsolute(folder)))];
}

function requiredPromptValue(name, value) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${name} is required to generate a project setup prompt.`);
  return normalized;
}

function projectSetupPrompt({
  projectsFile,
  projectsSchemaFile,
  projectsSchemaUrl,
  workspaceFolders = [],
}) {
  const configFile = requiredPromptValue('projectsFile', projectsFile);
  const schemaFile = requiredPromptValue('projectsSchemaFile', projectsSchemaFile);
  const schemaUrl = requiredPromptValue('projectsSchemaUrl', projectsSchemaUrl);
  const folders = normalizedWorkspaceFolders(workspaceFolders);
  const npmCommand = process.platform === 'win32' ? 'npm.cmd run dev' : 'npm run dev';
  const exampleCwd = folders.length
    ? path.join(folders[0], 'example-app')
    : process.platform === 'win32'
      ? 'C:\\absolute\\path\\to\\example-app'
      : '/absolute/path/to/example-app';
  const example = JSON.stringify({
    name: 'example-app',
    type: 'Node',
    components: [{
      name: 'web',
      role: 'frontend',
      cwd: exampleCwd,
      command: npmCommand,
      match: exampleCwd,
      port: 5173,
    }],
  });
  const folderInstruction = folders.length
    ? `Scan these folders read-only: ${folders.join('; ')}.`
    : 'Ask me which development folders to scan before searching broadly.';

  return [
    "Set up Hacker's Lair targets for this machine.",
    `Config file: ${configFile}`,
    `Schema file: ${schemaFile}`,
    `Live schema reference: ${schemaUrl}`,
    folderInstruction,
    `Inspect the config and candidate folders read-only first. Preserve every valid existing entry. Add only real runnable components, using an absolute cwd, the actual command, real ports, and a distinctive match value. Ask before resolving ambiguous folders, commands, ports, or process matches. Do not put secrets, tokens, or credentials in the config.`,
    `Use this compact valid entry as the shape—replace its values with verified ones: ${example}`,
    `Validate the finished JSON against the schema at its documented location. Save it, run \`lair doctor\`, then run \`lair ls\`. Confirm Hacker's Lair hot-reloads the target without an app restart and reports it accurately before starting anything.`,
  ].join('\n');
}

function configurationPrompts({
  projectsFile,
  projectsSchemaFile = path.join(path.dirname(projectsFile), 'projects.schema.json'),
  projectsSchemaUrl,
  skillsDirectory,
  projectCount,
  personalSkillCount,
  enableSkills = true,
  workspaceFolders = [],
}) {
  const projectPrompt = projectCount === 0
    ? projectSetupPrompt({
      projectsFile,
      projectsSchemaFile,
      projectsSchemaUrl,
      workspaceFolders,
    })
    : '';
  const skillsPrompt = `Configure my personal agent skills for Hacker's Lair. Inspect my existing agent configuration and reusable SKILL.md files first. Make ${skillsDirectory} the canonical workspace skill directory without overwriting any real directory or losing existing skills; on Windows, use a junction only after verifying both source and target. Keep each skill portable, with valid name and description frontmatter, bundled scripts for fragile commands, and no machine-specific secrets. Then start Hacker's Lair, open the Skills view, and verify the personal skills are discovered from the shared workspace folder.`;
  const fullPrompt = `${projectPrompt}\n\nAfter targets are verified, ${skillsPrompt.charAt(0).toLowerCase()}${skillsPrompt.slice(1)}`;

  const prompts = [];
  if (enableSkills && projectCount === 0 && personalSkillCount === 0) {
    prompts.push({ id: 'complete', title: 'Configure everything', prompt: fullPrompt });
  }
  if (projectCount === 0) prompts.push({ id: 'projects', title: 'Configure targets', prompt: projectPrompt });
  if (enableSkills && personalSkillCount === 0) prompts.push({ id: 'skills', title: 'Configure skills', prompt: skillsPrompt });
  return prompts;
}

function onboardingState({
  projectsFile,
  projectsSchemaFile,
  projectsSchemaUrl,
  agentsHome,
  projects,
  skills,
  enableSkills = true,
  workspaceFolders = [],
}) {
  const personalSkillCount = skills.filter((skill) => skill.kind === 'personal').length;
  const skillsDirectory = path.join(agentsHome, 'skills');
  return {
    configured: projects.length > 0 && (!enableSkills || personalSkillCount > 0),
    projectCount: projects.length,
    personalSkillCount,
    projectsFile,
    skillsDirectory,
    prompts: configurationPrompts({
      projectsFile,
      projectsSchemaFile,
      projectsSchemaUrl,
      skillsDirectory,
      projectCount: projects.length,
      personalSkillCount,
      enableSkills,
      workspaceFolders,
    }),
  };
}

module.exports = {
  configurationPrompts,
  normalizedWorkspaceFolders,
  onboardingState,
  projectSetupPrompt,
};
