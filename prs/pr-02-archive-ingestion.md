# PR 2: Archive Ingestion System

## 🎯 **Overview**
Implement archive file processing and batch ingestion with progress tracking and metadata extraction.

## 📋 **Description**
Add support for processing ZIP, RAR, and 7Z archives. Extract images, store archive metadata, and integrate with the gallery system.

## ✅ **Tasks**
- [ ] Create archive extraction service using existing libraries (adm-zip, node-unrar-js, node-7z)
- [ ] Implement batch archive processing with progress callbacks
- [ ] Add archive metadata extraction (file count, size, type, compression ratio)
- [ ] Create archive ingestion UI with drag-and-drop and file picker
- [ ] Store archive metadata and relationship to extracted images
- [ ] Handle nested archives and complex directory structures
- [ ] Add duplicate detection (same archive already processed)
- [ ] Implement archive cleanup (temp files, old extractions)

## 🧪 **Acceptance Criteria**
- ✅ **UI**: Drag-and-drop archive files or use file picker
- ✅ **Processing**: Real-time progress bar during extraction
- ✅ **Database**: Archive records with metadata, linked to extracted images
- ✅ **Gallery**: Extracted images appear automatically in gallery
- ✅ **Formats**: Support ZIP, RAR, 7Z archives
- ✅ **Error Handling**: Clear messages for corrupted archives, permission issues
- ✅ **Cleanup**: Automatic cleanup of temp extraction files

## 🔧 **Technical Notes**
- Process archives in background to avoid UI blocking
- Extract only image files (filter by extension)
- Preserve directory structure where meaningful
- Handle large archives with streaming extraction
- Support password-protected archives (optional)
- Implement extraction queue for multiple archives

## 📊 **Dependencies**
- Archive libraries (adm-zip, node-unrar-js, node-7z)
- Database archive and image tables
- Image service (PR 1) for storing extracted images
- Progress UI components
- File system utilities

## 🧪 **Testing Checklist**
- [ ] Drag ZIP file and verify extraction progress
- [ ] Test RAR and 7Z archive processing
- [ ] Verify nested directory handling
- [ ] Check extracted images appear in gallery
- [ ] Test corrupted archive error handling
- [ ] Verify archive metadata storage
- [ ] Test duplicate archive detection
- [ ] Check temp file cleanup

## 📈 **Success Metrics**
- Archive extraction completes within expected time
- Progress updates every 500ms
- Memory usage remains reasonable during extraction
- All major archive formats supported
- Clear error messages for edge cases
