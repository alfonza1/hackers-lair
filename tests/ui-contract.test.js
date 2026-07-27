const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('a raw app shell fails closed with an actionable stale-server message', () => {
  const bootstrapScript = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(bootstrapScript);
  const context = {
    URLSearchParams,
    document: {
      documentElement: {
        classList: { add() {} },
        dataset: {},
        style: { setProperty() {} },
      },
    },
    localStorage: { getItem: () => null },
    location: { search: '' },
    window: {},
  };

  assert.doesNotThrow(() => vm.runInNewContext(bootstrapScript, context));
  assert.throws(
    () => context.window.__LAIR_BOOTSTRAP__.token,
    /outdated Hacker's Lair process.*reopen Hacker's Lair/i,
  );
});

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
  for (const verb of ['ADD', 'SCAN', 'SETTINGS', 'UPDATES', 'THEME', 'DENSITY', 'MOTION', 'FONT']) {
    assert.match(html, new RegExp(`verb: '${verb}'`));
  }
  assert.match(html, /component\.hasLog/);
});

test('updates and release notes live in the Settings dialog', () => {
  assert.doesNotMatch(html, /id="updateBanner"/);
  assert.match(html, /aria-label="Settings"/);
  assert.doesNotMatch(html, />UI preferences</);
  assert.match(html, /id="updatesTrigger"/);
  assert.match(html, /id="settingsUpdateDot"/);
  assert.match(html, /id="settingsUpdateBadge"/);
  assert.match(html, /id="updateDialog"/);
  assert.match(html, /id="copyUpdateCommand"/);
  assert.match(html, /id="releaseNotesBody"/);
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
  assert.match(html, /class="setup-recommendation"[^>]*>Recommended</);
  assert.match(html, /error\.data\?\.portConflicts/);
  assert.match(server, /findProjectPortConflicts/);
});

test('project setup can cancel safely and browse outside the Electron host', () => {
  assert.equal((html.match(/value="cancel"[^>]*formnovalidate/g) || []).length, 2);
  assert.match(html, /postJson\('\/api\/dialog\/workspace-folders', \{\}\)/);
  assert.match(server, /pathname === '\/api\/dialog\/workspace-folders'/);
  assert.match(server, /platform\.chooseWorkspaceFolders\(\)/);
});
