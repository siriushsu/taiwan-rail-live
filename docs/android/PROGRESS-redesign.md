# Android × App 版面重整：進度與基準

> 派工單：[`codex-prompt-redesign.md`](./codex-prompt-redesign.md)
> 這份檔案是**隨做隨落檔**用的（派工單鐵則 5）。連線斷掉時它是唯一存活的成果。

> 派工單：[`codex-prompt-redesign.md`](./codex-prompt-redesign.md)
> 這份檔案是**隨做隨落檔**用的（派工單鐵則 5）。連線斷掉時它是唯一存活的成果。

### Codex 執行環境

| 項目 | 結果 |
|---|---|
| 指定工作樹 | `/Users/xuxiang/Code/捷運小動畫/.codex/worktrees/android-plus-v16` |
| 工作分支 | `codex/android-redesign-v17`（由 `codex/android-plus-v16` 的 `c060425` 建立） |
| 工作樹狀態 | 建分支前乾淨，無 staged／unstaged 變更 |
| 版面線 | `build/redesign-901`；本輪合入 tip `75a64e4`（產品載貨 `9dda053`） |
| merge-base | `4ae2cf1a81f3cd49723bfd9738b23ade5cee3f35` |
| 網路 | `https://railisland.tw/` 回應 HTTP 200 |
| Playwright | bundled Chromium 可成功 launch／close |
| npm 依賴 | 不執行 `npm install`／`npm ci`；沿用既有 `app/node_modules` |
| 本機 release 檔 | `app/release-policy.json`、`key.properties`、`google-services.json` 已就位且保持 gitignored |

---

## 一、合併前的基準（版面線 `build/redesign-901`，2026-08-27 深夜實測）

合併後在**同一棵樹**重跑同一批腳本。

🔴 **比法是「FAIL 名單逐項比對」，不是數字比大小。** 這些腳本有一部分的紅是**時段相依**的
（深夜台鐵收班、捷運收班就整組沒車可量），所以同一棵樹在早上跑跟半夜跑，總數本來就不一樣，
拿數字比會得到假訊號。正確的判準只有一個：

> **合併後出現的 FAIL，每一項都要能在下面這兩份原始輸出裡找到同名的那一條。**
> 出現新名字＝合併把東西弄掉了，不管總數是多少。

原始輸出（合併前，2026-08-27 03:0x 實測，逐行完整保留）：
- `docs/android/_baseline-font-scale.txt`
- `docs/android/_baseline-landscape.txt`

> 🔴 **這兩份基準停在 `0514242` 那一輪，之後的「頂列收成一顆」那顆已經讓它們過期**：
> `verify_font_scale` 多了一整個 TB 段（+329 條），A／X／Y 段的判準名稱也因為四顆分頁收合而改過
> （`A1 正向對照:群組切換器量得到…`），`verify_landscape` 的 `L10` 改名成「分組切換」。
> **派 Codex 之前要先在這棵樹重跑一次全矩陣重產這兩份檔**，否則 `comm -13` 會把「改過名字的判準」
> 一律報成新的紅（心得 32：拿釘死的舊產物當比對基準，全綠與全紅都是假的）。
> 重產指令：
>
> ```bash
> PORT=5741 node scripts/verify_font_scale.mjs > docs/android/_baseline-font-scale.txt 2>&1
> node scripts/verify_landscape.mjs > docs/android/_baseline-landscape.txt 2>&1
> ```

取 FAIL 名單的指令：

```bash
grep '^FAIL' docs/android/_baseline-font-scale.txt | sed 's/ — .*//' | sort > /tmp/before.txt
grep '^FAIL' <合併後的輸出>                        | sed 's/ — .*//' | sort > /tmp/after.txt
comm -13 /tmp/before.txt /tmp/after.txt   # 這裡有東西＝新的紅＝要查
```

