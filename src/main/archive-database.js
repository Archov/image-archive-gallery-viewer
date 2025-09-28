/**
 * Archive Database - Handles archive metadata and database operations
 */
const fs = require('node:fs').promises
const fsNative = require('node:fs')
const crypto = require('node:crypto')
const path = require('node:path')
const secureFs = require('./secure-fs')
const archiveExtractors = require('./archive-extractors')

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
      const sanitized = secureFs.sanitizeFilePath(filePath)
      const stream = fsNative.createReadStream(sanitized)

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
   * @param {string} precomputedHash - Optional precomputed hash to avoid double calculation
   * @returns {Promise<Object>} Archive metadata
   */
  async getArchiveMetadata(filePath, precomputedHash) {
    const stats = await secureFs.stat(filePath)
    const hash = precomputedHash ?? (await this.calculateFileHash(filePath))

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
   * Get archive by hash (efficient single record lookup)
   * @param {string} hash - Archive hash
   * @returns {Promise<Object|null>} Archive metadata or null if not found
   */
  async getArchiveByHash(hash) {
    try {
      const db = await this.loadArchivesDb()
      return db.archives[hash] || null
    } catch (error) {
      console.warn('[ARCHIVE] Could not get archive by hash:', error.message)
      return null
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
