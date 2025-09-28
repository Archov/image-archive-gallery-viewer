const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs').promises
const fsNative = require('node:fs')
const os = require('node:os')
const { performance } = require('node:perf_hooks')
const secureFs = require('./secure-fs')
const archiveService = require('./archive-service')

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

// Application Menu
function createApplicationMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Images...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-open-images')
            }
          },
        },
        {
          label: 'Open Archives...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-open-archives')
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: async () => {
            await openSettingsDialog()
          },
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit()
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectall' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forcereload' },
        { role: 'toggledevtools' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Image Gallery',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Image Gallery',
              message: 'Image Gallery Manager',
              detail: `Version ${app.getVersion()}\n\nA comprehensive desktop image gallery management system with rich metadata, tagging, and browser integration.`,
            })
          },
        },
      ],
    },
  ]

  // macOS specific adjustments
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services', submenu: [] },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideothers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })

    // Window menu adjustments for macOS
    const windowMenu = template.find((m) => m.label === 'Window')
    if (windowMenu)
      windowMenu.submenu = [
        { role: 'close' },
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ]
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// Settings dialog handler
async function openSettingsDialog() {
  if (!mainWindow) return

  const config = { ...appConfig }

  // Show current configuration
  const infoResult = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Image Gallery Settings',
    message: 'Current Configuration',
    detail: `Image Repository: ${config.imageRepositoryPath || 'Not set'}\n\nMax File Size: ${config.maxFileSizeMB}MB`,
    buttons: ['Change Repository', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  })

  if (infoResult.response === 0) {
    // User wants to change repository - open directory picker
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Image Repository Directory',
      properties: ['openDirectory', 'createDirectory'],
      message: 'Choose where to store your extracted images and archives',
    })

    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0]

      // Check if we have existing processed archives that need migration
      const existingArchives = await checkForExistingArchives()

      // Check if we need to migrate from an existing repository or from temp
      const oldRepositoryPath = config.imageRepositoryPath

      // Check if any archives are still in temp directories (need migration)
      const tempDir = path.join(app.getPath('temp'), 'gallery-extraction')
      const hasTempArchives = existingArchives.some((archive) => {
        if (!archive.extractDir) return false
        try {
          const rel = path.relative(tempDir, archive.extractDir)
          return !rel.startsWith('..') && rel !== ''
        } catch {
          return false
        }
      })

      const needsMigration =
        (oldRepositoryPath &&
          oldRepositoryPath !== selectedPath &&
          !selectedPath.startsWith(oldRepositoryPath + path.sep)) ||
        hasTempArchives

      let shouldMigrate = false

      if (needsMigration) {
        // Confirm migration with user
        const migrationResult = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          title: 'Migrate Existing Content?',
          message: 'Repository Location Changed',
          detail: hasTempArchives
            ? `You have ${existingArchives.length} processed archive(s) stored in temporary directories.\n\nWould you like to copy all existing images and archives to the new repository location?`
            : `You have an existing repository at:\n${oldRepositoryPath}\n\nWould you like to copy all existing images and archives to the new location?`,
          buttons: ['Migrate Content', 'Start Fresh', 'Cancel'],
          defaultId: 0,
          cancelId: 2,
        })

        if (migrationResult.response === 2) {
          // User canceled
          return
        }

        shouldMigrate = migrationResult.response === 0

        if (shouldMigrate) {
          // Show migration progress
          await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Migration Starting',
            message: 'Content Migration',
            detail:
              'Please wait while your existing content is migrated to the new repository location...',
          })

          // Perform migration
          const migrationSource = hasTempArchives ? null : oldRepositoryPath
          const migrationSuccess = await migrateRepositoryContent(
            migrationSource,
            selectedPath,
            existingArchives
          )
          if (!migrationSuccess) {
            // Migration failed, ask user what to do
            const failureResult = await dialog.showMessageBox(mainWindow, {
              type: 'error',
              title: 'Migration Failed',
              message: 'Content Migration Error',
              detail:
                'Failed to migrate existing content to the new repository location. You can try again later or continue with the empty repository.',
              buttons: ['Continue Anyway', 'Cancel'],
              defaultId: 0,
              cancelId: 1,
            })

            if (failureResult.response === 1) {
              // User canceled due to migration failure
              return
            }
          }
        }
      }

      // Update config with new path (normalized to absolute)
      appConfig.imageRepositoryPath = path.resolve(selectedPath)

      // Save to config file
      try {
        const userDataDir = app.getPath('userData')
        const configPath = path.join(userDataDir, 'config.json')
        await fs.writeFile(configPath, JSON.stringify(appConfig, null, 2))
        console.log('[CONFIG] Saved image repository path:', selectedPath)

        // Update secure-fs with the new allowed directory
        secureFs.addAllowedDirectory(selectedPath)

        // Show success message
        const successMessage = needsMigration
          ? `Repository location updated successfully.\n\n${shouldMigrate ? 'Existing content has been migrated.' : 'Starting with empty repository.'}`
          : 'Repository location updated successfully.'

        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Settings Updated',
          message: 'Repository Location Changed',
          detail: `New location: ${selectedPath}\n\n${successMessage}\n\nThe app will use this location for storing downloaded and extracted images.`,
        })
      } catch (error) {
        console.error('[CONFIG] Failed to save config:', error)
        dialog.showErrorBox('Settings Error', `Failed to save configuration: ${error.message}`)
      }
    }
  }
}

