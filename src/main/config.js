const path = require('path');
const {
  APP_DATA_DIR,
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

  // Directory paths
  paths: {
    appData: APP_DATA_DIR,
    database: DATABASE_DIR,
    images: IMAGES_DIR,
    thumbnails: THUMBNAILS_DIR,
    temp: TEMP_DIR,
    logs: LOGS_DIR,
    userData: APP_DATA_DIR
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
