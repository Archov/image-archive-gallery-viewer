const { fileURLToPath } = require('url');
const fs = require('fs').promises;
const path = require('path');
const { createHash } = require('crypto');
const os = require('os');
const {
  extractZip,
  extractRar,
  extract7z,
  extractSingleImageFromZip,
  extractSingleImageFromRar,
  extractSingleImageFrom7z,
  sanitizeFilename
} = require('./extractionService');
const { downloadFile } = require('./downloadService');
const { manageLibrary } = require('./libraryService');
const { getDatabase, saveDatabase } = require('./databaseService');
const { libraryDir } = require('../config');

function normalizeFileUrl(filePath) {
  return `file://${filePath.replace(/\\/g, '/')}`;
}

async function createSessionExtractDir(archiveId) {
  const baseDir = path.join(os.tmpdir(), 'kemono-gallery', archiveId);
  await fs.rm(baseDir, { recursive: true, force: true });
  await fs.mkdir(baseDir, { recursive: true });
  return baseDir;
}

function buildSessionOutputPath(sessionDir, imageMeta) {
  const entryNameSource = imageMeta.originalName || imageMeta.name || String(imageMeta.id);
  const entryName = entryNameSource.replace(/\\/g, "/");
  const outputSource = (imageMeta.relativePath || entryName).replace(/\\/g, '/');
  const ext = path.extname(outputSource) || path.extname(entryName) || ".img";
  const segments = outputSource.split("/").map(sanitizeFilename).filter(Boolean);
  const fileBase = sanitizeFilename(path.basename(outputSource, ext)) || String(imageMeta.id);
  const subDirs = segments.slice(0, -1);
  const dir = path.join(sessionDir, ...subDirs);
  const fileName = fileBase + "-" + imageMeta.id + ext;
  const filePath = path.join(dir, fileName);
  return { dir, filePath, entryName, ext };
}

async function extractEntryToFile(archivePath, archiveExt, entryName, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  switch (archiveExt) {
    case '.zip':
      await extractSingleImageFromZip(archivePath, entryName, outputPath);
      break;
    case '.rar':
      await extractSingleImageFromRar(archivePath, entryName, outputPath);
      break;
    case '.7z':
      await extractSingleImageFrom7z(archivePath, entryName, outputPath);
      break;
    default:
      throw new Error(`Unsupported archive format ${archiveExt}`);
  }
}

function getArchiveExtension(url) {
  try {
    const urlObj = new URL(url);
    const fParam = urlObj.searchParams.get('f');
    if (fParam) {
      const match = fParam.match(/\.(zip|rar|7z)$/i);
      if (match) return match[0];
    }

    const match = urlObj.pathname.match(/\.(zip|rar|7z)$/i);
    if (match) return match[0];

    return '.zip';
  } catch (error) {
    return '.zip';
  }
}

