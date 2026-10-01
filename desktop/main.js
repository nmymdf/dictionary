// 單字本 Windows 版：把網頁版包成桌面程式（資料存在這台電腦）
const { app, BrowserWindow, shell, ipcMain, net } = require('electron');
const path = require('path');
const https = require('https');

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
  if (SELFTEST) win.hide(); else win.maximize();
  win.loadFile(path.join(__dirname, 'www', 'index.html'));
  if (SELFTEST) win.webContents.once('did-finish-load', () => setTimeout(runSelftest, 3000));
  // 外部連結用瀏覽器開
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (ev, url) => {
    if (!url.startsWith('file://')) { ev.preventDefault(); shell.openExternal(url); }
  });
}

// 代抓字典網頁（網頁本身不能跨網站讀取）：劍橋、Google 翻譯、Free Dictionary、MyMemory
const ALLOW = ['https://dictionary.cambridge.org/', 'https://translate.googleapis.com/', 'https://api.dictionaryapi.dev/', 'https://api.mymemory.translated.net/'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' };

// 方法一：Electron 的 net.fetch（跟 Chrome 一樣的網路設定，包含代理伺服器）
async function viaNet(url) {
  const r = await net.fetch(url, { headers: HEADERS, redirect: 'follow' });
  return { status: r.status, url: r.url || url, text: await r.text() };
}
// 方法二：Node 內建的 https（萬一方法一失敗）
function viaNode(url, depth = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: HEADERS, timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 5) {
        res.resume();
        resolve(viaNode(new URL(res.headers.location, url).toString(), depth + 1));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, url, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
async function fetchText(url) {
  if (typeof url !== 'string' || !ALLOW.some((a) => url.startsWith(a))) return { status: 0, url: '', text: '', error: 'not allowed' };
  const errors = [];
  for (const fn of [viaNet, viaNode]) {
    try {
      const r = await fn(url);
      if (r.status >= 200 && r.status < 400) return r;
      errors.push(`${fn.name}: HTTP ${r.status}`);
    } catch (err) {
      errors.push(`${fn.name}: ${err && err.message || err}`);
    }
  }
  return { status: 0, url: '', text: '', error: errors.join('; ') };
}
ipcMain.handle('fetch-text', (ev, url) => fetchText(url));

// 發音檔：先下載再播放（避免網站擋外部播放）
const AUDIO_ALLOW = ['https://dictionary.cambridge.org/media/', 'https://translate.google.com/translate_tts'];
async function fetchAudio(url) {
  if (typeof url !== 'string' || !AUDIO_ALLOW.some((a) => url.startsWith(a))) return null;
  try {
    const r = await net.fetch(url, { headers: { 'User-Agent': UA, 'Referer': url.includes('cambridge') ? 'https://dictionary.cambridge.org/' : 'https://translate.google.com/' } });
    if (r.status < 200 || r.status >= 400) return null;
    return Buffer.from(await r.arrayBuffer()).toString('base64');
  } catch (err) {
    return null;
  }
}
ipcMain.handle('fetch-audio', (ev, url) => fetchAudio(url));

// 自我測試（開發用）：Danciben.exe --selftest=結果檔
const SELFTEST = (process.argv.find((a) => a.startsWith('--selftest=')) || '').slice(11);
async function runSelftest() {
  const out = { main: {} };
  for (const u of ['https://dictionary.cambridge.org/dictionary/english-chinese-traditional/test', 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q=test']) {
    const r = await fetchText(u);
    out.main[u.slice(8, 40)] = { status: r.status, len: r.text.length, error: r.error || '' };
  }
  const a1 = await fetchAudio('https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=test');
  out.audioGoogle = a1 ? a1.length : 0;
  const a2 = await fetchAudio('https://dictionary.cambridge.org/media/english-chinese-traditional/us_pron/t/tes/test_/test.mp3');
  out.audioCamb = a2 ? a2.length : 0;
  try {
    out.page = await win.webContents.executeJavaScript(`(async () => {
      const r = { hasDesktop: !!window.DesktopApp, canFetch: !!(window.Cambridge && Cambridge.canFetch()) };
      try { const d = await Cambridge.lookup('test'); r.camb = d ? d.entries.map((e) => e.pos.join('/') + ':' + e.senses.length + ':' + (e.senses[0] || {}).zh).join(' | ') : 'null'; } catch (e) { r.cambErr = String(e && e.message || e); }
      try { const w = await Lookup.word('test'); r.basic = JSON.stringify(w.senses).slice(0, 150); } catch (e) { r.basicErr = String(e && e.message || e); }
      try { r.sent = await Lookup.sentence('How are you?'); } catch (e) { r.sentErr = String(e && e.message || e); }
      try { const z = await Lookup.zh('放棄'); r.zh = z.en + ' / ' + z.groups.length; } catch (e) { r.zhErr = String(e && e.message || e); }
      return r;
    })()`);
  } catch (err) { out.pageErr = String(err); }
  require('fs').writeFileSync(SELFTEST, JSON.stringify(out, null, 2));
  app.exit(0);
}

// 第一次打開時，在桌面放一個「單字本」捷徑（解壓縮版沒有安裝程式）
function makeDesktopShortcut() {
  if (SELFTEST || process.platform !== 'win32' || !app.isPackaged) return;
  try {
    const fs = require('fs');
    const link = path.join(app.getPath('desktop'), '單字本.lnk');
    const ok = fs.existsSync(link) && shell.readShortcutLink(link).target === process.execPath;
    if (!ok) shell.writeShortcutLink(link, fs.existsSync(link) ? 'replace' : 'create', { target: process.execPath, description: '單字本', icon: process.execPath, iconIndex: 0 });
  } catch (err) { /* 做不到也沒關係 */ }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => { createWindow(); makeDesktopShortcut(); });
  app.on('window-all-closed', () => app.quit());
}
