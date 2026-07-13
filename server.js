// Hacker's Lair — lists processes listening on local ports and can stop them.
// No dependencies; Windows-only (uses netstat + tasklist + taskkill).

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFile, spawn } = require('child_process');
const { gitBranchesForProject } = require('./lib/git-branches');
const { listSkills } = require('./lib/skill-registry');

const PORT = Number(process.env.PORT) || 4949;
const MAX_PORT_TRIES = 10;
const CONFIGURED_COMMAND_TIMEOUT_MS = 60_000;
const DATA_DIR = process.env.PROJECT_MANAGER_DATA_DIR || __dirname;
const STORE = path.join(DATA_DIR, 'stopped.json');
const MAX_STOPPED = 40;
const FIREFOX_CANDIDATES = [
  process.env.FIREFOX_PATH,
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Mozilla Firefox', 'firefox.exe'),
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Mozilla Firefox', 'firefox.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Mozilla Firefox', 'firefox.exe'),
].filter(Boolean);

function findFirefox() {
  return FIREFOX_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || null;
}

function environmentWithFirefox() {
  const firefox = findFirefox();
  return firefox ? { ...process.env, BROWSER: firefox } : process.env;
}

// Apps stopped from the UI, remembered (with their command line + working dir)
// so they can be restarted. Persisted to disk so the list survives a restart.
let stopped = [];
try { stopped = JSON.parse(fs.readFileSync(STORE, 'utf8')); if (!Array.isArray(stopped)) stopped = []; } catch { stopped = []; }
function saveStopped() {
  try { fs.writeFileSync(STORE, JSON.stringify(stopped, null, 2)); } catch { /* best effort */ }
}
// Drop remembered apps whose first port is listening again — they're back.
function reconcileStopped(live) {
  const livePorts = new Set();
  for (const p of live) for (const x of p.ports) livePorts.add(x.port);
  const before = stopped.length;
  stopped = stopped.filter((s) => !(s.ports[0] && livePorts.has(s.ports[0].port)));
  if (stopped.length !== before) saveStopped();
}

// Never allow killing these — taking them down can break Windows itself.
const PROTECTED_PIDS = new Set([0, 4, process.pid]);
const PROTECTED_NAMES = new Set([
  'system', 'system idle process', 'idle', 'registry', 'memory compression',
  'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe',
  'services.exe', 'lsass.exe', 'svchost.exe',
]);

// Shown under the "system" filter (hidden by default in the UI) but killable if not protected.
const SYSTEM_NAMES = new Set([
  ...PROTECTED_NAMES,
  'spoolsv.exe', 'dns.exe', 'mdnsresponder.exe', 'dashost.exe',
  'wslrelay.exe', 'vmcompute.exe', 'com.docker.backend.exe',
]);

// Pretty names for dev tools found in node_modules paths.
const PACKAGE_LABELS = {
  'vite': 'Vite', 'react-scripts': 'React (CRA)', 'next': 'Next.js', 'remix': 'Remix',
  'astro': 'Astro', 'nuxt': 'Nuxt', 'webpack': 'Webpack', 'webpack-dev-server': 'Webpack',
  'nodemon': 'nodemon', 'ts-node': 'ts-node', 'ts-node-dev': 'ts-node-dev', 'tsx': 'tsx',
  'turbo': 'Turborepo', 'parcel': 'Parcel', '@angular': 'Angular', 'expo': 'Expo',
  'storybook': 'Storybook', 'strapi': 'Strapi', 'nest': 'NestJS', '@nestjs': 'NestJS',
  'json-server': 'json-server', 'serve': 'serve', 'http-server': 'http-server',
  'live-server': 'live-server', 'npm': 'npm', 'pnpm': 'pnpm', 'yarn': 'yarn',
};

