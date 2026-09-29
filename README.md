# 單字本（畫面原型）

自用的中英單字查詢/複習 PWA。目前是**可點擊的畫面原型**：全部是假資料，狀態只存在記憶體，重新整理就還原。系統語音（TTS）發音是真的可以播；右上角可以切換白底／黑底。

## 畫面

| 分頁 | 畫面 | 路徑 |
|---|---|---|
| 查詢 | 查詢首頁（單字/句子切換、最近查過） | `#/search` |
| | 單字結果 | `#/result/affect` |
| | 句子翻譯結果（點句中的字再查） | `#/result/s-policy` |
| | 從其他 App 分享進來 | `#/share` |
| 單字庫 | 列表（全部/星號/單字/句子） | `#/library` |
| | 單字詳情 | `#/entry/adapt` |
| 複習 | 首頁（選範圍、題型） | `#/review` |
| | 閃卡/例句挖空/聽發音選字 | `#/review/flash` `#/review/cloze` `#/review/listen` |
| | 結果 | `#/review/result` |
| 更多 | 匯入 Word 精靈 | `#/import` |
| | 匯出/匯入 JSON | `#/backup` |
| | 設定 | `#/settings` |

手機寬度是底部 4 個分頁；寬度 ≥ 900px(Windows）改成左側選單。

## 在電腦上跑

```bash
python3 -m http.server 8000
# 開 http://localhost:8000
```

## 裝到手機（之後）

PWA 需要 HTTPS 才能安裝，可以用 GitHub Pages 發佈這個 repo，再用 Chrome 開啟 →「加到主畫面/安裝應用程式」。
`manifest.webmanifest` 已經設好 `share_target`，安裝後在其他 App 選取文字 →「分享」就會看到「單字本」。

## 檔案

- `index.html` — 外框（左側選單/底部分頁）
- `css/app.css` — 樣式（淺色）
- `js/data.js` — 假資料（資料結構草稿：一張卡一個字、`group` = 同組易混淆、`tags` = 檔名編號）
- `js/app.js` — 路由與各畫面
- `sw.js`、`manifest.webmanifest`、`icons/` — PWA 安裝用
