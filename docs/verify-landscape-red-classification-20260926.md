# verify_landscape／verify_m1c 在 origin/main 上既有紅項分類帳（2026-09-26）

兩支都不在 `scripts/ship_web.mjs` 出貨鏈裡，所以紅了很久沒人擋。這份帳記錄每一組紅的**原因分類**
（產品回歸／環境條件／判準過期，三者互斥）、分辨它的**實驗**，以及處置。

## 量測條件

- 受測：origin/main `f5b54fd8`（v0926l），`index.html` md5 `c529713e43167b40d6f78bb64ecf8f7a`。
- `node scripts/verify_landscape.mjs` 兩引擎全套：**956 過／82 紅**（2026-09-26 20:10–20:21，機器負載 6–10）。
- `node scripts/verify_m1c_overlay_controls.mjs`：3 紅。
- 全程無視窗（Playwright 預設 headless）；沒有部署、沒有跑 ship_web。
- 探針是一次性的，沒有進版控；量法寫在各段，照著做就能重現：
  - bisect：把現行腳本**複製**（不是 symlink，否則 ROOT 會解析回原樹）到 `git worktree add --detach` 的乾淨樹，
    逐 commit 跑 `QUICK=1`，比 FAIL 名單。
  - L1b 分辨實驗：用 verify_landscape 同一把尺（`__exposed`／`__aheadExpect` 逐字複製），同一班車、同一時刻，
    一次只改一個變因（原樣／`followHeadLocked` 恆假／先解鎖）。
  - 切組別耗時：頁面就緒後直接 `selectGroup(TAB_GROUPS 的 tra)` 量同步毫秒，不經 tap；Chromium 另用 CDP
    `Profiler` 抓那一次呼叫的 CPU profile。

## 總表

| 組 | 項數 | 原因 | 引入點 | 處置 |
|---|---|---|---|---|
| L1b 放大後列車在露出中心＋前瞻 | 48 | 產品行為改變（相機取捨） | a5473792 v0909i 手機車頭鎖定 | **09-26 使用者裁示 B**（車頭置中就是現行契約）：改成只驗「列車在露出中心」，前瞻不再驗（40798325） |
| P4 小卡態／46% sheet 列車在露出中心＋前瞻 | 4 | 同上 | 同上 | 同上 |
| L13 前置：拖曳地圖真的解了鎖 | 12 | 判準過期 | a5473792 | 改照新契約（按開關解鎖）＋新增 L13a |
| L13b 鎖鈕在工具欄內·上緣對齊·單列 | 12 | 判準過期 | a5473792 | 代理量改驗意圖（同一列、欄高≤最高顆+2） |
| V2 觀察模式·工具堆淡到 0 | 2 | 判準過期 | a5473792 | 改量工具欄成員；新增 V2b 在放空跟車情境驗鎖鈕 |
| F3a 相機自癒 | 2 | 判準過期（前提失效） | a5473792 | 判準不改，移到「3D 整合層沒載入」的退路環境量 |
| L10 分組切換（收合鈕）按得動 | 2（僅 WebKit） | **產品回歸（效能）** | f14ee875 v0915a 同向待避選站 | 判準不改（它抓到的是真的），只補診斷欄。**產品已修（v0926n）**：台鐵待避的輸入沒變就沿用上次結果，全套 L10 兩引擎全綠，收合鈕的 `selectGroup` 同步 21–24 ms（改產品前 small 3002 ms 紅、medium 2724 ms 擦邊過；見 L10 段） |
| m1c G0 marker 契約／M17 收藏車站 ×2 | 3 | 判準過期 | cd58b6c5 v0916c | 改量 canvas 站名標籤＋真點擊 |
| L10 分組切換浮動（使用者回報） | 已算在上一列 | **同上一列的產品回歸** | f14ee875 | 跟 L10 一起修好（v0926n）。修前四顆分頁（`index.html` 17886／17934）與收合鈕選單（34586）都在 click handler 裡同步跑 `selectGroup`，WebKit 同步 2.4–3.4 s，對 3 s 逾時幾乎沒有餘裕，負載一高就過線 |
| L11 底部 tab 真觸控、L9 tab bar 覆蓋率（使用者回報會浮動） | 本輪 0 | 環境條件（負載） | — | 不改。五顆的 click handler 同步耗時 WebKit 0–39 ms、Chromium 0.3–12 ms（直接呼叫 `click()`、每顆三次，負載 3–7），排除「分頁本身慢」；本輪負載 3–10 下沒重現。v0926n 全套紅過一次（Chromium 17ProMax 橫「最愛」tap 逾時但分頁有開，L9 是它的連帶），只換 index.html 的有修法／原版交錯各跑三次，六次全綠，跟 L10 修法無關 |

