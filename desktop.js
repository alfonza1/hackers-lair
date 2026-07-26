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
const os = require('os');
const { APP_NAME, APP_USER_MODEL_ID } = require('./app-config');
const { performPowerAction } = require('./lib/app-power');

const APP_ID = 'hackers-lair';
let appOrigin = '';
let apiToken = '';

const DEFAULT_BOUNDS = { width: 1480, height: 940 };
const MIN_SIZE = { width: 900, height: 620 };

app.setName(APP_NAME);
app.setAppUserModelId(APP_USER_MODEL_ID);

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

let mainWindow = null;
let tray = null;
let isQuitting = false;

function identityPath() {
  const dataDirectory = process.env.PROJECT_MANAGER_DATA_DIR
    || (process.env.APPDATA
      ? path.join(process.env.APPDATA, 'HackersLair')
      : path.join(os.homedir(), 'AppData', 'Roaming', 'HackersLair'));
  return path.join(dataDirectory, 'api-token');
}

async function verifiedServerIdentity() {
  const record = JSON.parse(fs.readFileSync(identityPath(), 'utf8'));
  const port = Number(record.port);
  if (
    record.app !== APP_ID
    || !record.token
    || !record.nonce
    || !Number.isInteger(port)
    || port < 1
    || port > 65535
  ) {
    throw new Error('The local identity record is invalid.');
  }

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
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    detached: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => {});
  child.unref();
}

async function ensureServerIdentity() {
  try {
    return await verifiedServerIdentity();
  } catch {
    startLocalService();
  }

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

function senderBelongsToApplication(event) {
  const senderUrl = event.senderFrame?.url || '';
  return Boolean(appOrigin) && senderUrl.startsWith(`${appOrigin}/`);
}

function statePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
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
  tray = new Tray(path.join(__dirname, 'icon.ico'));
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
    icon: path.join(__dirname, 'icon.ico'),
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

app.on('second-instance', () => {
  showMainWindow();
});

app.whenReady().then(async () => {
  if (!hasLock) return;
  await createWindow();
  if (appOrigin) installDesktopControls();
});
app.on('activate', showMainWindow);
app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {});
