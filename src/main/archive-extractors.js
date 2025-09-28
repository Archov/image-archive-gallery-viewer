/**
 * Archive Extractors - Handles extraction of different archive formats
 */
class ArchiveExtractors {
  constructor() {
    this.imageExtensions = [
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
  }

  /**
   * Extract ZIP archive
   * @param {string} archivePath - Path to archive
   * @param {string} extractPath - Extraction directory
   * @param {Function} progressCallback - Progress callback
   * @returns {Promise<Array>} List of extracted files
   */
  async extractZip(archivePath, extractPath, progressCallback) {
    const AdmZip = require('adm-zip')
    const path = require('node:path')
    const fs = require('node:fs')

    return new Promise((resolve, reject) => {
      try {
        const zip = new AdmZip(archivePath)
        const entries = zip.getEntries()

        let processedFiles = 0
        const extractedFiles = []

        // Filter image files and extract
        const imageEntries = entries.filter(
          (entry) => !entry.isDirectory && this.isImageFile(entry.entryName)
        )

        // Track used filenames to prevent collisions
        const usedNames = new Set()
        const usedNamesNormalized = new Set()

        for (const entry of imageEntries) {
          try {
            const baseName = path.basename(entry.entryName)
            let fileName = baseName
            let counter = 1
            let normalized = fileName.toLowerCase()

            // Handle filename collisions by adding suffix
            while (usedNames.has(fileName) || usedNamesNormalized.has(normalized)) {
              const ext = path.extname(baseName)
              const nameWithoutExt = path.basename(baseName, ext)
              fileName = `${nameWithoutExt}_${counter}${ext}`
              counter++
              normalized = fileName.toLowerCase()
            }

            usedNames.add(fileName)
            usedNamesNormalized.add(normalized)
            const finalPath = path.join(extractPath, fileName) // nosemgrep
            // Write the entry data directly to ensure unique filename is used
            const data = entry.getData()
            fs.writeFileSync(finalPath, data)

            extractedFiles.push({
              originalName: entry.entryName,
              extractedPath: finalPath,
              size: entry.header.size,
            })

            processedFiles++
            if (progressCallback) {
              progressCallback(processedFiles, imageEntries.length)
            }
          } catch (_error) {
            console.warn(`[ARCHIVE] Failed to extract entry:`, _error.message)
          }
        }

        resolve(extractedFiles)
      } catch (error) {
        reject(new Error(`ZIP extraction failed: ${error.message}`))
      }
    })
  }

  /**
   * Extract RAR archive
   * @param {string} archivePath - Path to archive
   * @param {string} extractPath - Extraction directory
   * @param {Function} progressCallback - Progress callback
   * @returns {Promise<Array>} List of extracted files
   */
  async extractRar(archivePath, extractPath, progressCallback) {
    const { createExtractorFromFile } = require('node-unrar-js')
    const path = require('node:path')

    try {
      const extractor = await createExtractorFromFile({
        filepath: archivePath,
        targetPath: extractPath,
      })
      const extractionResult = extractor.extract()
      const filesIterator = extractionResult.files ?? []
      const entries = Array.from(filesIterator)

      const imageFiles = entries.filter(
        (f) => !f.fileHeader.flags.directory && this.isImageFile(f.fileHeader.name)
      )
      const totalImageFiles = imageFiles.length

      const extractedFiles = []
      let processedFiles = 0

      for (const file of imageFiles) {
        // Sanitize and record the actual path written by extractor
        const safeRel = path.normalize(file.fileHeader.name).replace(/^(\.\.(\\|\/|$))+/, '')
        const outPath = path.join(extractPath, safeRel) // as extracted by unrar
        const relCheck = path.relative(extractPath, path.resolve(outPath))
        if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
          console.warn(`[ARCHIVE] Skipping suspicious RAR path: ${file.fileHeader.name}`)
          continue
        }
        extractedFiles.push({
          originalName: file.fileHeader.name,
          extractedPath: outPath,
          size: file.fileHeader.unpackedSize,
        })
        processedFiles++
        if (progressCallback) progressCallback(processedFiles, totalImageFiles)
      }
      return extractedFiles
    } catch (error) {
      throw new Error(`RAR extraction failed: ${error.message}`)
    }
  }

  /**
   * Extract 7Z archive
   * @param {string} archivePath - Path to archive
   * @param {string} extractPath - Extraction directory
   * @param {Function} progressCallback - Progress callback
   * @returns {Promise<Array>} List of extracted files
   */
  async extract7z(archivePath, extractPath, progressCallback) {
    const Seven = require('node-7z')
    const sevenBin = require('7zip-bin')

    // 1) List to determine image entries
    const entries = await new Promise((resolve, reject) => {
      const list = Seven.list(archivePath, { $bin: sevenBin.path7za })
      const rows = []
      list.on('data', (d) => rows.push(d))
      list.on('end', () => resolve(rows))
      list.on('error', (e) => reject(new Error(`7Z list failed: ${e.message}`)))
    })
    const imageFiles = entries.map((r) => r.file).filter((f) => !!f && this.isImageFile(f))
    const total = imageFiles.length

    // 2) Extract with image patterns to filter at extraction time
    // Generate case-insensitive patterns to handle upper-case extensions (JPG, PNG, etc.)
    const imagePatterns = Array.from(
      new Set(
        this.imageExtensions.flatMap((ext) => {
          const trimmed = ext.startsWith('.') ? ext.slice(1) : ext
          const lower = `*.${trimmed.toLowerCase()}`
          const upper = `*.${trimmed.toUpperCase()}`
          return lower === upper ? [lower] : [lower, upper]
        })
      )
    )
    return new Promise((resolve, reject) => {
      const stream = Seven.extractFull(archivePath, extractPath, {
        $progress: true,
        $bin: sevenBin.path7za,
        wildcards: imagePatterns, // Extract only files matching these patterns
        r: true, // Recursive
      })
      stream.on('progress', (p) => {
        if (progressCallback && total > 0) {
          const processed = Math.min(total, Math.round((p.percent / 100) * total))
          progressCallback(processed, total)
        }
      })
      stream.on('end', async () => {
        try {
          const fileScanner = require('./file-scanner')
          const files = await fileScanner.scanDirectoryForImages(extractPath)
          resolve(files)
        } catch (e) {
          reject(new Error(`7Z processing failed: ${e.message}`))
        }
      })
      stream.on('error', (e) => reject(new Error(`7Z extraction failed: ${e.message}`)))
    })
  }

  /**
   * Check if file is an image
   * @param {string} fileName - File name or path
   * @returns {boolean} True if image file
   */
  isImageFile(fileName) {
    const path = require('node:path')
    const ext = path.extname(fileName).toLowerCase()
    return this.imageExtensions.includes(ext)
  }

  /**
   * Get archive type from file extension
   * @param {string} filePath - Archive file path
   * @returns {string} Archive type
   */
  getArchiveType(filePath) {
    const path = require('node:path')
    const ext = path.extname(filePath).toLowerCase()
    switch (ext) {
      case '.zip':
        return 'zip'
      case '.rar':
        return 'rar'
      case '.7z':
        return '7z'
      default:
        return 'unknown'
    }
  }
}

module.exports = new ArchiveExtractors()
