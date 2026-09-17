# local-price-pwa — 接手記憶

## 專案與部署

- 這是「售價速查」，不是另一 repo 的 `mobile-query.pages.dev` 業績查詢工具。
- GitHub `kuperss/local-price-pwa` 保存程式碼；新版執行於 Cloudflare Workers + D1。
- 前端 https://local-price-managed.kuper.workers.dev/ ，後台同網址 `/admin/`。
- 只有後台使用 Cloudflare Access（管理員 jerryloveyoux@gmail.com）；一般使用者不登入 Cloudflare。
- 本次功能分支 `codex/price-pwa-auto-update`。commit / push 和部署分開，不能把推送當成已上線。
- 舊 GitHub Pages 沒有被新版取代；不要擅自修改舊站或合併 main。

## 使用者確定的需求

- 初始產品範圍：`../../價格查詢工具/價格查詢/0903.xlsx` 的「合併結果」工作表「料號」欄。
  Excel 只決定範圍，實際價格取 V36 的 `SEVICache.json.gz`。
- 每台瀏覽器裝置填名字申請，管理員核准／停權。裝置碼不提供自行編輯功能。
- 可離線使用；停權裝置成功回連後刪除本機受控料檔並鎖定。
- 更新資料後，畫面上方半透明提示「已更新料檔」三秒。
- 留存各裝置開啟、搜尋、查看產品明細及缺少型號申請。離線事件回連補送。
- 後台核准型號加入 catalog，下一次更新從 V36 全量快取取出；沒有 ERP 資料則顯示尚未查到。
- 申請畫面文案依使用者圖片：「為確保資訊安全，請填寫使用者名稱驗證。」
  及「申請送出後，請通知管理員，開通後即可使用。」；保留綠色樣式。
- 成本手勢固定為右上模式標籤 5 次 → 左上「價」4 次 → 模式標籤 3 次；相鄰點擊逾 3 秒或點錯會重置。
  手勢只開密碼框，不直接解鎖。後台「成本密碼」由管理員自行設定／變更，agent 不代設正式密碼。
- 成本與一般價格分開加密；不把成本放入一般搜尋索引。解鎖後在同一瀏覽器持續保留，
  重新整理、關閉重開、離線重開與每日料檔更新都不要求重輸密碼。
  只在重新認證／重新核准、停權、管理員變更成本密碼或使用者手動鎖回時清除。
  不保存成本密碼或成本明文；只在 IndexedDB 保存不可匯出的密碼衍生 CryptoKey，並綁定裝置、核准時間與密碼 revision。
- 已移除 PDF 匯入、解析、預覽及 pdf.js；新版只使用受控自動更新料檔，不恢復舊手動匯入入口。
- 使用者可見介面一律以 `@` 代稱成本：包含前台明細／解鎖對話框／提示、後台密碼頁及可回傳的錯誤訊息。
  內部欄位名、`isCostField` 的「成本／cost」辨識、加密格式、資料庫鍵名與程式文件不可改成 `@`，
  否則會失去成本欄位隔離能力；這是顯示別名，不是資料欄位改名或安全機制變更。
- 搜尋模式（v53）：在「更多選項」切換「全部資訊（原有模式）」／「僅型號／中文品名」。
  主畫面搜尋框上方顯示目前模式；點該按鈕必須直接在兩種模式間切換，不得再開啟選單。
  更多選項的下拉選單保留作為明確設定入口；兩種入口都會立即重新比對目前關鍵字。
  IndexedDB `local-price-pwa` / `kv` / `search-mode` 保存 `all` 或 `identity`，預設及無效值回退 `all`。
  選擇只記住在同一瀏覽器，重新開啟／離線仍適用，不跨裝置同步；清除網站資料後回預設。
  限定模式只查 `sku`、`productName`，不可把價格、備註、搭贈、extras 或額外別名混入。
  兩模式均不查成本；只改搜尋範圍，不隱藏產品明細欄位、不改成本 5-4-3 手勢或核准權限。
  搜尋邏輯在 `search.js`，必須保留在公開建置白名單與 SW 離線快取中；驗收與發布狀態見 HANDOFF。

## 日常操作與安全

- 每日 Windows 排程在另一 repo 的 `數據分析/tools/daily_mobile.ps1`，不要另外建立重複排程。
- 「更新產品快取／更新産品快取」指執行另一 repo 的 V36 `--refresh-cache`，不是只開 GUI；V35 不動。
- `scripts/publish_data.py` 只發布料檔；`npm run deploy` 發布程式與頁面，不會更新產品。
- token 只從既有環境變數／Windows 使用者環境讀取，禁止印出、寫入 Git、要求貼到對話。
- 不提交 `data-private/`、`deployment.local.json`、`.dev.vars`、資料庫、使用者紀錄及測試瀏覽器狀態。
- `scripts/build.mjs` 明確列出公開檔案，不把 Excel、私有料檔或內部腳本發到網站。
- 瀏覽器金鑰不是硬體綁定；清除網站資料或換瀏覽器需重新申請。離線稽核是盡力回傳，不能保證防竄改。
- 修改驗證／快取功能前讀 `HANDOFF.md`。未實測項目要明確標示，不能把單元測試等同手機驗收。
- 交付前 `npm test`、`npm run build`；改每日流程也跑另一 repo 的 `數據分析/tools/selftest.py`。
- 改成本發布格式也跑 Python `-m unittest discover -s tests -p test_publisher.py`。
  v51 初次發布須依 HANDOFF 遷移現有成本包，再部署 Worker；尚未設定密碼時成本不可解鎖。
- 保留其他未提交變更，尤其 `.claude/`；只提交本次相關檔案。中文 commit 說明原因。
- Commit 結尾：`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。
