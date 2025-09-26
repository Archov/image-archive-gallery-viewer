# Image Gallery Management System - Development Roadmap

## 🎯 **Project Vision**

Transform the simple archive viewer into a comprehensive image gallery management system with rich metadata, advanced querying, browser integration, and automated optimization.

### **Core Capabilities**
- **Rich Metadata Database**: Per-image tagging (characters, series, artists, clothing, positions)
- **Multiple Ingestion Sources**: Archives (ZIP/RAR/7Z), direct URLs, web page extractors
- **Browser Integration**: Userscript for sending content directly from web pages
- **Advanced Organization**: Tag-based queries, set preservation, smart sorting
- **Mass Metadata Editing**: Batch operations for efficient organization
- **Image Optimization**: Integration with CbxTools for transparent compression

---

## 📋 **PR 1: Image File Management & Basic Gallery**

### **Description**
Implement core image file handling and basic gallery display to replace the placeholder UI.

### **Tasks**
- [ ] Create image service for file operations (move, copy, delete)
- [ ] Implement thumbnail generation using Sharp
- [ ] Set up organized file structure (images/, thumbnails/, temp/)
- [ ] Create image display components in gallery
- [ ] Add basic image loading and error handling

### **Acceptance Criteria**
- ✅ **UI**: Gallery shows actual image thumbnails in a grid
- ✅ **Functionality**: Can navigate through images with arrow keys
- ✅ **Files**: Images stored in organized directory structure
- ✅ **Thumbnails**: Auto-generated 200x200 thumbnails for all images
- ✅ **Performance**: Gallery loads within 2 seconds for 100 images

---

## 📋 **PR 2: Archive Ingestion System**

### **Description**
Implement archive file processing and ingestion with progress tracking.

### **Tasks**
- [ ] Create archive extraction service using existing libraries
- [ ] Implement batch archive processing with progress callbacks
- [ ] Add archive metadata extraction (file count, size, type)
- [ ] Create archive ingestion UI with drag-and-drop
- [ ] Store archive metadata in database

### **Acceptance Criteria**
- ✅ **UI**: Drag-and-drop archive files onto import area
- ✅ **Functionality**: Archives extract with progress bar showing
- ✅ **Database**: Archive records created with metadata
- ✅ **Gallery**: Extracted images appear in gallery automatically
- ✅ **Error Handling**: Clear error messages for corrupted/invalid archives

---

## 📋 **PR 3: Tag System Foundation**

### **Description**
Implement basic tag CRUD operations and per-image tagging.

### **Tasks**
- [ ] Create tag management service (create, read, update, delete)
- [ ] Implement tag categories (character, series, artist, clothing, position)
- [ ] Add tag assignment to individual images
- [ ] Create tag list UI in sidebar
- [ ] Implement tag usage tracking

### **Acceptance Criteria**
- ✅ **UI**: Tag management panel in sidebar with add/edit/delete buttons
- ✅ **Functionality**: Click image → assign tags from dropdown
- ✅ **Database**: Tags stored with categories and usage counts
- ✅ **Persistence**: Tags persist across application restarts
- ✅ **Search**: Can filter gallery by single tag

---

## 📋 **PR 4: Bulk Tag Operations**

### **Description**
Add mass tag assignment and bulk editing capabilities.

### **Tasks**
- [ ] Implement multi-select in gallery (checkboxes)
- [ ] Create bulk tag assignment dialog
- [ ] Add tag removal operations
- [ ] Implement tag suggestions based on usage
- [ ] Add undo functionality for bulk operations

### **Acceptance Criteria**
- ✅ **UI**: Select multiple images → "Add Tags" button → bulk assignment
- ✅ **Functionality**: Bulk remove tags from selected images
- ✅ **UX**: Tag suggestions appear as you type
- ✅ **Undo**: "Undo" button reverses last bulk operation
- ✅ **Performance**: Bulk operations complete within 2 seconds for 100 images

---

## 📋 **PR 5: Basic Query System**

### **Description**
Implement tag-based filtering and simple search.

### **Tasks**
- [ ] Create query builder with tag selection
- [ ] Implement AND/OR logic for multiple tags
- [ ] Add full-text search across image metadata
- [ ] Create saved search presets
- [ ] Update gallery to show filtered results

