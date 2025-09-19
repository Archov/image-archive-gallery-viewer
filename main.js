const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const https = require('https');
const http = require('http');
const { createHash } = require('crypto');
const { v4: uuidv4 } = require('uuid');

// Archive extraction libraries
const AdmZip = require('adm-zip');
const unrar = require('node-unrar-js');
const { extractFull } = require('node-7z');

let mainWindow;
const appDataDir = path.join(os.homedir(), '.kemono-gallery');
const cacheDir = path.join(appDataDir, 'cache');
const databaseFile = path.join(appDataDir, 'database.json');
const historyFile = path.join(appDataDir, 'history.json');
const backupDir = path.join(appDataDir, 'backups');
const settingsFile = path.join(appDataDir, 'settings.json');

// In-memory database
let database = {
  archives: {},
  images: {},
  history: [],
  settings: {
    cacheSize: 2, // GB
    autoLoadFromClipboard: true,
    maxHistoryItems: 100,
    allowFullscreenUpscaling: false,
    autoLoadAdjacentArchives: true
  }
};

// Initialize app data directory and load database
async function initializeAppData() {
  try {
    await fs.mkdir(appDataDir, { recursive: true });
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.mkdir(backupDir, { recursive: true });
    await loadDatabase();
  } catch (error) {
    console.error('Failed to initialize app data:', error);
  }
}

async function loadDatabase() {
  try {
    console.log('Loading database from:', databaseFile);
    const data = await fs.readFile(databaseFile, 'utf8');
    const loadedData = JSON.parse(data);
    database = { ...database, ...loadedData };
    console.log(`Database loaded: ${Object.keys(database.archives).length} archives, ${Object.keys(database.images).length} images`);

    // Check if history exists in the database file
    if (database.history && Array.isArray(database.history)) {
      console.log('History found in database.json:', database.history.length, 'items');
    } else {
      // Fallback: load history from separate file if it exists
      try {
        console.log('Loading history from:', historyFile);
        const historyData = await fs.readFile(historyFile, 'utf8');
        const loadedHistory = JSON.parse(historyData);

        if (Array.isArray(loadedHistory)) {
          database.history = loadedHistory;
          console.log('History loaded from separate file:', loadedHistory.length, 'items');
        } else {
          console.log('History file does not contain an array');
        }
      } catch (historyError) {
        console.log('History file not found or invalid:', historyError.message);
        // History will use the default empty array
      }
    }

  } catch (error) {
    console.log('Database not found or invalid, using defaults');
    await saveDatabase();
  }
}

async function saveDatabase() {
  try {
    // Create backup before saving
    await createBackup('database.json');
    await createBackup('history.json');

    await fs.writeFile(databaseFile, JSON.stringify(database, null, 2));

    // Also save history to separate file
    await fs.writeFile(historyFile, JSON.stringify(database.history, null, 2));
  } catch (error) {
    console.error('Failed to save database:', error);
  }
}

async function createBackup(filename) {
  try {
    const sourceFile = path.join(appDataDir, filename);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupFile = path.join(backupDir, `${filename}.${timestamp}.bak`);

    // Check if source file exists
    try {
      await fs.access(sourceFile);
    } catch (error) {
      // File doesn't exist, no need to backup
      return;
    }

    // Copy file to backup
    await fs.copyFile(sourceFile, backupFile);
    console.log(`Created backup: ${backupFile}`);

    // Clean up old backups (keep only last 10)
    await cleanupOldBackups(filename);
  } catch (error) {
    console.error(`Failed to create backup for ${filename}:`, error);
  }
}

