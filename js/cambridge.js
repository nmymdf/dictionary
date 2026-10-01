// 劍橋英漢字典（繁體）：抓網頁、整理成「詞性 → 意思 → 例句」
// 劍橋沒有開放跨網站讀取，所以要靠 App 本身代抓（Android：AndroidApp；Windows：DesktopApp）。
(function () {
  'use strict';

  const BASE = 'https://dictionary.cambridge.org';
  const DICT = BASE + '/dictionary/english-chinese-traditional/';

  /* ---------- 透過 App 抓網頁 ---------- */
  let seq = 0;
  const waiting = {};
  window.__nativeFetchDone = (id, status, url, text) => {
    const w = waiting[id];
    if (!w) return;
    delete waiting[id];
    if (status >= 200 && status < 400) w.resolve({ status, url, text });
    else w.reject(new Error(status ? 'HTTP ' + status : '連不上劍橋字典'));
  };

  function canFetch() {
    return !!((window.DesktopApp && window.DesktopApp.fetchText) || (window.AndroidApp && window.AndroidApp.fetchText));
  }

  function nativeFetch(url, ms = 15000) {
    if (window.DesktopApp && window.DesktopApp.fetchText) {
      return Promise.race([
        window.DesktopApp.fetchText(url).then((r) => {
          if (!r || r.status < 200 || r.status >= 400) throw new Error(r && r.status ? 'HTTP ' + r.status : '連不上劍橋字典' + (r && r.error ? '（' + r.error + '）' : ''));
          return r;
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('劍橋字典沒有回應')), ms)),
      ]);
    }
    if (window.AndroidApp && window.AndroidApp.fetchText) {
      return new Promise((resolve, reject) => {
        const id = 'f' + (++seq);
        waiting[id] = { resolve, reject };
        setTimeout(() => { if (waiting[id]) { delete waiting[id]; reject(new Error('劍橋字典沒有回應')); } }, ms);
        window.AndroidApp.fetchText(id, url);
      });
    }
    return Promise.reject(new Error('這個版本不能連劍橋字典'));
  }

  /* ---------- 解析 ---------- */
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const zhFix = (s) => s.replace(/\s*;\s*/g, '；').replace(/\s*,\s*/g, '，');
  const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

  function pron(head, cls) {
    const n = head.querySelector(`.${cls}.dpron-i`);
    if (!n) return null;
    const src = n.querySelector('source[type="audio/mpeg"]');
    const ipa = txt(n.querySelector('.ipa'));
    if (!ipa && !src) return null;
    return { ipa: ipa ? '/' + ipa + '/' : '', audio: src ? BASE + src.getAttribute('src') : '' };
  }

  function examplesOf(block) {
    const out = [];
    block.querySelectorAll('.def-body .examp').forEach((x) => {
      const en = txt(x.querySelector('.eg'));
      if (en) out.push({ en, zh: zhFix(txt(x.querySelector('.trans'))) });
    });
    return out;
  }

  function defBlock(b) {
    const level = txt(b.querySelector('.def-info .epp-xref'));
    const labels = uniq([...b.querySelectorAll('.def-info .lab, .def-info .usage, .def-info .gram')].map(txt))
      .map((s) => s.replace(/^\[\s*|\s*\]$/g, ''));
    const body = b.querySelector('.def-body');
    const zhEl = body && [...body.children].find((c) => c.classList.contains('trans'));
    return {
      level: LEVELS.includes(level) ? level : '',
      labels,
      def: txt(b.querySelector('.def')).replace(/[:：]\s*$/, ''),
      zh: zhFix(txt(zhEl)),
      examples: examplesOf(b),
    };
  }

  function parse(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const els = [...doc.querySelectorAll('.entry-body__el')];
    if (!els.length) return null;
    const entries = els.map((el) => {
      const head = el.querySelector('.pos-header') || el;
      const senses = [];
      const phrases = [];
      el.querySelectorAll('.def-block').forEach((b) => {
        const d = defBlock(b);
        if (!d.def && !d.zh) return;
        const ph = b.closest('.phrase-block');
        if (ph) {
          d.phrase = txt(ph.querySelector('.phrase-title'));
          phrases.push(d);
        } else {
          const sense = b.closest('.dsense');
          d.gw = sense ? txt(sense.querySelector('.dsense_gw')).replace(/^\(|\)$/g, '') : '';
          senses.push(d);
        }
      });
      return {
        hw: txt(el.querySelector('.di-title .headword')) || txt(head.querySelector('.hw')) || txt(head.querySelector('.headword')),
        pos: uniq([...head.querySelectorAll('.posgram .pos, .dpos')].map(txt)).slice(0, 1),
        gram: txt(head.querySelector('.posgram .gram')).replace(/^\[\s*|\s*\]$/g, ''),
        uk: pron(head, 'uk'),
        us: pron(head, 'us'),
        infl: txt(el.querySelector('.irreg-infls')),
        senses,
        phrases,
      };
    }).filter((e) => e.senses.length || e.phrases.length);
    if (!entries.length) return null;
    // 同一個字、同詞性的重複區塊合併（劍橋有時會把片語動詞拆成好幾塊）
    const merged = [];
    entries.forEach((e) => {
      const same = merged.find((m) => m.hw === e.hw && m.pos.join() === e.pos.join());
      if (same) { same.senses.push(...e.senses); same.phrases.push(...e.phrases); same.uk = same.uk || e.uk; same.us = same.us || e.us; same.infl = same.infl || e.infl; }
      else merged.push(e);
    });
    const first = merged[0];
    const pick = (k) => (merged.find((e) => e[k]) || {})[k] || null;
    return {
      source: 'cambridge',
      word: first.hw,
      uk: pick('uk'),
      us: pick('us'),
      infl: pick('infl') || '',
      entries: merged,
    };
  }

  async function lookup(word) {
    const slug = word.trim().toLowerCase().replace(/\s+/g, '-');
    const r = await nativeFetch(DICT + encodeURIComponent(slug));
    // 找不到的字，劍橋會轉回字典首頁
    let data = /\/dictionary\/english-chinese-traditional\/[^/?#]+/.test(r.url || DICT + slug) ? parse(r.text) : null;
    if (!data) {
      const s = await nativeFetch(BASE + '/search/direct/?datasetsearch=english-chinese-traditional&q=' + encodeURIComponent(word.trim()));
      data = /\/dictionary\/english-chinese-traditional\/[^/?#]+/.test(s.url || '') ? parse(s.text) : null;
    }
    if (data) data.url = DICT + encodeURIComponent(slug);
    return data;
  }

  window.Cambridge = { canFetch, lookup, parse, DICT };
})();
