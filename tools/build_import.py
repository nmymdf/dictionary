#!/usr/bin/env python3
"""把整理好的單字卡(cards/*.txt)和 TP 對話句子,組成 App 可以匯入的 JSON。

用法:
  python3 tools/build_import.py <raw_dir> <cards_dir> <out.json> [report.md]

raw_dir   每個 Word 檔轉成的純文字,一行一段,格式「行號<TAB>內容」
cards_dir 手工整理的單字卡,格式見下方 parse_cards()
這個程式不含任何單字資料;資料放在私人 repo。
"""
import json, re, sys, time, glob, os

HAS_ZH = re.compile(r'[一-鿿]')
USAGE = {'d': 'daily', 'f': 'formal', 'r': 'rare'}
FAM_RE = re.compile(r"^([A-Za-z][A-Za-z'’ -]*?)\s+((?:[a-z]+\.)(?:\s*/\s*[a-z]+\.)*)\s*(.*)$")


def js_hash(s):
    h = 5381
    for ch in s:
        h = ((h << 5) + h + ord(ch)) & 0xFFFFFFFF
    digits = '0123456789abcdefghijklmnopqrstuvwxyz'
    if h == 0:
        return '0'
    out = ''
    while h:
        h, r = divmod(h, 36)
        out = digits[r] + out
    return out


def norm_text(t):
    return re.sub(r'\s+', ' ', str(t or '').replace(' ', ' ')).strip()


def make_id(kind, text):
    t = norm_text(text).lower()
    if kind == 'word':
        return 'w:' + t
    return 's:' + js_hash(re.sub(r'[^a-z0-9]+', ' ', t).strip())


def load_raw(raw_dir):
    raw = {}
    for f in glob.glob(os.path.join(raw_dir, '*.txt')):
        name = os.path.basename(f)[:-4]
        lines = {}
        for l in open(f, encoding='utf-8'):
            n, _, text = l.rstrip('\n').partition('\t')
            lines[int(n)] = text.replace(' ', ' ').strip()
        raw[name] = lines
    return raw


def clean_en(s):
    s = re.split(r'\s{3,}', s.strip())[0]
    return norm_text(s)


def clean_zh(s):
    s = s.strip()
    m = re.match(r'^(.*?[一-鿿。！？…）」]+)\s{1,}[A-Za-z"“].*$', s)
    if m:
        s = m.group(1)
    return norm_text(s)


def example_at(lines, n):
    """從「例:」那一行開始,接上斷行,再配對下一行的「譯:」"""
    text = lines.get(n, '')
    en = re.sub(r'^例[:：]\s*', '', text)
    i = n
    while (i + 1) in lines:
        nxt = lines[i + 1]
        if re.match(r'^(譯|例)[:：]', nxt) or HAS_ZH.search(nxt) or re.search(r'[.?!…"”]$', en.strip()):
            break
        en += ' ' + nxt
        i += 1
    zh = ''
    if (i + 1) in lines and re.match(r'^譯[:：]', lines[i + 1]):
        zh = re.sub(r'^譯[:：]\s*', '', lines[i + 1])
    return {'en': clean_en(en), 'zh': clean_zh(zh)}


