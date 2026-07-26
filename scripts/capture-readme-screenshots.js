const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const { configurationPrompts } = require('../lib/onboarding-prompts');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'docs', 'screenshots');
const now = Date.UTC(2026, 6, 12, 20, 0, 0);
const pause = (milliseconds) => Atomics.wait(
  new Int32Array(new SharedArrayBuffer(4)),
  0,
  0,
  milliseconds,
);
const component = (name, role, port, running, pid) => ({
  name, role, port, command: 'npm run dev', cwd: `C:\\Workspaces\\${name}`, match: `C:\\Workspaces\\${name}`,
  running, status: running ? 'running' : 'stopped', error: '', pids: pid ? [pid] : [], pid: pid || null,
  path: `C:\\Workspaces\\${name}`, memKB: running ? 186240 : 0, cpuPercent: running ? 2.4 : null,
  uptimeSeconds: running ? 8421 : null, lastActionAt: now - 420000, livePorts: running ? [port] : [],
  detectedUrls: running && port ? [`http://localhost:${port}`] : [],
  configuredPorts: !running && port ? [port] : [],
  hasLog: running,
});
const telemetry = (cpuPercent, memKB) => Array.from({ length: 8 }, (_, index) => ({
  at: now - ((7 - index) * 2500),
  cpuPercent: Math.max(0.1, cpuPercent + (((index % 3) - 1) * 0.7)),
  memKB: memKB + (((index % 4) - 2) * 4096),
}));
const gitAttention = (root, branch, overrides = {}) => {
  const repository = {
    root,
    branch,
    detached: false,
    upstream: `origin/${branch}`,
    ahead: 0,
    behind: 0,
    dirty: false,
    changedPaths: 0,
    commitCount: 0,
    ...overrides,
  };
  const dirtyRepositories = repository.dirty ? 1 : 0;
  const withoutUpstream = repository.upstream ? 0 : 1;
  return {
    repositories: [repository],
    summary: {
      level: dirtyRepositories || repository.ahead || repository.behind || withoutUpstream ? 'attention' : 'clean',
      dirtyRepositories,
      changedPaths: repository.changedPaths,
      ahead: repository.ahead,
      behind: repository.behind,
      localCommits: repository.commitCount,
      withoutUpstream,
      protectedBranchDirty: repository.dirty && ['main', 'master'].includes(branch),
      detached: repository.detached,
    },
  };
};
const projects = [
  { name: 'nightwatch-relay', type: 'Vite + Node API', gitBranches: ['feature/relay-observability'], gitAttention: gitAttention('C:\\Workspaces\\nightwatch-relay', 'feature/relay-observability', { dirty: true, changedPaths: 2, ahead: 3, commitCount: 684 }), components: [component('relay-ui', 'frontend', 5173, true, 18420), component('relay-api', 'backend', 4100, true, 22108)], running: true, partial: false, errored: false, starting: false, pids: [18420, 22108], memKB: 372480, cpuPercent: 4.8, uptimeSeconds: 8421, lastActionAt: now - 420000, telemetry: telemetry(4.8, 372480) },
  { name: 'atlas-worker', type: 'Python task runner', gitBranches: ['main'], gitAttention: gitAttention('C:\\Workspaces\\atlas-worker', 'main', { commitCount: 217 }), components: [component('atlas-worker', 'headless', null, true, 27144)], running: true, partial: false, errored: false, starting: false, pids: [27144], memKB: 92160, cpuPercent: 1.1, uptimeSeconds: 3644, lastActionAt: now - 910000, telemetry: telemetry(1.1, 92160) },
  { name: 'static-forge', type: 'Next.js workspace', gitBranches: ['release/next'], gitAttention: gitAttention('C:\\Workspaces\\static-forge', 'release/next', { commitCount: 93 }), components: [component('static-forge', 'fullstack', 3000, false)], running: false, partial: false, errored: false, starting: false, pids: [], memKB: 0, cpuPercent: null, uptimeSeconds: null, lastActionAt: now - 7200000 },
];
const processes = [
  { pid: 18420, name: 'node.exe', label: 'Nightwatch UI', cmd: 'node vite.js', exePath: 'C:\\Program Files\\nodejs\\node.exe', cwd: 'C:\\Workspaces\\nightwatch-relay', memKB: 186240, uptimeSeconds: 8421, cpuPercent: 2.4, self: false, protected: false, system: false, ports: [{ port: 5173, addresses: ['127.0.0.1'] }] },
  { pid: 22108, name: 'node.exe', label: 'Relay API', cmd: 'node server.js', exePath: 'C:\\Program Files\\nodejs\\node.exe', cwd: 'C:\\Workspaces\\nightwatch-relay', memKB: 174080, uptimeSeconds: 8390, cpuPercent: 1.7, self: false, protected: false, system: false, ports: [{ port: 4100, addresses: ['127.0.0.1'] }] },
  { pid: 30112, name: 'python.exe', label: 'Telemetry Lab', cmd: 'python telemetry.py', exePath: 'C:\\Python312\\python.exe', cwd: 'C:\\Workspaces\\telemetry-lab', memKB: 78400, uptimeSeconds: 1922, cpuPercent: 0.6, self: false, protected: false, system: false, ports: [{ port: 8088, addresses: ['127.0.0.1'] }] },
];
const stopped = [{ id: 'demo-stopped', name: 'node.exe', label: 'Archive Preview', cmd: 'npm run preview', cwd: 'C:\\Workspaces\\archive-preview', ports: [{ port: 4173 }], stoppedAt: now - 840000 }];
const scripts = [
  { file: 'session-watchdog.au3', path: 'C:\\Automation\\session-watchdog.au3', name: 'session-watchdog', description: 'Monitors the active workstation session and closes the routine when its stop condition is detected.', modifiedAt: now - 3600000, running: true, pids: [31640], pid: 31640, uptimeSeconds: 1288, memKB: 14336 },
  { file: 'nightly-cleanup.au3', path: 'C:\\Automation\\nightly-cleanup.au3', name: 'nightly-cleanup', description: 'Runs the local workspace cleanup sequence for generated caches and temporary files.', modifiedAt: now - 86400000, running: false, pids: [], pid: null, uptimeSeconds: null, memKB: 0 },
  { file: 'focus-mode.au3', path: 'C:\\Automation\\focus-mode.au3', name: 'focus-mode', description: 'Applies the operator focus layout and restores the previous desktop state when stopped.', modifiedAt: now - 172800000, running: false, pids: [], pid: null, uptimeSeconds: null, memKB: 0 },
];
const fixtures = {
  '/api/system': { node: 'NIGHTHAWK-07', status: 'ONLINE', mode: 'PROCESS CONTROL', pid: 9000, port: 4949, cpuPercent: 18.7, memory: { totalKB: 33554432, freeKB: 18874368, usedPercent: 43.8 } },
  '/api/projects': { projects, configError: null },
  '/api/processes': { self: 9000, port: 4949, processes, stopped },
  '/api/scripts': { scripts, configured: true, configError: null },
  '/api/onboarding': { configured: true, projectCount: projects.length, personalSkillCount: 3, prompts: [] },
  '/api/settings': {
    enableSkills: false,
    workspaceFolders: [],
    uiPreferences: { theme: 'phosphor', density: 'comfortable', motion: 'full', fontScale: 100 },
    configError: null,
  },
  '/api/doctor': { status: 'pass', failures: 0, warnings: 0, checks: [] },
  '/api/templates': { templates: [] },
  '/api/config/backups': { backups: [] },
  '/api/schema/projects': { title: "Hacker's Lair project configuration", $defs: { component: { properties: {} } } },
};
const onboardingFixtures = {
  '/api/projects': { projects: [] },
  '/api/onboarding': {
    configured: false,
    projectCount: 0,
    personalSkillCount: 0,
    prompts: configurationPrompts({
      projectsFile: 'C:\\Workspaces\\.lair-data\\projects.json',
      projectsSchemaFile: 'C:\\Workspaces\\.lair-data\\projects.schema.json',
      projectsSchemaUrl: 'http://localhost:4949/api/schema/projects',
      skillsDirectory: 'C:\\Workspaces\\.agents\\skills',
      projectCount: 0,
      personalSkillCount: 0,
      enableSkills: false,
      workspaceFolders: ['C:\\Workspaces'],
    }),
  },
};

