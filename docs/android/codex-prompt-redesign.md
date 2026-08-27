# 派工：軌島 Android 追上「App 版面重整」——與 v16 線合流、平台適配、出下一顆 Play build

> 給 Codex 的完整派工單。使用者的要求逐字：「**不能漏掉任何東西**」。
> 這份文件的結構就是照那句話設計的——不靠人記，靠一道**會擋下你的閘門**（第三節）。

---

## 🔴 鐵則（第一行就要遵守；埋在中段的禁令視同不存在）

1. **你是這輪唯一負責人**。可開子 agent，但每個子 agent 的 prompt **第一行**必須帶上鐵則 2、3、4。
   子 agent 宣稱「已驗過」的事實你要自己抽測。
2. **只在指定的那一棵工作樹裡工作**（見第二節）。這台機器有 70+ 棵並行工作樹，其中好幾棵正被
   其他 session 使用且有未 commit 變更。**絕對不要進入或修改任何其他目錄**——包含主樹
   `/Users/xuxiang/Code/捷運小動畫`。
3. **git**：本樹內可 merge、可 commit，但**不准 `push`、不准 `rebase`、不准改寫既有歷史、
   不准切換或動到其他樹 checked-out 的分支**。
   - commit **不要帶 pathspec**（`git commit -m "..."` 就好——帶了 pathspec 會改用工作樹內容，
     精心做的 staging 全白做）。
   - commit 前 `git diff --cached --stat`、commit 後比對 `git show --numstat HEAD`；
     數字不符＝收到不該收的東西，`git reset --soft HEAD~1` 重來。
   - 合併衝突解完**先跑第三節的閘門再 commit**，不要「先 commit 再修」。
4. **`node_modules` 與 `app/node_modules` 是 symlink**（指向主樹）。不准 `npm install`／`npm ci`／
   刪除——動了會同時炸掉其他工作樹。
5. **隨做隨落檔**：每完成一項就寫進 `docs/android/PROGRESS-redesign.md`（新開這份）。
   連線斷掉時那份檔案是唯一存活的成果，不要只在最終回報才輸出。
6. `app/android/key.properties`、`app/android/app/google-services.json`、`app/release-policy.json`
   是本機檔（gitignored）：**不准 commit、不准把內容貼進回報**。取得方式見第六節。
7. **先做分辨實驗再改期望值**。驗收轉紅有三種互斥原因，修法完全相反：
   產品回歸／環境條件（缺 token、深夜沒車、缺旗標）／判準過期。
   把缺的環境條件補上重量一次——數字會變的那些就是環境，不是回歸。
8. **第一步先自檢環境**：確認你在這棵樹裡打得到網路、跑得動 `git merge`／`git commit`、
   起得了本機 server、開得了 Playwright 瀏覽器。**打不到的當場回報停手**，不要繞路、不要假裝做到。

---

## 二、現況（每一項都是實測值，不是回憶）

| 事實 | 值 |
|---|---|
| 版面線（要併進去的內容） | 分支 `build/redesign-901`，**本機分支未 push**，在 `.claude/worktrees/app-redesign` |
| Android 線（現行出貨線） | 分支 `codex/android-plus-v16`，tip `f6ad132`，在 `.codex/worktrees/android-plus-v16` |
| 兩者的 merge-base | `4ae2cf1` |
| 版面線比 Android 線多 | **64 顆** commit |
| Android 線比版面線多 | **7 顆** commit（含 `index.html` 424 行、`worker.js`、`privacy.html`、`terms.html`） |
| Android 專案位置 | `app/android/`（**不在 `origin/main` 上**，只活在 App 出貨線與其下游） |
| Android 現行版號 | v16 線：`versionCode 16` / `versionName "1.4.11"` |
| iOS 對照 | 本樹 `MARKETING_VERSION 1.4.10`、`CURRENT_PROJECT_VERSION 902`（902 是真機測試顆，非上架號） |
| 舊的 `軌島-Android` 工作樹 | `feat/android-shell` `fbb7547`——**已是版面線的祖先且落後 459 顆，這輪不要用它**，
它唯一還有價值的東西是裡面的三個 gitignored 本機檔（第六節） |