| 腳本 | 通過／總數 | 紅的那些是什麼 |
|---|---|---|
| `scripts/verify_font_scale.mjs`（全段，chromium＋webkit） | **1058／1080** | 全部 22 條都是 `V` 段（`V1`–`V6`、`V12`–`V15` 各兩個引擎，外加該段拋例外的 `V✱`）＝深夜捷運收班、古亭看板沒有列可量。另外 `E4c`／`E4e` 在台鐵只剩一班時也會紅（同一晚較早那輪就紅過，這輪台鐵班次變了就綠了）——**同一棵樹不同時段紅的組成會變，這正是不能用數字比大小的原因** |
| `scripts/verify_landscape.mjs`（全尺寸，chromium＋webkit） | **33／91** | 12× `L0`、12× `L13`、6× `L5`、6× `L10`、2× `F0`、2× `V1`、6× `V4`、2× `P4`（全部自報「深夜無台鐵車＝環境條件」）＋2× `L9`／`L15b`（前面沒車可量的下游覆蓋率）＋6× `L6/L7`（既有的零回歸差異） |
| `scripts/verify_sheet_sizes.mjs` | **37／37** | — |
| `scripts/verify_merge_no_loss.mjs` | 對照組全綠、突變組逐項轉紅 | — |

**這些紅不是本批造成的——已經用控制組證明過（心得 34 的分辨實驗）：**
在**乾淨的基線樹**（`.claude/worktrees/redesign-base`，detached 在 `23ac887`、零未 commit 改動）
跑同一支 `verify_landscape.mjs`，得 25／83，而兩邊的 **FAIL 名單逐項完全相同**
（58 條同名、只在工作樹紅的 0 條、只在基線樹紅的 0 條）。
83→91 那 8 條差額，正好是本輪新增而且全綠的 `L4s1`–`L4s4`（兩個引擎各一份）。

### 已知的環境相依紅（不是回歸，不要照著改期望值）

深夜捷運收班之後，古亭站看板沒有列可量 ⇒ `verify_font_scale` 的 **V 段**（捷運看板組標題那批：
`V1`–`V6`、`V12`–`V15`，兩個引擎各一份，外加該段拋例外的 `V✱`）整批轉紅；台鐵班次剩一班時
`E4c`／`E4e`（看板重繪的正向對照與對照組）也會紅。

**分辨方法（派工單鐵則 7）**：把同一批段別對「合併前的樹」再跑一次，
FAIL 清單**逐項相同**＝環境條件，不是回歸。2026-08-27 就是這樣分辨的——
基線樹（`23ac887`）與工作樹跑 `SECTIONS=E,L,V`，FAIL 名單一字不差。

`L12`（展開段那一頁不是透明的）在其中一輪 full run 出現過一次紅，同一支腳本連跑兩輪各 25/25 通過，
基線樹也沒有——**間歇性**，不是本批造成的。再看到它先重跑一次再判斷。

`I6`（徽章藏起來 ⇒ 該列整列消失）也曾在 full run 的 chromium 紅過一次、單獨重跑兩輪全綠。
這一條**已經找到根因並修掉**，不再是間歇性：`updateLiveBadge()` 每一拍都重寫
`liveBadge.hidden`，而測試的 `open()` 中間有 600ms 等待 ⇒ 產品的下一拍會把測試設的 `hidden`
撤銷，`I6` 就以 `drawn=true h=48`（跟 `I7` 的期望值一模一樣）報一個**假的產品失敗**。
修法是量測期間把那支重繪凍住，並新增 `I6a` 這條**前置條件斷言**（心得 17：前置沒成立就不能
拿結果當產品判準）。突變測試已確認 `I6` 仍有牙：把 `.ms-stat` 改成 `display:flex !important`
之後，`I6` 兩個引擎都紅而 `I6a` 保持綠。

---

## 二、合併與驗收進度（Codex 隨做隨填）

