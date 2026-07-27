const {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
  shell,
  Tray,
} = require('electron');

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { APP_NAME, APP_USER_MODEL_ID } = require('./app-config');
const { performPowerAction } = require('./lib/app-power');
const { detectInstallChannel, installChannelDetails } = require('./lib/install-channel');
const { fetchAvailableRelease } = require('./lib/release-check');
const {
  managedTargetsRunning,
  releaseNotesForVersion,
  releaseVersion,
  updateStateForChannel,
} = require('./lib/update-policy');
const {
  APP_ID,
  desktopDataDirectory,
  readIdentityRecord,
  restartBackoffDelay,
  stopManagedChild,
  waitForExit,
  writeManagedCliShim,
} = require('./lib/desktop-service');

let appOrigin = '';
let apiToken = '';

const DEFAULT_BOUNDS = { width: 1480, height: 940 };
const MIN_SIZE = { width: 900, height: 620 };
const SQUIRREL_COMMANDS = new Set([
  '--squirrel-install',
  '--squirrel-updated',
  '--squirrel-uninstall',
  '--squirrel-obsolete',
]);
const squirrelCommand = process.platform === 'win32'
  ? process.argv.find((argument) => SQUIRREL_COMMANDS.has(argument)) || ''
  : '';

app.setName(APP_NAME);
app.setAppUserModelId(APP_USER_MODEL_ID);
if (process.env.PROJECT_MANAGER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.PROJECT_MANAGER_DATA_DIR));
} else {
  app.setPath('userData', path.join(app.getPath('appData'), 'HackersLair'));
}

const hasLock = squirrelCommand ? true : app.requestSingleInstanceLock();
if (!hasLock) app.quit();

let mainWindow = null;
let tray = null;
let isQuitting = false;
let serviceProcess = null;
let quitAfterServiceStops = false;
let quitSequenceStarted = false;
let updateStop = null;
let installUpdateAfterStop = false;
let serviceRestartTimer = null;
let serviceHealthTimer = null;
let smokeExitTimer = null;
let serviceHealthCheckInFlight = false;
let serviceRestartAttempts = 0;
const MAX_SERVICE_RESTARTS = 5;
const SERVICE_HEALTH_INTERVAL_MS = 5_000;
const SERVICE_RESTART_STABILITY_MS = 30_000;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1_000;
const smokeExitAfterMs = Number(process.env.LAIR_SMOKE_EXIT_AFTER_MS);
const smokeExitAfterRecoveryMs = Number(process.env.LAIR_SMOKE_EXIT_AFTER_RECOVERY_MS);
let serviceHealthySince = 0;
let backendState = {
  status: 'starting',
  message: 'Starting the local service…',
  attempt: 0,
  maxAttempts: MAX_SERVICE_RESTARTS,
};
const installChannel = detectInstallChannel({
  isPackaged: app.isPackaged,
  platform: process.platform,
  executablePath: process.execPath,
});
const channelDetails = installChannelDetails(installChannel);

function bundledReleaseNotes(version) {
  try {
    const changelog = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8');
    return releaseNotesForVersion(changelog, version);
  } catch {
    return '';
  }
}

const currentVersion = app.getVersion();
let updateState = updateStateForChannel(
  installChannel,
  channelDetails,
  currentVersion,
  bundledReleaseNotes(currentVersion),
);

function publishUpdateState(patch = {}) {
  updateState = { ...updateState, ...patch };
  sendToRenderer('app:update-state', updateState);
  void refreshTrayMenu();
  return updateState;
}

function sendToRenderer(channel, payload) {
  try {
    if (
      !mainWindow
      || mainWindow.isDestroyed()
      || mainWindow.webContents.isDestroyed()
    ) return false;
    mainWindow.webContents.send(channel, payload);
    return true;
  } catch (error) {
    console.warn(`Could not send ${channel} to the renderer: ${error.message}`);
    return false;
  }
}

