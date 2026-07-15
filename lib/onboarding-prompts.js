const path = require('path');

function configurationPrompts({ projectsFile, skillsDirectory, projectCount, personalSkillCount }) {
  const projectPrompt = `Configure Hacker's Lair projects for this machine. Inspect my development folders read-only and identify runnable applications and their real components. Preserve existing entries in ${projectsFile}. For each new component, use an absolute cwd, its actual start command, its real port, and a distinctive process match; include stopCommand or port-based detection only when the project needs it. Ask me before resolving ambiguous commands, folders, or port conflicts. Do not edit Hacker's Lair server internals for configuration. Validate the JSON, run Hacker's Lair tests, start the app, and verify each configured target is detected and can be started safely.`;
  const skillsPrompt = `Configure my personal agent skills for Hacker's Lair. Inspect my existing agent configuration and reusable SKILL.md files first. Make ${skillsDirectory} the canonical workspace skill directory without overwriting any real directory or losing existing skills; on Windows, use a junction only after verifying both source and target. Keep each skill portable, with valid name and description frontmatter, bundled scripts for fragile commands, and no machine-specific secrets. Then start Hacker's Lair, open the Skills view, and verify the personal skills are discovered from the shared workspace folder.`;
  const fullPrompt = `Set up Hacker's Lair completely for this machine. First configure runnable projects using ${projectsFile}, then configure personal agent skills using ${skillsDirectory}. Inspect before changing anything, preserve existing configuration, never overwrite a real directory with a link, ask me about ambiguous paths or commands, avoid secrets, validate all JSON and SKILL.md metadata, run the test suite, start the app, and verify Targets and Skills both show the new configuration.`;

  const prompts = [];
  if (projectCount === 0 && personalSkillCount === 0) {
    prompts.push({ id: 'complete', title: 'Configure everything', prompt: fullPrompt });
  }
  if (projectCount === 0) prompts.push({ id: 'projects', title: 'Configure targets', prompt: projectPrompt });
  if (personalSkillCount === 0) prompts.push({ id: 'skills', title: 'Configure skills', prompt: skillsPrompt });
  return prompts;
}

function onboardingState({ projectsFile, agentsHome, projects, skills }) {
  const personalSkillCount = skills.filter((skill) => skill.kind === 'personal').length;
  const skillsDirectory = path.join(agentsHome, 'skills');
  return {
    configured: projects.length > 0 && personalSkillCount > 0,
    projectCount: projects.length,
    personalSkillCount,
    projectsFile,
    skillsDirectory,
    prompts: configurationPrompts({
      projectsFile,
      skillsDirectory,
      projectCount: projects.length,
      personalSkillCount,
    }),
  };
}

module.exports = { configurationPrompts, onboardingState };
