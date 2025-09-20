import { state } from './state.js';

import { getElements } from './elements.js';

import { electron } from './electron.js';

import { createStatusUI } from './ui/status.js';

import { createGalleryController } from './controllers/galleryController.js';

import { createArchiveController } from './controllers/archiveController.js';

import {

  getArchiveIdFromUrl,

  isArchiveFile

} from './utils.js';

let elements;

let ui;

let gallery;

let archive;

let draggedElement = null;

const historyController = {

  async refreshHistory({ highlightUrl, selectId } = {}) {

    try {

      const history = await electron.loadHistory();

      state.historyItems = history;

      archive.registerHistoryItems(history);

      if (!selectId && highlightUrl) {

        const target = history.find(item => item.url === highlightUrl);

        if (target) {

          selectId = target.id;

        }

      }

      const loadedHistoryIds = history

        .filter(item => state.loadedArchiveIds.has(getArchiveIdFromUrl(item.url)))

        .map(item => item.id);

      const nextSelected = new Set(loadedHistoryIds);

      if (selectId) {

        nextSelected.add(selectId);

      }

      state.selectedHistoryItems = nextSelected;

      renderHistory(history, { highlightUrl, selectId });

    } catch (error) {

      console.error('Failed to load history:', error);

    }

  }

};

function toggleHistoryPanel() {
  if (elements.historyPanel.classList.contains('open')) {
    closeHistoryPanel();
  } else {
    elements.historyPanel.classList.add('open');
    closeSettingsPanel();
  }
}

function toggleSettingsPanel() {
  if (elements.settingsPanel.classList.contains('open')) {
    closeSettingsPanel();
  } else {
    elements.settingsPanel.classList.add('open');
    closeHistoryPanel();
  }
}

function closeHistoryPanel() {
  elements.historyPanel.classList.remove('open');
}

function closeSettingsPanel() {
  elements.settingsPanel.classList.remove('open');
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape') {
    closeHistoryPanel();
    closeSettingsPanel();
  }
}

function handleDocumentClick(event) {
  if (!elements.historyPanel.classList.contains('open')) {
    return;
  }

  const target = event.target;
  if (elements.historyPanel.contains(target)) {
    return;
  }
  if (elements.historyBtn.contains(target)) {
    return;
  }
  if (elements.settingsPanel.contains(target)) {
    return;
  }
  if (elements.settingsBtn.contains(target)) {
    return;
  }
  closeHistoryPanel();
}

async function loadSettings() {

  try {

    const settings = await electron.loadSettings();

    state.settings = { ...state.settings, ...settings };

    elements.cacheSizeSelect.value = state.settings.cacheSize;

    elements.autoLoadFromClipboardSelect.value = String(state.settings.autoLoadFromClipboard);

    elements.maxHistoryItemsSelect.value = state.settings.maxHistoryItems;

    elements.allowFullscreenUpscalingSelect.value = String(state.settings.allowFullscreenUpscaling);

    elements.autoLoadAdjacentArchivesSelect.value = String(state.settings.autoLoadAdjacentArchives);

    gallery.updateZoomSliderMax();

    gallery.updateFullscreenUpscaling();

  } catch (error) {

    console.error('Failed to load settings:', error);

  }

}

async function saveSettings() {

  state.settings.cacheSize = parseFloat(elements.cacheSizeSelect.value);

  state.settings.autoLoadFromClipboard = elements.autoLoadFromClipboardSelect.value === 'true';

  state.settings.maxHistoryItems = parseInt(elements.maxHistoryItemsSelect.value, 10);

  state.settings.allowFullscreenUpscaling = elements.allowFullscreenUpscalingSelect.value === 'true';

  state.settings.autoLoadAdjacentArchives = elements.autoLoadAdjacentArchivesSelect.value === 'true';

  try {

    await electron.saveSettings(state.settings);

    gallery.updateZoomSliderMax();

    gallery.updateFullscreenUpscaling();

  } catch (error) {

    console.error('Failed to save settings:', error);

  }

}

async function applyClipboardAutoload() {

  if (!state.settings.autoLoadFromClipboard || !navigator.clipboard) return;

  try {

    const text = await navigator.clipboard.readText();

    if (text && isSupportedArchiveUrl(text)) {

      elements.urlInput.value = text;

      ui.updateStatus('Archive URL detected from clipboard');

    }

  } catch (error) {

    // Clipboard access denied or unavailable – ignore quietly.

  }

}

