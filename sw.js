// 最簡單的 service worker：讓 Chrome 可以「安裝」，並快取 App 外殼。
// 查詢字典和翻譯需要連網，不會被快取。
const CACHE = 'danciben-v14';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/db.js', 'js/srs.js', 'js/lookup.js', 'js/yahoo.js', 'js/docx.js', 'js/vendor/jszip.min.js', 'js/app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 先用網路（拿到最新版），斷線時才用快取
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