def parse_cards(path, lines, tag, order_start):
    """
    # <行號> [@ 分組說明]   開始一個區塊(區塊裡超過一個字 = 同組易混淆)
    word | senses | ex | u | infl | fam | easyEN = easyZH | fix
    """
    blocks = []
    cur = None
    for raw_line in open(path, encoding='utf-8'):
        line = raw_line.rstrip('\n')
        if not line.strip() or line.startswith('//'):
            continue
        if line.startswith('#'):
            m = re.match(r'^#\s*(\d+)\s*(?:@\s*(.*))?$', line)
            cur = {'line': int(m.group(1)) if m else 0, 'note': (m.group(2) or '').strip() if m else '', 'cards': []}
            blocks.append(cur)
            continue
        if line.startswith('@') and cur is not None:
            cur['note'] = line[1:].strip()
            continue
        parts = [p.strip() for p in line.split(' | ')]
        if len(parts) < 8:
            parts += ['-'] * (8 - len(parts))
        if cur is None:
            cur = {'line': 0, 'note': '', 'cards': []}
            blocks.append(cur)
        cur['cards'].append(parts)

    # 區塊範圍:從區塊標題行到下一個區塊之前
    starts = sorted(b['line'] for b in blocks if b['line'])
    entries = []
    groups = []
    order = order_start
    for b in blocks:
        nxt = [s for s in starts if s > b['line']]
        end = nxt[0] - 1 if nxt else (max(lines) if lines else 0)
        notes = []
        if b['line']:
            for n in range(b['line'], end + 1):
                t = lines.get(n, '')
                if re.match(r'^(相關|注意|同義|反義|補充|比較)[:：]', t):
                    notes.append(norm_text(t))
        supplement = tag.startswith('_')
        ids = []
        for word, senses, ex, u, infl, fam, easy, fix in b['cards']:
            word = norm_text(word)
            ipa = ''
            m = re.search(r'\s*(/[^/]+/|\[[^\]]+\])\s*$', word)
            if m:
                ipa = m.group(1)
                word = word[:m.start()].strip()
            sense_list = []
            pieces = []
            for p in senses.split(' / ') if senses not in ('', '-') else []:
                if pieces and not re.match(r'^(?:[a-z]+\.|phr\b)', p.strip()):
                    pieces[-1] += ' / ' + p   # 括號裡的斜線，不是新的意思
                else:
                    pieces.append(p)
            for s in pieces:
                s = s.strip()
                mm = re.match(r'^((?:[a-z]+\.)(?:\s*/\s*[a-z]+\.)*)\s*(.*)$', s)
                if mm:
                    pos, zh = mm.group(1).replace(' ', ''), mm.group(2)
                else:
                    pos, zh = '', s
                u_sense = None
                us = re.search(r'\s*\{([dfr])\}\s*$', zh)
                if us:
                    u_sense = USAGE[us.group(1)]
                    zh = zh[:us.start()]
                item = {'pos': pos, 'zh': zh.strip()}
                if u_sense:
                    item['u'] = u_sense
                sense_list.append(item)
            examples = []
            if easy not in ('', '-') and ' = ' in easy:
                en, zh = easy.split(' = ', 1)
                examples.append({'en': en.strip(), 'zh': zh.strip(), 'easy': True})
            for item in ex.split(' ;; ') if ex not in ('', '-') else []:
                item = item.strip()
                for piece in (item.split(',') if re.fullmatch(r'[\d,\s]+', item) else [item]):
                    piece = piece.strip()
                    if not piece:
                        continue
                    if piece.isdigit():
                        x = example_at(lines, int(piece))
                        if x['en']:
                            examples.append(x)
                    elif ' = ' in piece:
                        en, zh = piece.split(' = ', 1)
                        examples.append({'en': en.strip(), 'zh': zh.strip()})
            forms = None
            fam_list = []
            for f in fam.split(' + ') if fam not in ('', '-') else []:
                mm = FAM_RE.match(f.strip())
                if mm:
                    fam_list.append({'w': mm.group(1).strip(), 'pos': mm.group(2).replace(' ', ''), 'zh': mm.group(3).strip()})
                else:
                    fam_list.append({'w': f.strip(), 'pos': '', 'zh': ''})
            if infl not in ('', '-') or fam_list:
                forms = {'infl': '' if infl in ('', '-') else infl, 'fam': fam_list}
            fixes = [x.strip() for x in fix.split(' ;; ')] if fix not in ('', '-') else []
            order += 1
            e = {
                'id': make_id('word', word), 'type': 'word', 'text': word,
                'ipa': ipa, 'senses': sense_list, 'examples': examples, 'forms': forms,
                'notes': list(notes), 'usage': USAGE.get(u.strip()) if u.strip() in USAGE else None,
                'tags': [] if supplement else [tag], 'fixes': fixes, 'starred': True, 'src': 'import', 'order': order + (100000 if supplement else 0),
            }
            entries.append(e)
            ids.append(e['id'])
        if len(ids) > 1 and not supplement:
            uniq = list(dict.fromkeys(ids))
            if len(uniq) > 1:
                groups.append({'id': 'g:%s:%d' % (tag, b['line']), 'name': ' / '.join(i[2:] for i in uniq), 'note': b['note'], 'members': uniq})
                for e in entries[-len(ids):]:
                    e['group'] = groups[-1]['id']
    return entries, groups, order