function isSupportedArchiveUrl(url) {

  return /\.(zip|rar|7z)($|\?|#)/i.test(url)

    || (url.includes('.bin?') && /f=[^&]*\.(zip|rar|7z)/i.test(url));

}

function renderHistory(history, { highlightUrl, selectId } = {}) {

  elements.historyList.innerHTML = '';

  history.forEach(item => {

    const historyItem = document.createElement('div');

    historyItem.className = 'history-item';

    historyItem.draggable = !state.isRenaming;

    historyItem.dataset.historyId = item.id;

    const itemArchiveId = getArchiveIdFromUrl(item.url);

    const isLoaded = state.loadedArchiveIds.has(itemArchiveId);

    const isChecked = state.selectedHistoryItems.has(item.id);

    if (isLoaded) {

      historyItem.classList.add('current-archive');

    }

    if (highlightUrl && item.url === highlightUrl) {

      historyItem.classList.add('active');

    }

    const checkbox = document.createElement('div');

    checkbox.className = `history-checkbox ${isChecked ? 'checked' : ''}`;

    checkbox.title = isLoaded ? 'Click to unload this archive' : 'Click to load this archive';

    checkbox.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleHistorySelection(item).catch(error => console.error('Failed to toggle history selection:', error));
    });

    // Drag handle

    const dragHandle = document.createElement('div');

    dragHandle.className = 'history-drag-handle';

    dragHandle.title = 'Drag to reorder';

    // Star toggle

    const star = document.createElement('div');

    star.className = `history-item-star ${item.starred ? 'starred' : ''}`;

    star.innerHTML = item.starred ? '★' : '☆';

    star.title = item.starred ? 'Remove from favorites' : 'Add to favorites';

    star.addEventListener('click', async (event) => {

      event.stopPropagation();

      await toggleHistoryStar(item.id);

    });

    // Info block

    const info = document.createElement('div');

    info.className = 'history-item-info';

    const name = document.createElement('div');

    name.className = 'history-item-name';

    name.textContent = item.name;

    const details = document.createElement('div');

    details.className = 'history-item-details';

    const imageLabel = item.imageCount === 1 ? 'image' : 'images';

    const dateLabel = new Date(item.lastAccessed).toLocaleDateString();

    details.textContent = `${item.imageCount} ${imageLabel} • ${dateLabel}`;

    const renameBtn = document.createElement('button');

    renameBtn.className = 'history-item-rename';

    renameBtn.textContent = '✎';

    renameBtn.title = 'Rename';

    renameBtn.addEventListener('click', (event) => {

      event.stopPropagation();

      startRenameMode(historyItem, item);

    });

    info.appendChild(name);

    info.appendChild(details);

    historyItem.appendChild(checkbox);

    historyItem.appendChild(dragHandle);

    historyItem.appendChild(star);

    historyItem.appendChild(info);

    historyItem.appendChild(renameBtn);

    info.style.cursor = 'pointer';

    info.addEventListener('click', () => {

      archive.loadFromHistory(item);

    });

    historyItem.addEventListener('dragstart', handleDragStart);

    historyItem.addEventListener('dragend', handleDragEnd);

    historyItem.addEventListener('dragover', handleDragOver);

    historyItem.addEventListener('drop', handleDrop);

    elements.historyList.appendChild(historyItem);

  });

  updateClearSelectedButton();

}

