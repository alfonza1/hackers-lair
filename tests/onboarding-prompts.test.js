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
  assert.match(prompts[0].prompt, /Inspect the config and candidate folders read-only first/);
  assert.match(prompts[1].prompt, /absolute cwd/);
  assert.match(prompts[2].prompt, /without overwriting any real directory/);
});

test('project prompt includes live config, schema, a valid example, and CLI verification', () => {
  const [prompt] = configurationPrompts({
    projectsFile: 'C:\\Workspaces\\.lair-data\\projects.json',
    projectsSchemaFile: 'C:\\Workspaces\\.lair-data\\projects.schema.json',
    projectsSchemaUrl: 'http://localhost:4952/api/schema/projects',
    skillsDirectory: 'C:\\Code\\.agents\\skills',
    projectCount: 0,
    personalSkillCount: 0,
    enableSkills: false,
  });

  assert.equal(prompt.id, 'projects');
  assert.match(prompt.prompt, /C:\\Workspaces\\\.lair-data\\projects\.json/);
  assert.match(prompt.prompt, /projects\.schema\.json/);
  assert.match(prompt.prompt, /http:\/\/localhost:4952\/api\/schema\/projects/);
  assert.match(prompt.prompt, /`lair doctor`/);
  assert.match(prompt.prompt, /`lair ls`/);
  assert.match(prompt.prompt, /hot-reloads.*without an app restart/i);
  assert.doesNotMatch(prompt.prompt, /run Hacker's Lair tests|server internals/i);

  const exampleLine = prompt.prompt.split('\n')
    .find((line) => line.startsWith('Use this compact valid entry'));
  assert.ok(exampleLine);
  const example = JSON.parse(exampleLine.slice(exampleLine.indexOf(': ') + 2));
  assert.equal(example.components[0].command, 'npm.cmd run dev');
  assert.equal(example.components[0].port, 5173);
});

test('project prompt uses selected workspace folders and keeps skills gated', () => {
  const prompts = configurationPrompts({
    projectsFile: 'C:\\Lair\\projects.json',
    projectsSchemaFile: 'C:\\Lair\\projects.schema.json',
    projectsSchemaUrl: 'http://localhost:4949/api/schema/projects',
    skillsDirectory: 'C:\\Code\\.agents\\skills',
    projectCount: 0,
    personalSkillCount: 0,
    enableSkills: false,
    workspaceFolders: ['D:\\Code', 'D:\\Experiments', 'relative-folder'],
  });

  assert.deepEqual(prompts.map((prompt) => prompt.id), ['projects']);
  assert.match(prompts[0].prompt, /Scan these folders read-only: D:\\Code; D:\\Experiments/);
  assert.doesNotMatch(prompts[0].prompt, /relative-folder|Configure my personal agent skills/);
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