合計 48+4+12+12+2+2+2 = 82，與全套數字一致。

## 各組證據

### 共同源頭：a5473792（09-09 手機車頭鎖定）

QUICK 模式（Chromium、16 橫／16ProMax 橫）bisect：`72e6b822` **202/202 全綠** → `a5473792` 紅，
紅項名單與 `f5b54fd8` 逐字相同（16 項）。所以 L1b／P4／L13／L13b／V2／F3a 全是同一個 commit 帶來的，
沒有任何一項是環境造成的。使用者 09-09 的原話與設計在 `docs/rail-structures-head-lock-0909.md`：
手機右側要有明確的車頭鎖定開關，鎖定時仍可縮放、旋轉，解鎖後自由移動。

### L1b（48）／P4（4）：車頭鎖定捨棄了前瞻

- 量到的值：`dist` 0.9–1.0 px（列車**正好**在露出地圖中心，讓位機制正常）、`err0` 37.5–47.4、
  `m` 38.5–48.3（契約要求沿行進方向偏 15% 短邊）。紅的只有「前瞻」那一半。
- 機制：`recenterTo` 在 `followHeadLocked()` 成立時先記下 `_pinnedFollowTarget` 就 early return，交給
  3D 整合層的相機約束（`transformCameraUpdate`，`rail-3d/integration/follow-camera-lock.js`）；
  約束的中心＝列車第一節（或 `_pinnedFollowTarget`），padding＝`mapInsets()`，沒有前瞻。
  §04c 的 `followAheadPx` 照樣算，但結果沒被用上。
- 分辨實驗（一次只改一個變因）：
  - E1：測試端把 `followHeadLocked` 換成恆假，其餘不動 → `err0` 0.0（綠）。
  - E2：同一支探針跑兩個 commit：`72e6b822` err0 0 → `a5473792` err0 41。
  - E3：先 `setFollowLock(false)` 再量 → err0 725（解鎖後相機就不跟了，這不是解法）。
- 兩份契約衝突：`followAheadPx` 的註解寫 §04c 前瞻「手機殼限定」；09-09 設計文件寫「手機及放空跟車以第一節
  車廂中心為相機目標……目標置於扣除跟車卡與工具列後的可視地圖中央」。後者是實作時寫下的設計，
  不是使用者的原話（使用者原話只有開關、縮放旋轉、解鎖自由移動），所以要由使用者決定以哪份為準。
- 前例：09-07 `b8f468fc` 起，立體模式（zoom≥14）的 recenter 本來就刻意不疊像素前瞻
  （完整編組自己沿軌預留車頭空間）。
- 兩條路（09-26 使用者裁示 **B**，原話「B可以」）：
  - A：恢復前瞻，只在 zoom<14 用不對稱 padding 把中心往行進方向推；zoom≥14 維持車頭置中。
    代價：跨過 zoom 14 時畫面會跳一下。
  - B：接受「車頭置中」就是現行契約，把 L1b／P4 改成只驗「列車在露出中心」（讓位那一半）。
    與 09-07 立體模式的做法一致。
- 改寫（40798325）：L1b、P4 與 L5 的相機分類器共用 `centerPass`（列車離露出中心 ≤10px，容差沿用
  裁示前強判的值，實測 0–1px）。前瞻方向的分支計數與「L9 相機判準分支分佈」一起退役；
  `__aheadExpect` 保留，`err0`／`dir` 只留在細節欄當診斷。突變與全套結果見「修後驗證」。

### L13（12）／L13b（12）：拖曳不再解鎖、鎖鈕不再變膠囊

- 修前細節：`unlocked=false／文字="鎖定"／膠囊寬=44`；`topAligned=false singleRow=false 膠囊 44×52`。
- 產品現況（index.html）：`dragstart` 只在 `!followHeadLocked()` 時解鎖；手機鎖鈕是 44×52 的
  「鎖定／自由」開關（`.head-lock`，`aria-pressed`），不再長成「回到列車」膠囊。
