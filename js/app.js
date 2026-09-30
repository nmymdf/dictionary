// 單字本 — 主程式
// 資料存在本機 IndexedDB(js/db.js)；線上查詢在 js/lookup.js；複習排程在 js/srs.js。
(function () {
  'use strict';

  /* ---------- 狀態 ---------- */
  const DAYMS = 86400000;
  const DEFAULT_SETTINGS = {
    accent: 'en-US', rate: 1, voice: '', autoSpeak: false,
    defaultMode: 'word', newPerDay: 20, perSession: 20, retention: 0.9,
    fontSize: 'normal', theme: 'light', skipRare: false,
  };
  const S = {
    ready: false,
    entries: [],
    index: new Map(),      // id → entry
    groups: {},
    history: [],           // [{id, at}]
    log: {},               // 每天複習數 { 'YYYY-MM-DD': n }
    daily: { date: '', newDone: 0 },
    settings: { ...DEFAULT_SETTINGS },
    mode: 'word',
    draft: '',
    lib: { filter: 'all', usage: 'all', tag: '', q: '', sort: 'recent', limit: 100 },
    reviewSetup: { range: 'all', mode: 'mix', tag: '', open: false },
    session: null,
    backup: { file: null, parsed: null, strategy: 'merge', result: null },
    imp: { step: 1, files: [], parsed: null, error: '' },
    shareText: null,
    pending: {},           // 線上查詢中/失敗 { id: 'loading' | 'error：訊息' }
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
      tags: Array.isArray(e.tags) ? e.tags : [],
      date: e.date || '',
      fixes: Array.isArray(e.fixes) ? e.fixes : [],
      starred: !!e.starred,
      count: e.count || 0,
      last: e.last || null,
      added: e.added || Date.now(),
      order: e.order ?? 0,
      src: e.src || 'lookup',
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
  let histTimer;
  function saveHistory() {
    clearTimeout(histTimer);
    histTimer = setTimeout(() => DB.setMeta('history', S.history.slice(0, 500)).catch(dbFail), 300);
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
  const usageChip = (u) => (u && USAGE[u] ? `<span class="uchip ${USAGE[u][1]}">${USAGE[u][0]}</span>` : '');
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
  function speak(text, rate, btn) {
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
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#121816' : '#f7f8f6';
    try { NATIVE?.setDark(dark); } catch (err) { /* 舊版 App 沒有這個功能 */ }
  }
  darkMQ.addEventListener?.('change', applyTheme);
  function saveTheme() { try { localStorage.setItem('danciben-theme', S.settings.theme); } catch (err) { /* 無法儲存沒關係 */ } }

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

  const go = (path) => { location.hash = '#/' + path; };

  /* ---------- 查詢 ---------- */
  function looksLikeSentence(t) { return normText(t).split(' ').length > 3 || /[.!?]$/.test(normText(t)); }

  function recordQuery(e) {
    e.count += 1;
    e.last = Date.now();
    S.history = S.history.filter((h) => h.id !== e.id);
    S.history.unshift({ id: e.id, at: e.last });
    saveHistory();
    saveEntry(e);
  }

  function runQuery(raw, mode) {
    const text = normText(raw).replace(/^["“'(]+|["”')]+$/g, '');
    if (!text) { toast('先輸入要查的單字或句子'); return; }
    mode = mode || S.mode;
    const clean = mode === 'word' ? text.replace(/[.,!?;:]+$/, '') : text;
    const id = makeId(mode, clean);
    let e = byId(id);
    S.draft = '';
    if (e) {
      recordQuery(e);
      if (S.settings.autoSpeak) speak(e.text);
      go('result/' + encodeURIComponent(e.id));
      return;
    }
    // 不在單字庫：先建立暫存卡，結果頁會去線上查
    e = normEntry({ id, type: mode, text: mode === 'word' ? clean.toLowerCase() : clean, src: 'lookup' });
    e.temp = true;
    addEntry(e);
    if (S.settings.autoSpeak) speak(e.text);
    go('result/' + encodeURIComponent(e.id));
    fetchOnline(e);
  }

  async function fetchOnline(e) {
    S.pending[e.id] = 'loading';
    render();
    try {
      if (e.type === 'word') {
        const r = await Lookup.word(e.text);
        e.ipa = e.ipa || r.ipa;
        e.senses = r.senses;
        e.examples = r.examples;
      } else {
        e.zh = await Lookup.sentence(e.text);
      }
      delete S.pending[e.id];
      delete e.temp;
      recordQuery(e);
    } catch (err) {
      S.pending[e.id] = 'error:' + (navigator.onLine === false ? '沒有網路連線' : '查詢服務沒有回應');
    }
    if (location.hash.includes(encodeURIComponent(e.id))) render();
  }

  function toggleStar(id) {
    const e = byId(id);
    e.starred = !e.starred;
    if (e.starred) {
      if (!e.review.reps) { e.review.status = 'new'; e.review.due = Date.now(); }
      toast(`已把「${e.type === 'word' ? e.text : '這個句子'}」加入複習`);
    } else {
      toast('已從複習移除（複習紀錄會保留）');
    }
    saveEntry(e);
    render();
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
  function confusablesBlock(e, detailed) {
    const g = e.group && S.groups[e.group];
    if (!g) return '';
    const members = g.members.map(byId).filter(Boolean);
    const others = members.filter((m) => m.id !== e.id);
    if (!others.length) return '';
    if (detailed) {
      return `<section class="block"><h3>同組易混淆</h3>
        ${g.note ? `<p class="note">${esc(g.note)}</p>` : ''}
        <div class="cmp">${members.map((m) => `
          <a class="cmp-row ${m.id === e.id ? 'self' : ''}" href="#/entry/${encodeURIComponent(m.id)}">
            <span class="hw-sm" lang="en">${esc(m.text)}</span>
            <span class="cmp-pos">${[...new Set(m.senses.map((s) => s.pos))].join(' ')}</span>
            <span class="cmp-zh">${esc(zhShort(m))}</span>
            ${m.starred ? ic('star', 'mini-star') : '<span></span>'}
          </a>`).join('')}</div></section>`;
    }
    return `<section class="block"><h3>同組易混淆</h3>
      <div class="chips">${others.map((o) => `<button class="chip-link" data-act="query" data-text="${esc(o.text)}" data-mode="word"><b lang="en">${esc(o.text)}</b> ${esc((o.senses[0] || {}).zh || '')}</button>`).join('')}</div>
      ${g.note ? `<p class="note">${esc(g.note)}</p>` : ''}</section>`;
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

  function entryRow(e, opts = {}) {
    return `<li class="row">
      <a class="row-main" href="#/${opts.toResult ? 'result' : 'entry'}/${encodeURIComponent(e.id)}">
        <span class="row-title ${e.type === 'sentence' ? 'is-sent' : ''}" ${e.type === 'word' ? 'lang="en"' : ''}>${esc(e.text)}</span>
        <span class="row-sub">${e.type === 'sentence' ? '<span class="tag-s">句子</span>' : ''}${usageChip(e.usage)}${esc(zhShort(e))}</span>
      </a>
      <div class="row-meta">
        ${speakBtn(e.text, '播放發音', 'row-speak')}
        ${opts.time ? `<span class="muted small">${rel(opts.time)}</span>` : ''}
        <button class="star-mini ${e.starred ? 'on' : ''}" data-act="star" data-id="${esc(e.id)}" aria-label="${e.starred ? '移出複習' : '加入複習'}">${ic('star')}</button>
      </div></li>`;
  }

  /* ---------- 畫面：查詢 ---------- */
  function suggestions(q) {
    q = q.trim().toLowerCase();
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

  function viewSearch() {
    const recent = S.history.slice(0, 10).map((h) => ({ e: byId(h.id), at: h.at })).filter((x) => x.e && !x.e.temp);
    const isSent = S.mode === 'sentence';
    const empty = !S.entries.some((e) => e.src === 'import');
    return {
      title: '查詢', tab: 'search', hideTitle: true,
      html: `
      <div class="search-hero">
        <div class="seg" role="tablist" aria-label="查詢模式">
          <button role="tab" class="${!isSent ? 'on' : ''}" data-act="mode" data-mode="word" aria-selected="${!isSent}">單字</button>
          <button role="tab" class="${isSent ? 'on' : ''}" data-act="mode" data-mode="sentence" aria-selected="${isSent}">句子</button>
        </div>
        <form class="search-box ${isSent ? 'tall' : ''}" id="search-form">
          <textarea id="q" rows="${isSent ? 4 : 1}" lang="en" autocapitalize="off" autocomplete="off" spellcheck="false" enterkeyhint="search"
            placeholder="${isSent ? '貼上或輸入英文句子' : '輸入英文單字或片語'}">${esc(S.draft)}</textarea>
          <div class="search-actions">
            <button type="button" class="icon-btn ghost" data-act="clear" aria-label="清除">${ic('x')}</button>
            <button type="submit" class="btn primary">${ic('search')}<span>${isSent ? '翻譯' : '查詢'}</span></button>
          </div>
        </form>
        <ul class="suggest" id="suggest">${suggestHtml(S.draft)}</ul>
        <p class="input-hint">${ic('mic')} 用鍵盤上的麥克風說 ${ic('pen')} 或用 S Pen 直接手寫</p>
        <p class="input-hint auto-hint" id="auto-hint" hidden>看起來像句子，<button class="link" data-act="mode" data-mode="sentence">改用句子翻譯</button></p>
      </div>
      ${empty ? `<section class="block panel onboard">
        <h3>${ic('file')} 還沒有匯入你的單字簿</h3>
        <p class="note">到「更多 → 匯出 / 匯入 JSON」選 <b>danciben-import.json</b>,47 個 Word 檔整理好的單字就會進來。</p>
        <a class="btn primary" href="#/backup">去匯入</a>
      </section>` : ''}
      <section class="block">
        <div class="block-head"><h3>最近查過</h3><a class="link" href="#/library" data-act="lib-recent">全部 ${ic('chev')}</a></div>
        ${recent.length ? `<ul class="list">${recent.map((r) => entryRow(r.e, { time: r.at, toResult: true })).join('')}</ul>` : '<p class="muted small">查過的字會自動記在這裡。</p>'}
      </section>`,
      after() {
        const ta = document.getElementById('q');
        const hint = document.getElementById('auto-hint');
        const sug = document.getElementById('suggest');
        ta.addEventListener('input', () => {
          S.draft = ta.value;
          hint.hidden = !(S.mode === 'word' && looksLikeSentence(ta.value));
          sug.innerHTML = suggestHtml(ta.value);
        });
        ta.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); runQuery(ta.value); }
        });
        document.getElementById('search-form').addEventListener('submit', (ev) => { ev.preventDefault(); runQuery(ta.value); });
        if (window.matchMedia('(min-width: 900px)').matches) ta.focus();
      },
    };
  }

  /* ---------- 畫面：查詢結果 ---------- */
  function pendingBlock(e) {
    const p = S.pending[e.id];
    if (p === 'loading') return '<div class="loading"><span class="spinner"></span>正在查詢字典…</div>';
    if (p && p.startsWith('error:')) {
      return `<div class="error-box">${ic('alert')}<div><b>查不到：${esc(p.slice(6))}</b><br><span class="small">確認有連上網路後再試一次。</span></div>
        <button class="btn small" data-act="retry" data-id="${esc(e.id)}">重試</button></div>`;
    }
    return '';
  }

  function maybeFetchIpa(e) {
    if (e.type !== 'word' || e.ipa || e.ipaTried || e.temp || /\s/.test(e.text)) return;
    e.ipaTried = true;
    Lookup.ipa(e.text).then((ipa) => {
      if (ipa) { e.ipa = ipa; saveEntry(e); if (location.hash.includes(encodeURIComponent(e.id))) render(); }
    }).catch(() => {});
  }

  function wordHeader(e, detail) {
    return `<header class="hw">
        <div class="hw-line">
          <h2 class="headword" lang="en">${esc(e.text)}</h2>
          ${speakBtn(e.text)}
        </div>
        <div class="ipa-line">${e.ipa ? `<span class="ipa">${esc(e.ipa)}</span>` : ''}${detail ? '' : usageChip(e.usage)}</div>
        ${detail ? `<div class="usage-row"><span class="muted small">用法</span>${usagePicker(e)}</div>` : ''}
        ${e.temp ? '' : starBtn(e, true)}
      </header>`;
  }

  function viewResult(id) {
    const e = byId(id);
    if (!e) return viewMissing();
    if (e.type === 'sentence') return viewSentenceResult(e);
    maybeFetchIpa(e);
    const pend = pendingBlock(e);
    const src = e.src === 'import' ? `你的單字簿 ${tagChips(e)}` : '線上字典';
    return {
      title: '查詢結果', tab: 'search', back: '#/search',
      html: `
      ${e.temp || !e.count ? '' : `<div class="logged">${ic('clock')} 已記錄到查詢紀錄 · 第 ${e.count} 次查這個字</div>`}
      ${wordHeader(e, false)}
      ${pend || `
      <section class="block"><h3>意思</h3>${sensesBlock(e)}</section>
      ${formsBlock(e)}
      <section class="block"><h3>例句</h3>${examplesBlock(e)}</section>
      ${notesBlock(e)}
      ${confusablesBlock(e, false)}
      <div class="foot-links">
        <a class="link" href="#/entry/${encodeURIComponent(e.id)}">詳情與編輯 ${ic('chev')}</a>
        <span class="muted small">來源：${src}</span>
      </div>`}`,
    };
  }

  function viewSentenceResult(e) {
    const pend = pendingBlock(e);
    return {
      title: '句子翻譯', tab: 'search', back: '#/search',
      html: `
      ${e.temp || !e.count ? '' : `<div class="logged">${ic('clock')} 已記錄到查詢紀錄 · 第 ${e.count} 次</div>`}
      <section class="sent-card">
        <div class="sent-en" lang="en">${sentenceTokens(e.text)}</div>
        <p class="tap-hint">點句子裡的任何一個字就能直接查；有底線的字已在你的單字庫。</p>
        <div class="sent-actions">${speakBtn(e.text, '唸整句')}<button class="btn small ghost" data-act="speak" data-text="${esc(e.text)}" data-rate="0.7">慢速</button></div>
      </section>
      ${pend || `<section class="block"><h3>中文翻譯</h3><p class="sent-zh">${esc(e.zh)}</p></section>
      ${e.date || e.tags.length ? `<p class="muted small">${e.date ? esc(e.date) + ' · ' : ''}${tagChips(e)}</p>` : ''}
      <div class="center-row">${starBtn(e, true)}</div>
      <div class="foot-links"><a class="link" href="#/entry/${encodeURIComponent(e.id)}">詳情與編輯 ${ic('chev')}</a><span class="muted small">來源：${e.src === 'import' ? '你的筆記' : '線上翻譯'}</span></div>`}`,
    };
  }

  /* ---------- 畫面：分享進來 ---------- */
  function viewShare() {
    const text = S.shareText;
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
    const real = S.entries.filter((e) => !e.temp);
    const counts = {
      all: real.length,
      star: real.filter((e) => e.starred).length,
      word: real.filter((e) => e.type === 'word').length,
      sentence: real.filter((e) => e.type === 'sentence').length,
    };
    let list = real.filter((e) => (L.filter === 'all') || (L.filter === 'star' && e.starred) || (L.filter === e.type));
    if (L.usage !== 'all') list = list.filter((e) => e.usage === L.usage);
    if (L.tag) list = list.filter((e) => e.tags.includes(L.tag));
    if (L.q) {
      const q = L.q.toLowerCase().trim();
      list = list.filter((e) => e.text.toLowerCase().includes(q) || zhShort(e).includes(L.q.trim()));
    }
    const sorters = {
      recent: (a, b) => (b.last || 0) - (a.last || 0) || a.order - b.order,
      count: (a, b) => b.count - a.count,
      az: (a, b) => a.text.localeCompare(b.text),
      file: (a, b) => a.order - b.order,
      wrong: (a, b) => (b.review.lapses || 0) - (a.review.lapses || 0) || (b.review.wrong || 0) - (a.review.wrong || 0),
    };
    list.sort(sorters[L.sort] || sorters.recent);
    const total = list.length;
    const shown = list.slice(0, L.limit);
    const f = (key, label) => `<button class="fchip ${L.filter === key ? 'on' : ''}" data-act="lib-filter" data-f="${key}">${label}<span class="tnum">${counts[key]}</span></button>`;
    return {
      title: '單字庫', tab: 'library',
      html: `
      <div class="lib-tools">
        <label class="lib-search">${ic('search')}<input id="lib-q" type="search" placeholder="搜尋英文或中文" value="${esc(L.q)}"></label>
        <div class="fchips">${f('all', '全部')}${f('star', '複習中')}${f('word', '單字')}${f('sentence', '句子')}</div>
        <div class="filter-row">
          <div class="fchips usage-filter">${[['all', '全部用法'], ['daily', '生活'], ['formal', '正式'], ['rare', '很少用']].map(([k, t]) => `<button class="fchip small ${L.usage === k ? 'on' : ''}" data-act="lib-usage" data-u="${k}">${t}</button>`).join('')}</div>
        </div>
        <div class="filter-row">
          <label class="sort">檔案
            <select id="lib-tag"><option value="">全部</option>${allTags().map((t) => `<option value="${esc(t)}" ${L.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
          </label>
          <label class="sort">排序
            <select id="lib-sort">
              ${[['recent', '最近查詢'], ['count', '查詢次數'], ['wrong', '最常答錯'], ['file', '檔案順序'], ['az', 'A → Z']].map(([v, t]) => `<option value="${v}" ${L.sort === v ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </label>
        </div>
        <p class="muted small tnum">共 ${total} 筆</p>
      </div>
      ${shown.length ? `<ul class="list">${shown.map((e) => entryRow(e)).join('')}</ul>` : '<p class="empty">沒有符合的項目。換個關鍵字或篩選條件試試。</p>'}
      ${total > shown.length ? `<button class="btn ghost wide" data-act="lib-more">再顯示 ${Math.min(100, total - shown.length)} 筆</button>` : ''}`,
      after() {
        const q = document.getElementById('lib-q');
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
        document.getElementById('lib-tag').addEventListener('change', (ev) => { S.lib.tag = ev.target.value; S.lib.limit = 100; render(); });
      },
    };
  }

  /* ---------- 畫面：單字詳情 ---------- */
  function viewEntry(id) {
    const e = byId(id);
    if (!e) return viewMissing();
    if (S.editing === e.id) return viewEdit(e);
    maybeFetchIpa(e);
    const r = e.review;
    const total = (r.right || 0) + (r.wrong || 0);
    const stats = `
      <div class="stats">
        <div><span class="stat-n tnum">${e.count}</span><span class="stat-l">查詢次數</span></div>
        <div><span class="stat-n">${rel(e.last)}</span><span class="stat-l">最後查詢</span></div>
        <div><span class="stat-n">${statusPill(e)}</span><span class="stat-l">複習狀態</span></div>
        <div><span class="stat-n tnum">${total ? `${r.right}/${total}` : '—'}</span><span class="stat-l">答對次數</span></div>
      </div>
      ${e.starred && r.due && r.reps ? `<p class="muted small due">下次複習：${r.due <= endOfToday() ? '今天' : rel(r.due)}${r.s ? ` · 記憶穩定度約 ${Math.round(r.s)} 天` : ''}</p>` : ''}`;
    const tags = e.tags.length ? tagChips(e) : '<span class="muted small">（查詢時加入，沒有檔案標籤）</span>';
    const body = e.type === 'word'
      ? `<section class="block"><h3>意思</h3>${sensesBlock(e)}</section>
         ${formsBlock(e)}
         <section class="block"><h3>例句</h3>${examplesBlock(e)}</section>
         ${notesBlock(e)}
         ${confusablesBlock(e, true)}`
      : `<section class="block"><div class="sent-en" lang="en">${sentenceTokens(e.text)}</div></section>
         <section class="block"><h3>中文翻譯</h3><p class="sent-zh">${esc(e.zh)}</p></section>
         ${e.date ? `<p class="muted small">筆記日期：${esc(e.date)}</p>` : ''}`;
    const del = S.confirm === 'del:' + e.id;
    return {
      title: e.type === 'word' ? '單字詳情' : '句子詳情', tab: 'library', back: '#/library',
      html: `
      ${e.type === 'word' ? wordHeader(e, true) : `<header class="hw"><div class="hw-line"><h2 class="headword sent-head">句子</h2>${speakBtn(e.text)}</div>${starBtn(e, true)}</header>`}
      ${stats}
      ${body}
      ${fixesBlock(e)}
      <section class="block"><h3>檔案標籤${e.tags.length > 1 ? ` <span class="muted">· 出現在 ${e.tags.length} 個檔案</span>` : ''}</h3><div class="chips">${tags}</div></section>
      <div class="danger-row">
        <button class="btn ghost" data-act="edit" data-id="${esc(e.id)}">${ic('pen')} 編輯</button>
        ${e.starred ? `<button class="btn ghost" data-act="suspend" data-id="${esc(e.id)}">${e.review.suspended ? '恢復複習' : '暫停複習'}</button>` : ''}
        <button class="btn ghost" data-act="query" data-text="${esc(e.text)}" data-mode="${e.type}">再查一次</button>
        <button class="btn ghost danger" data-act="delete" data-id="${esc(e.id)}">${del ? '再按一次確定刪除' : '刪除'}</button>
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
  const notRare = (e) => !(S.settings.skipRare && e.usage === 'rare');

  function rollDaily() {
    if (S.daily.date !== today()) { S.daily = { date: today(), newDone: 0 }; DB.setMeta('daily', S.daily).catch(dbFail); }
  }

  function todayPlan() {
    rollDaily();
    const due = S.entries.filter((e) => isDue(e) && notRare(e)).sort((a, b) => a.review.due - b.review.due);
    const newLeft = Math.max(0, Number(S.settings.newPerDay) - S.daily.newDone);
    const fresh = S.entries.filter((e) => isNew(e) && notRare(e)).sort((a, b) => a.order - b.order || a.added - b.added).slice(0, newLeft);
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
    if (R.range === 'lookup') pool = S.entries.filter((e) => e.src === 'lookup' && !e.temp && e.count > 0);
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
      const fresh = S.session.items.filter((x) => !byId(x.id).review.reps);
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
      <label class="check skip-rare"><input type="checkbox" id="rv-skip" ${S.settings.skipRare ? 'checked' : ''}> 略過標成 ${usageChip('rare')} 的字</label>
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
            ${opt('range', 'lookup', '我查過的字', '')}
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
        document.getElementById('rv-skip').addEventListener('change', (ev) => { S.settings.skipRare = ev.target.checked; saveSettings(); render(); });
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
  const kindLabel = (it) => `<p class="q-label">${KIND[it.kind][0]}${it.again ? ' · 再考一次' : ''}</p>`;

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
    const days = it.again ? null : SRS.preview(e.review, Number(S.settings.retention));
    return `<div class="grade four">${GRADES.map(([t, c], g) => `<button class="btn ${c}" data-act="grade" data-g="${g + 1}"><span>${t}</span>${days ? `<small>${g === 0 ? '再考一次' : SRS.fmtDays(days[g])}</small>` : ''}</button>`).join('')}</div>`;
  }
  function blanked(it, e, picked) {
    if (!it.ex) return '';
    const re = wordRe(e.text);
    return esc(it.ex.en).replace(new RegExp(re.source, 'i'), (m) => (picked ? `<mark>${m}</mark>` : '<span class="blank">＿＿＿＿</span>'));
  }
  const cardBack = (e) => (e.type === 'word'
    ? `${sensesBlock(e)}${e.forms && e.forms.infl ? `<p class="infl small" lang="en">${esc(e.forms.infl)}</p>` : ''}${e.examples[0] ? `<div class="ex-en small" lang="en">${highlight(e.examples[0].en, e.text)}</div><div class="ex-zh">${esc(e.examples[0].zh)}</div>` : ''}`
    : `<p class="sent-zh">${esc(e.zh)}</p>`);

  const RENDER = {
    flash(s, it, e) {
      return `
      <div class="flash ${s.flipped ? 'flipped' : ''}" data-act="flip" role="button" tabindex="0" aria-label="翻面">
        <span class="flash-front">
          ${kindLabel(it)}
          <span class="${e.type === 'word' ? 'headword' : 'flash-sent'}" lang="en">${esc(e.text)}</span>
          ${e.ipa ? `<span class="ipa">${esc(e.ipa)}</span>` : ''}
          ${usageChip(e.usage)}
          ${!s.flipped ? `<span class="muted small flip-hint">先想${e.type === 'word' ? '中文意思' : '整句的意思'}，再點一下翻面</span>` : ''}
        </span>
        ${s.flipped ? `<span class="flash-back">${cardBack(e)}</span>` : ''}
      </div>
      <div class="center-row">${speakBtn(e.text)}</div>${gradeBar(s, e)}`;
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
      ${s.picked && g.note ? `<p class="confuse-note">${ic('alert')} ${esc(g.note)}</p>` : ''}${s.picked ? nextBar(s, s.picked === it.id) : ''}`;
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
    e.review = SRS.schedule(e.review, g, Number(S.settings.retention));
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
      const seen = new Set(inc.examples.map((x) => x.en.toLowerCase()));
      cur.examples = [...inc.examples, ...cur.examples.filter((x) => !seen.has(x.en.toLowerCase()))];
    }
    cur.tags = [...new Set([...cur.tags, ...inc.tags])];
    cur.fixes = [...new Set([...cur.fixes, ...inc.fixes])];
    cur.count = Math.max(cur.count, inc.count);
    cur.last = Math.max(cur.last || 0, inc.last || 0) || null;
    cur.starred = cur.starred || inc.starred;
    if ((inc.review.reps || 0) > (cur.review.reps || 0)) cur.review = inc.review;
    if (cur.src === 'lookup' && inc.src === 'import') { cur.src = 'import'; cur.order = inc.order; }
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
    if (Array.isArray(data.history) && !S.history.length) { S.history = data.history.filter((h) => byId(h.id)); saveHistory(); }
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
      entries, groups: Object.values(S.groups), history: S.history.slice(0, 500), log: S.log,
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
          <div><span class="stat-n tnum">${S.history.length}</span><span class="stat-l">查詢紀錄</span></div>
        </div>
      </section>
      <p class="author">作者：ArchieKUO</p>`,
    };
  }

  function viewHelp() {
    return {
      title: '使用說明', tab: 'more', back: '#/more',
      html: `
      <section class="block panel help">
        <h3>安裝</h3>
        <p><b>手機（Chrome)</b>：開啟網址 → 右上角 ⋮ → 「加到主畫面」或「安裝應用程式」。</p>
        <p><b>Windows(Chrome 或 Edge)</b>：網址列右邊的「安裝」圖示 → 安裝。之後從開始功能表開。</p>
      </section>
      <section class="block panel help">
        <h3>從其他 App 分享</h3>
        <p>安裝後，在任何 App 選取英文 → 分享 → 選「單字本」，就會直接查詢。</p>
      </section>
      <section class="block panel help">
        <h3>複習怎麼排</h3>
        <p>用 FSRS 演算法（Anki 目前用的）：每個字依你記得的程度，算出下次最適合複習的日子。評「記得」間隔會拉長，「忘了」明天再出現。</p>
        <p>每天只出到期的字，加上有上限的新字。每天花 10–15 分鐘，比一次猛背有效。</p>
        <p>題型會自動從「認得」進到「會用」：閃卡 → 例句挖空、易混淆辨析 → 反向閃卡、拼字、聽力。</p>
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
      <section class="block panel"><h3>發音（系統語音）</h3>
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
        <label class="set-row"><span>目標記憶率</span>${sel('set-ret', 'retention', [[0.85, '85%（複習少一點）'], [0.9, '90%（建議）'], [0.95, '95%（複習多一點）']])}</label>
      </section>
      <section class="block panel"><h3>外觀</h3>
        <label class="set-row"><span>主題</span>${sel('set-theme', 'theme', [['light', '白底'], ['dark', '黑底'], ['system', '跟隨系統']])}</label>
        <label class="set-row"><span>字級</span>${sel('set-font', 'fontSize', [['normal', '標準'], ['large', '大']])}</label>
      </section>
      <section class="block panel"><h3>資料</h3>
        <div class="set-row"><span>已使用空間</span><span class="muted tnum" id="usage-v">計算中…</span></div>
        <button class="btn ghost" data-act="clear-history">${c === 'clear-history' ? '再按一次確定清除' : '清除查詢紀錄'}</button>
        <button class="btn ghost danger" data-act="clear-all">${c === 'clear-all' ? '再按一次：全部刪除（無法復原）' : '清除全部資料'}</button>
        <p class="muted small">清除前建議先匯出 JSON 備份。</p>
      </section>
      <p class="muted small center">單字本 1.0</p>
      <p class="author">作者：ArchieKUO</p>`,
      after() {
        const r = document.getElementById('set-rate');
        r.addEventListener('input', () => { st.rate = parseFloat(r.value); document.getElementById('rate-v').textContent = st.rate.toFixed(1) + '×'; });
        r.addEventListener('change', saveSettings);
        document.querySelectorAll('[data-set]').forEach((el) => el.addEventListener('change', () => {
          const k = el.dataset.set;
          let v = el.type === 'checkbox' ? el.checked : el.value;
          if (['newPerDay', 'perSession', 'retention'].includes(k)) v = Number(v);
          st[k] = v;
          if (k === 'theme' || k === 'fontSize') { applyTheme(); saveTheme(); }
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
    [/^result\/(.+)$/, (id) => viewResult(decodeURIComponent(id))],
    [/^share$/, viewShare],
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
    tb.innerHTML = `${v.back ? `<a class="icon-btn" href="${v.back}" aria-label="返回">${ic('back')}</a>` : '<span class="brand-sm">單字本</span>'}
      <h1 class="${v.hideTitle ? 'sr-only' : ''}">${esc(v.title)}</h1>
      <button class="icon-btn theme-btn" data-act="theme-toggle" aria-label="${dark ? '切換成白底' : '切換成黑底'}">${ic(dark ? 'sun' : 'moon')}</button>`;
    document.title = `${v.title} · 單字本`;
    document.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === v.tab));
    document.body.classList.toggle('focus-mode', !!v.focus);
    if (path !== lastPath) { window.scrollTo(0, 0); lastPath = path; }
    if (v.after) v.after();
  }

  /* ---------- 點擊事件 ---------- */
  const actions = {
    star: (d) => toggleStar(d.id),
    speak: (d, el) => speak(d.text, d.rate ? parseFloat(d.rate) : null, el),
    'theme-toggle': () => { S.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(); saveTheme(); saveSettings(); render(); },
    query: (d) => { if (d.mode) S.mode = d.mode; runQuery(d.text, d.mode); },
    'open-sugg': (d) => { const e = byId(d.id); if (e) { recordQuery(e); S.draft = ''; go('result/' + encodeURIComponent(e.id)); } },
    retry: (d) => { const e = byId(d.id); if (e) fetchOnline(e); },
    mode: (d) => { S.mode = d.mode; render(); document.getElementById('q')?.focus(); },
    clear: () => { S.draft = ''; render(); document.getElementById('q').focus(); },
    'set-usage': (d) => { const e = byId(d.id); e.usage = e.usage === d.u ? null : d.u; e.edited = true; saveEntry(e); render(); },
    'lib-filter': (d) => { S.lib.filter = d.f; S.lib.limit = 100; render(); },
    'lib-usage': (d) => { S.lib.usage = d.u; S.lib.limit = 100; render(); },
    'lib-tag': (d) => { S.lib = { ...S.lib, tag: d.t, filter: 'all', usage: 'all', q: '', sort: 'file', limit: 100 }; go('library'); },
    'lib-recent': () => { S.lib = { ...S.lib, tag: '', filter: 'all', usage: 'all', q: '', sort: 'recent', limit: 100 }; go('library'); },
    'lib-more': () => { S.lib.limit += 100; render(); },
    edit: (d) => { S.editing = d.id; render(); window.scrollTo(0, 0); },
    'edit-cancel': () => { S.editing = null; render(); },
    suspend: (d) => { const e = byId(d.id); e.review.suspended = !e.review.suspended; saveEntry(e); toast(e.review.suspended ? '已暫停，複習時不會出現' : '已恢復複習'); render(); },
    delete: (d) => {
      if (S.confirm !== 'del:' + d.id) { S.confirm = 'del:' + d.id; render(); return; }
      const e = byId(d.id);
      S.entries = S.entries.filter((x) => x !== e); S.index.delete(e.id);
      S.history = S.history.filter((h) => h.id !== e.id); saveHistory();
      DB.del('entries', e.id).catch(dbFail);
      S.confirm = ''; toast('已刪除'); go('library');
    },
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
      S.history = []; saveHistory(); S.confirm = ''; toast('已清除查詢紀錄'); render();
    },
    'clear-all': async () => {
      if (S.confirm !== 'clear-all') { S.confirm = 'clear-all'; render(); return; }
      await Promise.all([DB.clear('entries'), DB.clear('groups'), DB.clear('meta')]);
      S.entries = []; S.index = new Map(); S.groups = {}; S.history = []; S.log = {}; S.confirm = '';
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
    try { const t = localStorage.getItem('danciben-theme'); if (t) S.settings.theme = t; } catch (err) { /* 忽略 */ }
    applyTheme();
    try {
      const [entries, groups, settings, history, log, daily] = await Promise.all([
        DB.all('entries'), DB.all('groups'), DB.getMeta('settings'), DB.getMeta('history'), DB.getMeta('log'), DB.getMeta('daily'),
      ]);
      entries.forEach((e) => addEntry(normEntry(e)));
      groups.forEach((g) => { S.groups[g.id] = g; });
      if (settings) S.settings = { ...DEFAULT_SETTINGS, ...settings };
      S.history = (history || []).filter((h) => S.index.has(h.id));
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
