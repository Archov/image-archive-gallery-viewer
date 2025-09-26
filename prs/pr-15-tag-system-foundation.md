# PR 15: Tag System Foundation

## 🎯 **Overview**
Implement basic tag CRUD operations and per-image tagging.

## 📋 **Description**
Implement basic tag CRUD operations and per-image tagging.

## ✅ **Tasks**
- [ ] Create tag management service (create, read, update, delete)
- [ ] Implement tag categories (character, series, artist, clothing, position)
- [ ] Add tag assignment to individual images
- [ ] Create tag list UI in sidebar
- [ ] Implement tag usage tracking

## 🧪 **Acceptance Criteria**
- ✅ **UI**: Tag management panel in sidebar with add/edit/delete buttons
- ✅ **Functionality**: Click image → assign tags from dropdown
- ✅ **Database**: Tags stored with categories and usage counts
- ✅ **Persistence**: Tags persist across application restarts
- ✅ **Search**: Can filter gallery by single tag

## 🔧 **Technical Notes**
- Implement tag CRUD in database service
- Create tag category enum/constants
- Update image_tags relationship table
- Add tag color coding support
- Implement tag usage counter updates

## 📊 **Dependencies**
- Database schema (tags and image_tags tables)
- Sidebar UI component
- Image selection functionality

## 🧪 **Testing Checklist**
- [ ] Create new tag with category
- [ ] Assign tag to image
- [ ] Verify tag appears in sidebar
- [ ] Filter gallery by tag
- [ ] Delete tag and verify cleanup
- [ ] Test tag persistence across restarts

## 📈 **Success Metrics**
- Tag operations complete in <100ms
- Sidebar updates instantly
- Tag filtering works in real-time
- No orphaned tag relationships