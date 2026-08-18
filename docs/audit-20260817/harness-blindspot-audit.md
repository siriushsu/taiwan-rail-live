# 捷運畫車 harness 稽核：為什麼全綠而正式站一眼看得出壞掉

**日期** 2026-08-17　**對象** `scripts/verify_*.mjs` 中與捷運畫車／位置／名冊有關的 24 支
（14 支 `verify_trtc_*` ＋ `verify_official_roster_frontend` ＋ `verify_all_metro_motion` ＋ `verify_board_ledger` ＋
`verify_metro_times` ＋ `verify_no_overtake` ＋ `verify_binder_{identity,done,join_window}` ＋ `verify_join_parity` ＋ `verify_anomaly`）
**受測樹** `/Users/xuxiang/Code/捷運小動畫/.claude/worktrees/trtc-zombie`（HEAD `d5ff87d`，index.html 22,904 行）
**正式站實測** `https://railisland.tw` → `BUILD=v0817c`、`OFFICIAL_ROSTER_ENABLED=false`、`TRTC_PURE_SCHEDULE_POSITION=true`

> 這份是診斷，不含新腳本的實作。
>
> ⚠️ **並行寫入告示**：稽核期間有另一個 session 正在同一棵樹工作——`scripts/verify_trtc_fast_realign.mjs`
> 與 `scripts/verify_trtc_official_worker.mjs` 有未 commit 變更（08:58／08:59 寫入），
> `docs/audit-20260817/` 底下也有非本稽核產生的檔案。本文所有實跑數字取自 **10:19–10:33 的磁碟狀態**，
> 對那兩支腳本的判讀已標註「進行中，不要據此下判斷」（見 3.7b）。本文只新增
> `harness-blindspot-audit.md`、`probe_visible_props.mjs`、`runs/*.log` 三類檔案，未動任何產品檔、未執行任何 git 寫操作。

---

## 0. 兩句話結論

1. **會量畫面座標的五支 gate，今天全部在 import 期就 ENOENT 死掉**（缺 `/tmp/trtc-playwright-deps`），
   輸出裡連一個 ✅／❌ 都不會出現 ⇒ 在「跑一輪看有沒有紅字」的驗收習慣下與沒跑無法區分。
2. **能跑的六支，結構上看不到疊車與倒退**——它們守的是 reducer 的整數站號、單一車的時間軸、
   順序不交換、以及導數的平滑度。使用者抱怨的「疊在一起」「倒退跑」正好全部落在這四者的縫隙裡。

**16 條使用者可見性質裡有 9 條【無人守】**，包含今天四次回報的全部內容。

---

## 1. 先確立事實：今天正式站跑的是哪一條路徑

`index.html:4337-4342`

```js
function trtcOfficialRosterEnabled(search) {
  try { return new URLSearchParams(search == null ? location.search : search).get('officialroster') === '1'; }
  catch (e) { return false; }
}
const OFFICIAL_ROSTER_ENABLED = trtcOfficialRosterEnabled(location.search);
```

旗標的預設值今天**翻過面**（`git log -S` 逐 commit 取值）：

| 期間 | 旗標判定式 | 預設 | 正式站畫車走哪條 |
|---|---|---|---|
| 08-13 → 08-17 09:26 | `!== '0'` | **開** | 官方名冊：`reduceOfficialRoster` → `trtcOfficialDisplayPosition` |
| 08-17 09:26 起（`ba57962`） | `=== '1'` | **關** | 班表：`freqTrainPosAt` → `freqTrainBaseAt` → `metroShiftSec` / `trtcBoardPosition` |

四次回報橫跨兩段。**兩條路徑各自壞，而且各自的 gate 都照不到自己那條的缺陷。**
（正式站現況已實測為「關」，見檔首。）

---

## 2. 使用者可見性質 × 現有 gate 覆蓋

判定欄位語意：**有牙** = 斷言落在畫面座標且能抓到該缺陷；**部分** = 有斷言但落在中間量／單車／合成情境；**【無人守】** = 沒有任何一支斷言這件事。

☠️ = 該 gate 今天實跑**完全無法啟動**（見 3.7c），等同不存在。

