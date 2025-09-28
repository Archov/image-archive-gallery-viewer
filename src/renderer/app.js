// Image Gallery Manager - Core Functionality
class ImageGallery {
  constructor() {
    this.images = []
    this.currentIndex = 0
    this.isFullscreen = false
    this.debugLogs = []
    this.blobUrls = []
    this.fullscreenWheelHandler = null
    this.idCounter = Date.now() % 100000 // For collision-resistant ID generation across sessions

    this.initializeElements()
    this.bindEvents()
    this.setupDragAndDrop()

    // Load processed archives on startup
    this.loadProcessedArchivesList()

    // Override console methods to capture logs
    this.setupDebugCapture()

    console.log('🔍 DEBUG: Gallery initialized with debug logging')
    console.log('[DEBUG] Renderer logs will be automatically saved to main process debug file')

    // Set up automatic log syncing
    this.setupAutoLogSync()

    // TODO: Add settings UI for configuring image repository path
    // This will call window.electronAPI.setImageRepositoryPath()
    // and allow users to choose where downloaded/extracted images are stored
  }

  generateUniqueId() {
    return `img_${++this.idCounter}_${Date.now()}`
  }

  setupDebugCapture() {
    const MAX_DEBUG_LOG_LINES = 5000
    const originalLog = console.log
    const originalError = console.error
    const originalWarn = console.warn

    console.log = (...args) => {
      const message = args
        .map((arg) => {
          try {
            return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
          } catch {
            return String(arg)
          }
        })
        .join(' ')
      this.debugLogs.push(`[LOG ${new Date().toISOString()}] ${message}`)
      if (this.debugLogs.length > MAX_DEBUG_LOG_LINES) this.debugLogs.shift()
      originalLog.apply(console, args)
    }

    console.error = (...args) => {
      const message = args
        .map((arg) => {
          try {
            return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
          } catch {
            return String(arg)
          }
        })
        .join(' ')
      this.debugLogs.push(`[ERROR ${new Date().toISOString()}] ${message}`)
      if (this.debugLogs.length > MAX_DEBUG_LOG_LINES) this.debugLogs.shift()
      originalError.apply(console, args)
    }

    console.warn = (...args) => {
      const message = args
        .map((arg) => {
          try {
            return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
          } catch {
            return String(arg)
          }
        })
        .join(' ')
      this.debugLogs.push(`[WARN ${new Date().toISOString()}] ${message}`)
      if (this.debugLogs.length > MAX_DEBUG_LOG_LINES) this.debugLogs.shift()
      originalWarn.apply(console, args)
    }
  }

