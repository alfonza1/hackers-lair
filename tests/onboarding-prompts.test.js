const assert = require('node:assert/strict');
const test = require('node:test');

const { configurationPrompts, onboardingState } = require('../lib/onboarding-prompts');

test('offers complete and focused prompts when nothing is configured', () => {
  const prompts = configurationPrompts({
    projectsFile: 'C:\\Lair\\projects.json',
    skillsDirectory: 'C:\\Code\\.agents\\skills',
    projectCount: 0,
    personalSkillCount: 0,
  });

  assert.deepEqual(prompts.map((prompt) => prompt.id), ['complete', 'projects', 'skills']);
  assert.match(prompts[0].prompt, /Inspect before changing anything/);
  assert.match(prompts[1].prompt, /absolute cwd/);
  assert.match(prompts[2].prompt, /without overwriting any real directory/);
});

test('returns portable machine paths and only the missing setup area', () => {
  const state = onboardingState({
    projectsFile: 'D:\\Tools\\projects.json',
    agentsHome: 'D:\\Work\\.agents',
    projects: [{ name: 'App' }],
    skills: [],
  });

  assert.equal(state.configured, false);
  assert.deepEqual(state.prompts.map((prompt) => prompt.id), ['skills']);
  assert.equal(state.skillsDirectory, 'D:\\Work\\.agents\\skills');
});

test('does not show onboarding prompts once projects and skills exist', () => {
  const state = onboardingState({
    projectsFile: 'projects.json',
    agentsHome: '.agents',
    projects: [{ name: 'App' }],
    skills: [{ name: 'verify', kind: 'personal' }],
  });

  assert.equal(state.configured, true);
  assert.deepEqual(state.prompts, []);
});
