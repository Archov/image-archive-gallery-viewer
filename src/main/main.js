const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { performance } = require('node:perf_hooks');

// Store user-selected directories for security validation
let allowedDirectories = new Set();

// Security validation function
function validateFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path');
  }

  // Sanitize input: normalize path separators and remove null bytes
  const sanitizedPath = filePath.replace(/\0/g, '').replace(/[/\\]+/g, path.sep);

  // Resolve to absolute path to prevent directory traversal
  const absolutePath = path.resolve(sanitizedPath);

  // Helper function to check if path is within directory
  function isPathWithinDirectory(testPath, allowedDir) {
    const resolvedAllowedDir = path.resolve(allowedDir);
    const relative = path.relative(resolvedAllowedDir, testPath);
    // Normalize case on Windows for comparison
    const normalizedRelative = process.platform === 'win32' ? relative.toLowerCase() : relative;
    // Path is within directory if relative doesn't start with '..' and isn't '..'
    return !normalizedRelative.startsWith('..') && normalizedRelative !== '..';
  }

  // Check if path is within allowed directories
  for (const allowedDir of allowedDirectories) {
    if (isPathWithinDirectory(absolutePath, allowedDir)) {
      return absolutePath;
    }
  }

  // Allow paths within the app's data directories
  const userDataDir = app.getPath('userData');
  const tempDir = app.getPath('temp');
  const imagesDir = path.join(userDataDir, 'images');

  if (isPathWithinDirectory(absolutePath, userDataDir) ||
      isPathWithinDirectory(absolutePath, tempDir) ||
      isPathWithinDirectory(absolutePath, imagesDir)) {
    return absolutePath;
  }

  throw new Error('Access denied: File path not within allowed directories');
}

// Keep a global reference of the window object
let mainWindow;
let debugLogs = [];
const MAX_DEBUG_LOG_LINES = 5000;
const debugLogPath = path.join(os.tmpdir(), `gallery-main-debug-${Date.now()}.txt`);

// Override console for main process
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = (...args) => {
    const message = `[MAIN ${new Date().toISOString()}] ${args.join(' ')}`;
    debugLogs.push(message);
    if (debugLogs.length > MAX_DEBUG_LOG_LINES) debugLogs.shift();
    originalConsoleLog.apply(console, args);
};

console.error = (...args) => {
    const message = `[MAIN ERROR ${new Date().toISOString()}] ${args.join(' ')}`;
    debugLogs.push(message);
    if (debugLogs.length > MAX_DEBUG_LOG_LINES) debugLogs.shift();
    originalConsoleError.apply(console, args);
};

console.warn = (...args) => {
    const message = `[MAIN WARN ${new Date().toISOString()}] ${args.join(' ')}`;
    debugLogs.push(message);
    if (debugLogs.length > MAX_DEBUG_LOG_LINES) debugLogs.shift();
    originalConsoleWarn.apply(console, args);
};

// Graceful shutdown handling
const saveDebugLogs = () => {
    try {
        require('fs').writeFileSync(debugLogPath, debugLogs.join('\n'));
        originalConsoleLog(`🔍 DEBUG: Main process logs saved to: ${debugLogPath}`);
    } catch (e) {
        // ignore
    }
};

app.on('before-quit', () => {
    console.log('🔄 Application shutting down gracefully...');
    saveDebugLogs();
});

// Handle SIGINT (Ctrl+C) and SIGTERM (kill)
process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, shutting down...');
    saveDebugLogs();
    app.quit();
});

process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down...');
    saveDebugLogs();
    app.quit();
});

// Save debug logs on exit (fallback for other termination scenarios)
process.on('exit', saveDebugLogs);

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    // icon: path.join(__dirname, '../../assets/icon.png'), // TODO: Add app icon
    titleBarStyle: 'default',
    show: false
  });

  // Load the app
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App event handlers
app.whenReady().then(async () => {
  // Create data directories first
  const userDataDir = app.getPath('userData');
  const imagesDir = path.join(userDataDir, 'images');
  const tempDir = app.getPath('temp');

  try {
    await fs.mkdir(imagesDir, { recursive: true });
    await fs.mkdir(tempDir, { recursive: true });
  } catch (error) {
    console.error('Failed to create data directories:', error);
  }

  // Then create the window
  createWindow();
});

app.on('window-all-closed', () => {
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers for file operations
ipcMain.handle('select-files', async () => {
  console.log('🔍 DEBUG: IPC select-files called');
  const startTime = performance.now();

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Images',
        extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg']
      }
    ]
  });

  const dialogTime = performance.now() - startTime;
  console.log(`🔍 DEBUG: File dialog completed in ${dialogTime.toFixed(2)}ms, returned ${result.filePaths?.length || 0} files`);

  // Add parent directories to allowed list for security
  if (result.filePaths && result.filePaths.length > 0) {
    result.filePaths.forEach(filePath => {
      const dir = path.dirname(filePath);
      allowedDirectories.add(dir);
    });
  }

  return result.filePaths;
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  // Add selected directory to allowed list for security
  if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
    allowedDirectories.add(result.filePaths[0]);
  }

  return result.canceled ? null : result.filePaths[0] || null;
});

ipcMain.handle('read-file', async (event, filePath) => {
  console.log(`🔍 DEBUG: IPC read-file called for: ${filePath.split(/[/\\]/).pop()}`);
  const startTime = performance.now();

  try {
    const validatedPath = validateFilePath(filePath);
    const buffer = await fs.readFile(validatedPath);
    const readTime = performance.now() - startTime;
    console.log(`🔍 DEBUG: File read completed in ${readTime.toFixed(2)}ms, size: ${(buffer.length / 1024).toFixed(2)}KB`);
    return buffer;
  } catch (error) {
    console.error(`❌ Failed to read file ${filePath}:`, error.message);
    throw new Error(`Failed to read file: ${error.message}`);
  }
});

ipcMain.handle('get-file-stats', async (event, filePath) => {
  console.log(`🔍 DEBUG: IPC get-file-stats called for: ${filePath.split(/[/\\]/).pop()}`);
  const startTime = performance.now();

  try {
    const validatedPath = validateFilePath(filePath);
    const stats = await fs.stat(validatedPath);
    const statTime = performance.now() - startTime;
    console.log(`🔍 DEBUG: File stats completed in ${statTime.toFixed(2)}ms, size: ${(stats.size / 1024).toFixed(2)}KB`);
    return {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      mtimeISO: stats.mtime.toISOString(),
      isFile: stats.isFile()
    };
  } catch (error) {
    console.error(`❌ Failed to get file stats ${filePath}:`, error.message);
    throw new Error(`Failed to get file stats: ${error.message}`);
  }
});

ipcMain.handle('get-debug-log-path', async () => {
  console.log(`🔍 DEBUG: Returning debug log path: ${debugLogPath}`);
  return debugLogPath;
});

// Window control handlers
ipcMain.handle('minimize-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.handle('maximize-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('close-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});