const injection = `<style>
  .boot-sequence,.signal-rain,.power-sequence{display:none!important}
  body::before,body::after,.panel::before,h1[data-text]::before{content:none!important}
  .cinematic-ready .topbar,.cinematic-ready .panel{animation:none!important;opacity:1!important;transform:none!important;clip-path:none!important}
  *,*::before,*::after{animation:none!important;transition:none!important}
</style><script>
  try {
    localStorage.clear();
    localStorage.setItem('hackersLair.cinematicSeen', '1');
    localStorage.setItem('hackersLair.uiPreferences', JSON.stringify({
      theme: 'phosphor',
      density: 'comfortable',
      motion: 'reduced',
      fontScale: 100,
    }));
  } catch {}
  const FixedDate = Date;
  window.Date = class extends FixedDate {
    constructor(...args) { super(...(args.length ? args : [${now}])); }
    static now() { return ${now}; }
  };
  const demoFixtures = ${JSON.stringify(fixtures)};
  const onboardingFixtures = ${JSON.stringify(onboardingFixtures)};
  window.fetch = async (input) => {
    const key = Object.keys(demoFixtures).find((route) => String(input).startsWith(route));
    const onboardingPayload = ['#onboarding', '#wizard'].includes(location.hash) ? onboardingFixtures[key] : null;
    const payload = onboardingPayload || (key ? demoFixtures[key] : { error: 'Demo route unavailable' });
    return new Response(JSON.stringify(payload), { status: key ? 200 : 404, headers: { 'Content-Type': 'application/json' } });
  };
  addEventListener('DOMContentLoaded', () => setTimeout(() => {
    const bootSequence = document.getElementById('bootSequence');
    if (bootSequence) bootSequence.style.display = 'none';
    const view = location.hash.slice(1);
    if (['processes', 'scripts'].includes(view)) document.querySelector('[data-view="' + view + '"]')?.click();
    if (view === 'wizard') document.querySelector('[data-onboarding-wizard]')?.click();
  }, 120));
</script>`;