| # | 事項 | 狀態 | 證據 |
|---|---|---|---|
| 0 | 環境自檢（網路／git／server／playwright） | ☑ | 正式站 HTTP 200；本機 server 與 Chromium 可啟動 |
| 1 | 建分支 `codex/android-redesign-v17` | ☑ | `958bf97` 建立進度帳本 |
| 2 | `git merge build/redesign-901` 並解衝突 | ☑ | 依派工指定合入 tip `75a64e4`；衝突僅 `index.html`／`privacy.html`／本檔，皆做語意聯集 |
| 3 | `verify_merge_no_loss.mjs` 兩側聯集零缺 | ☑ | 對派工固定點 `75a64e4` exit 0；兩側聯集為函式 1179、id 365、更新紀錄 101、說明 29、方案 9、常數 311、URL 7，候選另多出台鐵等車說明（候選說明共 30） |
| 4 | 平台適配（派工單第五節逐項） | ☑ | `nowrap` 與兩處牌面 `white-space` 均保留；台鐵等車卡已補 Android Now Bar／鎖屏對應及獨立使用說明；WebView／字級／停靠站牌已真機通過；官方 `@capacitor/app 8.1.1` 與可取消的 `rail:native-back` 浮層收合流程已納入正式候選包 |
| 5 | 本機 gitignored 檔就位 | ☑ | 簽章、Firebase、release policy、授權底圖 key 與 RevenueCat Android `goog_…` public SDK key 均已就位；文件與驗收輸出只核對 key 的存在與長度，不洩露值 |
| 6 | 網頁層四支腳本 | ☑ | 字級 1460/1460；TB 329/329；sheet 37/37；橫式 1021/1027 且 6 個 FAIL 皆在舊基準；半透明 157/210，新增紅全為派工單已核可的衛星殘差 |
| 7 | `RAIL_VERIFY_NATIVE=android npm run verify` | ☑ | exit 0；要求 Android native、Metro Core、版本 1.4.11、versionCode 16，全部通過 |
| 8 | Gradle bundleRelease／assembleRelease | ☑ | 正式候選 `./gradlew clean bundleRelease assembleRelease`：BUILD SUCCESSFUL（388 tasks）；APK 通過 apksigner v2，AAB 通過 jarsigner，正式 RevenueCat Android public key 已進包 |
| 9 | 模擬器／真機七項驗收 | ◐ | SM-A5460／Android 16 instrumentation 11/11；`v0827e` release APK 已覆蓋安裝且直式冷啟動正常。既有字級、群組鈕、半透明、停靠牌、縮放、橫式、觀察模式與音樂連網／飛航各 8 次皆已在同機驗過；本顆新增 v3／v4／v5 橫式與返回鍵實按因安裝後 ADB 連線中斷，尚待補最後一輪 |
| 10 | AAB／APK 路徑與 SHA-256 | ☑ | 正式候選 AAB `7435e8b9…c83b90dc`；APK `9f3f3ceb…6ff4ac8`，完整值見第五節 |
| 11 | 57 首曲庫／App 只內建 12 首 | ☑ | 指定 `069c1d7`＋`becb59c` 已合入；原始 57 首／六個歌單，Android asset 12／6／0，release gate 與簽章全綠；Samsung 連網／飛航各 8 次換首全數持續播放且 App 未當掉 |

---

## 三、風險與未確定點（Codex 隨時追加）

