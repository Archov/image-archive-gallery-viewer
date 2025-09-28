/**
 * Menu Manager - Handles application menu setup and management
 */
class MenuManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow
  }

  createApplicationMenu() {
    const { Menu } = require('electron')

    const template = [
      {
        label: 'File',
        submenu: [
          {
            label: 'Open Images...',
            accelerator: 'CmdOrCtrl+O',
            click: () => {
              if (this.mainWindow) {
                this.mainWindow.webContents.send('menu-open-images')
              }
            },
          },
          {
            label: 'Open Archives...',
            accelerator: 'CmdOrCtrl+Shift+O',
            click: () => {
              if (this.mainWindow) {
                this.mainWindow.webContents.send('menu-open-archives')
              }
            },
          },
          { type: 'separator' },
          {
            label: 'Settings...',
            accelerator: 'CmdOrCtrl+,',
            click: async () => {
              const settingsManager = require('./settings-manager')
              await settingsManager.openSettingsDialog(this.mainWindow)
            },
          },
          { type: 'separator' },
          {
            label: 'Quit',
            accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
            click: () => {
              const { app } = require('electron')
              app.quit()
            },
          },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectall' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forcereload' },
          { type: 'separator' },
          { role: 'resetzoom' },
          { role: 'zoomin' },
          { role: 'zoomout' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Window',
        submenu: [{ role: 'minimize' }, { role: 'close' }],
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'About Image Gallery',
            click: () => {
              const { dialog, app } = require('electron')
              dialog.showMessageBox(this.mainWindow, {
                type: 'info',
                title: 'About Image Gallery',
                message: 'Image Gallery Manager',
                detail: `Version ${app.getVersion()}\n\nA comprehensive desktop image gallery management system with rich metadata, tagging, and browser integration.`,
              })
            },
          },
        ],
      },
    ]

    // macOS specific adjustments
    if (process.platform === 'darwin') {
      template.unshift({
        label: require('electron').app.getName(),
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services', submenu: [] },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideothers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      })

      // Window menu adjustments for macOS
      const windowMenu = template.find((m) => m.label === 'Window')
      if (windowMenu)
        windowMenu.submenu = [
          { role: 'close' },
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'front' },
        ]
    }

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
  }
}

module.exports = MenuManager
