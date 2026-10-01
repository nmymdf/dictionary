// 線上查詢：免費字典與翻譯服務（需要連網）
// - 單字：Google 翻譯免費端點（中文意思、詞性、例句）+ Free Dictionary API（音標、英英例句）
// - 句子：Google 翻譯免費端點，失敗時改用 MyMemory
(function () {
  'use strict';

  const GTX = 'https://translate.googleapis.com/translate_a/single';
  const POS = {
    noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.', preposition: 'prep.', conjunction: 'conj.',
    pronoun: 'pron.', interjection: 'int.', abbreviation: 'abbr.', phrase: 'phr.', prefix: 'prefix', suffix: 'suffix',
    '名詞': 'n.', '動詞': 'v.', '形容詞': 'adj.', '副詞': 'adv.', '介詞': 'prep.', '連詞': 'conj.', '代詞': 'pron.', '感嘆詞': 'int.',
  };

  function timeout(ms) {
    const c = new AbortController();
    setTimeout(() => c.abort(), ms);
    return c.signal;
  }

  async function getJSON(url) {
    const res = await fetch(url, { signal: timeout(10000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function gtxUrl(q, dts) {
    const p = new URLSearchParams({ client: 'gtx', sl: 'en', tl: 'zh-TW', q });
    let url = GTX + '?' + p.toString();
    dts.forEach((d) => { url += '&dt=' + d; });
    return url;
  }

  const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '');

  // 翻譯一段或多段文字（多段用換行分隔，一次送出）
  async function translate(text) {
    try {
      const data = await getJSON(gtxUrl(text, ['t']));
      return (data[0] || []).map((seg) => seg[0] || '').join('').trim();
    } catch (err) {
      const url = 'https://api.mymemory.translated.net/get?' + new URLSearchParams({ q: text, langpair: 'en|zh-TW' });
      const data = await getJSON(url);
      const t = data && data.responseData && data.responseData.translatedText;
      if (!t) throw err;
      return t;
    }
  }

  async function translateMany(lines) {
    if (!lines.length) return [];
    try {
      const out = (await translate(lines.join('\n'))).split('\n');
      if (out.length === lines.length) return out.map((s) => s.trim());
    } catch (err) { /* 改成逐句 */ }
    return Promise.all(lines.map((l) => translate(l).catch(() => '')));
  }

  async function dictApi(word) {
    try {
      const data = await getJSON('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word));
      const e = Array.isArray(data) ? data[0] : null;
      if (!e) return null;
      const phon = e.phonetic || (e.phonetics || []).map((p) => p.text).find(Boolean) || '';
      const examples = [];
      (e.meanings || []).forEach((m) => (m.definitions || []).forEach((d) => { if (d.example) examples.push(d.example); }));
      return { ipa: phon, examples };
    } catch (err) {
      return null;
    }
  }

  async function lookupWord(word) {
    const w = word.trim();
    const [g, d] = await Promise.all([
      getJSON(gtxUrl(w, ['t', 'bd', 'ex', 'rm'])).catch((err) => ({ error: err })),
      dictApi(w),
    ]);
    if (g.error && !d) throw g.error;

    const senses = [];
    let examples = [];
    let ipa = (d && d.ipa) || '';
    if (!g.error) {
      // [1]：字典（詞性 + 中文詞）
      (g[1] || []).forEach((row) => {
        const pos = POS[row[0]] || row[0] || '';
        const terms = (row[1] || []).slice(0, 5);
        if (terms.length) senses.push({ pos, zh: terms.join('；') });
      });
      if (!senses.length) {
        const t = (g[0] || []).map((s) => s[0] || '').join('').trim();
        if (t) senses.push({ pos: '', zh: t });
      }
      // [13]：例句
      const ex = g[13] && g[13][0];
      if (Array.isArray(ex)) examples = ex.slice(0, 3).map((x) => stripTags(x[0]));
      // [0] 最後一段的 [3]：讀音（沒有音標時備用）
      if (!ipa) {
        const last = (g[0] || [])[g[0].length - 1];
        if (last && last[3]) ipa = '/' + last[3] + '/';
      }
    }
    if (examples.length < 2 && d && d.examples.length) {
      d.examples.forEach((x) => { if (examples.length < 3 && !examples.includes(x)) examples.push(x); });
    }
    if (ipa && !ipa.startsWith('/') && !ipa.startsWith('[')) ipa = '/' + ipa + '/';
    let zhs = [];
    try { zhs = await translateMany(examples); } catch (err) { zhs = []; }
    return {
      ipa,
      senses: senses.length ? senses : [{ pos: '', zh: '（查不到中文意思）' }],
      examples: examples.map((en, i) => ({ en, zh: zhs[i] || '' })),
    };
  }

  async function ipaOnly(word) {
    const d = await dictApi(word);
    return d && d.ipa ? (d.ipa.startsWith('/') || d.ipa.startsWith('[') ? d.ipa : '/' + d.ipa + '/') : '';
  }

  // 中查英：英文翻譯 + 字典（每個英文字附反查的中文，方便挑對的字）
  async function lookupZh(q) {
    const url = GTX + '?' + new URLSearchParams({ client: 'gtx', sl: 'zh-TW', tl: 'en', hl: 'zh-TW', q }).toString() + '&dt=t&dt=bd';
    let g;
    try {
      g = await getJSON(url);
    } catch (err) {
      const data = await getJSON('https://api.mymemory.translated.net/get?' + new URLSearchParams({ q, langpair: 'zh-TW|en' }));
      const t = data && data.responseData && data.responseData.translatedText;
      if (!t) throw err;
      return { en: t, groups: [] };
    }
    const en = (g[0] || []).map((seg) => seg[0] || '').join('').trim();
    const groups = (g[1] || []).map((row) => ({
      pos: POS[row[0]] || row[0] || '',
      words: (row[2] || []).slice(0, 8).map((x) => ({ en: x[0], zh: (x[1] || []).slice(0, 4).join('、') })),
    })).filter((gr) => gr.words.length);
    return { en, groups };
  }

  window.Lookup = { word: lookupWord, sentence: translate, ipa: ipaOnly, translateMany, zh: lookupZh };
})();