function publishBackendState(patch = {}) {
  backendState = { ...backendState, ...patch };
  sendToRenderer('app:backend-state', backendState);
  return backendState;
}

function scheduleSmokeExit(delayMs = smokeExitAfterMs) {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  if (smokeExitTimer) clearTimeout(smokeExitTimer);
  smokeExitTimer = setTimeout(() => app.quit(), delayMs);
  smokeExitTimer.unref?.();
}

function signalSmokeDesktopReady() {
  if (!Number.isFinite(smokeExitAfterMs) || smokeExitAfterMs <= 0) return;
  fs.writeFileSync(
    path.join(app.getPath('userData'), 'desktop-smoke-ready'),
    JSON.stringify({ pid: process.pid, readyAt: new Date().toISOString() }),
    'utf8',
  );
}

async function runningManagedTargets() {
  if (!appOrigin) return [];
  try {
    const data = await localApi('/api/projects');
    return managedTargetsRunning(data.projects);
  } catch {
    return ['backend-unavailable'];
  }
}

async function requestUpdateApply() {
  if (updateState.status !== 'ready' && updateState.status !== 'blocked') return updateState;
  const running = await runningManagedTargets();
  if (running.length) {
    return publishUpdateState({
      status: 'blocked',
      managedTargets: running,
      message: `Stop managed targets before applying ${updateState.version || 'the update'}.`,
    });
  }
  installUpdateAfterStop = true;
  publishUpdateState({
    status: 'applying',
    managedTargets: [],
    message: `Restarting to apply ${updateState.version || 'the update'}.`,
  });
  isQuitting = true;
  app.quit();
  return updateState;
}

function initializeUpdates() {
  if (!app.isPackaged) return;
  if (installChannel !== 'squirrel') {
    const check = async () => {
      try {
        const release = await fetchAvailableRelease({ currentVersion });
        if (!release.version) return;
        publishUpdateState({
          status: 'available',
          version: release.version,
          message: `v${release.version} is available. Update when convenient with the ${channelDetails.label} command.`,
          releaseUrl: release.releaseUrl,
          releaseNotes: release.releaseNotes,
          managedTargets: [],
        });
      } catch (error) {
        console.warn(`Passive update check unavailable: ${error.message}`);
      }
    };
    void check();
    const timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    timer.unref?.();
    updateStop = () => clearInterval(timer);
    return;
  }
  const { UpdateSourceType, updateElectronApp } = require('update-electron-app');
  autoUpdater.on('error', (error) => {
    if (['ready', 'blocked', 'applying'].includes(updateState.status)) return;
    publishUpdateState({
      status: 'error',
      message: `Update check unavailable: ${error.message}`,
    });
  });
  const updater = updateElectronApp({
    updateSource: {
      type: UpdateSourceType.ElectronPublicUpdateService,
      repo: 'hackerslairhq/desktop',
    },
    updateInterval: '1 hour',
    notifyUser: true,
    onNotifyUser: (info) => {
      const version = releaseVersion(info.releaseName);
      publishUpdateState({
        status: 'ready',
        version,
        message: version
          ? `v${version} ready — restart to apply.`
          : 'An update is ready — restart to apply.',
        releaseUrl: version
          ? `https://github.com/hackerslairhq/desktop/releases/tag/v${version}`
          : updateState.releaseUrl,
        releaseNotes: String(info.releaseNotes || '').trim() || updateState.releaseNotes,
        managedTargets: [],
      });
    },
  });
  updateStop = updater.stopUpdates;
}

