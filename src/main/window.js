const { BrowserWindow } = require('electron');
const path = require('path');

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../../preload.js')
    },
    icon: path.join(__dirname, '../../assets/icon.ico'),
    title: 'Kemono Archive Gallery',
    show: false
  });

  window.loadFile('index.html');

  window.once('ready-to-show', () => {
    window.show();
  });

  return window;
}

module.exports = {
  createMainWindow
};