- 舊判準的兩個代理量「上緣對齊 ±2」「欄高 ≤46」是全員等高 44 的年代寫的；鎖鈕 52 高、容器
  `align-items:center` ⇒ 44 的鈕上緣比鎖鈕低 4px、欄高 52，兩個代理量都失效，但仍然是一排。
- WebKit 另一個假象：首次跟車時 `showTip` 會把 `.mt-tip`「車頭鎖定：開啟」塞進鈕裡 2 秒，
  讀整顆 `textContent` 會讀到「鎖定車頭鎖定：開啟」。改讀狀態字 `.lock-state`。
- 改寫：拖曳一次 → **L13a**（先證明地圖收到拖曳 `dragstart≥1`，再驗仍鎖定、`aria-pressed=true`）→
  收合跟隨欄 → 真按開關 → L13 驗解鎖（`unlocked`、`aria-pressed=false`、狀態字「自由」）→
  L13b 驗同一列（兩兩垂直重疊 ≥ 較矮那顆的一半）、欄高 ≤ 最高那顆 +2（從量到的推，不寫死）、
  角落顆＝隨機跟隨、互不相疊。

### V2（2）：放空改成「容器不淡、成員收起」

- 修前細節：`tools: 1`。09-09 起 CSS 是 `body.fs.ambient .map-actions{opacity:1}`，把 `#followLockBtn`
  以外的成員 `display:none`——容器本身不再淡出，量容器的 opacity 恆為 1，但畫面上一顆工具都沒有。
- 放空有兩種視角：預設的**群車**（進場 `clearFollow()`，沒在跟車，鎖鈕依 `updateFollowLockUI` 也收起）與
  **跟車**（自動巡遊接手跟一班）。09-09「放空跟車也顯示」鎖鈕只適用後者。V 段原本走的是群車視角。
- 改寫：V2 名稱不變，改量工具欄**全部成員**的最高有效不透明度（`display:none` 記 0）——群車巡航下
  鎖鈕也該收起，比豁免它更嚴。新增 **V2b**：同一頁離開放空後切到跟車視角再進一次，先驗真的接上車
  （前置），再驗鎖鈕有效不透明度 >0.9、中心命中是它自己、其餘成員仍收起。
- 過程中的一個錯：第一版把 V2b 放在群車情境、豁免鎖鈕，全套一跑 V2b 就紅（`lock:0`）。加診斷才看到
  群車進場清掉了跟車，那是正確行為，錯的是 V2b 的前提；已改到跟車視角，兩引擎皆綠。

### F3a（2）：相機約束讓自癒結構上不會開火

- 修前細節：`{"held":0,"fired":0,"z":11,"inView":true}`。F3a 把 `recenterTo` 換成空函式、把相機
  `setView` 到遠處，等自癒開火；但約束會把程式 `setView` 的中心原地擋回（只有 zoom 生效，
  見 memory `verify-camera-blocked-by-follow-lock`），列車從沒離開畫面，自癒不需要開火。
- 改寫：判準一字不改，改在 `rail-3d.js` 被擋掉（3D 整合層沒載入）的頁面量——這是真實存在的
  退路環境，那時平面置中與自癒才是唯一防線。另加前置閘門：整合層真的沒載、約束真的不在、
  仍是鎖定狀態，否則量到的又是被約束擋住的那條路。

### L10 收合鈕（WebKit 2）：切組別卡住主執行緒 2–3 秒

- 除錯版量測（WebKit 無視窗）：點擊事件 47 ms 內全部送達（pointerdown→touchend→click），click handler
  裡的 `selectGroup` 同步跑 2.4–2.8 s；Playwright 的 tap 要等 handler 跑完才回來 ⇒ 撞 3 s 逾時。
  逾時之後組別其實已經換好（all→tra）。逾時放寬到 20 s 時同一步驟 2.5–2.9 s 完成、判準轉綠。
- 直接呼叫 `selectGroup`（不經 tap，all→tra，三次）：

  | commit | WebKit | Chromium |
  |---|---|---|
  | 087e909b（f14ee875 的前一顆） | 81／92／161 ms | — |
  | f14ee875 v0915a 同向待避選站 | 3274／3015／1891 ms | — |
  | f5b54fd8（main 現況） | 2461／3240／3409 ms | 1749／1587／1548 ms |

