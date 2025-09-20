const path = require('path');
const os = require('os');

const appDataDir = path.join(os.homedir(), '.kemono-gallery');
const cacheDir = path.join(appDataDir, 'cache');
const backupDir = path.join(appDataDir, 'backups');
const databaseFile = path.join(appDataDir, 'database.json');
const historyFile = path.join(appDataDir, 'history.json');
const settingsFile = path.join(appDataDir, 'settings.json');

const DEFAULT_SETTINGS = {
  cacheSize: 2,
  autoLoadFromClipboard: true,
  maxHistoryItems: 100,
  allowFullscreenUpscaling: false,
  autoLoadAdjacentArchives: true
};

const DATABASE_TEMPLATE = {
  archives: {},
  images: {},
  history: [],
  settings: { ...DEFAULT_SETTINGS }
};

module.exports = {
  appDataDir,
  cacheDir,
  backupDir,
  databaseFile,
  historyFile,
  settingsFile,
  DEFAULT_SETTINGS,
  DATABASE_TEMPLATE
};
