const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs').promises
const fsNative = require('node:fs')
const os = require('node:os')
const { performance } = require('node:perf_hooks')
const secureFs = require('./secure-fs')
const archiveService = require('./archive-service')

// App configuration
let appConfig = {
  maxFileSizeMB: 50, // Default 50MB limit for individual files
}

// Load app configuration from user data directory
async function loadAppConfig() {
  try {
    const userDataDir = app.getPath('userData')
    const configPath = path.join(userDataDir, 'config.json')

    // Create default config if it doesn't exist
    try {
      await fs.access(configPath)
    } catch {
      await fs.writeFile(configPath, JSON.stringify(appConfig, null, 2))
      console.log('[CONFIG] Created default config file at:', configPath)
    }

    // Load and merge with defaults
    const configData = await fs.readFile(configPath, 'utf8')
    const defaults = { ...appConfig }
    const loadedConfig = JSON.parse(configData)
    const mergedConfig = { ...defaults, ...loadedConfig }

    // Validate and sanitize maxFileSizeMB
    const parsedMaxSize = Number(mergedConfig.maxFileSizeMB)
    if (!Number.isFinite(parsedMaxSize) || parsedMaxSize <= 0) {
      console.warn(
        '[CONFIG] Invalid maxFileSizeMB, reverting to default:',
        mergedConfig.maxFileSizeMB
      )
      mergedConfig.maxFileSizeMB = defaults.maxFileSizeMB
    } else {
      mergedConfig.maxFileSizeMB = parsedMaxSize
    }

    appConfig = mergedConfig
    console.log('[CONFIG] Loaded app config:', appConfig)
  } catch (error) {
    console.warn('[WARN] Failed to load config, using defaults:', error.message)
  }
}

// Keep a global reference of the window object
let mainWindow
const debugLogs = []
const MAX_DEBUG_LOG_LINES = 5000
const debugLogPath = path.join(os.tmpdir(), `gallery-main-debug-${Date.now()}.txt`)

// IPC sender validation for security
function validateSender(event) {
  // Validate that the sender is the main window's webContents
  // This prevents unauthorized access from untrusted iframes or other web frames
  return event.sender === mainWindow?.webContents
}

// Override console for main process
const originalConsoleLog = console.log
const originalConsoleError = console.error
const originalConsoleWarn = console.warn

console.log = (...args) => {
  const message = `[MAIN ${new Date().toISOString()}] ${args
    .map((a) => {
      try {
        return typeof a === 'object' ? JSON.stringify(a) : String(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')}`
  debugLogs.push(message)
  if (debugLogs.length > MAX_DEBUG_LOG_LINES) debugLogs.shift()
  originalConsoleLog.apply(console, args)
}

console.error = (...args) => {
  const message = `[MAIN ERROR ${new Date().toISOString()}] ${args
    .map((a) => {
      try {
        return typeof a === 'object' ? JSON.stringify(a) : String(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')}`
  debugLogs.push(message)
  if (debugLogs.length > MAX_DEBUG_LOG_LINES) debugLogs.shift()
  originalConsoleError.apply(console, args)
}

console.warn = (...args) => {
  const message = `[MAIN WARN ${new Date().toISOString()}] ${args
    .map((a) => {
      try {
        return typeof a === 'object' ? JSON.stringify(a) : String(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')}`
  debugLogs.push(message)
  if (debugLogs.length > MAX_DEBUG_LOG_LINES) debugLogs.shift()
  originalConsoleWarn.apply(console, args)
}

// Graceful shutdown handling
const saveDebugLogs = () => {
  try {
    // Append main process logs to the existing file (which may already contain renderer logs)
    const mainLogsContent = `\n=== MAIN PROCESS LOGS (FINAL) ===\n${debugLogs.join('\n')}\n`
    fsNative.appendFileSync(debugLogPath, mainLogsContent)
    originalConsoleLog(`[DEBUG] Main process logs saved to: ${debugLogPath}`)
  } catch (_e) {
    // ignore
  }
}

app.on('before-quit', () => {
  console.log('[INFO] Application shutting down gracefully...')
  saveDebugLogs()
})

// Handle SIGINT (Ctrl+C) and SIGTERM (kill)
process.on('SIGINT', () => {
  console.log('[INFO] Received SIGINT, shutting down...')
  saveDebugLogs()
  app.quit()
})

process.on('SIGTERM', () => {
  console.log('[INFO] Received SIGTERM, shutting down...')
  saveDebugLogs()
  app.quit()
})

