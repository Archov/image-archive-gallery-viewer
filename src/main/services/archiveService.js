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
  sanitizeFilename,
  listArchiveContents
} = require('./extractionService');
const { downloadFile } = require('./downloadService');
const { manageLibrary } = require('./libraryService');
const { getDatabase, saveDatabase } = require('./databaseService');
const { libraryDir } = require('../config');
const { v4: uuidv4 } = require('uuid');

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
        // Remove the old database entry and treat this as a new local archive
        console.log(`Archive missing from library, will re-add from: ${filePath}`);
        
        // Remove old database entries
        delete database.archives[archiveId];
        Object.keys(database.images).forEach(imageId => {
          if (database.images[imageId].archiveId === archiveId) {
            delete database.images[imageId];
          }
        });
        
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

    console.log(`Debug: Extracted ${extractedImages.length} images to session directory: ${sessionDir}`);
    console.log(`Debug: First extracted image:`, extractedImages[0] ? {
      id: extractedImages[0].id,
      name: extractedImages[0].name,
      url: extractedImages[0].url,
      path: extractedImages[0].path
    } : 'No images');

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

    console.log(`Debug: Created ${sessionImages.length} session images`);
    console.log(`Debug: First session image:`, sessionImages[0] ? {
      id: sessionImages[0].id,
      name: sessionImages[0].name,
      url: sessionImages[0].url,
      archiveName: sessionImages[0].archiveName
    } : 'No session images');

    // Validate that extracted files actually exist
    for (const img of extractedImages) {
      try {
        await fs.access(img.path);
        console.log(`Debug: File exists: ${img.path}`);
      } catch (error) {
        console.error(`Debug: File does not exist: ${img.path}`, error.message);
      }
    }

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

    const result = { 
      images: sessionImages, 
      archiveId,
      addedToLibrary: true,
      wasCopied: shouldCopy
    };

    console.log(`Debug: Returning result with ${result.images.length} images`);
    return result;
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
  const tempFilePath = path.join(tempDir, tempFileName);

  try {
    // Write the data to a temporary file
    const buffer = Buffer.from(data);
    await fs.writeFile(tempFilePath, buffer);

    // Use the existing loadLocalArchive function
    const result = await loadLocalArchive(tempFilePath, librarySizeGB, { copyToLibrary });

    // Clean up temp file
    await fs.unlink(tempFilePath).catch(() => {}); // Ignore cleanup errors

    return result;
  } catch (error) {
    // Clean up temp file on error
    await fs.unlink(tempFilePath).catch(() => {});
    throw error;
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