// Shared constants across main and renderer processes
const path = require('path');
const os = require('os');

// Application directories
const APP_NAME = 'image-gallery-manager';
const APP_DATA_DIR = path.join(os.homedir(), '.image-gallery-manager');
const DATABASE_DIR = path.join(APP_DATA_DIR, 'data');
const IMAGES_DIR = path.join(APP_DATA_DIR, 'images');
const THUMBNAILS_DIR = path.join(APP_DATA_DIR, 'thumbnails');
const TEMP_DIR = path.join(APP_DATA_DIR, 'temp');
const LOGS_DIR = path.join(APP_DATA_DIR, 'logs');

// Database files
const DATABASE_FILE = path.join(DATABASE_DIR, 'gallery.db');

// IPC Channels
const IPC_CHANNELS = {
  // Database operations
  DB_INIT: 'db:init',
  DB_QUERY: 'db:query',
  DB_EXECUTE: 'db:execute',

  // Image operations
  IMAGE_LOAD: 'image:load',
  IMAGE_SAVE: 'image:save',
  IMAGE_DELETE: 'image:delete',
  IMAGE_GENERATE_THUMBNAIL: 'image:generate-thumbnail',

  // Ingestion operations
  INGEST_ARCHIVE: 'ingest:archive',
  INGEST_URL: 'ingest:url',
  INGEST_WEBPAGE: 'ingest:webpage',
  INGEST_PROGRESS: 'ingest:progress',

  // Metadata operations
  METADATA_UPDATE: 'metadata:update',
  METADATA_BULK_UPDATE: 'metadata:bulk-update',
  TAGS_GET_ALL: 'tags:get-all',
  TAGS_CREATE: 'tags:create',
  TAGS_UPDATE: 'tags:update',
  TAGS_DELETE: 'tags:delete',

  // Query operations
  QUERY_EXECUTE: 'query:execute',
  QUERY_SAVED_GET: 'query:saved:get',
  QUERY_SAVED_SAVE: 'query:saved:save',
  QUERY_SAVED_DELETE: 'query:saved:delete',

  // Compression operations
  COMPRESSION_ANALYZE: 'compression:analyze',
  COMPRESSION_EXECUTE: 'compression:execute',
  COMPRESSION_PROGRESS: 'compression:progress',

  // UI operations
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_OPEN_DEVTOOLS: 'window:open-devtools',

  // System operations
  SYSTEM_GET_INFO: 'system:get-info',
  SYSTEM_OPEN_EXTERNAL: 'system:open-external'
};

// Tag Categories
const TAG_CATEGORIES = {
  ARTIST: 'artist',
  SERIES: 'series',
  CHARACTER: 'character',
  CLOTHING: 'clothing',
  POSITION: 'position',
  GENERAL: 'general'
};

// Image formats supported
const SUPPORTED_IMAGE_FORMATS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg'
];

// Archive formats supported
const SUPPORTED_ARCHIVE_FORMATS = [
  '.zip', '.rar', '.7z', '.tar.gz', '.tar.bz2'
];

// Default settings
const DEFAULT_SETTINGS = {
  librarySizeLimit: 2, // GB
  autoLoadFromClipboard: true,
  thumbnailSize: 300,
  compressionEnabled: true,
  compressionQuality: 85,
  maxConcurrentOperations: 4,
  theme: 'dark',
  language: 'en'
};

module.exports = {
  APP_NAME,
  APP_DATA_DIR,
  DATABASE_DIR,
  IMAGES_DIR,
  THUMBNAILS_DIR,
  TEMP_DIR,
  LOGS_DIR,
  DATABASE_FILE,
  IPC_CHANNELS,
  TAG_CATEGORIES,
  SUPPORTED_IMAGE_FORMATS,
  SUPPORTED_ARCHIVE_FORMATS,
  DEFAULT_SETTINGS
};
