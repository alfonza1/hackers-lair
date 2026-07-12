const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');

const APP_URL = 'http://127.0.0.1:4949/?desktop=1';
const APP_ORIGIN = 'http://127.0.0.1:4949';

app.setName("Hacker's Lair");
app.setAppUserModelId('com.alfonza.hackers-lair');

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

let mainWindow = null;

function sendMaximizeState(window) {
  if (!window || window.isDestroyed()) return;
  window.webContents.send('window:maximize-state', window.isMaximized());
}

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    title: "Hacker's Lair",
    icon: path.join(__dirname, 'icon.ico'),
    width: 1480,
    height: 940,
    minWidth: 900,
    minHeight: 620,
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
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin !== APP_ORIGIN) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  mainWindow.on('maximize', () => sendMaximizeState(mainWindow));
  mainWindow.on('unmaximize', () => sendMaximizeState(mainWindow));
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
    sendMaximizeState(mainWindow);
  });
  mainWindow.loadURL(APP_URL);
}

ipcMain.on('window:control', (event, action) => {
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

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => { if (hasLock) createWindow(); });
app.on('activate', () => { if (!mainWindow) createWindow(); });
app.on('window-all-closed', () => app.quit());
