const fs = require('fs').promises;
const { fileURLToPath } = require('url');
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
  sanitizeFilename
} = require('./extractionService');
const { downloadFile } = require('./downloadService');
const { manageLibrary, clearLibrary, getLibraryUsage } = require('./libraryService');
const { getDatabase, saveDatabase } = require('./databaseService');
const { libraryDir } = require('../config');

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
  const baseDir = path.join(os.tmpdir(), 'archive-gallery', archiveId);
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
    if (database.archives[archiveId]) {
      const archive = database.archives[archiveId];
      archive.lastAccessed = new Date().toISOString();
      await saveDatabase();

      // Check if archive file exists
      if (!archive.archivePath || !(await fileExists(archive.archivePath))) {
        console.warn(`Archive file not found at ${archive.archivePath}, re-downloading...`);
        // Remove invalid archive entry and let it fall through to re-download
        delete database.archives[archiveId];
        await saveDatabase();
        // Continue to re-download the archive
      } else {
        const sessionDir = await createSessionExtractDir(archiveId);
        const extractedImages = await extractArchiveToTemp(archive.archivePath, sessionDir);

        const sessionImages = extractedImages.map(img => ({
          id: img.id,
          name: img.name,
          url: img.url,
          starred: Boolean(img.starred),
          archiveName: archive.displayName || archive.url || "Archive"
        }));

        return { images: sessionImages, archiveId };
      }
    }

    const archiveExt = getArchiveExtension(url);
    const archivePath = path.join(libraryDir, `${archiveId}${archiveExt}`);
    await fs.mkdir(libraryDir, { recursive: true });

    await downloadFile(url, archivePath, onProgress);
    const archiveStat = await fs.stat(archivePath);
    console.log(`Remote archive loaded: ${archivePath}, size=${archiveStat.size} bytes (${(archiveStat.size / (1024 * 1024)).toFixed(2)} MB)`);

    const metadata = await getArchiveMetadata(archivePath);

    database.archives[archiveId] = {
      id: archiveId,
      url,
      archivePath,
      size: archiveStat.size,
      lastAccessed: new Date().toISOString(),
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

    const librarySizeBytes = (librarySizeLimitGB || 2) * 1024 * 1024 * 1024;
    await manageLibrary(librarySizeBytes);

    const sessionDir = await createSessionExtractDir(archiveId);
    const extractedImages = await extractArchiveToTemp(archivePath, sessionDir);

    const sessionImages = extractedImages.map(img => ({
      id: img.id,
      name: img.name,
      url: img.url,
      starred: Boolean(img.starred),
      archiveName: path.basename(url)
    }));

    return { images: sessionImages, archiveId };
  } catch (error) {
    throw error;
  }
}

