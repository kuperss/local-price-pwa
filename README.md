# 售價速查 PWA（裝置核准／自動更新版）

新版採 Cloudflare Workers + D1；GitHub 用於保存程式與分支，不是新版網站的執行環境。

- [使用者前端](https://local-price-managed.kuper.workers.dev/)
- [管理後台](https://local-price-managed.kuper.workers.dev/admin/)（Cloudflare Access，管理員 jerryloveyoux@gmail.com）
- [接手規則](AGENTS.md)／[架構、操作與驗收狀態](HANDOFF.md)

## 開始測試新版

1. 手機用一般瀏覽模式開前端，填姓名申請；不要用無痕模式做離線測試。
2. 電腦開後台完成管理員驗證，在「裝置與使用者」開通剛才的手機。
3. 手機按「重新確認」，等料檔載入，核對更新時間、產品筆數及三秒更新提示。
4. 搜尋幾個型號、打開產品明細，在後台查看該装置的查詢紀錄。
5. 提交缺少型號，在「型號審核」查看；只核准真實要納入的產品，下一次每日更新後查看「更新清單」。
6. 已載入料檔的手機離線重開，確認可以查詢。電腦停權手機，再讓手機回連並切回前端，
   應鎖定並清除本機受控料檔。最後可在後台重新開通自己的測試裝置。

每個瀏覽器／裝置需獨立申請；一般使用者不需要 Cloudflare 登入。
目前為功能分支測試版，尚待完成手機離線／停權等驗收；詳見 HANDOFF，不能直接視為正式上線驗收通過。

## 開發與发布

```powershell
npm ci
npm test
npm run build
# 僅在明確要發布程式時執行；需既有 Cloudflare 環境變數
npm run deploy
```

產品資料由另一 repo 的每日排程在 DB 同步、V36 快取及 selftest 成功後呼叫
`scripts/publish_data.py`。資料與程式分開發布，`git push` 不會執行上述部署命令。
舊 GitHub Pages 網站維持不變，新版不可只用下面的純靜態 Python server 取代後端。

---

## 舊版歷史說明（下方僅供 PDF 解析維護參考，不適用新版部署）

這是一個可部署到 GitHub Pages 的純前端 PWA，目的在於讓業務人員在 iPhone 上用更好的 UI 查詢敏感價格表，同時維持資料只保存在裝置本機。

## 目前 MVP

- 匯入本地 PDF 價格表
- 使用 `pdf.js` 在瀏覽器端解析文字與欄位
- 建立本機索引並保存原始 PDF
- 下次開啟自動從本機載入
- 搜尋品編、價格與備註
- 卡片式結果清單
- 點開細節並預覽對應 PDF 頁面
- 一鍵複製 `品編 + 價格`
- 匯入新版時自動覆蓋舊版
- 可離線使用

## 目前假設

- PDF 為可選取文字
- 單次只維護一份有效價格表
- 主要欄位為：`品編`、`建議售價`、`搭贈`、`底價`、`量價`、`開盤價`、`備註`
- PDF 各頁的表格欄位順序大致固定

## 本機資料策略

- 原始 PDF 與解析後索引都存在瀏覽器 `IndexedDB`
- 不依賴後端
- 不上傳 PDF
- 不使用第三方分析服務

## 啟動方式

這是靜態網站，可直接部署到 GitHub Pages。

若要在本機測試，請使用任何靜態伺服器，例如：

```powershell
cd C:\Users\A1030701\Documents\Playground\local-price-pwa
python -m http.server 8080
```

然後開啟：

`http://localhost:8080`

## 後續可擴充

- 針對實際 PDF 樣式微調欄位辨識規則
- 加入多份價格表版本管理
- 加入 PIN 碼保護
- 增加欄位篩選與排序
- 匯出分享格式模板
