const path = require('path');
const { app } = require('electron');
const {
  DATABASE_DIR,
  IMAGES_DIR,
  THUMBNAILS_DIR,
  TEMP_DIR,
  LOGS_DIR
} = require('../shared/constants');

// Application configuration
const config = {
  // Window settings
  window: {
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    titleBarStyle: 'default',
    show: false, // Show after ready-to-show
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    }
  },

  // Development settings
  isDevelopment: process.env.NODE_ENV === 'development',

  // Directory paths - constructed dynamically using Electron's userData
  paths: {
    appData: path.join(app.getPath('userData'), 'image-gallery-manager'),
    database: path.join(app.getPath('userData'), 'image-gallery-manager', DATABASE_DIR),
    images: path.join(app.getPath('userData'), 'image-gallery-manager', IMAGES_DIR),
    thumbnails: path.join(app.getPath('userData'), 'image-gallery-manager', THUMBNAILS_DIR),
    temp: path.join(app.getPath('userData'), 'image-gallery-manager', TEMP_DIR),
    logs: path.join(app.getPath('userData'), 'image-gallery-manager', LOGS_DIR),
    userData: app.getPath('userData')
  },

  // Performance settings
  performance: {
    maxConcurrentImages: 10,
    thumbnailQuality: 80,
    maxMemoryUsage: 512 * 1024 * 1024, // 512MB
    cleanupInterval: 5 * 60 * 1000 // 5 minutes
  },

  // Network settings
  network: {
    timeout: 30000, // 30 seconds
    retries: 3,
    userAgent: 'ImageGalleryManager/2.0'
  }
};

module.exports = config;
