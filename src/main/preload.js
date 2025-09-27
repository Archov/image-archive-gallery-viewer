const { contextBridge, ipcRenderer } = require('electron')
const { pathToFileURL } = require('url')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'electronAPI',
  Object.freeze({
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
      // Handle null/undefined paths gracefully for drag-and-drop files
      if (!filePath || typeof filePath !== 'string') {
        return null // Indicate that file:// URL cannot be generated
      }
      // Treat whitespace-only strings as invalid to avoid accidental "file:///" URLs
      if (filePath.trim() === '') {
        return null
      }
      try {
        return pathToFileURL(filePath).href
      } catch (_error) {
        // If pathToFileURL fails, return null to indicate fallback needed
        return null
      }
    },

    // Archive processing
    selectArchives: () => ipcRenderer.invoke('select-archives'),
    processArchive: (archivePath, forceReprocess = false) =>
      ipcRenderer.invoke('process-archive', archivePath, forceReprocess),
    getProcessedArchives: () => ipcRenderer.invoke('get-processed-archives'),
    loadProcessedArchive: (archiveHash) =>
      ipcRenderer.invoke('load-processed-archive', archiveHash),

    // Archive progress listener with unsubscribe
    onArchiveProgress: (callback) => {
      const handler = (_event, progress) => callback(progress)
      ipcRenderer.on('archive-progress', handler)
      return () => ipcRenderer.removeListener('archive-progress', handler)
    },

    // Debug info
    getDebugLogPath: () => ipcRenderer.invoke('get-debug-log-path'),
    appendRendererLogs: (logs) => ipcRenderer.invoke('append-renderer-logs', logs),
  })
)
