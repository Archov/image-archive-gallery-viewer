/**
 * Gallery Core - Main gallery functionality and state management
 */
class ImageGallery {
  constructor() {
    this.images = []
    this.currentIndex = 0
    this.isFullscreen = false
    this.idCounter = Date.now() % 100000 // For collision-resistant ID generation across sessions

    // Initialize modules without passing 'this' to avoid circular dependencies
    this.debugLogger = window.DebugLogger
    this.imageLoader = new window.ImageLoader()
    this.fullscreenViewer = new window.FullscreenViewer()
    this.uiControls = new window.UIControls()
    this.archiveManager = new window.ArchiveManager()

    // Set the gallery reference in each module
    this.imageLoader.setGallery(this)
    this.fullscreenViewer.setGallery(this)
    this.uiControls.setGallery(this)
    this.archiveManager.setGallery(this)

    const elementsInitialized = this.initializeElements()
    if (elementsInitialized) {
      this.bindEvents()
      this.setupDragAndDrop()
    }

    // Load processed archives on startup
    this.loadProcessedArchivesList()

    // Clean up resources on window unload
    window.addEventListener('beforeunload', () => {
      this.cleanup()
    })

    // Override console methods to capture logs
    this.debugLogger.setupDebugCapture()

    console.log('🔍 DEBUG: Gallery initialized with debug logging')
    console.log('[DEBUG] Renderer logs will be automatically saved to main process debug file')

    // Set up automatic log syncing
    this.debugLogger.setupAutoLogSync()

    // TODO: Add settings UI for configuring image repository path
    // This will call window.electronAPI.setImageRepositoryPath()
    // and allow users to choose where downloaded/extracted images are stored
  }

  generateUniqueId() {
    return `img_${++this.idCounter}_${Date.now()}`
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
      console.error('❌ Critical UI elements not found!')
      return false
    }

    // Ensure fullscreen overlay is hidden by default
    this.fullscreenOverlay.classList.add('hidden')
    return true
  }

  bindEvents() {
    this.uiControls.bindEvents()
  }

  setupDragAndDrop() {
    this.uiControls.setupDragAndDrop()
  }

  // Delegate methods to appropriate modules
  async selectFiles() {
    await this.imageLoader.selectFiles()
  }

  async selectArchives() {
    await this.archiveManager.selectArchives()
  }

  async loadFiles(files) {
    await this.imageLoader.loadFiles(files)
  }

  async loadFilesFromPaths(filePaths) {
    await this.imageLoader.loadFilesFromPaths(filePaths)
  }

  async loadImageFiles(imageFiles) {
    await this.imageLoader.loadImageFiles(imageFiles)
  }

  async processArchives(archiveFiles) {
    await this.archiveManager.processArchives(archiveFiles)
  }

  async loadProcessedArchive(archiveHash) {
    await this.archiveManager.loadProcessedArchive(archiveHash)
  }

  async loadProcessedArchivesList() {
    await this.archiveManager.loadProcessedArchivesList()
  }

  displayProcessedArchives(archives) {
    this.archiveManager.displayProcessedArchives(archives)
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
    this.fullscreenViewer.openFullscreen(index)
  }

  closeFullscreen() {
    this.fullscreenViewer.closeFullscreen()
  }

  showPrevious() {
    this.fullscreenViewer.showPrevious()
  }

  showNext() {
    this.fullscreenViewer.showNext()
  }

  updateFullscreenImage() {
    this.fullscreenViewer.updateFullscreenImage()
  }

  updateNavigationButtons() {
    this.fullscreenViewer.updateNavigationButtons()
  }

  showLoading() {
    this.uiControls.showLoading()
  }

  hideLoading() {
    this.uiControls.hideLoading()
  }

  updateProgress(current, total) {
    this.uiControls.updateProgress(current, total)
  }

  hideDropZone() {
    this.uiControls.hideDropZone()
  }

  showDropZone() {
    this.uiControls.showDropZone()
  }

  async syncLogsToMain() {
    await this.debugLogger.syncLogsToMain()
  }

  async exportDebugLogs() {
    await this.debugLogger.exportDebugLogs()
  }

  cleanup() {
    this.debugLogger.cleanup()
    this.imageLoader.cleanupBlobUrls()
  }
}

// Export to global scope
window.ImageGallery = ImageGallery
