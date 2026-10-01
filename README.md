# 單字本

*作者：ArchieKUO*

自用的中英單字查詢與複習 PWA，裝在 Android（Chrome）和 Windows（Chrome / Edge）。
資料全部存在各自裝置的瀏覽器裡（IndexedDB），不上傳任何伺服器；手機和電腦之間用「匯出 / 匯入 JSON」＋ Quick Share 同步。

## 功能

- **查字典**：英查中、中查英都用 Yahoo 字典（牛津中文字典）：中文意思、編號釋義、附中文翻譯的例句、字的變化、同義／反義詞。網頁不能跨網站讀取，所以由 App（Android、Windows）代抓；Yahoo 連不上時改用 Google 翻譯字典。結果直接顯示在搜尋框下面，不換頁。
- **句子**：貼上整句自動翻譯（英翻中、中翻英），點英文字可以查那個字。
- **我的筆記**：查的字如果在 47 個檔裡，上方先顯示自己的筆記（意思、型態、生活例句、相關說明）。「生活／正式／很少用」標籤已拿掉（當初是主觀判斷）。
- **新查的字分開放**：查詢不會自動保存，只列在「最近查過」（20 個）。按「加入複習」（可以順手打一行備註，例如句型）才存到單字庫的「新查的」，跟 47 個檔分開；刪除一次就好，可以復原。
- **發音**：線上自然語音，沒有網路時改用系統 TTS。
- **複習**：FSRS 排程；新查的字優先；可以選只練 47 個檔或只練新查的；卡片有來源標籤。
- 抬頭有作者與版本；白底／黑底；畫面放大（手機兩倍、電腦特大）；視窗縮窄時自動改排版。

## 安裝

### Android 手機（App）

1. 手機開 <https://github.com/nmymdf/dictionary/releases/latest/download/danciben.apk> 下載。
2. 點下載好的 `danciben.apk` → 第一次會問「允許安裝未知應用程式」→ 允許 → 安裝。
3. 打開「單字本」→ 查詢頁「去匯入」→「選擇 JSON 檔」→ 選 `danciben-import.json`。
4. 以後有新版：再下載一次、直接安裝，資料會保留（簽章固定）。

App 裡：發音用手機的文字轉語音；匯出備份會存到「下載/單字本」並開分享選單（Quick Share 到電腦）；在其他 App 選取英文 →「單字本」或「分享 → 單字本」可以直接查。

每次推送程式碼，GitHub Actions（`.github/workflows/app.yml`）會自動編譯 Android（`danciben.apk`）和 Windows（`danciben-windows.zip`，含自我測試），發佈到 Releases。這裡的版本不含單字資料，已經裝過的 App 更新後資料還在。

### Windows

- **Windows 版**：`desktop/` 是 Windows 版（Electron），用 `npm install && npx electron-builder --win zip` 做出 `danciben-windows.zip`（解壓縮就能用，第一次打開會在桌面放捷徑；不用安裝程式，比較不會被防毒誤判）。私人 repo `vocab-files` 的 GitHub Actions 會連同單字資料一起做好。
- **或用 PWA**：在這個 repo 的 Settings → Pages 開啟 GitHub Pages，用 Chrome / Edge 開網址 → 網址列右邊的「安裝」。

## 開發

```bash
python3 -m http.server 8000     # 開 http://localhost:8000
```

- `index.html`、`css/app.css`：畫面
- `js/app.js`：主程式（畫面、路由、複習流程、匯入匯出）
- `js/db.js`：IndexedDB
- `js/srs.js`：FSRS 排程
- `js/lookup.js`：免費翻譯字典與句子翻譯
- `js/yahoo.js`：Yahoo 字典（抓網頁 → 詞性、意思、例句、同義詞）
- `js/docx.js`、`js/vendor/jszip.min.js`：在 App 裡解析 Word
- `sw.js`、`manifest.webmanifest`：PWA（離線外殼、分享目標）
- `tools/build_import.py`：把整理好的單字卡（私人 repo）組成匯入用 JSON
- `tools/bundle_preview.py`：打包成單一 HTML（加 `--standalone` 可以直接開檔案）
- `desktop/`：Windows 版（Electron）
- `android/`：Android App（WebView 外殼，提供發音、選檔、存檔、分享進來）

這個 repo 是公開的，**不放任何單字資料**；資料在私人 repo `vocab-files`。
