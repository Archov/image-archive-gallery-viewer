/**
 * UI Controls - Handles UI interactions, event binding, and controls
 */
class UIControls {
  constructor() {
    this.gallery = null
    this._bound = false
  }

  setGallery(gallery) {
    this.gallery = gallery
  }

  bindEvents() {
    if (this._bound) return

    if (
      !this.gallery.fileSelectBtn ||
      !this.gallery.closeFullscreenBtn ||
      !this.gallery.prevBtn ||
      !this.gallery.nextBtn ||
      !this.gallery.fullscreenImage
    ) {
      console.warn('⚠️ Skipping event binding: required elements missing')
      return
    }

    this._bound = true

    // File selection
    this.gallery.fileSelectBtn.addEventListener('click', () => this.gallery.selectFiles())
    this.gallery.archiveSelectBtn?.addEventListener('click', () => this.gallery.selectArchives())

    // Fullscreen controls
    this.gallery.closeFullscreenBtn.addEventListener('click', () => this.gallery.closeFullscreen())
    this.gallery.prevBtn.addEventListener('click', () => this.gallery.showPrevious())
    this.gallery.nextBtn.addEventListener('click', () => this.gallery.showNext())

    // Keyboard navigation
    document.addEventListener('keydown', (e) => this.handleKeydown(e))

    // Fullscreen image click to close
    this.gallery.fullscreenImage.addEventListener('click', () => this.gallery.closeFullscreen())

    // IPC event listeners for menu actions
    this.setupIpcListeners()
  }

  setupIpcListeners() {
    // Menu-triggered actions
    window.electronAPI?.onMenuOpenImages?.(() => {
      this.gallery.selectFiles()
    })

    window.electronAPI?.onMenuOpenArchives?.(() => {
      this.gallery.selectArchives()
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
      this.gallery.dropZone?.classList.add('drag-over')
    })

    galleryContainer.addEventListener('dragleave', (e) => {
      // Only remove class if we're actually leaving the drop zone
      if (!galleryContainer.contains(e.relatedTarget)) {
        this.gallery.dropZone?.classList.remove('drag-over')
      }
    })

    galleryContainer.addEventListener('drop', (e) => {
      this.gallery.dropZone?.classList.remove('drag-over')
      const fileList = e.dataTransfer?.files
      const files = fileList ? Array.from(fileList) : []
      if (files.length) this.gallery.loadFiles(files)
    })

    // No hover effects to optimize
  }

  handleKeydown(e) {
    // Global shortcuts
    if (e.ctrlKey && e.key === 'd') {
      e.preventDefault()
      console.log('🔍 DEBUG: Ctrl+D detected, syncing logs to main process...')
      this.gallery.syncLogsToMain?.()
      return
    }

    if (!this.gallery.isFullscreen) return

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault()
        this.gallery.showPrevious()
        break
      case 'ArrowRight':
        e.preventDefault()
        this.gallery.showNext()
        break
      case 'Escape':
        e.preventDefault()
        this.gallery.closeFullscreen()
        break
    }
  }

  showLoading() {
    this.gallery.loadingIndicator.classList.remove('hidden')
    this.gallery.loadingProgress.classList.add('hidden')
    this.gallery.loadingText.textContent = 'Loading images...'
  }

  hideLoading() {
    this.gallery.loadingIndicator.classList.add('hidden')
  }

  updateProgress(current, total) {
    if (
      !this.gallery.loadingProgress ||
      !this.gallery.progressFill ||
      !this.gallery.progressText ||
      !this.gallery.loadingText
    ) {
      console.warn('⚠️ Loading UI elements not found - progress cannot be displayed')
      return
    }

    this.gallery.loadingProgress.classList.remove('hidden')
    const percentage = total > 0 ? Math.min(100, Math.max(0, (current / total) * 100)) : 0
    this.gallery.progressFill.style.width = `${percentage.toFixed(1)}%`
    this.gallery.progressText.textContent = `${current} / ${total}`
    this.gallery.loadingText.textContent = `Loading images... (${current}/${total})`
  }

  hideDropZone() {
    this.gallery.dropZone?.classList.add('hidden')
    this.gallery.galleryGrid?.classList.remove('hidden')
  }

  showDropZone() {
    this.gallery.dropZone?.classList.remove('hidden')
    this.gallery.galleryGrid?.classList.add('hidden')
  }
}

// Export to global scope
window.UIControls = UIControls
