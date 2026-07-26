const assert = require('node:assert/strict');
const test = require('node:test');

const { performPowerAction } = require('../lib/app-power');

function fakeElectronApp() {
  const calls = [];
  return {
    calls,
    relaunch: () => calls.push('relaunch'),
    quit: () => calls.push('quit'),
  };
}

test('restart schedules a relaunch before exiting cleanly', () => {
  const app = fakeElectronApp();

  assert.equal(performPowerAction('restart', app), true);
  assert.deepEqual(app.calls, ['relaunch', 'quit']);
});

test('shutdown exits without scheduling a relaunch', () => {
  const app = fakeElectronApp();

  assert.equal(performPowerAction('shutdown', app), true);
  assert.deepEqual(app.calls, ['quit']);
});

test('unknown power actions are rejected', () => {
  const app = fakeElectronApp();

  assert.equal(performPowerAction('hibernate', app), false);
  assert.deepEqual(app.calls, []);
});
