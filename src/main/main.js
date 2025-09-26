const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// Keep a global reference of the window object
let mainWindow;
let debugLogs = [];
const debugLogPath = path.join(os.tmpdir(), `gallery-main-debug-${Date.now()}.txt`);

// Override console for main process
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = (...args) => {
    const message = `[MAIN ${new Date().toISOString()}] ${args.join(' ')}`;
    debugLogs.push(message);
    originalConsoleLog.apply(console, args);
};

console.error = (...args) => {
    const message = `[MAIN ERROR ${new Date().toISOString()}] ${args.join(' ')}`;
    debugLogs.push(message);
    originalConsoleError.apply(console, args);
};

console.warn = (...args) => {
    const message = `[MAIN WARN ${new Date().toISOString()}] ${args.join(' ')}`;
    debugLogs.push(message);
    originalConsoleWarn.apply(console, args);
};

// Save debug logs on exit
process.on('exit', () => {
    try {
        require('fs').writeFileSync(debugLogPath, debugLogs.join('\n'));
        originalConsoleLog(`🔍 DEBUG: Main process logs saved to: ${debugLogPath}`);
    } catch (e) {
        // ignore
    }
});

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
app.whenReady().then(createWindow);

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

  return result.filePaths;
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  return result.filePaths[0];
});

ipcMain.handle('read-file', async (event, filePath) => {
  console.log(`🔍 DEBUG: IPC read-file called for: ${filePath.split(/[/\\]/).pop()}`);
  const startTime = performance.now();

  try {
    const buffer = await fs.readFile(filePath);
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
    const stats = await fs.stat(filePath);
    const statTime = performance.now() - startTime;
    console.log(`🔍 DEBUG: File stats completed in ${statTime.toFixed(2)}ms, size: ${(stats.size / 1024).toFixed(2)}KB`);
    return {
      size: stats.size,
      mtime: stats.mtime,
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

// Ensure data directories exist
app.whenReady().then(async () => {
  const imagesDir = path.join(__dirname, '../../images');
  const tempDir = path.join(__dirname, '../../temp');

  try {
    await fs.mkdir(imagesDir, { recursive: true });
    await fs.mkdir(tempDir, { recursive: true });
  } catch (error) {
    console.error('Failed to create data directories:', error);
  }
});
