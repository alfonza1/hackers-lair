const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LogStore, ROTATION_MARKER } = require('../lib/log-store');

function temporaryStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-logs-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new LogStore(directory, { maxBytes: 64 * 1024, retainBytes: 32 * 1024 });
}

test('component logs are capped while retaining their newest output', (t) => {
  const store = temporaryStore(t);
  const file = store.componentFile('Demo Project', 'web');
  store.prepare(file);
  fs.appendFileSync(file, `old:${'x'.repeat(70 * 1024)}\nnewest-line`);

  assert.equal(store.trim(file), true);
  const output = fs.readFileSync(file, 'utf8');
  assert.ok(fs.statSync(file).size <= 64 * 1024);
  assert.match(output, new RegExp(ROTATION_MARKER.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(output, /newest-line$/);
});

test('maintenance prunes removed components but preserves runtime errors', (t) => {
  const store = temporaryStore(t);
  const keep = store.componentFile('Keep', 'web');
  const remove = store.componentFile('Remove', 'web');
  store.prepare(keep);
  store.prepare(remove);
  store.appendRuntimeError('unhandledRejection', new Error('fixture'));

  const result = store.maintain(new Set([keep]));
  assert.equal(result.pruned, 1);
  assert.equal(fs.existsSync(keep), true);
  assert.equal(fs.existsSync(remove), false);
  assert.equal(fs.existsSync(path.join(store.directory, 'runtime-errors.log')), true);
});

test('summary and clear cover every local log', (t) => {
  const store = temporaryStore(t);
  const first = store.componentFile('One', 'web');
  const second = store.componentFile('Two', 'api');
  store.prepare(first);
  store.prepare(second);
  fs.appendFileSync(first, 'hello');
  fs.appendFileSync(second, 'world');

  assert.deepEqual(
    { files: store.summary().files, bytes: store.summary().bytes },
    { files: 2, bytes: 10 },
  );
  const cleared = store.clear();
  assert.equal(cleared.cleared, 2);
  assert.equal(cleared.bytes, 0);
});
