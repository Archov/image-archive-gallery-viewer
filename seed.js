const fs = require('fs').promises;
const path = require('path');

console.log('🌱 Seeding image gallery with REAL cached files...\n');

// File paths
const appDataDir = path.join(process.env.USERPROFILE || process.env.HOME, '.archive-image-gallery');
const cacheDir = path.join(appDataDir, 'cache');
const databasePath = path.join(appDataDir, 'database.json');
const historyPath = path.join(appDataDir, 'history.json');

console.log(`📁 App data directory: ${appDataDir}`);
console.log(`📁 Cache directory: ${cacheDir}\n`);

// Function to scan cache directory for actual archive files
async function scanRealCache() {
  try {
    if (!await fileExists(cacheDir)) {
      console.log('❌ Cache directory does not exist');
      return [];
    }

    const entries = await fs.readdir(cacheDir);
    const cacheItems = [];

    for (const entry of entries) {
      const fullPath = path.join(cacheDir, entry);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          const files = await fs.readdir(fullPath);
          const archiveFile = files.find(f => f.includes('archive'));

          if (archiveFile) {
            const archivePath = path.join(fullPath, archiveFile);
            const archiveStat = await fs.stat(archivePath);

            cacheItems.push({
              hash: entry,
              cachePath: fullPath,
              archiveFile: archiveFile,
              archivePath: archivePath,
              size: archiveStat.size,
              mtime: archiveStat.mtime,
              extension: path.extname(archiveFile).toLowerCase()
            });
          }
        }
      } catch (err) {
        console.log(`⚠️  Skipping inaccessible cache dir: ${entry}`);
      }
    }

    console.log(`📦 Found ${cacheItems.length} REAL cached archives`);
    return cacheItems.sort((a, b) => b.mtime - a.mtime); // Most recent first
  } catch (error) {
    console.error('❌ Error scanning cache:', error.message);
    return [];
  }
}

// Helper function to check if file/directory exists
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Generate history entries from REAL cached files
function generateRealHistory(cacheItems) {
  const history = [];

  cacheItems.forEach((item, index) => {
    // Create file:// URL pointing to the actual cached archive
    const fileUrl = `file://${item.archivePath.replace(/\\/g, '/')}`;

    // Generate a descriptive name based on the hash and file type
    const fileType = item.extension === '.zip' ? 'ZIP' :
                     item.extension === '.rar' ? 'RAR' :
                     item.extension === '.7z' ? '7Z' : 'Archive';

    const name = `${fileType} Archive ${index + 1}`;

    // Estimate image count based on file size (rough approximation)
    const sizeMB = item.size / (1024 * 1024);
    const estimatedImages = Math.max(5, Math.min(200, Math.floor(sizeMB * 2)));

    history.push({
      id: item.hash,
      name: name,
      url: fileUrl,
      imageCount: estimatedImages,
      lastAccessed: item.mtime.toISOString(),
      starred: index < 2, // First 2 are starred
      fileSize: item.size,
      fileType: item.extension
    });
  });

  return history;
}

// Main seeding function
async function seedWithRealFiles() {
  try {
    console.log('🔍 Scanning for REAL cached archive files...');
    const cacheItems = await scanRealCache();

    if (cacheItems.length === 0) {
      console.log('❌ No cached archives found!');
      console.log('💡 Make sure you have archives cached in:', cacheDir);
      return;
    }

    console.log('📝 Generating history from REAL files...');
    const history = generateRealHistory(cacheItems);

    // Read current database or create default
    let database = {
      archives: {},
      images: {},
      history: [],
      settings: {
        cacheSize: 2,
        autoLoadFromClipboard: true,
        maxHistoryItems: 100,
        allowFullscreenUpscaling: false,
        autoLoadAdjacentArchives: true
      }
    };

    if (await fileExists(databasePath)) {
      try {
        const data = await fs.readFile(databasePath, 'utf8');
        const existingDb = JSON.parse(data);
        database = { ...database, ...existingDb };
        console.log('📖 Read existing database.json');
      } catch (error) {
        console.log('⚠️  Could not read existing database.json, using defaults');
      }
    }

    // Update database with history
    database.history = history;

    // Write database.json
    await fs.writeFile(databasePath, JSON.stringify(database, null, 2));
    console.log(`✅ Updated ${databasePath}`);

    // Write standalone history.json
    await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
    console.log(`✅ Updated ${historyPath}`);

    console.log(`\n🎉 Successfully seeded ${history.length} history entries from REAL cached files!`);
    console.log('\n📋 Your cached archives:');
    history.slice(0, 5).forEach((item, index) => {
      const sizeMB = (item.fileSize / (1024 * 1024)).toFixed(1);
      console.log(`   ${index + 1}. ${item.name} (${item.imageCount} images, ${sizeMB}MB) ${item.starred ? '⭐' : ''}`);
      console.log(`      📁 ${item.url.replace('file://', '')}`);
    });
    if (history.length > 5) {
      console.log(`   ... and ${history.length - 5} more`);
    }

    console.log('\n🚀 Your image gallery app is now ready with REAL cached archives!');

  } catch (error) {
    console.error('❌ Error seeding database:', error.message);
    process.exit(1);
  }
}

// Run the seed script
seedWithRealFiles();
