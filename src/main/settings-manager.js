/**
 * Settings Manager - Handles settings dialog and configuration management
 */
class SettingsManager {
  constructor() {
    this.appConfig = null
    this.secureFs = null
  }

  setDependencies(appConfig, secureFs) {
    this.appConfig = appConfig
    this.secureFs = secureFs
  }

  async openSettingsDialog(mainWindow) {
    if (!mainWindow) return

    const config = { ...this.appConfig }

    // Show current configuration
    const { dialog } = require('electron')
    const infoResult = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Image Gallery Settings',
      message: 'Current Configuration',
      detail: `Image Repository: ${config.imageRepositoryPath || 'Not set'}\n\nMax File Size: ${config.maxFileSizeMB}MB`,
      buttons: ['Change Repository', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    })

    if (infoResult.response === 0) {
      await this.changeRepository(mainWindow)
    }
  }

  async changeRepository(mainWindow) {
    const { dialog } = require('electron')
    const path = require('node:path')
    const fs = require('node:fs').promises

    const config = { ...this.appConfig }

    // User wants to change repository - open directory picker
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Image Repository Directory',
      properties: ['openDirectory', 'createDirectory'],
      message: 'Choose where to store your extracted images and archives',
    })

    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0]

      // Check if we have existing processed archives that need migration
      const archiveService = require('./archive-service')
      const existingArchives = await this.checkForExistingArchives(archiveService)

      // Check if we need to migrate from an existing repository or from temp
      const oldRepositoryPath = config.imageRepositoryPath

      // Check if any archives are still in temp directories (need migration)
      const tempDir = path.join(require('electron').app.getPath('temp'), 'gallery-extraction')
      const tempArchives = existingArchives.filter((archive) => {
        if (!archive.extractDir) return false
        try {
          const rel = path.relative(tempDir, archive.extractDir)
          return rel && !rel.startsWith('..')
        } catch {
          return false
        }
      })
      const hasTempArchives = tempArchives.length > 0

      const needsMigration =
        (oldRepositoryPath &&
          path.resolve(oldRepositoryPath) !== path.resolve(selectedPath) &&
          (() => {
            try {
              const rel = path.relative(path.resolve(oldRepositoryPath), path.resolve(selectedPath))
              return !(rel && !rel.startsWith('..'))
            } catch {
              return true
            }
          })()) ||
        hasTempArchives

      let shouldMigrate = false

      if (needsMigration) {
        // Confirm migration with user
        const migrationResult = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          title: 'Migrate Existing Content?',
          message: 'Repository Location Changed',
          detail: hasTempArchives
            ? `You have ${tempArchives.length} processed archive(s) stored in temporary directories.\n\nWould you like to copy all existing images and archives to the new repository location?`
            : `You have an existing repository at:\n${oldRepositoryPath}\n\nWould you like to copy all existing images and archives to the new location?`,
          buttons: ['Migrate Content', 'Start Fresh', 'Cancel'],
          defaultId: 0,
          cancelId: 2,
        })

        if (migrationResult.response === 2) {
          // User canceled
          return
        }

        shouldMigrate = migrationResult.response === 0

        if (shouldMigrate) {
          // Show migration progress
          await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Migration Starting',
            message: 'Content Migration',
            detail:
              'Please wait while your existing content is migrated to the new repository location...',
          })

          // Perform migration
          const repositoryManager = require('./repository-manager')
          let migrationSuccess = true
          // 1) Migrate old repository structure (if applicable)
          if (oldRepositoryPath && path.resolve(oldRepositoryPath) !== path.resolve(selectedPath)) {
            const ok = await repositoryManager.migrateRepositoryContent(
              oldRepositoryPath,
              selectedPath,
              null
            )
            migrationSuccess = migrationSuccess && ok
          }
          // 2) Migrate temp archives (if any)
          if (hasTempArchives) {
            const ok = await repositoryManager.migrateRepositoryContent(
              null,
              selectedPath,
              tempArchives
            )
            migrationSuccess = migrationSuccess && ok
          }
          if (!migrationSuccess) {
            // Migration failed, ask user what to do
            const failureResult = await dialog.showMessageBox(mainWindow, {
              type: 'error',
              title: 'Migration Failed',
              message: 'Content Migration Error',
              detail:
                'Failed to migrate existing content to the new repository location. You can try again later or continue with the empty repository.',
              buttons: ['Continue Anyway', 'Cancel'],
              defaultId: 0,
              cancelId: 1,
            })

            if (failureResult.response === 1) {
              // User canceled due to migration failure
              return
            }
          }
        }
      }

      // Update config with new path (normalized to absolute)
      this.appConfig.imageRepositoryPath = path.resolve(selectedPath)

      // Save to config file
      try {
        const { app } = require('electron')
        const userDataDir = app.getPath('userData')
        const configPath = path.join(userDataDir, 'config.json')
        await fs.writeFile(configPath, JSON.stringify(this.appConfig, null, 2))
        console.log('[CONFIG] Saved image repository path:', selectedPath)

        // Update secure-fs with the new allowed directory
        this.secureFs.addAllowedDirectory(selectedPath)

        // Show success message
        const successMessage = needsMigration
          ? `Repository location updated successfully.\n\n${shouldMigrate ? 'Existing content has been migrated.' : 'Starting with empty repository.'}`
          : 'Repository location updated successfully.'

        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Settings Updated',
          message: 'Repository Location Changed',
          detail: `New location: ${selectedPath}\n\n${successMessage}\n\nThe app will use this location for storing downloaded and extracted images.`,
        })
      } catch (error) {
        console.error('[CONFIG] Failed to save config:', error)
        dialog.showErrorBox('Settings Error', `Failed to save configuration: ${error.message}`)
      }
    }
  }

  async checkForExistingArchives(archiveService) {
    try {
      const archives = await archiveService.getProcessedArchives()
      return archives || []
    } catch (error) {
      console.error('[SETTINGS] Failed to check for existing archives:', error)
      return []
    }
  }
}

module.exports = new SettingsManager()
