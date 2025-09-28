/**
 * Archive Database - Handles archive metadata and database operations
 */
class ArchiveDatabase {
  constructor() {
    this.archivesDbPath = null
  }

  setDbPath(dbPath) {
    this.archivesDbPath = dbPath
  }

  /**
   * Initialize archives database file
   */
  async initializeArchivesDb() {
    const fs = require('node:fs').promises

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
    const fs = require('node:fs').promises

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
    const fs = require('node:fs').promises

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
    const crypto = require('node:crypto')
    const secureFs = require('./secure-fs')

    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256')
      const sanitized = secureFs.sanitizeFilePath(filePath)
      const stream = require('node:fs').createReadStream(sanitized)

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
   * @returns {Promise<Object>} Object with isProcessed boolean and hash string
   */
  async isArchiveProcessed(filePath) {
    try {
      const hash = await this.calculateFileHash(filePath)
      const db = await this.loadArchivesDb()
      return { isProcessed: hash in db.archives, hash }
    } catch (error) {
      console.warn('[ARCHIVE] Could not check archive status:', error.message)
      return { isProcessed: false, hash: null }
    }
  }

  /**
   * Get archive metadata
   * @param {string} filePath - Archive file path
   * @returns {Promise<Object>} Archive metadata
   */
  async getArchiveMetadata(filePath) {
    const secureFs = require('./secure-fs')
    const path = require('node:path')
    const archiveExtractors = require('./archive-extractors')

    const stats = await secureFs.stat(filePath)
    const hash = await this.calculateFileHash(filePath)

    return {
      hash,
      path: filePath,
      name: path.basename(filePath),
      size: stats.size,
      mtime: stats.mtime.getTime(),
      type: archiveExtractors.getArchiveType(filePath),
      processedAt: Date.now(),
    }
  }

  /**
   * Clean up old extraction directories
   * @param {number} maxAgeHours - Maximum age in hours (default 24)
   */
  async cleanupOldExtractions(maxAgeHours = 24) {
    const secureFs = require('./secure-fs')
    const fs = require('node:fs').promises
    const fsNative = require('node:fs')
    const path = require('node:path')

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
              continue
            }

            await secureFs.access(archive.extractDir, fsNative.constants.R_OK)
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

module.exports = new ArchiveDatabase()
