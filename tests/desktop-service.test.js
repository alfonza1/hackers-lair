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
} = require('../lib/desktop-service');

test('desktop data follows Electron userData unless explicitly overridden', () => {
  const app = { getPath: (name) => name === 'userData' ? 'C:\\AppData\\HackersLair' : '' };
  assert.equal(desktopDataDirectory(app, {}), 'C:\\AppData\\HackersLair');
  assert.equal(
    desktopDataDirectory(app, { PROJECT_MANAGER_DATA_DIR: 'D:\\Portable\\data' }),
    'D:\\Portable\\data',
  );
});

test('identity records must belong to the managed child process', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-desktop-identity-'));
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