async function cleanupOldBackups(filename) {
  try {
    const backupFiles = await fs.readdir(backupDir);
    const relevantBackups = backupFiles
      .filter(file => file.startsWith(filename) && file.endsWith('.bak'))
      .map(file => ({
        name: file,
        path: path.join(backupDir, file),
        timestamp: file.match(/\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.bak$/)?.[1]
      }))
      .filter(item => item.timestamp)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    // Keep only the 10 most recent backups
    if (relevantBackups.length > 10) {
      const toDelete = relevantBackups.slice(10);
      for (const backup of toDelete) {
        await fs.unlink(backup.path);
        console.log(`Cleaned up old backup: ${backup.name}`);
      }
    }
  } catch (error) {
    console.error('Failed to cleanup old backups:', error);
  }
}

// List available backups
async function listBackups() {
  try {
    const backupFiles = await fs.readdir(backupDir);
    const backups = {};

    for (const file of backupFiles) {
      if (file.endsWith('.bak')) {
        const match = file.match(/^(.+)\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.bak$/);
        if (match) {
          const [, filename, timestamp] = match;
          if (!backups[filename]) backups[filename] = [];
          backups[filename].push({
            filename: file,
            timestamp: timestamp,
            path: path.join(backupDir, file)
          });
        }
      }
    }

    // Sort by timestamp
    Object.keys(backups).forEach(key => {
      backups[key].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    });

    return backups;
  } catch (error) {
    console.error('Failed to list backups:', error);
    return {};
  }
}

// Restore from backup
async function restoreBackup(filename, backupTimestamp) {
  try {
    const backupFile = path.join(backupDir, `${filename}.${backupTimestamp}.bak`);
    const targetFile = path.join(appDataDir, filename);

    // Create backup of current file before restoring
    await createBackup(filename);

    // Restore from backup
    await fs.copyFile(backupFile, targetFile);
    console.log(`Restored ${filename} from backup: ${backupFile}`);

    return true;
  } catch (error) {
    console.error(`Failed to restore ${filename} from backup:`, error);
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets/icon.ico'), // Optional: add an icon
    title: 'Kemono Archive Gallery',
    show: false
  });

  mainWindow.loadFile('index.html');
  
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Optional: Open DevTools in development
  // mainWindow.webContents.openDevTools();
}

// Download file from URL with progress tracking
function downloadFile(url, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;

    const request = client.get(url, (response) => {
      if (response.statusCode === 200) {
        const contentLength = parseInt(response.headers['content-length'], 10);
        let downloadedBytes = 0;

        const fileStream = require('fs').createWriteStream(outputPath);

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (onProgress && contentLength) {
            const progress = (downloadedBytes / contentLength) * 100;
            onProgress(progress, downloadedBytes, contentLength);
          }
        });

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });

        fileStream.on('error', reject);
      } else if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirects
        downloadFile(response.headers.location, outputPath, onProgress)
          .then(resolve)
          .catch(reject);
      } else {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
      }
    });

    request.on('error', reject);
    request.timeout = 60000; // 60 second timeout
  });
}

// Extract ZIP archive
async function extractZip(archivePath, extractPath) {
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();
  const images = [];
  
  for (const entry of entries) {
    if (!entry.isDirectory && isImageFile(entry.entryName)) {
      const imageId = uuidv4();
      const imagePath = path.join(extractPath, `${imageId}${path.extname(entry.entryName)}`);
      
      const imageData = entry.getData();
      await fs.writeFile(imagePath, imageData);
      
      images.push({
        id: imageId,
        name: path.basename(entry.entryName),
        path: imagePath,
        url: `file://${imagePath.replace(/\\/g, '/')}`,
        size: imageData ? imageData.length : 0,
        starred: false
      });
    }
  }
  
  return images;
}