const source = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8')
  .replaceAll('__LAIR_CSP_NONCE__', 'docs')
  .replace(
    '/*__LAIR_BOOTSTRAP_PAYLOAD__*/',
    'window.__LAIR_BOOTSTRAP__ = Object.freeze({"token":"docs","nonce":"docs","port":4949});',
  );
const iconUrl = pathToFileURL(path.join(root, 'icon.ico')).href;
const applicationScriptIndex = source.lastIndexOf('<script nonce="docs">');
if (applicationScriptIndex < 0) throw new Error('Application script marker was not found.');
const fixtureHtml = `${source.slice(0, applicationScriptIndex)}${injection}\n${source.slice(applicationScriptIndex)}`
  .replace(/src="\/icon\.ico[^\"]*"/g, `src="${iconUrl}"`);
const fixturePath = path.join(os.tmpdir(), 'hackers-lair-readme-fixture.html');
fs.writeFileSync(fixturePath, fixtureHtml);
fs.mkdirSync(outputDir, { recursive: true });

const edge = process.env.EDGE_PATH || path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
if (!fs.existsSync(edge)) throw new Error('Microsoft Edge was not found. Set EDGE_PATH to a Chromium executable.');

for (const [name, hash] of [['targets', ''], ['onboarding', '#onboarding'], ['wizard', '#wizard'], ['port-signals', '#processes'], ['scripts', '#scripts']]) {
  const output = path.join(outputDir, `${name}.png`);
  const profile = path.join(os.tmpdir(), `hackers-lair-readme-${name}-${process.pid}`);
  fs.rmSync(output, { force: true });
  fs.rmSync(profile, { recursive: true, force: true });
  const capture = spawnSync(edge, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    '--window-size=1600,1000',
    '--virtual-time-budget=6500',
    `--screenshot=${output}`,
    `${pathToFileURL(fixturePath).href}${hash}`,
  ], { encoding: 'utf8', stdio: 'pipe' });
  if (capture.status !== 0) throw new Error(`Edge failed to capture ${name}: ${capture.stderr.trim()}`);
  const screenshotDeadline = Date.now() + 10_000;
  let lastSize = -1;
  let stableReads = 0;
  while (Date.now() < screenshotDeadline && stableReads < 5) {
    const size = fs.existsSync(output) ? fs.statSync(output).size : 0;
    stableReads = size > 0 && size === lastSize ? stableReads + 1 : 0;
    lastSize = size;
    pause(100);
  }
  try {
    fs.rmSync(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    console.warn(`Edge still holds its temporary profile; Windows will clean it later: ${profile}`);
  }
  if (!fs.existsSync(output)) throw new Error(`Edge did not create ${output}.`);
  console.log(`Captured ${path.relative(root, output)}`);
}
