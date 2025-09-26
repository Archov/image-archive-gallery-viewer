const { contextBridge, ipcRenderer } = require('electron');
const { IPC_CHANNELS } = require('../shared/constants');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations
  db: {
    init: () => ipcRenderer.invoke(IPC_CHANNELS.DB_INIT),
    query: (query, params) => ipcRenderer.invoke(IPC_CHANNELS.DB_QUERY, query, params),
    execute: (query, params) => ipcRenderer.invoke(IPC_CHANNELS.DB_EXECUTE, query, params)
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

// Expose version info
contextBridge.exposeInMainWorld('appVersion', process.versions);

// Log that preload script loaded successfully
console.log('Preload script loaded successfully');
