const assert = require('node:assert/strict');
const test = require('node:test');

const {
  managedTargetsRunning,
  releaseNotesForVersion,
  releaseVersion,
  updateStateForChannel,
} = require('../lib/update-policy');

test('update policy blocks apply while managed targets are active', () => {
  assert.deepEqual(managedTargetsRunning([
    { name: 'Dormant', running: false, starting: false },
    { name: 'Live API', running: true },
    { name: 'Starting UI', starting: true },
  ]), ['Live API', 'Starting UI']);
});

test('update state enables internal updates only for Squirrel', () => {
  const squirrel = updateStateForChannel('squirrel', {
    label: 'Windows Squirrel installer',
    upgradeCommand: '',
  }, '2.1.0');
  assert.equal(squirrel.mode, 'internal');
  assert.equal(squirrel.status, 'checking');
  assert.equal(squirrel.releaseUrl, 'https://github.com/hackerslairhq/desktop/releases');

  const scoop = updateStateForChannel('scoop', {
    label: 'Scoop',
    upgradeCommand: 'scoop update hackerslair',
  }, '2.1.0');
  assert.equal(scoop.mode, 'manual');
  assert.match(scoop.upgradeCommand, /scoop update/);
});

test('release version parsing accepts GitHub release labels', () => {
  assert.equal(releaseVersion("Hacker's Lair v2.2.0-beta.1"), '2.2.0-beta.1');
  assert.equal(releaseVersion('', 'unknown'), 'unknown');
});

test('update state includes the bundled notes for the installed release', () => {
  const changelog = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '',
    '- Future work.',
    '',
    '## [2.1.0-beta.2] - 2026-07-26',
    '',
    '### Fixed',
    '',
    '- Portable channel behavior.',
    '',
    '## [2.1.0-beta.1] - 2026-07-25',
    '',
    '- Earlier release.',
  ].join('\n');
  const releaseNotes = releaseNotesForVersion(changelog, '2.1.0-beta.2');
  assert.equal(
    releaseNotes,
    '### Fixed\n\n- Portable channel behavior.',
  );

  const state = updateStateForChannel('powershell', {
    label: 'PowerShell portable',
    upgradeCommand: 'irm https://example.invalid/install.ps1 | iex',
  }, '2.1.0-beta.2', releaseNotes);
  assert.equal(state.releaseNotes, releaseNotes);
});
