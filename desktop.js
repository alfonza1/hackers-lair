const {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
  Tray,
} = require('electron');

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { APP_NAME, APP_USER_MODEL_ID } = require('./app-config');
const { performPowerAction } = require('./lib/app-power');
const {
  APP_ID,
  desktopDataDirectory,
  readIdentityRecord,
  stopManagedChild,
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
let serviceStopped = false;
let quitAfterServiceStops = false;

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

async function verifiedServerIdentity() {
  const record = readIdentityRecord(identityPath(), serviceProcess?.pid ?? null);
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
  serviceStopped = false;
  serviceProcess = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PROJECT_MANAGER_DATA_DIR: dataDirectory,
      LAIR_INSTALL_CHANNEL: app.isPackaged ? 'desktop' : 'source',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  serviceProcess.once('exit', () => {
    serviceStopped = true;
  });
  serviceProcess.once('error', (error) => {
    console.error(`Could not start the local service: ${error.message}`);
  });
}

async function ensureServerIdentity() {
  startLocalService();

  const deadline = Date.now() + 12_000;
  let lastError;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      return await verifiedServerIdentity();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('The local service did not start.');
}

async function stopLocalService() {
  const child = serviceProcess;
  serviceProcess = null;
  await stopManagedChild(child);
  serviceStopped = true;
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
  appOrigin = server.origin;
  apiToken = server.token;
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
  performPowerAction(action, app);
});

ipcMain.handle('dialog:workspace-folders', async (event) => {
  if (!senderBelongsToApplication(event)) return [];
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner || owner !== mainWindow) return [];
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
  if (appOrigin) installDesktopControls();
  const smokeExitAfterMs = Number(process.env.LAIR_SMOKE_EXIT_AFTER_MS);
  if (Number.isFinite(smokeExitAfterMs) && smokeExitAfterMs > 0) {
    setTimeout(() => app.quit(), smokeExitAfterMs).unref?.();
  }
});
app.on('activate', showMainWindow);
app.on('before-quit', (event) => {
  isQuitting = true;
  if (serviceStopped || !serviceProcess || quitAfterServiceStops) return;
  event.preventDefault();
  quitAfterServiceStops = true;
  void stopLocalService().finally(() => {
    app.quit();
  });
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {});
