const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { EventEmitter } = require('node:events');

const {
  desktopDataDirectory,
  readIdentityRecord,
  stopManagedChild,
  writeManagedCliShim,
} = require('../lib/desktop-service');
const forgeConfig = require('../forge.config');
const { ignoreNonRuntimePath } = forgeConfig;
const { packagedLaunchArguments } = require('../scripts/smoke-packaged-lifecycle');

test('desktop data follows Electron userData unless explicitly overridden', () => {
  const app = { getPath: (name) => name === 'userData' ? 'C:\\AppData\\HackersLair' : '' };
  assert.equal(desktopDataDirectory(app, {}), 'C:\\AppData\\HackersLair');
  assert.equal(
    desktopDataDirectory(app, { PROJECT_MANAGER_DATA_DIR: 'D:\\Portable\\data' }),
    'D:\\Portable\\data',
  );
});

test('identity records must belong to the managed child process', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-desktop-identity-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'api-token');
  fs.writeFileSync(file, JSON.stringify({
    app: 'hackers-lair',
    token: 'token',
    nonce: 'nonce',
    port: 4951,
    pid: 4321,
  }));

  assert.equal(readIdentityRecord(file, 4321).port, 4951);
  assert.throws(() => readIdentityRecord(file, 1234), /invalid/);
});

test('managed CLI installation preserves a command owned by another tool', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-cli-shim-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'lair');
  const marker = "# Hacker's Lair managed CLI";
  fs.writeFileSync(file, '#!/bin/sh\necho unrelated\n');
  assert.equal(writeManagedCliShim(file, `${marker}\necho managed\n`, marker), false);
  assert.match(fs.readFileSync(file, 'utf8'), /unrelated/);
  fs.writeFileSync(file, `${marker}\necho old\n`);
  assert.equal(writeManagedCliShim(file, `${marker}\necho updated\n`, marker), true);
  assert.match(fs.readFileSync(file, 'utf8'), /updated/);
});

test('managed child is terminated and awaited', async () => {
  class FakeChild extends EventEmitter {
    constructor() {
      super();
      this.exitCode = null;
      this.signalCode = null;
      this.signals = [];
    }

    kill(signal) {
      this.signals.push(signal);
      this.signalCode = signal;
      queueMicrotask(() => this.emit('exit', 0, signal));
      return true;
    }
  }

  const child = new FakeChild();
  await stopManagedChild(child);
  assert.deepEqual(child.signals, ['SIGTERM']);
});

test('packaging excludes repository-only files and keeps runtime files', () => {
  for (const runtimePath of [
    '/desktop.js',
    '/lib/platform/linux.js',
    '/node_modules/update-electron-app/dist/index.js',
    '/node_modules/github-url-to-object/index.js',
    '/public/index.html',
    '/schemas/projects.schema.json',
  ]) {
    assert.equal(ignoreNonRuntimePath(runtimePath), false, runtimePath);
  }
  for (const repositoryPath of [
    '/.github/workflows/release.yml',
    '/docs/screenshots/targets.png',
    '/node_modules/electron/index.js',
    '/site/index.html',
    '/tests/server-security.test.js',
  ]) {
    assert.equal(ignoreNonRuntimePath(repositoryPath), true, repositoryPath);
  }
});

test('Linux package makers target the custom packaged executable name', () => {
  const linuxMakers = forgeConfig.makers.filter((maker) => (
    ['@electron-forge/maker-deb', '@electron-forge/maker-rpm'].includes(maker.name)
  ));
  assert.equal(linuxMakers.length, 2);
  for (const maker of linuxMakers) {
    assert.equal(maker.config.options.name, 'hackers-lair');
    assert.equal(maker.config.options.bin, 'HackersLair');
  }
});

test('the Linux package smoke disables Chromium sandboxing only when explicitly requested', () => {
  assert.deepEqual(packagedLaunchArguments('linux', {}), []);
  assert.deepEqual(packagedLaunchArguments('win32', { LAIR_SMOKE_DISABLE_SANDBOX: '1' }), []);
  assert.deepEqual(
    packagedLaunchArguments('linux', { LAIR_SMOKE_DISABLE_SANDBOX: '1' }),
    ['--no-sandbox'],
  );
});