**在哪裡工作**：建議在 `.codex/worktrees/android-plus-v16` 這棵樹裡開新分支
（`git switch -c codex/android-redesign-v17`）。若該樹被別人佔用，回報後改由使用者指派。

---

## 三、🔴 這輪最大的風險，以及唯一該相信的閘門

兩條線**同時在改 `index.html`**。這個 repo 在 2026-08-23 被同一種形態咬過一次：
一顆合併把 `index.html` **整檔取單邊**，凡「只活在另一側」的東西當場全消失——
跟車鎖屏的通行證入口、衛星高解析提示、說明中心兩整節、前景持續定位、11 條更新紀錄，
共 18 項。**build 成功、archive 成功、既有 verify 全綠**，使用者是在 **App Store 上架之後**
才發現的（商店描述還寫著一個不在裡面的功能）。

我已經先量過：**如果你直接拿版面線當結果**，會少掉 Android 線這些東西——

```
FAIL 函式            少 1：metroWaitOfferLiveUpdateSettings
FAIL 更新紀錄條目    少 3：androidnowbar、androidplus、apprestore
FAIL 方案面板功能項  少 1：「捷運小工具可在桌面放多站，或用『自動（最近的站）』跟著你移動換站」
FAIL 旗標／閘門常數  少 1：ANDROID_PLUS_SANDBOX_OK
```

### 閘門：`scripts/verify_merge_no_loss.mjs`（版面線帶進來的新檔）

合併完、commit 前**必跑**：

```bash
node scripts/verify_merge_no_loss.mjs --parents codex/android-plus-v16 build/redesign-901
```

判準：合併結果的七類**識別字**（函式／元素 id／更新紀錄 `data-cl`／說明中心節 key／
方案面板功能項／旗標常數／URL 參數）必須是「**兩個父分支的聯集**」的超集。
判準刻意不逐行比對——行會被重排、改寫、搬檔，逐行會噴滿假陽性，而「這個東西還在不在」對搬家免疫。
它另外附一條「整檔取單邊」的一句話檢查（結果與任一父逐 byte 相同就直接紅）。

- **紅了不准調期望值放行**，先回去把那一側的內容併回來。
- 唯一的例外出口是 `--allow <識別字,...>`：**只有在你能指出「另一側有一顆 commit 刻意刪掉它」**
  時才可以用，並把那顆 commit 的 hash 寫進 commit 訊息。
  已知一例：`TRTC_OFFICIAL_SNAP_TAU_SEC` 在 `236acbf`（位置模型改成錨定發車）被刻意移除，
  若它出現在清單裡屬此類，不是回歸。
- 這支已用真合併做過正反對照：拿一顆真的合併當候選＝全綠；拿「還沒併」的狀態當候選＝紅並逐項列出。

### 出貨鏈上還有第二道（不要跳過）

`app/scripts/verify_no_ship_regression.mjs`（已接進 `verify-release.mjs`）比對的是
「這一顆 vs **已經在使用者手上的 build 的聯集**」。它與上面那支互補：
上面那支看「合併的兩側」，這支看「已上架的東西」。兩支都要綠。

---

## 四、版面重整這批到底有什麼（逐項檢查表）

下表就是版面線相對 Android 線多出來的**版面內容**（其餘 34 顆是 `origin/main` 與 App 出貨線的
一般更新，靠第三節的閘門自動涵蓋）。每一列都給 commit hash——`git show <hash>` 就是那一項的
完整定義，比任何我手打的選擇器都準。

