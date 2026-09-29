# 建築透視近景優先 v0913a

2026/9/13 已部署正式站 https://railisland.tw 。Cloudflare 版本 `a62b91ac-e895-47ed-bf5d-e67ff4a264ae`，100% 流量。網站修正 commit `3f14a119`；出貨基準 `dbcba3a9` 僅另含出貨測試修正，公開執行資產相同。

## 修正與驗收

建築線條先選畫面內建築，再依可見近端距離排序，避免遠方圖磚先用完額度。保留桌面 1,600 棟、觸控裝置 700 棟與原頂點預算，以及圖磚快取、更新節流。跨畫面邊緣的建築用投影外框判斷。排序只在重建時執行，不增加逐幀工作。

`node scripts/verify_glass_priority.mjs`：Chromium、WebKit 共 68 項通過。台北桌面朝北近景 0/25 → 25/25，朝南 21/38 → 38/38。手機密集視角 Chromium 28/48 → 48/48、WebKit 26/46 → 46/46，仍最多 700 棟。另驗俯視、樓層線門檻、圖磚回傳反序、360/375/390/414/520/768px、一般與全畫面真觸控、實際 GL 像素及零執行例外。既有地形快取等價測試、i18n、更新紀錄與部署設定檢查通過。

## 出貨檢查阻礙與修復

前兩輪出貨被既有 `verify_punctual.mjs` C4b 的「零綠像素」判準擋住。完整巢狀輸出顯示 3132 次已有 325 個金色像素，但 1 個疊色像素被誤算成綠環。獨立掃描完整動畫相位確認：ph=80ms 時該點為 rgba(102,136,102,15)，關掉金環後為 rgba(28,113,170,9)；準點集合與綠環繪製呼叫均為 0，建築圖層未啟用。

`dbcba3a9` 保留金色像素門檻，改為精確檢查實際綠環繪製呼叫，並新增將今日之最故意放入準點集合的正向對照。原有 C3 仍檢查金環色碼與繪圖序列。修正後 70/70 通過；完整出貨鏈內準點 70/70、「我的車」94/94、查詢分頁 245/245 及其餘閘門全部通過。沒有修改網站的金環或列車繪製程式。

## 出貨檔與正式站

執行 `npm run ship-web -- --ref dbcba3a9 --preview`，完成乾淨 worktree、所有出貨閘門與 esbuild 去註解逐 byte 等價驗證。預覽網址仍回 Cloudflare Access 登入頁，未更改存取設定；改以相同雜湊的乾淨出貨副本完成 Chromium 桌面、WebKit 手機的雙向像素與觸控驗收，才升正式。

首頁 1,666,573 bytes，MD5 `27dda1b68feca7e052130e66f711a517`，SHA-256 `a3af32b7daca2bac4ec7aae6786390e2d0128a84c4a237b2a50033da9c7baae2`。正式首頁、night-map.js、i18n/content-translations.js 均 HTTP 200、MISS，SHA-256 與出貨檔一致。正式站 Chromium 桌面與 WebKit 375px 手機，朝北與朝南的最近 20 棟均保留，近景像素檢查通過；手機實際開關 3D 建築正常、無水平溢出或執行例外。`/api/trtc-live` HTTP 200。

本機驗收紀錄：`output/glass-priority/results.json`、`stripped-smoke.json`、`production-smoke.json`、`ship-preview-fixed.log`。截圖為同目錄 `production-chromium.png`、`production-webkit.png`。
