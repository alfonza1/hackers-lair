const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('UI omits N/A placeholders and ships the curated preference surface', () => {
  assert.doesNotMatch(html, /\bN\/A\b/);
  for (const theme of ['phosphor', 'amber', 'ice', 'crimson', 'ghost']) {
    assert.match(html, new RegExp(`data-theme="${theme}"|value="${theme}"`));
  }
  for (const preference of ['themePreference', 'densityPreference', 'motionPreference', 'fontScalePreference']) {
    assert.match(html, new RegExp(`id="${preference}"`));
  }
  assert.match(html, /\/api\/settings\/preferences/);
  assert.match(html, /if \(pollInFlight \|\| document\.hidden\) return/);
});

test('target cards expose compact details and truthful port groups', () => {
  assert.match(html, /data-toggle-details/);
  assert.match(html, />DETECTED</);
  assert.match(html, />PORTS</);
  assert.match(html, /port-detected/);
  assert.match(html, /points\.length < 5/);
});

test('command palette includes setup and every preference family', () => {
  for (const verb of ['ADD', 'SCAN', 'SETTINGS', 'THEME', 'DENSITY', 'MOTION', 'FONT']) {
    assert.match(html, new RegExp(`verb: '${verb}'`));
  }
  assert.match(html, /component\.hasLog/);
});

test('runtime resilience controls surface backend and log state', () => {
  assert.match(html, /id="backendBanner"/);
  assert.match(html, /syncDesktopBackend/);
  assert.match(html, /onBackendState/);
  assert.match(html, /id="logSummary"/);
  assert.match(html, /id="clearLogs"/);
  assert.match(html, /\/api\/logs\/clear/);
});

test('onboarding and project management never require hand-edited JSON', () => {
  for (const marker of [
    'id="setupWizard"',
    'id="projectEditor"',
    'id="addProject"',
    '/api/projects/configure',
    '/api/projects/remove',
    'chooseWorkspaceFolders',
    'data-wizard-proposal',
    'data-edit-project',
  ]) {
    assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const field of ['uiPorts', 'backendPorts', 'maxRestarts', 'zombieAfterHours']) {
    assert.match(html, new RegExp(`data-editor-field="${field}"`));
  }
});
