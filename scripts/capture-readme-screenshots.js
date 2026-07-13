const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'docs', 'screenshots');
const now = Date.UTC(2026, 6, 12, 20, 0, 0);
const component = (name, role, port, running, pid) => ({
  name, role, port, command: 'npm run dev', cwd: `C:\\Workspaces\\${name}`, match: `C:\\Workspaces\\${name}`,
  running, status: running ? 'running' : 'stopped', error: '', pids: pid ? [pid] : [], pid: pid || null,
  path: `C:\\Workspaces\\${name}`, memKB: running ? 186240 : 0, cpuPercent: running ? 2.4 : null,
  uptimeSeconds: running ? 8421 : null, lastActionAt: now - 420000, livePorts: running ? [port] : [],
});
const projects = [
  { name: 'nightwatch-relay', type: 'Vite + Node API', components: [component('relay-ui', 'frontend', 5173, true, 18420), component('relay-api', 'backend', 4100, true, 22108)], running: true, partial: false, errored: false, starting: false, pids: [18420, 22108], memKB: 372480, cpuPercent: 4.8, uptimeSeconds: 8421, lastActionAt: now - 420000 },
  { name: 'atlas-worker', type: 'Python task runner', components: [component('atlas-worker', 'headless', null, true, 27144)], running: true, partial: false, errored: false, starting: false, pids: [27144], memKB: 92160, cpuPercent: 1.1, uptimeSeconds: 3644, lastActionAt: now - 910000 },
  { name: 'static-forge', type: 'Next.js workspace', components: [component('static-forge', 'fullstack', 3000, false)], running: false, partial: false, errored: false, starting: false, pids: [], memKB: 0, cpuPercent: null, uptimeSeconds: null, lastActionAt: now - 7200000 },
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
  '/api/projects': { projects },
  '/api/processes': { self: 9000, port: 4949, processes, stopped },
  '/api/scripts': { scripts },
};

const injection = `<style>.boot-sequence{display:none!important}*,*::before,*::after{animation:none!important;transition:none!important}</style><script>
  try { localStorage.clear(); } catch {}
  const FixedDate = Date;
  window.Date = class extends FixedDate {
    constructor(...args) { super(...(args.length ? args : [${now}])); }
    static now() { return ${now}; }
  };
  window.requestAnimationFrame = () => 0;
  const demoFixtures = ${JSON.stringify(fixtures)};
  window.fetch = async (input) => {
    const key = Object.keys(demoFixtures).find((route) => String(input).startsWith(route));
    return new Response(JSON.stringify(key ? demoFixtures[key] : { error: 'Demo route unavailable' }), { status: key ? 200 : 404, headers: { 'Content-Type': 'application/json' } });
  };
  addEventListener('DOMContentLoaded', () => setTimeout(() => {
    const bootSequence = document.getElementById('bootSequence');
    if (bootSequence) bootSequence.style.display = 'none';
    const view = location.hash.slice(1);
    if (['processes', 'scripts'].includes(view)) document.querySelector('[data-view="' + view + '"]')?.click();
  }, 120));
</script>`;

const source = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const iconUrl = pathToFileURL(path.join(root, 'icon.ico')).href;
const fixtureHtml = source
  .replace(/src="\/icon\.ico[^\"]*"/g, `src="${iconUrl}"`)
  .replace('<script>', `${injection}\n<script>`);
const fixturePath = path.join(os.tmpdir(), 'hackers-lair-readme-fixture.html');
fs.writeFileSync(fixturePath, fixtureHtml);
fs.mkdirSync(outputDir, { recursive: true });

const edge = process.env.EDGE_PATH || path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
if (!fs.existsSync(edge)) throw new Error('Microsoft Edge was not found. Set EDGE_PATH to a Chromium executable.');

for (const [name, hash] of [['targets', ''], ['port-signals', '#processes'], ['scripts', '#scripts']]) {
  const output = path.join(outputDir, `${name}.png`);
  fs.rmSync(output, { force: true });
  spawnSync(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1600,1000', '--virtual-time-budget=6500', `--screenshot=${output}`, `${pathToFileURL(fixturePath).href}${hash}`], { stdio: 'pipe' });
  if (!fs.existsSync(output)) throw new Error(`Edge did not create ${output}.`);
  console.log(`Captured ${path.relative(root, output)}`);
}
