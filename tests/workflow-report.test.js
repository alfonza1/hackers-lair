const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { generateWorkflowReport } = require('../lib/workflow-report');

test('workflow report composes supplied local findings without rescanning', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-report-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = generateWorkflowReport({
    reportsDirectory: root,
    date: new Date('2026-07-27T12:00:00Z'),
    usage: [{ name: 'verify', count: 4 }],
    coldSkills: ['unused'],
    frictionGroups: [{ tag: 'missed-test', count: 3 }],
    counts: { lint: 2, drift: 1, stale: 3, coverage: 1 },
    skillsRepo: { dirtyFiles: 2, unpushedCommits: 1 },
  });
  assert.equal(path.basename(result.file), '2026-07-27.md');
  assert.match(result.markdown, /verify.*4/s);
  assert.match(result.markdown, /missed-test.*3/s);
  assert.equal(fs.readFileSync(result.file, 'utf8'), result.markdown);
});

test('workflow report lists only skills that became cold since the prior report', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-report-cold-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  generateWorkflowReport({
    reportsDirectory: root,
    date: new Date('2026-07-20T12:00:00Z'),
    coldSkills: ['already-cold'],
  });
  const next = generateWorkflowReport({
    reportsDirectory: root,
    date: new Date('2026-07-27T12:00:00Z'),
    coldSkills: ['already-cold', 'newly-cold'],
  });
  assert.match(next.markdown, /## Newly cold skills\r?\n- newly-cold/);
  assert.doesNotMatch(
    next.markdown.split('## Friction hot spots')[0],
    /\r?\n- already-cold/,
  );
});
