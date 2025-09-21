const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const AdmZip = require('adm-zip');
const unrar = require('node-unrar-js');
const { extractFull } = require('node-7z');
const { v4: uuidv4 } = require('uuid');

function tryExtractWithCommand(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: "ignore" });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
    proc.on('error', reject);
  });
}

async function extractZip(archivePath, extractPath) {
  console.log(`Extracting ZIP archive: ${archivePath}`);
  
  try {
    const zip = new AdmZip(archivePath);
    const entries = zip.getEntries();
    const images = [];
    const usedRelativePaths = new Set();

    console.log(`Found ${entries.length} entries in archive`);
    
    if (entries.length === 0) {
      console.warn('Archive appears to be empty');
      return images;
    }
  
  for (const entry of entries) {
    if (entry.isDirectory) {
      console.log(`Skipping directory: ${entry.entryName}`);
      continue;
    }
    const entryName = entry.entryName.replace(/\\/g, '/');
    console.log(`Processing entry: ${entryName}`);
    
    if (!isImageFile(entryName)) {
      console.log(`Skipping non-image file: ${entryName}`);
      continue;
    }
    
    console.log(`Found image file: ${entryName}`);

    const { outputPath, relativePath } = await resolveEntryOutputPath(
      extractPath,
      entryName,
      usedRelativePaths
    );

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const imageData = entry.getData();
    await fs.writeFile(outputPath, imageData);
    const stat = await fs.stat(outputPath);

    images.push({
      id: uuidv4(),
      name: path.basename(relativePath),
      originalName: entryName,
      relativePath,
      path: outputPath,
      url: `file://${outputPath.replace(/\\/g, '/')}`,
      size: stat ? stat.size : imageData.length,
      starred: false
    });
  }

    console.log(`Extraction complete. Found ${images.length} images.`);
    return images.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }));
  } catch (error) {
    console.error(`Error extracting ZIP archive ${archivePath}:`, error);
    throw new Error(`Failed to extract ZIP archive: ${error.message}`);
  }
}