| commit | 內容 |
|---|---|
| `4ff897d` | 護照：成就與收集章說明卡——桌面 hover、手機點按，含進度 |
| `d0b9406` | 更新紀錄：成就說明卡兩層條目 |
| `cb5b36c` | **三階字級**（標準／大／特大）——`html[data-fs]` ＋ `--ui`／`--uis` 倍率 |
| `01924ac` | 上緣堆疊改從量到的頂列實高推（`--tb-h`），不再用寫死的 58px |
| `2dd68c6` | 「顯示與字級」面板（設計 6a）——跟隨系統開關＋即時預覽 |
| `f1f31ed` | 車站看板列三階版面（設計 6b） |
| `6510ddb` | 第二條倍率＋「更多」抽屜三階（設計 6c） |
| `df393f1` | 第三條倍率（觸控目標與章）＋護照章三階（設計 6d） |
| `6c5c941` | **設計 D4 頂列排法B**——兩層併一層，狀態字樣搬進「更多」 |
| `c723459` | **設計 D1–D3 整合卡**——跟車中開看板變成同一張卡兩分頁（`.uni-tabs`／`.uni-slot`） |
| `4003dd5` | 設計 1a 膠囊態——點地圖空白收成膠囊但跟車不斷（`body.cfaint`／`body.cexp`） |
| `586c3c3` | 修：展開中的班次列不再被 20 秒重繪收回去 |
| `77b60ca` | 設計 3a 詳細資訊卡——一個捲軸從摘要接到停靠表 |
| `b524f91` | 設計 3e 今日之最四格 |
| `354677e` | 設計 3h 搜尋——聚焦藏青框、清除鈕 44 熱區、查無結果給下一步 |
| `87240e1` | 設計 3f 我的最愛——右欄一顆星就是唯一的移除入口 |
| `85bec5e` | 設計 3g 旅程護照——三格統計＋章面印下蓋到的日期 |
| `894a063` | 設計 3d 更多——每一列左邊一顆單字圓章（⚠️ 已於 2026-08-27 整組拿掉，見下方「本輪新增」） |
| `b473be7` | 設計 14c 空狀態——四處一律 1.5px 虛線框 |
| `2c3b9d3` | 設計 14g 落釘模式常駐提示 |
| `1d2bf0d` | 設計 16e 車種 chip 關閉態——空心圓點，顏色留著 |
| `f11073e` | 設計 16e 全日流量圖（`#flowChart`）——當下那根塗印章紅，色票跟著主題翻面 |
| `1c91af5` | 設計 16b 捷運看板每條線一個組標題 |
| `49aa5c6` | 設計 16f 站內回報表單——寫一句話，帶著現況去開 GitHub issue |
| `780a6b8` | 修：特大級「更多」列的標籤被擠到第三行 |
| `82cf672` | 看板：有組標題時列上只留標題沒講的那件事（分支），不跟目的地重複 |
| `0199ce3` | 真機測試顆 901——補回合併漏掉的 `--sa-t`，登記底圖提示的 toast 指紋 |
| `42d7de2` | 修：頂列長高時上錨元件讓位、看板開著點空白處收掉（`tapBlank()`） |
| `89fee60` | 真機測試顆 902（`v0826b`） |
| `23ac887` | **車站資訊欄兩段制**（大段退役）、看板 ✕ 觸控放大、**橫式版面 §04c v2** |

**本輪新增（2026-08-27，在最後一顆 commit 裡）**

| 項目 | 使用者看得到什麼 | 錨點 |
|---|---|---|
| **頂列四顆分頁收成一顆** | 手機殼（含橫式）三個字級一律：`[軌島牌][時鐘膠囊][⚠ 公告][一顆群組鈕]` 單排；點群組鈕跳出四列選單（全台同框／台鐵／高鐵／捷運與輕軌），點一列就換組並收起來，Esc 與點外面也收。桌面（>900px）維持 header 上的四顆分頁不變 | `#gtabOne`／`#gtabPop`／`renderGtabPop()`／`gtabPopPlace()`／`setupGtabPop()`；CSS 在 `body.fs .topbar { flex-wrap: nowrap }` 那一段 |
| **左上換回長方形文字牌** | 08-22 D4 換上的 42×42 方形 logo 讓位，含起訖站帶的長方形「軌島」牌回來（兩者 DOM 都留著，換回去只要改一條 `display`） | `body.fs .topbar .tb-logo { display: none }` |
| 使用說明兩節新增 | 「切換：全台／台鐵／高鐵／捷運」與「點時鐘＝現在的資料是不是即時的」兩節，各自的「試一次」在手機真的打開對應的東西；桌面沒有那顆收合鈕時給指路吐司 | `HELP_GROUPS` 的 `groupswitch`／`datastatus`，`HELP_TRY` 同名兩項 |
| 更多選單去圓章 | 每一列前面那顆單字圓章整組拿掉（含它撐出來的縮排） | `.ms-ic` 只剩註解，`index.html` 搜 `ms-ic` 應為 2（都在註解裡） |
| **資料狀態小卡** | **點時鐘徽章**跳出一張卡，逐列寫現在是 `LIVE` 還是 `非即時`、捷運看板狀態、時段、車數，並把每顆燈 `title` 裡的「為什麼」（資料幾分鐘沒更新／裝置時鐘差幾秒／時間軸不在現在）攤出來 | `#statPop`／`#statBadge`／`statPopRender()`／`setupStatPop()` |
| 字樣「推估」→「非即時」 | 時鐘旁的灰字改成「非即時」；「更多 → 資料狀態」的後綴同步改成「・非即時」 | `updateLiveBadge()`、`syncMoreDataStatus()` 的 `mirror` |
| 橫式觀察模式出口 | 橫放進放空模式時，速度膠囊**不淡出**（「離開放空」就在裡面），其餘工具堆／合併卡／站名牌才淡 | `body.fs.ambient.sheet-open .controls` 那三條覆蓋 |
| **修：分頁列上方卡著一條空白** | 橫放跟車時站名牌會併進卡頭把分頁列往下推；牌搬走之後分頁列**回不到原位**，上方永遠留一條約 42px 的白。改掉之後會跟著牌一起回去 | `natTop()`＋`syncBoardHeadVar()`。根因：`.uni-tabs` 是 `position:sticky`，而 **sticky 元素的 `offsetTop` 含它自己被 `top` 推下去的量**，那個 `top` 正是這支要算的 `--board-head-h` ⇒ 自我維持。修法是量測期間暫時 `position:static`，讀完立刻還原 |