- Play Console 已唯讀確認最高上傳 `versionCode 15`，本顆維持 `versionCode 16`／`versionName 1.4.11`。
- `worker.js`／`privacy.html` 已做語意聯集並通過 release gate；`terms.html` 沒有 merge 衝突。
- 先前缺少的官方 `@capacitor/app` 與 RevenueCat Android `goog_…` public SDK key 已在第五節這顆正式候選包補齊；舊測試包的「不可上傳 Play」限制不再套用於 `v0827e`。返回鍵程式已完成，但仍須在 ADB 恢復後實按確認浮層先收、App 不退到背景。
- `.gp-row` 真機實高約 124 physical px；450 dpi 對應約 **44dp**，低於 Android 建議的 48dp。依派工單不擅自改值；建議 iOS 判準另行核可後再一起改成 48dp。
- 工作期間 `build/redesign-901` 在 12:35 又由派工固定點 `75a64e4` 前進到 `754fcac`，新增音樂、台鐵等站說明與 iOS 1.5.0 (80) 送審設定。Android 已因本輪實作的台鐵等車卡補上同內容說明；音樂則在使用者後續明確加派後納入。iOS 送審版號不在本輪 Android 範圍，未帶入。
- 使用者已於同日明確加派音樂載貨；本輪只補指定的 `069c1d7` 與 `becb59c`，不帶入同分支後續的 iOS 1.5.0 (80) 送審版號。兩顆均以三方套用乾淨進入目前 merge，`index.html` 沒有整檔取單邊。

## 四、本輪驗收摘要（2026-08-27）

- `PORT=5261 SECTIONS=TB node scripts/verify_font_scale.mjs`：exit 0，329/329。
- `PORT=5261 node scripts/verify_font_scale.mjs`：exit 0，1460/1460。
- `PORT=5261 node scripts/verify_sheet_sizes.mjs`：exit 0，37/37。
- `PORT=5261 node scripts/verify_landscape.mjs`：exit 1，1021/1027；6 個 FAIL 全是既有 `L6/L7`，`comm -13` 對舊基準為空。
- `PORT=5261 node scripts/verify_translucent_contrast.mjs`：exit 1，157/210；對 `23ac887` 同腳本控制組 162/210。候選新增的 8 個 FAIL 全在衛星底圖情境，符合「亮色 .55／暗色 .30」已核可殘差；非衛星有 3 個舊 FAIL 消失。
- 含授權音樂／底圖的本機 Android 測試 build：exit 0；Widget parity 6/6、六個 iOS 自訂 plugin 均有 Android 對應、no-ship-regression 1834 identifiers 無缺、release check 全綠，輸出 178 files／146.3 MB；RevenueCat 使用假 public key，產物不可上傳 Play。
- `RAIL_VERIFY_NATIVE=android RAIL_REQUIRE_NATIVE=1 RAIL_EXPECT_METRO_CORE=1 RAIL_EXPECT_APP_VERSION=1.4.11 RAIL_EXPECT_ANDROID_VERSION_CODE=16 npm run verify`：exit 0。
- `node scripts/verify_tra_wait_core.mjs`：48/48；`node scripts/verify_tra_wait_push.mjs`：80/80；`node app/scripts/verify_tra_wait_ui.mjs`：89/89。
- `:app:connectedDebugAndroidTest`（並存測試包 `tw.railisland.app.v16test`）：exit 0，SM-A5460／Android 16 共 11/11；涵蓋 Metro／台鐵等車卡、Android 16 `ProgressStyle`、Now Bar promotion、bounded end time 與不使用假倒數。
- 真機 WebView `151.0.7922.170`：`backdrop-filter: blur(6px)` 有生效；看板／附近車站內容捲到標題列下方會糊成色塊，不需要 `.92` fallback。證據：`docs/android/shots/redesign-v17/railisland-v16-translucent-scroll.png`。
- 真機字級三檔：標準＝`LIVE` 文字＋捷運色點；大＝`LIVE` 文字＋捷運色點；特大＝即時色點＋捷運色點。三檔頂列均單排，沒有 1px 壓扁或方形色點；`metroBadge` 始終先於 `liveBadge` 降級。證據：`standard-all-final.png`、`large-all.png`、`xlarge-all.png`。
- 真機群組選單：觸控可開、四列可選、點外收合；`.gp-row` 約 44dp。證據：`docs/android/shots/redesign-v17/railisland-v16-group.png`。
- 真機時鐘徽章：點擊可開資料狀態卡，卡內有「即時資料／捷運看板／目前車數」及原因說明，點卡外可收；實體返回鍵會把 App 帶到背景，列入上方官方 plugin 缺件。證據：`docs/android/shots/redesign-v17/railisland-v16-status-card.png`。
- 真機停靠牌：台鐵 6652 停靠頭城時約 **186×59dp**，直式置中，未遮住頂列／工具欄，地圖仍可見。證據：`docs/android/shots/redesign-v17/railisland-v16-dwell-6652.png`。
- 真機橫式／觀察模式：橫式頂列單排、長方形軌島牌保留，觀察模式可進、保留頂列，並可由「離開放空」回一般模式。證據：`railisland-v16-landscape.png`、`railisland-v16-landscape-ambient.png`。
- 真機衛星縮放：以 Android mouse wheel 輸入實際觸發 Leaflet zoom 並以 screenrecord 逐幀檢查；`zoomAnimation:false` 讓底圖與 canvas 同步瞬跳，沒有舊版 250ms 兩層錯位。新圖磚下載期間只短暫露出底色。證據：`railisland-v16-zoom6.mp4`、`railisland-v16-zoom6-transition.png`。
- 驗收後已恢復手機原本設定：字級「標準」、群組「全台同框」、面板半透明關閉、自動旋轉開啟、App 省電模式開啟、背景音樂停止、媒體音量 0、飛航模式關閉、USB 常亮值回到 1；衛星影像維持原設定。
- `./gradlew clean bundleRelease assembleRelease`：exit 0，BUILD SUCCESSFUL。
- AAB：`app/android/app/build/outputs/bundle/release/app-release.aab`，SHA-256 `abba1744c96912de8f3ccfaf77d7b52db49aa97281ca991932f46b0dd4ab987a`；`jarsigner -verify` exit 0（`jar verified`）。
- APK：`app/android/app/build/outputs/apk/release/app-release.apk`，SHA-256 `5758057f45b02761c3e4bd2abbaf4e7f9b0508f7e170720a374d5055904f4169`；`apksigner verify` exit 0，v2 簽章、signer `CN=railisland-upload`。
- APK manifest：package `tw.railisland.app`、versionCode `16`、versionName `1.4.11`、minSdk 24、targetSdk 36；內嵌 `BUILD v0827c`、Android Plus 與 Metro Core 皆開啟。
- 最終本機測試 APK 已用 `adb install -r` 覆蓋安裝成功；手機 `dumpsys package` 為 versionCode 16／versionName 1.4.11，`lastUpdateTime=2026-08-27 13:09:08`；冷啟動後 `MainActivity` 在前景執行。主畫面證據：`docs/android/shots/redesign-v17/railisland-v16-final-installed.png`。

