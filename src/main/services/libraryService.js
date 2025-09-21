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

async function manageLibrary(maxSizeBytes) {
  const database = getDatabase();
  const libraryInfo = await getLibraryUsage();

  console.log(`Library management: current=${(libraryInfo.totalSize / (1024 * 1024 * 1024)).toFixed(2)}GB, limit=${(maxSizeBytes / (1024 * 1024 * 1024)).toFixed(2)}GB`);

  if (libraryInfo.totalSize <= maxSizeBytes) {
    console.log('Library within limits, no cleanup needed');
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
  let librarySizeExcludingCurrent = libraryInfo.totalSize - currentSize;

  if (librarySizeExcludingCurrent <= maxSizeBytes) {
    return;
  }

  let freedSpace = 0;
  const spaceNeeded = librarySizeExcludingCurrent - maxSizeBytes;

  for (const archive of archivesToClean) {
    if (freedSpace >= spaceNeeded) break;

    try {
      if (archive.archivePath && await exists(archive.archivePath)) {
        await fs.unlink(archive.archivePath);
        console.log(`Deleted archive file: ${archive.archivePath}`);
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

async function clearLibrary() {
  const database = getDatabase();
  const archives = Object.values(database.archives).filter(archive => !archive.starred);

  console.log(`Clearing library: ${archives.length} non-starred archives`);

  for (const archive of archives) {
    try {
      if (archive.archivePath && await exists(archive.archivePath)) {
        await fs.unlink(archive.archivePath);
        console.log(`Deleted archive file: ${archive.archivePath}`);
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
  console.log('Library cleared successfully');
}

async function getLibraryUsage() {
  const database = getDatabase();
  const archives = Object.values(database.archives).filter(archive => !archive.starred);

  let totalSize = 0;
  for (const archive of archives) {
    const size = isNaN(archive.size) ? 0 : (archive.size || 0);
    totalSize += size;
  }

  const starredCount = Object.values(database.archives).filter(archive => archive.starred).length;

  console.log(`Library size (non-starred only): ${totalSize} bytes (${(totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB)`);
  console.log(`Starred items: ${starredCount}`);

  return {
    totalSize,
    starredCount
  };
}

module.exports = {
  manageLibrary,
  clearLibrary,
  getLibraryUsage
};
