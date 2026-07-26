const assert = require('node:assert/strict');
const test = require('node:test');

const {
  removeProjectFromConfig,
  updateProjectConfig,
} = require('../lib/project-config');

const project = (name, cwd, port) => ({
  name,
  type: 'Node',
  components: [{
    name: 'web',
    cwd,
    command: 'npm run dev',
    match: cwd,
    port,
  }],
});

test('project editor creates and updates schema-backed entries', () => {
  const base = { $schema: './projects.schema.json', projects: [] };
  const projectWithRecovery = project('demo', '/work/demo', 5173);
  projectWithRecovery.components[0].maxRestarts = 6;
  projectWithRecovery.components[0].zombieAfterHours = 12;
  projectWithRecovery.components[0].uiPorts = [5173];
  projectWithRecovery.components[0].backendPorts = [4100];
  const created = updateProjectConfig(base, {
    project: projectWithRecovery,
  }, { exists: () => true });
  assert.equal(created.projects.length, 1);
  assert.equal(created.projects[0].components[0].port, 5173);
  assert.equal(created.projects[0].components[0].maxRestarts, 6);
  assert.equal(created.projects[0].components[0].zombieAfterHours, 12);
  assert.deepEqual(created.projects[0].components[0].uiPorts, [5173]);
  assert.deepEqual(created.projects[0].components[0].backendPorts, [4100]);

  const updated = updateProjectConfig(created, {
    originalName: 'demo',
    project: project('demo-renamed', '/work/demo', 4173),
  }, { exists: () => true });
  assert.deepEqual(updated.projects.map((item) => item.name), ['demo-renamed']);
  assert.equal(updated.projects[0].components[0].port, 4173);
});

test('project editor rejects duplicate names, ports, and missing folders', () => {
  const base = { projects: [project('one', '/work/one', 3000)] };
  assert.throws(() => updateProjectConfig(base, {
    project: project('ONE', '/work/two', 4000),
  }, { exists: () => true }), /already exists/);
  assert.throws(() => updateProjectConfig(base, {
    project: project('two', '/work/two', 3000),
  }, { exists: () => true }), /Port 3000/);
  assert.throws(() => updateProjectConfig(base, {
    project: project('two', '/missing', 4000),
  }, { exists: () => false }), /does not exist/);
});

test('project removal preserves every other entry', () => {
  const base = {
    projects: [
      project('one', '/work/one', 3000),
      project('two', '/work/two', 4000),
    ],
  };
  assert.deepEqual(removeProjectFromConfig(base, 'ONE').projects.map((item) => item.name), ['two']);
  assert.throws(() => removeProjectFromConfig(base, 'missing'), /not found/);
});
