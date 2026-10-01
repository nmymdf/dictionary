// 給網頁用的功能：代抓字典網頁與發音檔（網頁本身不能跨網站讀取）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('DesktopApp', {
  fetchText: (url) => ipcRenderer.invoke('fetch-text', url),
  fetchAudio: (url) => ipcRenderer.invoke('fetch-audio', url),
});
