const { contextBridge, ipcRenderer } = require('electron');
const { IPC_CHANNELS } = require('../shared/constants');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
// NOTE: Removed generic SQL execution for security - only specific purpose-built operations
contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations - specific channels only (no generic SQL)
  db: {
    init: () => ipcRenderer.invoke(IPC_CHANNELS.DB_INIT)
    // Removed: query() and execute() - replaced with specific purpose-built channels below
  },

  // Image operations
  images: {
    load: (imageId) => ipcRenderer.invoke(IPC_CHANNELS.IMAGE_LOAD, imageId),
    save: (imageData) => ipcRenderer.invoke(IPC_CHANNELS.IMAGE_SAVE, imageData),
    delete: (imageId) => ipcRenderer.invoke(IPC_CHANNELS.IMAGE_DELETE, imageId),
    generateThumbnail: (imagePath) => ipcRenderer.invoke(IPC_CHANNELS.IMAGE_GENERATE_THUMBNAIL, imagePath)
  },

  // Ingestion operations
  ingest: {
    archive: (archivePath, options) => ipcRenderer.invoke(IPC_CHANNELS.INGEST_ARCHIVE, archivePath, options),
    url: (url, options) => ipcRenderer.invoke(IPC_CHANNELS.INGEST_URL, url, options),
    webpage: (data) => ipcRenderer.invoke(IPC_CHANNELS.INGEST_WEBPAGE, data),
    onProgress: (callback) => ipcRenderer.on(IPC_CHANNELS.INGEST_PROGRESS, callback)
  },

  // Metadata operations
  metadata: {
    update: (imageId, metadata) => ipcRenderer.invoke(IPC_CHANNELS.METADATA_UPDATE, imageId, metadata),
    bulkUpdate: (updates) => ipcRenderer.invoke(IPC_CHANNELS.METADATA_BULK_UPDATE, updates)
  },

  // Tag operations
  tags: {
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.TAGS_GET_ALL),
    create: (tagData) => ipcRenderer.invoke(IPC_CHANNELS.TAGS_CREATE, tagData),
    update: (tagId, tagData) => ipcRenderer.invoke(IPC_CHANNELS.TAGS_UPDATE, tagId, tagData),
    delete: (tagId) => ipcRenderer.invoke(IPC_CHANNELS.TAGS_DELETE, tagId)
  },

  // Query operations
  query: {
    execute: (queryData) => ipcRenderer.invoke(IPC_CHANNELS.QUERY_EXECUTE, queryData),
    getSaved: () => ipcRenderer.invoke(IPC_CHANNELS.QUERY_SAVED_GET),
    save: (queryData) => ipcRenderer.invoke(IPC_CHANNELS.QUERY_SAVED_SAVE, queryData),
    delete: (queryId) => ipcRenderer.invoke(IPC_CHANNELS.QUERY_SAVED_DELETE, queryId)
  },

  // Compression operations
  compression: {
    analyze: (imageIds) => ipcRenderer.invoke(IPC_CHANNELS.COMPRESSION_ANALYZE, imageIds),
    execute: (compressionData) => ipcRenderer.invoke(IPC_CHANNELS.COMPRESSION_EXECUTE, compressionData),
    onProgress: (callback) => ipcRenderer.on(IPC_CHANNELS.COMPRESSION_PROGRESS, callback)
  },

  // Settings operations
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
    set: (key, value) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, key, value)
  },

  // Window operations
  window: {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
    openDevTools: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_DEVTOOLS)
  },

  // System operations
  system: {
    getInfo: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_GET_INFO),
    openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, url)
  },

  // Image service operations
  images: {
    loadMetadata: (filePath) => ipcRenderer.invoke('image:load-metadata', filePath),
    processForDisplay: (filePath, targetWidth, targetHeight) => ipcRenderer.invoke('image:process-for-display', { filePath, targetWidth, targetHeight }),
    getFullQuality: (filePath) => ipcRenderer.invoke('image:get-full-quality', filePath),
    copyToGallery: (sourcePath, filename) => ipcRenderer.invoke('image:copy-to-gallery', { sourcePath, filename }),
    validateFormat: (filePath) => ipcRenderer.invoke('image:validate-format', filePath)
  },

  // File operations
  files: {
    selectImages: () => ipcRenderer.invoke('files:select-images')
  },

  // Event listeners
  on: (channel, callback) => {
    // Only allow listening to specific channels for security
    const allowedChannels = [
      IPC_CHANNELS.INGEST_PROGRESS,
      IPC_CHANNELS.COMPRESSION_PROGRESS
    ];

    if (allowedChannels.includes(channel)) {
      ipcRenderer.on(channel, callback);
    }
  },

  // Remove event listeners
  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },

  // Remove all listeners for a channel
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});

// Expose version info - only expose what's actually needed by renderer
contextBridge.exposeInMainWorld('appVersion', {
  app: require('../../package.json').version
});

// Log that preload script loaded successfully
console.log('Preload script loaded successfully');
