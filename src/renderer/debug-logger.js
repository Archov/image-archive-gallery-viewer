/**
 * Debug Logger - Handles debug logging and synchronization with main process
 */
class DebugLogger {
  constructor() {
    this.debugLogs = []
    this.logSyncInterval = null
    this.MAX_DEBUG_LOG_LINES = 5000
  }

  setupDebugCapture() {
    const originalLog = console.log
    const originalError = console.error
    const originalWarn = console.warn

    console.log = (...args) => {
      const message = args
        .map((arg) => {
          try {
            return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
          } catch {
            return String(arg)
          }
        })
        .join(' ')
      this.debugLogs.push(`[LOG ${new Date().toISOString()}] ${message}`)
      if (this.debugLogs.length > this.MAX_DEBUG_LOG_LINES) this.debugLogs.shift()
      originalLog.apply(console, args)
    }

    console.error = (...args) => {
      const message = args
        .map((arg) => {
          try {
            return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
          } catch {
            return String(arg)
          }
        })
        .join(' ')
      this.debugLogs.push(`[ERROR ${new Date().toISOString()}] ${message}`)
      if (this.debugLogs.length > this.MAX_DEBUG_LOG_LINES) this.debugLogs.shift()
      originalError.apply(console, args)
    }

    console.warn = (...args) => {
      const message = args
        .map((arg) => {
          try {
            return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
          } catch {
            return String(arg)
          }
        })
        .join(' ')
      this.debugLogs.push(`[WARN ${new Date().toISOString()}] ${message}`)
      if (this.debugLogs.length > this.MAX_DEBUG_LOG_LINES) this.debugLogs.shift()
      originalWarn.apply(console, args)
    }
  }

  setupAutoLogSync() {
    // Sync logs every 30 seconds
    this.logSyncInterval = setInterval(() => {
      this.syncLogsToMain()
    }, 30000)

    // Sync logs before page unload
    window.addEventListener('beforeunload', () => {
      this.syncLogsToMain()
    })

    // Sync logs when app becomes hidden (minimized, etc.)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.syncLogsToMain()
      }
    })
  }

  async syncLogsToMain() {
    if (this.debugLogs.length > 0) {
      // Snapshot logs to prevent loss during async operation
      const logsToSend = this.debugLogs.splice(0, this.debugLogs.length)
      try {
        await window.electronAPI.appendRendererLogs(logsToSend)
        // Avoid logging here; the wrapped console would re-queue this message and trigger needless syncs.
      } catch (error) {
        // Restore logs if sync failed
        this.debugLogs = logsToSend.concat(this.debugLogs)
        console.error('[ERROR] Failed to sync logs to main process:', error)
      }
    }
  }

  async exportDebugLogs() {
    // Legacy method - now just triggers immediate sync
    await this.syncLogsToMain()
    console.log('[DEBUG] Logs synced to main process debug file')
  }

  cleanup() {
    if (this.logSyncInterval) {
      clearInterval(this.logSyncInterval)
      this.logSyncInterval = null
    }
  }
}

// Export singleton instance to global scope
window.DebugLogger = new DebugLogger()
