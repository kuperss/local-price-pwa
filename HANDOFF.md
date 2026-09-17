# 售價速查新版交接 — 2026-09-17

## 最新接手狀態：v53 主畫面直接切換（2026-09-17，已發布）

使用者修正操作：搜尋框上方的模式按鈕不能開啟更多選項，而是直接在 `all`／`identity` 間切換。
更多選項保留原有下拉選單，供使用者明確選擇。已提交並推送功能分支，commit `e3595c0`；
線上已升至 v53，Worker `772ae64c-f679-4df5-b623-3e82698607bf`。

- `app.js` 的 `toggleSearchMode()` 對模式按鈕使用反向模式值，並交由共用 `setSearchMode()` 保存、重新比對與稽核。
  因此兩個入口的行為一致；只有下拉選單會自動收回更多選項，模式按鈕不會改動選單開合狀態。
- `index.html`／`sw.js` 已升至 v53，確保發布後已安裝的 PWA 能取得新的 app shell，而不會沿用 v52 的按鈕行為。
- 「提交料檔中缺少的型號」已由右側結果區移到左側查詢控制卡最末端，接在料檔狀態之後；
  手機版以 flex order 固定在查詢紀錄與料檔狀態之後，結果卡只保留查詢結果。
- 驗收重點：按主畫面按鈕一次要從全部資訊變僅型號／中文品名，再按一次要切回；不得出現更多選項。
- 發布後已唯讀核對：公開 index 載入 `app.js?v=53`、提交料檔位於結果區之前、app 使用 `toggleSearchMode()`，
  且不再含主畫面按鈕開啟 `panelMoreOptions` 的舊程式。產品料檔與 D1 未重新發布或覆寫。

## v52 搜尋模式（2026-09-17，已發布）

使用者要求：更多選項可切換原有搜尋與僅型號／中文品名搜尋，主畫面清楚標示並記憶選擇。
已提交並推送功能分支 `codex/price-pwa-auto-update`，commit `825200b`；已發布至 Cloudflare。
正式 Worker version：`122e0c9c-48af-44b0-ad90-55e61b5766d4`（2026-09-17 00:31 UTC）。
公開前端已核對 `v=52` 與 `search-mode-select`；本次沒有改 D1、資料發布或每日排程。

- `index.html` / `styles.css`：更多選項的原生下拉選單與搜尋框上方模式按鈕。
  延續原有綠色／米色樣式，選單用不透明底色以避免底下文字干擾；選單 44px 觸控高度。
- `app.js`：初始化讀取 IndexedDB `search-mode`，切換立即重算當前結果、同步標示／提示文字並保存。
  儲存失敗會提示本次已切換但無法記住，不能假裝儲存成功。成本解鎖及裝置驗證流程不變。
- `search.js`：抽出既有正規化、多關鍵字與匹配邏輯；`all` 保留原行為，`identity` 僅型號及中文品名，
  包含多關鍵字的每個 token 都受範圍限制。缺少或無效設定回退 `all`。成本不進任一索引。
- `scripts/build.mjs` / `sw.js`：新增模組白名單、離線預快取與內容雜湊；前端版本 v52。
- 模式是此瀏覽器的偏好，不是權限，不跨瀏覽器／裝置同步；停權仍清除受控料檔並阻止查詢。
  搜尋歷史沿用原設定，點歷史紀錄也按「目前模式」查詢；切模式後的搜尋會走既有稽核，不新增後台欄位。
- 共用記憶放在本專案 AGENTS / HANDOFF，使用說明在 README；不依賴單一 Agent 私有記憶或對話歷史。

