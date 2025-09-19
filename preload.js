const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Archive loading
  loadArchive: (url, cacheSizeGB) => ipcRenderer.invoke('load-archive', url, cacheSizeGB),
  loadLocalArchive: (filePath) => ipcRenderer.invoke('load-local-archive', filePath),
  
  // Settings
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  
  // History
  loadHistory: () => ipcRenderer.invoke('load-history'),
  addToHistory: (historyItem) => ipcRenderer.invoke('add-to-history', historyItem),
  toggleHistoryStar: (historyId) => ipcRenderer.invoke('toggle-history-star', historyId),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  
  // Cache management
  getCacheInfo: () => ipcRenderer.invoke('get-cache-info'),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  
  // Backup management
  listBackups: () => ipcRenderer.invoke('list-backups'),
  restoreBackup: (filename, timestamp) => ipcRenderer.invoke('restore-backup', filename, timestamp),
  
  // History management - rename and reorder
  renameHistoryItem: (historyId, newName) => ipcRenderer.invoke('rename-history-item', historyId, newName),
  reorderHistory: (newOrder) => ipcRenderer.invoke('reorder-history', newOrder),
  
  // Image starring
  toggleImageStar: (archiveId, imageId) => ipcRenderer.invoke('toggle-image-star', archiveId, imageId),
  
  // Download progress
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', callback),
  removeDownloadProgressListener: () => ipcRenderer.removeAllListeners('download-progress')
});