| # | 使用者看得到的性質 | 官方名冊路徑（08-13→今 09:26） | 班表路徑（今 09:26 起＝現況） | 判定 |
|---|---|---|---|---|
| **V1** | **同向兩台車不得重疊／貼在一起** | 無 | 無 | 🔴**【無人守】** 全 repo 零條「最小車距 ≥ X 公尺」斷言 |
| **V2** | 同一區間不得塞 ≥3 台 | `verify_trtc_fast_realign`（`LIMIT=3`，:25）量 `state.vehicles` 的 `line\|dir\|from\|to` | 無 | 部分（只守 ≥3、只守整數站號；見 3.1） |
| **V3** | **位置必須單調前進（不得倒退跑）** | ☠️`verify_trtc_motion` A 單調性（:377）；`verify_official_roster_frontend` gate B 的凍結分支（合成單車） | ☠️`verify_all_metro_motion`「零倒退」（:181），而且它量 `freqTrainPosRaw` 並先 `delete ln._liveShift` | 🔴**【無人守】**（見 3.2／3.4／3.7c） |
| **V4** | 同向不得超車（順序不交換） | `verify_trtc_outage_coast`（續推順序，可跑）；☠️`verify_trtc_ontime:1625` | ☠️`verify_trtc_ontime:1625`（`?officialroster=0`） | 部分——且判準是嚴格不等式，**重合不算**（見 3.1） |
| **V5** | 畫出來的車數 ≈ 官方在報的列數 | `fast_realign` §4/§5、`ghost_fix`(3)、`outage_recovery` — 覆蓋良好 | 無（班表路徑沒有「官方報幾列」的對照物） | 名冊路徑**有牙**；班表路徑【無人守】 |
| **V6** | 箭頭方向 = 實際移動方向 | `verify_official_roster_frontend` gate I（合成線、單車、anchor 幾何＋原始碼字串比對） | 無 | 部分（不驗真畫面像素、不驗多車） |
| **V7** | 不得瞬移／跳站 | ☠️`verify_trtc_motion` overspeed | ☠️`verify_trtc_ontime:1512`（80 km/h 上界，合成錨點） | 🔴**【無人守】**（3.7c） |
| **V8** | 不得停在原地凍住 | ☠️`verify_trtc_motion` stalled（:293） | ☠️`verify_all_metro_motion` stalls（同樣量 raw） | 🔴**【無人守】**（3.7c） |
| **V9** | 車到終點要收掉、不留殘骸 | `verify_official_roster_frontend` gate B/D、`verify_trtc_official_roster` 合成契約（真語料半邊已紅） | 不適用（班表車自然消滅） | 部分——今天靠臨時的 `diag_zombie.mjs` 才用真語料抓到 `retireEpoch=null` 永不退場 |
| **V10** | 車號不得在兩台車之間跳／不得整批退牌 | `verify_trtc_branch_lock`（16 綠）；`verify_binder_identity`／`verify_join_parity`（**語料 gitignored，跑不了**） | 無 | 部分 |
| **V11** | **地圖上的車位置與站牌倒數一致** | 🔴 **刻意脫鉤**：`verify_trtc_direct_board` 檔頭明寫「驗證重點不是『動畫點位有沒有對上』」（153 條綠沒有一條看位置） | 無 | 🔴**【無人守】** |
| **V12** | 收班／開班時段畫面有無車 | `verify_trtc_official_roster` 營運時段合成契約 | `verify_sanying_hours`（資料層） | 部分 |
| **V13** | 車不得偏離軌道 | ☠️`verify_trtc_ontime:1516` `maxOffTrackM` | 同左 | 🔴**【無人守】**（3.7c） |
| **V14** | 車不得跑出班表行程範圍 | ☠️`verify_trtc_board_positions:510` | 無 | 🔴**【無人守】**（3.7c；且檔內自述「因 210 秒槽距無法下結論」） |
| **V15** | **同一畫面連續兩秒不得整批換位置** | 無 | 無 | 🔴**【無人守】** |
| **V16** | **重新整理前後車不得跳到別的地方** | 無 | 無 | 🔴**【無人守】** |

> ⚠️ 容易誤以為有守的一支：`verify_no_overtake.mjs`（issue #17「後車不得穿越前車」，判準寫得最紮實、
> 明文說明「只吃 `trainPos` 吐出的經緯度」）——但 `:146` 是
> `const trains = state.trains.filter(t => t.sys === 'tra_sched');`，**它只驗台鐵，捷運一台都不看**。

**【無人守】共 9 格：V1、V3、V7、V8、V11、V13、V14、V15、V16。**
其中 V1（疊車）與 V3（倒退）正是今天四次回報的全部內容。
剩下能跑又是綠的 6 支，全部落在 V2／V5／V6／V10／V12 這幾格——**沒有一格是使用者今天在抱怨的**。

---

## 3. 為什麼整套 harness 會集體失明——七個結構性原因

### 3.1 判準是「順序不交換」，不是「距離不得小於」——重合恰好落在嚴格不等式的死角

`scripts/verify_trtc_ontime.mjs:333`

