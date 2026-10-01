#!/usr/bin/env python3
"""把 App 打包成單一 HTML（給 claude.ai 預覽用）。可選擇內嵌匯入資料（只放在私人預覽，不要放進公開 repo）。
用法：python3 tools/bundle_preview.py out.html [data.json] [--standalone]
--standalone：輸出完整的 HTML（有 charset、viewport），可以直接用瀏覽器開檔案。"""
import sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda p: open(os.path.join(root, p), encoding='utf-8').read()
h = rd('index.html')
body = h[h.index('<!--APP-->'):h.index('<!--/APP-->')]
js = ''.join(rd(p) + '\n' for p in ['js/vendor/jszip.min.js', 'js/db.js', 'js/srs.js', 'js/lookup.js', 'js/yahoo.js', 'js/docx.js', 'js/app.js'])
seed = ''
args = [a for a in sys.argv[1:] if not a.startswith('--')]
standalone = '--standalone' in sys.argv
if len(args) > 1:
    seed = '<script>window.SEED=' + open(args[1], encoding='utf-8').read().replace('</', '<\\/') + ';</script>\n'
safe_js = js.replace('</script', '<\\/script')
out = f'''<title>單字本</title>
<meta name="theme-color" content="#f7f8f6">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,500;7..72,600;7..72,700&family=Noto+Serif+TC:wght@600;700&display=swap">
<style>
{rd('css/app.css')}
</style>
{body}
{seed}<script>
{safe_js}
</script>
'''
if standalone:
    out = ('<!doctype html>\n<html lang="zh-Hant-TW">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
           + out.replace('\n<meta name="theme-color"', '\n<meta name="theme-color"', 1) + '</html>\n')
open(args[0], 'w', encoding='utf-8').write(out)
print(sys.argv[1], len(out) // 1024, 'KB')