function splitArgs(cmd) {
  const re = /"([^"]*)"|(\S+)/g;
  const out = [];
  let m;
  while ((m = re.exec(cmd))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

// Derive "project · tool" or "folder · script.js" from a raw command line.
function friendlyLabel(cmd) {
  if (!cmd) return null;

  // Running something out of node_modules: grab project folder + package name.
  const pkgMatch = cmd.match(/([^\\/"]+)[\\/]node_modules[\\/](?:\.bin[\\/])?(@[^\\/"\s]+|[^\\/"\s]+)/i);
  if (pkgMatch) {
    const project = pkgMatch[1];
    const pkg = pkgMatch[2].toLowerCase();
    const tool = PACKAGE_LABELS[pkg] || pkg;
    if (/^(node(js)?|program files.*)$/i.test(project)) return tool;
    return `${project} · ${tool}`;
  }

  // Otherwise: first script-looking argument, shown with its parent folder.
  for (const arg of splitArgs(cmd).slice(1)) {
    if (!/\.(mjs|cjs|jsx?|tsx?|py)$/i.test(arg)) continue;
    const segs = arg.split(/[\\/]/).filter(Boolean);
    const script = segs[segs.length - 1];
    const parent = segs.length > 1 ? segs[segs.length - 2] : null;
    return parent && !/^(node(js)?|scripts|src|dist|build|bin)$/i.test(parent)
      ? `${parent} · ${script}`
      : script;
  }
  return null;
}

// Work out how to actually relaunch a stopped app. The captured command line is
// often an internal worker (e.g. Next.js forks start-server.js to bind the port),
// which can't just be re-run. So when the project has a package.json, prefer the
// matching `npm run <script>` — that's what the user ran to begin with.
function resolveRestart(entry) {
  const cwd = entry.cwd && fs.existsSync(entry.cwd) ? entry.cwd : null;
  const cmd = entry.cmd || '';

  if (cwd) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
      const scripts = pkg.scripts || {};
      const names = Object.keys(scripts);
      if (names.length) {
        // A token identifying the tool/script that had been running.
        let token = '';
        const nm = cmd.match(/node_modules[\\/](?:\.bin[\\/])?(@[^\\/"\s]+|[^\\/"\s]+)/i);
        if (nm) token = nm[1].toLowerCase();
        else {
          const scriptFile = (cmd.match(/([^\\/"\s]+\.(?:mjs|cjs|jsx?|tsx?))(?:["\s]|$)/i) || [])[1];
          if (scriptFile) token = scriptFile.toLowerCase();
        }
        const rank = { dev: 0, start: 1, serve: 2 };
        const tokenMatch = token && names
          .filter((n) => String(scripts[n]).toLowerCase().includes(token))
          .sort((a, b) => (rank[a] ?? 9) - (rank[b] ?? 9))[0];
        const chosen = tokenMatch || (scripts.dev && 'dev') || (scripts.start && 'start');
        if (chosen) return { command: `npm run ${chosen}`, cwd, via: `npm run ${chosen}` };
      }
    } catch { /* no/invalid package.json — fall back to the raw command */ }
  }

  if (cmd) return { command: cmd, cwd, via: 'saved command' };
  return null;
}

// Best guess at the folder an app should be restarted from.
function deriveCwd(cmd, exePath) {
  for (const arg of splitArgs(cmd)) {
    const m = arg.match(/^(.*[\\/][^\\/]+)[\\/]node_modules[\\/]/i);
    if (m) return m[1]; // the project folder that owns node_modules
  }
  for (const arg of splitArgs(cmd).slice(1)) {
    if (/\.(mjs|cjs|jsx?|tsx?|py)$/i.test(arg) && /^[a-zA-Z]:[\\/]/.test(arg)) {
      return path.dirname(arg); // absolute script path -> its directory
    }
  }
  if (exePath && /[\\/]/.test(exePath)) return path.dirname(exePath);
  return null;
}

// pid -> { cmd, exePath } ('' when unavailable). These are immutable per
// process, so cache them and only query CIM for PIDs we haven't seen.
const cmdCache = new Map();
const cpuSamples = new Map();
let systemCache = { at: 0, data: null };

async function getCommandLines(pids) {
  const alive = new Set(pids);
  for (const pid of cmdCache.keys()) if (!alive.has(pid)) cmdCache.delete(pid);

  const missing = pids.filter((pid) => !cmdCache.has(pid));
  if (missing.length) {
    try {
      const filter = missing.map((pid) => `ProcessId=${pid}`).join(' OR ');
      const script = `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,CommandLine,ExecutablePath | ConvertTo-Json -Compress`;
      const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
      const parsed = out.trim() ? JSON.parse(out) : [];
      for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
        cmdCache.set(row.ProcessId, { cmd: row.CommandLine || '', exePath: row.ExecutablePath || '' });
      }
    } catch { /* access denied or CIM hiccup — fall back to exe names */ }
    for (const pid of missing) if (!cmdCache.has(pid)) cmdCache.set(pid, { cmd: '', exePath: '' });
  }
  return cmdCache;
}

async function getProcessMetrics(pids) {
  const metrics = new Map();
  // Prune samples by age, not by the pids in *this* call: within one poll we call
  // this for listeners and (separately) for command-line-tracked apps, and keying
  // the prune on "last seen" keeps those two pid subsets from wiping each other's
  // CPU baselines. Dead pids fall out once they go 60s without an update.
  const pruneNow = Date.now();
  for (const [pid, s] of cpuSamples) if (pruneNow - s.sampledAt > 60000) cpuSamples.delete(pid);
  if (!pids.length) return metrics;

  try {
    const filter = pids.map((pid) => `ProcessId=${pid}`).join(' OR ');
    const script = `$rows = Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,@{Name='CreationDateUtc';Expression={ if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null } }},KernelModeTime,UserModeTime,WorkingSetSize; $rows | ConvertTo-Json -Compress`;
    const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
    const rows = out.trim() ? JSON.parse(out) : [];
    const now = Date.now();
    const cpuCount = Math.max(os.cpus().length, 1);

    for (const row of Array.isArray(rows) ? rows : [rows]) {
      const pid = Number(row.ProcessId);
      if (!Number.isInteger(pid)) continue;

      const kernel = Number(row.KernelModeTime) || 0;
      const user = Number(row.UserModeTime) || 0;
      const cpuTimeSeconds = (kernel + user) / 10000000;
      const previous = cpuSamples.get(pid);
      let cpuPercent = null;
      if (previous && cpuTimeSeconds >= previous.cpuTimeSeconds) {
        const elapsedSeconds = (now - previous.sampledAt) / 1000;
        if (elapsedSeconds > 0) {
          cpuPercent = Math.max(0, ((cpuTimeSeconds - previous.cpuTimeSeconds) / elapsedSeconds) * (100 / cpuCount));
        }
      }
      cpuSamples.set(pid, { cpuTimeSeconds, sampledAt: now });

      const startedAt = row.CreationDateUtc ? Date.parse(row.CreationDateUtc) : NaN;
      const workingSetKB = Math.round((Number(row.WorkingSetSize) || 0) / 1024);
      metrics.set(pid, {
        startedAt: Number.isFinite(startedAt) ? startedAt : null,
        uptimeSeconds: Number.isFinite(startedAt) ? Math.max(0, Math.floor((now - startedAt) / 1000)) : null,
        cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : null,
        cpuTimeSeconds,
        workingSetKB,
      });
    }
  } catch {
    // Best-effort telemetry. Process control still works without CIM access.
  }

  return metrics;
}

async function getSystemStats() {
  const now = Date.now();
  if (systemCache.data && now - systemCache.at < 2500) return systemCache.data;

  const fallbackMemory = {
    totalKB: Math.round(os.totalmem() / 1024),
    freeKB: Math.round(os.freemem() / 1024),
  };
  let data = {
    node: os.hostname(),
    status: 'ONLINE',
    mode: 'PROCESS CONTROL',
    pid: process.pid,
    port: currentPort,
    cpuPercent: null,
    memory: {
      ...fallbackMemory,
      usedPercent: fallbackMemory.totalKB
        ? ((fallbackMemory.totalKB - fallbackMemory.freeKB) / fallbackMemory.totalKB) * 100
        : null,
    },
  };

  try {
    // Win32_Processor.LoadPercentage reads a stale/zero snapshot on many boxes,
    // and the perf-counter classes (Get-Counter, Win32_PerfFormattedData_*) are
    // absent or locale-broken on some Windows installs. So measure CPU the way
    // Task Manager does: sample every process's total CPU time twice over a short
    // window and sum the *positive* per-pid deltas (a process that exits mid-
    // window just drops out — no negative spike). Locale-independent, no counters.
    const script = `$os = Get-CimInstance Win32_OperatingSystem; $cores = [int]$env:NUMBER_OF_PROCESSORS; if ($cores -lt 1) { $cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors }; $s1 = @{}; foreach ($p in Get-Process) { try { $s1[$p.Id] = $p.TotalProcessorTime.TotalSeconds } catch {} }; $sw = [Diagnostics.Stopwatch]::StartNew(); Start-Sleep -Milliseconds 350; $sw.Stop(); $busy = 0.0; foreach ($p in Get-Process) { try { if ($s1.ContainsKey($p.Id)) { $d = $p.TotalProcessorTime.TotalSeconds - $s1[$p.Id]; if ($d -gt 0) { $busy += $d } } } catch {} }; $cpu = [math]::Round($busy / $sw.Elapsed.TotalSeconds / $cores * 100, 1); if ($cpu -gt 100) { $cpu = 100 }; [pscustomobject]@{ CpuPercent = $cpu; TotalMemoryKB = [int64]$os.TotalVisibleMemorySize; FreeMemoryKB = [int64]$os.FreePhysicalMemory } | ConvertTo-Json -Compress`;
    const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
    const row = out.trim() ? JSON.parse(out) : null;
    if (row) {
      const totalKB = Number(row.TotalMemoryKB) || fallbackMemory.totalKB;
      const freeKB = Number(row.FreeMemoryKB) || fallbackMemory.freeKB;
      data = {
        ...data,
        cpuPercent: Number.isFinite(Number(row.CpuPercent)) ? Number(row.CpuPercent) : null,
        memory: {
          totalKB,
          freeKB,
          usedPercent: totalKB ? ((totalKB - freeKB) / totalKB) * 100 : null,
        },
      };
    }
  } catch {
    // Keep the fast Node fallback if CIM is unavailable.
  }

  systemCache = { at: now, data };
  return data;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout);
    });
  });
}

