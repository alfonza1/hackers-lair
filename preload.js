const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hackerLairWindow', {
  minimize: () => ipcRenderer.send('window:control', 'minimize'),
  toggleMaximize: () => ipcRenderer.send('window:control', 'maximize'),
  close: () => ipcRenderer.send('window:control', 'close'),
  onMaximizeChange: (callback) => {
    const listener = (_event, isMaximized) => callback(Boolean(isMaximized));
    ipcRenderer.on('window:maximize-state', listener);
    return () => ipcRenderer.removeListener('window:maximize-state', listener);
  },
});
