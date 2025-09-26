const Database = require('better-sqlite3');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config');
const {
  DEFAULT_SETTINGS
} = require('../shared/constants');

class DatabaseService {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // Ensure database directory exists
      await fs.mkdir(config.paths.database, { recursive: true });

      // Open database
      const databaseFile = path.join(config.paths.database, 'gallery.db');
      this.db = new Database(databaseFile);

      // Enforce foreign key constraints
      this.db.pragma('foreign_keys = ON');

      // Enable WAL mode for better concurrency
      try {
        this.db.pragma('journal_mode = WAL');
      } catch (error) {
        console.warn('Failed to enable WAL mode, falling back to default journal mode:', error.message);
        // WAL mode failure is not fatal, continue with default mode
      }

      // Create tables
      this.createTables();

      // Initialize default data
      this.initializeDefaultData();

      this.initialized = true;
      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  createTables() {
    // Images table - core entity
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        original_filename TEXT,
        file_path TEXT NOT NULL,
        thumbnail_path TEXT,
        file_size INTEGER,
        width INTEGER,
        height INTEGER,
        format TEXT,
        imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        source_url TEXT,
        source_type TEXT CHECK(source_type IN ('archive', 'webpage', 'direct')),
        archive_id TEXT,
        set_id TEXT,
        set_order INTEGER,
        is_favorite BOOLEAN DEFAULT 0,
        title TEXT,
        description TEXT,
        artist TEXT,
        series TEXT,
        FOREIGN KEY (archive_id) REFERENCES archives(id),
        FOREIGN KEY (set_id) REFERENCES sets(id)
      )
    `);

    // Tags table - normalized for efficiency
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        category TEXT CHECK(category IN ('artist', 'series', 'character', 'clothing', 'position', 'general')),
        color TEXT,
        usage_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Image-Tag relationships (many-to-many)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS image_tags (
        image_id TEXT,
        tag_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (image_id, tag_id),
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      )
    `);

    // Archives table - for batch imports
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS archives (
        id TEXT PRIMARY KEY,
        original_path TEXT,
        extracted_path TEXT,
        file_size INTEGER,
        image_count INTEGER DEFAULT 0,
        source_url TEXT,
        downloaded_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Sets table - for grouping related images
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        source_type TEXT,
        source_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Settings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Full-text search virtual table
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS images_fts USING fts5(
        filename, title, description, artist, series,
        content=images, content_rowid=rowid
      )
    `);

    // Triggers for FTS synchronization
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS images_fts_insert AFTER INSERT ON images
      BEGIN
        INSERT INTO images_fts(rowid, filename, title, description, artist, series)
        VALUES (new.rowid, new.filename, new.title, new.description, new.artist, new.series);
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS images_fts_delete AFTER DELETE ON images
      BEGIN
        DELETE FROM images_fts WHERE rowid = old.rowid;
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS images_fts_update AFTER UPDATE ON images
      BEGIN
        UPDATE images_fts SET
          filename = new.filename,
          title = new.title,
          description = new.description,
          artist = new.artist,
          series = new.series
        WHERE rowid = new.rowid;
      END
    `);

    // Indexes for performance
    this.createIndexes();
  }

  createIndexes() {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_images_favorite ON images(is_favorite);
      CREATE INDEX IF NOT EXISTS idx_images_set ON images(set_id, set_order);
      CREATE INDEX IF NOT EXISTS idx_images_source ON images(source_type);
      CREATE INDEX IF NOT EXISTS idx_images_imported ON images(imported_at);
      CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(category);
      CREATE INDEX IF NOT EXISTS idx_tags_usage ON tags(usage_count DESC);
      CREATE INDEX IF NOT EXISTS idx_image_tags_tag ON image_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_image_tags_image ON image_tags(image_id);
    `);
  }

  initializeDefaultData() {
    // Insert default settings
    const insertSetting = this.db.prepare(`
      INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
    `);

    Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => {
      insertSetting.run(key, JSON.stringify(value));
    });

    // Create default tags
    const insertTag = this.db.prepare(`
      INSERT OR IGNORE INTO tags (id, name, category, color) VALUES (?, ?, ?, ?)
    `);

    const defaultTags = [
      ['tag-favorite', 'Favorite', 'general', '#ff6b6b'],
      ['tag-nsfw', 'NSFW', 'general', '#ff4757'],
      ['tag-uncategorized', 'Uncategorized', 'general', '#3742fa']
    ];

    defaultTags.forEach(([id, name, category, color]) => {
      insertTag.run(id, name, category, color);
    });
  }

  // Prepared statements for common operations
  getStatements() {
    if (!this.statements) {
      this.statements = {
        // Image operations
        insertImage: this.db.prepare(`
          INSERT INTO images (id, filename, original_filename, file_path, thumbnail_path,
                            file_size, width, height, format, source_url, source_type,
                            archive_id, set_id, set_order, title, description, artist, series)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),

        updateImage: this.db.prepare(`
          UPDATE images SET
            filename = ?, original_filename = ?, file_path = ?, thumbnail_path = ?,
            file_size = ?, width = ?, height = ?, format = ?, source_url = ?,
            source_type = ?, archive_id = ?, set_id = ?, set_order = ?,
            title = ?, description = ?, artist = ?, series = ?,
            modified_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `),

        getImage: this.db.prepare(`
          SELECT * FROM images WHERE id = ?
        `),

        deleteImage: this.db.prepare(`
          DELETE FROM images WHERE id = ?
        `),

        // Tag operations
        insertTag: this.db.prepare(`
          INSERT INTO tags (id, name, category, color)
          VALUES (?, ?, ?, ?)
        `),

        getTag: this.db.prepare(`
          SELECT * FROM tags WHERE id = ?
        `),

        getAllTags: this.db.prepare(`
          SELECT * FROM tags ORDER BY usage_count DESC, name ASC
        `),

        updateTagUsage: this.db.prepare(`
          UPDATE tags SET usage_count = usage_count + ? WHERE id = ?
        `),

        // Settings operations
        getSetting: this.db.prepare(`
          SELECT value FROM settings WHERE key = ?
        `),

        setSetting: this.db.prepare(`
          INSERT OR REPLACE INTO settings (key, value, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
        `)
      };
    }

    return this.statements;
  }

  // Transaction wrapper
  transaction(callback) {
    return this.db.transaction(callback);
  }

  // Close database connection
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }
}

// Export singleton instance
const databaseService = new DatabaseService();

module.exports = databaseService;
