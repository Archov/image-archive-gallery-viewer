/**
 * Archive Manager - Handles archive processing and management
 */
class ArchiveManager {
  constructor() {
    this.gallery = null
  }

  setGallery(gallery) {
    this.gallery = gallery
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

  async processArchives(archiveFiles) {
    console.log(`📦 Processing ${archiveFiles.length} archives...`)

    // Clear existing gallery when processing new archives
    this.gallery.images = []
    this.gallery.imageLoader.cleanupBlobUrls()

    for (const archiveFile of archiveFiles) {
      try {
        console.log(`📦 Processing archive: ${archiveFile.name || archiveFile.path}`)

        // Show loading for archive processing
        this.gallery.showLoading()
        this.gallery.updateProgress(0, 1)
        this.gallery.loadingText.textContent = `Processing ${archiveFile.name || 'archive'}...`

        // Set up progress listener
        const progressHandler = (progress) => {
          this.gallery.updateProgress(progress.processed, progress.total)
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
              this.gallery.loadingText.textContent = `Reprocessing ${archiveFile.name || 'archive'}...`
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
                  await this.gallery.imageLoader.loadFilesFromPaths(extractedImagePaths)
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
              await this.gallery.imageLoader.loadFilesFromPaths(extractedImagePaths)
            }
          }
        } finally {
          unsubscribeProgress()
        }
      } catch (error) {
        console.error(`❌ Failed to process archive:`, error)
        alert(`Failed to process archive ${archiveFile.name}: ${error.message}`)
      } finally {
        this.gallery.hideLoading()
      }
    }
  }

  async loadProcessedArchive(archiveHash) {
    try {
      console.log(`📦 Loading previously processed archive: ${archiveHash}`)

      // Clear existing gallery when loading a processed archive
      this.gallery.images = []
      this.gallery.imageLoader.cleanupBlobUrls()

      // Show loading
      this.gallery.showLoading()
      this.gallery.updateProgress(0, 1)
      this.gallery.loadingText.textContent = 'Loading processed archive...'

      const result = await window.electronAPI.loadProcessedArchive(archiveHash)

      console.log(
        `✅ Loaded processed archive: ${result.metadata.name} (${result.extractedFiles.length} images)`
      )

      // Load the extracted images into the gallery
      if (result.extractedFiles.length > 0) {
        const extractedImagePaths = result.extractedFiles.map((f) => f.extractedPath)
        await this.gallery.imageLoader.loadFilesFromPaths(extractedImagePaths)
      }
    } catch (error) {
      console.error(`❌ Failed to load processed archive:`, error)
      alert(`Failed to load processed archive: ${error.message}`)
    } finally {
      this.gallery.hideLoading()
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
    if (!this.gallery.processedArchivesList) return

    this.gallery.processedArchivesList.innerHTML = ''

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

      this.gallery.processedArchivesList.appendChild(archiveItem)
    })

    // Show the processed archives section
    if (this.gallery.processedArchivesSection) {
      this.gallery.processedArchivesSection.style.display = 'block'
    }
  }
}

// Export to global scope
window.ArchiveManager = ArchiveManager
