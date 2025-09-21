const os = require('os');
const path = require('path');
const fs = require('fs').promises;

async function cleanupExtractedImages(maxAgeMinutes = 30) {
  const tempDir = os.tmpdir();
  const maxAge = maxAgeMinutes * 60 * 1000;

  try {
    // Clean up old temp directories used by the app
    const items = await fs.readdir(tempDir);

    for (const item of items) {
      const itemPath = path.join(tempDir, item);

      if (item.startsWith('archive-image-') || item.startsWith('archive-metadata-')) {
        try {
          const stat = await fs.stat(itemPath);

          if (stat.isDirectory() && Date.now() - stat.mtime.getTime() > maxAge) {
            await fs.rm(itemPath, { recursive: true, force: true });
            console.log(`Cleaned up old temp directory: ${itemPath}`);
          }
        } catch (error) {
          // Directory does not exist or cannot be accessed; ignore
        }
      }
    }
  } catch (error) {
    console.error('Failed to cleanup temp directories:', error);
  }
}

module.exports = {
  cleanupExtractedImages
};
