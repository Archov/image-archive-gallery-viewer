const fs = require('fs').promises;
const { pathToFileURL } = require('url');
const { dialog } = require('electron');
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
  sanitizeFilename,
  listArchiveContents
} = require('./extractionService');
const { downloadFile } = require('./downloadService');
const { manageLibrary } = require('./libraryService');
const { getDatabase, saveDatabase } = require('./databaseService');
const { libraryDir } = require('../config');
const { v4: uuidv4 } = require('uuid');

function normalizeFileUrl(filePath) {
  // Validate and sanitize the file path to prevent path traversal
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path provided');
  }
  
  // Check for path traversal attempts
  if (filePath.includes('..') || filePath.includes('~')) {
    throw new Error('Path traversal detected in file path');
  }
  
  return pathToFileURL(path.resolve(filePath)).href;
}

function safePathJoin(...pathSegments) {
  // Validate all path segments to prevent path traversal
  for (const segment of pathSegments) {
    if (typeof segment !== 'string') {
      throw new Error('Invalid path segment type');
    }
    if (segment.includes('..') || segment.includes('~')) {
      throw new Error('Path traversal detected in path segment');
    }
  }
  
  const joinedPath = path.join(...pathSegments);
  
  // Additional validation: ensure the resolved path doesn't escape expected directories
  const resolvedPath = path.resolve(joinedPath);
  
  return joinedPath;
}

// Helper function for archive extraction
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

async function createSessionExtractDir(archiveId) {
  const baseDir = safePathJoin(os.tmpdir(), 'kemono-gallery', archiveId);
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
  const dir = safePathJoin(sessionDir, ...subDirs);
  const fileName = fileBase + "-" + imageMeta.id + ext;
  const filePath = safePathJoin(dir, fileName);
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
      const libraryArchivePath = archive.libraryPath ? safePathJoin(archive.libraryPath, archive.archiveFileName || 'archive' + getArchiveExtension(url)) : null;
      
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
          starred: Boolean(database.images[img.id]?.starred),
          archiveName: archive.displayName || path.basename(url)
        }));

        return { images: sessionImages, archiveId, libraryArchivePath };
      } else if (archive.sourceUrl || archive.url) {
        // Archive missing from library but we have URL - re-download for migration
        const sourceUrl = archive.sourceUrl || archive.url;
        console.log(`Archive missing from library, re-downloading from: ${sourceUrl}`);
        
        // Set up new library structure
        const archiveExt = getArchiveExtension(sourceUrl);
        const libraryPath = safePathJoin(libraryDir, archiveId);
        await fs.mkdir(libraryPath, { recursive: true });
        
        const archiveFileName = `archive${archiveExt}`;
        const newLibraryArchivePath = safePathJoin(libraryPath, archiveFileName);

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
          starred: Boolean(database.images[img.id]?.starred),
          archiveName: archive.displayName || path.basename(sourceUrl)
        }));

        console.log(`Migration complete: ${sourceUrl} re-downloaded to library`);
        return { images: sessionImages, archiveId, libraryArchivePath: newLibraryArchivePath };
      } else {
        // No way to recover this archive
        throw new Error(`Archive missing from library and no source URL available: ${archive.displayName || archiveId}`);
      }
    }

    // New archive - download to library
    const archiveExt = getArchiveExtension(url);
    const libraryPath = safePathJoin(libraryDir, archiveId);
    await fs.mkdir(libraryPath, { recursive: true });
    
    const archiveFileName = `archive${archiveExt}`;
    const libraryArchivePath = safePathJoin(libraryPath, archiveFileName);

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
      starred: Boolean(database.images[img.id]?.starred),
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

    return { images: sessionImages, archiveId, libraryArchivePath };
  } catch (error) {
    // Cleanup on error
    const libraryPath = safePathJoin(libraryDir, archiveId);
    await cleanupLibraryDirectory(libraryPath);
    throw error;
  }
}

