const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    updateGeneralSettings: (settings) => ipcRenderer.invoke('update-general-settings', settings),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    onUpdateMessage: (callback) => ipcRenderer.on('update-message', callback)
});
