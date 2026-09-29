// 本機資料庫（IndexedDB）。所有資料只存在這台裝置。
// 啟動時整批讀進記憶體，之後每次修改再寫回。
(function () {
  'use strict';
  const NAME = 'danciben';
  const VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('groups')) db.createObjectStore('groups', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const result = fn(t.objectStore(store));
      t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  const DB = {
    all(store) { return tx(store, 'readonly', (s) => s.getAll()); },
    put(store, value) { return tx(store, 'readwrite', (s) => { s.put(value); }); },
    putMany(store, values) { return tx(store, 'readwrite', (s) => { values.forEach((v) => s.put(v)); }); },
    del(store, key) { return tx(store, 'readwrite', (s) => { s.delete(key); }); },
    clear(store) { return tx(store, 'readwrite', (s) => { s.clear(); }); },
    getMeta(key) { return tx('meta', 'readonly', (s) => s.get(key)); },
    setMeta(key, value) { return tx('meta', 'readwrite', (s) => { s.put(value, key); }); },
    async estimate() {
      try { const e = await navigator.storage.estimate(); return e.usage || 0; } catch (err) { return 0; }
    },
    async persist() {
      // 請瀏覽器不要自動清掉資料
      try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (err) { /* 忽略 */ }
      return false;
    },
  };
  window.DB = DB;
})();