function runConfiguredCommand(command, cwd) {
  return new Promise((resolve, reject) => {
    exec(command, {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
      timeout: CONFIGURED_COMMAND_TIMEOUT_MS,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || stdout.trim() || err.message));
      else resolve(stdout);
    });
  });
}

function parseTasklist(csv) {
  const byPid = new Map();
  for (const raw of csv.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('"')) continue;
    const cols = line.replace(/^"|"$/g, '').split('","');
    if (cols.length < 5) continue;
    const pid = Number(cols[1]);
    if (!Number.isInteger(pid)) continue;
    byPid.set(pid, {
      name: cols[0],
      memKB: Number(cols[4].replace(/[^\d]/g, '')) || 0,
    });
  }
  return byPid;
}

async function getListeners() {
  const [netstatOut, tasklistOut] = await Promise.all([
    run('netstat', ['-ano']),
    run('tasklist', ['/FO', 'CSV', '/NH']),
  ]);
  const procInfo = parseTasklist(tasklistOut);

  // pid -> Map(port -> Set(addresses))
  const byPid = new Map();
  for (const raw of netstatOut.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('TCP')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5 || parts[3] !== 'LISTENING') continue;
    const local = parts[1];
    const sep = local.lastIndexOf(':');
    if (sep === -1) continue;
    const address = local.slice(0, sep);
    const port = Number(local.slice(sep + 1));
    const pid = Number(parts[4]);
    if (!Number.isInteger(port) || !Number.isInteger(pid)) continue;

    if (!byPid.has(pid)) byPid.set(pid, new Map());
    const ports = byPid.get(pid);
    if (!ports.has(port)) ports.set(port, new Set());
    ports.get(port).add(address);
  }

  // Command lines only matter for identifying user apps — skip system ones.
  const userPids = [...byPid.keys()].filter((pid) => {
    const info = procInfo.get(pid);
    return info && !SYSTEM_NAMES.has(info.name.toLowerCase()) && !PROTECTED_PIDS.has(pid);
  });
  const [cmds, metrics] = await Promise.all([
    getCommandLines(userPids),
    getProcessMetrics([...byPid.keys()]),
  ]);

  const result = [];
  for (const [pid, ports] of byPid) {
    const info = procInfo.get(pid) || { name: `PID ${pid}`, memKB: 0 };
    const lowerName = info.name.toLowerCase();
    const isProtected = PROTECTED_PIDS.has(pid) || PROTECTED_NAMES.has(lowerName);
    const { cmd, exePath } = cmds.get(pid) || { cmd: '', exePath: '' };
    const metric = metrics.get(pid) || {};
    result.push({
      pid,
      name: info.name,
      label: pid === process.pid ? "Hacker's Lair" : friendlyLabel(cmd),
      cmd,
      exePath,
      cwd: deriveCwd(cmd, exePath),
      memKB: metric.workingSetKB || info.memKB,
      startedAt: metric.startedAt || null,
      uptimeSeconds: metric.uptimeSeconds ?? null,
      cpuPercent: metric.cpuPercent ?? null,
      cpuTimeSeconds: metric.cpuTimeSeconds ?? null,
      self: pid === process.pid,
      protected: isProtected,
      system: !((pid === process.pid)) && (isProtected || SYSTEM_NAMES.has(lowerName)),
      ports: [...ports.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([port, addrs]) => ({ port, addresses: [...addrs] })),
    });
  }

  // User processes first, then by lowest port.
  result.sort((a, b) => (a.system - b.system) || (a.ports[0].port - b.ports[0].port));
  return result;
}

