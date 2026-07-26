const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { JsonConfigStore, createRuntimeConfig } = require('../lib/runtime-config');

test('initializes sanitized runtime configuration outside the repository', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-config-root-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-config-data-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, 'projects.example.json'), '{"projects":[]}');
  fs.writeFileSync(path.join(root, 'scripts.example.json'), '{"scriptsDir":"","autoItExe":"","descriptions":{}}');
  fs.writeFileSync(path.join(root, 'settings.example.json'), '{"enableSkills":false,"browserPath":""}');

  const previous = process.env.PROJECT_MANAGER_DATA_DIR;
  process.env.PROJECT_MANAGER_DATA_DIR = data;
  t.after(() => {
    if (previous === undefined) delete process.env.PROJECT_MANAGER_DATA_DIR;
    else process.env.PROJECT_MANAGER_DATA_DIR = previous;
  });

  const runtime = createRuntimeConfig(root);
  assert.equal(runtime.dataDirectory, data);
  assert.deepEqual(runtime.projects.read().value, { projects: [] });
  assert.equal(runtime.projects.file, path.join(data, 'projects.json'));
  assert.ok(fs.existsSync(path.join(data, 'scripts.json')));
  assert.ok(fs.existsSync(path.join(data, 'settings.json')));
});

test('keeps the last known-good value when JSON becomes invalid', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-last-good-'));
  const file = path.join(directory, 'config.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(file, '{"projects":[{"name":"safe"}]}');
  const store = new JsonConfigStore({
    file,
    fallback: { projects: [] },
    validate(value) {
      if (!Array.isArray(value.projects)) throw new Error('projects required');
    },
  });

  assert.equal(store.read().value.projects[0].name, 'safe');
  fs.writeFileSync(file, '{"projects": [}');
  const result = store.read();
  assert.equal(result.value.projects[0].name, 'safe');
  assert.match(result.error, /config\.json.*position/i);
});