// Extract RAR archive
async function extractRar(archivePath, extractPath) {
  return new Promise((resolve, reject) => {
    console.log(`Starting RAR extraction: ${archivePath} -> ${extractPath}`);

    try {
      // Try the correct node-unrar-js API
      const extractor = unrar.createExtractorFromFile(archivePath);

      // Use the correct extraction method
      const extracted = extractor.extract({
        path: extractPath
      });

      console.log('RAR extraction result:', extracted);

      // Check if extraction was successful
      if (extracted && extracted.files) {
        console.log(`RAR extraction: ${extracted.files.length} files extracted`);
      }

      // Scan the extracted directory for images
      scanDirectoryForImages(extractPath).then((images) => {
        console.log(`RAR scan found ${images.length} images in ${extractPath}`);
        resolve(images);
      }).catch((scanError) => {
        console.error('Error scanning RAR directory:', scanError);
        reject(scanError);
      });

    } catch (extractError) {
      console.error('Error extracting RAR file with primary method:', extractError);

      // If the above fails, try an alternative approach
      console.log('Trying alternative RAR extraction method...');
      try {
        // Alternative: use unrar command line tool if available
        const { spawn } = require('child_process');
        const unrarProcess = spawn('unrar', ['x', '-y', archivePath, extractPath], {
          stdio: 'inherit'
        });

        unrarProcess.on('close', (code) => {
          if (code === 0) {
            console.log('RAR extraction with command line tool succeeded');
            scanDirectoryForImages(extractPath).then((images) => {
              console.log(`RAR scan found ${images.length} images in ${extractPath}`);
              resolve(images);
            }).catch(reject);
          } else {
            reject(new Error(`RAR extraction failed with exit code ${code}`));
          }
        });

        unrarProcess.on('error', (error) => {
          console.error('Command line RAR extraction failed:', error);

          // If command line also fails, try 7zip as fallback
          console.log('Trying 7zip as final fallback...');
          try {
            const sevenZipProcess = spawn('7z', ['x', archivePath, `-o${extractPath}`, '-y'], {
              stdio: 'inherit'
            });

            sevenZipProcess.on('close', (code) => {
              if (code === 0) {
                console.log('RAR extraction with 7zip succeeded');
                scanDirectoryForImages(extractPath).then((images) => {
                  console.log(`RAR scan found ${images.length} images in ${extractPath}`);
                  resolve(images);
                }).catch(reject);
              } else {
                reject(new Error('All RAR extraction methods failed. Please install unrar, 7zip, or check file permissions.'));
              }
            });

            sevenZipProcess.on('error', () => {
              reject(new Error('All RAR extraction methods failed. Please install unrar, 7zip, or check file permissions.'));
            });

          } catch (sevenZipError) {
            reject(new Error('All RAR extraction methods failed. Please install unrar, 7zip, or check file permissions.'));
          }
        });

      } catch (fallbackError) {
        console.error('All RAR extraction methods failed:', fallbackError);
        reject(new Error('RAR extraction failed: ' + extractError.message));
      }
    }
  });
}

// Extract 7Z archive
async function extract7z(archivePath, extractPath) {
  return new Promise((resolve, reject) => {
    const images = [];
    
    extractFull(archivePath, extractPath, {
      $progress: true,
      recursive: true
    })
    .on('data', (data) => {
      // Progress updates
    })
    .on('end', async () => {
      try {
        // Scan extracted directory for images
        const extractedImages = await scanDirectoryForImages(extractPath);
        resolve(extractedImages);
      } catch (error) {
        reject(error);
      }
    })
    .on('error', (error) => {
      reject(error);
    });
  });
}

// Recursively scan directory for images
async function scanDirectoryForImages(dirPath, baseDir = dirPath) {
  console.log(`Scanning directory for images: ${dirPath}`);
  const images = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  console.log(`Found ${entries.length} entries in ${dirPath}`);
  
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    console.log(`Processing entry: ${entry.name} (${entry.isDirectory() ? 'directory' : 'file'})`);
    
    if (entry.isDirectory()) {
      console.log(`Recursing into directory: ${fullPath}`);
      const subImages = await scanDirectoryForImages(fullPath, baseDir);
      images.push(...subImages);
    } else if (isImageFile(entry.name)) {
      console.log(`Found image file: ${entry.name}`);
      const stat = await fs.stat(fullPath);
      const imageId = uuidv4();
      
      images.push({
        id: imageId,
        name: entry.name,
        path: fullPath,
        url: `file://${fullPath.replace(/\\/g, '/')}`,
        size: stat ? stat.size : 0,
        starred: false
      });
    } else {
      console.log(`Skipping non-image file: ${entry.name}`);
    }
  }
  
  console.log(`Scan complete: ${images.length} images found in ${dirPath}`);
  return images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// Check if file is an image
