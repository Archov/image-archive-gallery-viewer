const { createHash } = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDatabase, saveDatabase } = require('./databaseService');

function loadHistory() {
  const database = getDatabase();
  return database.history.slice().reverse();
}

async function addToHistory(historyItem) {
  const database = getDatabase();
  const existingIndex = database.history.findIndex(item => item.url === historyItem.url);

  if (existingIndex !== -1) {
    database.history[existingIndex] = {
      ...database.history[existingIndex],
      ...historyItem,
      lastAccessed: new Date().toISOString()
    };
  } else {
    const newItem = {
      id: uuidv4(),
      starred: false,
      ...historyItem
    };
    database.history.push(newItem);
  }

  const maxItems = database.settings.maxHistoryItems || 100;
  if (database.history.length > maxItems) {
    const starred = database.history.filter(item => item.starred);
    const nonStarred = database.history
      .filter(item => !item.starred)
      .sort((a, b) => new Date(b.lastAccessed) - new Date(a.lastAccessed))
      .slice(0, maxItems - starred.length);

    database.history = [...starred, ...nonStarred];
  }

  await saveDatabase();
}

async function clearHistory() {
  const database = getDatabase();
  database.history = database.history.filter(item => item.starred);
  await saveDatabase();
}

async function toggleHistoryStar(historyId) {
  const database = getDatabase();
  const historyItem = database.history.find(h => h.id === historyId);

  if (!historyItem) {
    throw new Error('History item not found');
  }

  historyItem.starred = !historyItem.starred;

  const archiveId = createHash('md5').update(historyItem.url).digest('hex');
  const archive = database.archives[archiveId];
  if (archive) {
    archive.starred = historyItem.starred;
  }

  await saveDatabase();
  return { starred: historyItem.starred };
}

async function renameHistoryItem(historyId, newName) {
  const database = getDatabase();
  const itemIndex = database.history.findIndex(item => item.id === historyId);

  if (itemIndex === -1) {
    return false;
  }

  database.history[itemIndex].name = newName;
  await saveDatabase();
  return true;
}

async function reorderHistory(newOrder) {
  const database = getDatabase();

  if (!Array.isArray(newOrder) || newOrder.length !== database.history.length) {
    return false;
  }

  const reordered = [];
  for (const id of newOrder) {
    const item = database.history.find(h => h.id === id);
    if (item) {
      reordered.push(item);
    }
  }

  if (reordered.length !== database.history.length) {
    return false;
  }

  database.history = reordered;
  await saveDatabase();
  return true;
}

module.exports = {
  loadHistory,
  addToHistory,
  clearHistory,
  toggleHistoryStar,
  renameHistoryItem,
  reorderHistory
};