def parse_tp(lines, tag, order_start):
    """英文一行(可能斷成好幾行)+ 中文一行(可能斷行)配成一句;中英混在同一行的筆記不匯入。"""
    out, skipped = [], []
    order = order_start
    date = ''
    buf = []          # 還沒配對的英文句子
    ns = sorted(lines)
    i = 0
    ends = re.compile(r'[.?!…:"”)\]]$')
    while i < len(ns):
        t = norm_text(lines[ns[i]])
        i += 1
        if re.match(r'^\d{4}/\d{1,2}/\d{1,2}$', t):
            skipped += buf
            buf, date = [], t
            continue
        if not HAS_ZH.search(t):
            if buf and not ends.search(buf[-1]) and t[:1].islower():
                buf[-1] += ' ' + t
            elif buf and not ends.search(buf[-1]) and len(buf[-1]) > 55:
                buf[-1] += ' ' + t
            else:
                buf.append(t)
            continue
        zh_ratio = len(re.findall(r'[\u4e00-\u9fff]', t)) / max(1, len(re.sub(r'\s', '', t)))
        if HAS_ZH.match(t[:1]) or t[:1] in '「（(“"…' or (buf and zh_ratio > 0.5 and '（' not in t and '：' not in t):
            if not buf:
                skipped.append(t)
                continue
            zh = t
            while i < len(ns) and HAS_ZH.match(norm_text(lines[ns[i]])[:1] or 'x') and not re.search(r'[。？！…」]$', zh):
                zh += norm_text(lines[ns[i]])
                i += 1
            skipped += buf[:-1]
            en = buf[-1]
            buf = []
            order += 1
            out.append({'id': make_id('sentence', en), 'type': 'sentence', 'text': en, 'zh': zh, 'date': date,
                        'tags': [tag], 'starred': False, 'src': 'import', 'order': order})
            continue
        skipped += buf + [t]
        buf = []
    skipped += buf
    return out, order, skipped


def merge(entries, groups):
    by = {}
    parent = {}

    def find(g):
        while parent.get(g, g) != g:
            g = parent[g]
        return g

    for e in entries:
        cur = by.get(e['id'])
        if not cur:
            by[e['id']] = e
            continue
        def parts(z):
            return {p.strip() for p in re.split(r'[；;，,、]', re.sub(r'（[^）]*）', '', z)) if p.strip()}
        have = set()
        for s0 in cur.get('senses', []):
            have |= parts(s0['zh'])
        for s in e.get('senses', []):
            ps = parts(s['zh'])
            if ps and ps <= have:
                continue
            cur['senses'].append(s)
            have |= ps
        seen = {x['en'].lower() for x in cur.get('examples', [])}
        for x in e.get('examples', []):
            if x['en'].lower() not in seen:
                cur['examples'].append(x)
                seen.add(x['en'].lower())
        for k in ('tags', 'notes', 'fixes'):
            for v in e.get(k, []):
                if v not in cur.setdefault(k, []):
                    cur[k].append(v)
        for k in ('ipa', 'usage', 'zh', 'date'):
            if not cur.get(k) and e.get(k):
                cur[k] = e[k]
        if e.get('forms'):
            if not cur.get('forms'):
                cur['forms'] = e['forms']
            else:
                have = {f['w'].lower() for f in cur['forms']['fam']}
                cur['forms']['fam'] += [f for f in e['forms']['fam'] if f['w'].lower() not in have]
                cur['forms']['infl'] = cur['forms']['infl'] or e['forms']['infl']
        if e.get('group'):
            if cur.get('group') and cur['group'] != e['group']:
                parent[find(e['group'])] = find(cur['group'])
            elif not cur.get('group'):
                cur['group'] = e['group']
        cur['order'] = min(cur['order'], e['order'])
    # 合併同組
    gmap = {}
    for g in groups:
        root = find(g['id'])
        if root not in gmap:
            gmap[root] = {'id': root, 'name': '', 'note': '', 'members': []}
        tgt = gmap[root]
        for m in g['members']:
            if m not in tgt['members']:
                tgt['members'].append(m)
        if g['note'] and g['note'] not in tgt['note']:
            tgt['note'] = (tgt['note'] + ' ' + g['note']).strip()
    for g in gmap.values():
        g['name'] = ' / '.join(m[2:] for m in g['members'])
    for e in by.values():
        if e.get('examples'):
            e['examples'].sort(key=lambda x: not x.get('easy'))
        if e.get('group'):
            e['group'] = find(e['group'])
    return list(by.values()), list(gmap.values())