// Repository content migration
async function migrateRepositoryContent(oldPath, newPath, existingArchives = null) {
  try {
    console.log('[MIGRATION] Starting repository migration')
    console.log(`[MIGRATION] From: ${oldPath}`)
    console.log(`[MIGRATION] To: ${newPath}`)

    // Create new directory if it doesn't exist
    await fs.mkdir(newPath, { recursive: true })

    if (oldPath) {
      // Traditional migration from old repository path
      let oldStats
      try {
        oldStats = await fs.stat(oldPath)
      } catch (_error) {
        console.log('[MIGRATION] Old repository path does not exist or is not accessible')
        return true // Not an error, just nothing to migrate
      }

      if (!oldStats.isDirectory()) {
        console.log('[MIGRATION] Old repository path is not a directory')
        return true
      }

      // Get list of items to migrate
      const items = await fs.readdir(oldPath)
      if (items.length === 0) {
        console.log('[MIGRATION] Old repository is empty, nothing to migrate')
        return true
      }

      console.log(`[MIGRATION] Found ${items.length} items to migrate from ${oldPath}`)

      // Copy each item recursively
      for (const item of items) {
        const oldItemPath = path.join(oldPath, item)
        const newItemPath = path.join(newPath, item)

        try {
          await copyDirectoryRecursive(oldItemPath, newItemPath)
          console.log(`[MIGRATION] Migrated: ${item}`)
        } catch (error) {
          console.error('[MIGRATION] Failed to migrate:', item, error.message)
          // Continue with other items rather than failing completely
        }
      }
    } else {
      // Migration from temp directories based on processed archives
      if (!existingArchives || existingArchives.length === 0) {
        console.log('[MIGRATION] No archives to migrate from temp directories')
        return true
      }

      console.log(`[MIGRATION] Migrating ${existingArchives.length} archives from temp directories`)

      // Migrate each archive's extract directory
      for (const archive of existingArchives) {
        if (archive.extractDir) {
          try {
            // Create archive-specific subdirectory in new repository
            const archiveName = archive.name.replace(/[^a-zA-Z0-9\-_]/g, '_')
            const newArchiveDir = path.join(newPath, archiveName)

            // Copy the entire extract directory
            await copyDirectoryRecursive(archive.extractDir, newArchiveDir)
            console.log(`[MIGRATION] Migrated archive: ${archive.name}`)

            // Update the archive's extractDir path for database
            archive.extractDir = newArchiveDir
          } catch (error) {
            console.error('[MIGRATION] Failed to migrate archive:', archive.name, error.message)
            // Continue with other archives
          }
        }
      }
    }

    // Update processed archives database with new paths
    await updateProcessedArchivesPaths(oldPath, newPath, existingArchives)

    console.log('[MIGRATION] Repository migration completed successfully')
    return true
  } catch (error) {
    console.error('[MIGRATION] Repository migration failed:', error)
    return false
  }
}