async function loadArchiveFromUrl(url, librarySizeLimitGB, { onProgress } = {}) {
  const archiveId = createHash('md5').update(url).digest('hex');
  const database = getDatabase();

  try {
    // Check if archive already exists in library
    if (database.archives[archiveId]) {
      const archive = database.archives[archiveId];
      archive.lastAccessed = new Date().toISOString();
      
      // Check if we have the archive in the new library structure
      const libraryArchivePath = archive.libraryPath ? path.join(archive.libraryPath, archive.archiveFileName || 'archive' + getArchiveExtension(url)) : null;
      
      if (libraryArchivePath && (await fileExists(libraryArchivePath))) {
        // Archive exists in library - use it
        await saveDatabase();
        
        const sessionDir = await createSessionExtractDir(archiveId);
        const archiveExt = path.extname(libraryArchivePath).toLowerCase();
        const extractedImages = await extractArchive(archiveExt, libraryArchivePath, sessionDir);

        const sessionImages = extractedImages.map(img => ({
          id: img.id,
          name: img.name,
          url: img.url,
          starred: Boolean(img.starred),
          archiveName: archive.displayName || path.basename(url)
        }));

        return { images: sessionImages, archiveId };
      } else if (archive.sourceUrl || archive.url) {
        // Archive missing from library but we have URL - re-download for migration
        const sourceUrl = archive.sourceUrl || archive.url;
        console.log(`Archive missing from library, re-downloading from: ${sourceUrl}`);
        
        // Set up new library structure
        const archiveExt = getArchiveExtension(sourceUrl);
        const libraryPath = path.join(libraryDir, archiveId);
        await fs.mkdir(libraryPath, { recursive: true });
        
        const archiveFileName = `archive${archiveExt}`;
        const newLibraryArchivePath = path.join(libraryPath, archiveFileName);

        // Re-download archive to library
        await downloadFile(sourceUrl, newLibraryArchivePath, onProgress);
        
        // Update database with new library structure
        const archiveStat = await fs.stat(newLibraryArchivePath);
        archive.libraryPath = libraryPath;
        archive.archiveFileName = archiveFileName;
        archive.archiveSize = archiveStat.size;
        archive.sourceUrl = sourceUrl; // Ensure sourceUrl is preserved
        
        // Remove old cache references if they exist
        delete archive.cachePath;
        delete archive.archivePath;
        
        await saveDatabase();
        
        // Extract to temp for viewing
        const sessionDir = await createSessionExtractDir(archiveId);
        const extractedImages = await extractArchive(archiveExt, newLibraryArchivePath, sessionDir);

        const sessionImages = extractedImages.map(img => ({
          id: img.id,
          name: img.name,
          url: img.url,
          starred: Boolean(img.starred),
          archiveName: archive.displayName || path.basename(sourceUrl)
        }));

        console.log(`Migration complete: ${sourceUrl} re-downloaded to library`);
        return { images: sessionImages, archiveId };
      } else {
        // No way to recover this archive
        throw new Error(`Archive missing from library and no source URL available: ${archive.displayName || archiveId}`);
      }
    }

    // New archive - download to library
    const archiveExt = getArchiveExtension(url);
    const libraryPath = path.join(libraryDir, archiveId);
    await fs.mkdir(libraryPath, { recursive: true });
    
    const archiveFileName = `archive${archiveExt}`;
    const libraryArchivePath = path.join(libraryPath, archiveFileName);

    // Download archive to library
    await downloadFile(url, libraryArchivePath, onProgress);

    const archiveStat = await fs.stat(libraryArchivePath);
    console.log(`Archive added to library: ${libraryArchivePath}, size=${archiveStat.size} bytes (${(archiveStat.size / (1024 * 1024)).toFixed(2)} MB)`);

    // Extract to temp directory for viewing
    const sessionDir = await createSessionExtractDir(archiveId);
    const extractedImages = await extractArchive(archiveExt, libraryArchivePath, sessionDir);

    const metadata = extractedImages.map(img => ({
      id: img.id,
      name: img.name,
      originalName: (img.originalName || img.name || '').replace(/\\/g, '/'),
      relativePath: (img.relativePath || img.originalName || img.name || '').replace(/\\/g, '/'),
      size: img.size,
      starred: Boolean(img.starred)
    }));

    const sessionImages = extractedImages.map(img => ({
      id: img.id,
      name: img.name,
      url: img.url,
      starred: Boolean(img.starred),
      archiveName: path.basename(url)
    }));

    // Add to library database
    database.archives[archiveId] = {
      id: archiveId,
      sourceUrl: url, // Store original URL for future reference
      libraryPath: libraryPath,
      archiveFileName: archiveFileName,
      archiveSize: archiveStat.size, // Only archive size counts toward library limit
      lastAccessed: new Date().toISOString(),
      dateAdded: new Date().toISOString(),
      starred: false,
      displayName: path.basename(url),
      extractedImages: metadata
    };

    metadata.forEach(meta => {
      database.images[meta.id] = {
        id: meta.id,
        archiveId,
        name: meta.name,
        originalName: meta.originalName,
        relativePath: meta.relativePath,
        size: meta.size,
        starred: meta.starred
      };
    });

    await saveDatabase();

    // Manage library size (only considering archive sizes)
    const librarySizeBytes = (librarySizeLimitGB || 2) * 1024 * 1024 * 1024;
    await manageLibrary(librarySizeBytes);

    return { images: sessionImages, archiveId };
  } catch (error) {
    // Cleanup on error
    const libraryPath = path.join(libraryDir, archiveId);
    await cleanupLibraryDirectory(libraryPath);
    throw error;
  }
}