### 音樂曲庫加派（`069c1d7`＋`becb59c`）

- 合併防漏改以 `codex/android-plus-v16`＋`069c1d7` 為兩側：exit 0；函式 1184、id 365、更新紀錄 102、說明 30、方案 9、常數 313、URL 7，零缺。第一次跑確實抓到 `trawaitcard` 缺口，補回公開更新紀錄與同 commit 的說明修正後才轉綠，未使用 `--allow`。
- `npm run build:release` 關鍵輸出：`內建音樂 12 首(其餘從正式站串流)`；App web assets 為 161 files／80.9 MB。
- `app/android/app/src/main/assets/public/suno musics/`：`find` 結果為 **12 個 mp3／6 個一層子資料夾／根層 0 個 mp3**。
- `npm run verify`：exit 0；新版 `verify-release.mjs` 的音樂雙向逐檔比對全綠，Widget parity 6/6 與 no-ship-regression 也全綠。
- `./gradlew clean bundleRelease assembleRelease`：exit 0，BUILD SUCCESSFUL；APK 內列得 12 個 mp3。
- AAB：`app/android/app/build/outputs/bundle/release/app-release.aab`，SHA-256 `9f6a0dc50abc566d66de40eb07a65264335c36beb58af44f4fbd7d866bac0c39`；`jarsigner -verify` 為 `jar verified.`。
- APK：`app/android/app/build/outputs/apk/release/app-release.apk`，SHA-256 `4c64098d86ce23b09a26927dd950fa2846819254b86ff1690cf3d460094ccff9`；`apksigner verify` 通過 v2。AAB 約 51 MB、APK 約 52 MB。
- 最新 APK 已於 Samsung SM-A5460 以 `adb install -r` 覆蓋成功；`dumpsys package` 為 versionCode 16／versionName 1.4.11、`lastUpdateTime=2026-08-27 13:52:55`。安裝後冷啟動 `MainActivity` 成為前景 Activity。
- 真機連網換首 8 次：8/8 的 Android audio policy 都是 `State: Active`，App 全程保持前景。第 2／3／5／6／7 次各新增約 2.48／2.97／3.43／4.34／6.18 MB UID 接收流量，確認 **5 次為正式站串流曲**；第 1／4／8 次僅 0～1.2 KB，為 App 內建曲。沒有任何一次無聲卡住。
- 音樂播放中進入放空模式並待控制淡出 7 秒後，audio policy 仍為 `State: Active`，放空模式不會中止音樂。
- 真機飛航模式換首 8 次：先確認 `airplane_mode_on=1`、`Active default network: none`；8/8 都維持 `State: Active`、`MainActivity` 前景，非內建曲依既定 error handler 跳過後落到 12 首內建曲，App 沒有當掉。
- 測完已關閉飛航模式並確認 default network 恢復；背景音樂停止後不再有該 UID 的 active playback configuration，裝置暫改設定全部復原。

