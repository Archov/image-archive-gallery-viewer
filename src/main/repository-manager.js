/**
 * Repository Manager - Handles repository migration and management
 */
class RepositoryManager {
  async migrateRepositoryContent(oldPath, newPath, existingArchives = null) {
    const path = require('node:path')
    const fs = require('node:fs').promises

    try {
      console.log('[MIGRATION] Starting repository migration')
      console.log(`[MIGRATION] From: ${oldPath}`)
      console.log(`[MIGRATION] To: ${newPath}`)

      // Create new directory if it doesn't exist
      await fs.mkdir(newPath, { recursive: true })

      if (oldPath) {
        // Traditional migration from old repository path
        let oldStats
        try {
          oldStats = await fs.stat(oldPath)
        } catch (_error) {
          console.log('[MIGRATION] Old repository path does not exist or is not accessible')
          return true // Not an error, just nothing to migrate
        }

        if (!oldStats.isDirectory()) {
          console.log('[MIGRATION] Old repository path is not a directory')
          return true
        }

        // Get list of items to migrate
        const items = await fs.readdir(oldPath)
        if (items.length === 0) {
          console.log('[MIGRATION] Old repository is empty, nothing to migrate')
          return true
        }

        console.log(`[MIGRATION] Found ${items.length} items to migrate from ${oldPath}`)

        // Copy each item recursively
        for (const item of items) {
          const oldItemPath = path.join(oldPath, item)
          const newItemPath = path.join(newPath, item)

          try {
            await this.copyDirectoryRecursive(oldItemPath, newItemPath)
            console.log(`[MIGRATION] Migrated: ${item}`)
          } catch (error) {
            console.error('[MIGRATION] Failed to migrate:', item, error.message)
            // Continue with other items rather than failing completely
          }
        }
      } else {
        // Migration from temp directories based on processed archives
        if (!existingArchives || existingArchives.length === 0) {
          console.log('[MIGRATION] No archives to migrate from temp directories')
          return true
        }

        console.log(
          `[MIGRATION] Migrating ${existingArchives.length} archives from temp directories`
        )

        // Migrate each archive's extract directory
        for (const archive of existingArchives) {
          if (archive.extractDir) {
            try {
              // Create archive-specific subdirectory in new repository
              const baseName = (archive.name || 'archive').replace(/[^a-zA-Z0-9\-_]/g, '_')
              const unique = archive.hash ? `-${archive.hash.slice(0, 8)}` : ''
              const newArchiveDir = path.join(newPath, `${baseName}${unique}`)

              // Copy the entire extract directory
              await this.copyDirectoryRecursive(archive.extractDir, newArchiveDir)
              console.log(`[MIGRATION] Migrated archive: ${archive.name}`)

              // Update the archive's extractDir path for database
              archive.extractDir = newArchiveDir
            } catch (error) {
              console.error('[MIGRATION] Failed to migrate archive:', archive.name, error.message)
              // Continue with other archives
            }
          }
        }
      }

      // Update processed archives database with new paths
      await this.updateProcessedArchivesPaths(oldPath, newPath, existingArchives)

      console.log('[MIGRATION] Repository migration completed successfully')
      return true
    } catch (error) {
      console.error('[MIGRATION] Repository migration failed:', error)
      return false
    }
  }

  async copyDirectoryRecursive(src, dest) {
    const fs = require('node:fs').promises
    const path = require('node:path')

    const stats = await fs.lstat(src)

    if (stats.isSymbolicLink()) {
      // Skip symlinks for security
      console.warn(`[MIGRATION] Skipping symlink: ${src}`)
      return
    }

    if (stats.isDirectory()) {
      await fs.mkdir(dest, { recursive: true })
      const items = await fs.readdir(src)

      for (const item of items) {
        const srcPath = path.join(src, item)
        const destPath = path.join(dest, item)
        await this.copyDirectoryRecursive(srcPath, destPath)
      }
    } else {
      // Copy file
      await fs.copyFile(src, dest)
    }
  }

  async updateProcessedArchivesPaths(oldPath, newPath, existingArchives = null) {
    const path = require('node:path')
    const archiveService = require('./archive-service')

    try {
      // Load the database directly
      const db = await archiveService.loadArchivesDb()

      if (oldPath) {
        // Traditional migration - update paths in database
        for (const [hash, archive] of Object.entries(db.archives)) {
          let needsUpdate = false
          const updatedArchive = { ...archive }

          // Update extractDir if it was in the old repository
          if (archive.extractDir) {
            try {
              const rel = path.relative(oldPath, archive.extractDir)
              if (!rel.startsWith('..')) {
                const newExtractDir = path.join(newPath, rel) // rel may be '' => newPath
                if (newExtractDir !== archive.extractDir) {
                  updatedArchive.extractDir = newExtractDir
                  needsUpdate = true
                }
              }
            } catch (_error) {
              // Path comparison failed, skip
            }
          }

          // Update extractedFiles paths
          if (archive.extractedFiles && Array.isArray(archive.extractedFiles)) {
            const updatedFiles = archive.extractedFiles.map((file) => {
              if (file.extractedPath) {
                try {
                  const rel = path.relative(oldPath, file.extractedPath)
                  if (!rel.startsWith('..')) {
                    const newPathExtracted = path.join(newPath, rel)
                    if (newPathExtracted !== file.extractedPath) {
                      return {
                        ...file,
                        extractedPath: newPathExtracted,
                      }
                    }
                  }
                } catch (_error) {
                  // Path comparison failed, keep original
                }
              }
              return file
            })

            // Only update if files actually changed
            if (JSON.stringify(updatedFiles) !== JSON.stringify(archive.extractedFiles)) {
              updatedArchive.extractedFiles = updatedFiles
              needsUpdate = true
            }
          }

          // Update the database if needed
          if (needsUpdate) {
            db.archives[hash] = updatedArchive
            console.log(`[MIGRATION] Updated paths for archive: ${archive.name}`)
          }
        }
      } else if (existingArchives) {
        // Temp directory migration - update with new paths from migration
        for (const migratedArchive of existingArchives) {
          const hash = migratedArchive.hash
          if (db.archives[hash] && migratedArchive.extractDir) {
            // Update the extractDir in the database
            db.archives[hash] = {
              ...db.archives[hash],
              extractDir: migratedArchive.extractDir,
            }

            // Update extractedFiles paths if they exist
            if (
              db.archives[hash].extractedFiles &&
              Array.isArray(db.archives[hash].extractedFiles)
            ) {
              const oldExtractDir = db.archives[hash].extractedFiles[0]?.extractedPath
                ? path.dirname(db.archives[hash].extractedFiles[0].extractedPath)
                : null
              if (oldExtractDir) {
                db.archives[hash].extractedFiles = db.archives[hash].extractedFiles.map((file) => {
                  try {
                    const rel = path.relative(oldExtractDir, file.extractedPath)
                    if (!rel.startsWith('..')) {
                      return {
                        ...file,
                        extractedPath: path.join(migratedArchive.extractDir, rel),
                      }
                    }
                  } catch (_error) {
                    // Path comparison failed, keep original
                  }
                  return file
                })
              }
            }

            console.log(`[MIGRATION] Updated database for archive: ${db.archives[hash].name}`)
          }
        }
      }

      // Save the updated database
      await archiveService.saveArchivesDb(db)
      console.log('[MIGRATION] Processed archives database updated')
    } catch (error) {
      console.error('[MIGRATION] Failed to update processed archives database:', error)
      // Don't fail the migration for this - the files are copied, just the DB refs are wrong
    }
  }
}

module.exports = new RepositoryManager()
