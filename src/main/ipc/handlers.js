const { dialog } = require('electron');
const databaseService = require('../database');
const config = require('../config');
const { IPC_CHANNELS } = require('../../shared/constants');

// IPC handler registry
const handlers = {};

// Database operations - Purpose-built channels only (no generic SQL execution)
handlers[IPC_CHANNELS.DB_INIT] = async () => {
  // Database is already initialized in main process
  return { success: true };
};

// NOTE: Removed generic DB_QUERY and DB_EXECUTE for security - replaced with specific purpose-built channels

// Image operations
handlers[IPC_CHANNELS.IMAGE_LOAD] = async (event, imageId) => {
  try {
    const stmt = databaseService.getStatements().getImage;
    const image = stmt.get(imageId);

    if (!image) {
      return { success: false, error: 'Image not found' };
    }

    return { success: true, data: image };
  } catch (error) {
    console.error('Image load error:', error);
    return { success: false, error: error.message };
  }
};

// Metadata operations
handlers[IPC_CHANNELS.TAGS_GET_ALL] = async () => {
  try {
    const stmt = databaseService.getStatements().getAllTags;
    const tags = stmt.all();
    return { success: true, data: tags };
  } catch (error) {
    console.error('Get tags error:', error);
    return { success: false, error: error.message };
  }
};

handlers[IPC_CHANNELS.TAGS_CREATE] = async (event, tagData) => {
  try {
    const { id, name, category, color } = tagData;
    const stmt = databaseService.getStatements().insertTag;
    stmt.run(id, name, category, color);
    return { success: true };
  } catch (error) {
    console.error('Create tag error:', error);
    return { success: false, error: error.message };
  }
};

// Settings operations
handlers[IPC_CHANNELS.SETTINGS_GET] = async () => {
  try {
    const settings = {};
    const stmt = databaseService.getStatements().getSetting;

    // Get all settings
    const allSettings = databaseService.db.prepare('SELECT key, value FROM settings').all();

    allSettings.forEach(({ key, value }) => {
      try {
        settings[key] = JSON.parse(value);
      } catch {
        settings[key] = value;
      }
    });

    return { success: true, data: settings };
  } catch (error) {
    console.error('Get settings error:', error);
    return { success: false, error: error.message };
  }
};

handlers[IPC_CHANNELS.SETTINGS_SET] = async (event, key, value) => {
  try {
    const stmt = databaseService.getStatements().setSetting;
    const jsonValue = typeof value === 'object' ? JSON.stringify(value) : value;
    stmt.run(key, jsonValue);
    return { success: true };
  } catch (error) {
    console.error('Set setting error:', error);
    return { success: false, error: error.message };
  }
};

// Window operations
handlers[IPC_CHANNELS.WINDOW_MINIMIZE] = (event) => {
  const win = require('electron').BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
  return { success: true };
};

handlers[IPC_CHANNELS.WINDOW_MAXIMIZE] = (event) => {
  const win = require('electron').BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
  return { success: true };
};

handlers[IPC_CHANNELS.WINDOW_CLOSE] = (event) => {
  const win = require('electron').BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
  return { success: true };
};

handlers[IPC_CHANNELS.WINDOW_OPEN_DEVTOOLS] = (event) => {
  if (config.isDevelopment) {
    event.sender.openDevTools();
  }
  return { success: true };
};

// System operations
handlers[IPC_CHANNELS.SYSTEM_GET_INFO] = () => {
  const os = require('os');
  return {
    success: true,
    data: {
      platform: process.platform,
      arch: process.arch,
      version: process.version,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      cpus: os.cpus().length
    }
  };
};

handlers[IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL] = async (event, url) => {
  const { shell } = require('electron');

  // Validate URL scheme to prevent security issues
  try {
    const urlObj = new URL(url);
    // Only allow http and https schemes
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return { success: false, error: 'Invalid URL scheme. Only http and https are allowed.' };
    }

    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('Open external error:', error);
    return { success: false, error: error.message };
  }
};

// Register all handlers
function registerIPCHandlers(ipcMain) {
  Object.entries(handlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, handler);
  });

  console.log(`Registered ${Object.keys(handlers).length} IPC handlers`);
}

module.exports = {
  registerIPCHandlers,
  handlers
};