async function loadLocalArchive(filePath, librarySizeGB, options = {}) {
  const { copyToLibrary = null, archiveId: providedArchiveId } = options; // null = ask user, true = copy, false = move
  const resolvedPath = path.resolve(filePath);
  const resolvedLibraryDir = path.resolve(libraryDir);
  let archiveId = providedArchiveId || createHash('md5').update(filePath).digest('hex');
  
  // If filePath is inside libraryDir, derive ID from parent directory
  if (!providedArchiveId && (resolvedPath + path.sep).startsWith(resolvedLibraryDir + path.sep)) {
    // Inside library: derive id from parent directory (../library/<archiveId>/archive.ext)
    archiveId = path.basename(path.dirname(resolvedPath));
  }
  
  const database = getDatabase();

  // Star restoration map (if we are rebuilding a missing library entry)
  let existingStarredImages = null;

  try {
    // Check if this is a library file that should short-circuit
    const known = database.archives[archiveId];
    if (known && known.libraryPath && known.archiveFileName) {
      const expected = safePathJoin(known.libraryPath, known.archiveFileName);
      if (path.resolve(expected) === resolvedPath && await fileExists(expected)) {
        const sessionDir = await createSessionExtractDir(archiveId);
        const archiveExt = path.extname(expected).toLowerCase();
        const extractedImages = await extractArchive(archiveExt, expected, sessionDir);
        const sessionImages = extractedImages.map(img => ({
          id: img.id,
          name: img.name,
          url: img.url,
          starred: Boolean(database.images[img.id]?.starred),
          archiveName: known.displayName || path.basename(filePath)
        }));
        return { images: sessionImages, archiveId, libraryArchivePath: expected, alreadyInLibrary: true };
      }
    }

    // Check if already in library
    if (database.archives[archiveId]) {
      const archive = database.archives[archiveId];
      archive.lastAccessed = new Date().toISOString();
      
      // Check if archive exists in new library structure
      const libraryArchivePath = archive.libraryPath ? safePathJoin(archive.libraryPath, archive.archiveFileName || `archive${path.extname(filePath)}`) : null;
      
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
          starred: Boolean(database.images[img.id]?.starred),
          archiveName: archive.displayName || path.basename(filePath)
        }));

        return { 
          images: sessionImages, 
          archiveId,
          libraryArchivePath,
          alreadyInLibrary: true
        };
      } else {
        // Archive missing from library but we have the original file path
        // Preserve starred data and migrate to new structure
        console.log(`Archive missing from library, will re-add from: ${filePath}`);
        
        // Store existing starred data for migration
        existingStarredImages = {};
        Object.keys(database.images).forEach(imageId => {
          if (database.images[imageId].archiveId === archiveId && database.images[imageId].starred) {
            const image = database.images[imageId];
            const key = (image.originalName || image.name || '').replace(/\\/g, '/');
            existingStarredImages[key] = true;
          }
        });
        
        // Remove old database entries but preserve starred data
        delete database.archives[archiveId];
        Object.keys(database.images).forEach(imageId => {
          if (database.images[imageId].archiveId === archiveId) {
            delete database.images[imageId];
          }
        });
        
        // Continue with normal local archive processing below
        // The starred data will be restored during the new archive processing
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    
    // New local archive - need to add to library
    const libraryPath = safePathJoin(libraryDir, archiveId);
    await fs.mkdir(libraryPath, { recursive: true });
    
    const archiveFileName = `archive${ext}`;
    const libraryArchivePath = safePathJoin(libraryPath, archiveFileName);

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
      try {
        await fs.rename(filePath, libraryArchivePath);
        console.log(`Archive moved to library: ${libraryArchivePath}`);
      } catch (err) {
        if (err.code === 'EXDEV') {
          await fs.copyFile(filePath, libraryArchivePath);
          await fs.unlink(filePath);
          console.log(`Archive moved across devices (copy+unlink): ${libraryArchivePath}`);
        } else {
          throw err;
        }
      }
    }

    // Extract to temp for viewing
    const sessionDir = await createSessionExtractDir(archiveId);
    const extractedImages = await extractArchive(ext, libraryArchivePath, sessionDir);

    console.log(`Debug: Extracted ${extractedImages.length} images to session directory: ${sessionDir}`);
    console.log(`Debug: First extracted image:`, extractedImages[0] ? {
      id: extractedImages[0].id,
      name: extractedImages[0].name,
      url: extractedImages[0].url,
      path: extractedImages[0].path
    } : 'No images');

    const archiveStat = await fs.stat(libraryArchivePath);

    // Build metadata and session images, preserving starred state when possible
    const starredLookup = typeof existingStarredImages === 'object' ? existingStarredImages : null;
    const metadata = extractedImages.map(img => {
      const originalName = (img.originalName || img.name || '').replace(/\\/g, '/');
      const relativePath = (img.relativePath || img.originalName || img.name || '').replace(/\\/g, '/');
      const wasStarred = starredLookup
        ? Boolean(starredLookup[originalName])
        : Boolean(database.images[img.id]?.starred);
      return {
        id: img.id,
        name: img.name,
        originalName,
        relativePath,
        size: img.size,
        starred: wasStarred
      };
    });

    const sessionImages = extractedImages.map(img => ({
      id: img.id,
      name: img.name,
      url: img.url,
      starred: Boolean(database.images[img.id]?.starred) || Boolean(starredLookup?.[(img.originalName || img.name || '').replace(/\\/g, '/')]),
      archiveName: path.basename(filePath)
    }));

    // Add to library database
    database.archives[archiveId] = {
      id: archiveId,
      sourceUrl: normalizeFileUrl(filePath), // Store original file path
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

    const result = { 
      images: sessionImages, 
      archiveId,
      libraryArchivePath,
      addedToLibrary: true,
      wasCopied: shouldCopy
    };

    console.log(`Debug: Returning result with ${result.images.length} images`);
    return result;
  } catch (error) {
    const libraryPath = safePathJoin(libraryDir, archiveId);
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

  const libraryArchivePath = safePathJoin(archive.libraryPath, archive.archiveFileName);
  if (!(await fileExists(libraryArchivePath))) {
    throw new Error('Archive file not found in library');
  }

  const archiveExt = path.extname(libraryArchivePath).toLowerCase();
  const tempDir = await fs.mkdtemp(safePathJoin(os.tmpdir(), 'kemono-image-'));
  const entryName = (image.originalName || image.name || String(image.id)).replace(/\\/g, '/');
  const ext = path.extname(entryName) || '.img';
  const safeName = sanitizeFilename(path.basename(entryName, ext)) || image.id;
  const outputPath = safePathJoin(tempDir, `${safeName}-${image.id}${ext}`);

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

async function extractArchiveToTemp(archivePath, extractPath) {
  const ext = path.extname(archivePath).toLowerCase();
  return await extractArchive(ext, archivePath, extractPath);
}

async function getArchiveMetadata(archivePath) {
  const sessionDir = await fs.mkdtemp(safePathJoin(os.tmpdir(), 'archive-metadata-'));
  const ext = path.extname(archivePath).toLowerCase();
  const extractedImages = await extractArchive(ext, archivePath, sessionDir);

  const metadata = extractedImages.map(img => ({
    id: img.id,
    name: img.name,
    originalName: (img.originalName || img.name || '').replace(/\\/g, '/'),
    relativePath: (img.relativePath || img.originalName || img.name || '').replace(/\\/g, '/'),
    size: img.size,
    starred: Boolean(img.starred)
  }));

  // Cleanup temp directory
  await fs.rm(sessionDir, { recursive: true, force: true });

  return metadata;
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    return false;
  }
}