## 五、2026-08-27 晚間續作：橫式 v3／v4／v5 與正式付費候選包

> 續作前已完整讀取 `.claude/worktrees/app-redesign/_codex交接_20260827.md`；版面來源固定為
> `build/redesign-901` 的 v3 `1a80db1`、v4 `32ab34e`、v5 `f30b4da`。Android 仍維持
> `versionName 1.4.11`／`versionCode 16`，沒有帶入版面線的 900 系試作版號。

- 已把橫式 v3／v4／v5 的最終契約合入 Android：跟車卡改為右上側軌、面板與 sheet 遮蔽關係更新、
  頂列與工具列右側固定 10px、地圖操作列改為右上橫排且隨機鈕在最右。網站／App 公開更新紀錄已補
  8/27「橫拿手機時，跟車卡與地圖工具改到右上側邊，面板打開也不再互相遮住」。
- `scripts/verify_landscape.mjs` 與版面線 `f30b4da` 的 SHA-256 相同：
  `0ad6576bedad611f81f0a3224d11282e5840c655`。
- 完整橫式矩陣：**1025/1027**；唯一兩個 FAIL 是 Chromium／WebKit 各一條既有的
  `L6/L7` 版權框資料相依座標，v3／v4／v5、旋轉、觸控、L13b 與安全區判準全綠。
- v4 畫面搭配 v5 判準的自然突變測試：**198/200**，且只紅 Chromium 的
  `L13b 16橫`／`L13b 16ProMax橫`，證明新版「右上橫排、跟車鎖向左長」判準有牙；暫存突變 fixture
  已在測後移除。
- 本輪 App `BUILD` 為 `v0827e`；`npm run sync:release` 產生 161 files／80.9 MB，
  Metro Core、Android Plus 與線上底圖均開啟，音樂維持 12 首內建／45 首正式站串流。
- `npm run verify` 與 `npm run verify:android-plus-ui` 均 exit 0；後者以 360／375／414／768
  真觸控矩陣確認 Google Play 付費入口存在、App Store 入口不出現在 Android、無水平溢出。
