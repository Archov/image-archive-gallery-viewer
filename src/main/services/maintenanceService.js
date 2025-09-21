const os = require('os');
const path = require('path');
const fs = require('fs').promises;

const TEMP_BASE_DIR_NAME = 'kemono-gallery';
const getTempBaseDir = () => path.join(os.tmpdir(), TEMP_BASE_DIR_NAME);

function parseMaxAgeMinutes(input, fallback) {
  const n = Number(input);
  return Number.isFinite(n) && n >= 0 ? n * 60 * 1000 : fallback * 60 * 1000;
}

/**
 * Cleans up old temp extraction directories.
 * Each session creates a temp directory that should be cleaned up after use.
 */
async function cleanupExtractedImages(maxAgeMinutes = 30) {
  const tempBaseDir = getTempBaseDir();
  const maxAge = parseMaxAgeMinutes(maxAgeMinutes, 30);
  const now = Date.now();

  try {
    // Check if the temp base directory exists
    const exists = await fs.access(tempBaseDir).then(() => true).catch(() => false);
    if (!exists) {
      return; // Nothing to cleanup
    }

    const entries = await fs.readdir(tempBaseDir, { withFileTypes: true });
    const baseReal = await fs.realpath(tempBaseDir);
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const sessionDir = path.join(tempBaseDir, entry.name);
      
      try {
        const lst = await fs.lstat(sessionDir);
        if (lst.isSymbolicLink()) {
          console.warn(`Skipping symlink in temp dir: ${sessionDir}`);
          continue;
        }
        const resolved = await fs.realpath(sessionDir);
        const rel = path.relative(baseReal, resolved);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          console.warn(`Skipping path outside temp base: ${resolved}`);
          continue;
        }
        const age = now - lst.mtimeMs;
        
        if (age > maxAge) {
          await fs.rm(resolved, { recursive: true, force: true });
          console.log(`Cleaned up old temp session directory: ${resolved}`);
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
  const tempBaseDir = getTempBaseDir();
  
  try {
    const exists = await fs.access(tempBaseDir).then(() => true).catch(() => false);
    if (exists) {
      const tmpReal = await fs.realpath(os.tmpdir());
      const baseReal = await fs.realpath(tempBaseDir).catch(() => null);
      if (!baseReal) {
        console.warn(`Refusing to delete non-tmp path: ${tempBaseDir}`);
        return;
      }
      const rel = path.relative(tmpReal, baseReal);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        console.warn(`Refusing to delete non-tmp path: ${tempBaseDir}`);
        return;
      }
      const st = await fs.lstat(baseReal);
      if (st.isSymbolicLink()) {
        console.warn(`Refusing to delete symlink base dir: ${baseReal}`);
        return;
      }
      await fs.rm(baseReal, { recursive: true, force: true });
      console.log(`Cleaned up all temp extraction directories: ${baseReal}`);
    }
  } catch (error) {
    console.warn('Failed to cleanup all temp directories:', error.message);
  }
}

/**
 * Cleans up archive metadata temp directories.
 * These are created by archiveService for metadata extraction.
 */
async function cleanupArchiveMetadataDirs(maxAgeMinutes = 120) {
  const tempDir = os.tmpdir();
  const maxAge = parseMaxAgeMinutes(maxAgeMinutes, 120);
  const now = Date.now();

  try {
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('archive-metadata-')) continue;
      
      const metadataDir = path.join(tempDir, entry.name);
      
      try {
        const stat = await fs.stat(metadataDir);
        const age = now - stat.mtime.getTime();
        
        if (age > maxAge) {
          await fs.rm(metadataDir, { recursive: true, force: true });
          console.log(`Cleaned up old archive metadata directory: ${metadataDir}`);
        }
      } catch (error) {
        // Directory might be in use or already deleted, ignore
        console.warn(`Failed to cleanup metadata directory ${metadataDir}:`, error.message);
      }
    }
  } catch (error) {
    console.warn('Failed to cleanup archive metadata directories:', error.message);
  }
}

module.exports = {
  cleanupExtractedImages,
  cleanupAllTempDirectories,
  cleanupArchiveMetadataDirs
};