// Save debug logs on exit (fallback for other termination scenarios)
process.on('exit', saveDebugLogs)

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
      preload: path.join(__dirname, 'preload.js'),
    },
    // icon: path.join(__dirname, '../../assets/icon.png'), // TODO: Add app icon
    titleBarStyle: 'default',
    show: false,
  })

  // Load the app
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// App event handlers
app.whenReady().then(async () => {
  // Initialize secure file system with allowed paths
  secureFs.initializeAllowedPaths(app)

  // Initialize archive service
  await archiveService.initialize(app)

  // Load app configuration first
  await loadAppConfig()

  // Create data directories
  const userDataDir = app.getPath('userData')
  const imagesDir = path.join(userDataDir, 'images')
  const tempDir = path.join(app.getPath('temp'), 'image-archive-viewer')

  try {
    await fs.mkdir(imagesDir, { recursive: true })
    await fs.mkdir(tempDir, { recursive: true })
  } catch (error) {
    console.error('Failed to create data directories:', error)
  }

  // Then create the window
  createWindow()
})

app.on('window-all-closed', () => {
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// IPC handlers for file operations
ipcMain.handle('select-files', async () => {
  console.log('[DEBUG] IPC select-files called')
  const startTime = performance.now()

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'All Supported Files',
        extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg', 'zip', 'rar', '7z'],
      },
      {
        name: 'Images',
        extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg'],
      },
      {
        name: 'Archives',
        extensions: ['zip', 'rar', '7z'],
      },
    ],
  })

  const dialogTime = performance.now() - startTime
  console.log(
    `[DEBUG] File dialog completed in ${dialogTime.toFixed(2)}ms, returned ${result.filePaths?.length || 0} files`
  )

  // Add parent directories to allowed list for security
  if (result.filePaths && result.filePaths.length > 0) {
    result.filePaths.forEach((filePath) => {
      const dir = path.dirname(filePath)
      secureFs.addAllowedDirectory(dir)
    })
  }

  return result.filePaths
})

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  })

  // Add selected directory to allowed list for security
  if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
    secureFs.addAllowedDirectory(result.filePaths[0])
  }

  return result.canceled ? null : result.filePaths[0] || null
})

ipcMain.handle('read-file', async (event, filePath) => {
  // SECURITY: Validate IPC sender to prevent unauthorized access
  if (!validateSender(event)) {
    throw new Error('Unauthorized IPC sender')
  }

  try {
    const displayName = typeof filePath === 'string' ? path.basename(filePath) : '<invalid>'
    console.log(`[DEBUG] IPC read-file called for: ${displayName}`)
    const startTime = performance.now()

    // SECURITY: Ensure path is within allowed directories (set via dialogs/init)
    const validatedPath = secureFs.validateFilePath(filePath)
    // Get file stats first for size check
    const stats = await secureFs.stat(validatedPath)
    const maxFileSizeBytes = appConfig.maxFileSizeMB * 1024 * 1024
    if (stats.size > maxFileSizeBytes) {
      throw new Error(
        `File too large: ${(stats.size / (1024 * 1024)).toFixed(2)} MB (limit: ${appConfig.maxFileSizeMB} MB)`
      )
    }

    // Read file (after validation)
    const buffer = await secureFs.readFile(validatedPath)
    // TOCTOU: ensure file didn't grow beyond limit after read
    if (buffer.length > maxFileSizeBytes) {
      throw new Error(
        `File too large after read (possible change during operation): ${(buffer.length / (1024 * 1024)).toFixed(2)} MB`
      )
    }
    const readTime = performance.now() - startTime
    console.log(
      `[DEBUG] File read completed in ${readTime.toFixed(2)}ms, size: ${(buffer.length / 1024).toFixed(2)}KB`
    )
    return buffer
  } catch (error) {
    console.error(`[ERROR] Failed to read file:`, error.message)
    throw new Error(`Failed to read file: ${error.message}`)
  }
})

ipcMain.handle('get-file-stats', async (event, filePath) => {
  // SECURITY: Validate IPC sender to prevent unauthorized access
  if (!validateSender(event)) {
    throw new Error('Unauthorized IPC sender')
  }

  try {
    const displayName = typeof filePath === 'string' ? path.basename(filePath) : '<invalid>'
    console.log(`[DEBUG] IPC get-file-stats called for: ${displayName}`)
    const startTime = performance.now()

    // SECURITY: Ensure path is within allowed directories
    const validatedPath = secureFs.validateFilePath(filePath)
    const stats = await secureFs.stat(validatedPath)
    const statTime = performance.now() - startTime
    console.log(
      `[DEBUG] File stats completed in ${statTime.toFixed(2)}ms, size: ${(stats.size / 1024).toFixed(2)}KB`
    )
    return {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      mtimeISO: stats.mtime.toISOString(),
      isFile: stats.isFile(),
    }
  } catch (error) {
    console.error(`[ERROR] Failed to get file stats:`, error.message)
    throw new Error(`Failed to get file stats: ${error.message}`)
  }
})

ipcMain.handle('get-debug-log-path', async () => {
  console.log(`[DEBUG] Returning debug log path: ${debugLogPath}`)
  return debugLogPath
})

