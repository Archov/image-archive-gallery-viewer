const { createHash } = require('crypto');
const {
  loadArchiveFromUrl,
  loadLocalArchive,
  extractImage,
  toggleImageStar
} = require('../services/archiveService');
const {
  loadSettings,
  saveSettings
} = require('../services/settingsService');
const {
  loadHistory,
  addToHistory,
  clearHistory,
  toggleHistoryStar,
  renameHistoryItem,
  reorderHistory
} = require('../services/historyService');
const {
  clearCache,
  getCacheUsage
} = require('../services/cacheService');
const {
  listBackups,
  restoreBackup
} = require('../services/databaseService');

function registerHandlers(ipcMain, { getMainWindow }) {
  ipcMain.handle('load-archive', async (event, url, cacheSizeLimitGB) => {
    const mainWindow = getMainWindow();
    const archiveId = createHash('md5').update(url).digest('hex');

    const onProgress = mainWindow
      ? (progress, downloaded, total) => {
          mainWindow.webContents.send('download-progress', {
            archiveId,
            progress: Math.round(progress),
            downloaded,
            total
          });
        }
      : null;

    return loadArchiveFromUrl(url, cacheSizeLimitGB, { onProgress });
  });

  ipcMain.handle('load-local-archive', async (event, filePath) => {
    return loadLocalArchive(filePath);
  });

  ipcMain.handle('load-settings', async () => {
    return loadSettings();
  });

  ipcMain.handle('save-settings', async (event, settings) => {
    await saveSettings(settings);
  });

  ipcMain.handle('load-history', async () => {
    return loadHistory();
  });

  ipcMain.handle('add-to-history', async (event, historyItem) => {
    await addToHistory(historyItem);
  });

  ipcMain.handle('clear-history', async () => {
    await clearHistory();
  });

  ipcMain.handle('toggle-image-star', async (event, archiveId, imageId) => {
    return toggleImageStar(archiveId, imageId);
  });

  ipcMain.handle('toggle-history-star', async (event, historyId) => {
    return toggleHistoryStar(historyId);
  });

  ipcMain.handle('extract-image', async (event, archiveId, imageId) => {
    return extractImage(archiveId, imageId);
  });

  ipcMain.handle('clear-cache', async () => {
    await clearCache();
  });

  ipcMain.handle('get-cache-info', async () => {
    return getCacheUsage();
  });

  ipcMain.handle('list-backups', async () => {
    return listBackups();
  });

  ipcMain.handle('restore-backup', async (event, filename, timestamp) => {
    return restoreBackup(filename, timestamp);
  });

  ipcMain.handle('rename-history-item', async (event, historyId, newName) => {
    return renameHistoryItem(historyId, newName);
  });

  ipcMain.handle('reorder-history', async (event, newOrder) => {
    return reorderHistory(newOrder);
  });
}

module.exports = {
  registerHandlers
};