function pathIsWithin(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function runSquirrelUpdate(args) {
  const updateExecutable = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  if (!fs.existsSync(updateExecutable)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const child = spawn(updateExecutable, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Update.exe exited with code ${code}.`));
    });
  });
}

function squirrelInstallRoot() {
  return path.resolve(path.dirname(process.execPath), '..');
}

async function setWindowsUserPath(directory, enabled) {
  const platform = require('./lib/platform').createPlatform('win32');
  const script = enabled
    ? [
      "$current = [Environment]::GetEnvironmentVariable('Path', 'User')",
      '$entries = @($current -split \';\' | Where-Object { $_ })',
      "if ($entries.TrimEnd('\\') -notcontains $env:LAIR_CLI_DIR.TrimEnd('\\')) {",
      "  [Environment]::SetEnvironmentVariable('Path', (($entries + $env:LAIR_CLI_DIR) -join ';'), 'User')",
      '}',
    ].join('; ')
    : [
      "$current = [Environment]::GetEnvironmentVariable('Path', 'User')",
      "$entries = @($current -split ';' | Where-Object { $_ -and $_.TrimEnd('\\') -ne $env:LAIR_CLI_DIR.TrimEnd('\\') })",
      "[Environment]::SetEnvironmentVariable('Path', ($entries -join ';'), 'User')",
    ].join('; ');
  await platform.execFile('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ], { env: { ...process.env, LAIR_CLI_DIR: directory } });
}

async function installSquirrelCli() {
  const installRoot = squirrelInstallRoot();
  const cli = path.join(installRoot, 'lair.cmd');
  fs.writeFileSync(cli, [
    '@echo off',
    'set "ELECTRON_RUN_AS_NODE=1"',
    `"${process.execPath}" "${path.join(__dirname, 'bin', 'lair.js')}" %*`,
    '',
  ].join('\r\n'), 'ascii');
  await setWindowsUserPath(installRoot, true);
}

async function uninstallSquirrelCli() {
  const installRoot = squirrelInstallRoot();
  await setWindowsUserPath(installRoot, false);
  try { fs.unlinkSync(path.join(installRoot, 'lair.cmd')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function installLinuxCli() {
  if (process.platform !== 'linux' || !app.isPackaged) return;
  try {
    const binDirectory = path.join(require('os').homedir(), '.local', 'bin');
    const marker = "# Hacker's Lair managed CLI";
    const installed = writeManagedCliShim(path.join(binDirectory, 'lair'), [
      '#!/bin/sh',
      marker,
      `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(path.join(__dirname, 'bin', 'lair.js'))} "$@"`,
      '',
    ].join('\n'), marker);
    if (!installed) {
      console.warn('Skipped CLI installation because ~/.local/bin/lair is owned by another tool.');
    }
  } catch (error) {
    console.warn(`Could not install the optional Linux CLI companion: ${error.message}`);
  }
}

async function stopInstalledSquirrelProcesses() {
  const installRoot = squirrelInstallRoot();
  const platform = require('./lib/platform').createPlatform('win32');
  const processes = await platform.processDetails();
  const matches = processes.filter((processInfo) => (
    processInfo.pid !== process.pid
    && processInfo.exePath
    && path.basename(processInfo.exePath).toLowerCase() === 'hackerslair.exe'
    && pathIsWithin(processInfo.exePath, installRoot)
  ));
  await Promise.allSettled(matches.map((processInfo) => platform.terminateProcess(processInfo.pid)));
}

async function handleSquirrelCommand(command) {
  const executableName = path.basename(process.execPath);
  if (['--squirrel-install', '--squirrel-updated'].includes(command)) {
    await runSquirrelUpdate(['--createShortcut', executableName]);
    await installSquirrelCli();
    return;
  }
  if (command === '--squirrel-uninstall') {
    await stopInstalledSquirrelProcesses();
    const result = await dialog.showMessageBox({
      type: 'question',
      title: "Uninstall Hacker's Lair",
      message: "Keep Hacker's Lair configuration, logs, and backups?",
      detail: `User data: ${app.getPath('userData')}`,
      buttons: ['Keep data', 'Delete data'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response === 1) {
      fs.rmSync(app.getPath('userData'), { recursive: true, force: true });
    }
    await uninstallSquirrelCli();
    await runSquirrelUpdate(['--removeShortcut', executableName]);
  }
}

function identityPath() {
  return path.join(desktopDataDirectory(app), 'api-token');
}

async function verifiedServerIdentity(expectedProcess = serviceProcess) {
  const record = readIdentityRecord(identityPath(), expectedProcess?.pid ?? null);
  const { port } = record;

  const origin = `http://127.0.0.1:${port}`;
  const response = await fetch(`${origin}/api/identity`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error(`The local service returned HTTP ${response.status}.`);
  const identity = await response.json();
  if (identity.app !== APP_ID || identity.nonce !== record.nonce) {
    throw new Error('Another service answered on the recorded Hacker’s Lair port.');
  }
  return { origin, token: record.token, url: `${origin}/?desktop=1` };
}

function startLocalService() {
  const dataDirectory = desktopDataDirectory(app);
  fs.mkdirSync(dataDirectory, { recursive: true });
  try { fs.unlinkSync(identityPath()); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PROJECT_MANAGER_DATA_DIR: dataDirectory,
      LAIR_INSTALL_CHANNEL: installChannel,
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  serviceProcess = child;
  child.once('exit', (code, signal) => {
    if (serviceProcess === child) serviceProcess = null;
    if (!child.lairExpectedStop && !isQuitting && !quitSequenceStarted) {
      scheduleServiceRestart(`The local service exited (${signal || code || 'unknown'}).`);
    }
  });
  child.once('error', (error) => {
    console.error(`Could not start the local service: ${error.message}`);
  });
  return child;
}

async function waitForServerIdentity(child, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('The local service exited before becoming ready.');
    }
    try {
      return await verifiedServerIdentity(child);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('The local service did not start.');
}

async function ensureServerIdentity() {
  if (serviceProcess) {
    try {
      return await verifiedServerIdentity(serviceProcess);
    } catch {
      const staleProcess = serviceProcess;
      serviceProcess = null;
      staleProcess.lairExpectedStop = true;
      await stopManagedChild(staleProcess);
    }
  }
  const child = startLocalService();
  return waitForServerIdentity(child);
}

function applyServerIdentity(server, { reload = false } = {}) {
  const previousOrigin = appOrigin;
  appOrigin = server.origin;
  apiToken = server.token;
  serviceHealthySince = Date.now();
  publishBackendState({
    status: 'available',
    message: 'Local service connected.',
    attempt: 0,
  });
  if (reload && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(server.url);
    scheduleSmokeExit(smokeExitAfterRecoveryMs);
  } else if (previousOrigin && previousOrigin !== server.origin) {
    void refreshTrayMenu();
  }
}

function scheduleServiceRestart(reason) {
  if (isQuitting || quitSequenceStarted || serviceRestartTimer) return;
  if (serviceRestartAttempts >= MAX_SERVICE_RESTARTS) {
    publishBackendState({
      status: 'unavailable',
      message: `Local service unavailable after ${MAX_SERVICE_RESTARTS} restart attempts. Restart Hacker's Lair to retry.`,
      attempt: serviceRestartAttempts,
    });
    return;
  }
  serviceRestartAttempts += 1;
  const attempt = serviceRestartAttempts;
  const delay = restartBackoffDelay(attempt);
  console.warn(`${reason} Backend restart ${attempt}/${MAX_SERVICE_RESTARTS} scheduled in ${delay}ms.`);
  try {
    publishBackendState({
      status: 'restarting',
      message: `${reason} Restarting backend in ${(delay / 1000).toFixed(1)}s (${attempt}/${MAX_SERVICE_RESTARTS}).`,
      attempt,
    });
  } catch (error) {
    console.warn(`Could not publish backend restart state: ${error.message}`);
  }
  serviceRestartTimer = setTimeout(() => {
    console.warn(`Attempting backend restart ${attempt}/${MAX_SERVICE_RESTARTS}.`);
    serviceRestartTimer = null;
    void (async () => {
      try {
        const child = startLocalService();
        const server = await waitForServerIdentity(child);
        applyServerIdentity(server, { reload: true });
        console.warn(`Local service recovered on ${server.origin}.`);
        void refreshTrayMenu();
      } catch (error) {
        console.error(`Backend restart ${attempt} failed: ${error.message}`);
        const failedChild = serviceProcess;
        if (failedChild) failedChild.lairExpectedStop = true;
        await stopManagedChild(failedChild);
        if (serviceProcess === failedChild) serviceProcess = null;
        scheduleServiceRestart(error.message);
      }
    })();
  }, delay);
  serviceRestartTimer.ref?.();
}

function startServiceHealthChecks() {
  clearInterval(serviceHealthTimer);
  serviceHealthTimer = setInterval(() => {
    if (serviceHealthCheckInFlight || isQuitting || !serviceProcess) return;
    serviceHealthCheckInFlight = true;
    const checkedProcess = serviceProcess;
    void verifiedServerIdentity(checkedProcess)
      .then(() => {
        if (
          serviceRestartAttempts
          && Date.now() - serviceHealthySince >= SERVICE_RESTART_STABILITY_MS
        ) {
          serviceRestartAttempts = 0;
        }
      })
      .catch(async (error) => {
        if (checkedProcess !== serviceProcess || isQuitting) return;
        checkedProcess.lairExpectedStop = true;
        serviceProcess = null;
        await stopManagedChild(checkedProcess);
        scheduleServiceRestart(`Backend health check failed: ${error.message}`);
      })
      .finally(() => { serviceHealthCheckInFlight = false; });
  }, SERVICE_HEALTH_INTERVAL_MS);
  serviceHealthTimer.ref?.();
}

async function stopLocalService() {
  clearInterval(serviceHealthTimer);
  serviceHealthTimer = null;
  if (serviceRestartTimer) {
    clearTimeout(serviceRestartTimer);
    serviceRestartTimer = null;
  }
  const child = serviceProcess;
  serviceProcess = null;
  if (child) child.lairExpectedStop = true;
  let stoppedGracefully = false;
  if (child && appOrigin && apiToken) {
    try {
      const response = await fetch(`${appOrigin}/api/service/shutdown`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Lair-Token': apiToken,
        },
        body: '{}',
        signal: AbortSignal.timeout(2_000),
      });
      stoppedGracefully = response.ok && await waitForExit(child, 2_500);
    } catch {
      // Fall through to the bounded signal/kill path.
    }
  }
  if (!stoppedGracefully) await stopManagedChild(child);
  try { fs.unlinkSync(identityPath()); } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Could not remove the local identity file: ${error.message}`);
  }
}

function senderBelongsToApplication(event) {
  try {
    return Boolean(appOrigin) && new URL(event.senderFrame?.url || '').origin === appOrigin;
  } catch {
    return false;
  }
}

function statePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function applicationIconPath() {
  return path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}

function loadWindowState() {
  try {
    const saved = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (saved && typeof saved === 'object') return saved;
  } catch {
    // No saved state yet (first run) or unreadable — fall back to defaults.
  }
  return {};
}

// Only reuse a saved x/y if it still lands on a currently connected display,
// otherwise a window saved on an unplugged monitor would open off-screen.
function boundsAreVisible(bounds) {
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false;
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      bounds.x + bounds.width > area.x + 40 &&
      bounds.x < area.x + area.width - 40 &&
      bounds.y >= area.y - 4 &&
      bounds.y < area.y + area.height - 40
    );
  });
}

function saveWindowState(window) {
  if (!window || window.isDestroyed()) return;
  // getNormalBounds() ignores the maximized/minimized state so we store the
  // size the window would restore to, plus the flag itself.
  const bounds = window.getNormalBounds();
  const state = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    isMaximized: window.isMaximized(),
  };
  try {
    fs.writeFileSync(statePath(), JSON.stringify(state));
  } catch {
    // Best-effort persistence; ignore write failures.
  }
}

function sendMaximizeState(window) {
  if (!window || window.isDestroyed()) return;
  window.webContents.send('window:maximize-state', window.isMaximized());
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function localApi(pathname, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.method === 'POST') {
    headers['Content-Type'] = 'application/json';
    headers['X-Lair-Token'] = apiToken;
  }
  const response = await fetch(`${appOrigin}${pathname}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(3500),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function runTrayProjectAction(project, action) {
  try {
    await localApi(`/api/projects/${action}`, {
      method: 'POST',
      body: JSON.stringify({ name: project.name }),
    });
    await refreshTrayMenu();
  } catch (error) {
    dialog.showErrorBox(`Could not ${action} ${project.name}`, error.message);
  }
}

async function refreshTrayMenu() {
  if (!tray || !appOrigin || !apiToken) return;
  let projects = [];
  try {
    const data = await localApi('/api/projects');
    projects = data.projects || [];
  } catch {
    // Keep the tray useful for summoning or quitting when the API is restarting.
  }
  const projectItems = projects.length
    ? projects.map((project) => ({
      label: project.name,
      submenu: [
        {
          label: 'Start',
          enabled: !project.running && !project.starting,
          click: () => void runTrayProjectAction(project, 'start'),
        },
        {
          label: 'Stop',
          enabled: Boolean(project.running || project.starting),
          click: () => void runTrayProjectAction(project, 'stop'),
        },
      ],
    }))
    : [{ label: 'No configured targets', enabled: false }];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Hacker's Lair", click: showMainWindow },
    ...(updateState.status === 'ready' || updateState.status === 'blocked'
      ? [{
        label: updateState.version
          ? `Restart to apply v${updateState.version}`
          : 'Restart to apply update',
        click: () => void requestUpdateApply(),
      }, {
        label: 'View release notes',
        click: () => void shell.openExternal(updateState.releaseUrl),
      }]
      : []),
    { type: 'separator' },
    { label: 'Targets', submenu: projectItems },
    { type: 'separator' },
    { label: 'Refresh targets', click: () => void refreshTrayMenu() },
    {
      label: "Quit Hacker's Lair",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
}

function installDesktopControls() {
  tray = new Tray(applicationIconPath());
  tray.setToolTip("Hacker's Lair");
  tray.on('click', showMainWindow);
  void refreshTrayMenu();

  const shortcut = 'CommandOrControl+Shift+L';
  if (!globalShortcut.register(shortcut, showMainWindow)) {
    console.warn(`Could not register global shortcut ${shortcut}`);
  }
}

async function createWindow() {
  let server;
  try {
    server = await ensureServerIdentity();
  } catch (error) {
    dialog.showErrorBox(
      "Hacker's Lair could not connect",
      `${error.message}\n\nStart Hacker's Lair again so its local service can be verified.`,
    );
    app.quit();
    return;
  }
  applyServerIdentity(server);
  Menu.setApplicationMenu(null);

  const savedState = loadWindowState();
  const windowOptions = {
    title: "Hacker's Lair",
    icon: applicationIconPath(),
    width: Math.max(savedState.width || DEFAULT_BOUNDS.width, MIN_SIZE.width),
    height: Math.max(savedState.height || DEFAULT_BOUNDS.height, MIN_SIZE.height),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#010504',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };

  const restoredBounds = {
    x: savedState.x,
    y: savedState.y,
    width: windowOptions.width,
    height: windowOptions.height,
  };
  if (boundsAreVisible(restoredBounds)) {
    windowOptions.x = savedState.x;
    windowOptions.y = savedState.y;
  }

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin !== appOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  mainWindow.on('maximize', () => sendMaximizeState(mainWindow));
  mainWindow.on('unmaximize', () => sendMaximizeState(mainWindow));
  mainWindow.on('close', (event) => {
    saveWindowState(mainWindow);
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.once('ready-to-show', () => {
    if (savedState.isMaximized) mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
    sendMaximizeState(mainWindow);
  });
  mainWindow.loadURL(server.url);
}

ipcMain.on('window:control', (event, action) => {
  if (!senderBelongsToApplication(event)) return;
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  if (action === 'minimize') window.minimize();
  if (action === 'maximize') {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    sendMaximizeState(window);
  }
  if (action === 'close') window.close();
});

ipcMain.on('app:power', (event, action) => {
  if (!senderBelongsToApplication(event)) return;
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window !== mainWindow) return;

  if (['restart', 'shutdown'].includes(action)) saveWindowState(window);
  if (action === 'restart' && ['ready', 'blocked'].includes(updateState.status)) {
    void requestUpdateApply();
    return;
  }
  performPowerAction(action, app);
});

ipcMain.handle('dialog:workspace-folders', async (event) => {
  if (!senderBelongsToApplication(event)) {
    throw new Error('Folder picker request was rejected because its origin could not be verified.');
  }
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner || owner !== mainWindow) {
    throw new Error('Folder picker request did not come from the Hacker’s Lair window.');
  }
  const result = await dialog.showOpenDialog(owner, {
    title: 'Choose development workspaces',
    buttonLabel: 'Scan folders',
    properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('app:get-launch-at-login', (event) => {
  if (!senderBelongsToApplication(event) || process.platform !== 'win32') {
    return { supported: false, enabled: false };
  }
  return {
    supported: true,
    enabled: app.getLoginItemSettings().openAtLogin,
  };
});

ipcMain.handle('app:launch-at-login', (event, enabled) => {
  if (!senderBelongsToApplication(event) || process.platform !== 'win32') {
    return { supported: false, enabled: false };
  }
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  return {
    supported: true,
    enabled: app.getLoginItemSettings().openAtLogin,
  };
});

ipcMain.handle('app:get-update-state', (event) => {
  if (!senderBelongsToApplication(event)) return null;
  return updateState;
});

ipcMain.handle('app:get-backend-state', (event) => {
  if (!senderBelongsToApplication(event)) return null;
  return backendState;
});

ipcMain.handle('app:apply-update', async (event) => {
  if (!senderBelongsToApplication(event)) return null;
  return requestUpdateApply();
});

ipcMain.handle('app:open-update-notes', async (event) => {
  if (!senderBelongsToApplication(event)) return false;
  if (!updateState.releaseUrl.startsWith('https://github.com/hackerslairhq/desktop/')) return false;
  await shell.openExternal(updateState.releaseUrl);
  return true;
});

app.on('second-instance', () => {
  showMainWindow();
});

app.whenReady().then(async () => {
  if (squirrelCommand) {
    try {
      await handleSquirrelCommand(squirrelCommand);
    } catch (error) {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    } finally {
      app.quit();
    }
    return;
  }
  if (!hasLock) return;
  installLinuxCli();
  await createWindow();
  if (appOrigin) {
    installDesktopControls();
    startServiceHealthChecks();
  }
  initializeUpdates();
  signalSmokeDesktopReady();
  scheduleSmokeExit();
});
app.on('activate', showMainWindow);
app.on('before-quit', (event) => {
  isQuitting = true;
  if (smokeExitTimer) {
    clearTimeout(smokeExitTimer);
    smokeExitTimer = null;
  }
  if (quitAfterServiceStops) return;
  event.preventDefault();
  if (quitSequenceStarted) return;
  quitSequenceStarted = true;
  void (async () => {
    if (!installUpdateAfterStop && updateState.status === 'ready') {
      installUpdateAfterStop = (await runningManagedTargets()).length === 0;
    }
    updateStop?.();
    await stopLocalService();
    quitAfterServiceStops = true;
    if (installUpdateAfterStop) autoUpdater.quitAndInstall(false, true);
    else app.quit();
  })();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {});
