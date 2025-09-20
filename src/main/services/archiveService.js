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
const { manageCache } = require('./cacheService');
const { getDatabase, saveDatabase } = require('./databaseService');
const { cacheDir } = require('../config');

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


async function loadArchiveFromUrl(url, cacheSizeLimitGB, { onProgress } = {}) {
  const archiveId = createHash('md5').update(url).digest('hex');
  const cachePath = path.join(cacheDir, archiveId);
  const database = getDatabase();

  try {
    if (database.archives[archiveId]) {
      const archive = database.archives[archiveId];
      archive.lastAccessed = new Date().toISOString();
      await saveDatabase();

      let databaseDirty = false;

      let archivePath = archive.archivePath;
      if (!archivePath || !(await fileExists(archivePath))) {
        if (archive.url && /^https?:/i.test(archive.url)) {
          const archiveExtFromUrl = getArchiveExtension(archive.url);
          archivePath = path.join(cacheDir, archiveId, "archive" + archiveExtFromUrl);
          await fs.mkdir(path.dirname(archivePath), { recursive: true });
          await downloadFile(archive.url, archivePath);
          archive.archivePath = archivePath;
          databaseDirty = true;
        } else {
          throw new Error("Archive file not available for cached load");
        }
      }
      const archiveExt = path.extname(archivePath).toLowerCase() || getArchiveExtension(archive.url || url);

      const sessionDir = await createSessionExtractDir(archiveId);
      const storedImages = Object.values(database.images).filter(img => img.archiveId === archiveId);
      const extractedImages = await extractArchive(archiveExt, archivePath, sessionDir);

      const lookup = buildExtractedLookup(extractedImages);
      const archiveImagesById = new Map();
      if (!Array.isArray(archive.extractedImages)) {
        archive.extractedImages = [];
      }
      for (const meta of archive.extractedImages) {
        archiveImagesById.set(meta.id, meta);
      }

      const sessionImages = [];
      const unmatchedImages = [];

      for (const imageMeta of storedImages) {
        const match = findExtractedMatch(imageMeta, lookup);
        if (match) {
          const imageUrl = match.url || normalizeFileUrl(match.path);
          sessionImages.push({
            id: imageMeta.id,
            name: imageMeta.name,
            url: imageUrl,
            starred: Boolean(imageMeta.starred),
            archiveName: archive.displayName || archive.url || "Archive"
          });

          const imageRecord = database.images[imageMeta.id];
          if (imageRecord) {
            const normalizedRelative = (match.relativePath || match.originalName || imageRecord.relativePath || imageRecord.originalName || "").replace(/\\/g, "/");
            imageRecord.relativePath = normalizedRelative;
            databaseDirty = true;
          }

          const archiveMeta = archiveImagesById.get(imageMeta.id);
          if (archiveMeta) {
            const archiveRelative = (match.relativePath || match.originalName || '').replace(/\\/g, '/');
            if (archiveRelative && archiveMeta.relativePath !== archiveRelative) {
              archiveMeta.relativePath = archiveRelative;
              databaseDirty = true;
            }
          }
        } else {
          unmatchedImages.push(imageMeta);
        }
      }

      if (unmatchedImages.length > 0) {
        for (const imageMeta of unmatchedImages) {
          const { filePath, entryName } = buildSessionOutputPath(sessionDir, imageMeta);
          try {
            await extractEntryToFile(archivePath, archiveExt, entryName, filePath);
            sessionImages.push({
              id: imageMeta.id,
              name: imageMeta.name,
              url: normalizeFileUrl(filePath),
              starred: Boolean(imageMeta.starred),
              archiveName: archive.displayName || archive.url || "Archive"
            });
          } catch (error) {
            console.error("Failed to restore image " + imageMeta.name + ":", error);
          }
        }
      }

      if (databaseDirty) {
        await saveDatabase();
      }

      return { images: sessionImages, archiveId };
    }

    await fs.mkdir(cachePath, { recursive: true });

    const archiveExt = getArchiveExtension(url);
    const archivePath = path.join(cachePath, `archive${archiveExt}`);

    await downloadFile(url, archivePath, onProgress);

    const archiveStat = await fs.stat(archivePath);
    console.log(`Remote archive loaded: ${archivePath}, size=${archiveStat.size} bytes (${(archiveStat.size / (1024 * 1024)).toFixed(2)} MB)`);

    const sessionDir = await createSessionExtractDir(archiveId);
    const extractedImages = await extractArchive(archiveExt, archivePath, sessionDir);

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

    database.archives[archiveId] = {
      id: archiveId,
      url,
      cachePath,
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

    const cacheSizeBytes = (cacheSizeLimitGB || 2) * 1024 * 1024 * 1024;
    await manageCache(cacheSizeBytes);

    return { images: sessionImages, archiveId };
  } catch (error) {
    await cleanupCacheDirectory(cachePath);
    throw error;
  }
}


async function loadLocalArchive(filePath, cacheSizeGB) {
  const archiveId = createHash('md5').update(filePath).digest('hex');
  const cachePath = path.join(cacheDir, archiveId);
  const database = getDatabase();

  try {
    const archiveStat = await fs.stat(filePath);
    const sessionDir = await createSessionExtractDir(archiveId);
    const ext = path.extname(filePath).toLowerCase();

    const extractedImages = await extractArchive(ext, filePath, sessionDir);

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

    database.archives[archiveId] = {
      id: archiveId,
      url: `file://${filePath}`,
      cachePath,
      archivePath: filePath,
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

    const cacheSizeBytes = (cacheSizeGB || database.settings.cacheSize || 2) * 1024 * 1024 * 1024;
    await manageCache(cacheSizeBytes);

    return sessionImages;
  } catch (error) {
    await cleanupCacheDirectory(cachePath);
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
      archivePath = path.join(cacheDir, archiveId, `archive${archiveExt}`);
      await fs.mkdir(path.dirname(archivePath), { recursive: true });
      await downloadFile(archive.url, archivePath);
      archive.archivePath = archivePath;
      await saveDatabase();
    } else {
      throw new Error('Archive file not available for extraction');
    }
  }

  const archiveExt = path.extname(archivePath).toLowerCase() || getArchiveExtension(archive.url || '');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kemono-image-'));
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

async function cleanupCacheDirectory(targetPath) {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch (cleanupError) {
    console.warn('Failed to clean up cache directory:', cleanupError.message);
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
