const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('iptvAPI', {
  getFavorites: () => ipcRenderer.invoke('get-favorites'),
  toggleFavorite: (channelId) => ipcRenderer.invoke('toggle-favorite', channelId),
  setChannelHeaders: (headers) => ipcRenderer.invoke('set-channel-headers', headers),
})
