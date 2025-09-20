const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * Cleans up old temp extraction directories.
 * Each session creates a temp directory that should be cleaned up after use.
 */
async function cleanupExtractedImages(maxAgeMinutes = 30) {
  const tempBaseDir = path.join(os.tmpdir(), 'kemono-gallery');
  const maxAge = maxAgeMinutes * 60 * 1000;
  const now = Date.now();

  try {
    // Check if the temp base directory exists
    const exists = await fs.access(tempBaseDir).then(() => true).catch(() => false);
    if (!exists) {
      return; // Nothing to cleanup
    }

    const entries = await fs.readdir(tempBaseDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const sessionDir = path.join(tempBaseDir, entry.name);
      
      try {
        const stat = await fs.stat(sessionDir);
        const age = now - stat.mtime.getTime();
        
        if (age > maxAge) {
          await fs.rm(sessionDir, { recursive: true, force: true });
          console.log(`Cleaned up old temp session directory: ${sessionDir}`);
        }
      } catch (error) {
        // Directory might be in use or already deleted, ignore
        console.warn(`Failed to cleanup temp directory ${sessionDir}:`, error.message);
      }
    }
  } catch (error) {
    console.warn('Failed to cleanup extracted images:', error.message);
  }
}

/**
 * Cleans up all temp extraction directories immediately.
 * Useful for app shutdown or manual cleanup.
 */
async function cleanupAllTempDirectories() {
  const tempBaseDir = path.join(os.tmpdir(), 'kemono-gallery');
  
  try {
    const exists = await fs.access(tempBaseDir).then(() => true).catch(() => false);
    if (exists) {
      await fs.rm(tempBaseDir, { recursive: true, force: true });
      console.log(`Cleaned up all temp extraction directories: ${tempBaseDir}`);
    }
  } catch (error) {
    console.warn('Failed to cleanup all temp directories:', error.message);
  }
}

module.exports = {
  cleanupExtractedImages,
  cleanupAllTempDirectories
};