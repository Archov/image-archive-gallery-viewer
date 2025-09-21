const fs = require('fs').promises;
const path = require('path');
const {
  appDataDir,
  libraryDir,
  backupDir,
  databaseFile,
  historyFile,
  DEFAULT_SETTINGS,
  DATABASE_TEMPLATE
} = require('../config');

let database = JSON.parse(JSON.stringify(DATABASE_TEMPLATE));

function getDatabase() {
  return database;
}

async function ensureDirectories() {
  await Promise.all([
    fs.mkdir(appDataDir, { recursive: true }),
    fs.mkdir(libraryDir, { recursive: true }),
    fs.mkdir(backupDir, { recursive: true })
  ]);
}

async function loadDatabase() {
  try {
    console.log('Loading database from:', databaseFile);
    const data = await fs.readFile(databaseFile, 'utf8');
    const loaded = JSON.parse(data);

    const merged = {
      ...DATABASE_TEMPLATE,
      ...loaded,
      archives: loaded.archives || {},
      images: loaded.images || {},
      history: Array.isArray(loaded.history) ? loaded.history : [],
      settings: { ...DEFAULT_SETTINGS, ...(loaded.settings || {}) }
    };

    if (!Array.isArray(merged.history) || merged.history.length === 0) {
      try {
        console.log('Attempting to load history from separate file:', historyFile);
        const historyData = await fs.readFile(historyFile, 'utf8');
        const parsedHistory = JSON.parse(historyData);
        if (Array.isArray(parsedHistory)) {
          merged.history = parsedHistory;
          console.log(`History loaded from separate file (${parsedHistory.length} items)`);
        }
      } catch (historyError) {
        console.log('History file not found or invalid:', historyError.message);
      }
    }

    database = merged;
    console.log(`Database loaded: ${Object.keys(database.archives).length} archives, ${Object.keys(database.images).length} images`);
  } catch (error) {
    console.log('Database not found or invalid, using defaults');
    database = JSON.parse(JSON.stringify(DATABASE_TEMPLATE));
    await saveDatabase();
  }
}

async function createBackup(filename) {
  try {
    const sourceFile = path.join(appDataDir, filename);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupFile = path.join(backupDir, `${filename}.${timestamp}.bak`);

    try {
      await fs.access(sourceFile);
    } catch (error) {
      return;
    }

    await fs.copyFile(sourceFile, backupFile);
    console.log(`Created backup: ${backupFile}`);
    await cleanupOldBackups(filename);
  } catch (error) {
    console.error(`Failed to create backup for ${filename}:`, error);
  }
}

async function cleanupOldBackups(filename) {
  try {
    const backupFiles = await fs.readdir(backupDir);
    const relevantBackups = backupFiles
      .filter(file => file.startsWith(filename) && file.endsWith('.bak'))
      .map(file => ({
        name: file,
        path: path.join(backupDir, file),
        timestamp: file.match(/\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.bak$/)?.[1]
      }))
      .filter(item => item.timestamp)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (relevantBackups.length > 10) {
      const stale = relevantBackups.slice(10);
      for (const backup of stale) {
        await fs.unlink(backup.path);
        console.log(`Cleaned up old backup: ${backup.name}`);
      }
    }
  } catch (error) {
    console.error('Failed to cleanup old backups:', error);
  }
}

async function saveDatabase() {
  try {
    await createBackup('database.json');
    await createBackup('history.json');

    await fs.writeFile(databaseFile, JSON.stringify(database, null, 2));
    await fs.writeFile(historyFile, JSON.stringify(database.history, null, 2));
  } catch (error) {
    console.error('Failed to save database:', error);
  }
}

async function listBackups() {
  try {
    const files = await fs.readdir(backupDir);
    const backups = {};

    for (const file of files) {
      if (!file.endsWith('.bak')) continue;
      const match = file.match(/^(.+)\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.bak$/);
      if (!match) continue;

      const [, filename, timestamp] = match;
      if (!backups[filename]) backups[filename] = [];
      backups[filename].push({
        filename: file,
        timestamp,
        path: path.join(backupDir, file)
      });
    }

    Object.keys(backups).forEach(key => {
      backups[key].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    });

    return backups;
  } catch (error) {
    console.error('Failed to list backups:', error);
    return {};
  }
}

async function restoreBackup(filename, backupTimestamp) {
  try {
    const backupFile = path.join(backupDir, `${filename}.${backupTimestamp}.bak`);
    const targetFile = path.join(appDataDir, filename);

    await createBackup(filename);
    await fs.copyFile(backupFile, targetFile);
    console.log(`Restored ${filename} from backup: ${backupFile}`);
    if (filename === 'database.json' || filename === 'history.json') {
      await loadDatabase();
    }
    return true;
  } catch (error) {
    console.error(`Failed to restore ${filename} from backup:`, error);
    return false;
  }
}

async function initializeDatabase() {
  await ensureDirectories();
  await loadDatabase();
}

module.exports = {
  initializeDatabase,
  getDatabase,
  loadDatabase,
  saveDatabase,
  listBackups,
  restoreBackup
};
