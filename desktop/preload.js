// 給網頁用的功能：代抓劍橋字典網頁（網頁本身不能跨網站讀取）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('DesktopApp', {
  fetchText: (url) => ipcRenderer.invoke('fetch-text', url),
});
