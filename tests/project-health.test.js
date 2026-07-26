const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('security and contribution policies describe the real product boundary', () => {
  const security = fs.readFileSync(path.join(root, 'SECURITY.md'), 'utf8');
  assert.match(security, /security\/advisories\/new/);
  assert.match(security, /within three business days/);
  assert.match(security, /127\.0\.0\.1/);
  assert.match(security, /per-launch random token/);
  assert.match(security, /start and stop commands/);
  assert.match(security, /does not include telemetry/);

  const contributing = fs.readFileSync(path.join(root, 'CONTRIBUTING.md'), 'utf8');
  assert.match(contributing, /Node\.js 22\.12/);
  assert.match(contributing, /Windows installer work/);
  assert.match(contributing, /Linux package work/);
  assert.match(contributing, /new project or task type/i);
  assert.match(contributing, /preview-only/);
});

test('version policy covers config, CLI, and local API compatibility', () => {
  const versioning = fs.readFileSync(path.join(root, 'VERSIONING.md'), 'utf8');
  assert.match(versioning, /configuration schemas/);
  assert.match(versioning, /command-line interface/);
  assert.match(versioning, /local HTTP API/);
  assert.match(versioning, /ignore unknown\s+fields/);
});

test('release notes are extracted from the matching changelog section', () => {
  const { releaseNotes } = require('../scripts/extract-release-notes');
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const notes = releaseNotes(changelog, '2.1.0-beta.1');
  assert.match(notes, /Self-contained Electron packages/);
  assert.doesNotMatch(notes, /\[Unreleased\]/);
  assert.throws(() => releaseNotes(changelog, '9.9.9'), /no release section/);
});

test('issue and pull request templates enforce support-safe reports', () => {
  const bug = fs.readFileSync(path.join(root, '.github', 'ISSUE_TEMPLATE', 'bug.yml'), 'utf8');
  const pullRequest = fs.readFileSync(
    path.join(root, '.github', 'PULL_REQUEST_TEMPLATE.md'),
    'utf8',
  );
  assert.match(bug, /Redacted Doctor report/);
  assert.match(bug, /lair doctor/);
  assert.match(pullRequest, /No personal config/);
  assert.match(pullRequest, /No telemetry/);
});