// Recursively copy directory contents
async function copyDirectoryRecursive(src, dest) {
  const stats = await fsNative.lstat(src)

  if (stats.isSymbolicLink()) {
    // Skip symlinks for security
    console.warn(`[MIGRATION] Skipping symlink: ${src}`)
    return
  }

  if (stats.isDirectory()) {
    await fs.mkdir(dest, { recursive: true })
    const items = await fs.readdir(src)

    for (const item of items) {
      const srcPath = path.join(src, item)
      const destPath = path.join(dest, item)
      await copyDirectoryRecursive(srcPath, destPath)
    }
  } else {
    // Copy file
    await fs.copyFile(src, dest)
  }
}

// Update processed archives database with new paths
async function updateProcessedArchivesPaths(oldPath, newPath, existingArchives = null) {
  try {
    // Load the database directly
    const db = await archiveService.loadArchivesDb()

    if (oldPath) {
      // Traditional migration - update paths in database
      for (const [hash, archive] of Object.entries(db.archives)) {
        let needsUpdate = false
        const updatedArchive = { ...archive }

        // Update extractDir if it was in the old repository
        if (archive.extractDir) {
          try {
            const rel = path.relative(oldPath, archive.extractDir)
            if (!rel.startsWith('..') && rel !== '') {
              const newExtractDir = archive.extractDir.replace(oldPath, newPath)
              if (newExtractDir !== archive.extractDir) {
                updatedArchive.extractDir = newExtractDir
                needsUpdate = true
              }
            }
          } catch (_error) {
            // Path comparison failed, skip
          }
        }

        // Update extractedFiles paths
        if (archive.extractedFiles && Array.isArray(archive.extractedFiles)) {
          const updatedFiles = archive.extractedFiles.map((file) => {
            if (file.extractedPath) {
              try {
                const rel = path.relative(oldPath, file.extractedPath)
                if (!rel.startsWith('..') && rel !== '') {
                  const newPathExtracted = file.extractedPath.replace(oldPath, newPath)
                  if (newPathExtracted !== file.extractedPath) {
                    return {
                      ...file,
                      extractedPath: newPathExtracted,
                    }
                  }
                }
              } catch (_error) {
                // Path comparison failed, keep original
              }
            }
            return file
          })

          // Only update if files actually changed
          if (JSON.stringify(updatedFiles) !== JSON.stringify(archive.extractedFiles)) {
            updatedArchive.extractedFiles = updatedFiles
            needsUpdate = true
          }
        }

        // Update the database if needed
        if (needsUpdate) {
          db.archives[hash] = updatedArchive
          console.log(`[MIGRATION] Updated paths for archive: ${archive.name}`)
        }
      }
    } else if (existingArchives) {
      // Temp directory migration - update with new paths from migration
      for (const migratedArchive of existingArchives) {
        const hash = migratedArchive.hash
        if (db.archives[hash] && migratedArchive.extractDir) {
          // Update the extractDir in the database
          db.archives[hash] = {
            ...db.archives[hash],
            extractDir: migratedArchive.extractDir,
          }

          // Update extractedFiles paths if they exist
          if (db.archives[hash].extractedFiles && Array.isArray(db.archives[hash].extractedFiles)) {
            const oldExtractDir = db.archives[hash].extractedFiles[0]?.extractedPath
              ? path.dirname(db.archives[hash].extractedFiles[0].extractedPath)
              : null
            if (oldExtractDir) {
              db.archives[hash].extractedFiles = db.archives[hash].extractedFiles.map((file) => ({
                ...file,
                extractedPath: file.extractedPath.replace(
                  oldExtractDir,
                  migratedArchive.extractDir
                ),
              }))
            }
          }

          console.log(`[MIGRATION] Updated database for archive: ${db.archives[hash].name}`)
        }
      }
    }

    // Save the updated database
    await archiveService.saveArchivesDb(db)
    console.log('[MIGRATION] Processed archives database updated')
  } catch (error) {
    console.error('[MIGRATION] Failed to update processed archives database:', error)
    // Don't fail the migration for this - the files are copied, just the DB refs are wrong
  }
}

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

