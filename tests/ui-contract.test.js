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

test('UI omits N/A placeholders and keeps persisted preference behavior', () => {
  assert.doesNotMatch(html, /\bN\/A\b/);
  for (const theme of ['phosphor', 'ultraviolet', 'ice', 'volt', 'ghost']) {
    assert.match(html, new RegExp(`data-theme="${theme}"|'${theme}'`));
  }
  assert.doesNotMatch(html, /<option value="(?:amber|crimson)">/);
  assert.match(html, /amber:\s*'ultraviolet'/);
  assert.match(html, /crimson:\s*'volt'/);
  assert.match(html, /\/api\/settings\/preferences/);
  assert.match(html, /if \(pollInFlight \|\| document\.hidden\) return/);
});

test('target cards expose compact details and truthful port groups', () => {
  assert.match(html, /data-toggle-details/);
  assert.match(html, />DETECTED</);
  assert.match(html, />PORTS</);
  assert.match(html, /port-detected/);
  assert.match(html, /points\.length < 5/);
  assert.match(html, /<div class="action-cluster compact">\s*\$\{active\s*\?\s*actionButton\('project', 'terminate'/);
  assert.doesNotMatch(html, /\$\{actionButton\('project', 'terminate'[^}]+}\s*\$\{actionButton\('project', 'initiate'/);
});

test('command palette includes setup, release, conditional update, and every preference family', () => {
  for (const verb of ['ADD', 'SCAN', 'RELEASE', 'UPDATE', 'THEME', 'DENSITY', 'MOTION', 'FONT', 'PANEL']) {
    assert.match(html, new RegExp(`verb: '${verb}'`));
  }
  assert.doesNotMatch(html, /verb: 'SETTINGS'/);
  assert.match(html, /Enable launch on startup/);
  assert.match(html, /if \(state\.scriptsSupported\) \{\s*commands\.push\(\{\s*verb: 'PANEL'/);
  assert.doesNotMatch(html, /Enable launch at login/);
  assert.match(html, /component\.hasLog/);
});

test('update badge and Settings keep release controls minimal', () => {
  assert.doesNotMatch(html, /id="updateBanner"/);
  assert.match(html, /id="updateAvailableTrigger"/);
  assert.match(html, /id="releaseNotesTrigger"/);
  assert.match(html, /id="settingsPopover"[\s\S]+id="releaseNotesTrigger"/);
  assert.match(html, /id="updateDialog"/);
  assert.match(html, /id="copyUpdateCommand"/);
  assert.doesNotMatch(html, /id="releaseNotesBody"/);
  assert.doesNotMatch(html, /id="updateCurrentVersion"/);
  assert.doesNotMatch(html, /id="updateChannel"/);
  assert.doesNotMatch(html, /id="updateStatus"/);
});

test('Settings contains panel visibility, appearance, startup, and release controls', () => {
  assert.match(html, /id="settingsTrigger"[^>]*aria-label="Settings"[^>]*><span aria-hidden="true">⚙<\/span>/);
  assert.doesNotMatch(html, /id="settingsTrigger"[^>]*>Settings<\/button>/);
  assert.match(html, /id="settingsPopover"[^>]*hidden/);
  assert.match(html, /id="skillsPanelEnabled"[^>]*role="switch"/);
  assert.match(html, /id="scriptsPanelEnabled"[^>]*role="switch"/);
  assert.match(html, /\/api\/settings\/features/);
  assert.match(html, /id="launchOnStartup"[^>]*role="switch"/);
  assert.match(html, /<strong>Launch on startup<\/strong>/);
  assert.doesNotMatch(html, /Launch at login/);
  for (const preference of ['themePreference', 'densityPreference', 'motionPreference', 'fontScalePreference']) {
    assert.match(html, new RegExp(`id="${preference}"`));
  }
  assert.match(html, /id="settingsSync"/);
  assert.match(html, /select option[\s\S]*background(?:-color)?:\s*var\(--panel-solid\)/);
  assert.match(html, /<strong>Release notes<\/strong>/);
});

test('AI workflow setup is opt-in, reviewable, and local-only', () => {
  assert.match(html, /Disabled by default for privacy/);
  assert.match(html, /data-ai-action="copy-json">Copy JSON/);
  assert.match(html, /data-ai-action="install-hook">Install for me/);
  assert.match(html, /data-ai-action="copy-prompt">Copy agent prompt/);
  assert.match(html, /data-ai-action="compact-log">Compact log/);
  assert.match(html, /Session feed[\s\S]*Sensitive and off by default/);
  assert.match(html, /HOOK_INSTALLED/);
  assert.match(html, /USAGE_LOG_COMPACTED/);
});

test('Skills maintenance cards expose health, usage, ratings, context, and guarded lifecycle actions', () => {
  assert.match(html, /id="newSkill"[^>]*>\+ New Skill/);
  assert.match(html, /id="contextTaxTrigger"/);
  assert.match(html, /class="skill-health/);
  assert.match(html, /skillSparkline/);
  assert.match(html, /data-skill-rate="positive"/);
  assert.match(html, /data-skill-rate="negative"/);
  assert.match(html, /data-skill-archive/);
  assert.match(html, /id="archiveSkillDialog"/);
  assert.match(html, /timestamped backup/);
  assert.doesNotMatch(html, /confirm\(`Archive|window\.confirm\([^)]*skill/i);
  assert.match(html, /Archived skills/);
  assert.match(html, /data-skill-unarchive/);
  assert.match(html, /CONTEXT_TAX_SCANNED/);
});

test('AI maintenance loop captures friction, tests routing, and protects instruction paths', () => {
  assert.match(html, /id="frictionCapture"/);
  assert.match(html, /data-skill-route-input/);
  assert.match(html, /Which skill would fire\?/);
  assert.match(html, /id="instructionsTab"[^>]*data-view="instructions"/);
  assert.match(html, /data-instruction-action="editor"/);
  assert.match(html, /data-instruction-action="reveal"/);
  assert.match(html, /data-instruction-action="drift"/);
  assert.match(html, /Recurring|Three repeats suggest/);
  assert.match(html, /data-friction-scaffold/);
  assert.match(html, /FRICTION_LOGGED/);
  assert.match(html, /INSTRUCTION_DRIFT_CHECKED/);
  assert.match(server, /req\.url === '\/api\/ai\/friction'/);
  assert.match(server, /req\.url === '\/api\/ai\/instructions\/drift'/);
  assert.match(server, /instructionRecords\(settings\)\.find\(\(item\) => item\.id === id\)/);
});

test('Agent Ops keeps wider workflow inventories in one read-only filtered view', () => {
  assert.match(html, /id="agentOpsTab"[^>]*data-view="agentOps"/);
  for (const filter of ['agents', 'commands', 'mcp', 'permissions', 'hooks']) {
    assert.match(html, new RegExp(`data-agent-ops-filter="\\$\\{filter\\}"|\\['${filter}',`));
  }
  assert.match(html, /AGENT_OPS_SYNCED/);
  assert.match(html, /\/api\/ai\/ops/);
  assert.match(server, /listAgents/);
  assert.match(server, /listCommands/);
  assert.match(server, /listMcpServers/);
  assert.match(server, /permissionsView/);
  assert.match(server, /listConfiguredHooks/);
  assert.doesNotMatch(html, /data-agent-ops-(?:edit|delete|install)/);
});

test('workflow freshness and reporting stay local unless link checks are explicitly clicked', () => {
  for (const filter of ['sessions', 'memory', 'coverage', 'parity']) {
    assert.match(html, new RegExp(`\\['${filter}',`));
  }
  assert.match(html, /data-check-urls="skill"/);
  assert.match(html, /data-check-urls="instruction"/);
  assert.match(html, /data-workflow-action="report"/);
  assert.match(html, /data-workflow-action="export"/);
  assert.match(html, /data-workflow-action="repair-prompt"/);
  assert.match(html, /data-coverage-open/);
  assert.match(html, /Skills repo has unpublished changes/);
  assert.match(html, /Session feed is off/);
  assert.match(html, /WORKFLOW_URLS_CHECKED/);
  assert.match(html, /REPORT_GENERATED/);
  assert.match(html, /WORKFLOW_BUNDLE_EXPORTED/);
  assert.match(server, /req\.url === '\/api\/ai\/check-urls'/);
  assert.match(server, /req\.url === '\/api\/ai\/report'/);
  assert.match(server, /req\.url === '\/api\/ai\/export'/);
  assert.match(server, /req\.url === '\/api\/ai\/repair-prompt'/);
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
