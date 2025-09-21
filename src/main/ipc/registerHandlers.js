const { createHash } = require('crypto');
const { dialog } = require('electron');
const {
  loadArchiveFromUrl,
  loadLocalArchive,
  loadLocalArchiveFromData,
  extractImage,
  toggleImageStar,
  debugArchiveContents
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
  clearLibrary,
  getLibraryUsage
} = require('../services/libraryService');
const {
  listBackups,
  restoreBackup
} = require('../services/databaseService');

function registerHandlers(ipcMain, { getMainWindow }) {
  ipcMain.handle('load-archive', async (event, url, librarySizeLimitGB) => {
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

    return loadArchiveFromUrl(url, librarySizeLimitGB, { onProgress });
  });

  // Show move/copy dialog for local files
  ipcMain.handle('show-local-archive-dialog', async (event, filePath) => {
    const mainWindow = getMainWindow();
    
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Add Archive to Library',
      message: `How would you like to add this archive to your library?`,
      detail: `File: ${filePath}\\n\\nMove: Moves the original file to your library (recommended)\\nCopy: Keeps the original file and creates a copy in your library`,
      buttons: ['Move to Library', 'Copy to Library', 'Cancel'],
      defaultId: 0,
      cancelId: 2
    });

    if (result.response === 2) {
      return { cancelled: true };
    }

    return {
      cancelled: false,
      moveToLibrary: result.response === 0
    };
  });

  ipcMain.handle('load-local-archive', async (event, filePath, librarySizeGB, options = {}) => {
    return loadLocalArchive(filePath, librarySizeGB, options);
  });

  ipcMain.handle('load-local-archive-from-data', async (event, fileData, librarySizeGB) => {
    return loadLocalArchiveFromData(fileData, librarySizeGB);
  });

  ipcMain.handle('debug-archive-contents', async (event, filePath) => {
    return debugArchiveContents(filePath);
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

  ipcMain.handle('clear-library', async () => {
    await clearLibrary();
  });

  ipcMain.handle('get-library-info', async () => {
    return getLibraryUsage();
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