// ---- Coding projects (projects.json) ---------------------------------------

const PROJECTS_FILE = process.env.PROJECTS_FILE || path.join(__dirname, 'projects.json');

// Last time each project was started from here (name -> epoch ms), persisted
// so "most recently started first" ordering survives a manager restart.
const STARTED_FILE = path.join(DATA_DIR, 'started.json');
let startedTimes = {};
try {
  startedTimes = JSON.parse(fs.readFileSync(STARTED_FILE, 'utf8'));
  if (!startedTimes || typeof startedTimes !== 'object' || Array.isArray(startedTimes)) startedTimes = {};
} catch { startedTimes = {}; }
function saveStartedTimes() {
  try { fs.writeFileSync(STARTED_FILE, JSON.stringify(startedTimes, null, 2)); } catch { /* best effort */ }
}

// Read fresh each call so edits to projects.json apply without a restart.
function loadProjects() {
  try {
    const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
    return Array.isArray(data.projects) ? data.projects : [];
  } catch { return []; }
}

// A component is "running" if a listening process's command line contains its
// match string (a folder path or a distinctive token). Matching on the command
// line — not the port — means several apps that default to the same port
// (e.g. many Next.js apps on :3000) are still told apart correctly.
function listenersFor(component, listeners) {
  const needle = String(component.match || component.cwd || '').toLowerCase();
  if (!needle) return [];
  return listeners.filter((l) => (l.cmd || '').toLowerCase().includes(needle));
}

function configuredPortListeners(component, listeners) {
  const expectedPort = Number(component.port);
  if (!Number.isInteger(expectedPort)) return [];
  return listeners.filter((listener) => listener.ports.some((port) => port.port === expectedPort));
}

function detectedByConfiguredPort(component, listeners) {
  return component.detectByPort === true && configuredPortListeners(component, listeners).length > 0;
}

