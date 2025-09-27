const { contextBridge, ipcRenderer } = require('electron');

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
  toFileUrl: (filePath) => {
    // Convert file path to file:// URL
    if (process.platform === 'win32') {
      // Windows: file:///C:/path/to/file
      return 'file:///' + filePath.replace(/\\/g, '/');
    } else {
      // Unix-like: file:///path/to/file
      return 'file://' + filePath;
    }
  },

  // Debug info
  getDebugLogPath: () => ipcRenderer.invoke('get-debug-log-path'),
  appendRendererLogs: (logs) => ipcRenderer.invoke('append-renderer-logs', logs)
}));
