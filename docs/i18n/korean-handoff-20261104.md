# 韓文版本交接：網站＋原生 App（2026-11-04）

網站與原生 iOS／Android 的韓文翻譯、語言選擇和載入接線已完成，留給 Claude 做最後語言／產品審查與上線。**未部署正式站、未更新商店、未推網站 main。** 網站 BUILD 仍為 `v0930b`，公開更新日誌與發行版號在 Claude 實際 ship 的同輪更新，避免尚未發布就對訪客宣告。

## 接手位置

- 網站根工作樹：`/Users/xuxiang/Code/捷運小動畫`，本輪基準 `9b92502e`。改動留在工作樹，未覆蓋原本既有的其他未提交檔案。
- 原生獨立 repo 工作樹：`/Users/xuxiang/Code/捷運小動畫/native/.claude/worktrees/codex-korean-1104`。
- 原生分支：`codex/korean-1104`，基準 `7cee2be9d`，主要 commit **`2d36751f687381a913ff492aaa927eb5fd34cc5f`**，假日用詞對齊 **`67425a32a4c80629f94d37d5a7d1f083fcce8759`**（分支 HEAD）。沒有合併 main、沒有改 App 版號。
- 原生詳盡交接：`native/.claude/worktrees/codex-korean-1104/docs/m9/lanes/korean-1104-handoff.md`。

## 網站交付

- `i18n/ko-translations.js`：**2,681 / 2,681** 個共用 UI／內容字串，24 篇特色列車、車種、支線長文與精選更新紀錄。
- `i18n/stations.json`：**542 / 542** 站名、**19 / 19** 路線、**10 / 10** 車種有 ko；原本 en／ja 保留。
- `i18n/ko-legal-translations.js`：**167 / 167** 法律字串，接上 privacy／terms。
- `i18n/ko-public-pages.js`：介紹、準確度、資料來源、車站索引、20 個車站資料頁與刪除帳號頁，共 **25 頁**，包括標題與描述。原始郵政地址保留中文，韓文標明是原文地址，便於現場辨識與複製。
- `weekend.html` 加韓文骨架、假日名及「中文原文」標示。活動與營運單位公告保持來源原文，政策與既有英日版一致。
- `index.html` 增加 한국어、ko／ko-KR 正規化、字典／站名／內容／更新紀錄載入與語言切換。韓文不套英文單複數。保留未知新增項目的英文退路，但完整度不把 fallback 算成韓文。
- `i18n/legal-pages.js` 識別 ko；public pages 相對連結會保留語言。只選擇該頁有提供的語言字典，避免僅提供中文／韓文的資訊頁在英文瀏覽器被誤標成英文。
- `scripts/build_aeo_pages.mjs` 的共用 layout 保留韓文 loader，之後重產穩定頁也不會掉。
- `scripts/check_i18n.mjs` 的重複鍵掃描加入韓文檔案；原本英日驗收條件沒有降低。
- 新增 `scripts/check_i18n_ko.mjs`、`scripts/verify_i18n_ko.mjs`。

網站應一起審查／收進同一輪的檔案範圍：

```text
index.html
weekend.html
privacy.html
terms.html
account-deletion.html
about/index.html
accuracy/index.html
data-sources/index.html
stations/index.html
stations/*/index.html
i18n/ko-translations.js
i18n/ko-legal-translations.js
i18n/ko-public-pages.js
i18n/legal-pages.js
i18n/stations.json
scripts/check_i18n.mjs
scripts/check_i18n_ko.mjs
scripts/verify_i18n_ko.mjs
scripts/build_aeo_pages.mjs
docs/i18n/korean-handoff-20261104.md
```

其他既有 dirty 檔案（如 package.json／lock、部署排除清單、縮時攝影腳本與大量未追蹤設計／驗證素材）不是本次韓文工作，勿一起 add。`native/` 是獨立 repo，不要由網站 repo 整包加入。

## 原生交付與結果

- App catalog **4,676 / 4,676** 個適用鍵；另外 80 個英文單數文法鍵不適用韓文。Android collect **23 / 23**、InfoPlist **4 / 4**、Android Widget XML **22 / 22**。
- 完整更新說明、日期／畫質等級、Widget／Live Activity 的 ko，以及原本只處理三語的選擇器、偏好／搬家接線均已補上。
- 網站固定快照 `ko-web-snapshot.json`（包含核心字典 SHA-256）與原生專屬 `ko-native-draft.json` 是翻譯來源。`python3 tools/import_korean_draft.py` 匯入；`--check` 只核對。
- 用 `git show 7cee2be9d:<file>` 比對：移除 ko 後，既有 App 字串、collect、InfoPlist、站名、長篇與版本說明各語言均保留；另外新增五個四語語言教學鍵。

