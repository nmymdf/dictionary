// 單字本 Windows 版：把網頁版包成桌面程式（資料存在這台電腦）
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

app.setAppUserModelId('tw.archiekuo.danciben');
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 900,
    title: '單字本',
    autoHideMenuBar: true,
    backgroundColor: '#f7f8f6',
    icon: path.join(__dirname, 'www', 'icons', 'icon-512.png'),
    webPreferences: { spellcheck: false },
  });
  win.maximize();
  win.loadFile(path.join(__dirname, 'www', 'index.html'));
  // 外部連結用瀏覽器開
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (ev, url) => {
    if (!url.startsWith('file://')) { ev.preventDefault(); shell.openExternal(url); }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
