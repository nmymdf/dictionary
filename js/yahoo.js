// Yahoo 字典（牛津中文字典）：英查中、中查英
// 網頁不能跨網站讀取，所以要靠 App 本身代抓（Android：AndroidApp；Windows：DesktopApp）。
(function () {
  'use strict';

  const SEARCH = 'https://tw.dictionary.search.yahoo.com/search?p=';

  /* ---------- 透過 App 抓網頁 ---------- */
  let seq = 0;
  const waiting = {};
  window.__nativeFetchDone = (id, status, url, text) => {
    const w = waiting[id];
    if (!w) return;
    delete waiting[id];
    if (status >= 200 && status < 400) w.resolve({ status, url, text });
    else w.reject(new Error(status ? 'HTTP ' + status : '連不上 Yahoo 字典'));
  };

  function canFetch() {
    return !!((window.DesktopApp && window.DesktopApp.fetchText) || (window.AndroidApp && window.AndroidApp.fetchText));
  }

  function nativeFetch(url, ms = 9000) {
    if (window.DesktopApp && window.DesktopApp.fetchText) {
      return Promise.race([
        window.DesktopApp.fetchText(url).then((r) => {
          if (!r || r.status < 200 || r.status >= 400) throw new Error(r && r.status ? 'HTTP ' + r.status : '連不上 Yahoo 字典' + (r && r.error ? '（' + r.error + '）' : ''));
          return r;
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Yahoo 字典沒有回應')), ms)),
      ]);
    }
    if (window.AndroidApp && window.AndroidApp.fetchText) {
      return new Promise((resolve, reject) => {
        const id = 'f' + (++seq);
        waiting[id] = { resolve, reject };
        setTimeout(() => { if (waiting[id]) { delete waiting[id]; reject(new Error('Yahoo 字典沒有回應')); } }, ms);
        window.AndroidApp.fetchText(id, url);
      });
    }
    // 一般瀏覽器（例如單一 HTML 檔）會被跨網站限制擋住，還是試試看
    return fetch(url).then(async (r) => ({ status: r.status, url: r.url, text: await r.text() }));
  }

  /* ---------- 解析 ---------- */
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const CJK = /[㐀-鿿（-？、-】]/;
  const POS_NAME = { 'n.': '名詞', 'v.': '動詞', 'vt.': '及物動詞', 'vi.': '不及物動詞', 'a.': '形容詞', 'adj.': '形容詞', 'ad.': '副詞', 'adv.': '副詞', 'prep.': '介系詞', 'conj.': '連接詞', 'pron.': '代名詞', 'int.': '感嘆詞', 'phr.': '片語', 'abbr.': '縮寫' };

  // 例句：英文在前、中文在後（英查中）；中文在前、英文在後（中查英）
  function splitExample(s, zhFirst) {
    s = s.replace(/\s+/g, ' ').trim();
    if (zhFirst) {
      const m = s.match(/^(.*?[㐀-鿿。！？，、；：」）]\s*)([A-Za-z"'(“‘].*)$/);
      return m ? { zh: m[1].trim(), en: m[2].trim() } : { zh: s, en: '' };
    }
    const i = s.search(CJK);
    if (i <= 0) return { en: s, zh: '' };
    // 中文前面如果有括號開頭的說明，一起算中文
    return { en: s.slice(0, i).trim(), zh: s.slice(i).trim() };
  }

  function parse(html, query) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const card = doc.querySelector('.dictionaryWordCard');
    const tab = doc.querySelector('.tab-content-explanation');
    if (!card && !tab) return null;
    const zhQuery = CJK.test(query || '');
    const word = card ? txt(card.querySelector('.grp-main .compTitle .title')) : query;
    let source = card ? txt(card.querySelector('.fc-source')) : '';
    if (!source || /提供建議/.test(source)) source = 'Yahoo AI 字典（僅供參考）';
    // 音標：IPA[...]、KK[...]、DJ[...]
    let ipa = '';
    if (card) {
      card.querySelectorAll('.compList li span').forEach((s) => {
        const t = txt(s);
        const m = t.match(/^(?:IPA|KK)\s*\[(.+)\]$/);
        if (m && !ipa) ipa = '/' + m[1].replace(/^\/+|\/+$/g, '') + '/';
      });
    }
    // 一眼看懂（每個詞性一行）
    const gist = [];
    if (card) {
      card.querySelectorAll('.compList li').forEach((li) => {
        const pos = txt(li.querySelector('.pos_button'));
        const zh = txt(li.querySelector('.dictionaryExplanation'));
        if (zh) gist.push({ pos, zh });
      });
    }
    // 字的變化：名詞複數、過去式…
    const infl = [];
    if (card) card.querySelectorAll('.compArticleList li h4').forEach((h) => { const t = txt(h); if (t) infl.push(t.replace(/\s*：\s*/, '：')); });
    // 釋義：詞性 → 意思 → 例句
    const entries = [];
    if (tab) {
      let cur = null;
      [...tab.children].forEach((el) => {
        if (el.classList.contains('compTitle')) {
          const pos = txt(el.querySelector('.pos_button'));
          const name = txt(el.querySelector('.title'));
          cur = { pos, posName: name || POS_NAME[pos] || pos, senses: [] };
          entries.push(cur);
        } else if (el.classList.contains('compTextList')) {
          if (!cur) { cur = { pos: '', posName: '', senses: [] }; entries.push(cur); }
          el.querySelectorAll('li').forEach((li) => {
            const spans = [...li.querySelectorAll(':scope > span')];
            const main = spans.find((s) => s.classList.contains('d-i'));
            const exs = spans.filter((s) => s.classList.contains('d-b') && !s.classList.contains('fw-xl'));
            const sense = { text: txt(main), examples: exs.map((s) => splitExample(txt(s), zhQuery)).filter((x) => x.en || x.zh) };
            if (sense.text || sense.examples.length) cur.senses.push(sense);
          });
        }
      });
    }
    // 同義、反義
    const syn = [];
    const st = doc.querySelector('.tab-content-synonyms');
    if (st) {
      let kind = '同義詞';
      let label = '';
      [...st.children].forEach((el) => {
        if (el.classList.contains('compTitle')) {
          const t = txt(el);
          if (/^(同義詞|反義詞)$/.test(t)) kind = t; else label = t.replace(/^\d+\.\s*/, '');
        } else if (el.classList.contains('compDlink')) {
          const words = [...el.querySelectorAll('a')].map(txt).filter(Boolean);
          if (words.length) syn.push({ kind, label, words: words.slice(0, 8) });
        }
      });
    }
    const out = { source: 'yahoo', dict: source, word: word || query, zhQuery, ipa, gist, infl, entries: entries.filter((e) => e.senses.length), syn };
    if (!out.gist.length && !out.entries.length) return null;
    return out;
  }

  async function lookup(q) {
    const r = await nativeFetch(SEARCH + encodeURIComponent(q.trim()));
    return parse(r.text, q.trim());
  }

  window.Yahoo = { canFetch, lookup, parse, SEARCH };
})();