### **Acceptance Criteria**
- ✅ **UI**: Query builder above gallery with tag checkboxes
- ✅ **Functionality**: Filter by "character:alice AND artist:bob"
- ✅ **Search**: Text search finds images by filename/metadata
- ✅ **Presets**: Save/load common queries
- ✅ **Results**: Filter results update gallery instantly

---

## 📋 **PR 6: URL-Based Ingestion**

### **Description**
Add ability to download and import images directly from URLs.

### **Tasks**
- [ ] Create URL validation and processing service
- [ ] Implement download queue with progress tracking
- [ ] Add duplicate detection (URL/filename based)
- [ ] Create URL import UI with batch input
- [ ] Handle various image formats and error cases

### **Acceptance Criteria**
- ✅ **UI**: Text area for pasting multiple URLs
- ✅ **Functionality**: Downloads show progress, appear in gallery when complete
- ✅ **Duplicate Detection**: Same URL won't download twice
- ✅ **Error Handling**: Invalid URLs show clear error messages
- ✅ **Batch**: Can import 10+ URLs simultaneously

---

## 📋 **PR 7: Set Management**

### **Description**
Implement image grouping and set-based organization.

### **Tasks**
- [ ] Create set data structure and database tables
- [ ] Implement set creation from selected images
- [ ] Add set-aware gallery sorting (keep sets together)
- [ ] Create set management UI
- [ ] Add set import/export capabilities

### **Acceptance Criteria**
- ✅ **UI**: "Create Set" button for selected images
- ✅ **Functionality**: Sets appear as grouped items in gallery
- ✅ **Sorting**: Set order preserved in gallery view
- ✅ **Management**: Rename, delete, reorder sets
- ✅ **Export**: Export set as new archive file

---

## 📋 **PR 8: Advanced Gallery Features**

### **Description**
Enhance gallery with better organization and user experience.

### **Tasks**
- [ ] Implement favorite starring system
- [ ] Add custom sort options (date, name, size, etc.)
- [ ] Create grid/list view toggle
- [ ] Add keyboard shortcuts for navigation
- [ ] Implement virtual scrolling for performance

### **Acceptance Criteria**
- ✅ **UI**: Star button on images, favorites filter
- ✅ **Sorting**: Multiple sort options with visual indicators
- ✅ **Views**: Toggle between grid and list layouts
- ✅ **Navigation**: Arrow keys, page up/down work
- ✅ **Performance**: Smooth scrolling with 1000+ images

---

## 📋 **PR 9: Custom Protocol Handler**

### **Description**
Implement browser integration with custom protocol for sending content.

### **Tasks**
- [ ] Register `image-gallery://` protocol in Electron
- [ ] Create protocol data parsing and validation
- [ ] Implement secure data transfer from browser
- [ ] Add protocol handler error recovery
- [ ] Create basic userscript template

### **Acceptance Criteria**
- ✅ **Protocol**: Clicking `image-gallery://import?url=...` opens app
- ✅ **Data Transfer**: URL and metadata passed from browser to app
- ✅ **Security**: Malformed data rejected with error message
- ✅ **Integration**: Basic bookmarklet can send page URL
- ✅ **Feedback**: Success/error notifications in both browser and app

---

## 📋 **PR 10: Web Page Extractors**

### **Description**
Create system to extract images and metadata from web pages.

### **Tasks**
- [ ] Design extensible extractor framework
- [ ] Implement basic image URL extraction
- [ ] Add metadata parsing (titles, artists, etc.)
- [ ] Create extractors for common gallery sites
- [ ] Add bulk extraction with progress

### **Acceptance Criteria**
- ✅ **Framework**: Easy to add new site extractors
- ✅ **Basic**: Extract all image URLs from any webpage
- ✅ **Smart**: Parse artist names, titles from page content
- ✅ **Batch**: Extract from multiple pages simultaneously
- ✅ **Preview**: Show extracted images before import

---

## 📋 **PR 11: CbxTools Integration**

### **Description**
Integrate CbxTools for automatic image compression and optimization.

### **Tasks**
- [ ] Analyze CbxTools API and command-line interface
- [ ] Create compression service wrapper
- [ ] Implement automatic compression rules
- [ ] Add compression queue management
- [ ] Create settings for compression preferences

