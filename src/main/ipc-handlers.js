/**
 * IPC Handlers - Handles all IPC communication between main and renderer processes
 */
class IPCHandlers {
  constructor(appConfig, secureFs, archiveService, debugLogPath) {
    this.appConfig = appConfig
    this.secureFs = secureFs
    this.archiveService = archiveService
    this.debugLogPath = debugLogPath
  }

  setupHandlers(ipcMain, mainWindow) {
    // File selection handlers
    ipcMain.handle('select-files', async () => {
      console.log('[DEBUG] IPC select-files called')
      const { performance } = require('node:perf_hooks')
      const startTime = performance.now()

      const { dialog } = require('electron')
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'All Supported Files',
            extensions: [
              'jpg',
              'jpeg',
              'png',
              'gif',
              'webp',
              'bmp',
              'tiff',
              'svg',
              'zip',
              'rar',
              '7z',
            ],
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
        const path = require('node:path')
        result.filePaths.forEach((filePath) => {
          const dir = path.dirname(filePath)
          this.secureFs.addAllowedDirectory(dir)
        })
      }

      return result.filePaths
    })

    ipcMain.handle('select-directory', async () => {
      const { dialog } = require('electron')
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
      })

      // Add selected directory to allowed list for security
      if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        this.secureFs.addAllowedDirectory(result.filePaths[0])
      }

      return result.canceled ? null : result.filePaths[0] || null
    })

    // File reading handlers
    ipcMain.handle('read-file', async (event, filePath) => {
      // SECURITY: Validate IPC sender to prevent unauthorized access
      if (!this.validateSender(event, mainWindow)) {
        throw new Error('Unauthorized IPC sender')
      }

      const path = require('node:path')
      const { performance } = require('node:perf_hooks')

      try {
        const displayName = typeof filePath === 'string' ? path.basename(filePath) : '<invalid>'
        console.log(`[DEBUG] IPC read-file called for: ${displayName}`)
        const startTime = performance.now()

        // SECURITY: Basic path sanitization for reading (permissive)
        // Users can read files from ANYWHERE on their system
        const sanitizedPath = this.secureFs.sanitizeFilePath(filePath)
        // Get file stats first for size check
        const stats = await this.secureFs.stat(sanitizedPath)
        const maxFileSizeBytes = this.appConfig.maxFileSizeMB * 1024 * 1024
        if (stats.size > maxFileSizeBytes) {
          throw new Error(
            `File too large: ${(stats.size / (1024 * 1024)).toFixed(2)} MB (limit: ${this.appConfig.maxFileSizeMB} MB)`
          )
        }

        // Read file (after validation)
        const buffer = await this.secureFs.readFile(sanitizedPath)
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
      if (!this.validateSender(event, mainWindow)) {
        throw new Error('Unauthorized IPC sender')
      }

      const path = require('node:path')
      const { performance } = require('node:perf_hooks')

      try {
        const displayName = typeof filePath === 'string' ? path.basename(filePath) : '<invalid>'
        console.log(`[DEBUG] IPC get-file-stats called for: ${displayName}`)
        const startTime = performance.now()

        // SECURITY: Basic path sanitization for reading operations
        // Users can get stats for files from anywhere on their system
        const sanitizedPath = this.secureFs.sanitizeFilePath(filePath)
        const stats = await this.secureFs.stat(sanitizedPath)
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

    // Debug and config handlers
    ipcMain.handle('get-debug-log-path', async () => {
      console.log(`[DEBUG] Returning debug log path: ${this.debugLogPath}`)
      return this.debugLogPath
    })

    ipcMain.handle('get-app-config', async () => {
      console.log('[CONFIG] Returning app config')
      return { ...this.appConfig }
    })

    ipcMain.handle('set-image-repository-path', async (event) => {
      // SECURITY: Validate IPC sender
      if (!this.validateSender(event, mainWindow)) {
        throw new Error('Unauthorized IPC sender')
      }

      const { dialog, app } = require('electron')
      const path = require('node:path')
      const fs = require('node:fs').promises

      console.log('[CONFIG] Opening directory selection for image repository')

      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Image Repository Directory',
        properties: ['openDirectory', 'createDirectory'],
        message: 'Choose where to store your extracted images and archives',
      })

      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0]

        // Update config (normalized to absolute)
        this.appConfig.imageRepositoryPath = path.resolve(selectedPath)

        // Save to config file
        try {
          const userDataDir = app.getPath('userData')
          const configPath = path.join(userDataDir, 'config.json')
          await fs.writeFile(configPath, JSON.stringify(this.appConfig, null, 2))
          console.log('[CONFIG] Saved image repository path:', selectedPath)

          // Update secure-fs with the new allowed directory
          this.secureFs.addAllowedDirectory(selectedPath)

          return { success: true, path: selectedPath }
        } catch (error) {
          console.error('[CONFIG] Failed to save config:', error)
          return { success: false, error: error.message }
        }
      }

      return { success: false, canceled: true }
    })

    // Debug log syncing handler
    ipcMain.handle('append-renderer-logs', async (event, rendererLogs) => {
      // SECURITY: Validate IPC sender to prevent unauthorized access
      if (!this.validateSender(event, mainWindow)) {
        throw new Error('Unauthorized IPC sender')
      }

      const fsNative = require('node:fs')

      try {
        console.log(`[DEBUG] appendRendererLogs called with ${rendererLogs?.length || 0} logs`)
        if (Array.isArray(rendererLogs) && rendererLogs.length > 0) {
          // Check file size and rotate if too large (10MB limit)
          const MAX_LOG_SIZE = 10 * 1024 * 1024 // 10MB
          try {
            if (fsNative.existsSync(this.debugLogPath)) {
              const stats = await fsNative.promises.stat(this.debugLogPath)
              if (stats.size > MAX_LOG_SIZE) {
                // Rotate log file by renaming and starting fresh
                const rotatedPath = `${this.debugLogPath}.${Date.now()}.old`
                await fsNative.promises.rename(this.debugLogPath, rotatedPath)
                console.log(`[DEBUG] Rotated debug log to ${rotatedPath} (was ${stats.size} bytes)`)
              }
            }
          } catch (error) {
            console.warn('[WARN] Failed to check/rotate debug log file:', error.message)
          }

          const logContent = `\n=== RENDERER PROCESS LOGS ===\n${rendererLogs.join('\n')}\n`
          console.log(`[DEBUG] Writing ${logContent.length} characters to ${this.debugLogPath}`)
          await fsNative.promises.appendFile(this.debugLogPath, logContent)
          console.log(
            `[DEBUG] Successfully appended ${rendererLogs.length} renderer logs to main debug file`
          )

          // Verify the file was written
          if (fsNative.existsSync(this.debugLogPath)) {
            const stats = await fsNative.promises.stat(this.debugLogPath)
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

    // Archive processing handlers
    ipcMain.handle('select-archives', async () => {
      console.log('[DEBUG] IPC select-archives called')
      const { performance } = require('node:perf_hooks')
      const startTime = performance.now()

      const { dialog } = require('electron')
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
        const path = require('node:path')
        result.filePaths.forEach((filePath) => {
          const dir = path.dirname(filePath)
          this.secureFs.addAllowedDirectory(dir)
        })
      }

      return result.filePaths
    })

    ipcMain.handle('process-archive', async (event, archivePath, forceReprocess = false) => {
      // SECURITY: Validate IPC sender to prevent unauthorized access
      if (!this.validateSender(event, mainWindow)) {
        throw new Error('Unauthorized IPC sender')
      }

      const { app } = require('electron')
      const path = require('node:path')
      const { performance } = require('node:perf_hooks')

      try {
        console.log(
          `[DEBUG] IPC process-archive called for: ${archivePath}, forceReprocess: ${forceReprocess}`
        )
        const startTime = performance.now()

        // SECURITY: Basic path sanitization for reading
        // Users can process archives from ANYWHERE on their system
        const sanitizedArchivePath = this.secureFs.sanitizeFilePath(archivePath)
        // Get current repository path for extraction
        const repositoryPath =
          this.appConfig.imageRepositoryPath || path.join(app.getPath('userData'), 'images')

        const result = await this.archiveService.processArchive(
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
        return await this.archiveService.getProcessedArchives()
      } catch (error) {
        console.error(`[ERROR] Failed to get processed archives:`, error.message)
        return []
      }
    })

    ipcMain.handle('load-processed-archive', async (event, archiveHash) => {
      // SECURITY: Validate IPC sender to prevent unauthorized access
      if (!this.validateSender(event, mainWindow)) {
        throw new Error('Unauthorized IPC sender')
      }

      try {
        // SECURITY: Validate archive hash format to prevent path traversal
        if (
          !archiveHash ||
          typeof archiveHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(archiveHash)
        ) {
          throw new Error('Invalid archive hash format')
        }

        console.log(`[DEBUG] IPC load-processed-archive called for hash: ${archiveHash}`)

        const db = await this.archiveService.loadArchivesDb()
        const archive = db.archives[archiveHash]

        if (!archive) {
          throw new Error('Archive not found')
        }

        // Check if extraction directory still exists
        try {
          await this.secureFs.access(archive.extractDir, require('node:fs').constants.R_OK)
        } catch {
          throw new Error('Archive extraction directory no longer exists')
        }

        // Get all image files from the extraction directory
        const imageFiles = await this.archiveService.scanDirectoryForImages(archive.extractDir)

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
      if (!this.validateSender(event, mainWindow)) {
        throw new Error('Unauthorized IPC sender')
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.minimize()
      }
    })

    ipcMain.handle('maximize-window', (event) => {
      if (!this.validateSender(event, mainWindow)) {
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
      if (!this.validateSender(event, mainWindow)) {
        throw new Error('Unauthorized IPC sender')
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close()
      }
    })
  }

  validateSender(event, mainWindow) {
    // Validate that the sender is the main window's webContents
    // This prevents unauthorized access from untrusted iframes or other web frames
    return event.sender === mainWindow?.webContents
  }
}

module.exports = IPCHandlers
