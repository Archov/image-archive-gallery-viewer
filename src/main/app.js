const { app, ipcMain } = require('electron');
const { createMainWindow } = require('./window');
const { initializeDatabase, saveDatabase } = require('./services/databaseService');
const { registerHandlers } = require('./ipc/registerHandlers');
const { cleanupExtractedImages } = require('./services/maintenanceService');

let mainWindow = null;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

function getMainWindow() {
  return mainWindow;
}

async function onReady() {
  await initializeDatabase();

  mainWindow = createMainWindow();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  registerHandlers(ipcMain, { getMainWindow });

  app.on('activate', () => {
    if (mainWindow === null || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
    }
  });

  setInterval(() => {
    cleanupExtractedImages().catch(error => {
      console.error('Failed to cleanup extracted images:', error);
    });
  }, CLEANUP_INTERVAL_MS);
}

function setupAppLifecycle() {
  app.whenReady().then(onReady);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', async () => {
    await saveDatabase();
  });
}

function bootstrap() {
  setupAppLifecycle();
}

module.exports = {
  bootstrap
};
