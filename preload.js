const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hackerLairWindow', {
  minimize: () => ipcRenderer.send('window:control', 'minimize'),
  toggleMaximize: () => ipcRenderer.send('window:control', 'maximize'),
  close: () => ipcRenderer.send('window:control', 'close'),
  restart: () => ipcRenderer.send('app:power', 'restart'),
  shutdown: () => ipcRenderer.send('app:power', 'shutdown'),
  chooseWorkspaceFolders: () => ipcRenderer.invoke('dialog:workspace-folders'),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('app:launch-at-login', Boolean(enabled)),
  getLaunchAtLogin: () => ipcRenderer.invoke('app:get-launch-at-login'),
  getUpdateState: () => ipcRenderer.invoke('app:get-update-state'),
  applyUpdate: () => ipcRenderer.invoke('app:apply-update'),
  openUpdateNotes: () => ipcRenderer.invoke('app:open-update-notes'),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('app:update-state', listener);
    return () => ipcRenderer.removeListener('app:update-state', listener);
  },
  onMaximizeChange: (callback) => {
    const listener = (_event, isMaximized) => callback(Boolean(isMaximized));
    ipcRenderer.on('window:maximize-state', listener);
    return () => ipcRenderer.removeListener('window:maximize-state', listener);
  },
});
