/**
 * File Scanner - Handles directory scanning and file filtering utilities
 */
class FileScanner {
  constructor() {
    this.imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg']
  }

  /**
   * Scan directory for image files
   * @param {string} dirPath - Directory to scan
   * @returns {Promise<Array>} List of image files
   */
  async scanDirectoryForImages(dirPath) {
    const fs = require('node:fs').promises
    const path = require('node:path')
    const secureFs = require('./secure-fs')

    const files = []
    const rootDir = path.resolve(dirPath) // Canonical root directory

    const scanDir = async (currentPath) => {
      // SECURITY: Validate that currentPath is within the root directory
      const resolvedPath = path.resolve(currentPath)
      const rel = path.relative(rootDir, resolvedPath)
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Path traversal attempt detected: ${currentPath}`)
      }

      const entries = await secureFs.readdir(currentPath, { withFileTypes: true })

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
    const path = require('node:path')
    const ext = path.extname(fileName).toLowerCase()
    return this.imageExtensions.includes(ext)
  }
}

module.exports = new FileScanner()
