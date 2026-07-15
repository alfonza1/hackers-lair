const assert = require('node:assert/strict');
const test = require('node:test');

const { performPowerAction } = require('../lib/app-power');

function fakeElectronApp() {
  const calls = [];
  return {
    calls,
    relaunch: () => calls.push('relaunch'),
    exit: (code) => calls.push(`exit:${code}`),
  };
}

test('restart schedules a relaunch before exiting cleanly', () => {
  const app = fakeElectronApp();

  assert.equal(performPowerAction('restart', app), true);
  assert.deepEqual(app.calls, ['relaunch', 'exit:0']);
});

test('shutdown exits without scheduling a relaunch', () => {
  const app = fakeElectronApp();

  assert.equal(performPowerAction('shutdown', app), true);
  assert.deepEqual(app.calls, ['exit:0']);
});

test('unknown power actions are rejected', () => {
  const app = fakeElectronApp();

  assert.equal(performPowerAction('hibernate', app), false);
  assert.deepEqual(app.calls, []);
});