## 本輪實際驗證

網站：

```sh
node scripts/check_i18n.mjs
node scripts/check_i18n_ko.mjs --release --report /tmp/railisland-ko-1104/coverage-final.json
```

兩者通過，韓文缺稿 0，placeholder 與 HTML 標記一致；新增活動頁假日名與主字典的逐字一致性檢查。Chromium（完整 Chrome 無視窗、Metal）＋WebKit 實跑 360／375／390／414／600／768 與 1280 桌面，共 **14 個主情境全部通過**，包括：

- ko-KR 自動辨識、query 優先、重整保存；真的 `page.tap()` 輪流切換四語。
- 預設、營運告警、全畫面、更多抽屜、車站看板、字級面板。
- 可見控件兩兩矩形相交、elementFromPoint 可達性、捲動容器與水平溢出。
- 台北／台中市政府區分、數量 1／2、站名與路線。
- 法律頁與 25 個公開資訊頁全文翻譯／水平溢出、活動頁韓文與中文來源標示。

結果：`/tmp/railisland-ko-1104/report.json` 的 failures 為空。`/tmp/railisland-ko-browser-final.log` 含額外法律／公開頁斷言結果。Chromium 與 WebKit 截圖已實際開圖確認。

瀏覽器命令（Playwright 安裝在本線 native build，避免變動專案依賴）：

```sh
RAIL_PLAYWRIGHT_MODULE='/Users/xuxiang/Code/捷運小動畫/native/.claude/worktrees/codex-korean-1104/build/playwright/node_modules/playwright/index.mjs' \
PLAYWRIGHT_BROWSERS_PATH='/Users/xuxiang/Code/捷運小動畫/native/.claude/worktrees/codex-korean-1104/build/pw-browsers' \
node scripts/verify_i18n_ko.mjs
```

原生：完整 iOS App／Widget build 成功，Android assembleDebug／測試 APK 成功；Swift 翻譯器 **15 項通過**，KMP 相關 XML **67 tests、0 failures、0 errors**；iOS 韓文首開＋可捲動觸控切換 **1 test 通過**；Android 韓文首開與語言設定 **4 tests 通過**。指令和證據位置見原生 handoff。iOS 與 Android 截圖已打開檢視。專用模擬器已收工，未碰既有實機。

## 審查時保留的決定

- 一般文案用 해요 體，法律用 합니다 體；品牌用 Rail Island。
- 台灣站名採一致韓文音譯，保留中文搜尋別名；同名市政府分系統，其他同名站保留地區辨識。參考台北捷運、台北旅遊、新北旅遊與台鐵韓文頁，但不宣稱 542 個譯名全是官方核定用字。
- xcstrings 保留 `needs_review`，標示尚待 Claude 最後審查，並非缺稿。
- 原生 RailPush backend 只支援 zh／en／ja，因此 ko 的來源推播目前選 en；沒有擅自向 server 寫入未支援語言。若要連伺服器產製的營運整理也輸出韓文，須在持有那份現行伺服器程式的整併環境另外處理，不能只放行 ko 值。
- 底圖地名由供應商提供，原始地址與官方公告不是 UI 字典；不做不可靠的逐字替換。

## 沒驗到與上線交棒

尚未驗 iPhone／A54 真機、主畫面上實裝 Widget、真實鎖定畫面活動與商店正式包；資源編譯、翻譯器、共享 payload 和模擬器原生 UI 已驗。使用者指定由 Claude 審查與上線，因此本線沒有部署。

Claude 請：審韓文語感／站名 → 合併本線 App 分支與網站明列檔案 → 依當下基準重驗 → 同輪補網站公開更新紀錄與 BUILD／App 發行版本 → 完成既有真機、Preview、正式站與商店流程。勿把目前 worktree 全部未提交檔案當成本線交付。

最後活動用詞對齊後只重跑原生 WeekendEntryTest：6 項通過。既有 67 項結果摘要保留，沒有重複加總。原生兩個 commit 均已備份至 origin/codex/korean-1104。

最後公開頁回退修正另驗 Chromium 與 WebKit：`/tmp/railisland-ko-public-final.log` 的 Chromium 段通過；WebKit 在快速離開地圖時曾把未完成 fetch 的導航取消回報為 access-control 錯誤。驗證程式改成等待 `window.railIslandPhysical` 真正載入後才離開地圖，再只重跑 WebKit，成功退出（`/tmp/railisland-ko-public-webkit-final.log`、`/tmp/railisland-ko-1104-final-pages-webkit/report.json`）。沒有忽略頁面錯誤或放寬斷言；桌面例外現在也會記入 failures。最初完整 14 情境的成功證據仍保留原路徑。