  setupAutoLogSync() {
    // Sync logs every 30 seconds
    this.logSyncInterval = setInterval(() => {
      this.syncLogsToMain()
    }, 30000)

    // Sync logs before page unload
    window.addEventListener('beforeunload', () => {
      this.syncLogsToMain()
    })

    // Sync logs when app becomes hidden (minimized, etc.)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.syncLogsToMain()
      }
    })
  }

  async syncLogsToMain() {
    if (this.debugLogs.length > 0) {
      // Snapshot logs to prevent loss during async operation
      const logsToSend = this.debugLogs.splice(0, this.debugLogs.length)
      try {
        await window.electronAPI.appendRendererLogs(logsToSend)
        console.log(`[DEBUG] Synced ${logsToSend.length} logs to main process`)
      } catch (error) {
        // Restore logs if sync failed
        this.debugLogs = logsToSend.concat(this.debugLogs)
        console.error('[ERROR] Failed to sync logs to main process:', error)
      }
    }
  }

  async exportDebugLogs() {
    // Legacy method - now just triggers immediate sync
    await this.syncLogsToMain()
    console.log('[DEBUG] Logs synced to main process debug file')
  }

  initializeElements() {
    // Main containers
    this.dropZone = document.getElementById('drop-zone')
    this.galleryGrid = document.getElementById('gallery-grid')
    this.fullscreenOverlay = document.getElementById('fullscreen-overlay')
    this.loadingIndicator = document.getElementById('loading-indicator')

    // Buttons and controls
    this.fileSelectBtn = document.getElementById('file-select-btn')
    this.archiveSelectBtn = document.getElementById('archive-select-btn')
    this.closeFullscreenBtn = document.getElementById('close-fullscreen')
    this.prevBtn = document.getElementById('prev-btn')
    this.nextBtn = document.getElementById('next-btn')

    // Archive management
    this.processedArchivesSection = document.getElementById('processed-archives-section')
    this.processedArchivesList = document.getElementById('processed-archives-list')

    // Image elements
    this.fullscreenImage = document.getElementById('fullscreen-image')

    // Loading elements
    this.loadingText = document.getElementById('loading-text')
    this.loadingProgress = document.getElementById('loading-progress')
    this.progressFill = document.getElementById('progress-fill')
    this.progressText = document.getElementById('progress-text')

    // Verify critical elements exist
    if (
      !this.dropZone ||
      !this.galleryGrid ||
      !this.fileSelectBtn ||
      !this.fullscreenOverlay ||
      !this.fullscreenImage
    ) {
      console.error('Critical UI elements not found!')
    }

    // Ensure fullscreen overlay is hidden by default
    this.fullscreenOverlay.classList.add('hidden')
  }

  bindEvents() {
    if (
      !this.fileSelectBtn ||
      !this.closeFullscreenBtn ||
      !this.prevBtn ||
      !this.nextBtn ||
      !this.fullscreenImage
    ) {
      console.warn('⚠️ Skipping event binding: required elements missing')
      return
    }

    // File selection
    this.fileSelectBtn.addEventListener('click', () => this.selectFiles())
    this.archiveSelectBtn?.addEventListener('click', () => this.selectArchives())

    // Fullscreen controls
    this.closeFullscreenBtn.addEventListener('click', () => this.closeFullscreen())
    this.prevBtn.addEventListener('click', () => this.showPrevious())
    this.nextBtn.addEventListener('click', () => this.showNext())

    // Keyboard navigation
    document.addEventListener('keydown', (e) => this.handleKeydown(e))

    // Fullscreen image click to close
    this.fullscreenImage.addEventListener('click', () => this.closeFullscreen())

    // IPC event listeners for menu actions
    this.setupIpcListeners()
  }

  setupIpcListeners() {
    // Menu-triggered actions
    window.electronAPI?.onMenuOpenImages?.(() => {
      this.selectFiles()
    })

    window.electronAPI?.onMenuOpenArchives?.(() => {
      this.selectArchives()
    })
  }

  setupDragAndDrop() {
    const galleryContainer = document.getElementById('gallery-container')
    if (!galleryContainer) {
      console.warn('⚠️ Skipping drag-and-drop setup: #gallery-container not found')
      return
    }

    ;['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
      galleryContainer.addEventListener(eventName, (e) => {
        e.preventDefault()
        e.stopPropagation()
      })
    })

    galleryContainer.addEventListener('dragenter', (_e) => {
      this.dropZone.classList.add('drag-over')
    })

    galleryContainer.addEventListener('dragleave', (e) => {
      // Only remove class if we're actually leaving the drop zone
      if (!galleryContainer.contains(e.relatedTarget)) {
        this.dropZone.classList.remove('drag-over')
      }
    })

    galleryContainer.addEventListener('drop', (e) => {
      this.dropZone.classList.remove('drag-over')
      const files = Array.from(e.dataTransfer.files)
      this.loadFiles(files)
    })

    // No hover effects to optimize
  }

  async selectFiles() {
    try {
      const filePaths = await window.electronAPI.selectFiles()
      if (filePaths && filePaths.length > 0) {
        const toLower = (p) => p.toLowerCase()
        const isImg = (p) =>
          ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg'].some((ext) =>
            toLower(p).endsWith(ext)
          )
        const isArc = (p) => ['.zip', '.rar', '.7z'].some((ext) => toLower(p).endsWith(ext))
        const imagePaths = filePaths.filter(isImg)
        const archivePaths = filePaths.filter(isArc)

        if (archivePaths.length) {
          const archiveFiles = archivePaths.map((p) => ({ path: p, name: p.split(/[/\\]/).pop() }))
          await this.processArchives(archiveFiles)
        }
        if (imagePaths.length) {
          await this.loadFilesFromPaths(imagePaths)
        }
      }
    } catch (error) {
      console.error('Error selecting files:', error)
      alert(`Error selecting files: ${error.message}`)
    }
  }

  async selectArchives() {
    try {
      const archivePaths = await window.electronAPI.selectArchives()
      if (archivePaths && archivePaths.length > 0) {
        // Create file objects from paths for archive processing
        const archiveFiles = archivePaths.map((path) => ({ path, name: path.split(/[/\\]/).pop() }))
        await this.processArchives(archiveFiles)
      }
    } catch (error) {
      console.error('Error selecting archives:', error)
      alert(`Error selecting archives: ${error.message}`)
    }
  }

  async loadFiles(files) {
    console.log('🔍 DEBUG: loadFiles called with', files.length, 'files')

    // Clean up previous blob URLs to prevent memory leaks
    this.cleanupBlobUrls()

    // Separate image files and archive files
    const imageFiles = files.filter((file) => this.isImageFile(file))
    const archiveFiles = files.filter((file) => this.isArchiveFile(file))

    console.log(
      '🔍 DEBUG: Filtered to',
      imageFiles.length,
      'image files and',
      archiveFiles.length,
      'archive files'
    )

    if (imageFiles.length === 0 && archiveFiles.length === 0) {
      console.log('🔍 DEBUG: No valid files found')
      alert('No valid image files or archives selected.')
      return
    }

    // Process archives first, then images
    if (archiveFiles.length > 0) {
      await this.processArchives(archiveFiles)
    }

    if (imageFiles.length > 0) {
      await this.loadImageFiles(imageFiles)
    }
  }

  async loadFilesFromPaths(filePaths) {
    console.log('🔍 DEBUG: loadFilesFromPaths called with', filePaths.length, 'paths')

    console.log(`🚀 Starting to load ${filePaths.length} files from paths...`)
    console.log(
      '🔍 DEBUG: Memory before loading:',
      performance.memory
        ? `${(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB`
        : 'N/A'
    )
    const startTime = performance.now()

    this.showLoading()
    this.updateProgress(0, filePaths.length)
    // Don't clear images array - append to existing images
    // this.images = [];

    try {
      // Optimized batch sizing for performance - larger batches for fewer DOM updates
      const batchSize =
        filePaths.length < 50
          ? 16
          : filePaths.length < 200
            ? 32
            : filePaths.length < 1000
              ? 64
              : 128
      let processedCount = 0

      console.log(`🔍 DEBUG: Processing file paths in batches of ${batchSize}...`)

      for (let i = 0; i < filePaths.length; i += batchSize) {
        const batch = filePaths.slice(i, i + batchSize)
        console.log(
          `🔍 DEBUG: Processing path batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(filePaths.length / batchSize)} (${batch.length} files)`
        )

        const batchPromises = batch.map((filePath) => this.processImageFileFromPath(filePath))
        const batchResults = await Promise.allSettled(batchPromises)

        // Process settled results: collect all results (including errors for display), log rejections
        const allResults = []
        let batchSuccessfulCount = 0

        batchResults.forEach((settled, idx) => {
          if (settled.status === 'fulfilled') {
            const result = settled.value
            if (result) {
              allResults.push(result)
              if (!result.error) {
                batchSuccessfulCount++
              }
            }
            return
          }

          const source = batch[idx]
          console.error('❌ Promise rejected:', settled.reason)
          allResults.push({
            id: this.generateUniqueId(),
            name: source?.name || source?.path || 'Unknown',
            path: source?.path,
            error: true,
            dataUrl: null,
          })
        })

        this.images.push(...allResults)

        processedCount += batch.length
        this.updateProgress(processedCount, filePaths.length)

        const successSoFar = this.images.filter((img) => !img.error).length
        console.log(
          `🔍 DEBUG: Path batch complete. Total processed: ${processedCount}/${filePaths.length}, successful: ${successSoFar}, batch success: ${batchSuccessfulCount}/${batch.length}`
        )
      }

      const successCount = this.images.filter((img) => !img.error).length
      const failedCount = this.images.length - successCount
      const loadTime = performance.now() - startTime

      console.log(
        `✅ Loaded ${successCount} images from paths successfully (${failedCount} failed) in ${loadTime.toFixed(2)}ms`
      )
      console.log(
        '🔍 DEBUG: Memory after loading:',
        performance.memory
          ? `${(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB`
          : 'N/A'
      )
      console.log(`📊 Average time per image: ${(loadTime / filePaths.length).toFixed(2)}ms`)

      console.log('🔍 DEBUG: Rendering gallery...')
      this.renderGallery()
      console.log('🔍 DEBUG: Hiding drop zone...')
      this.hideDropZone()
      console.log('✅ Gallery load from paths complete!')
    } catch (error) {
      console.error('❌ Error loading files from paths:', error)
      alert(`Error loading images: ${error.message}`)
    } finally {
      this.hideLoading()
    }
  }

  async loadImageFiles(imageFiles) {
    console.log('🔍 DEBUG: loadImageFiles called with', imageFiles.length, 'files')

    console.log(`🚀 Starting to load ${imageFiles.length} image files...`)
    console.log(
      '🔍 DEBUG: Memory before loading:',
      performance.memory
        ? `${(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB`
        : 'N/A'
    )
    const startTime = performance.now()

    this.showLoading()
    this.updateProgress(0, imageFiles.length)
    // Don't clear images here (archives may have just populated this.images)

    try {
      // Aggressive batch size for maximum performance - modern systems can handle this
      const batchSize =
        imageFiles.length < 20
          ? 8
          : imageFiles.length < 100
            ? 16
            : imageFiles.length < 500
              ? 32
              : 64
      let processedCount = 0

      console.log(`🔍 DEBUG: Processing image files in batches of ${batchSize}...`)

      for (let i = 0; i < imageFiles.length; i += batchSize) {
        const batch = imageFiles.slice(i, i + batchSize)
        console.log(
          `🔍 DEBUG: Processing image batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(imageFiles.length / batchSize)} (${batch.length} files)`
        )

        const batchPromises = batch.map((file) => this.processImageFile(file))
        const batchResults = await Promise.allSettled(batchPromises)

        // Process settled results: collect all results (including errors for display), log rejections
        const allResults = []
        let batchSuccessfulCount = 0

        batchResults.forEach((settled, idx) => {
          if (settled.status === 'fulfilled') {
            const result = settled.value
            if (result) {
              allResults.push(result)
              if (!result.error) {
                batchSuccessfulCount++
              }
            }
            return
          }

          const source = batch[idx]
          console.error('❌ Promise rejected:', settled.reason)
          allResults.push({
            id: this.generateUniqueId(),
            name: source?.name || source?.path || 'Unknown',
            path: source?.path,
            error: true,
            dataUrl: null,
          })
        })

        this.images.push(...allResults)

        processedCount += batch.length
        this.updateProgress(processedCount, imageFiles.length)

        const successSoFar = this.images.filter((img) => !img.error).length
        console.log(
          `🔍 DEBUG: Image batch complete. Total processed: ${processedCount}/${imageFiles.length}, successful: ${successSoFar}, batch success: ${batchSuccessfulCount}/${batch.length}`
        )
      }

      const successCount = this.images.filter((img) => !img.error).length
      const failedCount = this.images.length - successCount
      const loadTime = performance.now() - startTime

      console.log(
        `✅ Loaded ${successCount} images successfully (${failedCount} failed) in ${loadTime.toFixed(2)}ms`
      )
      console.log(
        '🔍 DEBUG: Memory after loading:',
        performance.memory
          ? `${(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB`
          : 'N/A'
      )
      console.log(`📊 Average time per image: ${(loadTime / imageFiles.length).toFixed(2)}ms`)

      console.log('🔍 DEBUG: Rendering gallery...')
      this.renderGallery()
      console.log('🔍 DEBUG: Hiding drop zone...')
      this.hideDropZone()
      console.log('✅ Gallery load complete!')
    } catch (error) {
      console.error('❌ Error loading image files:', error)
      alert(`Error loading images: ${error.message}`)
    } finally {
      this.hideLoading()
    }
  }

  async processImageFile(file) {
    const startTime = performance.now()
    console.log(`📁 Processing dragged file ${file.name}...`)

    // For Electron, we can use the file path directly instead of FileReader
    // This avoids the slow base64 encoding of large files
    if (file.path) {
      // Try to get file:// URL from path
      const fileUrl = window.electronAPI.toFileUrl?.(file.path)

      if (fileUrl) {
        // Direct file path available (usually on desktop)
        return new Promise((resolve, reject) => {
          const img = new Image()

          img.onload = () => {
            const processTime = performance.now() - startTime
            console.log(`✅ Processed ${file.name} in ${processTime.toFixed(2)}ms`)
            resolve({
              id: this.generateUniqueId(),
              name: file.name,
              path: file.path,
              dataUrl: fileUrl,
              width: img.naturalWidth,
              height: img.naturalHeight,
              aspectRatio: img.naturalWidth / img.naturalHeight,
              file: file,
            })
          }
          img.onerror = () => {
            console.log(`❌ Failed to load dragged image ${file.name}, falling back to FileReader`)
            // Fallback to FileReader if file:// URL fails
            this.fallbackProcessImageFile(file, startTime).then(resolve).catch(reject)
          }
          // Don't set crossOrigin for file:// URLs
          img.src = fileUrl
        })
      } else {
        // File path exists but URL generation failed, use FileReader directly
        return this.fallbackProcessImageFile(file, startTime)
      }
    } else {
      // Fallback for cases where file.path is not available
      return this.fallbackProcessImageFile(file, startTime)
    }
  }

  async fallbackProcessImageFile(file, startTime) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()

      reader.onload = (e) => {
        const img = new Image()
        img.onload = () => {
          const processTime = performance.now() - startTime
          console.log(`✅ Fallback processed ${file.name} in ${processTime.toFixed(2)}ms`)
          resolve({
            id: this.generateUniqueId(),
            name: file.name,
            path: file.path || file.name,
            dataUrl: e.target.result,
            width: img.naturalWidth,
            height: img.naturalHeight,
            aspectRatio: img.naturalWidth / img.naturalHeight,
            file: file,
          })
        }
        img.onerror = () => {
          console.log(`❌ Failed to load dragged image ${file.name}`)
          resolve({
            id: this.generateUniqueId(),
            name: file.name,
            path: file.path || file.name,
            error: true,
            dataUrl: null,
          })
        }
        img.src = e.target.result
      }

      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
      reader.readAsDataURL(file)
    })
  }

  async processImageFileFromPath(filePath) {
    const startTime = performance.now()
    try {
      if (!window.electronAPI.getFileStats || !window.electronAPI.readFile) {
        throw new Error('Required Electron APIs not available')
      }

      const stats = await window.electronAPI.getFileStats(filePath)

      console.log(`Processing ${filePath.split(/[/\\]/).pop()}...`)

      // Use blob reading directly for archive-extracted files (more reliable than file:// URLs)
      const buffer = await window.electronAPI.readFile(filePath)
      const uint8Array = new Uint8Array(buffer)
      const extension = filePath.split('.').pop().toLowerCase()
      const mimeTypes = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp',
        tiff: 'image/tiff',
        svg: 'image/svg+xml',
        avif: 'image/avif',
      }
      const mimeType = mimeTypes[extension] || 'application/octet-stream'
      const blob = new Blob([uint8Array], { type: mimeType })
      const blobUrl = URL.createObjectURL(blob)

      // Track blob URLs for cleanup
      this.blobUrls.push(blobUrl)

      return new Promise((resolve, _reject) => {
        const img = new Image()

        img.onload = () => {
          const processTime = performance.now() - startTime
          console.log(`✅ Loaded ${filePath.split(/[/\\]/).pop()} in ${processTime.toFixed(2)}ms`)
          resolve({
            id: this.generateUniqueId(),
            name: filePath.split(/[/\\]/).pop(),
            path: filePath,
            dataUrl: blobUrl,
            width: img.naturalWidth,
            height: img.naturalHeight,
            aspectRatio: img.naturalWidth / img.naturalHeight,
            size: stats.size,
            mtimeMs: stats.mtimeMs,
            mtimeISO: stats.mtimeISO,
          })
        }

        img.onerror = () => {
          console.error(`❌ Failed to load image: ${filePath.split(/[/\\]/).pop()}`)
          resolve({
            id: this.generateUniqueId(),
            name: filePath.split(/[/\\]/).pop(),
            path: filePath,
            error: true,
            dataUrl: null,
          })
        }

        // Set the image source to the blob URL
        img.src = blobUrl
      })
    } catch (error) {
      console.error('Error processing file:', filePath, error)
      return {
        id: this.generateUniqueId(),
        name: filePath.split(/[/\\]/).pop(),
        path: filePath,
        error: true,
        dataUrl: null,
      }
    }
  }

  cleanupBlobUrls() {
    if (this.blobUrls) {
      this.blobUrls.forEach((url) => {
        URL.revokeObjectURL(url)
      })
      this.blobUrls = []
    }
  }

  isImageFile(file) {
    const imageExtensions = [
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.webp',
      '.bmp',
      '.tiff',
      '.svg',
      '.avif',
    ]
    const fileName = (file?.name || file?.path || '').toLowerCase()
    return imageExtensions.some((ext) => fileName.endsWith(ext))
  }

  isArchiveFile(file) {
    const archiveExtensions = ['.zip', '.rar', '.7z']
    const fileName = (file?.name || file?.path || '').toLowerCase()
    return archiveExtensions.some((ext) => fileName.endsWith(ext))
  }

  async processArchives(archiveFiles) {
    console.log(`📦 Processing ${archiveFiles.length} archives...`)

    // Clear existing gallery when processing new archives
    this.images = []
    this.cleanupBlobUrls()

    for (const archiveFile of archiveFiles) {
      try {
        console.log(`📦 Processing archive: ${archiveFile.name || archiveFile.path}`)

        // Show loading for archive processing
        this.showLoading()
        this.updateProgress(0, 1)
        this.loadingText.textContent = `Processing ${archiveFile.name || 'archive'}...`

        // Set up progress listener
        const progressHandler = (progress) => {
          this.updateProgress(progress.processed, progress.total)
        }
        let unsubscribeProgress = () => {}
        try {
          unsubscribeProgress = window.electronAPI.onArchiveProgress(progressHandler)
          const result = await window.electronAPI.processArchive(archiveFile.path)

          if (result.alreadyProcessed) {
            // Archive was already processed - ask user what to do
            const choice = confirm(
              `Archive "${result.metadata.name}" has already been processed and contains ${Array.isArray(result.extractedFiles) ? result.extractedFiles.length : Number(result.extractedFiles) || 0} images.\n\n` +
                `Choose "OK" to reprocess the archive anyway, or "Cancel" to skip.`
            )

            if (choice) {
              // User wants to reprocess
              this.loadingText.textContent = `Reprocessing ${archiveFile.name || 'archive'}...`
              let unsubscribeProgressReprocess = () => {}
              try {
                unsubscribeProgressReprocess = window.electronAPI.onArchiveProgress(progressHandler)
                const reprocessResult = await window.electronAPI.processArchive(
                  archiveFile.path,
                  true
                )

                console.log(
                  `✅ Archive reprocessed: ${reprocessResult.metadata.name} (${reprocessResult.extractedFiles.length} images extracted)`
                )

                // Load the newly extracted images
                if (reprocessResult.extractedFiles.length > 0) {
                  const extractedImagePaths = reprocessResult.extractedFiles.map(
                    (f) => f.extractedPath
                  )
                  await this.loadFilesFromPaths(extractedImagePaths)
                }
              } finally {
                unsubscribeProgressReprocess()
              }
            } else {
              // User chose to skip - show message about previously processed archive
              const prevCount = Array.isArray(result.extractedFiles)
                ? result.extractedFiles.length
                : Number(result.extractedFiles) || 0
              alert(
                `Archive "${result.metadata.name}" was previously processed (${prevCount} images). Skipping.`
              )
            }
          } else {
            // Archive was processed successfully
            console.log(
              `✅ Archive processed: ${result.metadata.name} (${result.extractedFiles.length} images extracted)`
            )

            // Load the extracted images
            if (result.extractedFiles.length > 0) {
              const extractedImagePaths = result.extractedFiles.map((f) => f.extractedPath)
              await this.loadFilesFromPaths(extractedImagePaths)
            }
          }
        } finally {
          unsubscribeProgress()
        }
      } catch (error) {
        console.error(`❌ Failed to process archive:`, error)
        alert(`Failed to process archive ${archiveFile.name}: ${error.message}`)
      } finally {
        this.hideLoading()
      }
    }
  }

  async loadProcessedArchive(archiveHash) {
    try {
      console.log(`📦 Loading previously processed archive: ${archiveHash}`)

      // Clear existing gallery when loading a processed archive
      this.images = []
      this.cleanupBlobUrls()

      // Show loading
      this.showLoading()
      this.updateProgress(0, 1)
      this.loadingText.textContent = 'Loading processed archive...'

      const result = await window.electronAPI.loadProcessedArchive(archiveHash)

      console.log(
        `✅ Loaded processed archive: ${result.metadata.name} (${result.extractedFiles.length} images)`
      )

      // Load the extracted images into the gallery
      if (result.extractedFiles.length > 0) {
        const extractedImagePaths = result.extractedFiles.map((f) => f.extractedPath)
        await this.loadFilesFromPaths(extractedImagePaths)
      }
    } catch (error) {
      console.error(`❌ Failed to load processed archive:`, error)
      alert(`Failed to load processed archive: ${error.message}`)
    } finally {
      this.hideLoading()
    }
  }

  async loadProcessedArchivesList() {
    try {
      const processedArchives = await window.electronAPI.getProcessedArchives()
      if (processedArchives && processedArchives.length > 0) {
        this.displayProcessedArchives(processedArchives)
      }
    } catch (error) {
      console.warn('Failed to load processed archives list:', error)
    }
  }

  displayProcessedArchives(archives) {
    if (!this.processedArchivesList) return

    this.processedArchivesList.innerHTML = ''

    archives.forEach((archive) => {
      const archiveItem = document.createElement('div')
      archiveItem.className = 'processed-archive-item'

      const archiveInfo = document.createElement('div')
      archiveInfo.className = 'archive-info'

      const nameElement = document.createElement('strong')
      nameElement.textContent = archive.name

      const metaElement = document.createElement('span')
      metaElement.className = 'archive-meta'
      const imgCount = Array.isArray(archive.extractedFiles)
        ? archive.extractedFiles.length
        : Number(archive.extractedFiles) || 0
      metaElement.textContent = `${imgCount} images • ${(archive.size / 1024 / 1024).toFixed(1)}MB`

      archiveInfo.appendChild(nameElement)
      archiveInfo.appendChild(metaElement)

      const loadBtn = document.createElement('button')
      loadBtn.className = 'load-archive-btn'
      loadBtn.textContent = 'Load Images'
      loadBtn.setAttribute('data-hash', archive.hash)

      archiveItem.appendChild(archiveInfo)
      archiveItem.appendChild(loadBtn)

      // Add click handler for the load button
      loadBtn.addEventListener('click', () => {
        this.loadProcessedArchive(archive.hash)
      })

      this.processedArchivesList.appendChild(archiveItem)
    })

    // Show the processed archives section
    if (this.processedArchivesSection) {
      this.processedArchivesSection.style.display = 'block'
    }
  }

  renderGallery() {
    console.log(`🔍 DEBUG: Starting gallery render for ${this.images.length} images...`)
    const renderStart = performance.now()

    // Clear existing content
    this.galleryGrid.innerHTML = ''

    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment()

    this.images.forEach((image, index) => {
      if (image.error) {
        const errorDiv = document.createElement('div')
        errorDiv.className = 'image-error'

        const iconDiv = document.createElement('div')
        iconDiv.className = 'image-error-icon'
        iconDiv.textContent = '⚠️'

        const messageDiv = document.createElement('div')
        messageDiv.textContent = 'Failed to load'

        const nameDiv = document.createElement('div')
        nameDiv.style.fontSize = '0.8rem'
        nameDiv.style.opacity = '0.7'
        nameDiv.textContent = image.name

        errorDiv.appendChild(iconDiv)
        errorDiv.appendChild(messageDiv)
        errorDiv.appendChild(nameDiv)

        errorDiv.addEventListener('click', () => this.openFullscreen(index))
        fragment.appendChild(errorDiv)
      } else {
        const img = document.createElement('img')
        img.className = 'gallery-image'
        img.src = image.dataUrl
        img.alt = image.name
        img.loading = 'lazy' // Lazy load for better performance with large galleries
        img.decoding = 'async' // Don't block on image decoding
        img.draggable = false // Disable dragging to prevent accidental gallery reload
        img.addEventListener('click', () => this.openFullscreen(index))
        fragment.appendChild(img)
      }
    })

    this.galleryGrid.appendChild(fragment)
    const renderTime = performance.now() - renderStart
    console.log(`🔍 DEBUG: Gallery render completed in ${renderTime.toFixed(2)}ms`)
  }

  openFullscreen(index) {
    if (this.images.length === 0) return

    if (this.images[index].error) {
      console.warn(`Cannot open fullscreen for failed image: ${this.images[index].name}`)
      return
    }

    this.currentIndex = index
    this.isFullscreen = true

    this.updateFullscreenImage()
    this.updateNavigationButtons()
    this.fullscreenOverlay.classList.remove('hidden')

    // Prevent body scroll
    document.body.style.overflow = 'hidden'

    // Add fullscreen-specific event listeners
    this.fullscreenOverlay.onclick = (e) => {
      if (e.target === this.fullscreenOverlay) this.closeFullscreen()
    }

    this.fullscreenWheelHandler = (e) => {
      e.preventDefault()
      // Handle wheel navigation without debounce for responsive scrolling
      if (e.deltaX > 0 || e.deltaY > 0) this.showNext()
      else if (e.deltaX < 0 || e.deltaY < 0) this.showPrevious()
    }
    this.fullscreenOverlay.addEventListener('wheel', this.fullscreenWheelHandler, {
      passive: false,
    })
  }

  closeFullscreen() {
    this.isFullscreen = false
    this.fullscreenOverlay.classList.add('hidden')
    document.body.style.overflow = ''

    // Clean up event listeners
    this.fullscreenOverlay.onclick = null
    if (this.fullscreenWheelHandler) {
      this.fullscreenOverlay.removeEventListener('wheel', this.fullscreenWheelHandler)
      this.fullscreenWheelHandler = null
    }
  }

  showPrevious() {
    if (this.currentIndex > 0) {
      this.currentIndex--
      this.updateFullscreenImage()
    }
  }

  showNext() {
    if (this.currentIndex < this.images.length - 1) {
      this.currentIndex++
      this.updateFullscreenImage()
    }
  }

  updateFullscreenImage() {
    const image = this.images[this.currentIndex]
    if (!image || image.error) return

    this.fullscreenImage.src = image.dataUrl
    this.fullscreenImage.alt = image.name
    this.updateNavigationButtons()
  }

  updateNavigationButtons() {
    this.prevBtn.disabled = this.currentIndex === 0
    this.nextBtn.disabled = this.currentIndex === this.images.length - 1
  }

  handleKeydown(e) {
    // Global shortcuts
    if (e.ctrlKey && e.key === 'd') {
      e.preventDefault()
      console.log('🔍 DEBUG: Ctrl+D detected, syncing logs to main process...')
      this.syncLogsToMain()
      return
    }

    if (!this.isFullscreen) return

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault()
        this.showPrevious()
        break
      case 'ArrowRight':
        e.preventDefault()
        this.showNext()
        break
      case 'Escape':
        e.preventDefault()
        this.closeFullscreen()
        break
    }
  }

  showLoading() {
    this.loadingIndicator.classList.remove('hidden')
    this.loadingProgress.classList.add('hidden')
    this.loadingText.textContent = 'Loading images...'
  }

  hideLoading() {
    this.loadingIndicator.classList.add('hidden')
  }

  updateProgress(current, total) {
    if (!this.loadingProgress || !this.progressFill || !this.progressText) {
      console.warn('⚠️ Loading UI elements not found - progress cannot be displayed')
      return
    }

    this.loadingProgress.classList.remove('hidden')
    const percentage = total > 0 ? (current / total) * 100 : 0
    this.progressFill.style.width = `${percentage}%`
    this.progressText.textContent = `${current} / ${total}`
    this.loadingText.textContent = `Loading images... (${current}/${total})`
  }

  hideDropZone() {
    this.dropZone.classList.add('hidden')
    this.galleryGrid.classList.remove('hidden')
  }

  showDropZone() {
    this.dropZone.classList.remove('hidden')
    this.galleryGrid.classList.add('hidden')
  }
}

// Initialize the gallery when the page loads
document.addEventListener('DOMContentLoaded', () => {
  new ImageGallery()
})

// Handle window resize for responsive grid
window.addEventListener('resize', () => {
  // Gallery will automatically adjust via CSS grid
  // Could add more sophisticated responsive logic here if needed
})
