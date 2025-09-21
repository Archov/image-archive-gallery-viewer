const fs = require('fs').promises;
const path = require('path');
const { getDatabase, saveDatabase } = require('./databaseService');

/**
 * Manages the library size by removing oldest unstarred archives when limit is exceeded.
 * Only considers archive file sizes, not extracted images.
 */
async function manageLibrary(maxSizeBytes) {
  const database = getDatabase();
  const libraryInfo = await getLibraryUsage();

  console.log(`Library management: current=${(libraryInfo.totalArchiveSize / (1024 * 1024 * 1024)).toFixed(2)}GB, limit=${(maxSizeBytes / (1024 * 1024 * 1024)).toFixed(2)}GB`);

  if (libraryInfo.totalArchiveSize <= maxSizeBytes) {
    console.log('Library within limits, no cleanup needed');
    return;
  }

  // Get all non-starred archives sorted by last accessed (oldest first)
  const archivesToConsider = Object.values(database.archives)
    .filter(archive => !archive.starred)
    .sort((a, b) => {
      const ad = new Date(a.lastAccessed || a.dateAdded || 0).getTime();
      const bd = new Date(b.lastAccessed || b.dateAdded || 0).getTime();
      return ad - bd;
    });

  if (archivesToConsider.length === 0) {
    console.log('No unstarred archives to remove');
    return;
  }

  let currentSize = libraryInfo.totalArchiveSize;
  const spaceNeeded = currentSize - maxSizeBytes;
  let freedSpace = 0;

  console.log(`Need to free ${(spaceNeeded / (1024 * 1024 * 1024)).toFixed(2)}GB of space`);

  for (const archive of archivesToConsider) {
    if (freedSpace >= spaceNeeded) break;

    try {
      const archiveSize = archive.archiveSize || 0;
      
      // Remove archive from library
      if (!archive.libraryPath || !archive.archiveFileName) {
        console.warn(`Archive ${archive.id} missing libraryPath/archiveFileName – skipping file removal`);
      } else {
        const libraryArchivePath = path.join(archive.libraryPath, archive.archiveFileName);
        if (await fileExists(libraryArchivePath)) {
          await fs.rm(libraryArchivePath, { force: true });
          console.log(`Deleted archive: ${libraryArchivePath}`);
        }
        await fs.rm(archive.libraryPath, { recursive: true, force: true }).catch(() => {});
      }

      // Remove from database
      delete database.archives[archive.id];

      // Remove associated images
      Object.keys(database.images).forEach(imageId => {
        if (database.images[imageId].archiveId === archive.id) {
          delete database.images[imageId];
        }
      });

      freedSpace += archiveSize;
      currentSize -= archiveSize;

      console.log(`Removed archive ${archive.displayName}, freed ${(archiveSize / (1024 * 1024)).toFixed(2)}MB`);

    } catch (error) {
      console.warn(`Failed to remove archive ${archive.id}:`, error);
    }
  }

  await saveDatabase();
  
  console.log(`Library cleanup complete. Freed ${(freedSpace / (1024 * 1024 * 1024)).toFixed(2)}GB`);
}

/**
 * Gets current library usage information.
 * Only considers archive file sizes, not extracted images.
 */
async function getLibraryUsage() {
  const database = getDatabase();
  let totalArchiveSize = 0;
  let starredCount = 0;
  let totalArchives = 0;

  for (const archive of Object.values(database.archives)) {
    totalArchives++;
    const archiveSize = archive.archiveSize || 0;
    totalArchiveSize += archiveSize;
    
    if (archive.starred) {
      starredCount++;
    }
  }

  console.log(`Library usage: ${totalArchives} archives, ${(totalArchiveSize / (1024 * 1024 * 1024)).toFixed(2)}GB total, ${starredCount} starred`);

  return {
    totalArchiveSize,
    totalArchives,
    starredCount,
    unstarredCount: totalArchives - starredCount
  };
}

/**
 * Clears the entire library, removing all unstarred archives.
 * Starred archives are preserved.
 */
async function clearLibrary() {
  const database = getDatabase();
  
  // Only clear non-starred archives
  const archivesToClear = Object.values(database.archives).filter(archive => !archive.starred);

  console.log(`Clearing library: ${archivesToClear.length} unstarred archives`);

  for (const archive of archivesToClear) {
    try {
      // Delete archive file and directory
      if (!archive.libraryPath || !archive.archiveFileName) {
        console.warn(`Archive ${archive.id} missing libraryPath/archiveFileName – skipping file removal`);
      } else {
        const libraryArchivePath = path.join(archive.libraryPath, archive.archiveFileName);
        if (await fileExists(libraryArchivePath)) {
          await fs.rm(libraryArchivePath, { force: true });
          console.log(`Deleted archive: ${libraryArchivePath}`);
        }
        await fs.rm(archive.libraryPath, { recursive: true, force: true }).catch(() => {});
      }

      // Remove from database
      delete database.archives[archive.id];

      // Remove associated images
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

/**
 * Gets detailed information about all archives in the library.
 */
async function getLibraryInfo() {
  const database = getDatabase();
  const archives = Object.values(database.archives);
  
  const libraryStats = {
    totalArchives: archives.length,
    starredArchives: archives.filter(a => a.starred).length,
    totalSize: 0,
    starredSize: 0,
    oldestAccess: null,
    newestAccess: null,
    archives: []
  };

  for (const archive of archives) {
    const archiveSize = archive.archiveSize || 0;
    libraryStats.totalSize += archiveSize;
    
    if (archive.starred) {
      libraryStats.starredSize += archiveSize;
    }

    const accessDate = new Date(archive.lastAccessed);
    if (!libraryStats.oldestAccess || accessDate < libraryStats.oldestAccess) {
      libraryStats.oldestAccess = accessDate.toISOString();
    }
    if (!libraryStats.newestAccess || accessDate > libraryStats.newestAccess) {
      libraryStats.newestAccess = accessDate.toISOString();
    }

    libraryStats.archives.push({
      id: archive.id,
      displayName: archive.displayName,
      sourceUrl: archive.sourceUrl,
      archiveSize: archiveSize,
      lastAccessed: archive.lastAccessed,
      dateAdded: archive.dateAdded,
      starred: archive.starred,
      imageCount: archive.extractedImages ? archive.extractedImages.length : 0
    });
  }

  // Sort archives by last accessed (newest first)
  libraryStats.archives.sort((a, b) => {
    const ad = new Date(a.lastAccessed || a.dateAdded || 0).getTime();
    const bd = new Date(b.lastAccessed || b.dateAdded || 0).getTime();
    return bd - ad;
  });

  return libraryStats;
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  manageLibrary,
  getLibraryUsage,
  clearLibrary,
  getLibraryInfo
};