---

## 五、Android 平台適配（合併後逐項做）

1. **資料狀態小卡在 WebView 的可點性**：它掛在 `body` 層、`z-index:1200`，開關靠
   `pointerdown`（捕獲階段）與 `#statBadge` 的 `click`。`.topbar` 本身是
   `pointer-events:none` ＋白名單，`.topbar .badge` 已在白名單裡——**真機點一次確認**，
   不要只在 DevTools 呼叫 `.click()`（那條路徑繞過 hit-test，白名單漏掉也會過）。
2. **系統字級縮放會疊在三階字級上**：Android 設定把字體與顯示大小都開到最大，再切「特大」階，
   量頂列四顆分頁與底部 tab bar 沒有跑出視窗、沒有被自己的框切字。
3. **橫放**：`AndroidManifest` 沒鎖向，橫式 §04c v2 會生效。實測：觀察模式（頂列與速度膠囊留著、
   其餘淡出、按「離開放空」真的出得來）、站名牌 dock 進卡頭、特大階提示卡。
4. **安全區**：v16 線已修的 Android 15 edge-to-edge 與導覽列避開**不可退掉**；
   版面線的上錨元件改吃 `--tb-h`（量到的頂列實高），兩者要一起成立——
   真機同時測手勢導覽與三鍵導覽。
5. **「更多」列的更新那一列**：去圓章之後，寫入選擇器是 `span:not(.chev)`
   （寫錯會把列尾的「›」換成整句話）。v16 若也動過那一列，取聯集後兩邊都要驗。
6. **Android 沒有的東西維持優雅缺席，不是壞掉**：Apple lookup 版本源、App Store 評分深連結、
   iOS 原生音樂 plugin、WidgetKit 小工具。這些在既有派工單
   `docs/android/codex-prompt-catchup-142.md` 第 B 節有逐項寫法，沿用即可。
7. **版號**：先確認 `versionCode 16` **有沒有真的上傳到 Play**
   （查 `docs/android/PLAY-RELEASE-v16.md` 的紀錄，或請使用者看 Play Console）。
   上傳過 → 這顆用 `17`；沒上傳過 → 沿用 `16`。`versionName` 維持 v16 線的 `1.4.11`，
   **不要往回改小**。
8. **R8 刻意不動**（`minifyEnabled false`）：開 R8 需要完整 release 回歸，另開批次。

---

## 六、本機檔（gitignored，缺了就 build 不出簽章版）

| 檔 | 版面線這棵樹 | 舊的 `軌島-Android` 樹 |
|---|---|---|
| `app/android/key.properties` | **缺** | 在 `/Users/xuxiang/Code/軌島-Android/app/android/key.properties` |
| `app/android/app/google-services.json` | **缺** | 在同樹同路徑 |
| `app/release-policy.json` | 在 | 在 |