- 正式候選包已含一組 RevenueCat Android `goog_…` public SDK key（僅核對存在與長度，未在文件洩露值），
  並已同步官方 `@capacitor/app 8.1.1`；原先「缺 key／缺返回鍵依賴」兩項阻擋已解除。
- `./gradlew clean bundleRelease assembleRelease`：BUILD SUCCESSFUL（388 tasks）。
- APK：`app/android/app/build/outputs/apk/release/app-release.apk`，52 MB，SHA-256
  `9f3f3ceba9a69821ab24ceb178779dd784f0566df6685c71141a872516ff4ac8`；`apksigner verify`
  通過 v2，signer `CN=railisland-upload`。
- AAB：`app/android/app/build/outputs/bundle/release/app-release.aab`，51 MB，SHA-256
  `7435e8b95267bf99f3d91390b0452da0fd2e097c54e76ed841741b51c83b90dc`；`jarsigner -verify`
  exit 0（`jar verified.`）。
- APK manifest：package `tw.railisland.app`、versionCode `16`、versionName `1.4.11`、
  minSdk 24、targetSdk 36；release metadata 同值。
- `v0827e` APK 已於 2026-08-27 19:51 以 `adb install -r` 覆蓋安裝到 Samsung SM-A5460；
  `dumpsys package` 為 versionCode 16／versionName 1.4.11，冷啟動後 `MainActivity` 在前景。直式實景確認
  衛星底圖、長方形軌島牌、單排頂列與地圖工具均正常。
- 安裝後 ADB daemon 於 19:53 重新啟動，手機未再出現在 `adb devices`；因此本顆 v3／v4／v5 橫式截圖與
  官方返回鍵實按仍列待驗，不把前一顆 `v0827c` 的真機證據冒充成這顆 `v0827e`。

## 六、Android 與 iOS 內容能力補齊（versionCode 17）

- 版號升為 `versionName 1.4.12`／`versionCode 17`，最終 App `BUILD` 為 `v0828a`；公開更新紀錄已同輪補上。
- Metro Core 看板以 Core 的 `publicLabel` 精確對接北捷官方車號後顯示逐節擁擠度；同方向有多班車時不再借用另一班的資料。
- 鐵路與混合小工具接上 App 儲存的「我的地點」；同名地點移動後，既有小工具會動態解析新座標。鐵路小工具並新增方向、車種與車次篩選，provider 取資料時實際套用，不只是設定頁文案。
- 跟車通知在 WebView 關閉後由 Android AlarmManager 定期抓官方台鐵動態，更新誤點、所在站與停靠狀態；若斷線、資料過期或省電模式延後喚醒，保留原本時刻推進作為 fallback。
- 背景音樂改由 Android Media3／MediaSession 播放，可在背景、通知與鎖定畫面暫停、繼續與切換；WebView 不再是播放生命週期來源。
- 接上 Google Play In-App Review 與 App Update。側載包不會假稱「已是最新版」；Play 控制的真實視窗須由封閉式測試安裝版驗收。
- 鐵路小工具的「大字好讀版」改用獨立列版面：車次 `12→16sp`、時間 `16→23sp`、狀態 `9→12sp`、列高 `30→42dp`；保留減少班次數的取捨，但不再把主要資訊維持在小字。
- App 使用說明補上北捷逐車擁擠度、Widget 我的地點／篩選／大字版、背景跟車、版本與評分；評分常駐入口改為不等待 Play Core 更新查詢即可顯示。
- `verify_android_widget_parity.mjs` 除原本六種小工具集合外，新增八項內容能力 gate；輸出必須同時為「小工具集合 6/6、內容能力 8/8」。

### versionCode 17 驗收結果