function startRenameMode(historyItem, item) {

  state.isRenaming = true;

  const nameEl = historyItem.querySelector('.history-item-name');

  const detailsEl = historyItem.querySelector('.history-item-details');

  const renameBtn = historyItem.querySelector('.history-item-rename');

  const info = historyItem.querySelector('.history-item-info');

  nameEl.style.display = 'none';

  detailsEl.style.display = 'none';

  renameBtn.style.display = 'none';

  const input = document.createElement('input');

  input.className = 'history-rename-input';

  input.type = 'text';

  input.value = item.name;

  const saveBtn = document.createElement('button');

  saveBtn.className = 'history-item-rename';

  saveBtn.textContent = '✔';

  const cancelBtn = document.createElement('button');

  cancelBtn.className = 'history-item-rename';

  cancelBtn.textContent = '✖';

  const cleanup = () => exitRenameMode(historyItem, nameEl, detailsEl, renameBtn, input, saveBtn, cancelBtn);

  saveBtn.addEventListener('click', async () => {

    const newName = input.value.trim();

    if (newName && newName !== item.name) {

      try {

        const success = await electron.renameHistoryItem(item.id, newName);

        if (success) {

          await historyController.refreshHistory({ selectId: item.id });

          ui.updateStatus(`Renamed "${item.name}" to "${newName}"`);

        } else {

          ui.updateStatus('Failed to rename item', true);

        }

      } catch (error) {

        console.error('Failed to rename:', error);

        ui.updateStatus('Failed to rename item', true);

      }

    }

    cleanup();

  });

  cancelBtn.addEventListener('click', cleanup);

  input.addEventListener('keydown', (event) => {

    if (event.key === 'Enter') {

      saveBtn.click();

    } else if (event.key === 'Escape') {

      cancelBtn.click();

    }

  });

  info.innerHTML = '';

  info.appendChild(input);

  info.appendChild(saveBtn);

  info.appendChild(cancelBtn);

  setTimeout(() => input.focus(), 10);

}

function exitRenameMode(historyItem, nameEl, detailsEl, renameBtn, input, saveBtn, cancelBtn) {

  state.isRenaming = false;

  const info = historyItem.querySelector('.history-item-info');

  info.innerHTML = '';

  info.appendChild(nameEl);

  info.appendChild(detailsEl);

  nameEl.style.display = '';

  detailsEl.style.display = '';

  renameBtn.style.display = '';

}

function handleDragStart(event) {

  if (state.isRenaming) {

    event.preventDefault();

    return;

  }

  draggedElement = event.currentTarget;

  draggedElement.classList.add('dragging');

  event.dataTransfer.effectAllowed = 'move';

  event.dataTransfer.setData('text/plain', draggedElement.dataset.historyId);

}

function handleDragEnd(event) {

  if (state.isRenaming) return;

  event.currentTarget.classList.remove('dragging');

  elements.historyList.querySelectorAll('.history-item').forEach(item => {

    item.classList.remove('drag-over');

  });

  draggedElement = null;

}

function handleDragOver(event) {

  if (state.isRenaming) return;

  event.preventDefault();

  const target = event.target.closest('.history-item');

  if (target && target !== draggedElement) {

    elements.historyList.querySelectorAll('.history-item').forEach(item => item.classList.remove('drag-over'));

    target.classList.add('drag-over');

  }

}

async function handleDrop(event) {

  if (state.isRenaming) return;

  event.preventDefault();

  const target = event.target.closest('.history-item');

  if (!target || target === draggedElement) return;

  const items = Array.from(elements.historyList.children);

  const draggedIndex = items.indexOf(draggedElement);

  const targetIndex = items.indexOf(target);

  if (draggedIndex < targetIndex) {

    target.parentNode.insertBefore(draggedElement, target.nextSibling);

  } else {

    target.parentNode.insertBefore(draggedElement, target);

  }

  const newOrder = Array.from(elements.historyList.children).map(item => item.dataset.historyId);

  try {

    const success = await electron.reorderHistory(newOrder);

    if (success) {

      ui.updateStatus('History reordered successfully');

      await historyController.refreshHistory();

    } else {

      throw new Error('Backend reported failure');

    }

  } catch (error) {

    console.error('Failed to reorder history:', error);

    ui.updateStatus('Failed to reorder history', true);

    await historyController.refreshHistory();

  }

}

async function toggleHistorySelection(historyItem) {

  const archiveId = getArchiveIdFromUrl(historyItem.url);

  const isLoaded = state.loadedArchiveIds.has(archiveId);

  if (isLoaded) {

    await archive.unloadArchiveFromCollection(historyItem);

    ui.updateStatus(`Removed ${historyItem.name} from the gallery`);

  } else {

    await archive.loadSingleArchiveToCollection(historyItem);

  }

  updateClearSelectedButton();

}

