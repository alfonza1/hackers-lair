const path = require('path');

function normalizedWorkspaceFolders(workspaceFolders = []) {
  return [...new Set(workspaceFolders
    .map((folder) => String(folder || '').trim())
    .filter((folder) => folder && path.isAbsolute(folder)))];
}

function requiredPromptValue(name, value) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${name} is required to generate a setup prompt.`);
  return normalized;
}

function usageTrackingSetupPrompt({
  usageLogFile,
  claudeSettingsFile,
  lairSettingsFile,
  instructionsFile,
  hookCommand,
}) {
  const usageLog = requiredPromptValue('usageLogFile', usageLogFile);
  const claudeSettings = requiredPromptValue('claudeSettingsFile', claudeSettingsFile);
  const lairSettings = requiredPromptValue('lairSettingsFile', lairSettingsFile);
  const command = requiredPromptValue('hookCommand', hookCommand);
  const instructions = String(instructionsFile || '').trim();
  const instructionLocation = instructions || '(ask me before choosing this file)';
  const fallbackStep = instructions
    ? '4. For agent harnesses that do not support hooks, add one short instruction to the workspace instructions file telling agents to append the same line after invoking a skill. Two lines maximum. Do not restructure, reorder, or reword the rest of that file.'
    : '4. Ask me where my workspace instructions file lives before adding the fallback instruction. Then add no more than two lines telling agents to append the same line after invoking a skill. Do not restructure, reorder, or reword the rest of that file.';

  return [
    "Set up AI workflow usage tracking for Hacker's Lair.",
    '',
    `Usage log file: ${usageLog}`,
    `Claude Code settings file: ${claudeSettings}`,
    `Hacker's Lair settings file: ${lairSettings}`,
    `Workspace instructions file: ${instructionLocation}`,
    '',
    'Inspect all four files read-only first and tell me what already exists before you change anything. Back up every file you modify to a timestamped copy beside it. If a file is missing or malformed, report it instead of recreating it from scratch.',
    '',
    '1. Add a PostToolUse hook to the Claude Code settings file that appends one JSON line to the usage log each time a Skill or Task tool runs. Merge it into the existing hooks configuration — never replace, reorder, or drop hooks I already have. If a hook already writes to this log, stop and tell me rather than adding a second one.',
    `2. Use exactly this append command for this machine: ${command}`,
    '3. Each logged line must contain only these fields: type, name, project, ts, source. Never log prompt text, file contents, tool arguments, environment variables, tokens, or credentials.',
    fallbackStep,
    '5. In the Hacker\'s Lair settings file, set `enableSkills` to true and add the `aiWorkflow` block if it is absent. Preserve every other setting and keep the file valid against its schema.',
    '',
    'Then verify end to end: invoke any skill, confirm exactly one well-formed line was appended to the usage log, and confirm the Skills view in Hacker\'s Lair shows a usage count for that skill. Report the verification result. If the hook does not fire, diagnose and tell me what you found — do not add a second hook or edit the log by hand to make it look like it worked.',
  ].join('\n');
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
  usageLogFile,
  claudeSettingsFile,
  lairSettingsFile,
  instructionsFile = '',
  hookCommand,
  hookInstalled = true,
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
  const usagePrompt = enableSkills && !hookInstalled
    ? usageTrackingSetupPrompt({
        usageLogFile,
        claudeSettingsFile,
        lairSettingsFile,
        instructionsFile,
        hookCommand,
      })
    : '';
  const chained = [projectPrompt, skillsPrompt, usagePrompt].filter(Boolean);
  const fullPrompt = chained
    .map((prompt, index) => (
      index === 0 ? prompt : `After the previous step is verified, ${prompt.charAt(0).toLowerCase()}${prompt.slice(1)}`
    ))
    .join('\n\n');

  const prompts = [];
  if (enableSkills && projectCount === 0 && personalSkillCount === 0) {
    prompts.push({ id: 'complete', title: 'Configure everything', prompt: fullPrompt });
  }
  if (projectCount === 0) prompts.push({ id: 'projects', title: 'Configure targets', prompt: projectPrompt });
  if (enableSkills && personalSkillCount === 0) prompts.push({ id: 'skills', title: 'Configure skills', prompt: skillsPrompt });
  if (usagePrompt) prompts.push({ id: 'usage', title: 'Configure usage tracking', prompt: usagePrompt });
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
  usageLogFile,
  claudeSettingsFile,
  lairSettingsFile,
  instructionsFile = '',
  hookCommand,
  hookInstalled = true,
}) {
  const personalSkillCount = skills.filter((skill) => skill.kind === 'personal').length;
  const skillsDirectory = path.join(agentsHome, 'skills');
  return {
    configured: projects.length > 0 && (
      !enableSkills
      || (personalSkillCount > 0 && hookInstalled)
    ),
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
      usageLogFile,
      claudeSettingsFile,
      lairSettingsFile,
      instructionsFile,
      hookCommand,
      hookInstalled,
    }),
  };
}

module.exports = {
  configurationPrompts,
  normalizedWorkspaceFolders,
  onboardingState,
  projectSetupPrompt,
  usageTrackingSetupPrompt,
};