```js
if ((a[i].d - a[j].d) * a[i].dir < -.001) { orderInversions++; ... }
```

兩台車**恰好重合**時 `0 < -0.001` 為 false ⇒ 不計為 inversion。
「疊在一起」是 gap → 0，而這條判準只在 gap 變成**負的**才開火。全 repo 沒有任何一條下界式斷言。

同一段還有第二層縮水（`:324`）：分組鍵是 `` `${other[0]}>${other[last-1]}|${odir}` ``，註解自述
「起訖站完全相同才比 FIFO」。⇒ 同線同向但**起訖不同**的兩班（短程車、分支車、加班車）連順序都不比。
使用者截圖那組「09:26 發的車被畫回迴龍、和 09:35 那班疊在一起」正是不同起訖的兩班。

`verify_trtc_fast_realign` 的 `crowdOf`（:89-99）同理：鍵是 `line|dir|from|to` 的**整數站號**，
門檻 `LIMIT=3`。使用者原話是「**兩站之間有兩台車就已經要懷疑了**」——2 台在這條 gate 下永遠合法；
而且兩台在**相鄰**區間、畫面上距離 5 公尺，這個鍵完全看不到。

### 3.2 判準對象是 reducer 中間量，不是畫面座標——中間有一整層 frame-history 狀態機

15 支 `verify_trtc_*` 幾乎全部斷言在 `state.vehicles[i].{from,to,arrEpoch}` 或 ledger 的 rows。
使用者看到的是 `index.html:5185` `trtcOfficialDisplayPosition()` 的輸出，而那一層**自帶狀態**：

- `_trtcOfficialDisplay` 逐車快取（key = `line|vehicleId`），位置是**上一畫格的函數**，不是純函數；
- `progress <= prior.progress` ⇒ 凍結座標（`:5219`）——名冊在前進，畫面可以不動；
- `trtcOfficialForwardLimit(...)` 前進上限（`:5230`）——名冊跳一站，畫面只走一點；
- `prior.coasted && !coasted && coastedFor >= TRTC_OFFICIAL_RESYNC_MIN_COAST_SEC` ⇒
  **明文允許倒退、允許跳動**（`:5209-5218`）。

也就是說：`from/to` 全部合法的一份名冊，畫出來可以是兩台重疊、可以凍住、可以倒退。
唯一碰到這一層的 `verify_official_roster_frontend`，是在**合成 5 站線**上**一次 1–2 台車**測（`gate B/C`），
結構上不可能觀察到「兩台之間的距離」。

### 3.3 判準綁在導數上，缺陷在積分量上

`scripts/verify_all_metro_motion.mjs:141-147`

```js
for (const [phase, target] of [['delay', 240], ['advance', -240], ['settle', 0]]) { ... }
const rate = (eff - prevEff) / .1;
...
belowFloor: phases.filter(x => x.rate < .249).length, aboveCeil: phases.filter(x => x.rate > 2.001).length,
```

- 注入的校正階梯是 **±240 秒**；正式站實測的校正量是 **1069–1098 秒**（`d5ff87d` commit message，
  新莊線每台車），是測過的最大值的 **4.5 倍**。
- 斷言只看 `rate`（eff 時間軸的**一階導數**）落在 `[0.25, 2]`。一個**平滑地**滑進 18 分鐘偏移的過程，
  rate 全程合法 ⇒ 這條斷言必定全綠，而車已經被拖回起點站疊在別台車上。
- 全 repo **沒有任何一條**斷言 `metroShiftSec` 的**絕對值**上界。

### 3.4 量的是比渲染低兩層的函式，而且量之前先把致病狀態刪掉

畫面實際走：`freqTrainPosAt`（`index.html:5279`）→ `freqTrainBaseAt`（`:5285`，套 `metroShiftSec`＋
`trtcBoardPosition` 官方錨點）→ `trtcHeadwayPosition`（headway hold）。

`verify_all_metro_motion.mjs:104` 量的卻是 `freqTrainPosRaw(ln, tr, ta + elapsed)`——**跳過**上面三層。
更關鍵的是 `:79`，量測前明確執行：

```js
for (const ln of state.lines) { delete ln._trtcBoard; delete ln._liveShift; ln._trtcTripMode = false; }
```

**把造成缺陷的那個狀態刪掉再量。** 「純班表零倒退」因此恆真，而且與畫面無關。
`verify_trtc_motion.mjs:280` 好一點（有套 `sh = metroShiftSec(...)`），但量的仍是
`freqTrainPosRaw(ln, tr, tm)`，一樣繞過官方錨點與 headway hold。

### 3.5 一次只有一台車 ⇒「兩台之間的關係」結構上不可能被觀察到

