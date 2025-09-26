# PR 17: Basic Query System

## 🎯 **Overview**
Implement tag-based filtering and simple search.

## 📋 **Description**
Implement tag-based filtering and simple search.

## ✅ **Tasks**
- [ ] Create query builder with tag selection
- [ ] Implement AND/OR logic for multiple tags
- [ ] Add full-text search across image metadata
- [ ] Create saved search presets
- [ ] Update gallery to show filtered results

## 🧪 **Acceptance Criteria**
- ✅ **UI**: Query builder above gallery with tag checkboxes
- ✅ **Functionality**: Filter by "character:alice AND artist:bob"
- ✅ **Search**: Text search finds images by filename/metadata
- ✅ **Presets**: Save/load common queries
- ✅ **Results**: Filter results update gallery instantly

## 🔧 **Technical Notes**
- Implement query builder component
- Add AND/OR logic for tag combinations
- Integrate FTS (full-text search) from database
- Create preset storage in database
- Update gallery with filtered results

## 📊 **Dependencies**
- Tag system (PR 15)
- Gallery component (PR 1)
- Database FTS virtual table

## 🧪 **Testing Checklist**
- [ ] Select multiple tags in query builder
- [ ] Test AND logic (all tags required)
- [ ] Test OR logic (any tag matches)
- [ ] Enter text search query
- [ ] Save query as preset
- [ ] Load saved preset
- [ ] Verify instant filtering

## 📈 **Success Metrics**
- Query results appear in <500ms
- Text search finds matches instantly
- Preset save/load works seamlessly
- Complex queries with 10+ tags work
