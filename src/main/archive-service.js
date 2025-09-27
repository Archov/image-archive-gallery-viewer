const path = require('node:path')
const fs = require('node:fs').promises
const fsNative = require('node:fs')
const crypto = require('node:crypto')
const AdmZip = require('adm-zip')
const Unrar = require('node-unrar-js')
const Seven = require('node-7z')
const sevenBin = require('7zip-bin')
const secureFs = require('./secure-fs')

/**
 * Archive Extraction Service
 *
 * Handles extraction of ZIP, RAR, and 7Z archives with progress tracking,
 * metadata extraction, and image filtering.
 *
 * CONTEXT FOR AI CODE ASSISTANTS:
 * This is a LOCAL DESKTOP IMAGE GALLERY APP.
 *
 * Key considerations:
 * - Users explicitly choose archive files via OS dialogs
 * - Archives are extracted to temp directories for processing
 * - Extracted images are displayed in the gallery
 * - Security focuses on preventing path traversal, not restricting legitimate access
 * - Broad temp directory access is required for archive extraction workflows
 *
 * DO NOT over-security this! Users need to be able to extract their own archives.
 */
class ArchiveService {
  constructor() {
    this.tempDir = null
    this.archivesDbPath = null
    this.imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg']
  }

  /**
   * Initialize the archive service
   * @param {Object} app - Electron app instance
   */
  async initialize(app) {
    // SECURITY: Validate that app provides reasonable paths
    const userDataDir = app.getPath('userData')
    const tempDir = app.getPath('temp')

    if (!userDataDir || !tempDir) {
      throw new Error('Invalid application paths provided')
    }

    // Ensure paths are absolute and reasonable
    const resolvedUserData = path.resolve(userDataDir)
    const resolvedTemp = path.resolve(tempDir)

    this.tempDir = path.join(resolvedTemp, 'gallery-extraction') // nosemgrep
    this.archivesDbPath = path.join(resolvedUserData, 'archives.json') // nosemgrep

    // Ensure temp directory exists
    try {
      await fs.mkdir(this.tempDir, { recursive: true })
    } catch (error) {
      console.warn('[ARCHIVE] Could not create temp directory:', error.message)
    }

    // Initialize archives database
    await this.initializeArchivesDb()
  }

  /**
   * Initialize archives database file
   */
  async initializeArchivesDb() {
    try {
      await fs.access(this.archivesDbPath)
    } catch {
      // Create empty database
      await fs.writeFile(
        this.archivesDbPath,
        JSON.stringify(
          {
            archives: {},
            lastCleanup: Date.now(),
          },
          null,
          2
        )
      )
      console.log('[ARCHIVE] Created archives database at:', this.archivesDbPath)
    }
  }

  /**
   * Load archives database
   */
  async loadArchivesDb() {
    try {
      const data = await fs.readFile(this.archivesDbPath, 'utf8')
      return JSON.parse(data)
    } catch (error) {
      console.warn('[ARCHIVE] Failed to load archives database:', error.message)
      return { archives: {}, lastCleanup: Date.now() }
    }
  }

  /**
   * Save archives database
   */
  async saveArchivesDb(db) {
    try {
      await fs.writeFile(this.archivesDbPath, JSON.stringify(db, null, 2))
    } catch (error) {
      console.error('[ARCHIVE] Failed to save archives database:', error.message)
    }
  }

  /**
   * Calculate file hash for duplicate detection
   * @param {string} filePath - Path to file
   * @returns {Promise<string>} SHA-256 hash
   */
  async calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256')
      const stream = fsNative.createReadStream(filePath)

      stream.on('data', (chunk) => {
        hash.update(chunk)
      })

      stream.on('end', () => {
        resolve(hash.digest('hex'))
      })