- CPU profile（Chromium，main 現況）：`selectGroup` 1663 ms 中，`resolveTraTraffic` 1553 ms，
  其中 `planSameDirectionOvertakes` 1243 ms（自身 897 ms）、`shareDay` 261 ms。
- 呼叫點：`loadSystem`／`loadSchedGroup`／`loadAllGroup` → `applySchedSystems` → `resolveTraTraffic`。
  開機一次、每次切組別一次；不是週期性的。
- 判定：**產品回歸（效能）**，判準本身是對的（它抓到的是使用者按下去畫面凍住 2–3 秒），所以通過條件不改。
  細節欄補「點擊耗時／selectGroup 同步耗時／逾時後組別有沒有換」，下次紅一眼看得出是按不到還是卡住。
  Chromium 約 1.5–1.9 s，還在 3 s 內，所以只有 WebKit 紅；機器越忙越容易兩邊一起紅。
- 修法（09-26 使用者決定另開一條線交給 Codex，分支 `fix/group-switch-overtake-cache`；驗收後以 v0926n 併進本分支）：
  `applySchedSystems` 的台鐵分支把待避結果存在 `sys._traTrafficCache`。鍵包含班表資料、名冊、日期、實體股道、
  站間速度剖面、通過觀測、`resolveTraTraffic` 本身，以及每班車、停站陣列、路線形狀與站序的物件身分，全部相同才命中。
  命中時只還原會車統計、重貼環島車（8888／8889，本來就不進待避規劃），其餘沿用；任何一項換了就整批重算。
- 驗收（Codex 的回報只當線索，全部我自己重跑；最終版 index.html md5 43dddec9）：
  - 等價：開機＋6 次切到 tra／all，共 7 個快照，每班台鐵車的到離時刻、待避標記、每 5 分鐘的沿線位置、會車統計
    跟 65a7adc7 基準逐次逐字相同，WebKit、Chromium 都是「全部相符」（時鐘釘在同一刻）。
    故意弄壞一處的 `--selftest-break` 版本報 6 項不符、exit 1。
  - 耗時（直接呼叫 `selectGroup`，各三次取中位數）：切到 tra／all，WebKit 20／18 ms（基準 3175／3190 ms）、
    Chromium 20／24 ms（基準 2267／2011 ms）。
  - verify_landscape 全套：L10 兩引擎 small／medium 全綠，收合鈕 `selectGroup` 同步 21–24 ms、點擊耗時 72–183 ms。
  - 待避相關閘門 `verify_run_profiles_match`、`verify_phys_speed_cap`、`verify_overtake_station_planning` 全綠。
- 命中時 `state._segStats`／`_rpPre` 只計當次實際重貼的車（環島車與其他系統）。index.html 沒有讀它們，
  閘門只在開機後讀，開機那次一定是完整計算，所以數字不受影響；程式碼裡已加註解。
- 沒進這次：虛構環島車 8888／8889 開機後第一次切組別位置跳約 529 m（停站時刻相同，與待避無關）。修前就有，
  等價驗收的開機快照與切換後快照都跟基準逐字相同，表示這一跳維持原樣。

### m1c G0 marker／M17（3）：收藏車站 ★ 改畫在 canvas 站名標籤

- `cd58b6c5`（v0916c）把收藏車站的 ★ 改畫進 canvas 站名標籤、拔掉 `anchor:'bottom'` 的 DOM Marker，
  並支援直接點站名標籤開看板。原生 Marker 只剩草稿釘（可拖、center）與收藏地點（center）。
- 改寫：G0 契約改成原生 Marker ≥2 且草稿釘可拖；M17 改量 `labelBoxes` 裡帶 `isFav` 的標籤
  （`tryLabel` 推進 `labelBoxes` 與畫 ★ 是同一個分支），再真的點那個框，驗看板開到**同名同系統**
  那一站（車剛好黏在標籤上時會彈疊點選單，照使用者動作選車站那一列）。

## 修後驗證

- verify_landscape 兩引擎全套（e23ade62 版腳本，20:33–20:44，負載 10–14）：**999 過／55 紅**
  ＝ L1b 48 ＋ P4 4（待裁示）＋ L10 WebKit small 1（產品回歸，細節「點擊耗時=3002ms selectGroup同步=3134ms
  逾時後組別已換」；medium 2724 ms 擦邊過）＋ V2b 2（第一版前提錯，見 V2 段）。
  L13／L13a／L13b 兩引擎六尺寸全綠，F3a 兩引擎在無 3D 整合層環境全綠（`fired:1, z:13`）。
