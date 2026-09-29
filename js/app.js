// 單字本 — 可點擊的畫面原型
// 全部是假資料與假動作；狀態只存在記憶體，重新整理就會還原。
(function () {
  'use strict';

  /* ---------- 狀態 ---------- */
  const M = window.MOCK;
  const S = {
    entries: M.entries,
    groups: M.groups,
    history: M.history,
    mode: 'word',          // 查詢模式：word | sentence
    draft: '',
    lib: { filter: 'all', q: '', sort: 'recent' },
    reviewSetup: { range: 'due', mode: 'flash', count: 5, tag: '07' },
    session: null,         // 進行中的複習
    imp: { step: 1, files: false, resolved: {} },
    backup: { exported: false, importPicked: false, strategy: 'merge', done: false },
    settings: { accent: 'en-US', rate: 1, autoSpeak: false, dict: 'free', mt: 'google', defaultMode: 'word', perSession: 20, fontSize: 'normal' },
    shareText: null,
  };

  const byId = (id) => S.entries.find((e) => e.id === id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
    alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  };
  const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name]}</svg>`;

  /* ---------- 小工具 ---------- */
  function rel(t) {
    if (!t) return '—';
    const diff = Date.now() - t;
    const m = Math.round(diff / 60000);
    if (diff < 0) return `${Math.ceil(-diff / 86400000)} 天後`;
    if (m < 1) return '剛剛';
    if (m < 60) return `${m} 分鐘前`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} 小時前`;
    const d = Math.round(h / 24);
    return d === 1 ? '昨天' : `${d} 天前`;
  }
  const STATUS = {
    none: ['未加入複習', 'st-none'],
    new: ['新加入', 'st-new'],
    learning: ['學習中', 'st-learning'],
    mastered: ['已熟記', 'st-mastered'],
  };
  const statusPill = (e) => {
    const [label, cls] = STATUS[e.review.status];
    return `<span class="pill ${cls}">${label}</span>`;
  };
  const zhShort = (e) => (e.type === 'sentence' ? e.zh : e.senses.map((s) => s.zh).join('；'));

  function highlight(en, word) {
    const stem = word.replace(/e$/, '');
    const re = new RegExp(`\\b(${stem}\\w*)`, 'gi');
    return esc(en).replace(re, '<mark>$1</mark>');
  }

  function speak(text, rate) {
    if (!('speechSynthesis' in window)) { toast('這個瀏覽器沒有系統語音'); return; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = S.settings.accent;
      u.rate = rate || S.settings.rate;
      speechSynthesis.speak(u);
    } catch (err) { toast('無法播放發音'); }
  }

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  const go = (path) => { location.hash = '#/' + path; };

  /* ---------- 查詢 ---------- */
  function looksLikeSentence(t) { return t.trim().split(/\s+/).length > 2; }

  function runQuery(raw, mode) {
    const text = raw.trim().replace(/\s+/g, ' ');
    if (!text) { toast('先輸入要查的單字或句子'); return; }
    mode = mode || S.mode;
    const key = text.toLowerCase().replace(/[.!?]+$/, '');
    let e = S.entries.find((x) => x.type === mode && x.text.toLowerCase().replace(/[.!?]+$/, '') === key);
    if (!e) {
      // 原型：沒有假資料的字，產生一張佔位卡
      const id = 'tmp-' + Date.now();
      e = mode === 'word'
        ? { id, type: 'word', text: key, ipa: '', senses: [{ pos: '—', zh: '（原型）這裡會顯示免費字典查到的意思' }], examples: [{ en: '（原型）字典提供的英文例句會出現在這裡。', zh: '' }], group: null, tags: [], starred: false, count: 0, last: null, added: Date.now(), review: { status: 'none', right: 0, wrong: 0, due: null }, placeholder: true }
        : { id, type: 'sentence', text, zh: '（原型）這裡會顯示翻譯服務的中文翻譯。', tags: [], starred: false, count: 0, last: null, added: Date.now(), review: { status: 'none', right: 0, wrong: 0, due: null }, placeholder: true };
      S.entries.unshift(e);
    }
    e.count += 1;
    e.last = Date.now();
    S.history = S.history.filter((h) => h.id !== e.id);
    S.history.unshift({ id: e.id, at: Date.now() });
    S.draft = '';
    go('result/' + e.id);
  }

  function toggleStar(id) {
    const e = byId(id);
    e.starred = !e.starred;
    if (e.starred) {
      if (e.review.status === 'none') e.review = { status: 'new', right: 0, wrong: 0, due: Date.now() };
      toast(`已把「${e.type === 'word' ? e.text : '這個句子'}」加入複習`);
    } else {
      e.review.status = 'none';
      e.review.due = null;
      toast('已從複習移除');
    }
    render();
  }

  /* ---------- 共用區塊 ---------- */
  function starBtn(e, big) {
    return `<button class="star-btn ${e.starred ? 'on' : ''} ${big ? 'big' : ''}" data-act="star" data-id="${e.id}" aria-pressed="${e.starred}">
      ${ic('star')}<span>${e.starred ? '已加入複習' : '加入複習'}</span></button>`;
  }
  const speakBtn = (text, label = '播放發音') => `<button class="icon-btn" data-act="speak" data-text="${esc(text)}" aria-label="${label}">${ic('speaker')}</button>`;

  function sensesBlock(e) {
    return `<ol class="senses">${e.senses.map((s) => `<li><span class="pos">${esc(s.pos)}</span><span>${esc(s.zh)}</span></li>`).join('')}</ol>`;
  }
  function examplesBlock(e) {
    return `<ul class="examples">${e.examples.map((x) => `
      <li><div class="ex-en">${highlight(x.en, e.text)} ${speakBtn(x.en, '播放例句')}</div>
      ${x.zh ? `<div class="ex-zh">${esc(x.zh)}</div>` : ''}</li>`).join('')}</ul>`;
  }
  function confusablesBlock(e, detailed) {
    if (!e.group) return '';
    const g = S.groups[e.group];
    const others = g.members.filter((m) => m !== e.id).map(byId);
    if (detailed) {
      return `<section class="block"><h3>同組易混淆</h3>
        <p class="note">${esc(g.note)}</p>
        <div class="cmp">${g.members.map(byId).map((m) => `
          <a class="cmp-row ${m.id === e.id ? 'self' : ''}" href="#/entry/${m.id}">
            <span class="hw-sm">${esc(m.text)}</span>
            <span class="cmp-pos">${m.senses.map((s) => s.pos).filter((v, i, a) => a.indexOf(v) === i).join(' ')}</span>
            <span class="cmp-zh">${esc(zhShort(m))}</span>
            ${m.starred ? ic('star', 'mini-star') : '<span></span>'}
          </a>`).join('')}</div></section>`;
    }
    return `<section class="block"><h3>同組易混淆 <span class="muted">· ${esc(g.name)}</span></h3>
      <div class="chips">${others.map((o) => `<button class="chip-link" data-act="query" data-text="${esc(o.text)}" data-mode="word"><b>${esc(o.text)}</b> ${esc(o.senses[0].zh)}</button>`).join('')}</div>
      <p class="note">${esc(g.note)}</p></section>`;
  }
  function sentenceTokens(text) {
    return text.split(/([A-Za-z][A-Za-z'’-]*)/).map((part) => {
      if (/^[A-Za-z]/.test(part)) {
        const known = S.entries.some((x) => x.type === 'word' && part.toLowerCase().startsWith(x.text.replace(/e$/, '')) && !x.placeholder);
        return `<button class="tok ${known ? 'known' : ''}" data-act="query" data-text="${esc(part.toLowerCase())}" data-mode="word">${esc(part)}</button>`;
      }
      return esc(part);
    }).join('');
  }

  function entryRow(e, opts = {}) {
    return `<li class="row">
      <a class="row-main" href="#/${opts.toResult ? 'result' : 'entry'}/${e.id}">
        <span class="row-title ${e.type === 'sentence' ? 'is-sent' : ''}">${e.type === 'sentence' ? '' : ''}${esc(e.text)}</span>
        <span class="row-sub">${e.type === 'sentence' ? '<span class="tag-s">句子</span>' : ''}${esc(zhShort(e))}</span>
      </a>
      <div class="row-meta">
        ${opts.time ? `<span class="muted small">${rel(opts.time)}</span>` : `<span class="muted small tnum">查 ${e.count} 次</span>`}
        <button class="star-mini ${e.starred ? 'on' : ''}" data-act="star" data-id="${e.id}" aria-label="${e.starred ? '移出複習' : '加入複習'}">${ic('star')}</button>
      </div></li>`;
  }

  /* ---------- 畫面：查詢 ---------- */
  function viewSearch() {
    const recent = S.history.slice(0, 8).map((h) => ({ e: byId(h.id), at: h.at })).filter((x) => x.e);
    const isSent = S.mode === 'sentence';
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
            placeholder="${isSent ? '貼上或輸入英文句子' : '輸入英文單字'}">${esc(S.draft)}</textarea>
          <div class="search-actions">
            <button type="button" class="icon-btn ghost" data-act="clear" aria-label="清除">${ic('x')}</button>
            <button type="submit" class="btn primary">${ic('search')}<span>${isSent ? '翻譯' : '查詢'}</span></button>
          </div>
        </form>
        <p class="input-hint">${ic('mic')} 用鍵盤上的麥克風說 ${ic('pen')} 或用 S Pen 直接手寫</p>
        <p class="input-hint auto-hint" id="auto-hint" hidden>看起來像句子，<button class="link" data-act="mode" data-mode="sentence">改用句子翻譯</button></p>
      </div>
      <section class="block">
        <div class="block-head"><h3>最近查過</h3><a class="link" href="#/library">全部紀錄 ${ic('chev')}</a></div>
        <ul class="list">${recent.map((r) => entryRow(r.e, { time: r.at, toResult: true })).join('')}</ul>
      </section>
      <section class="block try">
        <h3>原型試玩</h3>
        <div class="chips">
          <button class="chip-link" data-act="query" data-text="adapt" data-mode="word">查 adapt</button>
          <button class="chip-link" data-act="query" data-text="The new policy will affect how quickly teams adopt new tools." data-mode="sentence">翻譯一句</button>
          <a class="chip-link" href="#/share">${ic('share')} 模擬從其他 App 分享</a>
        </div>
      </section>`,
      after() {
        const ta = document.getElementById('q');
        const hint = document.getElementById('auto-hint');
        ta.addEventListener('input', () => {
          S.draft = ta.value;
          hint.hidden = !(S.mode === 'word' && looksLikeSentence(ta.value));
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
  function viewResult(id) {
    const e = byId(id);
    if (!e) return viewMissing();
    if (e.type === 'sentence') return viewSentenceResult(e);
    return {
      title: '查詢結果', tab: 'search', back: '#/search',
      html: `
      <div class="logged">${ic('clock')} 已自動記錄到查詢紀錄 · 第 ${e.count} 次查這個字</div>
      <header class="hw">
        <div class="hw-line">
          <h2 class="headword" lang="en">${esc(e.text)}</h2>
          ${speakBtn(e.text)}
        </div>
        ${e.ipa ? `<div class="ipa">${esc(e.ipa)}</div>` : '<div class="ipa muted">（無音標）</div>'}
        ${starBtn(e, true)}
      </header>
      <section class="block"><h3>意思</h3>${sensesBlock(e)}</section>
      <section class="block"><h3>例句</h3>${examplesBlock(e)}</section>
      ${confusablesBlock(e, false)}
      <div class="foot-links">
        ${!e.placeholder ? `<a class="link" href="#/entry/${e.id}">在單字庫看詳情 ${ic('chev')}</a>` : ''}
        <span class="muted small">來源：免費字典（原型假資料）</span>
      </div>`,
    };
  }

  function viewSentenceResult(e) {
    return {
      title: '句子翻譯', tab: 'search', back: '#/search',
      html: `
      <div class="logged">${ic('clock')} 已自動記錄到查詢紀錄 · 第 ${e.count} 次</div>
      <section class="sent-card">
        <div class="sent-en" lang="en">${sentenceTokens(e.text)}</div>
        <p class="tap-hint">點句子裡的任何一個字就能直接查；有底線的字已在你的單字庫。</p>
        <div class="sent-actions">${speakBtn(e.text, '唸整句')}<button class="btn small ghost" data-act="speak" data-text="${esc(e.text)}" data-rate="0.7">慢速</button></div>
      </section>
      <section class="block"><h3>中文翻譯</h3><p class="sent-zh">${esc(e.zh)}</p></section>
      <div class="center-row">${starBtn(e, true)}</div>
      <div class="foot-links"><span class="muted small">來源：免費翻譯服務（原型假資料）</span></div>`,
    };
  }

  /* ---------- 畫面：分享進來 ---------- */
  function viewShare() {
    const text = S.shareText || M.sharedSample.text;
    const isSent = looksLikeSentence(text);
    return {
      title: '分享進來的文字', tab: 'search', back: '#/search',
      html: `
      <ol class="share-steps">
        <li><span class="step-n">1</span>在 Chrome、Kindle 等 App 裡選取文字</li>
        <li><span class="step-n">2</span>點「分享」</li>
        <li><span class="step-n">3</span>在分享選單選「單字本」</li>
      </ol>
      <div class="sheet-mock" aria-hidden="true">
        <span class="app-dot">Quick Share</span><span class="app-dot">LINE</span><span class="app-dot">Gmail</span><span class="app-dot ours">單字本</span>
      </div>
      <section class="received">
        <div class="received-from">${ic('share')} 從 ${esc(M.sharedSample.source)} 收到 · 判斷為<b>${isSent ? '句子' : '單字'}</b></div>
        <blockquote lang="en">${esc(text)}</blockquote>
        <div class="btn-col">
          <button class="btn primary" data-act="query" data-text="${esc(text)}" data-mode="${isSent ? 'sentence' : 'word'}">${isSent ? '翻譯這句' : '查這個字'}</button>
          ${isSent ? `<p class="muted small">或只查其中一個字：</p><div class="sent-en small-sent" lang="en">${sentenceTokens(text)}</div>` : ''}
        </div>
      </section>`,
    };
  }

  /* ---------- 畫面：單字庫 ---------- */
  function viewLibrary() {
    const L = S.lib;
    const real = S.entries.filter((e) => !e.placeholder || e.count > 0);
    const counts = {
      all: real.length,
      star: real.filter((e) => e.starred).length,
      word: real.filter((e) => e.type === 'word').length,
      sentence: real.filter((e) => e.type === 'sentence').length,
    };
    let list = real.filter((e) => (L.filter === 'all') || (L.filter === 'star' && e.starred) || (L.filter === e.type));
    if (L.q) {
      const q = L.q.toLowerCase();
      list = list.filter((e) => e.text.toLowerCase().includes(q) || zhShort(e).includes(L.q) || e.tags.includes(L.q.replace('#', '')));
    }
    const sorters = {
      recent: (a, b) => (b.last || 0) - (a.last || 0),
      count: (a, b) => b.count - a.count,
      az: (a, b) => a.text.localeCompare(b.text),
    };
    list.sort(sorters[L.sort]);
    const f = (key, label) => `<button class="fchip ${L.filter === key ? 'on' : ''}" data-act="lib-filter" data-f="${key}">${label}<span class="tnum">${counts[key]}</span></button>`;
    return {
      title: '單字庫', tab: 'library',
      html: `
      <div class="lib-tools">
        <label class="lib-search">${ic('search')}<input id="lib-q" type="search" placeholder="搜尋英文、中文或標籤（例：07)" value="${esc(L.q)}"></label>
        <div class="filter-row">
          <div class="fchips">${f('all', '全部')}${f('star', '星號')}${f('word', '單字')}${f('sentence', '句子')}</div>
          <label class="sort">排序
            <select id="lib-sort">
              <option value="recent" ${L.sort === 'recent' ? 'selected' : ''}>最近查詢</option>
              <option value="count" ${L.sort === 'count' ? 'selected' : ''}>查詢次數</option>
              <option value="az" ${L.sort === 'az' ? 'selected' : ''}>A → Z</option>
            </select>
          </label>
        </div>
      </div>
      ${list.length ? `<ul class="list">${list.map((e) => entryRow(e)).join('')}</ul>` : '<p class="empty">沒有符合的項目。換個關鍵字或篩選條件試試。</p>'}`,
      after() {
        const q = document.getElementById('lib-q');
        q.addEventListener('input', () => {
          S.lib.q = q.value;
          const pos = q.selectionStart;
          render();
          const n = document.getElementById('lib-q');
          n.focus(); n.setSelectionRange(pos, pos);
        });
        document.getElementById('lib-sort').addEventListener('change', (ev) => { S.lib.sort = ev.target.value; render(); });
      },
    };
  }

  /* ---------- 畫面：單字詳情 ---------- */
  function viewEntry(id) {
    const e = byId(id);
    if (!e) return viewMissing();
    const r = e.review;
    const total = r.right + r.wrong;
    const stats = `
      <div class="stats">
        <div><span class="stat-n tnum">${e.count}</span><span class="stat-l">查詢次數</span></div>
        <div><span class="stat-n">${rel(e.last)}</span><span class="stat-l">最後查詢</span></div>
        <div><span class="stat-n">${statusPill(e)}</span><span class="stat-l">複習狀態</span></div>
        <div><span class="stat-n tnum">${total ? `${r.right}/${total}` : '—'}</span><span class="stat-l">答對次數</span></div>
      </div>
      ${e.starred && r.due ? `<p class="muted small due">下次複習：${r.due <= Date.now() ? '今天' : rel(r.due)}</p>` : ''}`;
    const tags = e.tags.length ? e.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join('') : '<span class="muted small">（查詢時加入，沒有標籤）</span>';
    const body = e.type === 'word'
      ? `<section class="block"><h3>意思</h3>${sensesBlock(e)}</section>
         <section class="block"><h3>例句</h3>${examplesBlock(e)}</section>
         ${confusablesBlock(e, true)}`
      : `<section class="block"><div class="sent-en" lang="en">${sentenceTokens(e.text)}</div></section>
         <section class="block"><h3>中文翻譯</h3><p class="sent-zh">${esc(e.zh)}</p></section>`;
    return {
      title: e.type === 'word' ? '單字詳情' : '句子詳情', tab: 'library', back: '#/library',
      html: `
      <header class="hw">
        <div class="hw-line">
          <h2 class="${e.type === 'word' ? 'headword' : 'headword sent-head'}" lang="en">${esc(e.type === 'word' ? e.text : '句子')}</h2>
          ${speakBtn(e.text)}
        </div>
        ${e.type === 'word' ? (e.ipa ? `<div class="ipa">${esc(e.ipa)}</div>` : '<div class="ipa muted">（無音標）</div>') : ''}
        ${starBtn(e, true)}
      </header>
      ${stats}
      ${body}
      <section class="block"><h3>標籤</h3><div class="chips">${tags}</div></section>
      <div class="danger-row">
        <button class="btn ghost" data-act="query" data-text="${esc(e.text)}" data-mode="${e.type}">重新查詢</button>
        <button class="btn ghost danger" data-act="fake" data-msg="原型不會真的刪除">刪除</button>
      </div>`,
    };
  }

  /* ---------- 畫面：複習 ---------- */
  function reviewPool() {
    const R = S.reviewSetup;
    let pool = S.entries.filter((e) => e.starred);
    if (R.range === 'due') pool = pool.filter((e) => e.review.due && e.review.due <= Date.now());
    if (R.range === 'tag') pool = pool.filter((e) => e.tags.includes(R.tag));
    if (R.range === 'recent') pool = pool.filter((e) => Date.now() - e.added < 7 * 86400000);
    if (R.range === 'wrong') pool = pool.filter((e) => e.review.wrong > 0);
    if (R.mode !== 'flash') pool = pool.filter((e) => e.type === 'word');
    return pool;
  }

  function viewReviewHome() {
    const R = S.reviewSetup;
    const starred = S.entries.filter((e) => e.starred);
    const due = starred.filter((e) => e.review.due && e.review.due <= Date.now());
    const pool = reviewPool();
    const tags = [...new Set(starred.flatMap((e) => e.tags))].sort();
    const opt = (group, val, title, sub) => `
      <button class="opt ${R[group] === val ? 'on' : ''}" data-act="rv-set" data-k="${group}" data-v="${val}" aria-pressed="${R[group] === val}">
        <span class="opt-t">${title}</span>${sub ? `<span class="opt-s">${sub}</span>` : ''}</button>`;
    return {
      title: '複習', tab: 'review',
      html: `
      <div class="rv-summary">
        <div><span class="stat-n tnum">${due.length}</span><span class="stat-l">今天到期</span></div>
        <div><span class="stat-n tnum">${starred.length}</span><span class="stat-l">星號總數</span></div>
        <div><span class="stat-n tnum">${starred.filter((e) => e.review.status === 'mastered').length}</span><span class="stat-l">已熟記</span></div>
      </div>
      <section class="block"><h3>範圍</h3>
        <div class="opts">
          ${opt('range', 'due', '今天到期', `${due.length} 個`)}
          ${opt('range', 'all', '全部星號', `${starred.length} 個`)}
          ${opt('range', 'recent', '最近 7 天加入', '')}
          ${opt('range', 'wrong', '曾經答錯的', '')}
          ${opt('range', 'tag', '依標籤', '')}
        </div>
        ${R.range === 'tag' ? `<div class="chips tag-pick">${tags.map((t) => `<button class="fchip ${R.tag === t ? 'on' : ''}" data-act="rv-set" data-k="tag" data-v="${t}">#${t}</button>`).join('')}</div>` : ''}
      </section>
      <section class="block"><h3>題型</h3>
        <div class="opts">
          ${opt('mode', 'flash', '閃卡', '看字想意思，翻面對答案')}
          ${opt('mode', 'cloze', '例句挖空', '從例句選出正確的字')}
          ${opt('mode', 'listen', '聽發音選字', '聽系統語音，選出聽到的字')}
        </div>
      </section>
      <div class="start-bar">
        <span class="muted">這次會複習 <b class="tnum">${Math.min(pool.length, R.count)}</b> 個</span>
        <button class="btn primary" data-act="rv-start" ${pool.length ? '' : 'disabled'}>開始複習</button>
      </div>`,
    };
  }

  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function optionsFor(e) {
    // 優先用同組易混淆字當干擾選項
    const words = S.entries.filter((x) => x.type === 'word' && !x.placeholder && x.id !== e.id);
    const same = e.group ? S.groups[e.group].members.filter((m) => m !== e.id).map(byId) : [];
    const rest = shuffle(words.filter((w) => !same.includes(w)));
    return shuffle([e, ...same, ...rest].slice(0, 4));
  }

  function startReview() {
    const R = S.reviewSetup;
    const pool = shuffle(reviewPool()).slice(0, R.count);
    S.session = {
      mode: R.mode, i: 0, flipped: false, picked: null,
      items: pool.map((e) => ({ id: e.id, options: R.mode === 'flash' ? null : optionsFor(e).map((o) => o.id), ex: e.examples ? e.examples[Math.floor(Math.random() * e.examples.length)] : null, result: null })),
    };
    go('review/' + R.mode);
  }

  function progress(s) {
    const pct = Math.round((s.i / s.items.length) * 100);
    return `<div class="progress"><div class="bar"><span style="width:${pct}%"></span></div><span class="tnum small muted">${s.i + 1} / ${s.items.length}</span></div>`;
  }

  function sessionGuard(mode) {
    const s = S.session;
    if (!s || s.mode !== mode) {
      S.reviewSetup.mode = mode;
      S.reviewSetup.range = 'all';
      startReview();
      return null;
    }
    return s;
  }

  function viewFlash() {
    const s = sessionGuard('flash'); if (!s) return { title: '', html: '' };
    const it = s.items[s.i]; const e = byId(it.id);
    const back = e.type === 'word'
      ? `${sensesBlock(e)}<div class="ex-en small">${highlight(e.examples[0].en, e.text)}</div><div class="ex-zh">${esc(e.examples[0].zh)}</div>`
      : `<p class="sent-zh">${esc(e.zh)}</p>`;
    return {
      title: '閃卡', tab: 'review', back: '#/review', focus: true,
      html: `${progress(s)}
      <button class="flash ${s.flipped ? 'flipped' : ''}" data-act="flip" aria-label="翻面">
        <span class="flash-front">
          <span class="${e.type === 'word' ? 'headword' : 'flash-sent'}" lang="en">${esc(e.text)}</span>
          ${e.ipa ? `<span class="ipa">${esc(e.ipa)}</span>` : ''}
          ${!s.flipped ? '<span class="muted small flip-hint">點一下翻面</span>' : ''}
        </span>
        ${s.flipped ? `<span class="flash-back">${back}</span>` : ''}
      </button>
      <div class="center-row">${speakBtn(e.text)}</div>
      ${s.flipped ? `<div class="grade">
        <button class="btn grade-0" data-act="grade" data-g="0">不熟</button>
        <button class="btn grade-1" data-act="grade" data-g="1">模糊</button>
        <button class="btn grade-2" data-act="grade" data-g="2">記住了</button>
      </div>` : '<div class="grade placeholder"><button class="btn primary wide" data-act="flip">顯示答案</button></div>'}`,
    };
  }

  function choiceList(s, it) {
    return `<div class="choices">${it.options.map((oid) => {
      const o = byId(oid);
      let cls = '';
      if (s.picked) {
        if (oid === it.id) cls = 'correct';
        else if (oid === s.picked) cls = 'wrong';
        else cls = 'dim';
      }
      return `<button class="choice ${cls}" data-act="pick" data-id="${oid}" ${s.picked ? 'disabled' : ''} lang="en">
        <span>${esc(o.text)}</span>${s.picked ? `<span class="choice-zh">${esc(o.senses[0].zh)}</span>` : ''}</button>`;
    }).join('')}</div>`;
  }
  const nextBar = (s) => (s.picked ? `<div class="start-bar"><span class="${s.picked === s.items[s.i].id ? 'ok-txt' : 'bad-txt'}">${s.picked === s.items[s.i].id ? '答對了' : '答錯了，已記下來'}</span><button class="btn primary" data-act="next">${s.i + 1 < s.items.length ? '下一題' : '看結果'}</button></div>` : '');

  function viewCloze() {
    const s = sessionGuard('cloze'); if (!s) return { title: '', html: '' };
    const it = s.items[s.i]; const e = byId(it.id);
    const stem = e.text.replace(/e$/, '');
    const blanked = esc(it.ex.en).replace(new RegExp(`\\b${stem}\\w*`, 'i'), (m) => (s.picked ? `<mark>${m}</mark>` : '<span class="blank">＿＿＿＿</span>'));
    return {
      title: '例句挖空', tab: 'review', back: '#/review', focus: true,
      html: `${progress(s)}
      <section class="q-card">
        <p class="q-label">選出空格裡的字</p>
        <p class="cloze" lang="en">${blanked}</p>
        <p class="ex-zh">${esc(it.ex.zh)}</p>
      </section>
      ${choiceList(s, it)}${nextBar(s)}`,
    };
  }

  function viewListen() {
    const s = sessionGuard('listen'); if (!s) return { title: '', html: '' };
    const it = s.items[s.i]; const e = byId(it.id);
    return {
      title: '聽發音選字', tab: 'review', back: '#/review', focus: true,
      html: `${progress(s)}
      <section class="q-card listen">
        <p class="q-label">聽聽看，選出你聽到的字</p>
        <div class="listen-btns">
          <button class="play-big" data-act="speak" data-text="${esc(e.text)}" aria-label="播放">${ic('speaker')}</button>
          <button class="btn small ghost" data-act="speak" data-text="${esc(e.text)}" data-rate="0.6">慢速再聽</button>
        </div>
      </section>
      ${choiceList(s, it)}${nextBar(s)}`,
    };
  }

  function viewReviewResult() {
    const s = S.session;
    if (!s || s.items.some((x) => x.result === null)) return viewReviewHome();
    const ok = s.items.filter((x) => x.result === 'ok').length;
    const modeName = { flash: '閃卡', cloze: '例句挖空', listen: '聽發音選字' }[s.mode];
    const label = { ok: ['記住了', 'ok'], fuzzy: ['模糊', 'fuzzy'], bad: ['不熟', 'bad'] };
    return {
      title: '複習結果', tab: 'review', back: '#/review',
      html: `
      <section class="result-hero">
        <span class="result-n tnum">${ok}<small>/${s.items.length}</small></span>
        <span class="muted">${modeName} · 答對或記住的數量</span>
      </section>
      <ul class="list">${s.items.map((x) => {
        const e = byId(x.id); const [t, c] = label[x.result];
        return `<li class="row"><a class="row-main" href="#/entry/${e.id}"><span class="row-title ${e.type === 'sentence' ? 'is-sent' : ''}">${esc(e.text)}</span><span class="row-sub">${esc(zhShort(e))}</span></a><div class="row-meta"><span class="res res-${c}">${t}</span></div></li>`;
      }).join('')}</ul>
      <div class="btn-col">
        ${ok < s.items.length ? '<button class="btn primary" data-act="rv-retry">只再練不熟的</button>' : ''}
        <a class="btn ghost" href="#/review">回複習首頁</a>
      </div>
      <p class="muted small">記住了 → 下次間隔拉長；模糊 → 明天再出現；不熟 → 這次結束前再出現一次（原型只示意）。</p>`,
    };
  }

  function grade(result) {
    const s = S.session; const it = s.items[s.i]; const e = byId(it.id);
    it.result = result;
    if (result === 'ok') { e.review.right++; e.review.status = e.review.right >= 5 ? 'mastered' : 'learning'; }
    else { e.review.wrong++; e.review.status = 'learning'; }
  }
  function advance() {
    const s = S.session;
    s.i++; s.flipped = false; s.picked = null;
    if (s.i >= s.items.length) { s.i = s.items.length - 1; go('review/result'); } else render();
  }

  /* ---------- 畫面：更多 ---------- */
  function viewMore() {
    const item = (href, icon, title, sub) => `<li><a class="menu-item" href="${href}">${ic(icon)}<span class="menu-text"><span>${title}</span><span class="muted small">${sub}</span></span>${ic('chev', 'chev')}</a></li>`;
    const screens = [
      ['#/search', '查詢首頁'], ['#/result/affect', '單字結果'], ['#/result/s-policy', '句子翻譯結果'], ['#/share', '分享進來'],
      ['#/library', '單字庫'], ['#/entry/adapt', '單字詳情'], ['#/review', '複習首頁'], ['#/review/flash', '閃卡'],
      ['#/review/cloze', '例句挖空'], ['#/review/listen', '聽發音選字'], ['#/import', '匯入精靈'], ['#/backup', '匯出/匯入 JSON'], ['#/settings', '設定'],
    ];
    return {
      title: '更多', tab: 'more',
      html: `
      <ul class="menu">
        ${item('#/import', 'file', '匯入 Word 單字簿', '一次匯入舊的 .docx，拆成單字卡')}
        ${item('#/backup', 'swap', '匯出 / 匯入 JSON', '手機與 Windows 互轉，用 Quick Share 傳')}
        ${item('#/settings', 'gear', '設定', '發音、字典與翻譯來源、複習')}
      </ul>
      <section class="block storage">
        <h3>本機資料</h3>
        <p class="muted small">所有資料只存在這台裝置。換裝置請用「匯出 JSON」。</p>
        <div class="stats three">
          <div><span class="stat-n tnum">${S.entries.filter((e) => e.type === 'word').length}</span><span class="stat-l">單字</span></div>
          <div><span class="stat-n tnum">${S.entries.filter((e) => e.type === 'sentence').length}</span><span class="stat-l">句子</span></div>
          <div><span class="stat-n tnum">${S.history.length}</span><span class="stat-l">查詢紀錄</span></div>
        </div>
      </section>
      <section class="block">
        <h3>原型：所有畫面</h3>
        <div class="chips">${screens.map(([h, t]) => `<a class="chip-link" href="${h}">${t}</a>`).join('')}</div>
      </section>`,
    };
  }

  /* 匯入精靈 */
  const FILES = ['01 常用動詞.docx', '02 形容詞（一）.docx', '03 affect effect 等.docx', '04 介系詞片語.docx', '05 商用書信.docx', '06 形容詞（二）.docx', '07 易混淆動詞.docx'];
  const ISSUES = [
    { id: 'i1', file: '07 易混淆動詞.docx', kind: '例句歸屬不明', text: '“He adapted the plan and adopted it the next day.” 同時出現 adapt 和 adopt。', choices: ['兩張卡都放', '只放 adapt', '只放 adopt'] },
    { id: 'i2', file: '12 名詞辨析.docx', kind: '缺少詞性', text: 'principal 的第二個意思「主要的」沒有標詞性。', choices: ['設為 adj.', '設為 n.', '保留空白'] },
    { id: 'i3', file: '03 / 17', kind: '重複單字', text: 'affect 同時出現在 03 和 17 號檔，意思略有不同。', choices: ['合併成一張（兩個標籤）', '分成兩張'] },
    { id: 'i4', file: '18 經濟用語.docx', kind: '音標格式', text: '「iˈkɑnəmɪk」看起來是音標但沒有斜線，要當音標嗎？', choices: ['當作音標', '當作一般文字'] },
    { id: 'i5', file: '22 片語.docx', kind: '無法辨識', text: '第 34 行「look up to / look down on」是片語組，要拆成兩張嗎？', choices: ['拆成兩張（同組）', '合成一張', '略過'] },
  ];

  function stepper(n) {
    const names = ['選擇檔案', '解析預覽', '確認選項', '完成'];
    return `<ol class="stepper">${names.map((t, i) => `<li class="${i + 1 < n ? 'done' : ''} ${i + 1 === n ? 'cur' : ''}"><span class="step-n">${i + 1 < n ? '✓' : i + 1}</span><span>${t}</span></li>`).join('')}</ol>`;
  }

  function viewImport() {
    const I = S.imp;
    let body = '';
    if (I.step === 1) {
      body = `
      <button class="dropzone" data-act="imp-pick">${ic('upload')}<span><b>選擇 Word 檔（.docx)</b><br><span class="muted small">可一次選多個檔案；Windows 也可以直接拖進來</span></span></button>
      ${I.files ? `<section class="block"><div class="block-head"><h3>已選 50 個檔案</h3><button class="link" data-act="imp-pick">重選</button></div>
        <ul class="file-list">${FILES.map((f) => `<li>${ic('file')}<span>${f}</span><span class="tag">#${f.slice(0, 2)}</span></li>`).join('')}<li class="muted">…還有 43 個</li></ul>
        <p class="muted small">檔名開頭的編號會變成標籤（例：07 → #07）。</p></section>
        <div class="start-bar"><span></span><button class="btn primary" data-act="imp-step" data-n="2">開始解析</button></div>` : ''}`;
    } else if (I.step === 2) {
      const open = ISSUES.filter((x) => !I.resolved[x.id]).length;
      body = `
      <div class="stats">
        <div><span class="stat-n tnum">50</span><span class="stat-l">檔案</span></div>
        <div><span class="stat-n tnum">1,236</span><span class="stat-l">單字卡</span></div>
        <div><span class="stat-n tnum">318</span><span class="stat-l">易混淆組</span></div>
        <div><span class="stat-n tnum warn-txt">${open + 18}</span><span class="stat-l">待確認</span></div>
      </div>
      <section class="block"><h3>拆卡範例 · 07 易混淆動詞.docx</h3>
        <div class="split">
          <div class="doc-mock" lang="en">
            <p class="doc-h">adapt / adopt / adept</p>
            <p><b>adapt</b> [əˈdæpt] v. 適應；改編</p>
            <p><b>adopt</b> [əˈdɑːpt] v. 採用；收養</p>
            <p><b>adept</b> [əˈdept] adj. 熟練的</p>
            <p class="doc-ex">1. It took him a year to adapt to the new job. 他花了一年才適應新工作。<br>2. They adopted a cat from the shelter. 他們領養了一隻貓。<br>3. She is adept at handling difficult customers. 她很擅長應付難搞的客人。</p>
          </div>
          <div class="split-arrow">${ic('chev')}</div>
          <ul class="card-mocks">${['adapt', 'adopt', 'adept'].map((id) => { const e = byId(id); return `<li><b lang="en">${e.text}</b> <span class="pos">${e.senses[0].pos}</span> ${e.senses[0].zh}<span class="card-meta">例句 1 · #07 · 同組 2 個</span></li>`; }).join('')}</ul>
        </div>
        <p class="muted small">共用的例句會依照裡面出現的字，分給對應的卡。</p>
      </section>
      <section class="block"><div class="block-head"><h3>待確認項目</h3><span class="muted small">顯示 5 / ${open + 18}</span></div>
        <ul class="issues">${ISSUES.map((x) => `
          <li class="issue ${I.resolved[x.id] ? 'resolved' : ''}">
            <div class="issue-head">${ic('alert')}<b>${x.kind}</b><span class="muted small">${x.file}</span></div>
            <p lang="en">${esc(x.text)}</p>
            <div class="chips">${x.choices.map((c) => `<button class="fchip ${I.resolved[x.id] === c ? 'on' : ''}" data-act="imp-resolve" data-id="${x.id}" data-v="${esc(c)}">${c}</button>`).join('')}</div>
          </li>`).join('')}</ul>
        <button class="link" data-act="fake" data-msg="原型：其餘項目會套用建議的預設值">其餘全部套用建議值</button>
      </section>
      <div class="start-bar"><button class="btn ghost" data-act="imp-step" data-n="1">上一步</button><button class="btn primary" data-act="imp-step" data-n="3">下一步</button></div>`;
    } else if (I.step === 3) {
      body = `
      <section class="block"><h3>匯入選項</h3>
        <label class="set-row"><span>標籤規則</span><select id="imp-tag"><option>檔名開頭數字 → #標籤</option><option>整個檔名 → 標籤</option></select></label>
        <label class="set-row"><span>同一個字已經在單字庫</span><select id="imp-dup"><option>合併（保留查詢次數）</option><option>另建一張</option><option>略過</option></select></label>
        <label class="set-row"><span>匯入後加入複習</span><select id="imp-star"><option>不要，我自己點星號</option><option>全部加星號</option></select></label>
      </section>
      <p class="muted small">匯入前會先自動備份目前資料。</p>
      <div class="start-bar"><button class="btn ghost" data-act="imp-step" data-n="2">上一步</button><button class="btn primary" data-act="imp-step" data-n="4">匯入 1,236 張卡</button></div>`;
    } else {
      body = `
      <section class="result-hero">${ic('check', 'done-ic')}<span class="result-n small-n">匯入完成</span>
        <span class="muted">新增 1,221 張卡 · 合併 15 張 · 建立 318 組易混淆</span></section>
      <div class="btn-col"><a class="btn primary" href="#/library">到單字庫看看</a><button class="btn ghost" data-act="imp-reset">重新走一次精靈</button></div>`;
    }
    return { title: '匯入 Word 單字簿', tab: 'more', back: '#/more', html: stepper(I.step) + body };
  }

  /* 匯出/匯入 JSON */
  function viewBackup() {
    const B = S.backup;
    return {
      title: '匯出 / 匯入 JSON', tab: 'more', back: '#/more',
      html: `
      <section class="block panel">
        <h3>${ic('download')} 匯出</h3>
        <label class="check"><input type="checkbox" id="bk-hist" checked> 包含查詢紀錄</label>
        <label class="check"><input type="checkbox" id="bk-rv" checked> 包含複習進度</label>
        ${B.exported ? `
          <div class="file-card">${ic('file')}<span><b>danciben-2026-09-29.json</b><br><span class="muted small">1,251 筆 · 412 KB</span></span></div>
          <button class="btn primary" data-act="fake" data-msg="手機：會開啟 Android 分享選單，選 Quick Share 傳到電腦">${ic('share')} 用 Quick Share 傳送</button>
          <p class="muted small">Windows 上會存到「下載」資料夾，再用 Quick Share for Windows 傳到手機。</p>`
        : '<button class="btn primary" data-act="bk-export">產生 JSON 檔</button>'}
      </section>
      <section class="block panel">
        <h3>${ic('upload')} 匯入</h3>
        ${!B.importPicked ? '<button class="btn ghost" data-act="bk-pick">選擇 JSON 檔</button><p class="muted small">Quick Share 收到的檔案通常在「下載」資料夾。</p>' : B.done ? '<p class="ok-txt">已匯入：新增 18 筆、更新 6 筆。</p><button class="btn ghost" data-act="bk-reset">再匯入一次</button>' : `
          <div class="file-card">${ic('file')}<span><b>danciben-2026-09-28.json</b><br><span class="muted small">來自 Windows · 昨天 22:14 匯出</span></span></div>
          <div class="stats three">
            <div><span class="stat-n tnum">18</span><span class="stat-l">新增</span></div>
            <div><span class="stat-n tnum">6</span><span class="stat-l">更新</span></div>
            <div><span class="stat-n tnum warn-txt">2</span><span class="stat-l">衝突</span></div>
          </div>
          <div class="conflict"><b lang="en">adopt</b><span class="muted small">本機：查 3 次、學習中 ／ 檔案：查 5 次、已熟記</span></div>
          <div class="conflict"><b lang="en">meticulous</b><span class="muted small">本機：有星號 ／ 檔案：沒有星號</span></div>
          <fieldset class="radios"><legend>衝突時</legend>
            ${[['merge', '合併（次數相加、保留較新的狀態）'], ['file', '以檔案為準'], ['local', '保留本機']].map(([v, t]) => `<label><input type="radio" name="bk-st" value="${v}" ${B.strategy === v ? 'checked' : ''} data-act="bk-strategy"> ${t}</label>`).join('')}
          </fieldset>
          <div class="start-bar"><button class="btn ghost" data-act="bk-reset">取消</button><button class="btn primary" data-act="bk-import">匯入</button></div>`}
      </section>`,
    };
  }

  /* 設定 */
  function viewSettings() {
    const st = S.settings;
    const sel = (id, key, opts) => `<select id="${id}" data-set="${key}">${opts.map(([v, t]) => `<option value="${v}" ${String(st[key]) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    return {
      title: '設定', tab: 'more', back: '#/more',
      html: `
      <section class="block panel"><h3>發音（系統語音）</h3>
        <label class="set-row"><span>口音</span>${sel('set-accent', 'accent', [['en-US', '美式'], ['en-GB', '英式']])}</label>
        <label class="set-row"><span>語速 <span class="muted tnum" id="rate-v">${st.rate.toFixed(1)}×</span></span><input id="set-rate" type="range" min="0.5" max="1.5" step="0.1" value="${st.rate}"></label>
        <label class="set-row"><span>查詢後自動唸出來</span><input id="set-auto" type="checkbox" class="switch" data-set="autoSpeak" ${st.autoSpeak ? 'checked' : ''}></label>
        <button class="btn small ghost" data-act="speak" data-text="The quick brown fox jumps over the lazy dog.">${ic('speaker')} 試聽</button>
      </section>
      <section class="block panel"><h3>查詢</h3>
        <label class="set-row"><span>字典來源</span>${sel('set-dict', 'dict', [['free', 'Free Dictionary API（英英）'], ['wiktionary', 'Wiktionary']])}</label>
        <label class="set-row"><span>翻譯服務</span>${sel('set-mt', 'mt', [['google', 'Google 翻譯（免費端點）'], ['mymemory', 'MyMemory'], ['libre', 'LibreTranslate']])}</label>
        <label class="set-row"><span>預設查詢模式</span>${sel('set-mode', 'defaultMode', [['word', '單字'], ['sentence', '句子']])}</label>
      </section>
      <section class="block panel"><h3>複習</h3>
        <label class="set-row"><span>每次題數</span>${sel('set-per', 'perSession', [[10, '10'], [20, '20'], [30, '30'], [50, '50']])}</label>
      </section>
      <section class="block panel"><h3>外觀</h3>
        <label class="set-row"><span>主題</span><select id="set-theme" disabled><option>淺色（深色之後再做）</option></select></label>
        <label class="set-row"><span>字級</span>${sel('set-font', 'fontSize', [['normal', '標準'], ['large', '大']])}</label>
      </section>
      <section class="block panel"><h3>資料</h3>
        <div class="set-row"><span>已使用空間</span><span class="muted tnum">2.4 MB</span></div>
        <button class="btn ghost" data-act="fake" data-msg="原型：不會真的清除">清除查詢紀錄</button>
        <button class="btn ghost danger" data-act="fake" data-msg="原型：不會真的清除">清除全部資料</button>
      </section>
      <p class="muted small center">單字本 0.1 · 畫面原型</p>`,
      after() {
        const r = document.getElementById('set-rate');
        r.addEventListener('input', () => { st.rate = parseFloat(r.value); document.getElementById('rate-v').textContent = st.rate.toFixed(1) + '×'; });
        document.querySelectorAll('[data-set]').forEach((el) => el.addEventListener('change', () => {
          const k = el.dataset.set;
          st[k] = el.type === 'checkbox' ? el.checked : el.value;
          if (k === 'fontSize') document.documentElement.dataset.font = st.fontSize;
          if (k === 'perSession') S.reviewSetup.count = Number(st.perSession);
          toast('已儲存');
        }));
      },
    };
  }

  function viewMissing() {
    return { title: '找不到', tab: 'search', back: '#/search', html: '<p class="empty">找不到這個項目。它可能是重新整理後被清掉的暫時資料。</p>' };
  }

  /* ---------- 路由 ---------- */
  const routes = [
    [/^search$/, viewSearch],
    [/^result\/(.+)$/, viewResult],
    [/^share$/, viewShare],
    [/^library$/, viewLibrary],
    [/^entry\/(.+)$/, viewEntry],
    [/^review$/, viewReviewHome],
    [/^review\/flash$/, viewFlash],
    [/^review\/cloze$/, viewCloze],
    [/^review\/listen$/, viewListen],
    [/^review\/result$/, viewReviewResult],
    [/^more$/, viewMore],
    [/^import$/, viewImport],
    [/^backup$/, viewBackup],
    [/^settings$/, viewSettings],
  ];

  let lastPath = null;
  function render() {
    const path = location.hash.replace(/^#\/?/, '') || 'search';
    let v = null;
    for (const [re, fn] of routes) {
      const m = path.match(re);
      if (m) { v = fn(...m.slice(1)); break; }
    }
    if (!v) { go('search'); return; }
    if (!v.html && !v.title) return; // 已轉址

    document.getElementById('view').innerHTML = v.html;
    const tb = document.getElementById('topbar');
    tb.innerHTML = `${v.back ? `<a class="icon-btn" href="${v.back}" aria-label="返回">${ic('back')}</a>` : '<span class="brand-sm">單字本</span>'}
      <h1 class="${v.hideTitle ? 'sr-only' : ''}">${esc(v.title)}</h1>`;
    document.title = `${v.title} · 單字本`;
    document.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === v.tab));
    document.body.classList.toggle('focus-mode', !!v.focus);
    if (path !== lastPath) { window.scrollTo(0, 0); lastPath = path; }
    if (v.after) v.after();
  }

  /* ---------- 點擊事件 ---------- */
  const actions = {
    star: (d) => toggleStar(d.id),
    speak: (d) => speak(d.text, d.rate ? parseFloat(d.rate) : null),
    query: (d) => { S.mode = d.mode || S.mode; runQuery(d.text, d.mode); },
    mode: (d) => { S.mode = d.mode; render(); document.getElementById('q')?.focus(); },
    clear: () => { S.draft = ''; render(); document.getElementById('q').focus(); },
    fake: (d) => toast(d.msg),
    'lib-filter': (d) => { S.lib.filter = d.f; render(); },
    'rv-set': (d) => { S.reviewSetup[d.k] = d.v; render(); },
    'rv-start': () => startReview(),
    'rv-retry': () => {
      const s = S.session;
      const bad = s.items.filter((x) => x.result !== 'ok').map((x) => ({ ...x, result: null }));
      S.session = { ...s, i: 0, flipped: false, picked: null, items: bad };
      go('review/' + s.mode);
    },
    flip: () => { S.session.flipped = !S.session.flipped; render(); },
    grade: (d) => { grade(['bad', 'fuzzy', 'ok'][d.g]); advance(); },
    pick: (d) => {
      const s = S.session; const it = s.items[s.i];
      s.picked = d.id;
      grade(d.id === it.id ? 'ok' : 'bad');
      render();
    },
    next: () => advance(),
    'imp-pick': () => { S.imp.files = true; render(); },
    'imp-step': (d) => { S.imp.step = Number(d.n); render(); window.scrollTo(0, 0); },
    'imp-resolve': (d) => { S.imp.resolved[d.id] = d.v; render(); },
    'imp-reset': () => { S.imp = { step: 1, files: false, resolved: {} }; render(); },
    'bk-export': () => { S.backup.exported = true; render(); toast('已產生 JSON 檔'); },
    'bk-pick': () => { S.backup.importPicked = true; render(); },
    'bk-strategy': (d, el) => { S.backup.strategy = el.value; },
    'bk-import': () => { S.backup.done = true; render(); toast('匯入完成'); },
    'bk-reset': () => { S.backup.importPicked = false; S.backup.done = false; render(); },
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const fn = actions[el.dataset.act];
    if (!fn) return;
    if (el.tagName !== 'INPUT') ev.preventDefault();
    fn(el.dataset, el);
  });

  window.addEventListener('hashchange', render);

  /* ---------- 啟動 ---------- */
  // 真正的 share_target 會以 ?text=... 開啟 App
  try {
    const params = new URLSearchParams(location.search);
    const shared = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join(' ').trim();
    if (shared) { S.shareText = shared; history.replaceState(null, '', location.pathname + '#/share'); }
  } catch (err) { /* 忽略 */ }

  // 從 artifact 連結只能帶 #anchor（沒有斜線），也接受
  if (/^#[a-z]/.test(location.hash)) location.hash = '#/' + location.hash.slice(1);

  render();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 預覽環境不支援，沒關係 */ });
  }
})();
