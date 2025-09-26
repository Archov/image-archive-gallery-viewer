const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const path = require('path');
const fs = require('fs').promises;

const config = require('./config');
const databaseService = require('./database');
const { registerIPCHandlers } = require('./ipc/handlers');

let mainWindow;
let isQuitting = false;

// Create main application window
function createMainWindow() {
  mainWindow = new BrowserWindow({
    ...config.window,
    icon: path.join(__dirname, '../../assets/icon.png'), // TODO: Create icon
    webPreferences: {
      ...config.window.webPreferences,
      preload: path.join(__dirname, 'preload.js') // TODO: Create preload script
    }
  });

  // Load the application
  if (config.isDevelopment) {
    mainWindow.loadURL('http://localhost:3000'); // For development with hot reload
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html')); // TODO: Create HTML file
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    if (config.isDevelopment) {
      mainWindow.maximize();
    }
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Prevent new window creation on navigation
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  return mainWindow;
}

// Register custom protocol for browser integration
function registerCustomProtocol() {
  // Register 'image-gallery://' protocol for browser integration
  protocol.registerFileProtocol('image-gallery', (request, callback) => {
    // TODO: Handle custom protocol requests for browser integration
    // This will be used by the userscript to send data to the gallery
    console.log('Custom protocol request:', request.url);

    // Must call callback to prevent hanging requests
    callback({ error: -6 }); // net::ERR_FILE_NOT_FOUND placeholder
  });
}

// Initialize application
async function initializeApp() {
  try {
    // Ensure required directories exist
    await createRequiredDirectories();

    // Initialize database
    await databaseService.initialize();

    // Register custom protocol
    registerCustomProtocol();

    // Register IPC handlers
    registerIPCHandlers(ipcMain);

    // Create main window
    createMainWindow();

    console.log('Application initialized successfully');
  } catch (error) {
    console.error('Failed to initialize application:', error);
    app.quit();
  }
}

// Create required directories
async function createRequiredDirectories() {
  const dirs = Object.values(config.paths);

  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }
}

// Handle app events
app.whenReady().then(initializeApp);

app.on('window-all-closed', () => {
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin' || isQuitting) {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on('before-quit', async (event) => {
  isQuitting = true;

  // Prevent quit until cleanup is complete
  event.preventDefault();

  try {
    // Close database connections
    databaseService.close();

    // Perform cleanup
    await performCleanup();

    // Now allow the quit to proceed
    app.quit();
  } catch (error) {
    console.error('Cleanup failed, forcing quit:', error);
    app.quit();
  }
});

// Graceful shutdown handling
process.on('SIGINT', () => {
  isQuitting = true;
  app.quit();
});

process.on('SIGTERM', () => {
  isQuitting = true;
  app.quit();
});

// Cleanup function
async function performCleanup() {
  try {
    // Clean up temporary files
    const tempDir = config.paths.temp;
    // TODO: Implement temp file cleanup

    console.log('Cleanup completed');
  } catch (error) {
    console.error('Cleanup failed:', error);
  }
}

// Export for testing
module.exports = {
  createMainWindow,
  initializeApp
};
