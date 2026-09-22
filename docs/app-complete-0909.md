# 網站與手機 App 完整整合 — 2026-09-09

## 來源與內容

以正式站 v0909i 的 main `f8cb8a41` 為基底，三方合併日夜光影分支 `549ecff3`，網頁版本 v0909k。包含地景、土地覆蓋、歷史建築、上下層軌道、台鐵派軌、示意橋面橋墩、手機／放空車頭鎖定、收藏車庫及日夜光影。沒有取整份單邊 index.html。

## 防止跨版本遺漏

- App Store no-cache lookup 確認現行版 1.6.0（2026-09-08T22:53:06Z）。新版本採 1.6.1，iOS build 106、Android versionCode 46。
- 本機 1.6.0 build 104、105 的 archive Info.plist 均有 `uploadEvent.state=success`，分別於 9/7、9/8 上傳 Apple；出貨基線加入兩者的可見面聯集，保留過去 iOS／Android 基線。
- 新基線發現主線缺少三條已出貨的更新紀錄，已從 build 104 恢復正本及英／日翻譯。完整歷史為 318 條，最近維持 8 條。
- 舊 `searchStockMatch`／`SEARCH_STOCK_ROWS` 已由 `ca16e73d` 的 `searchTypeMatch`／`SEARCH_TYPE_ROWS` 取代；build 105 也採新實作。只有這兩個改名符號列入具來源說明的例外，車型搜尋另以真實瀏覽器驗證。
- App 原有 3D 逐檔 SHA256 gate 擴充至車庫、日夜、轉乘、月台與翻譯檔案；新增日夜光影、橋梁及鏡頭鎖定模組列入必要資產。驗證的對象是實際 bundle。
- iOS／Android 沿用原生出貨流程及正式通行證設定，更新文案以繁中、英文、日文內建。新的 App 不以只更新 BUILD 字串代替重新打包。

## 出貨驗收補正

v0909j 在公開站複驗時，日夜模組因既有 `*.mjs` 出貨排除規則回 404；立即回復 v0909i。v0909k 以單檔白名單修正，並在既有部署設定 gate 加入 529 個 runtime 資產的實際忽略規則檢查，移除白名單的反向對照必須失敗。

App 另保留同內容的 `sun.js` 入口，避免依賴舊 iOS `UTType` 是否識別 mjs；原生既有 js MIME 支援不變。出貨檢查比對這份別名與網站 sun.mjs 的 SHA256，並檢查 App 首頁確實引用 js。

## 驗收與交付

- 正式站版本 v0909k，來源 `64ef0473`，Cloudflare 版本 `b9142382-0148-4602-874e-4374e5468300`，100% 流量。HTML 1,616,762 bytes，MD5 `34558cbc2fe968f29c8def919785fd7b`，與乾淨出貨的去註解檔完全相同，API 200。
- 公開站日夜光影 56／56：雙引擎、360／375／390／414／520／768 px，晨昏、關閉還原、底圖重載、一般／全畫面觸控。八個主要入口／模組與工作樹雜湊一致，日夜模組 200、`text/javascript`。
- 合併後本機：日夜光影 56、控制操作 16、山坡 22、車頭鎖定 128、橋梁 14、搜尋 47 項通過；更新紀錄雙引擎四寬通過。完整 ship-web 出貨閘門通過，查詢矩陣 245／245。

### iOS 1.6.1 (106)

- 依 `ios-release.mjs feature` 完成完整六步，`ARCHIVE SUCCEEDED`。唯一 archive：`軌島-1.6.1-106-v0909k.xcarchive`，存於 Xcode Archives 的 2026-09-09 目錄。
- `verify_archive_ready.mjs` 全過：唯一 build、App 與 Widget 版號一致、小工具存在、零 beta OS 標記、穩定工具鏈、最低 iOS 15.0。
- Archive 的 2,166 個 web 檔案逐 byte 與 iOS 載貨相同；擴充資產 SHA256 閘門核對 1,510 檔、352,148,701 bytes，包含日夜模組 js 別名。
- 實際封裝 web 內容在 Chromium／WebKit 均完成開機、日夜變化、模型載入及跟車鎖定觸控驗收；無模組缺檔、page error 或水平溢出。這不是實體 iPhone 驗收。
- Android 打包後已將 `app/www` 還原為保存的 iOS 載貨，再次跑 archive-ready 全過。沒有重建或複製第二顆同號 archive。
- 使用者上傳路徑：Organizer 選 `軌島-1.6.1-106-v0909k` → Distribute App → App Store Connect → Upload；由此流程重簽。

### Android 1.6.1 (46)

- `bundleRelease assembleRelease` 完成，AAB／APK 各 2,168 檔與 Android native assets 逐 byte 相同，62 份 gzip 車庫模型完整。
- APK `apksigner verify` 通過 v2 簽章；AAB `jarsigner -verify` 回 `jar verified`。後者保留 Android 自簽金鑰／無時間戳及 ZIP manifest 順序的工具警告，未宣稱 Play 已接受成品。
- 直接讀取兩份封裝：BUILD v0909k、App 1.6.1、Android Plus 與 MetroCore 啟用、allowlist build 46、授權音樂／環境音／底圖啟用，日夜 js 入口與來源雜湊一致。
- 桌面交付資料夾：`軌島-1.6.1-20260909`，包含 AAB、APK、交付說明及 SHA256 manifest。交付副本與原成品雜湊一致。

| 成品 | bytes | SHA256 |
|---|---:|---|
| 軌島-1.6.1-46.aab | 243669541 | a320c29bd6f0d7edf00d091f2f9a2b3e7c3b29a2413aea29353c2eaf3a062ae0 |
| 軌島-1.6.1-46.apk | 241147882 | a9acae34127d8e1fa15312231bd40ad800d6b0f1ef6b05f8d6c9afe45ed46993 |

本輪未上傳 App Store Connect 或 Google Play，出貨基線不納入尚未上傳的 106／46。未執行本次成品的實機長時間驗收。
