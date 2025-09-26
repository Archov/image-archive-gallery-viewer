# Archive Image Gallery - Complete System Replacement Plan

## 🎯 **Overview**

This document outlines the complete removal and replacement of the existing Archive Image Gallery system. The current implementation is a simple archive viewer that doesn't align with the target vision of a comprehensive image gallery management system with rich metadata, advanced querying, and browser integration.

**Decision**: Complete fresh start with strategic reuse of proven components. The existing codebase will be preserved in a git branch for reference.

## 📊 **Current System Analysis**

### **Current Capabilities (Limited)**
- Basic archive extraction (ZIP, RAR, 7Z)
- Simple grid gallery view
- Archive history tracking
- Basic starring functionality
- JSON file-based storage

### **Target System Requirements (Major Expansion)**
- Rich metadata database (SQLite)
- Tag-based organization (characters, artists, series, clothing, positions)
- Multiple ingestion sources (archives, URLs, web extractors)
- Browser integration with custom protocol
- Advanced querying and set management
- CbxTools integration for compression
- Mass metadata editing capabilities

### **Architecture Mismatch**
The current system is fundamentally incompatible with the target requirements:
- JSON storage vs. relational database needs
- Archive-centric vs. image-centric data model
- Simple UI vs. complex metadata management interface
- No extensibility for browser integration or advanced features

## 🗂️ **Complete System Removal**

### **Phase 1: Preserve Current Implementation**
```bash
# Create preservation branch (already done or will be done)
git checkout -b legacy-archive-viewer
git add .
git commit -m "Preserve current archive viewer implementation"
git checkout main
```

### **Phase 2: Remove All Existing Structure**
```bash
# Remove all existing source code
rm -rf src/

# Remove existing data files
rm -f database.json
rm -f history.json

# Remove existing scripts
rm -f main.js
rm -f preload.js

# Remove existing HTML/CSS
rm -f index.html

# Keep only: package.json, README.md, DEVELOPMENT_ROADMAP.md
```

### **Phase 3: Clean Package Dependencies**
Update `package.json` to remove unused dependencies and add new ones:
```json
{
  "dependencies": {
    "better-sqlite3": "^9.0.0",    // New: SQLite database
    "sharp": "^0.33.0",            // New: Image processing
    "uuid": "^9.0.1",              // Keep: ID generation
    "adm-zip": "^0.5.10",          // Keep: Archive extraction
    "node-unrar-js": "^2.0.0",     // Keep: RAR support
    "node-7z": "^3.0.0"            // Keep: 7Z support
  }
}
```

## 🏗️ **New Architecture Foundation**

### **Directory Structure**
```
src/
├── main/
│   ├── app.js              # Electron main process
│   ├── window.js           # Window management
│   ├── config.js           # Configuration
│   ├── database.js         # SQLite database service
│   ├── ipc/
│   │   └── handlers.js     # IPC communication
│   └── services/
│       ├── imageService.js      # Image operations
│       ├── ingestionService.js  # Import processing
│       ├── metadataService.js   # Tag/metadata management
│       ├── queryService.js      # Search/filtering
│       ├── compressionService.js # CbxTools integration
│       └── extractionService.js  # Archive extraction (reused)
├── renderer/
│   ├── app.js              # React/Vue app entry
│   ├── components/         # UI components
│   ├── stores/             # State management
│   └── utils/              # Utilities
└── shared/
    ├── types.js            # TypeScript definitions
    └── constants.js        # Shared constants
```

### **Database Schema (SQLite)**
```sql
-- Complete replacement of JSON structure
CREATE TABLE images (...);
CREATE TABLE tags (...);
CREATE TABLE image_tags (...);
CREATE TABLE sets (...);
CREATE TABLE archives (...);
CREATE VIRTUAL TABLE images_fts USING fts5(...);
```

### **UI Framework Decision**
Choose modern framework for complex interface:
- **React**: Component-based, rich ecosystem
- **Vue.js**: Simpler learning curve, good for desktop
- **Svelte**: Performance-focused, modern

## 🔄 **Migration Strategy**

### **Data Preservation**
- Current `database.json` backed up but not migrated
- No automatic data migration (incompatible schemas)
- Users start fresh with new system
- Legacy branch preserves current functionality

### **Feature Mapping**
| Legacy Feature | New Implementation |
|----------------|-------------------|
| Archive loading | Multi-source ingestion |
| Simple gallery | Rich metadata gallery |
| Basic starring | Advanced tagging system |
| History tracking | Query-based collections |
| JSON storage | SQLite with FTS |

## ✅ **Removal Checklist**

### **Files to Delete**
- [ ] `src/main/services/archiveService.js`
- [ ] `src/main/services/databaseService.js`
- [ ] `src/main/services/libraryService.js`
- [ ] `src/main/services/historyService.js`
- [ ] `src/main/services/settingsService.js`
- [ ] `src/main/services/maintenanceService.js`
- [ ] `src/main/services/cacheService.js.old`
- [ ] `src/main/ipc/registerHandlers.js`
- [ ] `src/renderer/controllers/`
- [ ] `src/renderer/ui/`
- [ ] `src/renderer/styles/`
- [ ] `src/renderer/app.js`
- [ ] `src/renderer/state.js`
- [ ] `src/renderer/elements.js`
- [ ] `src/renderer/electron.js`
- [ ] `src/renderer/utils.js`

### **Data Files to Remove**
- [ ] `database.json`
- [ ] `history.json`

### **Entry Points to Replace**
- [ ] `main.js`
- [ ] `preload.js`
- [ ] `index.html`

### **Dependencies to Update**
- [ ] Remove unused packages
- [ ] Add SQLite, UI framework, image processing
- [ ] Update build configuration

## 🚀 **Fresh Start Benefits**

### **Clean Slate Advantages**
- No legacy code constraints
- Modern architecture from ground up
- Proper separation of concerns
- Scalable database design
- Rich feature set from day one

### **Strategic Reuse**
- Proven archive extraction logic
- Electron window management
- Download service patterns
- Basic IPC communication structure

### **Risk Mitigation**
- Legacy code preserved in branch
- Incremental development approach
- Comprehensive testing at each phase
- Easy rollback if needed

## 📋 **Implementation Order**

1. **Complete system removal** (this document)
2. **New architecture foundation** (database, basic services)
3. **Core ingestion** (archive processing, basic UI)
4. **Metadata system** (tagging, editing)
5. **Query system** (search, filtering)
6. **Browser integration** (protocol, userscript)
7. **Optimization** (CbxTools, performance)
8. **Polish** (UI/UX, testing)

---

## 🎯 **Success Criteria**

- [ ] Clean, modern codebase with no legacy baggage
- [ ] SQLite database with proper indexing and FTS
- [ ] Rich metadata capabilities from day one
- [ ] Extensible architecture for future features
- [ ] Browser integration ready
- [ ] CbxTools integration planned
- [ ] Modern UI framework implementation

---

**This replacement plan transforms the project from a simple archive viewer into a comprehensive image gallery management system. The fresh start enables modern architecture and rich features that would be difficult to retrofit into the existing codebase.**

