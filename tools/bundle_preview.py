#!/usr/bin/env python3
"""把 App 打包成單一 HTML（給 claude.ai 預覽用）。可選擇內嵌匯入資料（只放在私人預覽，不要放進公開 repo）。
用法：python3 tools/bundle_preview.py out.html [data.json]"""
import sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda p: open(os.path.join(root, p), encoding='utf-8').read()
h = rd('index.html')
body = h[h.index('<!--APP-->'):h.index('<!--/APP-->')]
js = ''.join(rd(p) + '\n' for p in ['js/vendor/jszip.min.js', 'js/db.js', 'js/srs.js', 'js/lookup.js', 'js/docx.js', 'js/app.js'])
seed = ''
if len(sys.argv) > 2:
    seed = '<script>window.SEED=' + open(sys.argv[2], encoding='utf-8').read().replace('</', '<\\/') + ';</script>\n'
safe_js = js.replace('</script', '<\\/script')
out = f'''<title>單字本</title>
<meta name="theme-color" content="#f7f8f6">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,500;7..72,600&display=swap">
<style>
{rd('css/app.css')}
</style>
{body}
{seed}<script>
{safe_js}
</script>
'''
open(sys.argv[1], 'w', encoding='utf-8').write(out)
print(sys.argv[1], len(out) // 1024, 'KB')