async function cleanupLibraryDirectory(libraryPath) {
  try {
    if (await fileExists(libraryPath)) {
      await fs.rm(libraryPath, { recursive: true, force: true });
      console.log(`Cleaned up library directory: ${libraryPath}`);
    }
  } catch (error) {
    console.warn(`Failed to cleanup library directory ${libraryPath}:`, error);
  }
}

async function loadLocalArchiveFromData(fileData, librarySizeGB) {
  const { name, data, size, copyToLibrary = null } = fileData;

  // Create a temporary file path for processing
  const tempDir = os.tmpdir();
  const tempFileName = `temp-${uuidv4()}-${name}`;
  const tempFilePath = safePathJoin(tempDir, tempFileName);

  try {
    // Write the data to a temporary file
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await fs.writeFile(tempFilePath, buffer);

    // Use the existing loadLocalArchive function with a deterministic ID
    const contentHash = createHash('md5').update(buffer).digest('hex');
    const result = await loadLocalArchive(tempFilePath, librarySizeGB, { copyToLibrary, archiveId: contentHash });

    return result;
  } finally {
    // Clean up temp file, ignoring errors if it doesn't exist.
    await fs.unlink(tempFilePath).catch(() => {});
  }
}

async function debugArchiveContents(filePath) {
  try {
    console.log(`Debug: Listing contents of archive: ${filePath}`);
    const contents = await listArchiveContents(filePath);
    const imageFiles = contents.filter(item => item.isImage);
    
    console.log(`Debug: Found ${contents.length} total entries, ${imageFiles.length} image files`);
    if (imageFiles.length === 0) {
      console.log('Debug: No image files found. All entries:');
      contents.forEach(item => {
        console.log(`  - ${item.name} (${item.isDirectory ? 'directory' : 'file'})`);
      });
    } else {
      console.log('Debug: Image files found:');
      imageFiles.forEach(img => {
        console.log(`  - ${img.name}`);
      });
    }
    
    return contents;
  } catch (error) {
    console.error(`Debug: Error listing archive contents: ${error.message}`);
    throw error;
  }
}

module.exports = {
  loadArchiveFromUrl,
  loadLocalArchive,
  loadLocalArchiveFromData,
  extractImage,
  toggleImageStar,
  debugArchiveContents
};