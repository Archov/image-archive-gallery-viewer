const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsNative = require('fs');
const os = require('os');
const { performance } = require('node:perf_hooks');

// Store user-selected directories for security validation
let allowedDirectories = new Set();

// App configuration
let appConfig = {
  maxFileSizeMB: 50  // Default 50MB limit for individual files
};

// Load app configuration from user data directory
async function loadAppConfig() {
  try {
    const userDataDir = app.getPath('userData');
    const configPath = path.join(userDataDir, 'config.json');

    // Create default config if it doesn't exist
    try {
      await fs.access(configPath);
    } catch {
      await fs.writeFile(configPath, JSON.stringify(appConfig, null, 2));
      console.log('[CONFIG] Created default config file at:', configPath);
    }

    // Load and merge with defaults
    const configData = await fs.readFile(configPath, 'utf8');
    const loadedConfig = JSON.parse(configData);
    appConfig = { ...appConfig, ...loadedConfig };
    console.log('[CONFIG] Loaded app config:', appConfig);
  } catch (error) {
    console.warn('[WARN] Failed to load config, using defaults:', error.message);
  }
}

// Security validation function - prevents path traversal attacks
// This function implements comprehensive path validation to ensure file operations
// are restricted to allowed directories and cannot escape via symlinks or ../
function validateFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path');
  }

  // Sanitize input: strip null bytes only (preserve UNC paths)
  const sanitizedPath = filePath.replace(/\0/g, '');

  // Normalize path to handle relative components and separators properly
  const normalizedPath = process.platform === 'win32'
    ? path.win32.normalize(sanitizedPath)
    : path.normalize(sanitizedPath);

  // Resolve to absolute path to prevent directory traversal
  const absolutePath = path.resolve(normalizedPath);

  // Resolve symlinks to canonical path to prevent symlink escapes
  // SECURITY: This realpathSync call is intentional and validates the path
  // before any file operations, preventing attacks via symbolic links
  let canonicalPath;
  try {
    canonicalPath = fsNative.realpathSync(absolutePath);
  } catch (error) {
    throw new Error('Access denied: Unable to resolve file path');
  }

  // Helper function to check if path is within directory
  function isPathWithinDirectory(testPath, allowedDir) {
    const relative = path.relative(allowedDir, testPath);
    // Normalize case on Windows for comparison
    const normalizedRelative = process.platform === 'win32' ? relative.toLowerCase() : relative;
    // Path is within directory if relative doesn't start with '..' and isn't '..'
    return !normalizedRelative.startsWith('..') && normalizedRelative !== '..';
  }

  // Check against user-selected allowed directories
  for (const allowedDir of allowedDirectories) {
    let canonicalAllowed;
    try {
      canonicalAllowed = fsNative.realpathSync(allowedDir);
    } catch {
      // Skip non-existent entries
      continue;
    }
    if (isPathWithinDirectory(canonicalPath, canonicalAllowed)) {
      return canonicalPath;
    }
  }

  // Check against app's builtin data directories
  const builtinDirs = [
    app.getPath('userData'),
    app.getPath('temp'),
    path.join(app.getPath('userData'), 'images')
  ].map(dir => {
    try {
      return fsNative.realpathSync(dir);
    } catch {
      return null;
    }
  }).filter(Boolean);

  if (builtinDirs.some(dir => isPathWithinDirectory(canonicalPath, dir))) {
    return canonicalPath;
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
    const message = `[MAIN ${new Date().toISOString()}] ` + args.map(a => {
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch { return String(a); }
    }).join(' ');
    debugLogs.push(message);
    if (debugLogs.length > MAX_DEBUG_LOG_LINES) debugLogs.shift();
    originalConsoleLog.apply(console, args);
};

console.error = (...args) => {
    const message = `[MAIN ERROR ${new Date().toISOString()}] ` + args.map(a => {
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch { return String(a); }
    }).join(' ');
    debugLogs.push(message);
    if (debugLogs.length > MAX_DEBUG_LOG_LINES) debugLogs.shift();
    originalConsoleError.apply(console, args);
};

console.warn = (...args) => {
    const message = `[MAIN WARN ${new Date().toISOString()}] ` + args.map(a => {
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch { return String(a); }
    }).join(' ');
    debugLogs.push(message);
    if (debugLogs.length > MAX_DEBUG_LOG_LINES) debugLogs.shift();
    originalConsoleWarn.apply(console, args);
};

// Graceful shutdown handling
const saveDebugLogs = () => {
    try {
        // Append main process logs to the existing file (which may already contain renderer logs)
        const fs = require('fs');
        const mainLogsContent = '\n=== MAIN PROCESS LOGS (FINAL) ===\n' + debugLogs.join('\n') + '\n';
        fs.appendFileSync(debugLogPath, mainLogsContent);
        originalConsoleLog(`[DEBUG] Main process logs saved to: ${debugLogPath}`);
    } catch (e) {
        // ignore
    }
};

