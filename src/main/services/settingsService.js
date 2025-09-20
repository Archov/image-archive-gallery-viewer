const { getDatabase, saveDatabase } = require('./databaseService');

function loadSettings() {
  const database = getDatabase();
  return database.settings;
}

async function saveSettings(settings) {
  const database = getDatabase();
  database.settings = { ...database.settings, ...settings };
  await saveDatabase();
  return database.settings;
}

module.exports = {
  loadSettings,
  saveSettings
};
