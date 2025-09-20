const fs = require('fs').promises;
const { getDatabase } = require('./databaseService');

async function cleanupExtractedImages(maxAgeMinutes = 30) {
  const database = getDatabase();
  const archives = Object.values(database.archives);
  const maxAge = maxAgeMinutes * 60 * 1000;
  const now = Date.now();

  for (const archive of archives) {
    if (!archive.extractedImages) continue;

    for (const imageMeta of archive.extractedImages) {
      const image = database.images[imageMeta.id];
      if (!image) continue;

      try {
        const stat = await fs.stat(image.path);
        const age = now - stat.mtime.getTime();

        if (age > maxAge) {
          await fs.unlink(image.path);
        }
      } catch (error) {
        // File does not exist or cannot be accessed; ignore
      }
    }
  }
}

module.exports = {
  cleanupExtractedImages
};