async function loadLocalArchive(filePath, librarySizeGB) {
  const archiveId = createHash('md5').update(filePath).digest('hex');
  const database = getDatabase();

  try {
    if (database.archives[archiveId]) {
      const archive = database.archives[archiveId];
      archive.lastAccessed = new Date().toISOString();
      await saveDatabase();

      // Check if archive file exists
      if (!archive.archivePath || !(await fileExists(archive.archivePath))) {
        console.warn(`Archive file not found at ${archive.archivePath}, re-processing...`);
        // Remove invalid archive entry and let it fall through to re-process
        delete database.archives[archiveId];
        await saveDatabase();
        // Continue to re-process the local archive
      } else {
        const sessionDir = await createSessionExtractDir(archiveId);
        const extractedImages = await extractArchiveToTemp(archive.archivePath, sessionDir);

        const sessionImages = extractedImages.map(img => ({
          id: img.id,
          name: img.name,
          url: img.url,
          starred: Boolean(img.starred),
          archiveName: archive.displayName || path.basename(filePath)
        }));

        return sessionImages;
      }
    }

    const choice = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Move to Library', 'Copy to Library', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Add Archive to Library',
      message: `Do you want to move or copy "${path.basename(filePath)}" to the library?`
    });

    if (choice.response === 2) { // Cancel
      throw new Error('User cancelled archive import');
    }

    const shouldMove = choice.response === 0;

    const archiveExt = path.extname(filePath);
    const archivePath = path.join(libraryDir, `${archiveId}${archiveExt}`);
    await fs.mkdir(libraryDir, { recursive: true });

    if (shouldMove) {
      await fs.rename(filePath, archivePath);
      console.log(`Local archive moved to library: ${archivePath}`);
    } else {
      await fs.copyFile(filePath, archivePath);
      console.log(`Local archive copied to library: ${archivePath}`);
    }

    const archiveStat = await fs.stat(archivePath);

    const metadata = await getArchiveMetadata(archivePath);

    database.archives[archiveId] = {
      id: archiveId,
      url: `file://${filePath}`,
      archivePath,
      size: archiveStat.size,
      lastAccessed: new Date().toISOString(),
      starred: false,
      displayName: path.basename(filePath),
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

    const sessionDir = await createSessionExtractDir(archiveId);
    const extractedImages = await extractArchiveToTemp(archivePath, sessionDir);

    const sessionImages = extractedImages.map(img => ({
      id: img.id,
      name: img.name,
      url: img.url,
      starred: Boolean(img.starred),
      archiveName: path.basename(filePath)
    }));

    const librarySizeBytes = (librarySizeGB || 2) * 1024 * 1024 * 1024;
    await manageLibrary(librarySizeBytes);

    return sessionImages;
  } catch (error) {
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

  let archivePath = archive.archivePath;
  if (!archivePath || !(await fileExists(archivePath))) {
    if (archive.url && /^https?:/i.test(archive.url)) {
      const archiveExt = getArchiveExtension(archive.url);
      archivePath = path.join(libraryDir, `${archiveId}${archiveExt}`);
      await fs.mkdir(libraryDir, { recursive: true });
      await downloadFile(archive.url, archivePath);
      archive.archivePath = archivePath;
      await saveDatabase();
    } else {
      throw new Error('Archive file not available for extraction');
    }
  }

  const archiveExt = path.extname(archivePath).toLowerCase() || getArchiveExtension(archive.url || '');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-image-'));
  const entryName = (image.originalName || image.name || String(image.id)).replace(/\\/g, '/');
  const ext = path.extname(entryName) || '.img';
  const safeName = sanitizeFilename(path.basename(entryName, ext)) || image.id;
  const outputPath = path.join(tempDir, `${safeName}-${image.id}${ext}`);

  await extractEntryToFile(archivePath, archiveExt, entryName, outputPath);

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
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-metadata-'));
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

async function cleanupLibraryDirectory(targetPath) {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch (cleanupError) {
    console.warn('Failed to clean up library directory:', cleanupError.message);
  }
}

function normalizeLookupKey(value) {
  if (!value) {
    return null;
  }

  return value
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .trim()
    .toLowerCase();
}

function addToLookupBucket(map, key, image) {
  if (!key) {
    return;
  }
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(image);
}

function takeFromLookupBucket(map, key) {
  if (!key) {
    return null;
  }
  const bucket = map.get(key);
  if (!bucket || bucket.length === 0) {
    return null;
  }
  const value = bucket.shift();
  if (bucket.length === 0) {
    map.delete(key);
  }
  return value;
}

function buildExtractedLookup(images) {
  const byOriginal = new Map();
  const byRelative = new Map();
  const byFilename = new Map();

  for (const image of images) {
    const originalKey = normalizeLookupKey(image.originalName);
    addToLookupBucket(byOriginal, originalKey, image);

    const relativeKey = normalizeLookupKey(image.relativePath);
    if (relativeKey && relativeKey !== originalKey) {
      addToLookupBucket(byRelative, relativeKey, image);
    }

    const filename = path.basename(image.relativePath || image.originalName || image.name || '');
    const filenameKey = normalizeLookupKey(filename);
    addToLookupBucket(byFilename, filenameKey, image);
  }

  return { byOriginal, byRelative, byFilename };
}

function findExtractedMatch(imageMeta, lookup) {
  const originalKey = normalizeLookupKey(imageMeta.originalName);
  let match = takeFromLookupBucket(lookup.byOriginal, originalKey);

  if (!match) {
    const relativeKey = normalizeLookupKey(imageMeta.relativePath);
    match = takeFromLookupBucket(lookup.byRelative, relativeKey);
  }

  if (!match) {
    const name = path.basename(imageMeta.relativePath || imageMeta.originalName || imageMeta.name || '');
    const fileKey = normalizeLookupKey(name);
    match = takeFromLookupBucket(lookup.byFilename, fileKey);
  }

  return match || null;
}

function mapImageForResponse(img) {
  return {
    id: img.id,
    name: img.name,
    url: img.url,
    starred: Boolean(img.starred),
    archiveName: img.archiveName
  };
}

module.exports = {
  loadArchiveFromUrl,
  loadLocalArchive,
  extractImage,
  toggleImageStar
};
