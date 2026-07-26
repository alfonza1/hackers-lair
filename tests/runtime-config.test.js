const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  compareBackupNamesNewestFirst,
  createRuntimeConfig,
  JsonConfigStore,
} = require('../lib/runtime-config');
const { DEFAULT_UI_PREFERENCES } = require('../lib/ui-preferences');

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
  fs.mkdirSync(path.join(root, 'schemas'));
  fs.copyFileSync(
    path.join(__dirname, '..', 'schemas', 'projects.schema.json'),
    path.join(root, 'schemas', 'projects.schema.json'),
  );

  const previous = process.env.PROJECT_MANAGER_DATA_DIR;
  process.env.PROJECT_MANAGER_DATA_DIR = data;
  t.after(() => {
    if (previous === undefined) delete process.env.PROJECT_MANAGER_DATA_DIR;
    else process.env.PROJECT_MANAGER_DATA_DIR = previous;
  });

  const runtime = createRuntimeConfig(root);
  assert.equal(runtime.dataDirectory, data);
  assert.deepEqual(runtime.projects.read().value, {
    $schema: './projects.schema.json',
    projects: [],
  });
  assert.equal(runtime.projects.file, path.join(data, 'projects.json'));
  assert.ok(fs.existsSync(path.join(data, 'scripts.json')));
  assert.ok(fs.existsSync(path.join(data, 'settings.json')));
  assert.deepEqual(runtime.settings.read().value.uiPreferences, DEFAULT_UI_PREFERENCES);

  const workspaceFolders = process.platform === 'win32'
    ? ['D:\\Code', 'E:\\Experiments']
    : ['/code', '/experiments'];
  const settings = runtime.settings.write({
    enableSkills: false,
    browserPath: '',
    zombieAfterHours: 8,
    workspaceFolders,
    uiPreferences: {
      theme: 'ice',
      density: 'compact',
      motion: 'reduced',
      fontScale: 110,
    },
  });
  assert.deepEqual(settings.workspaceFolders, workspaceFolders);
  assert.equal(settings.uiPreferences.theme, 'ice');
  assert.throws(() => runtime.settings.write({
    workspaceFolders: ['relative-folder'],
  }), /absolute folder strings/i);
  assert.throws(() => runtime.settings.write({
    uiPreferences: {
      theme: 'rainbow',
      density: 'comfortable',
      motion: 'full',
      fontScale: 100,
    },
  }), /uiPreferences\.theme/i);
});

test('validates nested project fields and retains ten restorable backups', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-config-root-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-config-data-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  });
  for (const file of ['projects.example.json', 'scripts.example.json', 'settings.example.json']) {
    fs.copyFileSync(path.join(__dirname, '..', file), path.join(root, file));
  }
  fs.mkdirSync(path.join(root, 'schemas'));
  fs.copyFileSync(
    path.join(__dirname, '..', 'schemas', 'projects.schema.json'),
    path.join(root, 'schemas', 'projects.schema.json'),
  );

  const previous = process.env.PROJECT_MANAGER_DATA_DIR;
  process.env.PROJECT_MANAGER_DATA_DIR = data;
  t.after(() => {
    if (previous === undefined) delete process.env.PROJECT_MANAGER_DATA_DIR;
    else process.env.PROJECT_MANAGER_DATA_DIR = previous;
  });

  const runtime = createRuntimeConfig(root);
  assert.throws(() => runtime.projects.write({
    projects: [{ name: 'bad', components: [{ name: 'web', port: 70000 }] }],
  }), /maximum|65535/i);

  for (let index = 0; index < 12; index += 1) {
    runtime.projects.write({
      $schema: './projects.schema.json',
      projects: [{ name: `version-${index}`, components: [{ name: 'web' }] }],
    });
  }
  const backups = runtime.projects.listBackups();
  assert.equal(backups.length, 10);
  const restored = runtime.projects.restore(backups.at(-1).name);
  assert.match(restored.projects[0].name, /^version-/);
});

test('orders same-millisecond backup collisions by their write sequence', () => {
  const names = [
    '2026-07-26T08-00-00-000Z-2.json',
    '2026-07-26T08-00-00-000Z.json',
    '2026-07-26T08-00-00-000Z-11.json',
    '2026-07-26T08-00-00-001Z.json',
  ];
  assert.deepEqual(names.sort(compareBackupNamesNewestFirst), [
    '2026-07-26T08-00-00-001Z.json',
    '2026-07-26T08-00-00-000Z-11.json',
    '2026-07-26T08-00-00-000Z-2.json',
    '2026-07-26T08-00-00-000Z.json',
  ]);
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