- `RAIL_VERIFY_NATIVE=android ... npm run verify`：exit 0；Metro Core、Android Plus、授權音樂／底圖、六種小工具集合與八項內容能力全部通過。最後一次獨立複驗因執行環境禁止把 Esri 金鑰送出而以 `RAIL_SKIP_KEY_LIVENESS=1` 跑其餘 gate；同輪 `build:release` 的完整出貨閘門已先通過。
- `:app:connectedDebugAndroidTest -PrailApplicationId=tw.railisland.app.v17test -PrailSkipGoogleServices=true`：Samsung SM-A5460／Android 16 共 **15/15**；除「我的地點」與背景官方動態外，新增直接比較標準／大字 RemoteViews 字級與列高、以及 MainActivity 的 `RailReview`／`RailStore` runtime plugin 註冊。
- `verify_app_update.mjs`：Chromium＋WebKit 共 **73/73**；Android Play Core 涵蓋側載無法驗證、Play 安裝且最新版、Play 有新版三種狀態，並掃 360／390／414／768 浮層碰撞。
- `verify_app_review.mjs`：**31/31**；新增 Play Core 查詢永遠 pending 的案例，Android 常駐評分列仍立即可見；符合完乘與節流條件時只呼叫 In-App Review plugin 一次。
- Xcode `Release`／iOS Simulator 實際 build 成功；產出 iOS 1.4.10 (904) 的 `App.app` 與內嵌 `RailBoardWidgetExtension.appex`，Extension bundle id 為 `tw.railisland.app.RailBoardWidget`。六種 Widget／Live Activity 共用的 Extension 確實編譯並通過 embedded binary validation。
- A54 景安站真機：追蹤按鈕已和站名、系統、星號、關閉放在同一列；準確度說明只有一行；標準高度首屏可見三班資料；北捷班次列顯示六節官方擁擠度；捲到內容底部才看到「在 Google 地圖開啟」。
- Media3 第一輪真機驗收抓到 `RailAudioService` 雖在播放、但 `startForegroundCount=0` 且沒有通知；根因是自訂 Capacitor action 啟動時 session 尚未加入 `MediaSessionService`。補上 `addSession(mediaSession)` 並把它加入 parity gate 後，A54 實得 `isForeground=true`、media notification id 1001、鎖定畫面顯示「Afloat · 軌島」及上一首／暫停／下一首；App 退到背景後，以系統媒體鍵實測 `PLAYING → PAUSED → PLAYING`，下一首 index 由 0 變 1、歌單由 Moonlake 變 Afloat。
- Google Play 評分視窗與 Play 軌道更新資訊不能用 adb 側載包冒充驗收；程式、狀態矩陣與錯誤文案已驗，真視窗仍須從封閉式測試 track 安裝後確認。
- 最終 `./gradlew clean bundleRelease assembleRelease`：BUILD SUCCESSFUL（388 tasks）。APK 與 AAB 均約 54 MB；APK v2 簽章通過、signer `CN=railisland-upload`，AAB `jar verified`。
- 最終 APK SHA-256：`fb3ae422f33044e1c1fd9cef68b0b836a9b94fca4b502b174e8970f031b98712`；AAB SHA-256：`c3bc6e9dc08d5742820011b0b8ee04bd32e7dd7a867d55612b8b8695b41402ab`。
- `app/www/index.html`、Android assets 與 APK 內嵌 `assets/public/index.html` SHA-256 均為 `9886f87c246a306d008368d3ac2ec82cd7b3c17f8354a92a03a6bb2e211c7fb3`；manifest 為 package `tw.railisland.app`、versionCode 17、versionName 1.4.12、minSdk 24、targetSdk 36。
- 最終 `v0828a` APK 已於 2026-08-28 00:37 覆蓋安裝到 A54；installer 為 `null`（adb 側載），v17test 測試包沒有殘留。Widget 設定預覽開啟後手機進入安全鎖定，標準／大字的最後一組肉眼對照待解鎖後補拍，不以 instrumentation 的數值 gate 冒充實景。
