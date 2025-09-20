const fs = require('fs').promises;
const { getDatabase, saveDatabase } = require('./databaseService');

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    return false;
  }
}

async function removeDirectory(targetPath) {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function manageCache(maxSizeBytes) {
  const database = getDatabase();
  const cacheInfo = await getCacheUsage();

  console.log(`Cache management: current=${(cacheInfo.totalSize / (1024 * 1024 * 1024)).toFixed(2)}GB, limit=${(maxSizeBytes / (1024 * 1024 * 1024)).toFixed(2)}GB`);

  if (cacheInfo.totalSize <= maxSizeBytes) {
    console.log('Cache within limits, no cleanup needed');
    return;
  }

  const candidates = Object.values(database.archives)
    .filter(archive => !archive.starred)
    .sort((a, b) => new Date(b.lastAccessed) - new Date(a.lastAccessed));

  if (candidates.length === 0) {
    return;
  }

  const currentArchive = candidates[0];
  const archivesToClean = candidates.slice(1);

  const currentSize = isNaN(currentArchive.size) ? 0 : (currentArchive.size || 0);
  let cacheSizeExcludingCurrent = cacheInfo.totalSize - currentSize;

  if (cacheSizeExcludingCurrent <= maxSizeBytes) {
    return;
  }

  let freedSpace = 0;
  const spaceNeeded = cacheSizeExcludingCurrent - maxSizeBytes;

  for (const archive of archivesToClean) {
    if (freedSpace >= spaceNeeded) break;

    try {
      if (archive.archivePath && await exists(archive.archivePath)) {
        await fs.unlink(archive.archivePath);
      }
      if (archive.cachePath) {
        await removeDirectory(archive.cachePath);
      }

      delete database.archives[archive.id];

      Object.keys(database.images).forEach(imageId => {
        if (database.images[imageId].archiveId === archive.id) {
          delete database.images[imageId];
        }
      });

      freedSpace += isNaN(archive.size) ? 0 : (archive.size || 0);
    } catch (error) {
      console.warn(`Failed to clean up archive ${archive.id}:`, error);
    }
  }

  await saveDatabase();
}

async function clearCache() {
  const database = getDatabase();
  const archives = Object.values(database.archives).filter(archive => !archive.starred);

  console.log(`Clearing cache: ${archives.length} non-starred archives`);

  for (const archive of archives) {
    try {
      if (archive.archivePath && await exists(archive.archivePath)) {
        await fs.unlink(archive.archivePath);
        console.log(`Deleted archive file: ${archive.archivePath}`);
      }
      if (archive.cachePath) {
        await removeDirectory(archive.cachePath);
        console.log(`Deleted cache directory: ${archive.cachePath}`);
      }

      delete database.archives[archive.id];

      Object.keys(database.images).forEach(imageId => {
        if (database.images[imageId].archiveId === archive.id) {
          delete database.images[imageId];
        }
      });
    } catch (error) {
      console.warn(`Failed to clear archive ${archive.id}:`, error);
    }
  }

  await saveDatabase();
  console.log('Cache cleared successfully');
}

async function getCacheUsage() {
  const database = getDatabase();
  const archives = Object.values(database.archives).filter(archive => !archive.starred);

  let totalSize = 0;
  for (const archive of archives) {
    const size = isNaN(archive.size) ? 0 : (archive.size || 0);
    totalSize += size;
  }

  const starredCount = Object.values(database.archives).filter(archive => archive.starred).length;

  console.log(`Cache size (non-starred only): ${totalSize} bytes (${(totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB)`);
  console.log(`Starred items: ${starredCount}`);

  return {
    totalSize,
    starredCount
  };
}

module.exports = {
  manageCache,
  clearCache,
  getCacheUsage
};