async function extractRar(archivePath, extractPath) {
  return new Promise((resolve, reject) => {
    console.log(`Starting RAR extraction: ${archivePath} -> ${extractPath}`);

    try {
      const extractor = unrar.createExtractorFromFile(archivePath);
      const extracted = extractor.extract({ path: extractPath });

      if (extracted && extracted.files) {
        console.log(`RAR extraction: ${extracted.files.length} files extracted`);
      }

      scanDirectoryForImages(extractPath)
        .then(resolve)
        .catch(reject);
    } catch (extractError) {
      console.error('Error extracting RAR file with primary method:', extractError);
      console.log('Trying alternative RAR extraction method...');

      try {
        const unrarProcess = spawn('unrar', ['x', '-y', archivePath, extractPath], { stdio: 'inherit' });

        unrarProcess.on('close', (code) => {
          if (code === 0) {
            scanDirectoryForImages(extractPath)
              .then(resolve)
              .catch(reject);
          } else {
            reject(new Error(`RAR extraction failed with exit code ${code}`));
          }
        });

        unrarProcess.on('error', (error) => {
          console.error('Command line RAR extraction failed:', error);
          console.log('Trying 7zip as final fallback...');

          try {
            const sevenZipProcess = spawn('7z', ['x', archivePath, `-o${extractPath}`, '-y'], { stdio: 'inherit' });

            sevenZipProcess.on('close', (code) => {
              if (code === 0) {
                scanDirectoryForImages(extractPath)
                  .then(resolve)
                  .catch(reject);
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
        reject(new Error(`RAR extraction failed: ${extractError.message}`));
      }
    }
  });
}

async function extract7z(archivePath, extractPath) {
  return new Promise((resolve, reject) => {
    extractFull(archivePath, extractPath, {
      $progress: true,
      recursive: true
    })
      .on('data', () => {
        // progress updates not needed here
      })
      .on('end', async () => {
        try {
          const images = await scanDirectoryForImages(extractPath);
          resolve(images);
        } catch (error) {
          reject(error);
        }
      })
      .on('error', reject);
  });
}

async function scanDirectoryForImages(dirPath, baseDir = dirPath) {
  console.log(`Scanning directory for images: ${dirPath}`);
  const images = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const nested = await scanDirectoryForImages(fullPath, baseDir);
      images.push(...nested);
      continue;
    }

    if (!isImageFile(entry.name)) {
      continue;
    }

    const stat = await fs.stat(fullPath);
    const imageId = uuidv4();
    const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    images.push({
      id: imageId,
      name: entry.name,
      originalName: relativePath,
      relativePath,
      path: fullPath,
      url: `file://${fullPath.replace(/\\/g, '/')}`,
      size: stat ? stat.size : 0,
      starred: false
    });
  }

  return images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function isImageFile(filename) {
  return /\.(avif|webp|png|jpe?g|gif|bmp|tiff?|jfif|jp2|j2k|j2c|jpc|jpx|ico|psd|svg)$/i.test(filename);
}

function sanitizeFilename(filename) {
  return filename.replace(/[<>:"/\\|?*]/g, '_');
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    return false;
  }
}

async function resolveEntryOutputPath(rootDir, entryName, usedRelativePaths) {
  const normalized = entryName.replace(/\\/g, '/');
  const rawSegments = normalized.split('/').filter(Boolean);
  const originalFilename = rawSegments.length ? rawSegments[rawSegments.length - 1] : entryName;
  const ext = path.extname(originalFilename) || '.img';
  const baseName = path.basename(originalFilename, ext);
  const safeBase = sanitizeFilename(baseName) || 'image';
  const safeExt = ext || '.img';

  const sanitizedDirs = rawSegments.slice(0, -1).map(segment => sanitizeFilename(segment)).filter(Boolean);
  const resolvedRoot = path.resolve(rootDir);

  let fileName = `${safeBase}${safeExt}`;
  let relativeSegments = [...sanitizedDirs, fileName];
  let relativePath = relativeSegments.join('/');
  let outputPath = path.join(rootDir, ...relativeSegments);
  let counter = 1;

  while (usedRelativePaths.has(relativePath) || await pathExists(outputPath)) {
    fileName = `${safeBase}-${counter}${safeExt}`;
    relativeSegments = [...sanitizedDirs, fileName];
    relativePath = relativeSegments.join('/');
    outputPath = path.join(rootDir, ...relativeSegments);
    counter += 1;
  }

  const resolvedOutput = path.resolve(outputPath);
  if (!resolvedOutput.startsWith(resolvedRoot + path.sep) && resolvedOutput !== resolvedRoot) {
    throw new Error(`Resolved path escapes extraction directory: ${entryName}`);
  }

  usedRelativePaths.add(relativePath);

  return { outputPath: resolvedOutput, relativePath };
}

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
  return new Promise(async (resolve, reject) => {
    const targetDir = path.dirname(outputPath);

    try {
      const extractor = unrar.createExtractorFromFile({ filepath: archivePath });
      const result = extractor.extract({ files: [imageName] });
      const files = result && result.files ? result.files : [];
      const match = files.find(file => file.type === 'extracted' && file.fileHeader.name === imageName);
      if (!match || !match.extraction) {
        throw new Error(`Image ${imageName} not found in archive`);
      }

      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(outputPath, match.extraction);
      resolve();
    } catch (primaryError) {
      try {
        await fs.mkdir(targetDir, { recursive: true });
        await tryExtractWithCommand('unrar', ['e', '-y', archivePath, imageName, targetDir]);
        await fs.access(outputPath);
        resolve();
      } catch (unrarError) {
        try {
          await tryExtractWithCommand('7z', ['e', archivePath, imageName, `-o${targetDir}`, '-y']);
          await fs.access(outputPath);
          resolve();
        } catch (fallbackError) {
          reject(fallbackError);
        }
      }
    }
  });
}

async function extractSingleImageFrom7z(archivePath, imageName, outputPath) {
  return new Promise((resolve, reject) => {
    extractFull(archivePath, path.dirname(outputPath), {
      $progress: false,
      recursive: true
    })
      .on('end', async () => {
        try {
          await fs.access(outputPath);
          resolve();
        } catch (error) {
          reject(error);
        }
      })
      .on('error', reject);
  });
}

async function listArchiveContents(archivePath) {
  console.log(`Listing contents of archive: ${archivePath}`);
  
  const ext = path.extname(archivePath).toLowerCase();
  
  if (ext === '.zip') {
    try {
      const zip = new AdmZip(archivePath);
      const entries = zip.getEntries();
      
      console.log(`Archive contains ${entries.length} entries:`);
      entries.forEach((entry, index) => {
        console.log(`  ${index + 1}. ${entry.entryName} (${entry.isDirectory ? 'directory' : 'file'})`);
        if (!entry.isDirectory) {
          const isImage = isImageFile(entry.entryName);
          console.log(`     -> ${isImage ? 'IMAGE FILE' : 'not an image'}`);
        }
      });
      
      return entries.map(entry => ({
        name: entry.entryName,
        isDirectory: entry.isDirectory,
        isImage: !entry.isDirectory && isImageFile(entry.entryName)
      }));
    } catch (error) {
      console.error(`Error reading ZIP archive: ${error.message}`);
      throw error;
    }
  } else {
    console.log(`Archive format ${ext} not supported for listing`);
    return [];
  }
}

module.exports = {
  extractZip,
  extractRar,
  extract7z,
  extractSingleImageFromZip,
  extractSingleImageFromRar,
  extractSingleImageFrom7z,
  scanDirectoryForImages,
  sanitizeFilename,
  isImageFile,
  listArchiveContents
};

