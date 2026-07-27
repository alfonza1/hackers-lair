const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeUiPreferences,
  THEMES,
  validateUiPreferences,
} = require('../lib/ui-preferences');

test('ships the curated themes and maps retired themes to their replacements', () => {
  assert.deepEqual(THEMES, ['phosphor', 'ultraviolet', 'ice', 'volt', 'ghost']);
  assert.equal(normalizeUiPreferences({ theme: 'amber' }).theme, 'ultraviolet');
  assert.equal(normalizeUiPreferences({ theme: 'crimson' }).theme, 'volt');
  assert.doesNotThrow(() => validateUiPreferences({
    theme: 'ultraviolet',
    density: 'comfortable',
    motion: 'full',
    fontScale: 100,
  }));
  assert.throws(() => validateUiPreferences({
    theme: 'amber',
    density: 'comfortable',
    motion: 'full',
    fontScale: 100,
  }), /uiPreferences\.theme/i);
});
