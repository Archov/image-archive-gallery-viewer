/**
 * Fullscreen Viewer - Handles fullscreen image viewing and navigation
 */
class FullscreenViewer {
  constructor() {
    this.gallery = null
    this.fullscreenWheelHandler = null
  }

  setGallery(gallery) {
    this.gallery = gallery
  }

  openFullscreen(index) {
    if (this.gallery.images.length === 0) return

    if (this.gallery.images[index].error) {
      console.warn(`Cannot open fullscreen for failed image: ${this.gallery.images[index].name}`)
      return
    }

    this.gallery.currentIndex = index
    this.gallery.isFullscreen = true

    this.updateFullscreenImage()
    this.updateNavigationButtons()
    this.gallery.fullscreenOverlay.classList.remove('hidden')

    // Prevent body scroll
    document.body.style.overflow = 'hidden'

    // Add fullscreen-specific event listeners
    this.gallery.fullscreenOverlay.onclick = (e) => {
      if (e.target === this.gallery.fullscreenOverlay) this.closeFullscreen()
    }

    this.fullscreenWheelHandler = (e) => {
      e.preventDefault()
      // Handle wheel navigation without debounce for responsive scrolling
      if (e.deltaX > 0 || e.deltaY > 0) this.showNext()
      else if (e.deltaX < 0 || e.deltaY < 0) this.showPrevious()
    }
    this.gallery.fullscreenOverlay.addEventListener('wheel', this.fullscreenWheelHandler, {
      passive: false,
    })
  }

  closeFullscreen() {
    this.gallery.isFullscreen = false
    this.gallery.fullscreenOverlay.classList.add('hidden')
    document.body.style.overflow = ''

    // Clean up event listeners
    this.gallery.fullscreenOverlay.onclick = null
    if (this.fullscreenWheelHandler) {
      this.gallery.fullscreenOverlay.removeEventListener('wheel', this.fullscreenWheelHandler)
      this.fullscreenWheelHandler = null
    }
  }

  showPrevious() {
    if (this.gallery.currentIndex > 0) {
      this.gallery.currentIndex--
      this.updateFullscreenImage()
    }
  }

  showNext() {
    if (this.gallery.currentIndex < this.gallery.images.length - 1) {
      this.gallery.currentIndex++
      this.updateFullscreenImage()
    }
  }

  updateFullscreenImage() {
    const image = this.gallery.images[this.gallery.currentIndex]
    if (!image || image.error) return

    this.gallery.fullscreenImage.src = image.dataUrl
    this.gallery.fullscreenImage.alt = image.name
    this.updateNavigationButtons()
  }

  updateNavigationButtons() {
    this.gallery.prevBtn.disabled = this.gallery.currentIndex === 0
    this.gallery.nextBtn.disabled = this.gallery.currentIndex === this.gallery.images.length - 1
  }
}

// Export to global scope
window.FullscreenViewer = FullscreenViewer
