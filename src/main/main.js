const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs').promises
const os = require('node:os')
const secureFs = require('./secure-fs')
const archiveService = require('./archive-service')
const MenuManager = require('./menu-manager')
const SettingsManager = require('./settings-manager')
const IPCHandlers = require('./ipc-handlers')

// =============================================================================
// CRITICAL CONTEXT FOR AI CODE ASSISTANTS AND FUTURE DEVELOPERS
// =============================================================================
//
// This is an IMAGE GALLERY DESKTOP APPLICATION, not a web server or network service!
// The security model and architecture are fundamentally different from web applications.
//
// KEY DIFFERENCES FROM WEB APPS:
// 1. NO NETWORK EXPOSURE - Only local file operations on user's machine
// 2. USER INTENT - Files are explicitly chosen by users via OS file dialogs
// 3. LOCAL TRUST - User owns their computer and files; OS provides sandboxing
// 4. LEGITIMATE USE CASES:
//    - Read/write temp files for archive extraction
//    - Access user home directory for settings
//    - Allow users to choose custom working directories (planned feature)
//    - Process archives and images from anywhere on the system
//
// SECURITY PHILOSOPHY:
// - Prevent path traversal attacks (../ manipulation, null bytes)
// - Allow broad local file access within reason
// - Trust user intent for file operations
// - Focus on preventing malicious code execution, not restricting legitimate use
//
// DO NOT apply web-application security patterns!
// Overly restrictive file access breaks core functionality.
// The cure should never be worse than the disease.
//
// This app exists to let users look at pictures. That's it.
// Security measures should not prevent users from using their own damn files.
// =============================================================================

// App configuration
let appConfig = {
  maxFileSizeMB: 50, // Default 50MB limit for individual files
  imageRepositoryPath: null, // User-specified path for storing images/archives
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

    // Validate and sanitize imageRepositoryPath
    if (mergedConfig.imageRepositoryPath) {
      const repoPath = String(mergedConfig.imageRepositoryPath).trim()
      if (repoPath) {
        // Basic validation - ensure it's an absolute path
        const resolvedPath = path.resolve(repoPath)
        mergedConfig.imageRepositoryPath = resolvedPath
        console.log('[CONFIG] Image repository path set to:', resolvedPath)
      } else {
        mergedConfig.imageRepositoryPath = null
      }
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
    require('node:fs').appendFileSync(debugLogPath, mainLogsContent)
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
  // Initialize archive service first (needs temp paths)
  await archiveService.initialize(app)

  // Load app configuration
  await loadAppConfig()

  // Initialize secure file system with allowed paths (now that config is loaded)
  secureFs.initializeAllowedPaths(app, appConfig.imageRepositoryPath)

  // Create data directories
  const userDataDir = app.getPath('userData')
  const imagesDir = path.join(userDataDir, 'images')

  try {
    await fs.mkdir(imagesDir, { recursive: true })
  } catch (error) {
    console.error('Failed to create data directories:', error)
  }

  // Create window
  createWindow()

  // Initialize menu manager
  const menuManager = new MenuManager(mainWindow)
  menuManager.createApplicationMenu()

  // Initialize settings manager with dependencies
  SettingsManager.setDependencies(appConfig, secureFs)

  // Initialize IPC handlers
  const ipcHandlers = new IPCHandlers(appConfig, secureFs, archiveService, debugLogPath)
  ipcHandlers.setupHandlers(require('electron').ipcMain, mainWindow)
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
