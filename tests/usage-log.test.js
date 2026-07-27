const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_USAGE_LOG_BYTES,
  aggregateUsageLog,
  isColdUsage,
  pruneOlderThan,
  resolveAgentsHome,
} = require('../lib/usage-log');

function tempLog(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-usage-log-'));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  return path.join(directory, 'usage-log.jsonl');
}

function event({ type = 'skill', name, ts, project = '/workspace', source = 'hook' }) {
  return JSON.stringify({ type, name, project, ts, source });
}

test('resolves the shared agent home with option and environment precedence', () => {
  assert.equal(resolveAgentsHome({
    agentsHome: path.resolve('fixture-agents'),
    environment: { AGENTS_HOME: path.resolve('ignored-agents') },
    homeDirectory: path.resolve('home'),
  }), path.resolve('fixture-agents'));
  assert.equal(resolveAgentsHome({
    environment: { AGENTS_HOME: path.resolve('environment-agents') },
    homeDirectory: path.resolve('home'),
  }), path.resolve('environment-agents'));
});

test('streams usage events, skips malformed lines, and builds eight weekly buckets', async (t) => {
  const file = tempLog(t);
  const now = new Date('2026-07-27T18:04:11.000Z');
  fs.writeFileSync(file, [
    event({ name: 'verify', ts: '2026-07-27T18:04:11.000Z' }),
    '{bad json',
    event({ name: 'verify', ts: '2026-07-13T18:04:11.000Z' }),
    event({ type: 'agent', name: 'reviewer', ts: '2026-07-26T18:04:11.000Z' }),
    event({ type: 'unknown', name: 'ignored', ts: '2026-07-27T18:04:11.000Z' }),
    '',
  ].join('\n'));

  const result = await aggregateUsageLog(file, { now });
  assert.equal(result.malformedLines, 2);
  assert.equal(result.events, 3);
  assert.deepEqual(result.byKey['skill:verify'], {
    type: 'skill',
    name: 'verify',
    count: 2,
    lastUsedAt: '2026-07-27T18:04:11.000Z',
    weeklyBuckets: [0, 0, 0, 0, 0, 1, 0, 1],
  });
  assert.equal(result.byKey['agent:reviewer'].count, 1);
  assert.equal(result.logStartedAt, '2026-07-13T18:04:11.000Z');
});

test('missing usage logs return an empty aggregate', async (t) => {
  const file = tempLog(t);
  assert.deepEqual(await aggregateUsageLog(file), {
    byKey: {},
    bytesRead: 0,
    events: 0,
    logStartedAt: null,
    malformedLines: 0,
  });
});

test('an empty existing log still establishes the cold-skill clock', async (t) => {
  const file = tempLog(t);
  fs.writeFileSync(file, '');
  const result = await aggregateUsageLog(file);
  assert.equal(result.events, 0);
  assert.ok(Number.isFinite(Date.parse(result.logStartedAt)));
});

test('the reader caps work to the newest five megabytes', async (t) => {
  const file = tempLog(t);
  const oldLine = `${event({ name: 'old-skill', ts: '2026-01-01T00:00:00.000Z' })}\n`;
  const newestLine = `${event({ name: 'new-skill', ts: '2026-07-27T00:00:00.000Z' })}\n`;
  fs.writeFileSync(file, oldLine);
  fs.appendFileSync(file, 'x'.repeat(MAX_USAGE_LOG_BYTES + 1024));
  fs.appendFileSync(file, `\n${newestLine}`);

  const result = await aggregateUsageLog(file, {
    now: new Date('2026-07-27T12:00:00.000Z'),
  });
  assert.ok(result.bytesRead <= MAX_USAGE_LOG_BYTES);
  assert.equal(result.byKey['skill:old-skill'], undefined);
  assert.equal(result.byKey['skill:new-skill'].count, 1);
});

test('cold status waits until the log itself is old enough', () => {
  const now = new Date('2026-07-27T00:00:00.000Z');
  assert.equal(isColdUsage({
    usage: null,
    logStartedAt: '2026-07-20T00:00:00.000Z',
    coldSkillDays: 45,
    now,
  }), false);
  assert.equal(isColdUsage({
    usage: null,
    logStartedAt: '2026-05-01T00:00:00.000Z',
    coldSkillDays: 45,
    now,
  }), true);
  assert.equal(isColdUsage({
    usage: { lastUsedAt: '2026-06-01T00:00:00.000Z' },
    logStartedAt: '2026-05-01T00:00:00.000Z',
    coldSkillDays: 45,
    now,
  }), true);
});

test('manual compaction removes old lines while preserving malformed and recent data', async (t) => {
  const file = tempLog(t);
  fs.writeFileSync(file, [
    event({ name: 'old', ts: '2026-01-01T00:00:00.000Z' }),
    '{malformed but retained',
    event({ name: 'recent', ts: '2026-07-20T00:00:00.000Z' }),
    '',
  ].join('\n'));
  const result = await pruneOlderThan(file, 45, {
    now: new Date('2026-07-27T00:00:00.000Z'),
  });
  assert.equal(result.removed, 1);
  assert.equal(result.kept, 2);
  const compacted = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(compacted, /"name":"old"/);
  assert.match(compacted, /malformed but retained/);
  assert.match(compacted, /"name":"recent"/);
});
