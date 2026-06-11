const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('iptvAPI', {
  getChannels: () => ipcRenderer.invoke('get-channels'),
  refreshChannels: () => ipcRenderer.invoke('refresh-channels'),
  getPlaylistSources: () => ipcRenderer.invoke('get-playlist-sources'),
  getFavorites: () => ipcRenderer.invoke('get-favorites'),
  toggleFavorite: (channelId) => ipcRenderer.invoke('toggle-favorite', channelId),
  setChannelHeaders: (headers) => ipcRenderer.invoke('set-channel-headers', headers),
  getLastChannel: () => ipcRenderer.invoke('get-last-channel'),
  saveLastChannel: (url) => ipcRenderer.invoke('save-last-channel', url),
  recordPlay: (url) => ipcRenderer.invoke('record-play', url),
  updateChannelHealth: (url, status, error) => ipcRenderer.invoke('update-channel-health', url, status, error),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  saveFile: (options, data) => ipcRenderer.invoke('save-file', options, data),
})