- `verify_all_metro_motion.mjs:83`：每條線每方向**只取第一班**（`if (!dirs.has(dir)) dirs.set(dir, tr)`）。
- `verify_official_roster_frontend`：合成線最多 2 台，且只斷言 glyph 標籤（gate C）。
- `verify_trtc_motion`：逐 key 量自己的 delta。

疊車是**二元關係**。在只放一台車、或放兩台但只比標籤的 harness 裡，它不是「沒被抓到」，
是「不可能出現」。

### 3.6 旗標一翻，整批 gate 靜默離線

15 支 `verify_trtc_*` 全部只驗「旗標開」那一側——不是 `page.goto(...?officialroster=1)`
（`verify_official_roster_frontend:425,504`、`verify_trtc_outage_ui:144`），就是直接
`import { reduceOfficialRoster } from './trtc_official_roster.mjs'` 繞過旗標。

09:26 `ba57962` 把預設翻成關之後，**這 15 支仍然全綠，但守的是零個使用者走的路徑**。
唯一驗「關」那側的 `verify_trtc_ontime` 用 `?officialroster=0`（`:170`，註解明寫這是刻意的），
但它吃的是**班表合成 fixture**，恰好同時中 3.1（順序判準）與 3.3（合成 shift 量級）兩個死角。

> 這是 `judgment.md` 心得 36 的鏡像：那條管「載入當下凍結的旗標，測試注入來不及」；
> 本條管「旗標翻面後，整批 gate 的覆蓋對象靜默換成了空集合，而沒有任何訊號」。

### 3.7 🔴 每一支「量畫面座標」的 gate 現在都在 import 期就死掉——而沒人發現

今天在這棵 worktree 逐支實跑 15 支捷運 gate，結果分成三類：

**(a) 跑得動且全綠 ⇒「全綠」的印象全部由這一類產生**

| 腳本 | exit | 綠/紅 | 它到底在守什麼 |
|---|---|---|---|
| `verify_trtc_direct_board` | 0 | **153**/0 | 檔頭自述「驗證重點**不是**『動畫點位有沒有對上』」——153 條綠沒有一條看位置 |
| `verify_trtc_outage_ui` | 0 | 46/0 | 斷訊徽章／訊息有沒有出現在畫面上 |
| `verify_trtc_fast_realign` | 0 | 45/0 | reducer 輸出的**整數站號**擁擠度（≥3） |
| `verify_official_roster_frontend` | 0 | 44/0 | 合成 5 站線、1–2 台車的單車時間軸 |
| `verify_trtc_branch_lock` | 0 | 16/0 | ledger 的分支歸屬 |
| `verify_trtc_outage_coast` | 0 | 12/0 | 續推的順序與段秒 |

**(b) 跑得動但已經紅／已經 crash ⇒ 長期沒人看＝等於沒有 gate**