// Components flagged `"track": "process"` don't bind a port — a background
// script, a bot, a worker. getListeners() can't see them (it only inspects
// LISTENING sockets), so scan every process's command line instead and return
// entries shaped exactly like a listener (with ports: []). That lets detection,
// telemetry, and stop treat port-bound services and headless scripts the same.
async function getTrackedProcesses(projects) {
  const needles = [];
  for (const proj of projects)
    for (const c of proj.components || [])
      if (c.track === 'process' && (c.match || c.cwd))
        needles.push(String(c.match || c.cwd).toLowerCase());
  if (!needles.length) return [];

  let rows = [];
  try {
    const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | Select-Object ProcessId,Name,CommandLine,ExecutablePath | ConvertTo-Json -Compress`;
    const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
    const parsed = out.trim() ? JSON.parse(out) : [];
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch { return []; }

  const matched = rows.filter((r) => {
    const cmd = String(r.CommandLine || '').toLowerCase();
    return needles.some((n) => cmd.includes(n));
  });
  if (!matched.length) return [];

  const pids = matched.map((r) => Number(r.ProcessId)).filter(Number.isInteger);
  const metrics = await getProcessMetrics(pids);

  return matched.map((r) => {
    const pid = Number(r.ProcessId);
    const cmd = String(r.CommandLine || '');
    const exePath = String(r.ExecutablePath || '');
    const lowerName = String(r.Name || '').toLowerCase();
    const m = metrics.get(pid) || {};
    return {
      pid,
      name: r.Name || `PID ${pid}`,
      label: friendlyLabel(cmd),
      cmd,
      exePath,
      cwd: deriveCwd(cmd, exePath),
      memKB: m.workingSetKB || 0,
      startedAt: m.startedAt || null,
      uptimeSeconds: m.uptimeSeconds ?? null,
      cpuPercent: m.cpuPercent ?? null,
      cpuTimeSeconds: m.cpuTimeSeconds ?? null,
      self: pid === process.pid,
      protected: PROTECTED_PIDS.has(pid) || PROTECTED_NAMES.has(lowerName),
      ports: [],
    };
  });
}

// ---- FiveM macro scripts (scripts.json) ------------------------------------

const SCRIPTS_FILE = path.join(__dirname, 'scripts.json');

// Read fresh each call so edits to scripts.json apply without a restart.
function loadScriptsConfig() {
  try {
    const data = JSON.parse(fs.readFileSync(SCRIPTS_FILE, 'utf8'));
    return {
      scriptsDir: typeof data.scriptsDir === 'string' ? data.scriptsDir : '',
      autoItExe: typeof data.autoItExe === 'string' ? data.autoItExe : '',
      descriptions: data.descriptions && typeof data.descriptions === 'object' ? data.descriptions : {},
    };
  } catch { return { scriptsDir: '', autoItExe: '', descriptions: {} }; }
}

// Find AutoIt3.exe: prefer the configured path, then the usual install spots.
function resolveAutoItExe(configured) {
  const candidates = [
    configured,
    'C:\\Program Files\\AutoIt3\\AutoIt3.exe',
    'C:\\Program Files (x86)\\AutoIt3\\AutoIt3.exe',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) return candidate; } catch { /* keep looking */ }
  }
  return null;
}

// Every .au3 in the folder, newest-modified first (the UI's "new to old").
function listScriptFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((f) => /\.au3$/i.test(f))
      .map((f) => {
        const full = path.join(dir, f);
        let modifiedAt = 0;
        try { modifiedAt = fs.statSync(full).mtimeMs; } catch { /* keep 0 */ }
        return { file: f, path: full, modifiedAt };
      })
      .sort((a, b) => b.modifiedAt - a.modifiedAt);
  } catch { return []; }
}

// Running AutoIt processes with their command line + a little telemetry, in one
// CIM call. A script is "on" when some process's command line contains its path.
async function getScriptProcesses() {
  try {
    const query = `Get-CimInstance Win32_Process -Filter "Name LIKE 'AutoIt%'" | Select-Object ProcessId,CommandLine,@{Name='CreationDateUtc';Expression={ if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null } }},WorkingSetSize | ConvertTo-Json -Compress`;
    const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', query]);
    const parsed = out.trim() ? JSON.parse(out) : [];
    const now = Date.now();
    return (Array.isArray(parsed) ? parsed : [parsed])
      .map((row) => {
        const pid = Number(row.ProcessId);
        const startedAt = row.CreationDateUtc ? Date.parse(row.CreationDateUtc) : NaN;
        return {
          pid,
          cmd: String(row.CommandLine || ''),
          uptimeSeconds: Number.isFinite(startedAt) ? Math.max(0, Math.floor((now - startedAt) / 1000)) : null,
          workingSetKB: Math.round((Number(row.WorkingSetSize) || 0) / 1024),
        };
      })
      .filter((p) => Number.isInteger(p.pid));
  } catch { return []; }
}

// PIDs of AutoIt processes launched with a given .au3 path. Every filename ends
// in ".au3" and none is a prefix of another with that suffix, so a plain
// case-insensitive substring match on the full path is unambiguous.
function pidsForScript(scriptPath, procs) {
  const needle = scriptPath.toLowerCase();
  return procs.filter((p) => p.cmd.toLowerCase().includes(needle)).map((p) => p.pid);
}

async function getScripts() {
  const cfg = loadScriptsConfig();
  const files = cfg.scriptsDir ? listScriptFiles(cfg.scriptsDir) : [];
  if (!files.length) return [];
  const procs = await getScriptProcesses();
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  return files.map((f) => {
    const pids = pidsForScript(f.path, procs);
    const primary = byPid.get(pids[0]);
    return {
      file: f.file,
      name: f.file.replace(/\.au3$/i, ''),
      path: f.path,
      description: cfg.descriptions[f.file] || 'AutoIt macro script.',
      modifiedAt: f.modifiedAt,
      running: pids.length > 0,
      pids,
      pid: pids.length === 1 ? pids[0] : null,
      uptimeSeconds: primary ? primary.uptimeSeconds : null,
      memKB: pids.reduce((sum, pid) => sum + ((byPid.get(pid)?.workingSetKB) || 0), 0),
    };
  });
}

// ---- Launch tracking: capture output + notice early crashes -----------------

const LOG_DIR = path.join(DATA_DIR, 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ignore */ }

// key `${project}::${component}` -> { status, reason, logFile, startedAt, pid }
// status: 'starting' | 'running' | 'errored'
const launches = new Map();
const launchKey = (proj, comp) => `${proj}::${comp}`;
const slug = (s) => String(s).replace(/[^a-z0-9._-]+/gi, '_');

// Pull the meaningful error out of a component's log. Node prints the message
// at the top of its crash (above the stack); Python puts the real exception at
// the bottom of the traceback — so look for a thrown-error line from the bottom
// up, and fall back to the broad-signature first match, then the last lines.
function tailLog(file, code) {
  try {
    const txt = fs.readFileSync(file, 'utf8').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, ''); // strip ANSI
    const lines = txt.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.length);
    if (!lines.length) return `Exited with code ${code} and no output.`;

    const strong = /(^|\s)[\w.]*(Error|Exception|Warning):/;   // "XxxError: message"
    const hard = /EADDRINUSE|EACCES|ENOENT|No module named|command not found|is not recognized|BUILD FAILURE|MODULE_NOT_FOUND/i;
    const broad = /error|exception|cannot|refused|denied|missing|no such|traceback|failed|fatal/i;
    const lastMatch = (re) => { for (let i = lines.length - 1; i >= 0; i--) if (re.test(lines[i])) return i; return -1; };

    let idx = lastMatch(strong);
    if (idx === -1) idx = lastMatch(hard);
    if (idx === -1) idx = lines.findIndex((l) => broad.test(l));
    if (idx === -1) return lines.slice(-8).join('\n');

    return lines.slice(idx, idx + 6).join('\n');   // headline first, then a little context
  } catch { return `Exited with code ${code}.`; }
}

function annotateProjects(projects, listeners, tracked = []) {
  return projects.map((proj) => {
    const components = (proj.components || []).map((c) => {
      const hits = listenersFor(c, c.track === 'process' ? tracked : listeners);
      const expectedPort = Number(c.port);
      const requiresReadyPort = c.track === 'process' && Number.isInteger(expectedPort);
      const readinessListeners = requiresReadyPort
        ? configuredPortListeners(c, listeners)
        : [];
      const detectedByPort = c.detectByPort === true && readinessListeners.length > 0;
      const running = detectedByPort || (hits.length > 0 && (!requiresReadyPort || readinessListeners.length > 0));
      const rec = launches.get(launchKey(proj.name, c.name));
      if (running && rec) { rec.status = 'running'; rec.reason = ''; } // it made it up

      let status = 'stopped';
      let error = '';
      if (running) status = 'running';
      else if (rec && rec.status === 'errored') { status = 'errored'; error = rec.reason || 'Failed to start.'; }
      else if ((rec && rec.status === 'starting') || hits.length) status = 'starting';

      const pids = [...new Set([
        ...hits.map((l) => l.pid),
        ...(rec && Number.isInteger(rec.pid) ? [rec.pid] : []),
      ])].sort((a, b) => a - b);
      const cpuValues = hits.map((l) => l.cpuPercent).filter((v) => Number.isFinite(v));
      const startedAt = hits.map((l) => l.startedAt).filter(Boolean).sort((a, b) => a - b)[0]
        || (rec && rec.startedAt) || null;
      const uptimeValues = hits.map((l) => l.uptimeSeconds).filter((v) => Number.isFinite(v));

      return {
        name: c.name,
        role: c.role || '',
        port: c.port || null,
        command: c.command || '',
        cwd: c.cwd || '',
        match: c.match || '',
        running,
        status,
        error,
        pids,
        pid: pids.length === 1 ? pids[0] : null,
        path: (hits.find((l) => l.exePath)?.exePath) || c.cwd || '',
        exePath: (hits.find((l) => l.exePath)?.exePath) || '',
        memKB: hits.reduce((sum, l) => sum + (Number(l.memKB) || 0), 0),
        cpuPercent: cpuValues.length ? cpuValues.reduce((sum, value) => sum + value, 0) : null,
        startedAt,
        uptimeSeconds: uptimeValues.length ? Math.max(...uptimeValues) : null,
        lastActionAt: (rec && rec.startedAt) || startedTimes[proj.name] || 0,
        livePorts: [...new Set(
          [...hits, ...readinessListeners].flatMap((l) => l.ports.map((p) => p.port)),
        )].sort((a, b) => a - b),
      };
    });
    const runningCount = components.filter((c) => c.running).length;
    const pids = [...new Set(components.flatMap((c) => c.pids || []))].sort((a, b) => a - b);
    const cpuValues = components.map((c) => c.cpuPercent).filter((v) => Number.isFinite(v));
    const uptimeValues = components.map((c) => c.uptimeSeconds).filter((v) => Number.isFinite(v));
    return {
      name: proj.name,
      type: proj.type || '',
      gitBranches: gitBranchesForProject(proj),
      components,
      running: runningCount > 0,
      partial: runningCount > 0 && runningCount < components.length,
      errored: components.some((c) => c.status === 'errored'),
      starting: components.some((c) => c.status === 'starting'),
      lastStartedAt: startedTimes[proj.name] || 0,
      lastActionAt: Math.max(startedTimes[proj.name] || 0, ...components.map((c) => c.lastActionAt || 0)),
      pids,
      pid: pids.length === 1 ? pids[0] : null,
      memKB: components.reduce((sum, c) => sum + (Number(c.memKB) || 0), 0),
      cpuPercent: cpuValues.length ? cpuValues.reduce((sum, value) => sum + value, 0) : null,
      uptimeSeconds: uptimeValues.length ? Math.max(...uptimeValues) : null,
    };
  });
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10_000) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && pathname === '/icon.ico') {
      res.writeHead(200, { 'Content-Type': 'image/x-icon', 'Cache-Control': 'public, max-age=86400' });
      res.end(fs.readFileSync(path.join(__dirname, 'icon.ico')));
      return;
    }
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/processes') {
      const processes = await getListeners();
      reconcileStopped(processes);
      json(res, 200, { self: process.pid, port: currentPort, processes, stopped });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/system') {
      json(res, 200, await getSystemStats());
      return;
    }

    if (req.method === 'POST' && req.url === '/api/open-ui') {
      let port;
      try { port = Number(JSON.parse(await readBody(req)).port); }
      catch { json(res, 400, { error: 'Invalid JSON body' }); return; }
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        json(res, 400, { error: 'Port must be an integer from 1 to 65535' });
        return;
      }

      const firefox = findFirefox();
      if (!firefox) {
        json(res, 500, {
          error: 'Firefox was not found. Install it in the standard location or set FIREFOX_PATH.',
        });
        return;
      }

      const url = `http://localhost:${port}/`;
      try {
        const child = spawn(firefox, ['--new-tab', url], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        });
        child.on('error', () => {});
        child.unref();
        json(res, 200, { ok: true, browser: 'Firefox', port, url });
      } catch (err) {
        json(res, 500, { error: `Could not open Firefox: ${err.message}` });
      }
      return;
    }

    if (req.method === 'GET' && req.url === '/api/projects') {
      const listeners = await getListeners();
      const projects = loadProjects();
      const tracked = await getTrackedProcesses(projects);
      const annotated = annotateProjects(projects, listeners, tracked);
      // Most recently started from here first; never-started projects keep
      // their projects.json order below (sort is stable).
      annotated.sort((a, b) => b.lastStartedAt - a.lastStartedAt);
      json(res, 200, { projects: annotated });
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/projects/log')) {
      const q = new URL(req.url, 'http://localhost').searchParams;
      const rec = launches.get(launchKey(q.get('name') || '', q.get('component') || ''));
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      let body = 'No log for this component (has it been started from here?).';
      try { if (rec && rec.logFile) body = fs.readFileSync(rec.logFile, 'utf8'); } catch { /* keep default */ }
      res.end(body);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/projects/start') {
      let name;
      try { name = String(JSON.parse(await readBody(req)).name); }
      catch { json(res, 400, { error: 'Invalid JSON body' }); return; }

      const proj = loadProjects().find((p) => p.name === name);
      if (!proj) { json(res, 404, { error: `No project named "${name}"` }); return; }

      const listeners = await getListeners();
      const tracked = await getTrackedProcesses([proj]);
      const started = [], skipped = [], failed = [];
      for (const c of proj.components || []) {
        const pool = c.track === 'process' ? tracked : listeners;
        const detectedByPort = detectedByConfiguredPort(c, listeners);
        if (listenersFor(c, pool).length || detectedByPort) { skipped.push(c.name); continue; } // already running
        if (!c.command || !c.cwd || !fs.existsSync(c.cwd)) {
          launches.set(launchKey(name, c.name), { status: 'errored', reason: `Missing command or folder: ${c.cwd || '(no cwd)'}`, logFile: '', startedAt: Date.now() });
          failed.push(c.name);
          continue;
        }

        const logFile = path.join(LOG_DIR, `${slug(name)}--${slug(c.name)}.log`);
        const rec = { status: 'starting', reason: '', logFile, startedAt: Date.now(), pid: null };
        launches.set(launchKey(name, c.name), rec);

        // Separate fds for stdout and stderr to the same file — sharing one fd
        // drops stderr on Windows, which is exactly where startup errors go.
        let outFd = 'ignore', errFd = 'ignore';
        try { outFd = fs.openSync(logFile, 'w'); errFd = fs.openSync(logFile, 'a'); }
        catch { outFd = 'ignore'; errFd = 'ignore'; }
        const closeFds = () => { for (const f of [outFd, errFd]) if (typeof f === 'number') { try { fs.closeSync(f); } catch { /* ignore */ } } };

        try {
          // NOT detached: a detached child on Windows doesn't inherit our log
          // file handles (stderr would be lost). Non-detached children still
          // outlive us on Windows, and unref() lets us exit independently.
          const child = spawn(c.command, {
            cwd: c.cwd,
            shell: true,
            windowsHide: true,
            stdio: ['ignore', outFd, errFd],
            env: environmentWithFirefox(),
          });
          rec.pid = child.pid;
          child.on('error', (err) => { rec.status = 'errored'; rec.reason = err.message; });
          child.on('exit', (code) => {
            closeFds();
            // If the shell exits while we still think it's "starting", it never
            // came up — that's a startup failure. Show the tail of its log
            // (short delay so the child's final writes are flushed to disk).
            if (rec.status === 'starting') setTimeout(() => { rec.status = 'errored'; rec.reason = tailLog(logFile, code); }, 150);
          });
          child.unref();
          started.push(c.name);
        } catch (err) {
          closeFds();
          rec.status = 'errored'; rec.reason = err.message;
          failed.push(c.name);
        }
      }
      // Bump the project to the top of the "recently started" order — only
      // when something actually launched, not for a no-op click.
      if (started.length) { startedTimes[name] = Date.now(); saveStartedTimes(); }
      json(res, 200, { ok: true, name, started, skipped, failed });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/projects/stop') {
      let name;
      try { name = String(JSON.parse(await readBody(req)).name); }
      catch { json(res, 400, { error: 'Invalid JSON body' }); return; }

      const proj = loadProjects().find((p) => p.name === name);
      if (!proj) { json(res, 404, { error: `No project named "${name}"` }); return; }

      // Some managed services (notably Docker Compose stacks) need a graceful,
      // service-aware shutdown. Run an explicitly configured stop command only
      // for components currently detected as live, then clean up any remaining
      // wrapper/listener processes below.
      const listenersBeforeStop = await getListeners();
      const trackedBeforeStop = await getTrackedProcesses([proj]);
      const stoppedByCommand = [];
      const stopFailures = [];
      for (const c of proj.components || []) {
        if (!c.stopCommand) continue;
        const pool = c.track === 'process' ? trackedBeforeStop : listenersBeforeStop;
        const detectedByPort = detectedByConfiguredPort(c, listenersBeforeStop);
        if (!listenersFor(c, pool).length && !detectedByPort) continue;
        if (!c.cwd || !fs.existsSync(c.cwd)) {
          stopFailures.push(`${c.name}: missing folder ${c.cwd || '(no cwd)'}`);
          continue;
        }
        try {
          await runConfiguredCommand(c.stopCommand, c.cwd);
          stoppedByCommand.push(c.name);
        } catch (err) {
          stopFailures.push(`${c.name}: ${err.message}`);
        }
      }

      // Only ever kill detected project processes (never an editor/terminal
      // that merely has the path open), and never ourselves or protected ones.
      const listeners = await getListeners();
      const tracked = await getTrackedProcesses([proj]);
      const pids = new Set();
      for (const c of proj.components || []) {
        const pool = c.track === 'process' ? tracked : listeners;
        for (const l of listenersFor(c, pool)) {
          if (!l.self && !l.protected) pids.add(l.pid);
        }
      }
      let killed = 0;
      for (const pid of pids) {
        try { await run('taskkill', ['/PID', String(pid), '/T', '/F']); killed++; } catch { /* already gone */ }
      }
      // Forget launch state so the components read as a clean "stopped".
      for (const c of proj.components || []) launches.delete(launchKey(name, c.name));
      if (stopFailures.length) {
        json(res, 500, {
          error: `Graceful stop failed: ${stopFailures.join('; ')}`,
          name,
          stopped: killed + stoppedByCommand.length,
        });
        return;
      }
      json(res, 200, {
        ok: true,
        name,
        stopped: killed + stoppedByCommand.length,
        processesStopped: killed,
        commandsRun: stoppedByCommand,
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/scripts') {
      json(res, 200, { scripts: await getScripts() });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/skills') {
      json(res, 200, { skills: listSkills() });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/scripts/start') {
      let file;
      try { file = String(JSON.parse(await readBody(req)).file); }
      catch { json(res, 400, { error: 'Invalid JSON body' }); return; }

      const cfg = loadScriptsConfig();
      const exe = resolveAutoItExe(cfg.autoItExe);
      if (!exe) { json(res, 400, { error: 'AutoIt3.exe not found — set "autoItExe" in scripts.json' }); return; }

      // Resolve within the configured folder only (basename strips any traversal).
      const scriptPath = cfg.scriptsDir ? path.join(cfg.scriptsDir, path.basename(file)) : '';
      if (!scriptPath || !/\.au3$/i.test(scriptPath) || !fs.existsSync(scriptPath)) {
        json(res, 404, { error: `No script named "${file}"` }); return;
      }

      const procs = await getScriptProcesses();
      if (pidsForScript(scriptPath, procs).length) {
        json(res, 200, { ok: true, file: path.basename(file), started: false, alreadyRunning: true });
        return;
      }

      try {
        // Detached so the macro outlives the manager; args passed as an array so
        // the spaces in the AutoIt path and script path need no shell quoting.
        const child = spawn(exe, [scriptPath], { cwd: cfg.scriptsDir, detached: true, stdio: 'ignore', windowsHide: true });
        child.on('error', () => {}); // don't crash the server if launch fails
        child.unref();
        json(res, 200, { ok: true, file: path.basename(file), started: true });
      } catch (err) {
        json(res, 500, { error: `Could not start: ${err.message}` });
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/api/scripts/stop') {
      let file;
      try { file = String(JSON.parse(await readBody(req)).file); }
      catch { json(res, 400, { error: 'Invalid JSON body' }); return; }

      const cfg = loadScriptsConfig();
      const scriptPath = cfg.scriptsDir ? path.join(cfg.scriptsDir, path.basename(file)) : '';
      if (!scriptPath) { json(res, 404, { error: `No script named "${file}"` }); return; }

      const procs = await getScriptProcesses();
      let killed = 0;
      for (const pid of pidsForScript(scriptPath, procs)) {
        try { await run('taskkill', ['/PID', String(pid), '/T', '/F']); killed++; } catch { /* already gone */ }
      }
      json(res, 200, { ok: true, file: path.basename(file), stopped: killed });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/kill') {
      let pid;
      try {
        pid = Number(JSON.parse(await readBody(req)).pid);
      } catch {
        json(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      if (!Number.isInteger(pid) || pid <= 0) {
        json(res, 400, { error: 'Invalid PID' });
        return;
      }

      // Re-check against the live list so stale UI state can't kill the wrong thing.
      const target = (await getListeners()).find((p) => p.pid === pid);
      if (!target) {
        json(res, 404, { error: `PID ${pid} is not listening on any port (already stopped?)` });
        return;
      }
      if (target.protected || target.self) {
        json(res, 403, { error: `${target.name} is protected and cannot be stopped from here` });
        return;
      }

      try {
        await run('taskkill', ['/PID', String(pid), '/T', '/F']);
        // Remember it so it can be restarted from the list.
        const entry = {
          id: `${Date.now()}-${pid}`,
          name: target.name,
          label: target.label,
          cmd: target.cmd || '',
          cwd: target.cwd || null,
          ports: target.ports,
          stoppedAt: Date.now(),
        };
        if (entry.cmd) stopped = stopped.filter((s) => s.cmd !== entry.cmd); // de-dupe same app
        stopped.unshift(entry);
        if (stopped.length > MAX_STOPPED) stopped.length = MAX_STOPPED;
        saveStopped();
        json(res, 200, { ok: true, name: target.label || target.name, pid, canRestart: !!entry.cmd });
      } catch (err) {
        json(res, 500, { error: `taskkill failed: ${err.message}` });
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/api/start') {
      let id;
      try { id = String(JSON.parse(await readBody(req)).id); }
      catch { json(res, 400, { error: 'Invalid JSON body' }); return; }

      const entry = stopped.find((s) => s.id === id);
      if (!entry) { json(res, 404, { error: 'No stopped app with that id' }); return; }

      const plan = resolveRestart(entry);
      if (!plan) { json(res, 400, { error: 'No command was recorded for this app, so it can\'t be restarted' }); return; }

      try {
        const opts = {
          detached: true,
          stdio: 'ignore',
          shell: true,
          windowsHide: true,
          env: environmentWithFirefox(),
        };
        if (plan.cwd) opts.cwd = plan.cwd;
        const child = spawn(plan.command, opts);
        child.on('error', () => {}); // don't crash the server if launch fails
        child.unref();
        json(res, 200, { ok: true, label: entry.label || entry.name, via: plan.via });
      } catch (err) {
        json(res, 500, { error: `Could not start: ${err.message}` });
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/api/forget') {
      let id;
      try { id = String(JSON.parse(await readBody(req)).id); }
      catch { json(res, 400, { error: 'Invalid JSON body' }); return; }
      stopped = stopped.filter((s) => s.id !== id);
      saveStopped();
      json(res, 200, { ok: true });
      return;
    }

    json(res, 404, { error: 'Not found' });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

let currentPort = PORT;
function listen(attempt) {
  currentPort = PORT + attempt;
  server.listen(currentPort, '127.0.0.1', () => {
    console.log(`Hacker's Lair running at http://localhost:${currentPort}`);
  });
}
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && currentPort < PORT + MAX_PORT_TRIES) {
    listen(currentPort - PORT + 1);
  } else {
    console.error(err.message);
    process.exit(1);
  }
});
listen(0);
