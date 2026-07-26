const assert = require('node:assert/strict');
const test = require('node:test');

const {
  managedTargetsRunning,
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
