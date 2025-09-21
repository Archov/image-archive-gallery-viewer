import { formatBytes, getArchiveIdFromUrl, isArchiveUrl, isArchiveFile } from '../utils.js';

export function createArchiveController({ state, elements, ui, electron, gallery }) {
  let historyController = null;

  function setHistoryController(controller) {
    historyController = controller;
  }

  async function loadArchiveFromInput() {
    const url = elements.urlInput.value.trim();
    if (!url) {
      ui.updateStatus('Please enter an archive URL', true);
      return;
    }

    if (!isArchiveUrl(url)) {
      ui.updateStatus('URL does not appear to be a supported archive format', true);
      return;
    }

    await loadArchiveByUrl(url, { updateHistory: true, showLoadingOverlay: true });
  }

  async function loadArchiveByUrl(url, { updateHistory = false, showLoadingOverlay = false } = {}) {
    if (state.isArchiveLoading) return null;

    state.isArchiveLoading = true;
    elements.loadBtn.disabled = true;

    try {
      if (showLoadingOverlay) {
        ui.showLoading('Downloading Archive', 'This may take a moment for large files...', true);
        registerDownloadProgressHandler();
        ui.updateStatus('Downloading...');
      }

      const result = await electron.loadArchive(url, state.settings.librarySize);

      if (!result?.images?.length) {
        throw new Error('No images found in archive');
      }

      const filename = deriveFilenameFromUrl(url);
      result.images.forEach(img => {
        img.archiveName = filename;
        img.originalArchiveId = result.archiveId;
      });
      gallery.displayGallery(result.images, filename);

      state.selectedHistoryItems.clear();
      state.loadedArchiveIds.clear();
      state.loadedArchiveIds.add(result.archiveId);
      state.currentArchiveId = result.archiveId;

      if (updateHistory) {
        await addToHistory(filename, url, result.images.length);
      }

      if (historyController) {
        await historyController.refreshHistory({ highlightUrl: url });
      }

      await updateLibraryInfo();
      ui.updateStatus(`Loaded ${result.images.length} images`);

      return result;
    } catch (error) {
      ui.updateStatus(`Error: ${error.message}`, true);
      throw error;
    } finally {
      if (showLoadingOverlay) {
        ui.hideLoading();
      }
      elements.loadBtn.disabled = false;
      state.isArchiveLoading = false;
    }
  }

  async function openLocalArchive(file, displayName) {
    if (state.isArchiveLoading) return;

    state.isArchiveLoading = true;

    try {
      ui.showLoading('Processing Archive', 'Reading file data...');
      
      // Check if we need to prompt for move/copy
      const dialogResult = await electron.showLocalArchiveDialog(file.name);
      
      if (dialogResult.cancelled) {
        ui.updateStatus('Archive loading cancelled');
        return;
      }
      
      // Read the file data as an ArrayBuffer
      const fileData = await readFileAsArrayBuffer(file);
      
      ui.showLoading('Extracting Archive', 'Processing archive data...');
      
      const result = await electron.loadLocalArchiveFromData({
        name: file.name,
        data: new Uint8Array(fileData), // Send as TypedArray to avoid massive copies
        size: file.size,
        copyToLibrary: !dialogResult.moveToLibrary
      }, state.settings.librarySize);
      
      let images;
      let archiveIdFromResult = null;
      if (result.needsUserChoice) {
        // This shouldn't happen since we already showed the dialog
        throw new Error('Unexpected user choice needed');
      } else if (result.alreadyInLibrary) {
        images = result.images;
        archiveIdFromResult = result.archiveId || null;
        ui.updateStatus('Archive was already in library', false);
      } else {
        images = result.images;
        archiveIdFromResult = result.archiveId || null;
        ui.updateStatus(result.wasCopied ? 'Archive copied to library' : 'Archive moved to library', false);
      }

      if (!images?.length) {
        throw new Error('No images found in local archive');
      }

      gallery.displayGallery(images, displayName);

      const archiveId = archiveIdFromResult || getArchiveIdFromUrl(`file://${displayName}`);
      images.forEach(img => {
        img.archiveName = displayName;
        img.originalArchiveId = archiveId;
      });
      state.selectedHistoryItems.clear();
      state.loadedArchiveIds.clear();
      state.loadedArchiveIds.add(archiveId);
      state.currentArchiveId = archiveId;

      const historyUrl = result.libraryArchivePath ? `file://${result.libraryArchivePath}` : `archive://${archiveId}`;
      await addToHistory(displayName, historyUrl, images.length);

      if (historyController) {
        await historyController.refreshHistory({ highlightUrl: historyUrl });
      }

      await updateLibraryInfo();
      ui.updateStatus(`Loaded ${images.length} images from local file`);

      return images;
    } catch (error) {
      ui.updateStatus(`Error: ${error.message}`, true);
      throw error;
    } finally {
      ui.hideLoading();
      state.isArchiveLoading = false;
    }
  }
  
  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  function tryExtractLibraryArchiveId(fileUrl) {
    try {
      const p = decodeURIComponent(new URL(fileUrl).pathname).replace(/\\/g, '/');
      const parts = p.split('/').filter(Boolean);
      return parts.length >= 2 ? parts[parts.length - 2] : null;
    } catch {
      return null;
    }
  }

  async function addToHistory(name, url, imageCount) {
    try {
      await electron.addToHistory({
        name,
        url,
        imageCount,
        lastAccessed: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to add to history:', error);
    }
  }

  async function updateLibraryInfo() {
    try {
      const libraryInfo = await electron.getLibraryInfo();
      const used = Number(libraryInfo.totalArchiveSize ?? libraryInfo.totalSize) || 0;
      const libSizeGB = Number.isFinite(Number(state.settings.librarySize))
        ? Number(state.settings.librarySize)
        : Number(state.settings.cacheSize ?? 2);
      const limit = libSizeGB * 1024 * 1024 * 1024;
      const usedPercentage = limit > 0 ? (used / limit) * 100 : 0;

      if (elements.libraryUsed) {
        elements.libraryUsed.textContent = formatBytes(used);
      }
      if (elements.libraryAvailable) {
        elements.libraryAvailable.textContent = formatBytes(limit);
      }
      if (elements.starredCount) {
        elements.starredCount.textContent = libraryInfo.starredCount;
      }
      if (elements.libraryBarFill) {
        elements.libraryBarFill.style.width = `${Math.min(usedPercentage, 100)}%`;
      }
    } catch (error) {
      console.error('Failed to update library info:', error);
    }
  }

  function getImageArchiveId(image) {
    return image?.originalArchiveId || state.currentArchiveId || null;
  }

  function buildGalleryDisplayName() {
    const archiveNames = [...new Set(state.currentImages.map(img => img.archiveName).filter(Boolean))];
    if (!archiveNames.length) {
      return 'Archive';
    }
    return archiveNames.length === 1 ? archiveNames[0] : `${archiveNames.length} Archives`;
  }

  function refreshGalleryDisplay() {
    if (!state.currentImages.length) {
      state.currentArchiveId = null;
      state.currentImages = [];
      gallery.showWelcome();
      return;
    }

    const displayName = buildGalleryDisplayName();
    gallery.displayGallery(state.currentImages.slice(), displayName);
  }

  function registerDownloadProgressHandler() {
    state.downloadProgressHandler = (event, data) => {
      ui.updateDownloadProgress(data.progress);
      if (data.total) {
        const downloadedMB = (data.downloaded / (1024 * 1024)).toFixed(1);
        const totalMB = (data.total / (1024 * 1024)).toFixed(1);
        elements.loadingText.textContent = `Downloaded ${downloadedMB} MB of ${totalMB} MB`;
      }
    };
    electron.onDownloadProgress(state.downloadProgressHandler);
  }

  function deriveFilenameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const fParam = urlObj.searchParams.get('f');
      if (fParam) {
        return decodeURIComponent(fParam);
      }
      const filename = urlObj.pathname.split('/').pop();
      return filename || 'Archive';
    } catch (error) {
      const segments = url.split('/');
      return segments.pop().split('?')[0] || 'Archive';
    }
  }

  async function findAdjacentArchive(direction) {
    try {
      const history = state.historyItems.length > 0
        ? state.historyItems
        : await electron.loadHistory();

      if (!history.length) return null;

      const loadedIds = Array.from(state.loadedArchiveIds);

      if (loadedIds.length > 1) {
        const targetId = direction > 0 ? loadedIds[loadedIds.length - 1] : loadedIds[0];
        const marker = history.find(item => getArchiveIdFromUrl(item.url) === targetId);
        if (!marker) return null;
        const markerIndex = history.indexOf(marker);
        const adjacentIndex = markerIndex + direction;
        if (adjacentIndex >= 0 && adjacentIndex < history.length) {
          const candidate = history[adjacentIndex];
          const candidateId = getArchiveIdFromUrl(candidate.url);
          if (state.loadedArchiveIds.has(candidateId)) {
            return null;
          }
          return candidate;
        }
      } else {
        const currentId = loadedIds[0];
        const currentItem = history.find(item => getArchiveIdFromUrl(item.url) === currentId);
        if (!currentItem) return null;
        const currentIndex = history.indexOf(currentItem);
        const adjacentIndex = currentIndex + direction;
        if (adjacentIndex >= 0 && adjacentIndex < history.length) {
          return history[adjacentIndex];
        }
      }
    } catch (error) {
      console.error('Failed to find adjacent archive:', error);
    }
    return null;
  }

  async function loadAdjacentArchive(direction) {
    if (!state.settings.autoLoadAdjacentArchives || state.isArchiveLoading) {
      return false;
    }

    state.isArchiveLoading = true;

    try {
      const adjacentItem = await findAdjacentArchive(direction);
      if (!adjacentItem) {
        return false;
      }

      ui.showArchiveLoading();
      let newImages = [];
      let newArchiveId = getArchiveIdFromUrl(adjacentItem.url);

      if (adjacentItem.url.startsWith('file://')) {
        const result = await electron.loadLocalArchive(
          adjacentItem.url.replace('file://', ''),
          state.settings.librarySize,
          { copyToLibrary: true, archiveId: tryExtractLibraryArchiveId(adjacentItem.url) }
        );
        newImages = result.images || [];
        if (result?.archiveId) newArchiveId = result.archiveId;
      } else {
        const result = await electron.loadArchive(adjacentItem.url, state.settings.librarySize);
        newImages = result.images || [];
        if (result?.archiveId) newArchiveId = result.archiveId;
      }

      if (!newImages.length) {
        return false;
      }

      newImages.forEach(img => {
        img.archiveName = adjacentItem.name;
        img.originalArchiveId = newArchiveId;
      });

      if (direction > 0) {
        state.currentImages = [...state.currentImages, ...newImages];
      } else {
        state.currentImages = [...newImages, ...state.currentImages];
        state.currentIndex += newImages.length;
      }

      state.loadedArchiveIds.add(newArchiveId);
      state.selectedHistoryItems.add(adjacentItem.id);
      state.currentArchiveId = newArchiveId;

      refreshGalleryDisplay();

      if (historyController) {
        await historyController.refreshHistory({ highlightUrl: adjacentItem.url, selectId: adjacentItem.id });
      } else {
        state.historyItems = await electron.loadHistory();
      }

      ui.updateStatus(`Auto-loaded: ${adjacentItem.name} (${newImages.length} images)`);
      return true;
    } catch (error) {
      console.error('Error in loadAdjacentArchive:', error);
      ui.updateStatus(`Failed to load adjacent archive: ${error.message}`, true);
      return false;
    } finally {
      ui.hideArchiveLoading();
      state.isArchiveLoading = false;
    }
  }

  async function loadSingleArchiveToCollection(item) {
    if (state.isArchiveLoading) {
      return;
    }

    state.isArchiveLoading = true;
    ui.showArchiveLoading();
    ui.updateStatus(`Loading ${item.name}...`);

    try {
      let images = [];
      let archiveId = getArchiveIdFromUrl(item.url);

      if (item.url.startsWith('file://')) {
        const result = await electron.loadLocalArchive(
          item.url.replace('file://', ''),
          state.settings.librarySize,
          { copyToLibrary: true, archiveId: tryExtractLibraryArchiveId(item.url) }
        );
        images = result.images || [];
        if (result?.archiveId) archiveId = result.archiveId;
      } else {
        const result = await electron.loadArchive(item.url, state.settings.librarySize);
        images = result.images || [];
        if (result?.archiveId) archiveId = result.archiveId;
      }

      if (!images.length) {
        ui.updateStatus(`No images found in ${item.name}`, true);
        state.isArchiveLoading = false;
        return;
      }

      images.forEach(img => {
        img.archiveName = item.name;
        img.originalArchiveId = archiveId;
      });

      if (state.currentImages.length === 0 || elements.galleryContainer.style.display === 'none') {
        state.currentImages = images;
        state.loadedArchiveIds.clear();
      } else {
        state.currentImages = [...state.currentImages, ...images];
      }

      state.loadedArchiveIds.add(archiveId);
      state.selectedHistoryItems.add(item.id);
      state.currentArchiveId = archiveId;

      refreshGalleryDisplay();

      if (historyController) {
        await historyController.refreshHistory({ selectId: item.id });
      }

      ui.updateStatus(`Added ${images.length} images from ${item.name}`);
    } catch (error) {
      console.error(`Failed to load ${item.name}:`, error);
      ui.updateStatus(`Failed to load ${item.name}: ${error.message}`, true);
      throw error;
    } finally {
      ui.hideArchiveLoading();
      state.isArchiveLoading = false;
    }
  }

  async function unloadArchiveFromCollection(item) {
    const archiveId = getArchiveIdFromUrl(item.url);

    if (!state.loadedArchiveIds.has(archiveId)) {
      return;
    }

    state.selectedHistoryItems.delete(item.id);
    state.loadedArchiveIds.delete(archiveId);

    state.currentImages = state.currentImages.filter(img => getImageArchiveId(img) !== archiveId);

    if (!state.loadedArchiveIds.size || !state.currentImages.length) {
      state.currentImages = [];
      state.currentArchiveId = null;
      gallery.showWelcome();
    } else {
      if (state.currentArchiveId === archiveId) {
        const next = state.loadedArchiveIds.values().next().value || null;
        state.currentArchiveId = next;
      }
      refreshGalleryDisplay();
    }

    if (historyController) {
      await historyController.refreshHistory();
    }

  }

  async function loadFromHistory(historyItem) {
    state.selectedHistoryItems.clear();
    state.loadedArchiveIds.clear();

    if (historyItem.url.startsWith('file://')) {
      try {
        const result = await electron.loadLocalArchive(
          historyItem.url.replace('file://', ''),
          state.settings.librarySize,
          { copyToLibrary: true, archiveId: tryExtractLibraryArchiveId(historyItem.url) }
        );
        const images = result.images || [];
        const archiveId = getArchiveIdFromUrl(historyItem.url);

        images.forEach(img => {
          img.archiveName = historyItem.name;
          img.originalArchiveId = archiveId;
        });

        state.currentImages = images;
        state.loadedArchiveIds.add(archiveId);
        state.selectedHistoryItems.add(historyItem.id);
        state.currentArchiveId = archiveId;

        refreshGalleryDisplay();

        if (historyController) {
          await historyController.refreshHistory({ selectId: historyItem.id });
        }

        ui.updateStatus(`Loaded ${images.length} images from library`);
      } catch (error) {
        ui.updateStatus(`Error loading from library: ${error.message}`, true);
      }
    } else {
      elements.urlInput.value = historyItem.url;
      await loadArchiveByUrl(historyItem.url, { updateHistory: false, showLoadingOverlay: true });
    }
  }

  function registerHistoryItems(items) {
    state.historyItems = items;
  }

  return {
    setHistoryController,
    loadArchiveFromInput,
    loadArchiveByUrl,
    openLocalArchive,
    loadSingleArchiveToCollection,
    unloadArchiveFromCollection,
    loadFromHistory,
    loadAdjacentArchive,
    updateLibraryInfo,
    registerHistoryItems
  };
}