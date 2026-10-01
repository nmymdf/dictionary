// 單字本 Windows 版：把網頁版包成桌面程式（資料存在這台電腦）
const { app, BrowserWindow, shell, ipcMain, net } = require('electron');
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
    webPreferences: { spellcheck: false, preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.maximize();
  win.loadFile(path.join(__dirname, 'www', 'index.html'));
  // 外部連結用瀏覽器開
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (ev, url) => {
    if (!url.startsWith('file://')) { ev.preventDefault(); shell.openExternal(url); }
  });
}

// 只代抓劍橋字典
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
ipcMain.handle('fetch-text', async (ev, url) => {
  if (typeof url !== 'string' || !url.startsWith('https://dictionary.cambridge.org/')) return { status: 0, url: '', text: '' };
  try {
    const r = await net.fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' } });
    return { status: r.status, url: r.url, text: await r.text() };
  } catch (err) {
    return { status: 0, url: '', text: String(err && err.message || err) };
  }
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
