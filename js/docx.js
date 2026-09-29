// 在 App 裡解析 Word 單字簿（.docx)，給「匯入精靈」用。
// 支援三種寫法：
//   1. 單字筆記：單字行 → 詞性 中文 → 例：英文 / 譯：中文
//   2. 表格：有「單字 / 詞性 / 音標 / 中文 / 例句」欄位
//   3. 英中對照句子（一行英文、一行中文），可以有日期行
(function () {
  'use strict';
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const POS_RE = /^((?:n|v|vt|vi|a|adj|adv|prep|conj|pron|int|phr|aux)\.(?:\s*\/\s*(?:n|v|vt|vi|a|adj|adv|prep|conj|pron|int|phr)\.)*)\s*(.*)$/i;
  const HAS_ZH = /[一-鿿]/;
  const IPA_RE = /\/[^/]*[ˈˌəɪʊæɑɔʌɛɝɚθðʃʒŋː][^/]*\//g;

  async function readDocx(file) {
    const zip = await JSZip.loadAsync(file);
    const xml = await zip.file('word/document.xml').async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const body = doc.getElementsByTagNameNS(W, 'body')[0];
    const out = [];
    const text = (el) => Array.from(el.getElementsByTagNameNS(W, 't')).map((t) => t.textContent).join('');
    Array.from(body.children).forEach((el) => {
      if (el.localName === 'p') out.push({ p: text(el).replace(/ /g, ' ').trim() });
      else if (el.localName === 'tbl') {
        Array.from(el.getElementsByTagNameNS(W, 'tr')).forEach((tr) => {
          out.push({ row: Array.from(tr.getElementsByTagNameNS(W, 'tc')).map((tc) => text(tc).trim()) });
        });
      }
    });
    return out.filter((x) => x.row || x.p);
  }

  const cleanPos = (p) => p.replace(/\ba\./g, 'adj.').replace(/\s+/g, '');

  function parseTable(rows, tag) {
    const head = rows[0].row.map((h) => h.toLowerCase());
    const col = (re) => head.findIndex((h) => re.test(h));
    const ci = { w: col(/單字|word/), pos: col(/詞性|pos/), ipa: col(/音標|ipa/), zh: col(/中文|meaning|解/), ex: col(/例句|example/) };
    return rows.slice(1).map((r) => r.row).filter((r) => r[ci.w]).map((r) => ({
      type: 'word', text: r[ci.w], ipa: ci.ipa >= 0 ? r[ci.ipa] : '',
      senses: [{ pos: ci.pos >= 0 ? cleanPos(r[ci.pos]) : '', zh: ci.zh >= 0 ? r[ci.zh] : '' }],
      examples: ci.ex >= 0 && r[ci.ex] ? [{ en: r[ci.ex], zh: '' }] : [],
      tags: [tag], src: 'import',
    }));
  }

  function parseSentences(lines, tag) {
    const out = []; let date = '';
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(l)) { date = l; continue; }
      if (!HAS_ZH.test(l) && /[A-Za-z]/.test(l) && lines[i + 1] && HAS_ZH.test(lines[i + 1])) {
        out.push({ type: 'sentence', text: l, zh: lines[i + 1], date, tags: [tag], src: 'import' });
        i++;
      }
    }
    return out;
  }

  function parseNotes(lines, tag) {
    const cards = []; const issues = []; const groups = [];
    let block = null;
    const flush = () => {
      if (!block) return;
      const words = block.words;
      words.forEach((w) => {
        const senses = block.senses.filter((s) => !s.w || s.w === w).map(({ pos, zh }) => ({ pos, zh }));
        const exs = block.examples.filter((x) => words.length === 1 || new RegExp('\\b' + w.slice(0, Math.max(3, w.length - 2)), 'i').test(x.en));
        cards.push({ type: 'word', text: w, ipa: words.length === 1 ? block.ipa : '', senses: senses.length ? senses : (words.length === 1 ? block.senses : []), examples: exs, notes: block.notes, tags: [tag], src: 'import' });
        if (!senses.length && !(words.length === 1 && block.senses.length)) issues.push({ word: w, kind: '缺少中文意思', text: block.head });
      });
      if (words.length > 1) groups.push(words);
      block = null;
    };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^例[:：]/.test(l)) {
        let en = l.replace(/^例[:：]\s*/, '');
        while (lines[i + 1] && !/^(譯|例)[:：]/.test(lines[i + 1]) && !HAS_ZH.test(lines[i + 1]) && /^[a-z]/.test(lines[i + 1])) en += ' ' + lines[++i];
        let zh = '';
        if (lines[i + 1] && /^譯[:：]/.test(lines[i + 1])) zh = lines[++i].replace(/^譯[:：]\s*/, '');
        if (block) block.examples.push({ en, zh });
        continue;
      }
      if (/^(相關|注意|同義|反義|補充|比較)[:：]/.test(l)) { if (block) block.notes.push(l); continue; }
      const pm = l.match(POS_RE);
      if (pm && block) { block.senses.push({ pos: cleanPos(pm[1]), zh: pm[2] }); continue; }
      // 「word pos 中文 word pos 中文」同一行多個字
      const multi = [...l.matchAll(/([A-Za-z][A-Za-z' -]*?)\s+((?:n|v|a|adj|adv|prep|phr)\.(?:\/(?:n|v|a|adj|adv)\.)*)\s*([^A-Za-z]+)/g)];
      if (block && multi.length && HAS_ZH.test(l)) {
        multi.forEach((m) => block.senses.push({ w: m[1].trim().toLowerCase(), pos: cleanPos(m[2]), zh: m[3].trim() }));
        continue;
      }
      if (/^[A-Za-z]/.test(l)) {
        flush();
        const ipa = (l.match(IPA_RE) || [])[0] || '';
        const head = l.replace(IPA_RE, ' ').split(/\s{2,}|["“]/)[0];
        const words = head.split('/').map((w) => w.trim().toLowerCase()).filter((w) => /^[a-z][a-z' -]*$/.test(w));
        if (!words.length) { issues.push({ word: l.slice(0, 30), kind: '無法辨識', text: l }); continue; }
        block = { head: l, words, ipa, senses: [], examples: [], notes: [] };
        continue;
      }
      if (block && HAS_ZH.test(l)) { block.senses.push({ pos: '', zh: l }); continue; }
      issues.push({ word: l.slice(0, 30), kind: '無法辨識', text: l });
    }
    flush();
    return { cards, issues, groups };
  }

  async function parseFile(file) {
    const tag = file.name.replace(/\.docx$/i, '').replace(/_black_bg$/, '');
    const items = await readDocx(file);
    const rows = items.filter((x) => x.row);
    const lines = items.filter((x) => x.p).map((x) => x.p);
    if (rows.length > 3) return { tag, cards: parseTable(rows, tag), issues: [], groups: [] };
    const exCount = lines.filter((l) => /^例[:：]/.test(l)).length;
    if (exCount < 3) return { tag, cards: parseSentences(lines, tag), issues: [], groups: [] };
    return { tag, ...parseNotes(lines, tag) };
  }

  window.Docx = { parseFile };
})();
