# 單字本

*作者：ArchieKUO*

自用的中英單字查詢與複習 PWA，裝在 Android（Chrome）和 Windows（Chrome / Edge）。
資料全部存在各自裝置的瀏覽器裡（IndexedDB），不上傳任何伺服器；手機和電腦之間用「匯出 / 匯入 JSON」＋ Quick Share 同步。

## 功能

- **查詢**：單字或句子。單字庫有的字直接顯示整理好的卡片；沒有的字線上查（Google 翻譯免費端點＋Free Dictionary API，句子翻譯失敗時改用 MyMemory）。每次查詢都會記錄。
- **從其他 App 分享**：安裝後在任何 App 選取英文 →「分享」→「單字本」。
- **單字卡**：意思（含用法標記 生活／正式／很少用）、字的型態（三態、相關詞）、生活例句、原本筆記的例句、同組易混淆字、更正紀錄、檔案標籤。可以直接編輯。
- **複習**：FSRS 排程（Anki 目前用的演算法）。每天只出到期的字＋有上限的新字；題型自動混合（閃卡 → 例句挖空、易混淆辨析 → 反向閃卡、拼字、聽發音選字）；頑固字、暫停、復原、未來 7 天預估。
- **發音**：系統 TTS，可選語音、口音、語速。
- **匯入 Word**：可以在 App 裡解析新的 .docx（單字筆記、表格、英中對照句子）。
- 白底／黑底切換、字級、手機底部分頁／寬螢幕左側選單。

## 安裝

### Android 手機（App）

1. 手機開 <https://github.com/nmymdf/dictionary/releases/latest/download/danciben.apk> 下載。
2. 點下載好的 `danciben.apk` → 第一次會問「允許安裝未知應用程式」→ 允許 → 安裝。
3. 打開「單字本」→ 查詢頁「去匯入」→「選擇 JSON 檔」→ 選 `danciben-import.json`。
4. 以後有新版：再下載一次、直接安裝，資料會保留（簽章固定）。

App 裡：發音用手機的文字轉語音；匯出備份會存到「下載/單字本」並開分享選單（Quick Share 到電腦）；在其他 App 選取英文 →「單字本」或「分享 → 單字本」可以直接查。

每次推送程式碼，GitHub Actions（`.github/workflows/android.yml`）會自動編譯並發佈新版到 Releases。

### Windows（PWA）

1. 在這個 repo 的 **Settings → Pages** 開啟 GitHub Pages（Deploy from a branch，資料夾 `/ (root)`）。
2. 用 Chrome 或 Edge 開網址 → 網址列右邊的「安裝」圖示。
3. 「更多 → 匯出 / 匯入 JSON」匯入 `danciben-import.json`（在私人 repo `vocab-files`）或手機匯出的備份。

## 開發

```bash
python3 -m http.server 8000     # 開 http://localhost:8000
```

- `index.html`、`css/app.css`：畫面
- `js/app.js`：主程式（畫面、路由、複習流程、匯入匯出）
- `js/db.js`：IndexedDB
- `js/srs.js`：FSRS 排程
- `js/lookup.js`：線上字典與翻譯
- `js/docx.js`、`js/vendor/jszip.min.js`：在 App 裡解析 Word
- `sw.js`、`manifest.webmanifest`：PWA（離線外殼、分享目標）
- `tools/build_import.py`：把整理好的單字卡（私人 repo）組成匯入用 JSON
- `tools/bundle_preview.py`：打包成單一 HTML（加 `--standalone` 可以直接開檔案）
- `android/`：Android App（WebView 外殼，提供發音、選檔、存檔、分享進來）

這個 repo 是公開的，**不放任何單字資料**；資料在私人 repo `vocab-files`。
