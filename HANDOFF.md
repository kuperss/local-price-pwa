# 售價速查新版交接 — 2026-09-15

## 系統分工

| 位置 | 功能 |
| --- | --- |
| GitHub kuperss/local-price-pwa | 程式版控，功能分支 codex/price-pwa-auto-update |
| Cloudflare Worker local-price-managed | PWA 靜態檔、簽章驗證 API、管理 API |
| D1 local-price-managed | 裝置、公鑰、事件、型號申請、catalog、加密料檔 |
| Cloudflare Access `/admin` | 僅管理後台，由管理員本人登入 |
| 價格查詢工具 repo | DB 同步、V36 產品快取、每日排程 |

新版入口 https://local-price-managed.kuper.workers.dev/ ，後台 `/admin/`。
與 https://mobile-query.pages.dev/ 的業績查詢站不同，也沒有取代原本 GitHub Pages 舊查價站。
目前沒有在此 repo 設定 GitHub Actions 部署。推送功能分支不等於發布新版。

## 取數與發布

初始 `0903.xlsx`「合併結果／料號」去重為 1,891 個有效型號；忽略一筆查無資料文字。
這是 2026-09-11 初始檔案範圍，不是動態產品總量保證。Excel 的歷史價格不用於發布。
`publish_data.py` 首次把種子寫入 catalog，之後只讀 catalog（包括後台核准項目）。
V36 保持全量取數，再篩選核准品號；正規化可處理快取移除斜線、引號的差異。
已核准但 ERP 查不到的料號標為 missing，不虛構價格，後續發布繼續重試。

每日 17:00 既有 Windows 工作：`舞光行動查詢每日更新`。
腳本：`../../價格查詢工具/數據分析/tools/daily_mobile.ps1`。
流程：DB 同步 → V36 快取 → selftest → 售價速查料檔 → 原行動查詢發布。
週五全量 DB，其餘最近兩個月；產品快取仍是全量。selftest 非 0 禁止兩個 PWA 發布。
V36 更新失敗不發布查價料檔，舊包保留；不阻擋已驗證的業績站發布，但最終排程回傳非 0。
此腳本直接使用本機 checkout，切換分支會影響下次執行；不要在排程執行期間切分支。

手動只讀檢查（Python 需 openpyxl、cryptography、requests；先確認機器 Python 版本）：

```powershell
$env:PYTHONIOENCODING = 'utf-8'
py -3.10 scripts/publish_data.py --check-only
```

正式發布料檔：先完成快取與對帳，再執行 `py -3.10 scripts/publish_data.py`。
這會修改 D1 與線上版本，不要為了檢查狀態隨意執行。
發布程式：`npm ci` → `npm test` → `npm run deploy`；與產品資料更新是兩件事。
`scripts/provision.py` 用於初始化既有帳號資源；重新執行前確認帳號、Worker 與 Access 設定，
不要誤以為它是唯讀健檢。Cloudflare token / account id 取自既有環境，絕不印出值。

## 加密與權限

- `data-private/price-data.json` 格式 `price-pwa-aes-gcm-v1`，AES-256-GCM，包含版本、IV、密文與雜湊，不含金鑰。
  此格式服務新版自動更新流程，不是舊版手動匯入 v3 JSON 的替代檔。
- D1 儲存料檔與解密金鑰；只有已核准、簽章驗證成功的裝置可取得。後台由 Access JWT 再驗 issuer/audience/email。
- 各裝置用 ECDSA P-256 簽章，時間戳與單次 nonce 防重播；私鑰與本機 AES key 用不可匯出的 CryptoKey 存 IDB。
- IDB 保存加密料檔，解密後資料供記憶體查詢；Service Worker 不快取 API 或後台。
- 首次使用、回連、回前景及在線每 60 秒檢查權限。離線可用已核准料檔，失敗更新保留舊包。
- 停權回連刪除受控本機料檔及金鑰、歷史搜尋並鎖定；保留裝置身分讓管理員可重新開通。
- 無法即時撤回完全離線裝置的資料，也不是防截圖、防使用者另存／竄改瀏覽器的 DRM。
  裝置码是瀏覽器安裝身分，不是硬體序號；換瀏覽器、清除網站資料需重新申請。
- D1 的 current_bundle 在完整包上傳後才切換；前端先驗證及解密新包，再取代本機版本。
  尚無管理員一鍵版本回退 UI，勿刪除舊資料包或直接手改 current_bundle。

## 稽核定義與審核

- 開啟次數：每分頁首次成功開啟料檔記錄一次 session；不是每分鐘權限檢查都加一次。
- 搜尋次數：按搜尋或停止輸入 0.9 秒後記錄，同一連續查詢不重複計數。
- 詳細紀錄包括搜尋字詞、符合筆數；點開產品另外記錄 view 與型號。
- 紀錄包含裝置、姓名、客戶端發生時間、伺服器接收時間、離線標記與料檔版本。
  後台以裝置分列，同姓名不自動合併成同一人；姓名是自行填寫，不是真實身分驗證。
- 離線事件先排隊、回連補傳，事件 UUID 去重。使用者若清除網站資料，尚未回傳的紀錄可能遺失；
  不能把「沒有查詢紀錄」解讀成「沒有使用」或保證紀錄防竄改。
- 型號審核每次最多 50 筆，核准才加入 catalog；後台可按裝置查詢提交及審核／載入狀態。

## 實測狀態與待辦

- 已部署初版、完成瀏覽器姓名申請 → 待核准 → 測試裝置核准 → 解密載入 1,891 筆的測試。
- 2026-09-15 唯讀檢查：前端 HTTP 200、後台未登入 302、匿名資料下載 401。
  當時線上產品快取时间為 2026-09-11 17:09:27；未確認之後每日排程是否執行，勿宣稱資料為今日更新。
- 本機 Node 測試涵蓋裝置／管理員驗證、簽章與重播、查詢去重、型號審核、停權阻止下載。
- 本機修正（搜尋停留紀錄、停權處理、申請畫面文案等）尚未全部部署，commit / push 不會讓其上線。
- 尚待：新版部署後手機 Safari／Android 離線重開、補傳、停權清除資料、更新提示三秒、
  管理員本人 Access 登入與 UI 核准流程、每日排程完整驗收。不能以 Node 測試取代這些驗收。
- 初次測試裝置名稱「自動驗證測試裝置」，不要誤認成真實同事；後續確認狀態後由管理員停權。
- 不自動 merge main、不改舊 GitHub Pages、不提交 `.claude/` 或資料／金鑰。
