/**
 * Image Loader - Handles file selection, loading, and image processing
 */
class ImageLoader {
  constructor() {
    this.gallery = null
    this.blobUrls = []
  }

  setGallery(gallery) {
    this.gallery = gallery
  }

  cleanupBlobUrls() {
    if (this.blobUrls) {
      this.blobUrls.forEach((url) => {
        URL.revokeObjectURL(url)
      })
      this.blobUrls = []
    }
  }

  async selectFiles() {
    try {
      const filePaths = await window.electronAPI.selectFiles()
      if (filePaths && filePaths.length > 0) {
        const toLower = (p) => p.toLowerCase()
        const isImg = (p) =>
          ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.svg', '.avif'].some(
            (ext) => toLower(p).endsWith(ext)
          )
        const isArc = (p) => ['.zip', '.rar', '.7z'].some((ext) => toLower(p).endsWith(ext))
        const imagePaths = filePaths.filter(isImg)
        const archivePaths = filePaths.filter(isArc)

        if (archivePaths.length) {
          const archiveFiles = archivePaths.map((p) => ({ path: p, name: p.split(/[/\\]/).pop() }))
          await this.gallery.processArchives(archiveFiles)
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

  async loadFiles(files) {
    console.log('🔍 DEBUG: loadFiles called with', files.length, 'files')

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
      await this.gallery.processArchives(archiveFiles)
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

    this.gallery.showLoading()
    this.gallery.updateProgress(0, filePaths.length)
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
            id: this.gallery.generateUniqueId(),
            name: source?.name || source?.path || 'Unknown',
            path: source?.path,
            error: true,
            dataUrl: null,
          })
        })

        this.gallery.images.push(...allResults)

        processedCount += batch.length
        this.gallery.updateProgress(processedCount, filePaths.length)

        const successSoFar = this.gallery.images.filter((img) => !img.error).length
        console.log(
          `🔍 DEBUG: Path batch complete. Total processed: ${processedCount}/${filePaths.length}, successful: ${successSoFar}, batch success: ${batchSuccessfulCount}/${batch.length}`
        )
      }

      const successCount = this.gallery.images.filter((img) => !img.error).length
      const failedCount = this.gallery.images.length - successCount
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
      this.gallery.renderGallery()
      console.log('🔍 DEBUG: Hiding drop zone...')
      this.gallery.hideDropZone()
      console.log('✅ Gallery load from paths complete!')
    } catch (error) {
      console.error('❌ Error loading files from paths:', error)
      alert(`Error loading images: ${error.message}`)
    } finally {
      this.gallery.hideLoading()
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

    this.gallery.showLoading()
    this.gallery.updateProgress(0, imageFiles.length)
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
            id: this.gallery.generateUniqueId(),
            name: source?.name || source?.path || 'Unknown',
            path: source?.path,
            error: true,
            dataUrl: null,
          })
        })

        this.gallery.images.push(...allResults)

        processedCount += batch.length
        this.gallery.updateProgress(processedCount, imageFiles.length)

        const successSoFar = this.gallery.images.filter((img) => !img.error).length
        console.log(
          `🔍 DEBUG: Image batch complete. Total processed: ${processedCount}/${imageFiles.length}, successful: ${successSoFar}, batch success: ${batchSuccessfulCount}/${batch.length}`
        )
      }

      const successCount = this.gallery.images.filter((img) => !img.error).length
      const failedCount = this.gallery.images.length - successCount
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
      this.gallery.renderGallery()
      console.log('🔍 DEBUG: Hiding drop zone...')
      this.gallery.hideDropZone()
      console.log('✅ Gallery load complete!')
    } catch (error) {
      console.error('❌ Error loading image files:', error)
      alert(`Error loading images: ${error.message}`)
    } finally {
      this.gallery.hideLoading()
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
              id: this.gallery.generateUniqueId(),
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
            id: this.gallery.generateUniqueId(),
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
            id: this.gallery.generateUniqueId(),
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
        tif: 'image/tiff',
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
            id: this.gallery.generateUniqueId(),
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
            id: this.gallery.generateUniqueId(),
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
        id: this.gallery.generateUniqueId(),
        name: filePath.split(/[/\\]/).pop(),
        path: filePath,
        error: true,
        dataUrl: null,
      }
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
      '.tif',
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
}

// Export to global scope
window.ImageLoader = ImageLoader