async function loadLocalArchive(filePath, librarySizeGB, options = {}) {
  const { copyToLibrary = null } = options; // null = ask user, true = copy, false = move
  const archiveId = createHash('md5').update(filePath).digest('hex');
  const database = getDatabase();

  try {
    // Check if already in library
    if (database.archives[archiveId]) {
      const archive = database.archives[archiveId];
      archive.lastAccessed = new Date().toISOString();
      
      // Check if archive exists in new library structure
      const libraryArchivePath = archive.libraryPath ? path.join(archive.libraryPath, archive.archiveFileName || `archive${path.extname(filePath)}`) : null;
      
      if (libraryArchivePath && (await fileExists(libraryArchivePath))) {
        // Archive exists in library - use it
        await saveDatabase();

        const sessionDir = await createSessionExtractDir(archiveId);
        const archiveExt = path.extname(libraryArchivePath).toLowerCase();
        const extractedImages = await extractArchive(archiveExt, libraryArchivePath, sessionDir);

        const sessionImages = extractedImages.map(img => ({
          id: img.id,
          name: img.name,
          url: img.url,
          starred: Boolean(img.starred),
          archiveName: archive.displayName || path.basename(filePath)
        }));

        return { 
          images: sessionImages, 
          archiveId,
          alreadyInLibrary: true
        };
      } else {
        // Archive missing from library but we have the original file path
        // Treat this as a new local archive that needs to be added
        console.log(`Archive missing from library, will re-add from: ${filePath}`);
        // Continue with normal local archive processing below
      }
    }

    const archiveStat = await fs.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    
    // New local archive - need to add to library
    const libraryPath = path.join(libraryDir, archiveId);
    await fs.mkdir(libraryPath, { recursive: true });
    
    const archiveFileName = `archive${ext}`;
    const libraryArchivePath = path.join(libraryPath, archiveFileName);

    // Determine if we should copy or move (this will be handled by UI)
    let shouldCopy = copyToLibrary;
    if (shouldCopy === null) {
      // Return special response to trigger UI prompt
      return {
        needsUserChoice: true,
        archiveId,
        filePath,
        librarySizeGB
      };
    }

    // Copy or move file to library
    if (shouldCopy) {
      await fs.copyFile(filePath, libraryArchivePath);
      console.log(`Archive copied to library: ${libraryArchivePath}`);
    } else {
      await fs.rename(filePath, libraryArchivePath);
      console.log(`Archive moved to library: ${libraryArchivePath}`);
    }

    // Extract to temp for viewing
    const sessionDir = await createSessionExtractDir(archiveId);
    const extractedImages = await extractArchive(ext, libraryArchivePath, sessionDir);

    const metadata = extractedImages.map(img => ({
      id: img.id,
      name: img.name,
      originalName: (img.originalName || img.name || '').replace(/\\/g, '/'),
      relativePath: (img.relativePath || img.originalName || img.name || '').replace(/\\/g, '/'),
      size: img.size,
      starred: Boolean(img.starred)
    }));

    const sessionImages = extractedImages.map(img => ({
      id: img.id,
      name: img.name,
      url: img.url,
      starred: Boolean(img.starred),
      archiveName: path.basename(filePath)
    }));

    // Add to library database
    database.archives[archiveId] = {
      id: archiveId,
      sourceUrl: `file://${filePath}`, // Store original file path
      libraryPath: libraryPath,
      archiveFileName: archiveFileName,
      archiveSize: archiveStat.size, // Only archive size counts toward library limit
      lastAccessed: new Date().toISOString(),
      dateAdded: new Date().toISOString(),
      starred: false,
      displayName: path.basename(filePath),
      extractedImages: metadata,
      wasMovedToLibrary: !shouldCopy // Track if original was moved
    };

    metadata.forEach(meta => {
      database.images[meta.id] = {
        id: meta.id,
        archiveId,
        name: meta.name,
        originalName: meta.originalName,
        relativePath: meta.relativePath,
        size: meta.size,
        starred: meta.starred
      };
    });

    await saveDatabase();

    // Manage library size
    const librarySizeBytes = (librarySizeGB || database.settings.librarySize || 2) * 1024 * 1024 * 1024;
    await manageLibrary(librarySizeBytes);

    return { 
      images: sessionImages, 
      archiveId,
      addedToLibrary: true,
      wasCopied: shouldCopy
    };
  } catch (error) {
    const libraryPath = path.join(libraryDir, archiveId);
    await cleanupLibraryDirectory(libraryPath);
    throw error;
  }
}

async function extractImage(archiveId, imageId) {
  const database = getDatabase();
  const archive = database.archives[archiveId];
  const image = database.images[imageId];

  if (!archive || !image) {
    throw new Error('Archive or image not found');
  }

  const libraryArchivePath = path.join(archive.libraryPath, archive.archiveFileName);
  if (!(await fileExists(libraryArchivePath))) {
    throw new Error('Archive file not found in library');
  }

  const archiveExt = path.extname(libraryArchivePath).toLowerCase();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kemono-image-'));
  const entryName = (image.originalName || image.name || String(image.id)).replace(/\\/g, '/');
  const ext = path.extname(entryName) || '.img';
  const safeName = sanitizeFilename(path.basename(entryName, ext)) || image.id;
  const outputPath = path.join(tempDir, `${safeName}-${image.id}${ext}`);

  await extractEntryToFile(libraryArchivePath, archiveExt, entryName, outputPath);

  return normalizeFileUrl(outputPath);
}

async function toggleImageStar(archiveId, imageId) {
  const database = getDatabase();
  const image = database.images[imageId];
  const archive = database.archives[archiveId];

  if (!image || !archive) {
    throw new Error('Image or archive not found');
  }

  image.starred = !image.starred;

  // If any image is starred, star the archive too
  const archiveImages = Object.values(database.images).filter(img => img.archiveId === archiveId);
  archive.starred = archiveImages.some(img => img.starred);

  await saveDatabase();

  return { starred: image.starred };
}

async function extractArchive(extension, archivePath, extractPath) {
  switch (extension.toLowerCase()) {
    case '.zip':
      return extractZip(archivePath, extractPath);
    case '.rar':
      return extractRar(archivePath, extractPath);
    case '.7z':
      return extract7z(archivePath, extractPath);
    default:
      throw new Error('Unsupported archive format');
  }
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    return false;
  }
}

async function cleanupLibraryDirectory(targetPath) {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch (cleanupError) {
    console.warn('Failed to clean up library directory:', cleanupError.message);
  }
}

module.exports = {
  loadArchiveFromUrl,
  loadLocalArchive,
  extractImage,
  toggleImageStar
};