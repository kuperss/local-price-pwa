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
- 保留其他未提交變更，尤其 `.claude/`；只提交本次相關檔案。中文 commit 說明原因。
- Commit 結尾：`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。