function updateClearSelectedButton() {

  const count = state.loadedArchiveIds.size;

  if (!elements.clearSelectedBtn) return;

  if (count === 0) {

    elements.clearSelectedBtn.disabled = true;

    elements.clearSelectedBtn.textContent = 'Clear Selected';

  } else {

    elements.clearSelectedBtn.disabled = false;

    elements.clearSelectedBtn.textContent = `Clear Selected (${count})`;

  }

}

async function toggleHistoryStar(historyId) {

  try {

    await electron.toggleHistoryStar(historyId);

    await historyController.refreshHistory();

    await archive.updateLibraryInfo();

  } catch (error) {

    console.error('Failed to toggle history star:', error);

  }

}

async function clearHistory() {

  if (!elements.clearHistoryBtn) return;

  try {

    await electron.clearHistory();

    state.selectedHistoryItems.clear();

    await historyController.refreshHistory();

    ui.updateStatus('Cleared history');

  } catch (error) {

    console.error('Failed to clear history:', error);

    ui.updateStatus('Failed to clear history', true);

  }

}

async function clearSelectedArchives() {

  if (state.loadedArchiveIds.size === 0) {

    updateClearSelectedButton();

    ui.updateStatus('No loaded archives to clear');

    return;

  }

  const idsToUnload = Array.from(state.loadedArchiveIds);

  for (const archiveId of idsToUnload) {

    const item = state.historyItems.find(entry => getArchiveIdFromUrl(entry.url) === archiveId);

    if (item) {

      await archive.unloadArchiveFromCollection(item);

    }

  }

  updateClearSelectedButton();

  ui.updateStatus('Cleared selected archives');

}

async function selectAllHistory() {

  const itemsToLoad = state.historyItems.filter(item => !state.loadedArchiveIds.has(getArchiveIdFromUrl(item.url)));

  if (itemsToLoad.length === 0) {

    updateClearSelectedButton();

    ui.updateStatus('All archives are already loaded');

    return;

  }

  for (const item of itemsToLoad) {

    await archive.loadSingleArchiveToCollection(item);

  }

  updateClearSelectedButton();

}

async function selectNoneHistory() {

  await clearSelectedArchives();

}

async function clearLibrary() {

  if (!confirm('Clear non-starred library? Starred items will be preserved.')) return;

  try {

    await electron.clearCache();

    await archive.updateLibraryInfo();

    ui.updateStatus('Non-starred library cleared');

  } catch (error) {

    console.error('Failed to clear library:', error);

    ui.updateStatus('Failed to clear library', true);

  }

}

async function createManualBackup() {

  if (!elements.backupStatus) return;

  elements.backupStatus.textContent = 'Creating backup...';

  elements.backupStatus.style.color = '#4CAF50';

  try {

    await saveSettings(); // Triggers database save + backup on main process

    elements.backupStatus.textContent = 'Backup created successfully!';

  } catch (error) {

    console.error('Failed to create backup:', error);

    elements.backupStatus.textContent = 'Backup failed!';

    elements.backupStatus.style.color = '#ff6b6b';

  } finally {

    setTimeout(() => {

      elements.backupStatus.textContent = '';

    }, 3000);

  }

}

async function listAvailableBackups() {

  try {

    const backups = await electron.listBackups();

    renderBackupList(backups);

  } catch (error) {

    console.error('Failed to list backups:', error);

    ui.updateStatus('Failed to load backup list', true);

  }

}

function renderBackupList(backups) {

  if (!elements.backupList || !elements.backupItems) return;

  elements.backupItems.innerHTML = '';

  elements.backupList.style.display = 'block';

  Object.entries(backups).forEach(([filename, entries]) => {

    entries.forEach(entry => {

      const item = document.createElement('div');

      item.className = 'backup-item';

      const info = document.createElement('div');

      info.className = 'backup-info';

      const fileLabel = document.createElement('div');

      fileLabel.className = 'backup-filename';

      fileLabel.textContent = filename;

      const timeLabel = document.createElement('div');

      timeLabel.className = 'backup-timestamp';

      timeLabel.textContent = entry.timestamp.replace('T', ' ');

      info.appendChild(fileLabel);

      info.appendChild(timeLabel);

      const restoreBtn = document.createElement('button');

      restoreBtn.className = 'restore-btn';

      restoreBtn.textContent = 'Restore';

      restoreBtn.addEventListener('click', async () => {

        await restoreFromBackup(filename, entry.timestamp);

      });

      item.appendChild(info);

      item.appendChild(restoreBtn);

      elements.backupItems.appendChild(item);

    });

  });

}