驗證：`npm test` 11 項通過、`npm run build`、`node --check app.js`、`git diff --check` 通過。
新增 `tests/search.test.mjs` 驗證兩種範圍、無效設定回退、大小寫／符號／多關鍵字、價格／備註／搭贈／extras／別名排除。
本機 Playwright 搭配 `tests/preview-server.mjs` 假資料及記憶體 DB 驗證：申請核准、備註及價格在兩模式的差異、
型號／中文品名／多關鍵字可查、切換立即重算、重新整理記住、離線重新載入後仍記住且可查。
切回全部資訊後，關閉頁籤再重新開啟亦保留；未另測完整瀏覽器程序退出或系統重開。
檢查 1280px 桌面及 390px／320px 手機視窗；320px 選單沒有超出左右邊界。
最後更新 SW 後確認選單不透明底色生效。截圖位於忽略的 `output/playwright/`。
斷線測試預期產生 `/api/status` 的 `ERR_INTERNET_DISCONNECTED`，不算未處理程式異常。
未測實體 iOS／Android；不要把 Chromium 手機尺寸與模擬離線當成真機驗收。

後續修改時：先重跑 npm test / build，再依既有程序 commit／push／`npm run deploy`，
確認公開檔案與 dist 一致並回填 commit / Worker version。純搜尋功能不必執行資料發布、成本遷移或 BI 同步。
保留使用者 `.claude/`；不得將假裝置、私有資料、測試瀏覽器狀態或輸出截圖加入 Git。

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

### v51 成本保護與 PDF 移除（2026-09-16，已發布）

- 隱藏手勢：模式標籤 5 →「價」4 → 模式標籤 3，逐次間隔不超過 3 秒。
  原桌面連按兩次 Ctrl+反斜線入口也只會開成本密碼框，不繞過密碼。
- 後台新增「成本密碼」，管理員自行輸入 12～128 字元長密語；沒有預設密碼、查回或前端改密碼功能。
  密碼不隨 API 傳送；瀏覽器 PBKDF2-SHA256（600,000 次、隨機 salt）產生包裝金鑰，
  透過受 Access 保護的 API 保存於 D1 settings。此衍生金鑰也是機密，不是可公開的密碼雜湊。
- 發布器分離所有名稱含「成本／cost」的欄位。一般產品包沒有成本欄位；成本使用獨立隨機 AES-GCM 金鑰，
  保存於 cost_bundles／cost_chunks。已核准裝置只能取得成本密文及經密碼衍生金鑰包裝的成本金鑰，
  不會取得原始成本金鑰或密碼衍生金鑰。AAD 綁定版本，密碼設定另外有 revision。
- 前端成本明文只保留記憶體，不進搜尋索引或一般價格複製區；只有解鎖後的成本列可複製。
  解鎖後保存不可匯出的 PBKDF2 衍生 CryptoKey，綁定裝置 id、approved_at 與密碼 revision；不保存密碼或成本明文。
  因此重新整理、關閉重開、離線重開及每日資料版本更新可自動解鎖新成本包。
  重新認證／重新核准、停權、取得新密碼 revision 或手動「鎖回成本」會刪除保存金鑰並清除成本顯示。
  密碼更改不必重抓 BI／重傳成本大包；前端下次成功檢查（在線前景通常 60 秒）更新包裝金鑰並鎖回。
- 離線可以用已下載成本包輸入正確密碼；第一次設定後需先連線取得包。
  舊密碼配舊密文仍可能離線解密，無法撤回另存副本；密碼保護不能替代裝置停權。
  前端升級會丟棄不含 split-costs-v1 標記的旧 managed-cache 與歷史搜尋，第一次升級需連線下載。
- PDF 上傳、解析、預覽、pdf.js 與專用解析測試／備忘已移除，Git 歷史可找回；
  dist 改為清空後按白名單建置，不發布 vendor、Excel 或私有資料。沒有修改舊 GitHub Pages。

首次正式發布順序（本次第 1～3 步已完成）：

1. 跑 npm test、Python publisher 測試、BI selftest，非 0 不發布。
2. 執行 `py -3.10 scripts/migrate_costs.py`：從 D1 現有加密包在記憶體拆分成本，
   保留原 fetched_at，不把舊資料冒充今日同步；可重跑。這會寫 D1，不是唯讀檢查。
   若每日 publish_data.py 已產生 split-costs-v1，遷移會直接跳過。