### **Acceptance Criteria**
- ✅ **Integration**: CbxTools processes images automatically
- ✅ **Settings**: Configure compression quality, formats
- ✅ **Queue**: Background processing with progress tracking
- ✅ **Results**: Compressed images smaller with no quality loss visible
- ✅ **Revert**: Ability to restore original uncompressed versions

---

## 📋 **PR 12: Import/Export System**

### **Description**
Add ability to export gallery data and import from other systems.

### **Tasks**
- [ ] Implement JSON export of gallery data
- [ ] Create CSV export for metadata
- [ ] Add archive export with metadata preservation
- [ ] Implement basic import from other gallery formats
- [ ] Add backup/restore functionality

### **Acceptance Criteria**
- ✅ **Export**: Download complete gallery as JSON + images
- ✅ **Import**: Restore from exported JSON backup
- ✅ **Formats**: Export metadata as CSV for external tools
- ✅ **Archives**: Export sets as CBZ files with metadata
- ✅ **Validation**: Import validates data integrity

---

## 📋 **PR 13: Performance Optimization**

### **Description**
Optimize for large libraries with thousands of images.

### **Tasks**
- [ ] Implement lazy loading for gallery
- [ ] Add thumbnail caching and optimization
- [ ] Optimize database queries with proper indexing
- [ ] Implement virtual scrolling
- [ ] Add memory usage monitoring

### **Acceptance Criteria**
- ✅ **Performance**: Gallery loads in <2 seconds with 10,000 images
- ✅ **Memory**: App uses <500MB RAM with large libraries
- ✅ **Scrolling**: Smooth scrolling with 100,000+ thumbnails
- ✅ **Search**: Sub-second responses for complex queries
- ✅ **Caching**: Thumbnails load instantly on second view

---

## 📋 **PR 14: Advanced Features**

### **Description**
Add final polish and advanced capabilities.

### **Tasks**
- [ ] Implement plugin architecture
- [ ] Add theme customization
- [ ] Create advanced query builder UI
- [ ] Add keyboard shortcuts reference
- [ ] Implement accessibility features

### **Acceptance Criteria**
- ✅ **Themes**: Light/dark mode toggle
- ✅ **Plugins**: Extensible extractor/plugin system
- ✅ **Queries**: Visual query builder with drag-and-drop
- ✅ **Accessibility**: Keyboard navigation, screen reader support
- ✅ **Documentation**: Built-in help and keyboard shortcuts guide

---

## 🔧 **Technical Architecture**

### **Database Schema**
```sql
-- Core tables for rich metadata management
CREATE TABLE images (...);
CREATE TABLE tags (...);
CREATE TABLE image_tags (...);
CREATE TABLE sets (...);
CREATE TABLE archives (...);
CREATE VIRTUAL TABLE images_fts USING fts5(...);
```

### **File Organization**
```
data/
├── images/          # Original images
├── thumbnails/      # Generated thumbnails
├── temp/           # Temporary processing files
├── exports/        # Exported data
└── gallery.db      # SQLite database
```

### **IPC Communication**
- Image operations (load, save, delete)
- Metadata operations (CRUD tags, bulk updates)
- Query operations (search, filter, sort)
- Import operations (archives, URLs, web content)

---

## 📊 **PR Sizing Guidelines**

### **Small PR (2-4 hours)**
- Single feature implementation
- Database schema changes
- UI component additions
- Basic service functions

### **Medium PR (4-8 hours)**
- Multi-component features
- Complex UI interactions
- Integration between systems
- Performance optimizations

### **Large PR (8-16 hours)**
- Major architectural changes
- Complex integrations (CbxTools, browser protocol)
- Complete feature suites
- Major UI redesigns

### **Testing Requirements**
- ✅ **Manual QA**: Clear steps to verify functionality
- ✅ **User Experience**: Feature works end-to-end as described
- ✅ **Error Cases**: Proper error handling and user feedback
- ✅ **Performance**: No regressions in load times or responsiveness
- ✅ **Data Integrity**: Database operations preserve data consistency

---

*Each PR represents a complete, testable feature that delivers value to users and can be deployed independently.*