ipcMain.handle('append-renderer-logs', async (event, rendererLogs) => {
  // SECURITY: Validate IPC sender to prevent unauthorized access
  if (!validateSender(event)) {
    throw new Error('Unauthorized IPC sender')
  }

  try {
    console.log(`[DEBUG] appendRendererLogs called with ${rendererLogs?.length || 0} logs`)
    if (Array.isArray(rendererLogs) && rendererLogs.length > 0) {
      const logContent = `\n=== RENDERER PROCESS LOGS ===\n${rendererLogs.join('\n')}\n`
      console.log(`[DEBUG] Writing ${logContent.length} characters to ${debugLogPath}`)
      await fsNative.promises.appendFile(debugLogPath, logContent)
      console.log(
        `[DEBUG] Successfully appended ${rendererLogs.length} renderer logs to main debug file`
      )

      // Verify the file was written
      if (fsNative.existsSync(debugLogPath)) {
        const stats = await fsNative.promises.stat(debugLogPath)
        console.log(`[DEBUG] File size after append: ${stats.size} bytes`)
      }
    } else {
      console.log('[DEBUG] No renderer logs to append or invalid format')
    }
  } catch (error) {
    console.error('[ERROR] Failed to append renderer logs:', error.message)
    console.error('[ERROR] Stack:', error.stack)
  }
})

// Archive processing IPC handlers
ipcMain.handle('select-archives', async () => {
  console.log('[DEBUG] IPC select-archives called')
  const startTime = performance.now()

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Archives',
        extensions: ['zip', 'rar', '7z'],
      },
    ],
  })

  const dialogTime = performance.now() - startTime
  console.log(
    `[DEBUG] Archive dialog completed in ${dialogTime.toFixed(2)}ms, returned ${result.filePaths?.length || 0} files`
  )

  // Add parent directories to allowed list for security
  if (result.filePaths && result.filePaths.length > 0) {
    result.filePaths.forEach((filePath) => {
      const dir = path.dirname(filePath)
      secureFs.addAllowedDirectory(dir)
    })
  }

  return result.filePaths
})

ipcMain.handle('process-archive', async (event, archivePath, forceReprocess = false) => {
  // SECURITY: Validate IPC sender to prevent unauthorized access
  if (!validateSender(event)) {
    throw new Error('Unauthorized IPC sender')
  }

  try {
    console.log(
      `[DEBUG] IPC process-archive called for: ${archivePath}, forceReprocess: ${forceReprocess}`
    )
    const startTime = performance.now()

    const result = await archiveService.processArchive(
      archivePath,
      (processed, total) => {
        // Send progress updates to renderer
        if (!event.sender.isDestroyed()) {
          event.sender.send('archive-progress', { processed, total })
        }
      },
      forceReprocess
    )

    const processTime = performance.now() - startTime
    console.log(`[DEBUG] Archive processing completed in ${processTime.toFixed(2)}ms`)

    return result
  } catch (error) {
    console.error(`[ERROR] Failed to process archive:`, error.message)
    throw new Error(`Failed to process archive: ${error.message}`)
  }
})

ipcMain.handle('get-processed-archives', async () => {
  try {
    return await archiveService.getProcessedArchives()
  } catch (error) {
    console.error(`[ERROR] Failed to get processed archives:`, error.message)
    return []
  }
})

ipcMain.handle('load-processed-archive', async (event, archiveHash) => {
  // SECURITY: Validate IPC sender to prevent unauthorized access
  if (!validateSender(event)) {
    throw new Error('Unauthorized IPC sender')
  }

  try {
    // SECURITY: Validate archive hash format to prevent path traversal
    if (!archiveHash || typeof archiveHash !== 'string' || !/^[a-f0-9]{64}$/.test(archiveHash)) {
      throw new Error('Invalid archive hash format')
    }

    console.log(`[DEBUG] IPC load-processed-archive called for hash: ${archiveHash}`)

    const db = await archiveService.loadArchivesDb()
    const archive = db.archives[archiveHash]

    if (!archive) {
      throw new Error('Archive not found')
    }

    // Check if extraction directory still exists
    try {
      await fs.access(archive.extractDir)
    } catch {
      throw new Error('Archive extraction directory no longer exists')
    }

    // Get all image files from the extraction directory
    const imageFiles = await archiveService.scanDirectoryForImages(archive.extractDir)

    return {
      metadata: archive,
      extractedFiles: imageFiles,
    }
  } catch (error) {
    console.error(`[ERROR] Failed to load processed archive:`, error.message)
    throw new Error(`Failed to load processed archive: ${error.message}`)
  }
})

// Window control handlers
ipcMain.handle('minimize-window', (event) => {
  if (!validateSender(event)) {
    throw new Error('Unauthorized IPC sender')
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize()
  }
})

ipcMain.handle('maximize-window', (event) => {
  if (!validateSender(event)) {
    throw new Error('Unauthorized IPC sender')
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  }
})

ipcMain.handle('close-window', (event) => {
  if (!validateSender(event)) {
    throw new Error('Unauthorized IPC sender')
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close()
  }
})
