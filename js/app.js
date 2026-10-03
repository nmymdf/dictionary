// 單字本 — 主程式
// 資料存在本機 IndexedDB(js/db.js)；線上查詢在 js/lookup.js；複習排程在 js/srs.js。
(function () {
  'use strict';

  /* ---------- 狀態 ---------- */
  const DAYMS = 86400000;
  const APP_VERSION = '1.5.5';
  const APP_DATE = '2026/10/01';
  const IS_DESKTOP = !!window.DesktopApp;
  const DEFAULT_SETTINGS = {
    accent: 'en-US', rate: 1, voice: '', autoSpeak: false,
    defaultMode: 'word', newPerDay: 20, perSession: 20, retention: 0.85,
    fontSize: 'normal', zoom: window.DesktopApp ? 1.75 : 2, theme: 'light', skipRare: false,
    voiceMode: 'natural',  // natural：線上自然語音；system：系統語音
    reviewScope: 'all',    // all / old（47 個檔）/ new（新查的）
  };
  const RECENT_MAX = 20;
  const S = {
    ready: false,
    entries: [],
    index: new Map(),      // id → entry
    groups: {},
    recent: [],            // 最近查過（最多 20 個）[{key, q, kind:'w'|'s'|'zh', zh, at}]
    dict: {},              // 查詢結果 { key: {status:'loading'|'ok'|'error', data, msg} }
    log: {},               // 每天複習數 { 'YYYY-MM-DD': n }
    daily: { date: '', newDone: 0 },
    settings: { ...DEFAULT_SETTINGS },
    mode: 'word',
    draft: '',
    lib: { src: 'old', filter: 'all', usage: 'all', tag: '', q: '', sort: 'file', limit: 100 },
    reviewSetup: { range: 'all', mode: 'mix', tag: '', open: false },
    session: null,
    backup: { file: null, parsed: null, strategy: 'merge', result: null },
    imp: { step: 1, files: [], parsed: null, error: '' },
    shareText: null,
    zh: {},
    confirm: '',           // 需要再按一次確認的動作
  };

  const byId = (id) => S.index.get(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); };

  function normText(t) { return String(t || '').trim().replace(/\s+/g, ' '); }
  function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function makeId(type, text) {
    const t = normText(text).toLowerCase();
    return type === 'word' ? 'w:' + t : 's:' + hash(t.replace(/[^a-z0-9]+/g, ' ').trim());
  }

  function newReview() { return { status: 'none', s: 0, d: 0, due: null, last: null, reps: 0, lapses: 0, right: 0, wrong: 0, suspended: false }; }

  // 補齊欄位，讓舊資料或匯入資料都能用
  function normEntry(e) {
    const type = e.type === 'sentence' ? 'sentence' : 'word';
    const out = {
      id: e.id || makeId(type, e.text),
      type,
      text: normText(e.text),
      ipa: e.ipa || '',
      senses: Array.isArray(e.senses) ? e.senses.filter((s) => s && s.zh) : [],
      zh: e.zh || '',
      examples: Array.isArray(e.examples) ? e.examples.filter((x) => x && x.en) : [],
      forms: e.forms && (e.forms.infl || (e.forms.fam && e.forms.fam.length)) ? { infl: e.forms.infl || '', fam: e.forms.fam || [] } : null,
      notes: Array.isArray(e.notes) ? e.notes : [],
      usage: e.usage || null,
      group: e.group || null,
      related: Array.isArray(e.related) ? e.related : [],
      dict: e.dict || null,        // 新查的字：當時查到的字典內容
      tags: Array.isArray(e.tags) ? e.tags : [],
      date: e.date || '',
      fixes: Array.isArray(e.fixes) ? e.fixes : [],
      starred: !!e.starred,
      count: e.count || 0,
      last: e.last || null,
      added: e.added || Date.now(),
      order: e.order ?? 0,
      src: e.src === 'import' ? 'import' : 'new',
      edited: !!e.edited,
      review: { ...newReview(), ...(e.review || {}) },
    };
    return out;
  }

  /* ---------- 儲存 ---------- */
  function addEntry(e) {
    S.entries.push(e);
    S.index.set(e.id, e);
  }
  function saveEntry(e) { DB.put('entries', e).catch(dbFail); }
  function saveEntries(list) { return DB.putMany('entries', list).catch(dbFail); }
  // 最近查過 + 這些字查到的內容（重開 App 也能馬上打開）
  let recentTimer;
  function saveRecent() {
    clearTimeout(recentTimer);
    recentTimer = setTimeout(() => {
      const cache = {};
      S.recent.forEach((r) => { const d = S.dict[r.key]; if (d && d.status === 'ok') cache[r.key] = d.data; });
      DB.setMeta('recent', S.recent).catch(dbFail);
      DB.setMeta('dictCache', cache).catch(dbFail);
    }, 300);
  }
  function addRecent(key, q, kind, zh) {
    S.recent = S.recent.filter((r) => r.key !== key);
    S.recent.unshift({ key, q, kind, zh: zh || '', at: Date.now() });
    S.recent = S.recent.slice(0, RECENT_MAX);
    saveRecent();
  }
  function removeEntry(e) {
    S.entries = S.entries.filter((x) => x !== e);
    S.index.delete(e.id);
    DB.del('entries', e.id).catch(dbFail);
  }
  const saveSettings = () => DB.setMeta('settings', S.settings).catch(dbFail);
  const saveGroups = () => DB.putMany('groups', Object.values(S.groups)).catch(dbFail);
  function dbFail(err) { console.error(err); toast('資料無法儲存：' + (err && err.message ? err.message : err)); }

  /* ---------- 圖示 ---------- */
  const P = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/><path d="M9 7h6"/>',
    cards: '<rect x="3" y="7" width="14" height="13" rx="2"/><path d="M7 4h12a2 2 0 0 1 2 2v11"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.4l6.1-.8z"/>',
    speaker: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>',
    back: '<path d="M15 5 8 12l7 7"/>',
    chev: '<path d="m9 5 7 7-7 7"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    pen: '<path d="m4 20 4-1 11-11-3-3L5 16z"/><path d="m14 7 3 3"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
    play: '<path d="M8 5v14l11-7z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  };
  const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name]}</svg>`;

  /* ---------- 小工具 ---------- */
  function rel(t) {
    if (!t) return '—';
    const diff = Date.now() - t;
    if (diff < 0) {
      const d = Math.ceil(-diff / DAYMS);
      return d <= 1 ? '明天' : `${d} 天後`;
    }
    const m = Math.round(diff / 60000);
    if (m < 1) return '剛剛';
    if (m < 60) return `${m} 分鐘前`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} 小時前`;
    const d = Math.round(h / 24);
    return d === 1 ? '昨天' : `${d} 天前`;
  }
  const STATUS = {
    none: ['未加入複習', 'st-none'],
    new: ['新字', 'st-new'],
    learning: ['學習中', 'st-learning'],
    review: ['複習中', 'st-learning'],
    mastered: ['已熟記', 'st-mastered'],
  };
  function statusKey(e) {
    const r = e.review;
    if (!e.starred) return 'none';
    if (r.status === 'new' || !r.reps) return 'new';
    if (r.s >= 21) return 'mastered';
    return r.s >= 3 ? 'review' : 'learning';
  }
  const statusPill = (e) => {
    const [label, cls] = STATUS[statusKey(e)];
    return `<span class="pill ${cls}">${e.review.suspended ? '已暫停' : label}</span>`;
  };
  const USAGE = { daily: ['生活', 'u-daily'], formal: ['正式', 'u-formal'], rare: ['很少用', 'u-rare'] };
  // 「生活／正式／很少用」是當初主觀判斷的，已經不顯示（資料保留）
  const usageChip = () => '';
  function usagePicker(e) {
    return `<div class="usage-pick" role="group" aria-label="用法">${Object.entries(USAGE).map(([k, [t, c]]) =>
      `<button class="uchip ${c} ${e.usage === k ? 'on' : 'off'}" data-act="set-usage" data-id="${esc(e.id)}" data-u="${k}" aria-pressed="${e.usage === k}">${t}</button>`).join('')}</div>`;
  }
  const zhShort = (e) => (e.type === 'sentence' ? e.zh : e.senses.map((s) => s.zh).join('；'));

  function wordRe(word) {
    const w = word.toLowerCase();
    if (/\s/.test(w)) return new RegExp(`(${reEsc(w).replace(/\\?\s+/g, '\\s+')})`, 'i');
    // 字尾變化：e 結尾去 e、y 結尾變 i、重複字尾子音
    let stem = w;
    if (/e$/.test(w) && w.length > 3) stem = w.slice(0, -1);
    else if (/y$/.test(w) && w.length > 3) stem = w.slice(0, -1) + '[yi]';
    else if (/[^aeiou][aeiou][bdgklmnprt]$/.test(w)) stem = reEsc(w) + w.slice(-1) + '?';
    else stem = reEsc(w);
    return new RegExp(`\\b(${stem}[a-z]*)`, 'i');
  }
  function highlight(en, word) {
    const re = new RegExp(wordRe(word).source, 'gi');
    return esc(en).replace(re, '<mark>$1</mark>');
  }
  const hasWord = (en, word) => wordRe(word).test(en);

  /* ---------- 發音（系統 TTS) ---------- */
  // 裝成 Android App 時，由 App 提供發音、存檔（window.AndroidApp)
  const NATIVE = window.AndroidApp || null;
  const hasTTS = () => !!NATIVE || 'speechSynthesis' in window;
  let voices = [];
  function loadVoices() {
    if (NATIVE) { try { voices = JSON.parse(NATIVE.voices() || '[]'); } catch (err) { voices = []; } return; }
    try { voices = speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang)); } catch (err) { voices = []; }
  }
  if (NATIVE) {
    loadVoices();
    window.__ttsReady = () => { loadVoices(); if (/settings/.test(location.hash)) render(); };
  } else if ('speechSynthesis' in window) {
    loadVoices();
    speechSynthesis.addEventListener?.('voiceschanged', () => { loadVoices(); if (/settings/.test(location.hash)) render(); });
  }
  function pickVoice() {
    const want = S.settings.accent.toLowerCase();
    const norm = (v) => v.lang.replace('_', '-').toLowerCase();
    return voices.find((v) => v.name === S.settings.voice)
      || voices.find((v) => norm(v) === want && /google/i.test(v.name))
      || voices.find((v) => norm(v) === want)
      || voices[0] || null;
  }
  let speakingBtn = null;
  /* 自然發音：線上自然語音；失敗就改用系統語音 */
  let curAudio = null;
  function playUrls(urls, rate) {
    return new Promise((resolve, reject) => {
      let i = 0;
      const next = async () => {
        if (i >= urls.length) { resolve(); return; }
        let src = urls[i++];
        // Windows 版：先由程式下載發音檔再播放
        if (window.DesktopApp && window.DesktopApp.fetchAudio) {
          const b64 = await window.DesktopApp.fetchAudio(src).catch(() => null);
          if (!b64) { reject(new Error('audio')); return; }
          const bin = atob(b64);
          const buf = new Uint8Array(bin.length);
          for (let k = 0; k < bin.length; k++) buf[k] = bin.charCodeAt(k);
          src = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
        }
        const a = new Audio(src);
        curAudio = a;
        a.playbackRate = rate;
        a.onended = next;
        a.onerror = () => reject(new Error('audio'));
        a.play().catch(reject);
      };
      next();
    });
  }
  function ttsUrls(text) {
    const tl = S.settings.accent === 'en-GB' ? 'en-GB' : 'en';
    const parts = [];
    let rest = normText(text);
    while (rest.length > 180) {
      let cut = Math.max(rest.lastIndexOf('. ', 180), rest.lastIndexOf(', ', 180), rest.lastIndexOf('; ', 180));
      if (cut < 60) cut = rest.lastIndexOf(' ', 180);
      if (cut < 1) cut = 180;
      parts.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) parts.push(rest);
    return parts.map((q) => `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${tl}&q=${encodeURIComponent(q)}`);
  }
  function speak(text, rate, btn) {
    if (!text) return;
    if (S.settings.voiceMode === 'system' || navigator.onLine === false) { speakSystem(text, rate, btn); return; }
    if (curAudio) { curAudio.pause(); curAudio = null; }
    try { NATIVE?.stop(); } catch (err) { /* 沒關係 */ }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (speakingBtn) speakingBtn.classList.remove('speaking');
    speakingBtn = btn || null;
    btn?.classList.add('speaking');
    const r = rate || Number(S.settings.rate) || 1;
    playUrls(ttsUrls(text), r)
      .catch(() => { btn?.classList.remove('speaking'); speakSystem(text, rate, btn); })
      .then(() => btn?.classList.remove('speaking'));
  }
  function speakSystem(text, rate, btn) {
    if (NATIVE) {
      if (speakingBtn) speakingBtn.classList.remove('speaking');
      if (!voices.length) loadVoices();
      const v = pickVoice();
      speakingBtn = btn || null;
      btn?.classList.add('speaking');
      window.__ttsEnd = () => btn?.classList.remove('speaking');
      let ok = false;
      try { ok = NATIVE.speak(text, v ? v.lang : S.settings.accent, Number(rate || S.settings.rate) || 1, v ? v.name : ''); } catch (err) { ok = false; }
      if (!ok) { btn?.classList.remove('speaking'); toast('找不到英文語音：請到手機的「設定 → 文字轉語音」安裝英文語音'); }
      return;
    }
    if (!('speechSynthesis' in window)) { toast('這個瀏覽器不支援系統語音，請改用 Chrome 或 Edge'); return; }
    const synth = speechSynthesis;
    if (speakingBtn) speakingBtn.classList.remove('speaking');
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v ? v.lang.replace('_', '-') : S.settings.accent;
    u.rate = rate || Number(S.settings.rate) || 1;
    u.onstart = () => { speakingBtn = btn || null; btn?.classList.add('speaking'); };
    u.onend = () => btn?.classList.remove('speaking');
    u.onerror = (e) => {
      btn?.classList.remove('speaking');
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      toast(voices.length ? `無法發音（${e.error})` : '找不到英文語音：請到系統設定安裝英文的文字轉語音');
    };
    // Chrome 在 cancel() 之後馬上 speak() 有時會沒聲音，所以稍微等一下
    const busy = synth.speaking || synth.pending;
    if (busy) synth.cancel();
    setTimeout(() => {
      try { synth.speak(u); synth.resume(); } catch (err) { toast('無法播放發音'); }
    }, busy ? 80 : 0);
  }

  /* ---------- 深淺色 ---------- */
  const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const t = S.settings.theme;
    const dark = t === 'dark' || (t === 'system' && darkMQ.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.font = S.settings.fontSize;
    // 整個畫面一起放大（字、按鈕、圖示），不只放大字
    document.documentElement.style.zoom = String(Number(S.settings.zoom) || 1);
    markNarrow();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#121816' : '#f7f8f6';
    try { NATIVE?.setDark(dark); } catch (err) { /* 舊版 App 沒有這個功能 */ }
  }
  darkMQ.addEventListener?.('change', applyTheme);
  // 放大後實際可用的寬度很窄時，改用更精簡的排版
  // 依「放大後實際可用的寬度」決定排版：寬（左側選單）、一般（底部分頁）、窄（精簡）
  function markNarrow() {
    const w = window.innerWidth / (Number(S.settings.zoom) || 1);
    document.documentElement.classList.toggle('narrow', w < 360);
    // 電腦版：左邊的圖示列一直都在；夠寬時查詢頁分成左右兩欄
    document.documentElement.classList.toggle('wide', !!window.DesktopApp || w >= 680);
    document.documentElement.classList.toggle('two-col', w >= 820);
    document.documentElement.classList.toggle('slim', w < 560);
  }
  window.addEventListener('resize', markNarrow);
  function saveTheme() { try { localStorage.setItem('danciben-theme', S.settings.theme); localStorage.setItem('danciben-zoom', String(S.settings.zoom)); } catch (err) { /* 無法儲存沒關係 */ } }

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
  }
  // 有「復原」按鈕的提示，停久一點
  function toastAction(msg, label, fn) {
    const el = document.getElementById('toast');
    el.innerHTML = `<span>${esc(msg)}</span><button class="toast-btn" type="button">${esc(label)}</button>`;
    el.hidden = false;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    el.querySelector('.toast-btn').addEventListener('click', () => { el.hidden = true; fn(); toast('已復原'); }, { once: true });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 7000);
  }

  const go = (path) => { location.hash = '#/' + path; };

  /* ---------- 查詢 ---------- */
  const hasZh = (t) => /[㐀-鿿]/.test(t);
  function looksLikeSentence(t) {
    t = normText(t);
    if (hasZh(t)) return t.length > 8 || /[，。！？；,.!?]/.test(t);
    return t.split(' ').length > 3 || /[.!?]$/.test(t);
  }
  const wordKey = (w) => 'w:' + normText(w).toLowerCase();
  const sentKey = (t) => 's:' + normText(t);
  const keyOf = (cur) => (cur.kind === 'w' ? wordKey(cur.q) : sentKey(cur.q));

  // 查詢結果直接顯示在查詢頁的搜尋框下面（S.cur），不換頁
  function runQuery(raw, mode) {
    const text = normText(raw).replace(/^["“'(]+|["”')]+$/g, '');
    if (!text) { toast('先輸入要查的單字或句子'); return; }
    S.draft = '';
    mode = mode || S.mode;
    const kind = mode === 'sentence' || looksLikeSentence(text) ? 's' : 'w';
    showResult(kind, kind === 'w' ? text.replace(/[.,!?;:。，！？]+$/, '').toLowerCase() : text);
  }
  function showResult(kind, q) {
    S.cur = { kind, q };
    const key = keyOf(S.cur);
    const st = S.dict[key];
    if (!st || st.status === 'error') (kind === 'w' ? fetchWord(q) : fetchSentence(q));
    S.scrollTop = true;
    if (location.hash !== '#/search') go('search'); else render();
  }
  function renderIfShowing(key, route) {
    if ((location.hash === '#/search' && S.cur && keyOf(S.cur) === key) || location.hash === route) render();
  }

  // Yahoo 連不上時的備用：Google 翻譯字典
  function basicToDict(word, r) {
    return {
      source: 'basic', dict: 'Google 翻譯（備用）', word, zhQuery: false, ipa: r.ipa || '',
      gist: r.senses.map((x) => ({ pos: x.pos || '', zh: x.zh })), infl: [], syn: [],
      entries: r.examples.length ? [{ pos: '', posName: '例句', senses: [{ text: '', examples: r.examples }] }] : [],
    };
  }
  async function fetchWord(word) {
    const key = wordKey(word);
    const t0 = performance.now();
    S.dict[key] = { status: 'loading' };
    let data = null, notFound = false;
    const why = [];
    try { data = await Yahoo.lookup(word); notFound = !data; } catch (e) { why.push('Yahoo：' + (e.message || e)); }
    if (!data && !notFound && !hasZh(word)) {
      try { data = basicToDict(word, await Lookup.word(word)); } catch (e) { why.push('備用字典：' + (e.message || e)); }
    }
    const ms = Math.round(performance.now() - t0);
    if (data) {
      S.dict[key] = { status: 'ok', data, ms };
      addRecent(key, word, 'w', gistShort(data));
      const e = byId(key);
      if (e && e.src === 'new' && !e.dict) { e.dict = data; saveEntry(e); }
    } else {
      S.dict[key] = {
        status: 'error', ms, why: why.join('；'),
        msg: navigator.onLine === false ? '沒有網路連線' : notFound ? `字典裡沒有「${word}」，請檢查拼字` : 'Yahoo 字典沒有回應',
      };
    }
    renderIfShowing(key, '#/w/' + encodeURIComponent(word));
  }
  // 句子：英文 → 中文；中文 → 英文
  async function fetchSentence(text) {
    const key = sentKey(text);
    const t0 = performance.now();
    S.dict[key] = { status: 'loading' };
    try {
      const zhSrc = hasZh(text);
      const tr = zhSrc ? (await Lookup.zh(text)).en : await Lookup.sentence(text);
      if (!tr) throw new Error('沒有翻譯結果');
      S.dict[key] = { status: 'ok', data: { tr, dir: zhSrc ? 'zh-en' : 'en-zh' }, ms: Math.round(performance.now() - t0) };
      addRecent(key, text, 's', tr);
    } catch (err) {
      S.dict[key] = { status: 'error', msg: navigator.onLine === false ? '沒有網路連線' : '翻譯服務沒有回應', why: String(err && err.message || err) };
    }
    renderIfShowing(key, '#/s/' + encodeURIComponent(text));
  }
  const gistShort = (d) => d.gist.map((g) => g.zh).join('｜');
  const sentTr = (d) => (d ? d.tr || d.zh || '' : '');

  // 找到單字庫裡對應的那一筆（句子用 makeId 比對；中文句子用它的英文翻譯比對）
  function entryFor(key) {
    if (key.startsWith('w:')) return byId(key);
    const t = key.slice(2);
    if (!hasZh(t)) return byId(makeId('sentence', t));
    const tr = sentTr((S.dict[key] || {}).data);
    return tr ? byId(makeId('sentence', tr)) : null;
  }

  // 加入複習：47 個檔的字直接標星號；新字、新句子存到「新查的」（可以加一行備註）
  function addToReview(key) {
    const noteEl = document.getElementById('rv-note');
    const note = noteEl ? noteEl.value.trim() : '';
    let e = entryFor(key);
    if (e) {
      e.starred = true;
      if (!e.review.reps) { e.review.status = 'new'; e.review.due = Date.now(); }
      if (note && !e.notes.includes(note)) e.notes.push(note);
      saveEntry(e);
    } else if (key.startsWith('w:')) {
      const d = (S.dict[key] || {}).data;
      if (!d) { toast('還沒查到內容，等一下再加'); return; }
      const word = key.slice(2);
      const exs = [];
      d.entries.forEach((en) => en.senses.forEach((x) => x.examples.forEach((ex) => { if (ex.zh && ex.en) exs.push(ex); })));
      exs.sort((a, b) => a.en.length - b.en.length);
      e = normEntry({
        id: key, type: 'word', text: word, src: 'new', starred: true, ipa: d.ipa,
        senses: d.gist.map((g) => ({ pos: g.pos, zh: g.zh })),
        examples: exs.filter((x) => hasWord(x.en, word)).slice(0, 5),
        forms: d.infl.length ? { infl: d.infl.join('；'), fam: [] } : null,
        notes: note ? [note] : [], dict: d, added: Date.now(),
      });
      e.review.status = 'new'; e.review.due = Date.now();
      addEntry(e); saveEntry(e);
    } else {
      const d = (S.dict[key] || {}).data;
      const text = key.slice(2);
      if (!d) { toast('還沒翻譯好，等一下再加'); return; }
      const zhSrc = d.dir === 'zh-en';
      e = normEntry({ type: 'sentence', text: zhSrc ? d.tr : text, zh: zhSrc ? text : sentTr(d), notes: note ? [note] : [], src: 'new', starred: true, added: Date.now() });
      e.review.status = 'new'; e.review.due = Date.now();
      addEntry(e); saveEntry(e);
    }
    toast('已加入複習，存在「新查的」');
    render();
  }
  // 取消複習：新查的整筆刪掉（可以復原）；47 個檔的字只是拿掉星號
  function removeFromReview(e) {
    if (e.src === 'new') {
      removeEntry(e);
      toastAction(`已刪除「${e.type === 'word' ? e.text : '這個句子'}」`, '復原', () => { addEntry(e); saveEntry(e); render(); });
    } else {
      const before = { ...e.review };
      e.starred = false; saveEntry(e);
      toastAction('已移出複習', '復原', () => { e.starred = true; e.review = before; saveEntry(e); render(); });
    }
    render();
  }
  function toggleStar(id) {
    const e = byId(id);
    if (!e) return;
    if (e.starred) removeFromReview(e); else addToReview(id);
  }

  /* ---------- 標籤：47 個檔 / 新查的 ---------- */
  function srcTag(e) {
    if (!e) return '';
    if (e.src === 'new') {
      const d = new Date(e.added);
      return `<span class="src-tag new">新查・${d.getMonth() + 1}/${d.getDate()}</span>`;
    }
    const t = e.tags[0] || '單字簿';
    return `<span class="src-tag old">${esc(t)}${e.tags.length > 1 ? ` +${e.tags.length - 1}` : ''}</span>`;
  }

  /* ---------- 共用區塊 ---------- */
  function starBtn(e, big) {
    return `<button class="star-btn ${e.starred ? 'on' : ''} ${big ? 'big' : ''}" data-act="star" data-id="${esc(e.id)}" aria-pressed="${e.starred}">
      ${ic('star')}<span>${e.starred ? '已加入複習' : '加入複習'}</span></button>`;
  }
  const speakBtn = (text, label = '播放發音', cls = '') => `<button class="icon-btn ${cls}" data-act="speak" data-text="${esc(text)}" aria-label="${label}">${ic('speaker')}</button>`;

  function sensesBlock(e) {
    if (!e.senses.length) return '<p class="muted">（沒有中文意思）</p>';
    return `<ol class="senses">${e.senses.map((s) => `<li><span class="pos">${esc(s.pos)}</span><span>${esc(s.zh)} ${usageChip(s.u)}</span></li>`).join('')}</ol>`;
  }
  function examplesBlock(e, limit) {
    const list = limit ? e.examples.slice(0, limit) : e.examples;
    if (!list.length) return '<p class="muted small">（沒有例句）</p>';
    return `<ul class="examples">${list.map((x) => `
      <li class="${x.easy ? 'easy' : ''}">${x.easy ? '<span class="easy-tag">生活例句</span>' : ''}<div class="ex-en" lang="en">${highlight(x.en, e.text)} ${speakBtn(x.en, '播放例句')}</div>
      ${x.zh ? `<div class="ex-zh">${esc(x.zh)}</div>` : ''}</li>`).join('')}</ul>`;
  }
  function formsBlock(e) {
    const f = e.forms;
    if (!f) return '';
    return `<section class="block"><h3>字的型態</h3>
      ${f.infl ? `<p class="infl" lang="en">${esc(f.infl)}</p>` : ''}
      ${f.fam && f.fam.length ? `<div class="chips">${f.fam.map((x) => `<button class="chip-link" data-act="query" data-text="${esc(x.w)}" data-mode="word"><b lang="en">${esc(x.w)}</b> <span class="pos">${esc(x.pos)}</span> ${esc(x.zh)}</button>`).join('')}</div>` : ''}
    </section>`;
  }
  function notesBlock(e) {
    if (!e.notes.length) return '';
    return `<section class="block"><h3>補充</h3><ul class="notes">${e.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>`;
  }
  function fixesBlock(e) {
    if (!e.fixes.length) return '';
    return `<section class="block"><h3>更正紀錄</h3><ul class="fixes">${e.fixes.map((x) => `<li><span class="fix-note">${esc(x)}</span></li>`).join('')}</ul></section>`;
  }
  // 筆記裡跟這個字有關的說明（易混淆、相關字）
  function relatedBlock(e) {
    const lines = [...e.related];
    if (!lines.length) return '';
    return `<div class="related"><span class="related-l">${ic('alert')} 相關說明</span><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
  }
  function sentenceTokens(text) {
    return esc(text).split(/([A-Za-z][A-Za-z'’-]*)/).map((part) => {
      if (/^[A-Za-z]/.test(part)) {
        const known = S.index.has('w:' + part.toLowerCase());
        return `<button class="tok ${known ? 'known' : ''}" data-act="query" data-text="${part.toLowerCase()}" data-mode="word">${part}</button>`;
      }
      return part;
    }).join('');
  }
  const tagChips = (e) => e.tags.map((t) => `<a class="tag" href="#/library" data-act="lib-tag" data-t="${esc(t)}">#${esc(t)}</a>`).join('');

  const pageHref = (type, text) => `#/${type === 'sentence' || type === 's' ? 's' : 'w'}/${encodeURIComponent(type === 'sentence' || type === 's' ? text : text.toLowerCase())}`;
  function entryRow(e, opts = {}) {
    return `<li class="row">
      <a class="row-main" href="${pageHref(e.type, e.text)}">
        <span class="row-title ${e.type === 'sentence' ? 'is-sent' : ''}" ${e.type === 'word' ? 'lang="en"' : ''}>${esc(e.text)}</span>
        <span class="row-sub">${opts.noTag ? '' : srcTag(e)}${usageChip(e.usage)}${esc(zhShort(e))}</span>
      </a>
      <div class="row-meta">
        ${speakBtn(e.text, '播放發音', 'row-speak')}
        ${opts.del
    ? `<button class="icon-btn ghost row-del" data-act="del-new" data-id="${esc(e.id)}" aria-label="刪除">${ic('trash')}</button>`
    : `<button class="star-mini ${e.starred ? 'on' : ''}" data-act="star" data-id="${esc(e.id)}" aria-label="${e.starred ? '移出複習' : '加入複習'}">${ic('star')}</button>`}
      </div></li>`;
  }

  /* ---------- 畫面：查詢 ---------- */
  // 在單字簿裡找中文意思含有這個詞的字；意思剛好等於這個詞的排前面
  function zhMatches(q, limit) {
    const parts = (e) => (e.type === 'word' ? e.senses.map((x) => x.zh).join('；') : e.zh || '').split(/[；;，,、／/（）()\s]+/);
    const out = [];
    for (const e of S.entries) {
      if (e.temp) continue;
      const zh = e.type === 'word' ? e.senses.map((x) => x.zh).join('；') : e.zh || '';
      if (!zh.includes(q)) {
        // 意思裡沒有，但例句的中文有：排最後
        if (e.type === 'word' && e.examples.some((x) => (x.zh || '').includes(q))) out.push({ e, score: 8 });
        continue;
      }
      const exact = parts(e).includes(q);
      out.push({ e, score: (exact ? 0 : 2) + (e.type === 'word' ? 0 : 4) + (e.starred ? 0 : 1) });
    }
    out.sort((a, b) => a.score - b.score || a.e.text.length - b.e.text.length);
    const res = out.filter((x) => x.score < 8).slice(0, limit).map((x) => x.e);
    res.inExamples = out.filter((x) => x.score >= 8).slice(0, 10).map((x) => x.e);
    return res;
  }

  function suggestions(q) {
    q = q.trim().toLowerCase();
    if (q && hasZh(q)) return zhMatches(q, 6).filter((e) => e.type === 'word');
    if (!q || S.mode !== 'word') return [];
    const out = [];
    for (const e of S.entries) {
      if (e.type === 'word' && !e.temp && e.text.startsWith(q)) { out.push(e); if (out.length > 30) break; }
    }
    return out.sort((a, b) => a.text.length - b.text.length).slice(0, 6);
  }
  function suggestHtml(q) {
    const list = suggestions(q);
    return list.map((e) => `<li><a href="#/result/${encodeURIComponent(e.id)}" data-act="open-sugg" data-id="${esc(e.id)}"><b lang="en">${esc(e.text)}</b><span>${esc(zhShort(e))}</span></a></li>`).join('');
  }

  function recentRow(r) {
    const e = entryFor(r.key);
    const kind = r.kind === 's' ? 's' : 'w';
    const on = S.cur && keyOf(S.cur) === r.key;
    return `<li class="row ${on ? 'cur' : ''}">
      <button class="row-main" data-act="open-recent" data-kind="${kind}" data-q="${esc(r.q)}">
        <span class="row-title ${kind === 's' ? 'is-sent' : ''}" ${hasZh(r.q) ? '' : 'lang="en"'}>${esc(r.q)}</span>
        <span class="row-sub">${e && e.starred ? '<span class="in-rv">複習中</span>' : ''}${esc(r.zh)}</span>
      </button>
</li>`;
  }

  function viewSearch() {
    const isSent = S.mode === 'sentence';
    const empty = !S.entries.some((e) => e.src === 'import');
    const cur = S.cur;
    const result = cur ? (cur.kind === 'w' ? wordResultHtml(cur.q) : sentResultHtml(cur.q)) : '';
    return {
      title: '查詢', tab: 'search', hideTitle: true,
      html: `
      <div class="search-layout"><div class="s-main">
      <div class="searchbar">
        <form class="search-box ${S.draft ? 'has-text' : ''}" id="search-form">
          <textarea id="q" rows="1" lang="en" autocapitalize="off" autocomplete="off" spellcheck="false" enterkeyhint="search"
            placeholder="${isSent ? '貼上英文或中文句子' : '英文／中文／整句'}">${esc(S.draft)}</textarea>
          <div class="search-actions">
            <button type="button" class="icon-btn ghost" data-act="clear" aria-label="清除">${ic('x')}</button>
            <button type="submit" class="btn primary">${ic('search')}<span>${isSent ? '翻譯' : '查詢'}</span></button>
          </div>
        </form>
        <div class="search-under">
          <div class="seg mini-seg" role="tablist" aria-label="查詢模式">
            <button role="tab" class="${!isSent ? 'on' : ''}" data-act="mode" data-mode="word" aria-selected="${!isSent}">單字</button>
            <button role="tab" class="${isSent ? 'on' : ''}" data-act="mode" data-mode="sentence" aria-selected="${isSent}">句子</button>
          </div>
          <span class="input-hint">貼上句子會自動翻譯</span>
        </div>
        <ul class="suggest" id="suggest">${suggestHtml(S.draft)}</ul>
      </div>
      ${cur ? `<div class="result" id="result">${result}
        <div class="result-foot"><button class="link small" data-act="close-result">${ic('x')} 關閉這個結果</button></div></div>` : ''}
      ${empty ? `<section class="block panel onboard">
        <h3>${ic('file')} 還沒有匯入你的單字簿</h3>
        <p class="note">到「更多 → 匯出 / 匯入 JSON」選 <b>danciben-import.json</b>,47 個 Word 檔整理好的單字就會進來。</p>
        <a class="btn primary" href="#/backup">去匯入</a>
      </section>` : ''}
      </div><aside class="s-side">
      ${curSide()}
      <section class="block side-recent">
        <div class="block-head"><h3>最近查過</h3>${S.recent.length ? '<button class="link small" data-act="clear-recent">清除</button>' : ''}</div>
        ${S.recent.length ? `<ul class="list recent">${S.recent.map(recentRow).join('')}</ul>` : '<p class="muted small empty-hint">最近查過的 20 個字和句子會列在這裡。<br>想留下來複習，在查詢結果按「加入複習」，會存到「新查的」。</p>'}
      </section>
      </aside></div>`,
      after() {
        const ta = document.getElementById('q');
        const sug = document.getElementById('suggest');
        // 輸入框依內容自動變高，不出現捲軸
        const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
        fit();
        ta.addEventListener('input', () => {
          fit();
          S.draft = ta.value;
          ta.closest('form').classList.toggle('has-text', !!ta.value);
          sug.innerHTML = suggestHtml(ta.value);
        });
        ta.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); runQuery(ta.value); }
        });
        document.getElementById('search-form').addEventListener('submit', (ev) => { ev.preventDefault(); runQuery(ta.value); });
        if (S.scrollTop) { S.scrollTop = false; window.scrollTo(0, 0); }
        if (document.documentElement.classList.contains('wide') && !S.cur) ta.focus();
      },
    };
  }

  /* ---------- 查詢結果：單字 ---------- */
  const errBox = (msg, act, data) => (/拼字/.test(msg)
    ? `<div class="error-box">${ic('alert')}<div><b>${esc(msg)}</b></div></div>`
    : `<div class="error-box">${ic('alert')}<div><b>查不到：${esc(msg)}</b><br><span class="small">確認有連上網路後再試一次。</span></div>
    <button class="btn small" data-act="${act}" ${data}>重試</button></div>`);
  const loadingBox = (t) => `<div class="loading dict-loading"><span class="spinner"></span>${t}</div>`;
  const whyLine = (st) => (st && st.why ? `<p class="muted small err-why">詳細原因：${esc(st.why)}</p>` : '');

  function reviewBtn(key, e) {
    const on = e && e.starred;
    return `<div class="rv-box">
      ${on ? '' : `<input id="rv-note" class="rv-note" type="text" placeholder="備註（可不填），例如：句型 be worth + V-ing" autocomplete="off">`}
      <div class="rv-row">
        <button class="rv-btn ${on ? 'on' : ''}" data-act="rv-toggle" data-key="${esc(key)}" aria-pressed="${!!on}">${ic(on ? 'check' : 'plus')}<span>${on ? '已加入複習' : '加入複習'}</span></button>
        <span class="rv-hint">${on ? (e.src === 'new' ? '存在「新查的」。再按一次會刪除（可以復原）' : '再按一次移出複習') : '按了才會存到「新查的」、排進複習'}</span>
      </div>
      ${on && e.notes.length && e.src === 'new' ? `<p class="rv-notes">${ic('pen')} ${esc(e.notes.join('；'))}</p>` : ''}
    </div>`;
  }

  function exampleHtml(x, word, zhFirst) {
    const en = x.en ? `<p class="ex-en" lang="en">${word ? highlight(x.en, word) : esc(x.en)} ${speakBtn(x.en, '播放例句', 'ex-speak')}</p>` : '';
    const zh = x.zh ? `<p class="ex-zh">${esc(x.zh)}</p>` : '';
    return `<div class="ex">${zhFirst ? zh + en : en + zh}</div>`;
  }
  // 中查英：英文候選字做成可以點的按鈕
  const enPicks = (s) => s.split(/\s*[;；,，]\s*/).filter(Boolean).map((w) => `<button class="en-pick" data-act="query" data-text="${esc(w)}" data-mode="word" lang="en">${esc(w)}</button>`).join('');

  function senseHtml(x, i, word, zhq) {
    const exs = x.examples;
    const SHOW = 2;
    return `<li class="def">
      ${x.text ? `<div class="def-main"><span class="def-n">${i + 1}</span><div class="def-text"><p class="def-zh">${zhq ? enPicks(x.text) : esc(x.text)}</p></div></div>` : ''}
      ${exs.slice(0, SHOW).map((ex) => exampleHtml(ex, zhq ? '' : word, zhq)).join('')}
      ${exs.length > SHOW ? `<details class="more-ex"><summary>再看 ${exs.length - SHOW} 個例句</summary>${exs.slice(SHOW).map((ex) => exampleHtml(ex, zhq ? '' : word, zhq)).join('')}</details>` : ''}
    </li>`;
  }

  function dictHtml(d, word, ms) {
    const zhq = d.zhQuery;
    const blocks = d.entries.map((en) => `<article class="pos-block">
        ${en.posName || en.pos ? `<header class="pos-h"><span class="pos-name">${esc(en.posName || en.pos)}</span>${en.pos && en.posName !== en.pos ? `<span class="pos-en" lang="en">${esc(en.pos)}</span>` : ''}</header>` : ''}
        <ol class="defs">${en.senses.map((x, i) => senseHtml(x, i, word, zhq)).join('')}</ol>
      </article>`).join('');
    return `<section class="dict">
      <div class="dict-head"><h3>詳細解釋</h3><span class="muted small">${esc(d.dict || 'Yahoo 字典')}${ms ? ` · ${(ms / 1000).toFixed(1)} 秒` : ''}</span></div>
      ${blocks}
    </section>`;
  }
  // 側欄：字的變化、同義詞、反義詞（寬螢幕放右邊，窄的時候放在結果下面）
  function sideHtml(d) {
    if (!d) return '';
    const infl = d.infl.length ? `<section class="side-card"><h4>字的變化</h4><p class="infl-list" lang="en">${d.infl.map(esc).join('<br>')}</p></section>` : '';
    const syn = d.syn.length ? `<section class="syn side-card">
        <h4>同義詞・反義詞</h4>
        ${d.syn.slice(0, 6).map((s) => `<div class="syn-row"><span class="syn-k ${s.kind === '反義詞' ? 'anti' : ''}">${s.kind === '反義詞' ? '反' : '同'}</span>
          <div class="syn-body">${s.label ? `<span class="syn-l">${esc(s.label)}</span>` : ''}<div class="chips">${s.words.map((w) => `<button class="en-pick" data-act="query" data-text="${esc(w)}" data-mode="word" lang="en">${esc(w)}</button>`).join('')}</div></div></div>`).join('')}
      </section>` : '';
    return infl + syn;
  }
  function curSide() {
    const cur = S.cur;
    if (!cur || cur.kind !== 'w') return '';
    const key = wordKey(cur.q);
    const st = S.dict[key];
    const e = byId(key);
    return sideHtml(st && st.status === 'ok' ? st.data : (e && e.dict && e.dict.gist ? e.dict : null));
  }

  function noteCard(e) {
    const exs = e.examples.slice(0, 3);
    return `<section class="note-card">
      <div class="note-head"><h3>${ic('book')} 我的筆記</h3>${srcTag(e)}${usageChip(e.usage)}</div>
      ${sensesBlock(e)}
      ${e.forms ? `<div class="note-forms">${e.forms.infl ? `<p class="infl" lang="en">${esc(e.forms.infl)}</p>` : ''}${e.forms.fam && e.forms.fam.length ? `<div class="chips">${e.forms.fam.map((x) => `<button class="chip-link" data-act="query" data-text="${esc(x.w)}" data-mode="word"><b lang="en">${esc(x.w)}</b> <span class="pos">${esc(x.pos)}</span> ${esc(x.zh)}</button>`).join('')}</div>` : ''}</div>` : ''}
      ${exs.length ? `<div class="note-ex">${exs.map((x) => exampleHtml(x, e.text)).join('')}</div>` : ''}
      ${relatedBlock(e)}
      ${e.notes.length ? `<ul class="notes">${e.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <a class="link small" href="#/entry/${encodeURIComponent(e.id)}">編輯筆記・複習紀錄 ${ic('chev')}</a>
    </section>`;
  }

  function wordResultHtml(word) {
    word = normText(word).toLowerCase();
    const key = wordKey(word);
    if (!S.dict[key]) fetchWord(word);
    const st = S.dict[key];
    const e = byId(key);
    const d = st.status === 'ok' ? st.data : (e && e.dict && e.dict.gist ? e.dict : null);
    const zhq = hasZh(word);
    const gist = d ? d.gist : (e ? e.senses.map((x) => ({ pos: x.pos, zh: x.zh })) : []);
    const ipa = (d && d.ipa) || (e && e.ipa) || '';
    let dict;
    if (d) dict = dictHtml(d, word, st.ms);
    else if (st.status === 'loading') dict = loadingBox('正在查 Yahoo 字典…');
    else dict = errBox(st.msg, 'w-retry', `data-q="${esc(word)}"`) + whyLine(st);
    const mine = zhq ? zhMatches(word, 12).filter((x) => x.type === 'word') : [];
    return `
      <header class="wd-head">
        <div class="wd-tags">${srcTag(e)}${e ? usageChip(e.usage) : ''}</div>
        <div class="hw-line">
          <h2 class="headword ${zhq ? 'zh' : ''}" ${zhq ? '' : 'lang="en"'}>${esc(word)}</h2>
          ${zhq ? '' : `<button class="pron" data-act="speak" data-text="${esc(word)}">${ic('speaker')}${ipa ? `<span class="ipa" lang="en">${esc(ipa)}</span>` : '<span>唸出來</span>'}</button>`}
        </div>
        ${gist.length ? `<ul class="gist">${gist.map((g) => `<li>${g.pos ? `<span class="pos">${esc(g.pos)}</span>` : ''}<span>${zhq ? enPicks(g.zh) : esc(g.zh)}</span></li>`).join('')}</ul>` : ''}
        ${zhq ? (gist.length ? '<p class="rv-hint">點英文字可以看那個字的解釋，再加入複習</p>' : '') : (d || e ? reviewBtn(key, e) : '')}
      </header>
      ${e && e.src === 'import' ? noteCard(e) : ''}
      ${dict}
      ${mine.length ? `<section class="block"><h3>你的單字簿裡意思相符的字</h3><ul class="list">${mine.map((x) => entryRow(x)).join('')}</ul></section>` : ''}`;
  }

  /* ---------- 查詢結果：句子 ---------- */
  function sentResultHtml(text) {
    text = normText(text);
    const key = sentKey(text);
    const zhSrc = hasZh(text);
    let e = zhSrc ? null : byId(makeId('sentence', text));
    let tr = e && e.src === 'import' ? e.zh : '';
    let box = '';
    let st = null;
    if (!tr) {
      if (!S.dict[key]) fetchSentence(text);
      st = S.dict[key];
      if (st.status === 'ok') tr = sentTr(st.data);
      else if (st.status === 'loading') box = loadingBox('正在翻譯…');
      else box = errBox(st.msg, 's-retry', `data-q="${esc(text)}"`) + whyLine(st);
      if (zhSrc) e = entryFor(key);
    } else addRecentQuiet(key, text, 's', tr);
    const en = zhSrc ? tr : text;
    return `
      <section class="sent-card">
        <div class="wd-tags">${srcTag(e)}</div>
        <p class="sent-label">${zhSrc ? '中文' : '英文'}</p>
        <div class="sent-en" ${zhSrc ? '' : 'lang="en"'}>${zhSrc ? esc(text) : sentenceTokens(text)}</div>
        ${tr ? `<p class="sent-label">${zhSrc ? '英文翻譯' : '中文翻譯'}${st && st.ms ? ` <span class="muted">· ${(st.ms / 1000).toFixed(1)} 秒</span>` : ''}</p>
        <div class="sent-tr" ${zhSrc ? 'lang="en"' : ''}>${zhSrc ? sentenceTokens(tr) : esc(tr)}</div>` : box}
        ${en ? `<div class="sent-actions">
          <button class="pron" data-act="speak" data-text="${esc(en)}">${ic('speaker')}<span>唸英文</span></button>
          <button class="pron" data-act="speak" data-text="${esc(en)}" data-rate="0.75">${ic('speaker')}<span>慢一點</span></button>
        </div>
        <p class="tap-hint">點英文句子裡的字，可以查那個字</p>` : ''}
      </section>
      ${tr ? reviewBtn(key, e) : ''}`;
  }
  // 從單字簿打開（沒有上網）也算查過
  function addRecentQuiet(key, q, kind, zh) {
    if (S.recent[0] && S.recent[0].key === key) return;
    addRecent(key, q, kind, zh);
  }

  // 從單字庫打開的單字／句子頁（有返回鍵）
  function viewWord(word) {
    const d = (S.dict[wordKey(word)] || {}).data;
    return { title: '單字', tab: 'library', back: '#/library', html: wordResultHtml(word) + sideHtml(d && d.gist ? d : null) };
  }
  function viewSent(text) {
    return { title: '句子', tab: 'library', back: '#/library', html: sentResultHtml(text) };
  }

  /* ---------- 畫面：分享進來 ---------- */
  function viewShare() {
    const text = S.shareText;
    if (text && hasZh(text) && text.length <= 40) { S.shareText = null; go('zh/' + encodeURIComponent(text.trim())); return { redirect: true }; }
    if (!text) {
      return {
        title: '從其他 App 分享', tab: 'search', back: '#/search',
        html: `
        <ol class="share-steps">
          <li><span class="step-n">1</span>在 Chrome、Kindle 等 App 裡選取文字</li>
          <li><span class="step-n">2</span>點「分享」</li>
          <li><span class="step-n">3</span>在分享選單選「單字本」</li>
        </ol>
        <p class="muted small">要先用 Chrome 把單字本「安裝」到手機（加到主畫面），分享選單裡才會出現單字本。</p>`,
      };
    }
    const isSent = looksLikeSentence(text);
    return {
      title: '分享進來的文字', tab: 'search', back: '#/search',
      html: `
      <section class="received">
        <div class="received-from">${ic('share')} 收到的文字 · 判斷為<b>${isSent ? '句子' : '單字'}</b></div>
        <blockquote lang="en">${esc(text)}</blockquote>
        <div class="btn-col">
          <button class="btn primary" data-act="query" data-text="${esc(text)}" data-mode="${isSent ? 'sentence' : 'word'}">${isSent ? '翻譯這句' : '查這個字'}</button>
          ${isSent ? `<p class="muted small">或只查其中一個字：</p><div class="sent-en small-sent" lang="en">${sentenceTokens(text)}</div>` : `<button class="btn ghost" data-act="query" data-text="${esc(text)}" data-mode="sentence">當成句子翻譯</button>`}
        </div>
      </section>`,
    };
  }

  /* ---------- 畫面：單字庫 ---------- */
  function allTags() {
    const set = new Set();
    S.entries.forEach((e) => e.tags.forEach((t) => set.add(t)));
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));
  }

  function viewLibrary() {
    const L = S.lib;
    const isNewTab = L.src === 'new';
    const nOld = S.entries.filter((e) => e.src === 'import').length;
    const nNew = S.entries.length - nOld;
    const real = S.entries.filter((e) => (e.src === 'new') === isNewTab);
    const counts = {
      all: real.length,
      star: real.filter((e) => e.starred).length,
      word: real.filter((e) => e.type === 'word').length,
      sentence: real.filter((e) => e.type === 'sentence').length,
    };
    let list = real.filter((e) => (L.filter === 'all') || (L.filter === 'star' && e.starred) || (L.filter === e.type));
    if (L.tag && !isNewTab) list = list.filter((e) => e.tags.includes(L.tag));
    if (L.q) {
      const q = L.q.toLowerCase().trim();
      list = list.filter((e) => e.text.toLowerCase().includes(q) || zhShort(e).includes(L.q.trim()));
    }
    const sorters = {
      recent: (a, b) => (b.added || 0) - (a.added || 0),
      az: (a, b) => a.text.localeCompare(b.text),
      file: (a, b) => a.order - b.order,
      wrong: (a, b) => (b.review.lapses || 0) - (a.review.lapses || 0) || (b.review.wrong || 0) - (a.review.wrong || 0),
    };
    const sortKey = isNewTab && L.sort === 'file' ? 'recent' : (!isNewTab && L.sort === 'recent' ? 'file' : L.sort);
    list.sort(sorters[sortKey] || sorters.file);
    const total = list.length;
    const shown = list.slice(0, L.limit);
    const f = (key, label) => `<button class="fchip ${L.filter === key ? 'on' : ''}" data-act="lib-filter" data-f="${key}">${label}<span class="tnum">${counts[key]}</span></button>`;
    return {
      title: '單字庫', tab: 'library',
      html: `
      <div class="src-tabs" role="tablist">
        <button role="tab" class="${!isNewTab ? 'on' : ''}" data-act="lib-src" data-s="old" aria-selected="${!isNewTab}"><span>我的單字簿</span><small class="tnum">47 個檔 · ${nOld}</small></button>
        <button role="tab" class="${isNewTab ? 'on new' : ''}" data-act="lib-src" data-s="new" aria-selected="${isNewTab}"><span>新查的</span><small class="tnum">${nNew}</small></button>
      </div>
      ${isNewTab && !nNew ? `<div class="empty-card">${ic('plus')}<p>還沒有新查的字</p><p class="muted small">查字典時按「加入複習」，那個字或句子就會存到這裡，<br>也會排進複習。這裡的內容跟 47 個檔分開。</p><a class="btn primary" href="#/search">去查字</a></div>` : `
      <div class="lib-tools">
        <label class="lib-search">${ic('search')}<input id="lib-q" type="search" placeholder="搜尋英文或中文" value="${esc(L.q)}"></label>
        <div class="fchips">${f('all', '全部')}${isNewTab ? '' : f('star', '複習中')}${f('word', '單字')}${f('sentence', '句子')}</div>
        <div class="filter-row">
          ${isNewTab ? '' : `<label class="sort">檔案
            <select id="lib-tag"><option value="">全部</option>${allTags().map((t) => `<option value="${esc(t)}" ${L.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
          </label>`}
          <label class="sort">排序
            <select id="lib-sort">
              ${(isNewTab ? [['recent', '最近加入'], ['wrong', '最常答錯'], ['az', 'A → Z']] : [['file', '檔案順序'], ['wrong', '最常答錯'], ['az', 'A → Z']]).map(([v, t]) => `<option value="${v}" ${sortKey === v ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </label>
        </div>
        <p class="muted small tnum">共 ${total} 筆${isNewTab ? ' · 按垃圾桶就刪除，下方可以復原' : ''}</p>
      </div>
      ${shown.length ? `<ul class="list">${shown.map((e) => entryRow(e, { del: isNewTab, noTag: !isNewTab })).join('')}</ul>` : '<p class="empty">沒有符合的項目。換個關鍵字或篩選條件試試。</p>'}
      ${total > shown.length ? `<button class="btn ghost wide" data-act="lib-more">再顯示 ${Math.min(100, total - shown.length)} 筆</button>` : ''}`}`,
      after() {
        const q = document.getElementById('lib-q');
        if (!q) return;
        let t;
        q.addEventListener('input', () => {
          clearTimeout(t);
          t = setTimeout(() => {
            S.lib.q = q.value; S.lib.limit = 100;
            const pos = q.selectionStart;
            render();
            const n = document.getElementById('lib-q');
            n.focus(); n.setSelectionRange(pos, pos);
          }, 200);
        });
        document.getElementById('lib-sort').addEventListener('change', (ev) => { S.lib.sort = ev.target.value; render(); });
        document.getElementById('lib-tag')?.addEventListener('change', (ev) => { S.lib.tag = ev.target.value; S.lib.limit = 100; render(); });
      },
    };
  }

  /* ---------- 畫面：單字詳情 ---------- */
  function viewEntry(id) {
    const e = byId(id);
    if (!e) return viewMissing();
    if (S.editing === e.id) return viewEdit(e);
    const r = e.review;
    const total = (r.right || 0) + (r.wrong || 0);
    const stats = `
      <div class="stats">
        <div><span class="stat-n">${statusPill(e)}</span><span class="stat-l">複習狀態</span></div>
        <div><span class="stat-n">${rel(e.review.last)}</span><span class="stat-l">上次複習</span></div>
        <div><span class="stat-n tnum">${total ? `${r.right}/${total}` : '—'}</span><span class="stat-l">答對次數</span></div>
      </div>
      ${e.starred && r.due && r.reps ? `<p class="muted small due">下次複習：${r.due <= endOfToday() ? '今天' : rel(r.due)}${r.s ? ` · 記憶穩定度約 ${Math.round(r.s)} 天` : ''}</p>` : ''}`;
    const tags = e.tags.length ? tagChips(e) : '<span class="muted small">（新查的，沒有檔案標籤）</span>';
    const body = e.type === 'word'
      ? `<section class="block"><h3>意思</h3>${sensesBlock(e)}</section>
         ${formsBlock(e)}
         <section class="block"><h3>例句</h3>${examplesBlock(e)}</section>
         ${notesBlock(e)}
         ${relatedBlock(e)}`
      : `<section class="block"><div class="sent-en" lang="en">${sentenceTokens(e.text)}</div></section>
         <section class="block"><h3>中文翻譯</h3><p class="sent-zh">${esc(e.zh)}</p></section>
         ${e.date ? `<p class="muted small">筆記日期：${esc(e.date)}</p>` : ''}`;
    return {
      title: e.type === 'word' ? '單字詳情' : '句子詳情', tab: 'library', back: '#/library',
      html: `
      <header class="hw">
        <div class="wd-tags">${srcTag(e)}</div>
        <div class="hw-line"><h2 class="headword ${e.type === 'sentence' ? 'sent-head' : ''}" lang="en">${esc(e.type === 'word' ? e.text : '句子')}</h2>${speakBtn(e.text)}</div>
        ${e.ipa && e.type === 'word' ? `<div class="ipa-line"><span class="ipa">${esc(e.ipa)}</span></div>` : ''}
        ${reviewBtn(e.type === 'word' ? e.id : sentKey(e.text), e)}
      </header>
      ${stats}
      ${body}
      ${fixesBlock(e)}
      <section class="block"><h3>檔案標籤${e.tags.length > 1 ? ` <span class="muted">· 出現在 ${e.tags.length} 個檔案</span>` : ''}</h3><div class="chips">${tags}</div></section>
      <div class="danger-row">
        <button class="btn ghost" data-act="edit" data-id="${esc(e.id)}">${ic('pen')} 編輯</button>
        ${e.starred ? `<button class="btn ghost" data-act="suspend" data-id="${esc(e.id)}">${e.review.suspended ? '恢復複習' : '暫停複習'}</button>` : ''}
        <a class="btn ghost" href="${pageHref(e.type, e.text)}">查字典</a>
        <button class="btn ghost danger" data-act="delete" data-id="${esc(e.id)}">${ic('trash')} 刪除</button>
      </div>`,
    };
  }

  // 編輯：意思、例句、型態、用法、補充
  function viewEdit(e) {
    const senses = e.senses.map((s) => `${s.pos} ${s.zh}`.trim()).join('\n');
    const exs = e.examples.map((x) => `${x.en} = ${x.zh}`).join('\n');
    const fam = e.forms ? e.forms.fam.map((x) => `${x.w} ${x.pos} ${x.zh}`).join('\n') : '';
    return {
      title: '編輯', tab: 'library', back: '#/entry/' + encodeURIComponent(e.id),
      html: `
      <form class="edit-form" id="edit-form">
        <h2 class="headword" lang="en">${esc(e.text)}</h2>
        ${e.type === 'word' ? `
        <label>音標<input id="ed-ipa" value="${esc(e.ipa)}" lang="en" autocapitalize="off"></label>
        <label>意思 <span class="muted small">一行一個，詞性在前，例：v. 適應；改編</span><textarea id="ed-senses" rows="4">${esc(senses)}</textarea></label>
        <label>例句 <span class="muted small">一行一句，英文 = 中文</span><textarea id="ed-ex" rows="5" lang="en">${esc(exs)}</textarea></label>
        <label>動詞/名詞變化<input id="ed-infl" value="${esc(e.forms ? e.forms.infl : '')}" lang="en" autocapitalize="off"></label>
        <label>相關詞 <span class="muted small">一行一個，例：adaptation n. 適應</span><textarea id="ed-fam" rows="3" lang="en">${esc(fam)}</textarea></label>`
        : `<label>英文<textarea id="ed-text" rows="3" lang="en">${esc(e.text)}</textarea></label>
        <label>中文翻譯<textarea id="ed-zh" rows="3">${esc(e.zh)}</textarea></label>`}
        <label>補充筆記 <span class="muted small">一行一則</span><textarea id="ed-notes" rows="3">${esc(e.notes.join('\n'))}</textarea></label>
        <div class="start-bar"><button type="button" class="btn ghost" data-act="edit-cancel">取消</button><button type="submit" class="btn primary">儲存</button></div>
      </form>`,
      after() {
        document.getElementById('edit-form').addEventListener('submit', (ev) => {
          ev.preventDefault();
          const v = (id) => (document.getElementById(id) || {}).value || '';
          const lines = (id) => v(id).split('\n').map((l) => l.trim()).filter(Boolean);
          if (e.type === 'word') {
            e.ipa = v('ed-ipa').trim();
            e.senses = lines('ed-senses').map((l) => {
              const m = l.match(/^((?:[a-z]+\.\s*\/?\s*)+|phr\.?)\s*(.*)$/i);
              return m ? { pos: m[1].trim(), zh: m[2].trim() } : { pos: '', zh: l };
            });
            const old = new Map(e.examples.map((x) => [x.en, x]));
            e.examples = lines('ed-ex').map((l) => {
              const [en, ...zh] = l.split(' = ');
              const prev = old.get(en.trim());
              return { ...(prev || {}), en: en.trim(), zh: zh.join(' = ').trim() };
            });
            const famList = lines('ed-fam').map((l) => {
              const m = l.match(/^([A-Za-z][A-Za-z' -]*?)\s+((?:[a-z]+\.\s*\/?\s*)+)\s*(.*)$/);
              return m ? { w: m[1].trim(), pos: m[2].trim(), zh: m[3].trim() } : { w: l, pos: '', zh: '' };
            });
            const infl = v('ed-infl').trim();
            e.forms = infl || famList.length ? { infl, fam: famList } : null;
          } else {
            e.text = normText(v('ed-text'));
            e.zh = v('ed-zh').trim();
          }
          e.notes = lines('ed-notes');
          e.edited = true;
          saveEntry(e);
          S.editing = null;
          toast('已儲存');
          render();
        });
      },
    };
  }

  /* ---------- 複習 ---------- */
  const KIND = {
    flash: ['閃卡', '看英文想中文，翻面對答案'],
    reverse: ['反向閃卡', '看中文想英文，比較難，但記得最牢'],
    cloze: ['例句挖空', '從例句選出正確的字'],
    confuse: ['易混淆辨析', '選項只有同組的字，專練分辨'],
    listen: ['聽發音選字', '聽系統語音，選出聽到的字'],
    spell: ['拼字', '看中文或聽發音，自己拼出英文'],
  };
  const GRADES = [['忘了', 'grade-0'], ['困難', 'grade-1'], ['記得', 'grade-2'], ['簡單', 'grade-3']];
  const LEECH = 4;

  const inReview = (e) => e.starred && !e.review.suspended && !e.temp;
  const isNew = (e) => inReview(e) && !e.review.reps;
  const isDue = (e) => inReview(e) && e.review.reps > 0 && e.review.due <= endOfToday();
  const isLeech = (e) => inReview(e) && (e.review.lapses || 0) + Math.max(0, (e.review.wrong || 0) - 1) >= LEECH;
  const notRare = () => true;
  const inScope = (e) => S.settings.reviewScope === 'all' || (S.settings.reviewScope === 'new') === (e.src === 'new');

  // 47 個檔的字以前讀過，第一次按「記得」隔 7 天、「簡單」隔 3 週，不用從頭開始
  const FIRST_OLD = { 3: 7, 4: 21 };
  function scheduleFor(e, g) {
    const ret = Number(S.settings.retention);
    const out = SRS.schedule(e.review, g, ret);
    if (e.src === 'import' && !e.review.reps && FIRST_OLD[g] && out.days < FIRST_OLD[g]) return SRS.withFirstInterval(out, FIRST_OLD[g], ret);
    return out;
  }
  const previewFor = (e) => [1, 2, 3, 4].map((g) => scheduleFor(e, g).days);

  function rollDaily() {
    if (S.daily.date !== today()) { S.daily = { date: today(), newDone: 0 }; DB.setMeta('daily', S.daily).catch(dbFail); }
  }

  function todayPlan() {
    rollDaily();
    const due = S.entries.filter((e) => isDue(e) && notRare(e) && inScope(e)).sort((a, b) => a.review.due - b.review.due);
    const newLeft = Math.max(0, Number(S.settings.newPerDay) - S.daily.newDone);
    // 新查的字優先（剛查過最容易記），再來才是 47 個檔的新字
    // 新字：新查的優先，47 個檔的新字隨機挑（每次不會都從同一個字開始）
    const pool = S.entries.filter((e) => isNew(e) && notRare(e) && inScope(e));
    const fresh = [...shuffle(pool.filter((e) => e.src === 'new')), ...shuffle(pool.filter((e) => e.src !== 'new'))].slice(0, newLeft);
    return { due, fresh, newLeft, list: [...due, ...fresh] };
  }

  // 題型自動混合：新字先認得 → 例句與辨析 → 熟了改考反向、拼字、聽力
  function pickKind(e) {
    const r = e.review;
    const rnd = Math.random();
    if (e.type === 'sentence') return !r.reps || rnd < 0.5 ? 'flash' : 'reverse';
    if (!r.reps) return 'flash';
    const group = e.group && S.groups[e.group] && S.groups[e.group].members.filter((m) => byId(m)).length > 1;
    if (group && (r.lapses > 0 || rnd < 0.35)) return 'confuse';
    if (r.s < 4) return rnd < 0.6 ? 'cloze' : 'flash';
    if (r.s < 15) return ['cloze', 'reverse', 'listen', 'spell'][Math.floor(rnd * 4)];
    return ['reverse', 'spell', 'listen'][Math.floor(rnd * 3)];
  }

  function customPool() {
    const R = S.reviewSetup;
    let pool;
    if (R.range === 'tag') pool = S.entries.filter((e) => e.tags.includes(R.tag) && !e.temp && !e.review.suspended);
    else pool = S.entries.filter(inReview);
    if (R.range === 'due') pool = pool.filter(isDue);
    if (R.range === 'recent') pool = pool.filter((e) => Date.now() - (e.review.last || 0) < 7 * DAYMS && e.review.reps);
    if (R.range === 'leech') pool = pool.filter(isLeech);
    if (R.range === 'new') pool = pool.filter((e) => e.src === 'new');
    if (R.range === 'old') pool = pool.filter((e) => e.src === 'import');
    pool = pool.filter(notRare);
    if (!['flash', 'reverse', 'mix'].includes(R.mode)) pool = pool.filter((e) => e.type === 'word');
    if (R.mode === 'confuse') pool = pool.filter((e) => e.group && S.groups[e.group]);
    return pool;
  }

  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function optionsFor(e) {
    const same = e.group && S.groups[e.group] ? S.groups[e.group].members.filter((m) => m !== e.id).map(byId).filter(Boolean) : [];
    const pos = (e.senses[0] || {}).pos;
    const words = S.entries.filter((x) => x.type === 'word' && !x.temp && x.id !== e.id && !same.includes(x) && !/\s/.test(x.text) === !/\s/.test(e.text));
    const samePos = words.filter((x) => (x.senses[0] || {}).pos === pos);
    const pickFrom = shuffle(samePos.length >= 6 ? samePos : words).slice(0, 3);
    return shuffle([e, ...same.slice(0, 3), ...pickFrom].slice(0, 4));
  }

  function makeItem(e, kind) {
    const exs = e.examples.filter((x) => hasWord(x.en, e.text));
    if ((kind === 'cloze' || kind === 'confuse') && !exs.length) kind = e.review.s > 4 ? 'spell' : 'flash';
    if (kind === 'confuse' && !(e.group && S.groups[e.group])) kind = 'cloze';
    let options = null;
    if (kind === 'cloze' || kind === 'listen') options = optionsFor(e).map((o) => o.id);
    if (kind === 'confuse') options = shuffle(S.groups[e.group].members.filter((m) => byId(m))).slice(0, 4);
    const easy = exs.filter((x) => x.easy);
    const pool = kind === 'cloze' && easy.length ? easy : exs;
    const ex = pool.length ? pool[Math.floor(Math.random() * pool.length)] : (e.examples[0] || null);
    return { id: e.id, kind, options, ex, result: null, next: '', again: false };
  }

  function startSession(list, mode, title) {
    if (!list.length) { toast('沒有要複習的字'); return; }
    S.session = { mode, title, i: 0, flipped: false, picked: null, typed: '', items: list.map((e) => makeItem(e, mode === 'mix' ? pickKind(e) : mode)), undo: null };
    if (mode === 'mix') {
      // 新字留在後段，先清到期的；同組的字不要連在一起
      const due = shuffle(S.session.items.filter((x) => byId(x.id).review.reps));
      const fresh = shuffle(S.session.items.filter((x) => !byId(x.id).review.reps));
      S.session.items = [...due, ...fresh];
    } else S.session.items = shuffle(S.session.items);
    go('review/quiz');
  }
  const startToday = () => startSession(todayPlan().list, 'mix', '今天的複習');
  const startCustom = () => {
    const R = S.reviewSetup;
    startSession(shuffle(customPool()).slice(0, Number(S.settings.perSession)), R.mode, R.mode === 'mix' ? '自訂複習' : KIND[R.mode][0]);
  };

  // 7 天內每天到期數量
  function forecast() {
    const days = [];
    const start = new Date(); start.setHours(0, 0, 0, 0);
    for (let i = 0; i < 7; i++) days.push({ t: start.getTime() + (i + 1) * DAYMS - 1, n: 0 });
    S.entries.forEach((e) => {
      if (!inReview(e) || !e.review.reps) return;
      const idx = days.findIndex((d) => e.review.due <= d.t);
      if (idx >= 0) days[idx].n++;
    });
    return days;
  }
  function streak() {
    let n = 0;
    const d = new Date();
    if (!S.log[today()]) d.setDate(d.getDate() - 1);
    for (;;) {
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!S.log[k]) break;
      n++; d.setDate(d.getDate() - 1);
    }
    return n;
  }

  function viewReviewHome() {
    const R = S.reviewSetup;
    const inR = S.entries.filter(inReview);
    const plan = todayPlan();
    const leeches = inR.filter(isLeech);
    const tags = allTags();
    const mins = Math.max(1, Math.round(plan.list.length * 0.35));
    const fc = forecast();
    const max = Math.max(1, ...fc.map((d) => d.n));
    const wk = ['日', '一', '二', '三', '四', '五', '六'];
    const learned = inR.filter((e) => e.review.reps).length;
    const mastered = inR.filter((e) => statusKey(e) === 'mastered').length;
    const doneToday = S.log[today()] || 0;
    const pool = customPool();
    const opt = (group, val, title, sub) => `
      <button class="opt ${R[group] === val ? 'on' : ''}" data-act="rv-set" data-k="${group}" data-v="${val}" aria-pressed="${R[group] === val}">
        <span class="opt-t">${title}</span>${sub ? `<span class="opt-s">${sub}</span>` : ''}</button>`;
    return {
      title: '複習', tab: 'review',
      html: `
      <section class="today">
        <span class="today-l">今天的複習${streak() ? ` · 連續 ${streak()} 天` : ''}</span>
        ${plan.list.length ? `
        <span class="today-n"><b class="tnum">${plan.list.length}</b> 個 · 約 ${mins} 分鐘</span>
        <span class="today-s">到期 ${plan.due.length} 個 + 新字 ${plan.fresh.length} 個（每天新字上限 ${S.settings.newPerDay}，今天還能加 ${plan.newLeft} 個）</span>
        <button class="btn today-btn" data-act="rv-today">開始今天的複習</button>`
        : `<span class="today-n">${doneToday ? `今天複習了 <b class="tnum">${doneToday}</b> 次，都完成了` : '今天沒有要複習的字'}</span>
        <span class="today-s">${inR.length ? '明天再來。想多練可以用下面的自訂複習。' : '在查詢結果或單字庫點星號，或匯入你的單字簿。'}</span>`}
      </section>
      <div class="scope-row"><span class="muted small">每天複習的範圍</span>
        <div class="seg small-seg">${[['all', '全部'], ['old', '47 個檔'], ['new', '新查的']].map(([k, t]) => `<button class="${S.settings.reviewScope === k ? 'on' : ''}" data-act="rv-scope" data-s="${k}">${t}</button>`).join('')}</div>
      </div>
      ${leeches.length ? `<section class="block leech">
        <div class="block-head"><h3>頑固字 · 常忘記的 ${leeches.length} 個</h3><button class="link" data-act="rv-leech">專門練 ${ic('chev')}</button></div>
        <div class="chips">${leeches.slice(0, 12).map((e) => `<a class="chip-link" href="#/entry/${encodeURIComponent(e.id)}"><b lang="en">${esc(e.text)}</b> 忘了 ${Math.max(e.review.lapses || 0, e.review.wrong || 0)} 次</a>`).join('')}</div>
      </section>` : ''}
      <div class="rv-summary">
        <div><span class="stat-n tnum">${inR.length}</span><span class="stat-l">複習中的字</span></div>
        <div><span class="stat-n tnum">${learned}</span><span class="stat-l">學過</span></div>
        <div><span class="stat-n tnum">${mastered}</span><span class="stat-l">已熟記（≥3 週）</span></div>
      </div>
      <section class="block"><h3>未來 7 天要複習</h3>
        <div class="forecast">${fc.map((d, i) => { const dt = new Date(d.t); return `<div class="fc-col"><span class="fc-n tnum">${d.n}</span><span class="fc-bar" style="height:${Math.round((d.n / max) * 56) + 2}px"></span><span class="fc-d">${i === 0 ? '今天' : '週' + wk[dt.getDay()]}</span></div>`; }).join('')}</div>
      </section>
      <details class="custom" ${R.open ? 'open' : ''}>
        <summary>自訂複習（選範圍和題型）</summary>
        <section class="block"><h3>範圍</h3>
          <div class="opts">
            ${opt('range', 'all', '全部複習中的字', `${inR.length} 個`)}
            ${opt('range', 'due', '今天到期', '')}
            ${opt('range', 'recent', '最近 7 天練過', '')}
            ${opt('range', 'leech', '頑固字', `${leeches.length} 個`)}
            ${opt('range', 'new', '只練新查的', `${inR.filter((e) => e.src === 'new').length} 個`)}
            ${opt('range', 'old', '只練 47 個檔', '')}
            ${opt('range', 'tag', '依檔案', '')}
          </div>
          ${R.range === 'tag' ? `<label class="sort tag-pick">檔案 <select id="rv-tag">${tags.map((t) => `<option value="${esc(t)}" ${R.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>` : ''}
        </section>
        <section class="block"><h3>題型</h3>
          <div class="opts">
            ${opt('mode', 'mix', '自動混合', '跟每日複習一樣')}
            ${Object.entries(KIND).map(([k, [t, d]]) => opt('mode', k, t, d)).join('')}
          </div>
        </section>
        <div class="start-bar">
          <span class="muted">這次會練 <b class="tnum">${Math.min(pool.length, S.settings.perSession)}</b> 個</span>
          <button class="btn primary" data-act="rv-start" ${pool.length ? '' : 'disabled'}>開始</button>
        </div>
        <p class="muted small">自訂複習一樣會更新下次複習的時間。</p>
      </details>`,
      after() {
        document.querySelector('details.custom').addEventListener('toggle', (ev) => { R.open = ev.target.open; });
        const tg = document.getElementById('rv-tag');
        if (tg) { if (!R.tag) R.tag = tg.value; tg.addEventListener('change', () => { R.tag = tg.value; render(); }); }
      },
    };
  }

  function progress(s) {
    const pct = Math.round((s.i / s.items.length) * 100);
    return `<div class="progress"><div class="bar"><span style="width:${pct}%"></span></div><span class="tnum small muted">${s.i + 1} / ${s.items.length}</span>
      ${s.undo ? `<button class="link small" data-act="undo">↶ 復原</button>` : ''}</div>`;
  }
  const kindLabel = (it) => `<p class="q-label">${srcTag(byId(it.id))}<span>${KIND[it.kind][0]}${it.again ? ' · 再考一次' : ''}</span></p>`;

  function choiceList(s, it) {
    return `<div class="choices ${it.options.length === 2 ? 'two' : ''}">${it.options.map((oid) => {
      const o = byId(oid);
      let cls = '';
      if (s.picked) {
        if (oid === it.id) cls = 'correct';
        else if (oid === s.picked) cls = 'wrong';
        else cls = 'dim';
      }
      return `<button class="choice ${cls}" data-act="pick" data-id="${esc(oid)}" ${s.picked ? 'disabled' : ''} lang="en">
        <span>${esc(o.text)}</span>${s.picked ? `<span class="choice-zh">${esc((o.senses[0] || {}).zh || '')} ${usageChip(o.usage)}</span>` : ''}</button>`;
    }).join('')}</div>`;
  }
  const nextBar = (s, ok) => `<div class="start-bar"><span class="${ok ? 'ok-txt' : 'bad-txt'}">${ok ? '答對了' : '答錯了，這一輪最後會再考一次'}</span><button class="btn primary" data-act="next" id="next-btn">${s.i + 1 < s.items.length ? '下一題' : '看結果'}</button></div>`;
  function gradeBar(s, e) {
    if (!s.flipped) return '<div class="grade placeholder"><button class="btn primary wide" data-act="flip">顯示答案</button></div>';
    const it = s.items[s.i];
    const days = it.again ? null : previewFor(e);
    return `<div class="grade four">${GRADES.map(([t, c], g) => `<button class="btn ${c}" data-act="grade" data-g="${g + 1}"><span>${t}</span>${days ? `<small>${g === 0 ? '再考一次' : SRS.fmtDays(days[g])}</small>` : ''}</button>`).join('')}</div>`;
  }
  function blanked(it, e, picked) {
    if (!it.ex) return '';
    const re = wordRe(e.text);
    return esc(it.ex.en).replace(new RegExp(re.source, 'i'), (m) => (picked ? `<mark>${m}</mark>` : '<span class="blank">＿＿＿＿</span>'));
  }
  // 複習翻面：兩句最短的例句（有中文翻譯的優先）
  function shortExamples(e, n = 2) {
    const sorted = e.examples.filter((x) => x.en).slice().sort((a, b) => (b.zh ? 1 : 0) - (a.zh ? 1 : 0) || a.en.length - b.en.length);
    // 幾乎一樣的句子（只差單複數、標點）或中文一樣的，只留一句
    const key = (x) => x.en.toLowerCase().replace(/[^a-z ]/g, '').replace(/s\b/g, '').replace(/\s+/g, ' ').trim();
    const out = [];
    sorted.forEach((x) => { if (out.length < n && !out.some((o) => key(o) === key(x) || (o.zh && o.zh === x.zh))) out.push(x); });
    return out;
  }
  // 例句不到兩句的字，從 Yahoo 字典補一句短的，存起來（只試一次）
  function ensureExamples(e) {
    if (e.type !== 'word' || shortExamples(e).length >= 2 || e.exTried || !(window.Yahoo && Yahoo.canFetch())) return;
    e.exTried = true;
    Yahoo.lookup(e.text).then((d) => {
      if (!d) return;
      const have = new Set(e.examples.map((x) => x.en.toLowerCase()));
      const more = [];
      d.entries.forEach((en) => en.senses.forEach((x) => x.examples.forEach((ex) => {
        if (ex.en && ex.zh && !have.has(ex.en.toLowerCase()) && hasWord(ex.en, e.text)) more.push(ex);
      })));
      more.sort((a, b) => a.en.length - b.en.length);
      e.examples.push(...more.slice(0, Math.max(0, 2 - shortExamples(e).length)));
      saveEntry(e);
      const s = S.session;
      if (location.hash === '#/review/quiz' && s && s.items[s.i] && s.items[s.i].id === e.id) render();
    }).catch(() => { saveEntry(e); });
  }
  const cardBack = (e) => (e.type === 'word'
    ? `${sensesBlock(e)}${e.forms && e.forms.infl ? `<p class="infl small" lang="en">${esc(e.forms.infl)}</p>` : ''}${shortExamples(e).map((x) => `<div class="card-ex"><div class="ex-en small" lang="en">${highlight(x.en, e.text)}</div>${x.zh ? `<div class="ex-zh">${esc(x.zh)}</div>` : ''}</div>`).join('')}`
    : `<p class="sent-zh">${esc(e.zh)}</p>`) + (e.src === 'new' && e.notes.length ? `<p class="rv-notes">${ic('pen')} ${esc(e.notes.join('；'))}</p>` : '');

  const RENDER = {
    flash(s, it, e) {
      ensureExamples(e);
      return `
      <div class="flash ${s.flipped ? 'flipped' : ''}" data-act="flip" role="button" tabindex="0" aria-label="翻面">
        <span class="flash-front">
          ${kindLabel(it)}
          <span class="${e.type === 'word' ? 'headword' : 'flash-sent'}" lang="en">${esc(e.text)}</span>
          <span class="ipa-row">${e.ipa ? `<span class="ipa">${esc(e.ipa)}</span>` : ''}${speakBtn(e.text, '播放發音', 'card-speak')}</span>
          ${!s.flipped ? `<span class="muted small flip-hint">先想${e.type === 'word' ? '中文意思' : '整句的意思'}，再點一下翻面</span>` : ''}
        </span>
        ${s.flipped ? `<span class="flash-back">${cardBack(e)}</span>` : ''}
      </div>
      ${gradeBar(s, e)}`;
    },
    reverse(s, it, e) {
      return `
      <div class="flash ${s.flipped ? 'flipped' : ''}" data-act="flip" role="button" tabindex="0" aria-label="翻面">
        <span class="flash-front">
          ${kindLabel(it)}
          ${e.type === 'word' ? sensesBlock(e) : `<p class="sent-zh">${esc(e.zh)}</p>`}
          ${usageChip(e.usage)}
          ${!s.flipped ? `<span class="muted small flip-hint">先在心裡${e.type === 'word' ? '拼出英文' : '用英文說出來'}，再點一下翻面</span>` : ''}
        </span>
        ${s.flipped ? `<span class="flash-back center-back"><span class="${e.type === 'word' ? 'headword' : 'flash-sent'}" lang="en">${esc(e.text)}</span>${e.ipa ? `<span class="ipa">${esc(e.ipa)}</span>` : ''}${e.type === 'word' && e.examples[0] ? `<span class="ex-en small" lang="en">${highlight(e.examples[0].en, e.text)}</span>` : ''}</span>` : ''}
      </div>
      ${s.flipped ? `<div class="center-row">${speakBtn(e.text)}</div>` : ''}${gradeBar(s, e)}`;
    },
    cloze(s, it, e) {
      return `
      <section class="q-card">
        ${kindLabel(it)}
        <p class="cloze" lang="en">${blanked(it, e, s.picked)}</p>
        <p class="ex-zh">${esc(it.ex ? it.ex.zh : '')}</p>
      </section>
      ${choiceList(s, it)}${s.picked ? nextBar(s, s.picked === it.id) : ''}`;
    },
    confuse(s, it, e) {
      const g = S.groups[e.group];
      return `
      <section class="q-card">
        ${kindLabel(it)}<span class="muted small" lang="en">${esc(g.name)}</span>
        <p class="cloze" lang="en">${blanked(it, e, s.picked)}</p>
        <p class="ex-zh">${esc(it.ex ? it.ex.zh : '')}</p>
      </section>
      ${choiceList(s, it)}
      ${s.picked && (e.related[0] || g.note) ? `<p class="confuse-note">${ic('alert')} ${esc(e.related[0] || g.note)}</p>` : ''}${s.picked ? nextBar(s, s.picked === it.id) : ''}`;
    },
    listen(s, it, e) {
      return `
      <section class="q-card listen">
        ${kindLabel(it)}
        <div class="listen-btns">
          <button class="play-big" data-act="speak" data-text="${esc(e.text)}" aria-label="播放">${ic('speaker')}</button>
          <button class="btn small ghost" data-act="speak" data-text="${esc(e.text)}" data-rate="0.6">慢速再聽</button>
        </div>
      </section>
      ${choiceList(s, it)}${s.picked ? nextBar(s, s.picked === it.id) : ''}`;
    },
    spell(s, it, e) {
      const done = s.picked;
      const ok = done && s.picked === it.id;
      return `
      <section class="q-card">
        ${kindLabel(it)}
        ${sensesBlock(e)}
        ${it.ex ? `<p class="ex-zh">${esc(it.ex.zh)}</p>` : ''}
        <div class="listen-btns row">${speakBtn(e.text, '聽發音')}<span class="muted small">可以先聽發音</span></div>
      </section>
      <form class="spell-box" id="spell-form">
        <input id="spell" lang="en" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="拼出英文（可用 S Pen 手寫）" value="${esc(s.typed)}" ${done ? 'disabled' : ''}>
        ${done ? '' : '<button class="btn primary" type="submit">確定</button>'}
      </form>
      ${done ? `<p class="spell-ans">${ok ? '' : `你寫的：<s lang="en">${esc(s.typed || '（空白）')}</s> → `}正確：<b lang="en">${esc(e.text)}</b></p>
        ${ok ? '' : '<button class="link" data-act="spell-typo">我其實會，只是打錯字</button>'}
        ${nextBar(s, ok)}` : '<button class="link" data-act="spell-giveup">不知道，看答案</button>'}`;
    },
  };

  function viewQuiz() {
    const s = S.session;
    if (!s) { startToday(); return { redirect: true }; }
    const it = s.items[s.i]; const e = byId(it.id);
    if (!e) { advance(); return { redirect: true }; }
    return {
      title: s.title, tab: 'review', back: '#/review', focus: true,
      html: progress(s) + RENDER[it.kind](s, it, e),
      after() {
        const f = document.getElementById('spell-form');
        if (f) {
          const inp = document.getElementById('spell');
          if (!s.picked) inp.focus();
          f.addEventListener('submit', (ev) => { ev.preventDefault(); answerSpell(inp.value); });
        }
        document.getElementById('next-btn')?.focus();
      },
    };
  }

  const viewStartMode = (mode) => () => { S.reviewSetup.mode = mode; S.reviewSetup.range = 'all'; startCustom(); return { redirect: true }; };

  function viewReviewResult() {
    const s = S.session;
    if (!s || s.items.some((x) => x.result === null)) return viewReviewHome();
    const firsts = s.items.filter((x) => !x.again);
    const ok = firsts.filter((x) => x.result >= 3).length;
    const label = { 1: ['忘了', 'bad'], 2: ['困難', 'fuzzy'], 3: ['記得', 'ok'], 4: ['簡單', 'ok'] };
    return {
      title: '複習結果', tab: 'review', back: '#/review',
      html: `
      <section class="result-hero">
        <span class="result-n tnum">${ok}<small>/${firsts.length}</small></span>
        <span class="muted">${esc(s.title)} · 第一次就答對或記得的數量</span>
      </section>
      <ul class="list">${firsts.map((x) => {
        const e = byId(x.id); if (!e) return '';
        const [t, c] = label[x.result];
        return `<li class="row"><a class="row-main" href="#/entry/${encodeURIComponent(e.id)}"><span class="row-title ${e.type === 'sentence' ? 'is-sent' : ''}">${esc(e.text)}</span><span class="row-sub">${usageChip(e.usage)}${KIND[x.kind][0]} · 下次：${x.next}</span></a><div class="row-meta"><span class="res res-${c}">${t}</span></div></li>`;
      }).join('')}</ul>
      <div class="btn-col">
        ${ok < firsts.length ? '<button class="btn primary" data-act="rv-retry">把沒記住的再練一次</button>' : ''}
        <a class="btn ghost" href="#/review">回複習首頁</a>
      </div>
      <p class="muted small">排程用 FSRS(Anki 使用的演算法）：記得的字間隔會越拉越長，忘了的字明天再出現。</p>`,
    };
  }

  // g:1 忘了 2 困難 3 記得 4 簡單
  function grade(g) {
    const s = S.session; const it = s.items[s.i]; const e = byId(it.id);
    s.undo = { i: s.i, id: e.id, review: { ...e.review }, daily: { ...S.daily }, log: S.log[today()] || 0, len: s.items.length, result: it.result, next: it.next };
    it.result = g;
    if (it.again) return;
    const wasNew = !e.review.reps;
    e.review = scheduleFor(e, g);
    it.next = g === 1 ? '明天' : SRS.fmtDays(e.review.days) + '後';
    if (wasNew) { rollDaily(); S.daily.newDone++; DB.setMeta('daily', S.daily).catch(dbFail); }
    S.log[today()] = (S.log[today()] || 0) + 1;
    DB.setMeta('log', S.log).catch(dbFail);
    saveEntry(e);
    if (g === 1) s.items.push({ ...makeItem(e, it.kind === 'confuse' || it.kind === 'cloze' ? it.kind : 'flash'), again: true });
  }
  function undo() {
    const s = S.session; const u = s.undo;
    if (!u) return;
    const e = byId(u.id);
    e.review = u.review; saveEntry(e);
    S.daily = u.daily; DB.setMeta('daily', S.daily).catch(dbFail);
    S.log[today()] = u.log; DB.setMeta('log', S.log).catch(dbFail);
    s.items.length = u.len;
    s.i = u.i; s.items[s.i].result = u.result; s.items[s.i].next = u.next;
    s.flipped = false; s.picked = null; s.typed = ''; s.undo = null;
    if (location.hash !== '#/review/quiz') go('review/quiz'); else render();
    toast('已復原上一題');
  }
  function advance() {
    const s = S.session;
    s.i++; s.flipped = false; s.picked = null; s.typed = '';
    if (s.i >= s.items.length) { s.i = s.items.length - 1; go('review/result'); } else render();
  }
  function answerSpell(val) {
    const s = S.session; const it = s.items[s.i]; const e = byId(it.id);
    s.typed = val.trim();
    const ok = s.typed.toLowerCase().replace(/\s+/g, ' ') === e.text.toLowerCase();
    s.picked = ok ? it.id : '__wrong';
    grade(ok ? 3 : 1);
    render();
  }

  /* ---------- 匯入合併（JSON 與 Word 共用） ---------- */
  function mergeGroups(incoming) {
    // 回傳 舊 id → 新 id 的對照
    const map = {};
    (incoming || []).forEach((g) => {
      if (!g || !g.members || g.members.length < 2) return;
      let id = g.id || 'g:' + hash(g.members.slice().sort().join('|'));
      const cur = S.groups[id];
      if (cur) {
        g.members.forEach((m) => { if (!cur.members.includes(m)) cur.members.push(m); });
        if (!cur.note && g.note) cur.note = g.note;
      } else {
        S.groups[id] = { id, name: g.name || g.members.map((m) => m.replace(/^w:/, '')).join(' / '), note: g.note || '', members: g.members.slice() };
      }
      map[g.id || id] = id;
    });
    return map;
  }

  function mergeEntry(cur, inc, strategy) {
    if (strategy === 'local') return false;
    if (strategy === 'file') {
      const keep = { count: cur.count, last: cur.last };
      Object.assign(cur, inc, { count: Math.max(keep.count, inc.count), last: Math.max(keep.last || 0, inc.last || 0) || null });
      return true;
    }
    // merge：內容以沒被我編輯過的為準；標籤、更正聯集；次數取大；複習進度取練得比較多的
    if (!cur.edited) {
      ['ipa', 'zh', 'usage', 'group', 'date'].forEach((k) => { if (inc[k]) cur[k] = inc[k]; });
      if (inc.senses.length) cur.senses = inc.senses;
      if (inc.forms) cur.forms = inc.forms;
      if (inc.notes.length) cur.notes = inc.notes;
      if (inc.related.length) cur.related = inc.related;
      const seen = new Set(inc.examples.map((x) => x.en.toLowerCase()));
      cur.examples = [...inc.examples, ...cur.examples.filter((x) => !seen.has(x.en.toLowerCase()))];
    }
    cur.tags = [...new Set([...cur.tags, ...inc.tags])];
    cur.fixes = [...new Set([...cur.fixes, ...inc.fixes])];
    cur.count = Math.max(cur.count, inc.count);
    cur.last = Math.max(cur.last || 0, inc.last || 0) || null;
    cur.starred = cur.starred || inc.starred;
    if ((inc.review.reps || 0) > (cur.review.reps || 0)) cur.review = inc.review;
    if (cur.src === 'new' && inc.src === 'import') { cur.src = 'import'; cur.order = inc.order; }
    return true;
  }

  async function importData(data, strategy) {
    const gmap = mergeGroups(data.groups);
    let added = 0, updated = 0;
    const touched = [];
    (data.entries || []).forEach((raw) => {
      const inc = normEntry(raw);
      if (!inc.text) return;
      if (inc.group && gmap[inc.group]) inc.group = gmap[inc.group];
      if (inc.starred && !inc.review.reps && inc.review.status === 'none') { inc.review.status = 'new'; inc.review.due = Date.now(); }
      const cur = byId(inc.id);
      if (!cur) { addEntry(inc); touched.push(inc); added++; }
      else if (mergeEntry(cur, inc, strategy)) { delete cur.temp; touched.push(cur); updated++; }
    });
    if (Array.isArray(data.recent) && !S.recent.length) { S.recent = data.recent.slice(0, RECENT_MAX); saveRecent(); }
    if (data.log && typeof data.log === 'object') {
      Object.entries(data.log).forEach(([k, v]) => { S.log[k] = Math.max(S.log[k] || 0, v); });
      DB.setMeta('log', S.log).catch(dbFail);
    }
    await saveEntries(touched);
    await saveGroups();
    DB.persist();
    return { added, updated };
  }

  function diffPreview(data) {
    let add = 0, same = 0, progressConflict = 0;
    (data.entries || []).forEach((raw) => {
      const id = raw.id || makeId(raw.type === 'sentence' ? 'sentence' : 'word', raw.text);
      const cur = byId(id);
      if (!cur || cur.temp) add++;
      else {
        same++;
        if ((cur.review.reps || 0) && (raw.review && raw.review.reps) && cur.review.reps !== raw.review.reps) progressConflict++;
      }
    });
    return { add, same, progressConflict, total: (data.entries || []).length };
  }

  function exportData() {
    const entries = S.entries.filter((e) => !e.temp).map((e) => { const c = { ...e }; delete c.ipaTried; return c; });
    return {
      app: 'danciben', version: 1, exported: new Date().toISOString(),
      entries, groups: Object.values(S.groups), recent: S.recent, log: S.log,
    };
  }

  async function shareOrDownload(name, text) {
    if (NATIVE) { try { return NATIVE.saveFile(name, text) || 'fail'; } catch (err) { return 'fail'; } }
    const blob = new Blob([text], { type: 'application/json' });
    // 在 claude.ai 預覽裡，下載要透過平台的 downloads 功能
    if (window.claude && window.claude.use) {
      try {
        const dl = await window.claude.use('downloads');
        if (dl) {
          try { await dl.save({ filename: name, data: blob }); return 'download'; }
          catch (err) { return err && err.code === 'declined' ? 'cancel' : 'fail'; }
        }
      } catch (err) { /* 改用一般下載 */ }
    }
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
        await navigator.share({ files: [file], title: name });
        return 'shared';
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancel';
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return 'download';
  }

  /* ---------- 畫面：更多 ---------- */
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); installEvt = ev; });

  function viewMore() {
    const item = (href, icon, title, sub) => `<li><a class="menu-item" href="${href}">${ic(icon)}<span class="menu-text"><span>${title}</span><span class="muted small">${sub}</span></span>${ic('chev', 'chev')}</a></li>`;
    const words = S.entries.filter((e) => e.type === 'word' && !e.temp).length;
    const sents = S.entries.filter((e) => e.type === 'sentence' && !e.temp).length;
    return {
      title: '更多', tab: 'more',
      html: `
      ${installEvt ? `<button class="btn primary wide" data-act="install">${ic('download')} 安裝到這台裝置</button>` : ''}
      <ul class="menu">
        ${item('#/backup', 'swap', '匯出 / 匯入 JSON', '手機與 Windows 互轉，用 Quick Share 傳')}
        ${item('#/import', 'file', '匯入 Word 單字簿', '新的 .docx 檔，拆成單字卡')}
        ${item('#/settings', 'gear', '設定', '發音、複習、外觀、資料')}
        ${item('#/help', 'book', '使用說明', '安裝、分享、複習方式')}
      </ul>
      <section class="block storage">
        <h3>本機資料</h3>
        <p class="muted small">所有資料只存在這台裝置。換裝置或備份請用「匯出 JSON」。</p>
        <div class="stats three">
          <div><span class="stat-n tnum">${words}</span><span class="stat-l">單字</span></div>
          <div><span class="stat-n tnum">${sents}</span><span class="stat-l">句子</span></div>
          <div><span class="stat-n tnum">${S.entries.filter((e) => e.src === 'new').length}</span><span class="stat-l">新查的</span></div>
        </div>
      </section>
      <p class="muted small center">單字本 版本 ${APP_VERSION}（${APP_DATE}）</p>`,
    };
  }

  function viewHelp() {
    return {
      title: '使用說明', tab: 'more', back: '#/more',
      html: `
      <section class="block panel help">
        <h3>查字典</h3>
        <p>打英文查中文，打中文查英文，都用 <b>Yahoo 字典</b>（牛津中文字典）。結果直接出現在搜尋框下面，不用換頁。</p>
        <p>貼上整句會自動翻譯（英翻中、中翻英），點句子裡的英文字可以查那個字。</p>
        <p>如果這個字在你的 47 個檔裡，上面會先顯示<b>我的筆記</b>（綠色標籤寫檔名）。</p>
        <p>發音用線上自然語音，沒有網路時改用系統語音。</p>
      </section>
      <section class="block panel help">
        <h3>新查的字怎麼保存</h3>
        <p>查字<b>不會</b>自動保存，只會列在首頁「最近查過」（最多 20 個）。</p>
        <p>按<b>加入複習</b>才會存下來，放在單字庫的<b>新查的</b>（金色標籤），也會排進複習，而且比 47 個檔的新字優先。按之前可以在上面的格子打一行備註（例如句型），複習時會一起出現。</p>
        <p>新查的字跟 47 個檔分開放。刪除新查的字只要按一次垃圾桶，下方會出現「復原」，按錯可以救回來。</p>
      </section>
      <section class="block panel help">
        <h3>從其他 App 分享</h3>
        <p>在任何 App 選取英文 → 分享（或選取後的選單）→「單字本」，就會直接查詢。</p>
      </section>
      <section class="block panel help">
        <h3>複習怎麼排</h3>
        <p>用 FSRS 演算法（Anki 目前用的）：每個字依你記得的程度，算出下次最適合複習的日子。評「記得」間隔會拉長，「忘了」明天再出現。</p>
        <p>每天只出到期的字，加上有上限的新字。每天花 10–15 分鐘，比一次猛背有效。</p>
        <p>題型會自動從「認得」進到「會用」：閃卡 → 例句挖空、易混淆辨析 → 反向閃卡、拼字、聽力。</p>
        <p>複習頁可以選每天複習的範圍：全部、只練 47 個檔、只練新查的。每張卡片角落都有標籤，看得出是哪一種。</p>
        <p>常忘記的字會被列為「頑固字」，可以專門練，也可以到單字詳情編輯，加上自己的聯想。</p>
      </section>
      <section class="block panel help">
        <h3>手機與電腦同步</h3>
        <p>資料只存在各自的裝置。在一台「匯出 JSON」，用 Quick Share 傳到另一台，再「匯入 JSON」選「合併」。</p>
      </section>`,
    };
  }

  /* 匯入 Word */
  function viewImport() {
    const I = S.imp;
    const stepper = (n) => `<ol class="stepper three">${['選擇檔案', '預覽', '完成'].map((t, i) => `<li class="${i + 1 < n ? 'done' : ''} ${i + 1 === n ? 'cur' : ''}"><span class="step-n">${i + 1 < n ? '✓' : i + 1}</span><span>${t}</span></li>`).join('')}</ol>`;
    let body = '';
    if (I.step === 1) {
      body = `
      <label class="dropzone" for="docx-in">${ic('upload')}<span><b>選擇 Word 檔（.docx)</b><br><span class="muted small">可以一次選多個。檔名會變成檔案標籤。</span></span></label>
      <input type="file" id="docx-in" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple hidden>
      ${I.error ? `<p class="bad-txt">${esc(I.error)}</p>` : ''}
      ${I.busy ? '<div class="loading"><span class="spinner"></span>正在解析…</div>' : ''}
      <p class="muted small">你的 47 個舊檔案已經整理成 <b>danciben-import.json</b>（含更正、用法、型態與生活例句），請用「匯出 / 匯入 JSON」匯入那個檔。這裡是給之後新增的 Word 檔用的。</p>`;
    } else if (I.step === 2) {
      const p = I.parsed;
      const words = p.cards.filter((c) => c.type === 'word').length;
      const sents = p.cards.length - words;
      const diff = diffPreview({ entries: p.cards });
      body = `
      <div class="stats">
        <div><span class="stat-n tnum">${p.files}</span><span class="stat-l">檔案</span></div>
        <div><span class="stat-n tnum">${words}</span><span class="stat-l">單字</span></div>
        <div><span class="stat-n tnum">${sents}</span><span class="stat-l">句子</span></div>
        <div><span class="stat-n tnum ${p.issues.length ? 'warn-txt' : ''}">${p.issues.length}</span><span class="stat-l">待確認</span></div>
      </div>
      <p class="muted small">新增 ${diff.add} 筆，${diff.same} 筆已經在單字庫（會合併，不會重複）。</p>
      ${p.issues.length ? `<section class="block"><h3>待確認（匯入後可到單字詳情修改）</h3>
        <ul class="issues">${p.issues.slice(0, 30).map((x) => `<li class="issue"><div class="issue-head">${ic('alert')}<b>${esc(x.kind)}</b><span class="muted small" lang="en">${esc(x.word)}</span></div><p class="small" lang="en">${esc(x.text)}</p></li>`).join('')}</ul>
        ${p.issues.length > 30 ? `<p class="muted small">…還有 ${p.issues.length - 30} 項</p>` : ''}</section>` : ''}
      <section class="block"><h3>預覽（前 20 筆）</h3>
        <ul class="card-mocks">${p.cards.slice(0, 20).map((c) => `<li><b lang="en">${esc(c.text)}</b> ${c.type === 'word' ? c.senses.map((s) => `<span class="pos">${esc(s.pos)}</span> ${esc(s.zh)}`).join(' ') : esc(c.zh)}<span class="card-meta">例句 ${(c.examples || []).length} · #${esc(c.tags[0])}</span></li>`).join('')}</ul>
      </section>
      <label class="check"><input type="checkbox" id="imp-star" checked> 單字直接加入複習</label>
      <div class="start-bar"><button class="btn ghost" data-act="imp-reset">重選</button><button class="btn primary" data-act="imp-go">匯入 ${p.cards.length} 筆</button></div>`;
    } else {
      body = `
      <section class="result-hero">${ic('check', 'done-ic')}<span class="result-n small-n">匯入完成</span>
        <span class="muted">新增 ${I.result.added} 筆 · 合併 ${I.result.updated} 筆</span></section>
      <div class="btn-col"><a class="btn primary" href="#/library">到單字庫看看</a><button class="btn ghost" data-act="imp-reset">再匯入其他檔案</button></div>`;
    }
    return {
      title: '匯入 Word 單字簿', tab: 'more', back: '#/more', html: stepper(I.step) + body,
      after() {
        const inp = document.getElementById('docx-in');
        if (!inp) return;
        inp.addEventListener('change', async () => {
          const files = [...inp.files];
          if (!files.length) return;
          if (!window.JSZip) { I.error = '無法載入解析工具，請確認網路後重新整理。'; render(); return; }
          I.busy = true; I.error = ''; render();
          try {
            const res = { files: files.length, cards: [], issues: [], groups: [] };
            for (const f of files) {
              const r = await Docx.parseFile(f);
              res.cards.push(...r.cards); res.issues.push(...r.issues.map((x) => ({ ...x, word: `${r.tag} · ${x.word}` })));
              r.groups.forEach((ws) => res.groups.push({ members: ws.map((w) => makeId('word', w)) }));
            }
            let order = S.entries.reduce((m, e) => Math.max(m, e.order || 0), 0);
            res.cards.forEach((c) => { c.order = ++order; c.added = Date.now(); });
            I.parsed = res; I.step = 2;
          } catch (err) {
            I.error = '檔案無法解析：' + (err.message || err);
          }
          I.busy = false; render();
        });
      },
    };
  }

  /* 匯出 / 匯入 JSON */
  function viewBackup() {
    const B = S.backup;
    const n = S.entries.filter((e) => !e.temp).length;
    let imp;
    if (B.result) {
      imp = `<p class="ok-txt">匯入完成：新增 ${B.result.added} 筆、合併 ${B.result.updated} 筆。</p><button class="btn ghost" data-act="bk-reset">再匯入一次</button>`;
    } else if (B.parsed) {
      const d = diffPreview(B.parsed);
      imp = `
        <div class="file-card">${ic('file')}<span><b>${esc(B.file)}</b><br><span class="muted small">${d.total} 筆${B.parsed.exported ? ' · ' + esc(new Date(B.parsed.exported).toLocaleString('zh-TW')) + ' 匯出' : ''}</span></span></div>
        <div class="stats three">
          <div><span class="stat-n tnum">${d.add}</span><span class="stat-l">新增</span></div>
          <div><span class="stat-n tnum">${d.same}</span><span class="stat-l">已存在</span></div>
          <div><span class="stat-n tnum ${d.progressConflict ? 'warn-txt' : ''}">${d.progressConflict}</span><span class="stat-l">複習進度不同</span></div>
        </div>
        <fieldset class="radios"><legend>已存在的項目</legend>
          ${[['merge', '合併（建議）：標籤和次數合起來，複習進度取練得比較多的'], ['file', '以檔案為準'], ['local', '保留這台裝置的，只加新的']].map(([v, t]) => `<label><input type="radio" name="bk-st" value="${v}" ${B.strategy === v ? 'checked' : ''} data-act="bk-strategy"> ${t}</label>`).join('')}
        </fieldset>
        <div class="start-bar"><button class="btn ghost" data-act="bk-reset">取消</button><button class="btn primary" data-act="bk-import">匯入</button></div>`;
    } else {
      imp = `<label class="btn ghost" for="json-in">選擇 JSON 檔</label><input type="file" id="json-in" accept=".json,application/json" hidden>
        ${B.error ? `<p class="bad-txt">${esc(B.error)}</p>` : ''}
        <p class="muted small">Quick Share 收到的檔案通常在「下載」資料夾。</p>`;
    }
    return {
      title: '匯出 / 匯入 JSON', tab: 'more', back: '#/more',
      html: `
      <section class="block panel">
        <h3>${ic('download')} 匯出</h3>
        <p class="muted small">包含 ${n} 筆單字與句子、複習進度、查詢紀錄。</p>
        <button class="btn primary" data-act="bk-export">${ic('share')} 匯出並分享</button>
        <p class="muted small">手機會開啟分享選單，選 Quick Share 傳到電腦；Windows 會存到「下載」資料夾。</p>
      </section>
      <section class="block panel">
        <h3>${ic('upload')} 匯入</h3>
        ${imp}
      </section>`,
      after() {
        const inp = document.getElementById('json-in');
        if (!inp) return;
        inp.addEventListener('change', async () => {
          const f = inp.files[0];
          if (!f) return;
          try {
            const data = JSON.parse(await f.text());
            if (!data || !Array.isArray(data.entries)) throw new Error('不是單字本的 JSON 檔');
            B.parsed = data; B.file = f.name; B.error = '';
          } catch (err) { B.error = '無法讀取：' + err.message; }
          render();
        });
      },
    };
  }

  /* 設定 */
  function viewSettings() {
    const st = S.settings;
    const sel = (id, key, opts) => `<select id="${id}" data-set="${key}">${opts.map(([v, t]) => `<option value="${v}" ${String(st[key]) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    const c = S.confirm;
    return {
      title: '設定', tab: 'more', back: '#/more',
      html: `
      <section class="block panel"><h3>發音</h3>
        <label class="set-row"><span>發音來源</span>${sel('set-vmode', 'voiceMode', [['natural', '線上自然語音'], ['system', '系統語音（不用網路）']])}</label>
        <p class="muted small">「線上自然語音」需要網路，聲音比較自然；沒有網路時會自動改用系統語音。下面的語音設定是給系統語音用的。</p>
        <label class="set-row"><span>語音</span><select id="set-voice" data-set="voice">${voices.length ? `<option value="">自動（${esc((pickVoice() || {}).name || '')})</option>` + voices.map((vc) => `<option value="${esc(vc.name)}" ${st.voice === vc.name ? 'selected' : ''}>${esc(vc.name)}(${esc(vc.lang)})</option>`).join('') : '<option value="">找不到英文語音</option>'}</select></label>
        ${!hasTTS() ? '<p class="bad-txt small">這個瀏覽器不支援系統語音。</p>' : ''}
        <label class="set-row"><span>口音</span>${sel('set-accent', 'accent', [['en-US', '美式'], ['en-GB', '英式']])}</label>
        <label class="set-row"><span>語速 <span class="muted tnum" id="rate-v">${Number(st.rate).toFixed(1)}×</span></span><input id="set-rate" type="range" min="0.5" max="1.5" step="0.1" value="${st.rate}"></label>
        <label class="set-row"><span>查詢後自動唸出來</span><input id="set-auto" type="checkbox" class="switch" data-set="autoSpeak" ${st.autoSpeak ? 'checked' : ''}></label>
        <button class="btn small ghost" data-act="speak" data-text="The quick brown fox jumps over the lazy dog.">${ic('speaker')} 試聽</button>
      </section>
      <section class="block panel"><h3>查詢</h3>
        <label class="set-row"><span>預設查詢模式</span>${sel('set-mode', 'defaultMode', [['word', '單字'], ['sentence', '句子']])}</label>
        <p class="muted small">字典：Google 翻譯免費端點 + Free Dictionary API；句子翻譯失敗時改用 MyMemory。</p>
      </section>
      <section class="block panel"><h3>複習</h3>
        <label class="set-row"><span>每天新字上限</span>${sel('set-new', 'newPerDay', [[0, '0（先不加新字）'], [5, '5'], [10, '10'], [15, '15'], [20, '20'], [30, '30'], [50, '50']])}</label>
        <label class="set-row"><span>自訂複習題數</span>${sel('set-per', 'perSession', [[10, '10'], [20, '20'], [30, '30'], [50, '50']])}</label>
        <label class="set-row"><span>目標記憶率</span>${sel('set-ret', 'retention', [[0.85, '85%（建議，複習少一點）'], [0.9, '90%'], [0.95, '95%（複習多一點）']])}</label>
      </section>
      <section class="block panel"><h3>外觀</h3>
        <label class="set-row"><span>主題</span>${sel('set-theme', 'theme', [['light', '白底'], ['dark', '黑底'], ['system', '跟隨系統']])}</label>
        <label class="set-row"><span>畫面大小</span>${sel('set-zoom', 'zoom', [[1, '標準'], [1.25, '大'], [1.5, '更大'], [1.75, '特大'], [2, '兩倍'], [2.25, '兩倍多']])}</label>
      </section>
      <section class="block panel"><h3>資料</h3>
        <div class="set-row"><span>已使用空間</span><span class="muted tnum" id="usage-v">計算中…</span></div>
        <div class="data-row"><div><b>清除最近查過</b><p class="muted small">只刪首頁那 20 個紀錄，其他都不動。</p></div>
          <button class="btn ghost small" data-act="clear-recent">清除</button></div>
        <div class="data-row"><div><b>刪除全部新查的</b><p class="muted small">刪掉「新查的」裡的 ${S.entries.filter((e) => e.src === 'new').length} 筆字和句子，47 個檔不動。可以復原。</p></div>
          <button class="btn ghost small" data-act="del-all-new">刪除</button></div>
        <div class="data-row"><div><b>重設 47 個檔的複習進度</b><p class="muted small">單字都還在，只是複習進度歸零，從頭開始排。</p></div>
          <button class="btn ghost small" data-act="reset-progress">${c === 'reset-progress' ? '再按一次確定' : '重設'}</button></div>
        <details class="danger-zone"><summary>全部刪光（危險）</summary>
          <p class="muted small">會刪掉所有資料：47 個檔、新查的、複習進度。下次打開會重新匯入 47 個檔，但新查的和進度都救不回來。建議先「匯出 JSON」備份。</p>
          <label class="set-row"><span>要確定，請在格子裡打「全部刪除」</span><input id="wipe-confirm" type="text" autocomplete="off"></label>
          <button class="btn ghost danger" data-act="clear-all">全部刪光</button>
        </details>
      </section>
      <p class="muted small center">單字本 1.0</p>
      <p class="muted small center">單字本 版本 ${APP_VERSION}（${APP_DATE}）</p>`,
      after() {
        const r = document.getElementById('set-rate');
        r.addEventListener('input', () => { st.rate = parseFloat(r.value); document.getElementById('rate-v').textContent = st.rate.toFixed(1) + '×'; });
        r.addEventListener('change', saveSettings);
        document.querySelectorAll('[data-set]').forEach((el) => el.addEventListener('change', () => {
          const k = el.dataset.set;
          let v = el.type === 'checkbox' ? el.checked : el.value;
          if (['newPerDay', 'perSession', 'retention', 'zoom'].includes(k)) v = Number(v);
          st[k] = v;
          if (k === 'theme' || k === 'fontSize' || k === 'zoom') { applyTheme(); saveTheme(); }
          if (k === 'accent') st.voice = '';
          if (k === 'defaultMode') S.mode = v;
          saveSettings();
          toast('已儲存');
          if (k === 'theme' || k === 'accent') render();
        }));
        DB.estimate().then((b) => { const el = document.getElementById('usage-v'); if (el) el.textContent = b ? (b / 1048576).toFixed(1) + ' MB' : '—'; });
      },
    };
  }

  function viewMissing() {
    return { title: '找不到', tab: 'search', back: '#/search', html: '<p class="empty">找不到這個項目。</p>' };
  }

  /* ---------- 路由 ---------- */
  const routes = [
    [/^search$/, viewSearch],
    [/^w\/(.+)$/, (q) => viewWord(decodeURIComponent(q))],
    [/^s\/(.+)$/, (q) => viewSent(decodeURIComponent(q))],
    [/^result\/(.+)$/, (id) => { const e = byId(decodeURIComponent(id)); if (e) location.replace(pageHref(e.type, e.text)); else go('search'); return { redirect: true }; }],
    [/^share$/, viewShare],
    [/^zh\/(.+)$/, (q) => { showResult('w', decodeURIComponent(q)); return { redirect: true }; }],
    [/^library$/, viewLibrary],
    [/^entry\/(.+)$/, (id) => viewEntry(decodeURIComponent(id))],
    [/^review$/, viewReviewHome],
    [/^review\/quiz$/, viewQuiz],
    [/^review\/result$/, viewReviewResult],
    ...Object.keys(KIND).map((k) => [new RegExp(`^review\\/${k}$`), viewStartMode(k)]),
    [/^more$/, viewMore],
    [/^help$/, viewHelp],
    [/^import$/, viewImport],
    [/^backup$/, viewBackup],
    [/^settings$/, viewSettings],
  ];

  let lastPath = null;
  function render() {
    if (!S.ready) return;
    const path = location.hash.replace(/^#\/?/, '') || 'search';
    let v = null;
    for (const [re, fn] of routes) {
      const m = path.match(re);
      if (m) { v = fn(...m.slice(1)); break; }
    }
    if (!v) { go('search'); return; }
    if (v.redirect) return;
    if (path !== lastPath) { S.confirm = ''; if (!path.startsWith('entry/')) S.editing = null; }
    document.getElementById('view').innerHTML = v.html;
    const tb = document.getElementById('topbar');
    const dark = document.documentElement.dataset.theme === 'dark';
    tb.innerHTML = `${v.back ? `<a class="icon-btn" href="${v.back}" aria-label="返回">${ic('back')}</a>` : `<span class="brand-sm"><span class="brand-mark">單</span><span class="brand-text">單字本</span>${brandMeta()}</span>`}
      <h1 class="${v.hideTitle ? 'sr-only' : ''}">${esc(v.title)}</h1>
      <button class="icon-btn theme-btn" data-act="theme-toggle" aria-label="${dark ? '切換成白底' : '切換成黑底'}">${ic(dark ? 'sun' : 'moon')}</button>`;
    document.title = `${v.title} · 單字本`;
    document.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === v.tab));
    document.body.classList.toggle('focus-mode', !!v.focus);
    if (path !== lastPath) { window.scrollTo(0, 0); lastPath = path; }
    if (v.after) v.after();
  }

  const brandMeta = () => `<span class="brand-meta"><em class="author-inline">作者：ArchieKUO</em><span class="ver">v${APP_VERSION}</span></span>`;

  /* ---------- 點擊事件 ---------- */
  const actions = {
    star: (d) => toggleStar(d.id),
    speak: (d, el) => speak(d.text, d.rate ? parseFloat(d.rate) : null, el),
    'theme-toggle': () => { S.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(); saveTheme(); saveSettings(); render(); },
    query: (d) => { if (d.mode) S.mode = d.mode; runQuery(d.text, d.mode); },
    'open-sugg': (d) => { const e = byId(d.id); if (e) { S.draft = ''; location.hash = pageHref(e.type, e.text); } },
    'rv-toggle': (d) => { const e = entryFor(d.key); if (e && e.starred) removeFromReview(e); else addToReview(d.key); },
    'del-new': (d) => { const e = byId(d.id); if (e) removeFromReview(e); },
    'w-retry': (d) => fetchWord(d.q),
    's-retry': (d) => fetchSentence(d.q),
    'clear-recent': () => {
      const old = S.recent;
      S.recent = []; saveRecent(); render();
      toastAction('已清除最近查過', '復原', () => { S.recent = old; saveRecent(); render(); });
    },
    'lib-src': (d) => { S.lib.src = d.s; S.lib.limit = 100; render(); },
    'open-recent': (d) => showResult(d.kind, d.q),
    'close-result': () => { S.cur = null; render(); },
    mode: (d) => { S.mode = d.mode; render(); document.getElementById('q')?.focus(); },
    clear: () => { S.draft = ''; render(); document.getElementById('q').focus(); },
    'set-usage': (d) => { const e = byId(d.id); e.usage = e.usage === d.u ? null : d.u; e.edited = true; saveEntry(e); render(); },
    'lib-filter': (d) => { S.lib.filter = d.f; S.lib.limit = 100; render(); },
    'lib-usage': (d) => { S.lib.usage = d.u; S.lib.limit = 100; render(); },
    'lib-tag': (d) => { S.lib = { ...S.lib, tag: d.t, filter: 'all', usage: 'all', q: '', sort: 'file', limit: 100 }; go('library'); },
    'lib-more': () => { S.lib.limit += 100; render(); },
    edit: (d) => { S.editing = d.id; render(); window.scrollTo(0, 0); },
    'edit-cancel': () => { S.editing = null; render(); },
    suspend: (d) => { const e = byId(d.id); e.review.suspended = !e.review.suspended; saveEntry(e); toast(e.review.suspended ? '已暫停，複習時不會出現' : '已恢復複習'); render(); },
    // 一次就刪，下方可以復原
    delete: (d) => {
      const e = byId(d.id);
      if (!e) return;
      removeEntry(e);
      go('library');
      toastAction(`已刪除「${e.type === 'word' ? e.text : '這個句子'}」`, '復原', () => { addEntry(e); saveEntry(e); render(); });
    },
    'rv-scope': (d) => { S.settings.reviewScope = d.s; saveSettings(); render(); },
    'rv-set': (d) => { S.reviewSetup[d.k] = d.v; S.reviewSetup.open = true; render(); },
    'rv-start': () => startCustom(),
    'rv-today': () => startToday(),
    'rv-leech': () => startSession(shuffle(S.entries.filter(isLeech)).slice(0, 30), 'mix', '頑固字特訓'),
    'rv-retry': () => {
      const s = S.session;
      startSession(s.items.filter((x) => !x.again && x.result < 3).map((x) => byId(x.id)).filter(Boolean), s.mode === 'mix' ? 'mix' : s.mode, s.title);
    },
    flip: () => { if (!S.session.flipped) { S.session.flipped = true; render(); } },
    grade: (d) => { grade(Number(d.g)); advance(); },
    pick: (d) => {
      const s = S.session; const it = s.items[s.i];
      if (s.picked) return;
      s.picked = d.id;
      grade(d.id === it.id ? 3 : 1);
      if (it.kind === 'listen' || d.id !== it.id) speak(byId(it.id).text);
      render();
    },
    next: () => advance(),
    undo: () => undo(),
    'spell-giveup': () => answerSpell(''),
    'spell-typo': () => {
      const s = S.session; const it = s.items[s.i];
      const typed = s.typed;
      undo();
      S.session.typed = typed; S.session.picked = it.id;
      grade(2);
      render();
    },
    install: async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); },
    'imp-reset': () => { S.imp = { step: 1, files: [], parsed: null, error: '' }; render(); },
    'imp-go': async () => {
      const star = document.getElementById('imp-star').checked;
      const p = S.imp.parsed;
      p.cards.forEach((c) => { c.starred = star && c.type === 'word'; });
      S.imp.result = await importData({ entries: p.cards, groups: p.groups }, 'merge');
      S.imp.step = 3; render();
    },
    'bk-export': async () => {
      const r = await shareOrDownload(`danciben-${today()}.json`, JSON.stringify(exportData()));
      if (r === 'download') toast('已存到「下載」資料夾');
      else if (r === 'saved') toast('已存到「下載/單字本」，也可以從分享選單傳到電腦');
      else if (r === 'fail') toast('這裡無法下載檔案，請用安裝好的 App 匯出');
      else if (r === 'shared') toast('已分享');
    },
    'bk-strategy': (d, el) => { S.backup.strategy = el.value; },
    'bk-import': async () => {
      S.backup.result = await importData(S.backup.parsed, S.backup.strategy);
      S.backup.parsed = null; render(); toast('匯入完成');
    },
    'bk-reset': () => { S.backup = { file: null, parsed: null, strategy: 'merge', result: null }; render(); },
    'clear-history': () => {
      if (S.confirm !== 'clear-history') { S.confirm = 'clear-history'; render(); return; }
      S.recent = []; saveRecent(); S.confirm = ''; toast('已清除最近查過'); render();
    },
    'del-all-new': () => {
      const list = S.entries.filter((e) => e.src === 'new');
      if (!list.length) { toast('「新查的」裡沒有東西'); return; }
      list.forEach(removeEntry);
      render();
      toastAction(`已刪除 ${list.length} 筆新查的`, '復原', () => { list.forEach((e) => { addEntry(e); saveEntry(e); }); render(); });
    },
    'reset-progress': () => {
      if (S.confirm !== 'reset-progress') { S.confirm = 'reset-progress'; render(); return; }
      const list = S.entries.filter((e) => e.src === 'import');
      list.forEach((e) => { e.review = { ...newReview(), status: e.starred ? 'new' : 'none', due: e.starred ? Date.now() : null }; });
      saveEntries(list);
      S.confirm = ''; toast('已重設 47 個檔的複習進度'); render();
    },
    'clear-all': async () => {
      const v = (document.getElementById('wipe-confirm') || {}).value || '';
      if (v.trim() !== '全部刪除') { toast('請先在格子裡打「全部刪除」'); return; }
      await Promise.all([DB.clear('entries'), DB.clear('groups'), DB.clear('meta')]);
      S.entries = []; S.index = new Map(); S.groups = {}; S.recent = []; S.log = {}; S.confirm = '';
      toast('已清除全部資料'); go('search');
    },
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const fn = actions[el.dataset.act];
    if (!fn) return;
    if (el.tagName !== 'INPUT' && el.tagName !== 'LABEL') ev.preventDefault();
    fn(el.dataset, el);
  });
  // 鍵盤：複習時 空白鍵翻面、1–4 評分、Enter 下一題
  document.addEventListener('keydown', (ev) => {
    if (!location.hash.startsWith('#/review/quiz') || !S.session || /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
    const s = S.session;
    if ((ev.key === ' ' || ev.key === 'Enter') && !s.flipped && document.querySelector('.flash')) { ev.preventDefault(); actions.flip(); }
    else if (/^[1-4]$/.test(ev.key) && s.flipped) { grade(Number(ev.key)); advance(); }
    else if (ev.key === 'Enter' && s.picked) { ev.preventDefault(); advance(); }
  });
  window.addEventListener('hashchange', render);

  /* ---------- 啟動 ---------- */
  async function init() {
    try {
      const t = localStorage.getItem('danciben-theme'); if (t) S.settings.theme = t;
      const z = localStorage.getItem('danciben-zoom'); if (z) S.settings.zoom = Number(z);
    } catch (err) { /* 忽略 */ }
    applyTheme();
    const sv = document.getElementById('side-ver');
    if (sv) sv.textContent = 'v' + APP_VERSION;
    try {
      const [entries, groups, settings, oldHistory, log, daily, recent, cache] = await Promise.all([
        DB.all('entries'), DB.all('groups'), DB.getMeta('settings'), DB.getMeta('history'), DB.getMeta('log'), DB.getMeta('daily'),
        DB.getMeta('recent'), DB.getMeta('dictCache'),
      ]);
      // 舊版：查過的字會自動存進單字庫。現在只有按「加入複習」才保存，
      // 所以舊的查詢紀錄：有加星號的搬到「新查的」，沒加的移除（只留在最近查過）。
      const dropped = [];
      entries.forEach((raw) => {
        if (raw.src !== 'import' && raw.src !== 'new') {
          if (!raw.starred) { dropped.push(raw); DB.del('entries', raw.id).catch(dbFail); return; }
          raw.src = 'new';
          DB.put('entries', raw).catch(dbFail);
        }
        addEntry(normEntry(raw));
      });
      groups.forEach((g) => { S.groups[g.id] = g; });
      if (settings) S.settings = { ...DEFAULT_SETTINGS, ...settings };
      // 電腦版預設小一號（從兩倍改成特大），只調整一次
      // 記憶目標改成 85%（複習次數少很多），只調整一次
      if (!S.settings.retV155) {
        if (Number(S.settings.retention) === 0.9) S.settings.retention = 0.85;
        S.settings.retV155 = true;
        DB.setMeta('settings', S.settings).catch(dbFail);
      }
      if (IS_DESKTOP && !S.settings.zoomV14) {
        if (Number(S.settings.zoom) === 2) S.settings.zoom = 1.75;
        S.settings.zoomV14 = true;
        DB.setMeta('settings', S.settings).catch(dbFail);
        try { localStorage.setItem('danciben-zoom', String(S.settings.zoom)); } catch (err) { /* 沒關係 */ }
      }
      S.recent = Array.isArray(recent) ? recent : [];
      if (!recent && Array.isArray(oldHistory)) {
        const all = new Map([...entries, ...dropped].map((e) => [e.id, e]));
        S.recent = oldHistory.map((h) => all.get(h.id)).filter(Boolean).slice(0, RECENT_MAX).map((e) => ({
          key: e.type === 'word' ? wordKey(e.text) : sentKey(e.text), q: e.text, kind: e.type === 'word' ? 'w' : 's',
          zh: e.type === 'word' ? (e.senses || []).map((x) => x.zh).join('；') : e.zh || '', at: e.last || Date.now(),
        }));
        DB.setMeta('recent', S.recent).catch(dbFail);
        DB.setMeta('history', null).catch(dbFail);
      }
      if (cache) Object.entries(cache).forEach(([k, data]) => { S.dict[k] = { status: 'ok', data }; });
      S.log = log || {};
      S.daily = daily || S.daily;
    } catch (err) {
      document.getElementById('view').innerHTML = `<p class="empty">無法開啟本機資料庫：${esc(err.message || err)}<br>請確認沒有使用無痕模式。</p>`;
      return;
    }
    S.mode = S.settings.defaultMode;
    applyTheme();
    // 預覽版會內嵌資料（window.SEED)，第一次開啟時自動匯入
    if (window.SEED && !S.entries.some((e) => e.src === 'import')) {
      document.getElementById('view').innerHTML = '<div class="loading"><span class="spinner"></span>第一次開啟，正在匯入單字簿…</div>';
      await importData(window.SEED, 'merge');
      DB.setMeta('seedStamp', window.SEED.exported || '').catch(dbFail);
    } else if (window.SEED) {
      await syncSeed();
    }
    S.ready = true;

    // 分享進來（share_target 會以 ?text=... 開啟）
    try {
      const params = new URLSearchParams(location.search);
      const shared = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join(' ').trim();
      if (shared) {
        S.shareText = shared.replace(/https?:\/\/\S+/g, '').trim() || shared;
        history.replaceState(null, '', location.pathname + '#/share');
      }
    } catch (err) { /* 忽略 */ }
    if (/^#[a-z]/.test(location.hash)) { location.hash = '#/' + location.hash.slice(1); return; }
    render();
  }

  // 內建的單字簿有更新時（例如修正「相關說明」），只更新筆記內容，不動複習進度
  async function syncSeed() {
    const stamp = window.SEED.exported || '';
    if (await DB.getMeta('seedStamp') === stamp) return;
    const touched = [];
    (window.SEED.entries || []).forEach((raw) => {
      const cur = byId(raw.id);
      if (!cur || cur.src !== 'import') return;
      cur.related = Array.isArray(raw.related) ? raw.related : [];
      cur.group = raw.group || null;
      touched.push(cur);
    });
    S.groups = {};
    (window.SEED.groups || []).forEach((g) => { S.groups[g.id] = g; });
    await DB.clear('groups').catch(dbFail);
    await saveGroups();
    await saveEntries(touched);
    await DB.setMeta('seedStamp', stamp).catch(dbFail);
  }

  init();

  // 從其他 App 分享進來（App 已經開著的時候）
  window.__shareIn = (text) => {
    const t = String(text || '').trim();
    if (!t) return;
    S.shareText = t.replace(/https?:\/\/\S+/g, '').trim() || t;
    if (location.hash === '#/share') render(); else location.hash = '#/share';
  };

  if (!NATIVE && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker?.register('sw.js').catch(() => { /* 預覽環境不支援，沒關係 */ });
  }
})();