複製過來即可（**只複製、不要 commit、不要把內容貼進回報**）。
upload keystore 在 `/Users/xuxiang/Keys/railisland/railisland-upload.jks`（repo 外），
兩組密碼在使用者的密碼管理器，**任何 AI 都不經手**。
`signingConfigs.release` 存在才簽，不存在就產 unsigned——**刻意不 fallback debug 簽**。

---

## 七、驗收（每項要證據；截圖存 `docs/android/shots/`）

### A. 合併本身

```bash
node scripts/verify_merge_no_loss.mjs --parents codex/android-plus-v16 build/redesign-901
```
→ 必須「兩個父分支的識別字聯集一個都不少」。

### B. 網頁層（在合併後的樹裡跑；需要 playwright）

```bash
PORT=5261 node scripts/dev_server.mjs &
node scripts/verify_font_scale.mjs      # 字級三階＋版面重整全批（含新增的 SP 段：資料狀態小卡）
node scripts/verify_landscape.mjs       # 橫式 §04c v2（含 V3b/V3c/V3d：放空模式進出往返；
                                        #   L4s1–L4s4：natTop 機制，不需要車、任何時段都跑得動；
                                        #   L4i：牌搬出去之後分頁列回得到原位＝端到端那條，
                                        #        它掛在「抓得到行駛中的台鐵車」底下，深夜會整組跳過）
node scripts/verify_sheet_sizes.mjs     # 車站資訊欄兩段制
```

**本輪基準**：`docs/android/PROGRESS-redesign.md` 第一節那張表（版面線 `build/redesign-901`
2026-08-27 深夜實測，含「已知的環境相依紅」逐條）。合併後的數字**只准比它好**，變差就是
合併把東西弄掉了。深夜捷運收班會讓一批捷運看板判準整批轉紅——照鐵則 7 做分辨實驗：
把同一批段別對「合併前的樹」再跑一次，FAIL 清單**逐項相同**＝環境條件，不是回歸。

### C. 出貨鏈

```bash
RAIL_INCLUDE_LICENSED_BASEMAPS=1 RAIL_INCLUDE_LICENSED_MUSIC=1 npm run build
npx cap copy android
RAIL_VERIFY_NATIVE=android npm run verify     # 含 verify_no_ship_regression
# Gradle bundleRelease / assembleRelease——確切指令以 docs/android/PROGRESS.md、
# PROGRESS-STAGE2.md 的紀錄為準，不要自己發明
```

### D. 真機／模擬器（release APK，`RailIsland_API35_Pixel7` 可 adb install）

1. 冷啟動不 crash、地圖畫出來**且畫面上有列車**。
2. **點時鐘徽章 → 資料狀態小卡跳出來**，卡上寫著 `LIVE` 或 `非即時`，下方有「為什麼」那段字；
   按 ✕、按卡外、按返回鍵都收得掉。
3. 「更多」選單：每一列前面**沒有**單字圓章；「軌島」節與評分列在；點評分列開 **Play 商店頁**。
4. 字級切「特大」：頂列四顆分頁與 tab bar 都在畫面內、沒有切字；
   頂列變成兩排（分頁在上、時鐘與 ⚠ 在下）。
5. **橫放**：觀察模式進得去也出得來；站名牌 dock 進卡頭；跟車時列車落在露出地圖的中心。
6. Android 通行證（v16 線帶進來的）：入口與 `ANDROID_PLUS_SANDBOX_OK` 的行為與 v16 一致，
   沒有被版面線的合併退掉。
7. AAB 的 `versionCode`／`versionName` 實際值（`bundletool dump manifest` 或 `aapt`）符合第五節 7。

---

## 八、回報格式

- 只回：**結論、關鍵證據（檔案:行號、截圖路徑、指令 exit code 與關鍵輸出行）、風險與未確定點**。
- AAB 與 APK 的完整路徑＋SHA-256。
- 長內容一律寫進 `docs/android/PROGRESS-redesign.md`，回報只給路徑。
- 做不到的事（環境缺件、權限擋住、網路打不通）**如實回報停下**，不要繞過、不要假設成功。
- **不要 push、不要上傳 Play**——上傳由使用者本人決定時機。
