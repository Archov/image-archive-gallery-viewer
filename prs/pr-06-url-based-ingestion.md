# PR 6: URL-Based Ingestion

## 🎯 **Overview**
Add ability to download and import images directly from URLs.

## 📋 **Description**
Add ability to download and import images directly from URLs.

## ✅ **Tasks**
- [ ] Create URL validation and processing service
- [ ] Implement download queue with progress tracking
- [ ] Add duplicate detection (URL/filename based)
- [ ] Create URL import UI with batch input
- [ ] Handle various image formats and error cases

## 🧪 **Acceptance Criteria**
- ✅ **UI**: Text area for pasting multiple URLs
- ✅ **Functionality**: Downloads show progress, appear in gallery when complete
- ✅ **Duplicate Detection**: Same URL won't download twice
- ✅ **Error Handling**: Invalid URLs show clear error messages
- ✅ **Batch**: Can import 10+ URLs simultaneously

## 🔧 **Technical Notes**
- Implement URL validation regex
- Create download queue with concurrency control
- Add HTTP client with timeout/retry logic
- Implement duplicate checking by URL hash
- Handle various image formats (JPEG, PNG, WebP, etc.)

## 📊 **Dependencies**
- Image service (PR 1)
- Download service (existing)
- Progress UI components
- Database URL tracking

## 🧪 **Testing Checklist**
- [ ] Paste single URL and import
- [ ] Test multiple URLs in batch
- [ ] Verify progress indicators
- [ ] Test duplicate URL detection
- [ ] Check invalid URL error handling
- [ ] Verify various image formats work

## 📈 **Success Metrics**
- Downloads complete within reasonable time
- Progress updates every 500ms
- No duplicates created
- Clear error messages for failures
