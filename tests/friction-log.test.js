const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  appendFriction,
  listFriction,
  normalizeFrictionTag,
} = require('../lib/friction-log');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-friction-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'friction-log.jsonl');
}

test('friction tags normalize variable details into a stable recurrence key', () => {
  assert.equal(
    normalizeFrictionTag('Agent used the wrong test command on port 5173'),
    normalizeFrictionTag('The agent used a wrong test command on port 8000'),
  );
  assert.match(normalizeFrictionTag('Agent ignored the release checklist'), /ignored-release-checklist/);
});

test('friction events survive restarts and group a three-strike nudge', async (t) => {
  const file = fixture(t);
  for (const text of [
    'Agent used the wrong test command on port 5173',
    'The agent used a wrong test command on port 8000',
    'Agent used wrong test command on port 3000',
  ]) {
    appendFriction(file, {
      text,
      project: 'Fixture App',
      now: new Date('2026-07-27T18:04:11.000Z'),
    });
  }
  fs.appendFileSync(file, '{malformed\n');

  const result = await listFriction(file);
  assert.equal(result.entries.length, 3);
  assert.equal(result.malformedLines, 1);
  assert.equal(result.groups[0].count, 3);
  assert.equal(result.groups[0].nudge, true);
  assert.equal(result.groups[0].project, 'Fixture App');
});

test('friction input rejects empty and oversized captures', (t) => {
  const file = fixture(t);
  assert.throws(() => appendFriction(file, { text: '  ' }), /required/i);
  assert.throws(() => appendFriction(file, { text: 'x'.repeat(2001) }), /2000/);
});
