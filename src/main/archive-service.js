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
const path = require('node:path')
const fs = require('node:fs').promises
const archiveExtractors = require('./archive-extractors')
const archiveDatabase = require('./archive-database')
const fileScanner = require('./file-scanner')

class ArchiveService {
  constructor() {
    this.tempDir = null
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
    const archivesDbPath = path.join(resolvedUserData, 'archives.json') // nosemgrep

    // Set database path for archive database module
    archiveDatabase.setDbPath(archivesDbPath)

    // Ensure temp directory exists
    try {
      await fs.mkdir(this.tempDir, { recursive: true })
    } catch (error) {
      console.warn('[ARCHIVE] Could not create temp directory:', error.message)
    }

    // Initialize archives database
    await archiveDatabase.initializeArchivesDb()
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
    const { isProcessed, hash } = await archiveDatabase.isArchiveProcessed(archivePath)
    if (isProcessed && !forceReprocess) {
      // Return information about the previously processed archive
      const db = await archiveDatabase.loadArchivesDb()
      const existingArchive = db.archives[hash]

      return {
        alreadyProcessed: true,
        metadata: existingArchive,
        extractedFiles: existingArchive.extractedFiles || [],
      }
    }

    // Get archive metadata
    const metadata = await archiveDatabase.getArchiveMetadata(archivePath)
    console.log(
      `[ARCHIVE] Archive type: ${metadata.type}, size: ${(metadata.size / 1024 / 1024).toFixed(2)}MB`
    )

    // Create extraction directory in repository
    const archiveName = path.basename(archivePath, path.extname(archivePath))
    const sanitizedName = archiveName.replace(/[^a-zA-Z0-9\-_]/g, '_')
    // Add first 8 chars of hash to prevent collisions
    const hashPrefix = metadata.hash.substring(0, 8)
    const extractDir = path.join(repositoryPath, `${sanitizedName}_${hashPrefix}`)
    await fs.mkdir(extractDir, { recursive: true })

    let extractedFiles = []

    try {
      // Extract based on type
      switch (metadata.type) {
        case 'zip':
          extractedFiles = await archiveExtractors.extractZip(
            archivePath,
            extractDir,
            progressCallback
          )
          break
        case 'rar':
          extractedFiles = await archiveExtractors.extractRar(
            archivePath,
            extractDir,
            progressCallback
          )
          break
        case '7z':
          extractedFiles = await archiveExtractors.extract7z(
            archivePath,
            extractDir,
            progressCallback
          )
          break
        default:
          throw new Error(`Unsupported archive type: ${metadata.type}`)
      }

      console.log(`[ARCHIVE] Extracted ${extractedFiles.length} image files`)

      // Store archive metadata
      const db = await archiveDatabase.loadArchivesDb()
      db.archives[metadata.hash] = {
        ...metadata,
        extractedFiles: extractedFiles,
        extractDir,
        extractedAt: Date.now(),
      }
      await archiveDatabase.saveArchivesDb(db)

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
   * Load archives database
   */
  async loadArchivesDb() {
    return await archiveDatabase.loadArchivesDb()
  }

  /**
   * Save archives database
   */
  async saveArchivesDb(db) {
    return await archiveDatabase.saveArchivesDb(db)
  }

  /**
   * Get list of processed archives
   * @returns {Promise<Array>} List of archives
   */
  async getProcessedArchives() {
    return await archiveDatabase.getProcessedArchives()
  }

  /**
   * Scan directory for images (delegate to file scanner)
   */
  async scanDirectoryForImages(dirPath) {
    return await fileScanner.scanDirectoryForImages(dirPath)
  }
}

module.exports = new ArchiveService()
