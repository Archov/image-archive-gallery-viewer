export const state = {
  isRenaming: false,
  currentIndex: 0,
  currentArchiveId: null,
  currentImages: [],
  selectedHistoryItems: new Set(),
  loadedArchiveIds: new Set(),
  historyItems: [],
  settings: {
    cacheSize: 2,
    autoLoadFromClipboard: true,
    maxHistoryItems: 100,
    allowFullscreenUpscaling: false,
    autoLoadAdjacentArchives: true
  },
  isArchiveLoading: false,
  downloadProgressHandler: null
};