3. `npm run deploy`，檢查匿名 API 拒絕、後台 Access 與前端版本 v51。
4. 管理員親自登入後台「成本密碼」設定密碼，再讓測試装置重新整理、確認取得新版料檔後驗收手勢（待管理員操作）。
   未設定密碼時一般價格可查，成本不能解鎖。發布器會自行建立新增的成本資料表，
   因此本機 checkout 被每日排程使用時不會因尚未手動遷移而缺表；但舊 Worker 沒有成本解鎖介面。

本機驗證：Node 測試含權限、舊格式拒絕、密碼更換、密文解密及金鑰不外洩；
Python 測試含產品範圍正規化、成本分包、全形欄名、缺表初始化、發布中斷保留舊指標、
舊包遷移保留時間與重跑安全。Playwright 使用 localhost、記憶體 DB 與假資料：
申請／核准、5-4-3 密碼框、錯誤／正確密碼、重新整理與斷線重開保留權限、換密碼回連鎖回、
新密碼成功／舊密碼失敗、停權刪除 cache／grant／成本權限且保留身分，以及搜尋不含成本均已實測。
網路阻斷模擬下重新載入與解鎖可用；該瀏覽器 navigator.onLine 仍回 true，
因此只算 API 斷線退路驗證，不能等同真手機飛航模式與離線事件標記驗收。
測試未連正式 Cloudflare 或 BI，也未設定正式成本密碼；手機 Safari／Android 仍待實機驗收。
最終檢查：Node 8 項、Python 4 項、公開檔建置、JS 語法及 git diff --check 通過。
另跑 BI selftest 回傳 0；四張關鍵表同步時間為 2026-09-15 17:00～17:03，
未執行新的 BI 同步；本次沿用 2026-09-15 17:04:09 的 V36 快取資料。

2026-09-16 正式發布：commit `e1b6840` 已推送至 `origin/codex/price-pwa-auto-update`；
Cloudflare Worker version `f8005e6b-2b90-43db-9520-e01c7b42d3f7`。
遷移工具回報 current bundle 已是 split-costs 格式，因此沒有重寫；D1 核對為 1,891 筆一般產品、
1,891 筆成本資料、一般密文 28 chunks、成本密文 2 chunks，fetched_at 保留 2026-09-15 17:04:09。
公開 index、app、managed、cost crypto/session 與 service worker 均和本機 dist 雜湊一致；
前端回 200，後台匿名回 302 至 Access，匿名 status／bundle API 回 401。
正式 `cost_password_v1` 尚未設定；一般價格可用，但管理員設定密碼前成本無法解鎖。

- 已部署初版、完成瀏覽器姓名申請 → 待核准 → 測試裝置核准 → 解密載入 1,891 筆的測試。
- 2026-09-15 唯讀檢查：前端 HTTP 200、後台未登入 302、匿名資料下載 401。
  當時線上產品快取时间為 2026-09-11 17:09:27；未確認之後每日排程是否執行，勿宣稱資料為今日更新。
- 本機 Node 測試涵蓋裝置／管理員驗證、簽章與重播、查詢去重、型號審核、停權阻止下載。
- 2026-09-15 已依使用者要求部署 commit `b40d05e` 的程式修正（搜尋停留紀錄、停權處理、申請畫面文案等）。
  Worker version：`60e2bf8c-0320-4d58-909b-580a23fb3a81`。部署後比對線上 index.html、app.js、managed.js、sw.js
  與本機建置檔雜湊一致；後台未登入導向 Access，匿名資料 API 回 401。這次未重跑產品資料同步。
  程式測試、建置與 BI selftest 通過；BI 有一項表間同步時間不一致提醒。commit / push 本身仍不會自動部署。
- 尚待：新版部署後手機 Safari／Android 離線重開、補傳、停權清除資料、更新提示三秒、
  管理員本人 Access 登入與 UI 核准流程、每日排程完整驗收。不能以 Node 測試取代這些驗收。
- 初次測試裝置名稱「自動驗證測試裝置」，不要誤認成真實同事；後續確認狀態後由管理員停權。
- 不自動 merge main、不改舊 GitHub Pages、不提交 `.claude/` 或資料／金鑰。