app.on('before-quit', () => {
    console.log('[INFO] Application shutting down gracefully...');
    saveDebugLogs();
});

// Handle SIGINT (Ctrl+C) and SIGTERM (kill)
process.on('SIGINT', () => {
    console.log('[INFO] Received SIGINT, shutting down...');
    saveDebugLogs();
    app.quit();
});

process.on('SIGTERM', () => {
    console.log('[INFO] Received SIGTERM, shutting down...');
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
  // Load app configuration first
  await loadAppConfig();

  // Create data directories
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
  console.log('[DEBUG] IPC select-files called');
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
  console.log(`[DEBUG] File dialog completed in ${dialogTime.toFixed(2)}ms, returned ${result.filePaths?.length || 0} files`);

  // Add parent directories to allowed list for security
  if (result.filePaths && result.filePaths.length > 0) {
    result.filePaths.forEach(filePath => {
      const dir = path.dirname(filePath);
      try {
        const canonicalDir = require('fs').realpathSync(dir);
        allowedDirectories.add(canonicalDir);
      } catch {
        allowedDirectories.add(dir);
      }
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
    try {
      const canonicalDir = require('fs').realpathSync(result.filePaths[0]);
      allowedDirectories.add(canonicalDir);
    } catch {
      allowedDirectories.add(result.filePaths[0]);
    }
  }

  return result.canceled ? null : result.filePaths[0] || null;
});

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const displayName = typeof filePath === 'string' ? path.basename(filePath) : '<invalid>';
    console.log(`[DEBUG] IPC read-file called for: ${displayName}`);
    const startTime = performance.now();
    // SECURITY: validateFilePath performs comprehensive path validation including
    // type checking, null byte removal, normalization, canonicalization, and
    // directory boundary checking to prevent path traversal attacks
    const validatedPath = validateFilePath(filePath);

    // Check file size before reading to prevent large IPC transfers
    const stats = await fs.stat(validatedPath);
    const maxFileSizeBytes = appConfig.maxFileSizeMB * 1024 * 1024;
    if (stats.size > maxFileSizeBytes) {
      throw new Error(`File too large: ${(stats.size / (1024 * 1024)).toFixed(2)} MB (limit: ${appConfig.maxFileSizeMB} MB)`);
    }

    const buffer = await fs.readFile(validatedPath);
    const readTime = performance.now() - startTime;
    console.log(`[DEBUG] File read completed in ${readTime.toFixed(2)}ms, size: ${(buffer.length / 1024).toFixed(2)}KB`);
    return buffer;
  } catch (error) {
    console.error(`[ERROR] Failed to read file:`, error.message);
    throw new Error(`Failed to read file: ${error.message}`);
  }
});

ipcMain.handle('get-file-stats', async (event, filePath) => {
  try {
    const displayName = typeof filePath === 'string' ? path.basename(filePath) : '<invalid>';
    console.log(`[DEBUG] IPC get-file-stats called for: ${displayName}`);
    const startTime = performance.now();
    // SECURITY: validateFilePath performs comprehensive path validation including
    // type checking, null byte removal, normalization, canonicalization, and
    // directory boundary checking to prevent path traversal attacks
    const validatedPath = validateFilePath(filePath);
    const stats = await fs.stat(validatedPath);
    const statTime = performance.now() - startTime;
    console.log(`[DEBUG] File stats completed in ${statTime.toFixed(2)}ms, size: ${(stats.size / 1024).toFixed(2)}KB`);
    return {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      mtimeISO: stats.mtime.toISOString(),
      isFile: stats.isFile()
    };
  } catch (error) {
    console.error(`[ERROR] Failed to get file stats:`, error.message);
    throw new Error(`Failed to get file stats: ${error.message}`);
  }
});

ipcMain.handle('get-debug-log-path', async () => {
  console.log(`[DEBUG] Returning debug log path: ${debugLogPath}`);
  return debugLogPath;
});

ipcMain.handle('append-renderer-logs', async (event, rendererLogs) => {
  try {
    console.log(`[DEBUG] appendRendererLogs called with ${rendererLogs?.length || 0} logs`);
    if (Array.isArray(rendererLogs) && rendererLogs.length > 0) {
      const logContent = '\n=== RENDERER PROCESS LOGS ===\n' + rendererLogs.join('\n') + '\n';
      console.log(`[DEBUG] Writing ${logContent.length} characters to ${debugLogPath}`);
      require('fs').appendFileSync(debugLogPath, logContent);
      console.log(`[DEBUG] Successfully appended ${rendererLogs.length} renderer logs to main debug file`);

      // Verify the file was written
      const fs = require('fs');
      if (fs.existsSync(debugLogPath)) {
        const stats = fs.statSync(debugLogPath);
        console.log(`[DEBUG] File size after append: ${stats.size} bytes`);
      }
    } else {
      console.log('[DEBUG] No renderer logs to append or invalid format');
    }
  } catch (error) {
    console.error('[ERROR] Failed to append renderer logs:', error.message);
    console.error('[ERROR] Stack:', error.stack);
  }
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