async function restoreFromBackup(filename, timestamp) {

  try {

    const success = await electron.restoreBackup(filename, timestamp);

    if (success) {

      await loadSettings();

      await historyController.refreshHistory();

      ui.updateStatus(`Restored backup ${filename}`);

    } else {

      throw new Error('Restore failed');

    }

  } catch (error) {

    console.error('Failed to restore backup:', error);

    ui.updateStatus('Failed to restore backup', true);

  }

}

function setupDragAndDrop() {

  document.addEventListener('dragover', (event) => event.preventDefault());

  document.addEventListener('drop', async (event) => {

    event.preventDefault();

    const files = event.dataTransfer.files;

    const text = event.dataTransfer.getData('text');

    if (files.length > 0) {

      const file = files[0];

      if (isArchiveFile(file.name)) {

        try {

          closeHistoryPanel();

          await archive.openLocalArchive(file.path, file.name);

        } catch (error) {

          ui.updateStatus(`Error loading file: ${error.message}`, true);

        }

      } else {

        ui.updateStatus('Dropped file is not a supported archive format', true);

      }

    } else if (text && isSupportedArchiveUrl(text)) {

      elements.urlInput.value = text;

      ui.updateStatus('Archive URL dropped');

      closeHistoryPanel();

      archive.loadArchiveByUrl(text, { updateHistory: true, showLoadingOverlay: true });

    }

  });

}

function attachEventListeners() {

  elements.loadBtn.addEventListener('click', () => archive.loadArchiveFromInput());

  elements.urlInput.addEventListener('keypress', (event) => {

    if (event.key === 'Enter') {

      archive.loadArchiveFromInput();

    }

  });

  elements.historyBtn.addEventListener('click', toggleHistoryPanel);

  elements.settingsBtn.addEventListener('click', toggleSettingsPanel);

  elements.librarySizeSelect.addEventListener('change', saveSettings);

  elements.autoLoadFromClipboardSelect.addEventListener('change', saveSettings);

  elements.maxHistoryItemsSelect.addEventListener('change', saveSettings);

  elements.allowFullscreenUpscalingSelect.addEventListener('change', saveSettings);

  elements.autoLoadAdjacentArchivesSelect.addEventListener('change', saveSettings);

  elements.clearHistoryBtn.addEventListener('click', clearHistory);

  elements.clearSelectedBtn.addEventListener('click', () => {
    clearSelectedArchives().catch(error => console.error('Failed to clear selected archives:', error));
  });
  elements.selectAllBtn.addEventListener('click', () => {
    selectAllHistory().catch(error => console.error('Failed to load all archives:', error));
  });
  elements.selectNoneBtn.addEventListener('click', () => {
    selectNoneHistory().catch(error => console.error('Failed to clear archives:', error));
  });

  elements.newArchiveBtn.addEventListener('click', () => {

    gallery.showWelcome();

    ui.updateStatus('Ready');

  });

  elements.backupDatabaseBtn.addEventListener('click', createManualBackup);

  elements.listBackupsBtn.addEventListener('click', listAvailableBackups);

  elements.clearLibraryBtn.addEventListener('click', clearLibrary);

  const scrollHandler = gallery.getScrollHandler();

  elements.galleryGrid.addEventListener('scroll', scrollHandler);

}

async function initialize() {

  elements = getElements();

  ui = createStatusUI({ elements, state, electron });

  gallery = createGalleryController({ state, elements, ui, electron });

  archive = createArchiveController({ state, elements, ui, electron, gallery });

  gallery.setArchiveIntegration({

    loadAdjacent: archive.loadAdjacentArchive,

    updateLibraryInfo: archive.updateLibraryInfo

  });

  archive.setHistoryController(historyController);

  attachEventListeners();

  setupDragAndDrop();

  document.addEventListener('keydown', handleGlobalKeydown);
  document.addEventListener('click', handleDocumentClick);


  gallery.attachEventListeners();

  await loadSettings();

  await historyController.refreshHistory();

  await archive.updateLibraryInfo();

  await applyClipboardAutoload();

}

document.addEventListener('DOMContentLoaded', initialize);