| 腳本 | exit | 綠/紅 | 實況 |
|---|---|---|---|
| `verify_trtc_official_roster` | 1 | 70/**7** | **真語料重放整段跑不了**——`tmp/binder-fixtures/rounds-peak` 被 `.gitignore:98` 忽略，任何新 worktree 都沒有。剩下能跑的只有合成情境 |
| `verify_trtc_official_worker` | 1 | 32/**18** | ⚠️ **這 18 條是並行 session 進行中的工作，不是長期腐朽**：`scripts/verify_trtc_official_worker.mjs` 有未 commit 的新斷言（08:59 寫入）要求 `const TRTC_OFFICIAL_ONLY = true;`，而 `worker.js:1193` 現況是 `false` ⇒ 正向控制與 17 條 mutation 一起連坐。**不要據此下判斷** |
| `verify_trtc_ghost_fix` | 1 | 16/2 | 「重放軌跡逐值等於實測基準」紅 |
| `verify_trtc_origin_identity` | 1 | 17/2 | `stale=4` 紅；尖峰語料缺席自動略過 |
| `verify_trtc_outage_recovery` | 1 | 13/0 | **拋例外中止**：`突變沒有改到任何字元＝突變失效`（`:61`）⇒ 突變控制組從未執行，13 條綠的「有沒有牙」未經證實 |

**(c) 🔴 完全跑不起來——而這一類恰好就是**全部**會量畫面座標的 gate**

```
verify_all_metro_motion      exit=1  綠=0 紅=0
verify_trtc_ontime           exit=1  綠=0 紅=0
verify_trtc_board_positions  exit=1  綠=0 紅=0
verify_trtc_motion           exit=1  綠=0 紅=0
verify_trtc_motion_round2    exit=1  綠=0 紅=0
```

五支全部死在同一行、同一個原因，且是**模組頂層 readFileSync**（例：`verify_trtc_motion.mjs:95`）：

```
Error: ENOENT: no such file or directory,
  open '/tmp/trtc-playwright-deps/node_modules/leaflet/dist/leaflet.js'
```

`/tmp/trtc-playwright-deps` 是手動備好的目錄，macOS 重開機就清掉；leaflet 也不在本地
`node_modules`。⇒ **V3（單調前進）、V4（順序）、V7（瞬移）、V8（凍住）、V13（偏離軌道）、V14（範圍）
的所有守衛，現在一條斷言都沒執行過**，而且因為死在 import、輸出裡連一個 ✅／❌ 都不會出現
（`grep -c ✅` 得 0），在「跑一輪看有沒有紅字」的驗收習慣下**長得跟沒跑一模一樣**。

> 這就是「全綠」的完整機制：**會看螢幕的那五支全部沒啟動，能啟動的六支結構上看不到疊車與倒退。**

跑得動的真語料檢查，其語料來源另有兩處在 repo 外或被忽略：
`/Users/xuxiang/Code/軌島-語料/trtc-peak-0803`（repo 外）與 `tmp/binder-fixtures/*`（gitignored）。
**這使「真語料重放」這一整類檢查在任何乾淨 worktree／CI 都結構上不存在。**

### 3.8 沒有任何一支 gate 對正式站量畫面

`grep -l railisland.tw scripts/verify_*.mjs` → 11 支，全部是 Plus／API／班表／額度類
（`verify_plus_*`、`verify_bounty_api`、`verify_rate_limit`、`verify_thsr_*`、`verify_tripshare`、
`verify_my_trains`、`verify_usage_split`）。**零支對正式站量捷運位置。**
今天真正抓到根因的 `diag_segcrowd.mjs` / `diag_zombie.mjs` 是臨時寫的，且吃的是落盤語料。

---

## 4. 一個附帶但重要的量測警告（給下一階段）

嘗試從外部用 `page.evaluate` 逐格呼叫 `freqTrainPosAt()` 來量單調性，**會被自己的量測污染**：

- `index.html:5293/5304`：`freqTrainPosAt` 在 `t === state.simSec` 時會**寫入** `trtcRememberRenderedPosition`；
- `metroShiftSec` → `easedShift` 是有狀態的緩動層，外部額外呼叫會推進它。

實測（正式站 v0817c、14 畫格）：偵測到的「倒退」事件在畫格索引上的分佈是 `{"1":67, "9":25}`
——**67/92 集中在探針的第一個畫格對**，也就是暖快取造成的假象；換 gap（1.5s / 0.3s / 1.2s）
逐線計數幾乎不變，也符合「一次性事件」而非「持續漂移」。

⇒ **結論：不能把這組數字當成「正式站正在倒退跑」的證據**（本稽核不做此宣稱）。
真正非侵入的觀察點是產品自己已經有的 `_trtcLastRendered`（`index.html:17135`），
但它目前 (a) 只記 `isTrtcBoardLine`（北捷）、(b) 只留**最後一筆**、(c) 不記其他六個系統
⇒ 現況下**沒有任何非侵入的方式可以觀察畫面位置的歷史**。這本身就是 V1/V3/V15 長期無人守的機制性原因。

---

## 5. 五格【無人守】的共同形狀（給下一階段當設計約束，不含實作）

1. 判準必須落在**畫面座標**（`trtcOfficialDisplayPosition` / `freqTrainPosAt` 的輸出），不是 `from/to`。
2. 判準必須是**二元關係**（兩台之間的距離），不是單台的自我一致性。
3. 判準必須是**下界式**（`gap >= X`），不是嚴格不等式的順序反轉。
4. 判準必須跨**多個畫格**（位置歷史），且觀察手段不得推進產品自己的緩動狀態（見 4.）。
5. 判準必須**兩側旗標都跑**（`officialroster` 開與關各一遍），否則翻面即失明。
6. 語料與依賴必須**在 repo 內**：不得依賴 `/tmp/*`、repo 外目錄或 gitignored 路徑。
7. 每支腳本第一行要有**自檢閘**：印出「我驗的是哪棵樹、依賴齊不齊、總共跑了幾條斷言」，
   並在斷言數為 0 時以非零碼收場——今天五支死在 import 的腳本，症狀與「全部通過」完全同形。

---

## 附錄：本次實跑產物

- `docs/audit-20260817/runs/*.log`（7 支 gate 的完整輸出）
- `docs/audit-20260817/probe_visible_props.mjs`（正式站量測探針，含 4. 的分辨實驗）