function isImageFile(filename) {
  return /\.(avif|webp|png|jpe?g|gif|bmp|tiff?)$/i.test(filename);
}

// Sanitize filename for filesystem
function sanitizeFilename(filename) {
  return filename.replace(/[<>:"/\\|?*]/g, '_');
}

// Cache management functions
async function manageCache(maxSizeBytes) {
  const cacheInfo = await getCacheUsage();

  console.log(`Cache management: current=${(cacheInfo.totalSize / (1024 * 1024 * 1024)).toFixed(2)}GB, limit=${(maxSizeBytes / (1024 * 1024 * 1024)).toFixed(2)}GB`);

  if (cacheInfo.totalSize <= maxSizeBytes) {
    console.log('Cache within limits, no cleanup needed');
    return; // Cache is within limits
  }

  // Get all non-starred archives sorted by last accessed (most recent first)
  const allArchives = Object.values(database.archives)
    .filter(archive => !archive.starred)
    .sort((a, b) => new Date(b.lastAccessed) - new Date(a.lastAccessed));

  if (allArchives.length === 0) {
    return; // No archives to clean up
  }

  // Exclude the most recently accessed archive from cleanup
  const currentArchive = allArchives[0];
  const archivesToClean = allArchives.slice(1);

  // Calculate cache size excluding the current archive
  const currentSize = isNaN(currentArchive.size) ? 0 : (currentArchive.size || 0);
  let cacheSizeExcludingCurrent = cacheInfo.totalSize - currentSize;

  if (cacheSizeExcludingCurrent <= maxSizeBytes) {
    return; // Cache is within limits excluding current archive
  }

  let freedSpace = 0;
  const spaceNeeded = cacheSizeExcludingCurrent - maxSizeBytes;

  for (const archive of archivesToClean) {
    if (freedSpace >= spaceNeeded) break;

    try {
      // Delete archive file and cache directory
      if (archive.archivePath && await fs.access(archive.archivePath).then(() => true).catch(() => false)) {
        await fs.unlink(archive.archivePath);
      }
      await fs.rmdir(archive.cachePath, { recursive: true });
      
      // Remove from database
      delete database.archives[archive.id];

      // Remove associated images
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

async function getCacheUsage() {
  let totalSize = 0;
  let starredCount = 0;

  // Only count non-starred archives for cache size
  const archives = Object.values(database.archives).filter(archive => !archive.starred);

  console.log(`Cache usage check: ${archives.length} non-starred archives in database`);

  for (const archive of archives) {
    const size = isNaN(archive.size) ? 0 : (archive.size || 0);
    console.log(`Archive ${archive.id}: size=${size}, starred=${archive.starred}, path=${archive.archivePath}`);
    totalSize += size;
  }

  // Count starred items separately
  starredCount = Object.values(database.archives).filter(archive => archive.starred).length;

  console.log(`Cache size (non-starred only): ${totalSize} bytes (${(totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB)`);
  console.log(`Starred items: ${starredCount}`);

  return {
    totalSize,  // Only non-starred archives
    starredCount
  };
}

// Get file extension from URL
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

// Main archive loading function
ipcMain.handle('load-archive', async (event, url, cacheSizeLimitGB) => {
  const archiveId = createHash('md5').update(url).digest('hex');
  const cachePath = path.join(cacheDir, archiveId);
  
  try {
    // Check if already cached
    if (database.archives[archiveId]) {
      const archive = database.archives[archiveId];
      archive.lastAccessed = new Date().toISOString();
      await saveDatabase();
      
      // Return cached images
      const images = Object.values(database.images)
        .filter(img => img.archiveId === archiveId)
        .map(img => ({
          id: img.id,
          name: img.name,
          url: img.url,
          starred: img.starred
        }));
      
      return { images, archiveId };
    }
    
    await fs.mkdir(cachePath, { recursive: true });
    
    // Download archive with progress tracking
    const archiveExt = getArchiveExtension(url);
    const archivePath = path.join(cachePath, `archive${archiveExt}`);
    
    // Send progress updates to frontend
    const onProgress = (progress, downloaded, total) => {
      mainWindow.webContents.send('download-progress', {
        archiveId,
        progress: Math.round(progress),
        downloaded,
        total
      });
    };
    
    await downloadFile(url, archivePath, onProgress);
    
    // Get archive size
    const archiveStat = await fs.stat(archivePath);
    console.log(`Remote archive loaded: ${archivePath}, size=${archiveStat.size} bytes (${(archiveStat.size / (1024 * 1024)).toFixed(2)} MB)`);
    
    // Extract based on file type
    let images = [];
    const extractPath = path.join(cachePath, 'extracted');
    await fs.mkdir(extractPath, { recursive: true });
    
    switch (archiveExt.toLowerCase()) {
      case '.zip':
        images = await extractZip(archivePath, extractPath);
        break;
      case '.rar':
        images = await extractRar(archivePath, extractPath);
        break;
      case '.7z':
        images = await extract7z(archivePath, extractPath);
        break;
      default:
        throw new Error('Unsupported archive format');
    }
    
    // Calculate total extracted size
    let totalSize = archiveStat.size;
    for (const image of images) {
      const imageSize = isNaN(image.size) ? 0 : (image.size || 0);
      totalSize += imageSize;
    }
    console.log(`Archive ${archiveId}: archive size=${archiveStat.size}, total with images=${totalSize}, ${images.length} images`);
    
    // Save to database (store archive info instead of extracted images)
    database.archives[archiveId] = {
      id: archiveId,
      url,
      cachePath,
      archivePath, // Store archive path for on-demand extraction
      size: archiveStat.size, // Use archive size instead of extracted size
      lastAccessed: new Date().toISOString(),
      starred: false,
      extractedImages: [] // Will store extracted image info
    };
    
    // Extract and cache image metadata but don't store extracted files
    const imageMetadata = images.map(img => ({
      id: img.id,
      name: img.name,
      size: img.size,
      archiveOffset: 0 // Could be used for RAR seeking, but for now just metadata
    }));
    
    database.archives[archiveId].extractedImages = imageMetadata;
    images.forEach(image => {
      image.archiveId = archiveId;
      database.images[image.id] = image;
    });
    
    await saveDatabase();
    
    // Keep archive file for on-demand extraction
    // await fs.unlink(archivePath); // Remove this line
    
    // Manage cache size
    const cacheSizeBytes = (cacheSizeLimitGB || 2) * 1024 * 1024 * 1024;
    await manageCache(cacheSizeBytes);
    
    // Return image data for frontend
    const responseImages = images.map(img => ({
      id: img.id,
      name: img.name,
      url: img.url,
      starred: img.starred
    }));
    
    return { images: responseImages, archiveId };
    
  } catch (error) {
    // Clean up on error
    try {
      await fs.rmdir(cachePath, { recursive: true });
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    throw error;
  }
});

// Load local archive file
ipcMain.handle('load-local-archive', async (event, filePath) => {
  const archiveId = createHash('md5').update(filePath).digest('hex');
  const cachePath = path.join(cacheDir, archiveId);
  
  try {
    await fs.mkdir(cachePath, { recursive: true });
    
    // Extract based on file type
    let images = [];
    const extractPath = path.join(cachePath, 'extracted');
    await fs.mkdir(extractPath, { recursive: true });
    
    const ext = path.extname(filePath).toLowerCase();
    
    switch (ext) {
      case '.zip':
        images = await extractZip(filePath, extractPath);
        break;
      case '.rar':
        images = await extractRar(filePath, extractPath);
        break;
      case '.7z':
        images = await extract7z(filePath, extractPath);
        break;
      default:
        throw new Error('Unsupported archive format');
    }
    
    // Calculate total size (use archive size only, not extracted size)
    const archiveStat = await fs.stat(filePath);
    let totalSize = archiveStat.size;
    console.log(`Local archive loaded: ${filePath}, size=${archiveStat.size} bytes (${(archiveStat.size / (1024 * 1024)).toFixed(2)} MB)`);
    // Don't add extracted image sizes for consistency with remote archives

    // Save to database (store archive info instead of extracted images)
    database.archives[archiveId] = {
      id: archiveId,
      url: `file://${filePath}`,
      cachePath,
      archivePath: filePath, // For local files, archivePath is the original file
      size: totalSize, // Use archive size only
      lastAccessed: new Date().toISOString(),
      starred: false,
      extractedImages: [] // Will store extracted image info
    };
    
    // Extract and cache image metadata but don't store extracted files
    const imageMetadata = images.map(img => ({
      id: img.id,
      name: img.name,
      size: img.size,
      archiveOffset: 0
    }));
    
    database.archives[archiveId].extractedImages = imageMetadata;
    images.forEach(image => {
      image.archiveId = archiveId;
      database.images[image.id] = image;
    });
    
    await saveDatabase();
    
    // Manage cache size for local archives too
    const cacheSizeBytes = (database.settings.cacheSize || 2) * 1024 * 1024 * 1024;
    await manageCache(cacheSizeBytes);
    
    // Return image data
    const responseImages = images.map(img => ({
      id: img.id,
      name: img.name,
      url: img.url,
      starred: img.starred
    }));
    
    return responseImages;
    
  } catch (error) {
    // Clean up on error
    try {
      await fs.rmdir(cachePath, { recursive: true });
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    throw error;
  }
});

// Settings management
ipcMain.handle('load-settings', async () => {
  console.log('Loading settings:', database.settings);
  return database.settings;
});

ipcMain.handle('save-settings', async (event, settings) => {
  console.log('Saving settings:', settings);
  database.settings = { ...database.settings, ...settings };
  await saveDatabase();
  console.log('Settings saved:', database.settings);
});

// History management
ipcMain.handle('load-history', async () => {
  return database.history.slice().reverse(); // Most recent first
});

ipcMain.handle('add-to-history', async (event, historyItem) => {
  const existingIndex = database.history.findIndex(item => item.url === historyItem.url);
  
  if (existingIndex !== -1) {
    // Update existing entry
    database.history[existingIndex] = { 
      ...database.history[existingIndex], 
      ...historyItem,
      lastAccessed: new Date().toISOString()
    };
  } else {
    // Add new entry
    const newItem = {
      id: uuidv4(),
      starred: false,
      ...historyItem
    };
    database.history.push(newItem);
  }
  
  // Limit history size
  const maxItems = database.settings.maxHistoryItems || 100;
  if (database.history.length > maxItems) {
    // Keep starred items and most recent non-starred items
    const starred = database.history.filter(item => item.starred);
    const nonStarred = database.history
      .filter(item => !item.starred)
      .sort((a, b) => new Date(b.lastAccessed) - new Date(a.lastAccessed))
      .slice(0, maxItems - starred.length);
    
    database.history = [...starred, ...nonStarred];
  }
  
  await saveDatabase();
});

ipcMain.handle('clear-history', async () => {
  database.history = database.history.filter(item => item.starred);
  await saveDatabase();
});

// Image starring
ipcMain.handle('toggle-image-star', async (event, archiveId, imageId) => {
  console.log(`=== STAR TOGGLE REQUEST ===`);
  console.log(`Archive ID: ${archiveId}`);
  console.log(`Image ID: ${imageId}`);

  const image = database.images[imageId];
  const archive = database.archives[archiveId];

  console.log(`Image found: ${!!image}`);
  console.log(`Archive found: ${!!archive}`);

  if (image && archive) {
    console.log(`Before: image.starred = ${image.starred}, archive.starred = ${archive.starred}`);

    image.starred = !image.starred;
    console.log(`After toggle: image.starred = ${image.starred}`);

    // If any image is starred, star the archive too
    const archiveImages = Object.values(database.images).filter(img => img.archiveId === archiveId);
    const hasStarredImages = archiveImages.some(img => img.starred);
    archive.starred = hasStarredImages;

    console.log(`Archive has ${archiveImages.length} images, ${archiveImages.filter(img => img.starred).length} starred`);
    console.log(`Archive starred set to: ${archive.starred}`);

    await saveDatabase();

    console.log(`=== DATABASE SAVED ===`);

    return { starred: image.starred };
  }

  console.log(`ERROR: Image or archive not found!`);
  throw new Error('Image or archive not found');
});

// toggle-history-star
ipcMain.handle('toggle-history-star', async (event, historyId) => {
  console.log(`=== HISTORY STAR TOGGLE REQUEST ===`);
  console.log(`History ID: ${historyId}`);

  const historyItem = database.history.find(h => h.id === historyId);
  console.log(`History item found: ${!!historyItem}`);

  if (historyItem) {
    console.log(`Before: history.starred = ${historyItem.starred}`);

    historyItem.starred = !historyItem.starred;
    console.log(`After: history.starred = ${historyItem.starred}`);

    // Also update the corresponding archive if it exists in the database
    const archiveId = createHash('md5').update(historyItem.url).digest('hex');
    const archive = database.archives[archiveId];

    if (archive) {
      console.log(`Found corresponding archive: ${archiveId}`);
      console.log(`Before: archive.starred = ${archive.starred}`);

      archive.starred = historyItem.starred;
      console.log(`After: archive.starred = ${archive.starred}`);
    } else {
      console.log(`No corresponding archive found for history item`);
    }

    await saveDatabase();
    console.log(`=== HISTORY DATABASE SAVED ===`);

    return { starred: historyItem.starred };
  }

  console.log(`ERROR: History item not found!`);
  throw new Error('History item not found');
});

// Extract individual image on-demand
ipcMain.handle('extract-image', async (event, archiveId, imageId) => {
  const archive = database.archives[archiveId];
  const image = database.images[imageId];
  
  if (!archive || !image) {
    throw new Error('Archive or image not found');
  }
  
  // Check if image is already extracted
  if (await fs.access(image.path).then(() => true).catch(() => false)) {
    return image.url;
  }
  
  // Extract the specific image from archive
  const extractPath = path.dirname(image.path);
  await fs.mkdir(extractPath, { recursive: true });
  
  const archiveExt = path.extname(archive.archivePath).toLowerCase();
  
  try {
    switch (archiveExt) {
      case '.zip':
        await extractSingleImageFromZip(archive.archivePath, image.name, image.path);
        break;
      case '.rar':
        await extractSingleImageFromRar(archive.archivePath, image.name, image.path);
        break;
      case '.7z':
        await extractSingleImageFrom7z(archive.archivePath, image.name, image.path);
        break;
      default:
        throw new Error('Unsupported archive format for on-demand extraction');
    }
    
    return image.url;
  } catch (error) {
    console.error('Failed to extract image on-demand:', error);
    throw error;
  }
});

// Helper functions for extracting single images
async function extractSingleImageFromZip(archivePath, imageName, outputPath) {
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();
  
  for (const entry of entries) {
    if (!entry.isDirectory && entry.entryName === imageName) {
      const imageData = entry.getData();
      await fs.writeFile(outputPath, imageData);
      return;
    }
  }
  
  throw new Error(`Image ${imageName} not found in archive`);
}

async function extractSingleImageFromRar(archivePath, imageName, outputPath) {
  return new Promise((resolve, reject) => {
    const extractor = unrar.createExtractorFromFile({
      filepath: archivePath,
      targetPath: path.dirname(outputPath)
    });

    extractor.extract().then(() => {
      // The image should now be extracted, verify it exists
      fs.access(outputPath).then(() => resolve()).catch(reject);
    }).catch(reject);
  });
}

async function extractSingleImageFrom7z(archivePath, imageName, outputPath) {
  return new Promise((resolve, reject) => {
    extractFull(archivePath, path.dirname(outputPath), {
      $progress: false,
      recursive: true
    })
    .on('end', () => {
      fs.access(outputPath).then(() => resolve()).catch(reject);
    })
    .on('error', reject);
  });
}

// Clear cache
ipcMain.handle('clear-cache', async () => {
  // Only clear non-starred archives
  const archives = Object.values(database.archives).filter(archive => !archive.starred);

  console.log(`Clearing cache: ${archives.length} non-starred archives`);

  for (const archive of archives) {
    try {
      // Delete archive file and cache directory
      if (archive.archivePath && await fs.access(archive.archivePath).then(() => true).catch(() => false)) {
        await fs.unlink(archive.archivePath);
        console.log(`Deleted archive file: ${archive.archivePath}`);
      }
      await fs.rmdir(archive.cachePath, { recursive: true });
      console.log(`Deleted cache directory: ${archive.cachePath}`);

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
  console.log('Cache cleared successfully');
});

// Cache info
ipcMain.handle('get-cache-info', async () => {
  return await getCacheUsage();
});

// Backup management
ipcMain.handle('list-backups', async () => {
  return await listBackups();
});

ipcMain.handle('restore-backup', async (event, filename, timestamp) => {
  const success = await restoreBackup(filename, timestamp);
  if (success) {
    // Reload database after restore
    await loadDatabase();
  }
  return success;
});

// History management - rename and reorder
ipcMain.handle('rename-history-item', async (event, historyId, newName) => {
  const itemIndex = database.history.findIndex(item => item.id === historyId);
  if (itemIndex !== -1) {
    database.history[itemIndex].name = newName;
    await saveDatabase();
    return true;
  }
  return false;
});

ipcMain.handle('reorder-history', async (event, newOrder) => {
  if (Array.isArray(newOrder) && newOrder.length === database.history.length) {
    // Reorder based on the new order array
    const reorderedHistory = [];
    for (const id of newOrder) {
      const item = database.history.find(h => h.id === id);
      if (item) {
        reorderedHistory.push(item);
      }
    }

    if (reorderedHistory.length === database.history.length) {
      database.history = reorderedHistory;
      await saveDatabase();
      return true;
    }
  }
  return false;
});

// App event handlers
app.whenReady().then(() => {
  initializeAppData();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Clean up old extracted images to free space
async function cleanupExtractedImages() {
  const archives = Object.values(database.archives);
  const maxAge = 30 * 60 * 1000; // 30 minutes
  const now = Date.now();

  for (const archive of archives) {
    if (!archive.extractedImages) continue;

    for (const imageMeta of archive.extractedImages) {
      const image = database.images[imageMeta.id];
      if (!image) continue;

      // Check if image file exists and is old
      try {
        const stat = await fs.stat(image.path);
        const age = now - stat.mtime.getTime();

        if (age > maxAge) {
          // Remove old extracted image
          await fs.unlink(image.path);
        }
      } catch (error) {
        // File doesn't exist or can't be accessed, skip
      }
    }
  }
}

// Call cleanup periodically
setInterval(cleanupExtractedImages, 10 * 60 * 1000); // Every 10 minutes

// Handle cleanup on app quit
app.on('before-quit', async () => {
  // Save database one final time
  await saveDatabase();
});