def main():
    raw_dir, cards_dir, out_path = sys.argv[1:4]
    report_path = sys.argv[4] if len(sys.argv) > 4 else None
    raw = load_raw(raw_dir)
    num = lambda s: int(re.search(r'\d+', s).group()) if re.search(r'\d+', s) else 999
    entries, groups = [], []
    order = 0
    word_files = sorted([n for n in raw if n.startswith('單字')], key=num) + [n for n in raw if n == 'Eword']
    supplements = sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(cards_dir, '_*.txt')))
    missing = []
    for name in word_files:
        path = os.path.join(cards_dir, name + '.txt')
        if not os.path.exists(path):
            missing.append(name)
            continue
        es, gs, order = parse_cards(path, raw[name], name, order)
        entries += es
        groups += gs
    for name in supplements:
        es, gs, _ = parse_cards(os.path.join(cards_dir, name + '.txt'), {}, name, 0)
        entries += es
    tp_skipped = {}
    order = max(order, 100000)
    for name in sorted([n for n in raw if n.startswith('TP')], key=num):
        es, order, skipped = parse_tp(raw[name], name, order)
        entries += es
        if skipped:
            tp_skipped[name] = skipped
    before = len(entries)
    entries, groups = merge(entries, groups)
    # 新字引入順序：出現在越多檔案的字越優先（通常是一直記不住的字），再依檔案順序
    words_sorted = sorted([e for e in entries if e['type'] == 'word'], key=lambda e: (-len(e['tags']), e['order']))
    for i, e in enumerate(words_sorted, 1):
        e['order'] = i
    now = int(time.time() * 1000)
    for e in entries:
        e['added'] = now
    data = {'app': 'danciben', 'version': 1, 'exported': time.strftime('%Y-%m-%dT%H:%M:%S'), 'entries': entries, 'groups': groups}
    json.dump(data, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    words = [e for e in entries if e['type'] == 'word']
    sents = [e for e in entries if e['type'] == 'sentence']
    print('cards before merge:', before, '→ entries:', len(entries), '| words', len(words), '| sentences', len(sents), '| groups', len(groups))
    print('missing card files:', missing)
    print('TP skipped lines:', sum(len(v) for v in tp_skipped.values()))
    if report_path:
        with open(report_path, 'w', encoding='utf-8') as r:
            r.write('# 單字簿整理報告\n\n')
            r.write('- 單字:%d 個(合併重複後)\n- 對話句子:%d 句\n- 易混淆組:%d 組\n\n' % (len(words), len(sents), len(groups)))
            multi = [e for e in words if len(e['tags']) > 1]
            r.write('## 在多個檔案出現的字(已合併成一張卡):%d 個\n\n' % len(multi))
            for e in sorted(multi, key=lambda x: -len(x['tags'])):
                r.write('- **%s**:%s\n' % (e['text'], '、'.join(e['tags'])))
            fixed = [e for e in words if e.get('fixes')]
            r.write('\n## 更正清單:%d 個字\n\n' % len(fixed))
            for e in sorted(fixed, key=lambda x: x['order']):
                r.write('- **%s**(%s):%s\n' % (e['text'], '、'.join(e['tags']), ';'.join(e['fixes'])))
            if tp_skipped:
                r.write('\n## TP 檔沒有配成對的行(沒有匯入)\n\n')
                for k, v in tp_skipped.items():
                    for t in v:
                        r.write('- %s:%s\n' % (k, t))


if __name__ == '__main__':
    main()
