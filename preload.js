const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('iptvAPI', {
  getFavorites: () => ipcRenderer.invoke('get-favorites'),
  toggleFavorite: (channelId) => ipcRenderer.invoke('toggle-favorite', channelId),
  setChannelHeaders: (headers) => ipcRenderer.invoke('set-channel-headers', headers),
  getLastChannel: () => ipcRenderer.invoke('get-last-channel'),
  saveLastChannel: (url) => ipcRenderer.invoke('save-last-channel', url),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  saveFile: (options, data) => ipcRenderer.invoke('save-file', options, data),
})
