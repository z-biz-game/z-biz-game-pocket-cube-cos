// Desktop shell: the game is a browser build, so Electron serves it over the same
// zero-dependency static server instead of file:// (ES module imports need an origin).
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { startServer } = require('../server.cjs');

async function createWindow() {
  const server = await startServer({ port: 0 });
  const { port } = server.address();
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 780,
    minHeight: 600,
    backgroundColor: '#101217',
    // The window's own chrome takes its icon from the same generated tiles the web build ships:
    // without it, Windows and Linux show the generic Electron icon in the taskbar and alt-tab.
    // macOS ignores this field and uses the bundle icon (build/icon.icns) instead.
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    title: '魔方袖珍 Pocket Cube',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  win.on('closed', () => server.close());
}

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
