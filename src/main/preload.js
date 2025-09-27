const { contextBridge, ipcRenderer } = require('electron');
const { pathToFileURL } = require('url');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', Object.freeze({
  // File operations
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  getFileStats: (filePath) => ipcRenderer.invoke('get-file-stats', filePath),

  // Window controls
  minimize: () => ipcRenderer.invoke('minimize-window'),
  maximize: () => ipcRenderer.invoke('maximize-window'),
  close: () => ipcRenderer.invoke('close-window'),

  // Platform info
  platform: process.platform,

  // File URL encoding
  toFileUrl: (filePath) => pathToFileURL(filePath).href,

  // Debug info
  getDebugLogPath: () => ipcRenderer.invoke('get-debug-log-path')
}));