// Check for existing processed archives
async function checkForExistingArchives() {
  try {
    const archives = await archiveService.getProcessedArchives()
    return archives || []
  } catch (error) {
    console.error('[SETTINGS] Failed to check for existing archives:', error)
    return []
  }
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

  // Then create the window
  createWindow()

  // Create application menu
  createApplicationMenu()
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

    // SECURITY: Basic path sanitization for reading (permissive)
    // Users can read files from ANYWHERE on their system
    const sanitizedPath = secureFs.sanitizeFilePath(filePath)
    // Get file stats first for size check
    const stats = await secureFs.stat(sanitizedPath)
    const maxFileSizeBytes = appConfig.maxFileSizeMB * 1024 * 1024
    if (stats.size > maxFileSizeBytes) {
      throw new Error(
        `File too large: ${(stats.size / (1024 * 1024)).toFixed(2)} MB (limit: ${appConfig.maxFileSizeMB} MB)`
      )
    }

    // Read file (after validation)
    const buffer = await secureFs.readFile(sanitizedPath)
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

    // SECURITY: Basic path sanitization for reading operations
    // Users can get stats for files from anywhere on their system
    const sanitizedPath = secureFs.sanitizeFilePath(filePath)
    const stats = await secureFs.stat(sanitizedPath)
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

ipcMain.handle('get-app-config', async () => {
  console.log('[CONFIG] Returning app config')
  return { ...appConfig }
})

ipcMain.handle('set-image-repository-path', async (event) => {
  // SECURITY: Validate IPC sender
  if (!validateSender(event)) {
    throw new Error('Unauthorized IPC sender')
  }

  console.log('[CONFIG] Opening directory selection for image repository')

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Image Repository Directory',
    properties: ['openDirectory', 'createDirectory'],
    message: 'Choose where to store your extracted images and archives',
  })

  if (!result.canceled && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0]

    // Update config (normalized to absolute)
    appConfig.imageRepositoryPath = path.resolve(selectedPath)

    // Save to config file
    try {
      const userDataDir = app.getPath('userData')
      const configPath = path.join(userDataDir, 'config.json')
      await fs.writeFile(configPath, JSON.stringify(appConfig, null, 2))
      console.log('[CONFIG] Saved image repository path:', selectedPath)

      // Update secure-fs with the new allowed directory
      secureFs.addAllowedDirectory(selectedPath)

      return { success: true, path: selectedPath }
    } catch (error) {
      console.error('[CONFIG] Failed to save config:', error)
      return { success: false, error: error.message }
    }
  }

  return { success: false, canceled: true }
})

ipcMain.handle('append-renderer-logs', async (event, rendererLogs) => {
  // SECURITY: Validate IPC sender to prevent unauthorized access
  if (!validateSender(event)) {
    throw new Error('Unauthorized IPC sender')
  }

  try {
    console.log(`[DEBUG] appendRendererLogs called with ${rendererLogs?.length || 0} logs`)
    if (Array.isArray(rendererLogs) && rendererLogs.length > 0) {
      // Check file size and rotate if too large (10MB limit)
      const MAX_LOG_SIZE = 10 * 1024 * 1024 // 10MB
      try {
        if (fsNative.existsSync(debugLogPath)) {
          const stats = await fsNative.promises.stat(debugLogPath)
          if (stats.size > MAX_LOG_SIZE) {
            // Rotate log file by renaming and starting fresh
            const rotatedPath = `${debugLogPath}.${Date.now()}.old`
            await fsNative.promises.rename(debugLogPath, rotatedPath)
            console.log(`[DEBUG] Rotated debug log to ${rotatedPath} (was ${stats.size} bytes)`)
          }
        }
      } catch (error) {
        console.warn('[WARN] Failed to check/rotate debug log file:', error.message)
      }

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

    // SECURITY: Basic path sanitization for reading
    // Users can process archives from ANYWHERE on their system
    const sanitizedArchivePath = secureFs.sanitizeFilePath(archivePath)
    // Get current repository path for extraction
    const repositoryPath =
      appConfig.imageRepositoryPath || path.join(app.getPath('userData'), 'images')

    const result = await archiveService.processArchive(
      sanitizedArchivePath,
      repositoryPath,
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
      await secureFs.access(archive.extractDir, fsNative.constants.R_OK)
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