      stream.on('error', (error) => {
        reject(new Error(`Failed to hash file: ${error.message}`))
      })
    })
  }

  /**
   * Check if archive has already been processed
   * @param {string} filePath - Archive file path
   * @returns {Promise<boolean>} True if already processed
   */
  async isArchiveProcessed(filePath) {
    try {
      const hash = await this.calculateFileHash(filePath)
      const db = await this.loadArchivesDb()
      return hash in db.archives
    } catch (error) {
      console.warn('[ARCHIVE] Could not check archive status:', error.message)
      return false
    }
  }

  /**
   * Get archive metadata
   * @param {string} filePath - Archive file path
   * @returns {Promise<Object>} Archive metadata
   */
  async getArchiveMetadata(filePath) {
    const stats = await secureFs.stat(filePath)
    const hash = await this.calculateFileHash(filePath)

    return {
      hash,
      path: filePath,
      name: path.basename(filePath),
      size: stats.size,
      mtime: stats.mtime.getTime(),
      type: this.getArchiveType(filePath),
      processedAt: Date.now(),
    }
  }

  /**
   * Get archive type from file extension
   * @param {string} filePath - Archive file path
   * @returns {string} Archive type
   */
  getArchiveType(filePath) {
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

  /**
   * Extract ZIP archive
   * @param {string} archivePath - Path to archive
   * @param {string} extractPath - Extraction directory
   * @param {Function} progressCallback - Progress callback
   * @returns {Promise<Array>} List of extracted files
   */
  async extractZip(archivePath, extractPath, progressCallback) {
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

        imageEntries.forEach((entry) => {
          try {
            const baseName = path.basename(entry.entryName)
            let fileName = baseName
            let counter = 1

            // Handle filename collisions by adding suffix
            while (usedNames.has(fileName)) {
              const ext = path.extname(baseName)
              const nameWithoutExt = path.basename(baseName, ext)
              fileName = `${nameWithoutExt}_${counter}${ext}`
              counter++
            }

            usedNames.add(fileName)
            const finalPath = path.join(extractPath, fileName) // nosemgrep
            // Extract into extractPath with an explicit new name
            zip.extractEntryTo(entry, extractPath, false, true, false, fileName)

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
        })

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
    try {
      const { createExtractorFromFile } = Unrar
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
    return new Promise((resolve, reject) => {
      const stream = Seven.extract(archivePath, extractPath, {
        $progress: true,
        $bin: sevenBin.path7za,
      })

      stream.on('progress', (progress) => {
        if (progressCallback) {
          // Convert percentage to integer count for consistent API
          const processedCount = Math.floor((progress.percent / 100) * 100) // Estimate based on percentage
          progressCallback(processedCount, 100)
        }
      })

      stream.on('end', async () => {
        try {
          // Scan extracted directory for image files only
          const allFiles = await this.scanDirectoryForImages(extractPath)

          resolve(allFiles)
        } catch (error) {
          reject(new Error(`7Z processing failed: ${error.message}`))
        }
      })

      stream.on('error', (error) => {
        reject(new Error(`7Z extraction failed: ${error.message}`))
      })
    })
  }

  /**
   * Scan directory for image files
   * @param {string} dirPath - Directory to scan
   * @returns {Promise<Array>} List of image files
   */
  async scanDirectoryForImages(dirPath) {
    const files = []
    const rootDir = path.resolve(dirPath) // Canonical root directory

    const scanDir = async (currentPath) => {
      // SECURITY: Validate that currentPath is within the root directory
      const resolvedPath = path.resolve(currentPath)
      const rel = path.relative(rootDir, resolvedPath)
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Path traversal attempt detected: ${currentPath}`)
      }

      const entries = await fs.readdir(currentPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name) // nosemgrep
        const resolvedFullPath = path.resolve(fullPath)

        // SECURITY: Ensure resolved path is still within root directory
        const relFile = path.relative(rootDir, resolvedFullPath)
        if (relFile.startsWith('..') || path.isAbsolute(relFile)) {
          console.warn(`[ARCHIVE] Skipping path outside root directory: ${fullPath}`)
          continue
        }

        if (entry.isDirectory()) {
          await scanDir(fullPath)
        } else if (entry.isFile() && this.isImageFile(entry.name)) {
          const stats = await fs.stat(fullPath)
          files.push({
            originalName: path.relative(dirPath, fullPath),
            extractedPath: fullPath,
            size: stats.size,
          })
        }
      }
    }

    await scanDir(dirPath)
    return files
  }

  /**
   * Check if file is an image
   * @param {string} fileName - File name or path
   * @returns {boolean} True if image file
   */
  isImageFile(fileName) {
    const ext = path.extname(fileName).toLowerCase()
    return this.imageExtensions.includes(ext)
  }

  /**
   * Process archive and extract images
   * @param {string} archivePath - Path to archive file
   * @param {string} repositoryPath - Path to repository for extraction
   * @param {Function} progressCallback - Progress callback (processed, total)
   * @param {boolean} forceReprocess - Force reprocessing even if already processed
   * @returns {Promise<Object>} Processing result
   */
  async processArchive(archivePath, repositoryPath, progressCallback, forceReprocess = false) {
    console.log(`[ARCHIVE] Processing archive: ${archivePath}`)

    // Check if already processed
    const isProcessed = await this.isArchiveProcessed(archivePath)
    if (isProcessed && !forceReprocess) {
      // Return information about the previously processed archive
      const hash = await this.calculateFileHash(archivePath)
      const db = await this.loadArchivesDb()
      const existingArchive = db.archives[hash]

      return {
        alreadyProcessed: true,
        metadata: existingArchive,
        extractedFiles: existingArchive.extractedFiles || [],
      }
    }

    // Get archive metadata
    const metadata = await this.getArchiveMetadata(archivePath)
    console.log(
      `[ARCHIVE] Archive type: ${metadata.type}, size: ${(metadata.size / 1024 / 1024).toFixed(2)}MB`
    )

    // Create extraction directory in repository
    const archiveName = path.basename(archivePath, path.extname(archivePath))
    const sanitizedName = archiveName.replace(/[^a-zA-Z0-9\-_]/g, '_')
    const extractDir = path.join(repositoryPath, sanitizedName)
    await fs.mkdir(extractDir, { recursive: true })

    let extractedFiles = []

    try {
      // Extract based on type
      switch (metadata.type) {
        case 'zip':
          extractedFiles = await this.extractZip(archivePath, extractDir, progressCallback)
          break
        case 'rar':
          extractedFiles = await this.extractRar(archivePath, extractDir, progressCallback)
          break
        case '7z':
          extractedFiles = await this.extract7z(archivePath, extractDir, progressCallback)
          break
        default:
          throw new Error(`Unsupported archive type: ${metadata.type}`)
      }

      console.log(`[ARCHIVE] Extracted ${extractedFiles.length} image files`)

      // Store archive metadata
      const db = await this.loadArchivesDb()
      db.archives[metadata.hash] = {
        ...metadata,
        extractedFiles: extractedFiles,
        extractDir,
        extractedAt: Date.now(),
      }
      await this.saveArchivesDb(db)

      return {
        metadata,
        extractedFiles,
        extractDir,
      }
    } catch (error) {
      // Cleanup on error
      try {
        await fs.rm(extractDir, { recursive: true, force: true })
      } catch (cleanupError) {
        console.warn('[ARCHIVE] Failed to cleanup extraction directory:', cleanupError.message)
      }
      throw error
    }
  }

  /**
   * Clean up old extraction directories
   * @param {number} maxAgeHours - Maximum age in hours (default 24)
   */
  async cleanupOldExtractions(maxAgeHours = 24) {
    try {
      const db = await this.loadArchivesDb()
      const cutoffTime = Date.now() - maxAgeHours * 60 * 60 * 1000

      let cleanedCount = 0
      for (const [hash, archive] of Object.entries(db.archives)) {
        if (archive.extractedAt && archive.extractedAt < cutoffTime) {
          try {
            // SECURITY: Validate that extractDir is within our temp directory
            const resolvedExtractDir = path.resolve(archive.extractDir)
            const resolvedTempDir = path.resolve(this.tempDir)

            const rel = path.relative(resolvedTempDir, resolvedExtractDir)
            if (rel.startsWith('..') || path.isAbsolute(rel)) {
              console.warn(
                `[ARCHIVE] Skipping cleanup of directory outside temp area: ${archive.extractDir}`
              )
              delete db.archives[hash]
              cleanedCount++
              continue
            }

            await fs.access(archive.extractDir)
            await fs.rm(archive.extractDir, { recursive: true, force: true })
            delete db.archives[hash]
            cleanedCount++
          } catch (_error) {
            // Directory might already be gone, just remove from DB
            delete db.archives[hash]
            cleanedCount++
          }
        }
      }

      db.lastCleanup = Date.now()
      await this.saveArchivesDb(db)

      if (cleanedCount > 0) {
        console.log(`[ARCHIVE] Cleaned up ${cleanedCount} old extractions`)
      }
    } catch (error) {
      console.warn('[ARCHIVE] Cleanup failed:', error.message)
    }
  }

  /**
   * Get list of processed archives
   * @returns {Promise<Array>} List of archives
   */
  async getProcessedArchives() {
    const db = await this.loadArchivesDb()
    return Object.values(db.archives)
  }
}

module.exports = new ArchiveService()