- 最終版（e79a8c0d）只改了 V 段與它專用的 `AMBIENT_PROBE`（全檔只有 V 段呼叫），V 段兩引擎重跑 16/16 綠。
- 裁示 B 版（40798325）兩引擎全套（21:39–21:50，負載 13–20）：**1052 過／1 紅**。唯一的紅項是
  L10 WebKit small（細節「點擊耗時=3002ms selectGroup同步=3434ms 逾時後組別已換」，產品回歸，見 L10 段）。
  L1b 48、P4 4、L5 30 全綠；L11／L9 這輪也沒紅。
- 裁示 B 的突變（同下方規則；Chromium、QUICK，只跑 `landscapeSuite`＋`portraitCameraSuite`）：

  | 突變 | 考哪一層 | 結果 |
  |---|---|---|
  | 對照組（不突變） | — | 136/0 |
  | MB1 相機約束讓位歸零（`rail-3d.js` 的 padding 改全 0） | L1b／P4 露出中心 | L1b 紅 ×8、P4 紅 ×2（dist 178.5），其餘 126 綠 |
  | MB2 前瞻寫死朝北 60px（`followAheadPx`） | 判準不再綁前瞻 | 136/0 綠 |

- v0926n（L10 修法併入後）兩引擎全套（22:04–22:15）：**1051 過／2 紅**。兩項都在 Chromium 17ProMax 橫：
  L11「最愛」tab（tap=false 開了=true）與它連帶的 L9 tab bar 覆蓋率 4/5。L10 兩引擎全綠。
  分辨實驗：同一支腳本只跑 landscapeSuite 的 17ProMax 橫，index.html 有修法／原版交錯各三次（負載 4.9–13.6），
  六次都是 67/0 ⇒ 環境條件，跟這次改動無關（見總表 L11／L9 列）。

- verify_m1c_overlay_controls 全套：54/54 綠；內建 `MUT=marker` 突變 rc=1。
- 突變測試（產品碼只改一處、突變字串先斷言恰好命中 1 次、跑完還原並比對 md5；Chromium、QUICK 兩尺寸）：

  | 突變 | 考哪一層 | 結果 |
  |---|---|---|
  | 對照組（不突變） | — | 地景 49/0、m1c 9/0 |
  | M1 拖曳又會解鎖（拿掉 `!followHeadLocked()`） | L13a | L13a 紅 ×2（連帶 L13 ×2） |
  | M2 鎖鈕 onclick 改空函式 | L13 | L13 紅 ×2 |
  | M3 橫式工具欄改直排 | L13b | L13b 紅 ×2（sameRow=false、欄高 156） |
  | M3c 工具欄改上緣對齊（仍是一排，應維持綠） | L13b 不過嚴 | 27/0 綠 |
  | M4 拿掉放空收起其他工具的規則 | V2、V2b 的其餘工具 | V2、V2b 紅 |
  | M5 放空跟車時鎖鈕 `pointer-events:none` | V2b「點得到」 | V2b 紅（lockHit=false） |
  | M5b2 放空跟車時鎖鈕 `display:none` | V2b「在」 | V2b 紅（lock=0），V2 綠 |
  | M6 自癒永不開火 | F3a 開火層 | F3a 紅（fired=0） |
  | M7 自癒不理會手勢 | F3a 按兵層 | F3a 紅（held=1） |
  | M8（改腳本）擋 rail-3d.js 失效 | F3a 前置閘門 | 前置紅（integration=true）＋F3a 紅 |
  | M9 收藏判定恆假 | M17 ★ | ★ 紅、開看板紅 |
  | M10 點站名不開看板 | M17 開看板 | 開看板紅（★ 綠） |

  另一個教訓：第一版「放空藏鎖鈕」突變寫成 `.map-actions > * {display:none}`，specificity (0,3,1) 蓋不過各成員
  自己的 ID 規則，什麼都沒藏，反而等於拿掉原規則——結果也是紅，但紅在「其他工具露出來」，不是它要考的那一層。
  突變紅了還要看細節欄是不是紅在指名的那個量上（改成在鎖鈕規則加 `display:none !important` 的 M5b2 才命中）。
