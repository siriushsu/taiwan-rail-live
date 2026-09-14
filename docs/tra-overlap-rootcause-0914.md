# 台鐵列車互穿／追撞根因報告（2026-09-14）

分支 `fix/tra-overlap-rootcause-0914`，基底 `86663b05`（v0913e）。本輪只做量測與根因，**沒有改路網、進路、時間模型、車長、hold 上限**，也沒有部署。

> 2026-09-14 深夜追記：F3 之後 F1／F2／F4 也已落地在同一分支（未併、未部署），結果、剩下的缺口與重跑順序在第九節。

## 一、結論（先講答案）

互穿不是車長的問題，也不是「真實班表不可行」。**全日 4 秒解析度掃描，三個服務日各有 506～635 場互穿，長編組只多 3%**。事件分成四個獨立缺口，每一個都有程式碼與逐秒時間軸證據：

| 缺口 | 9/13 場次 | 一句話 | 該修哪裡 |
|---|---|---|---|
| **R1 派路沒有「方向↔正線」規則** | A′ 雙線同股 221 | 雙線區間每條正線都有零星幾班車逆向走另一股，跟對向車迎面；求解器目標函數只算 hold 與換線量，`preference`（相對側）根本不進目標 | `build_physical_routes.mjs`／`optimize_physical_dispatch.*` |
| **R2 停站股道與月台節點指派** | C 通過車穿過停站車 298＋B 同節點 28 | 停站車被放在正線（218 場）或通過車被派進側線（76 場）；同站同時停 4 班只用到 3 個節點（臺南 OSM 有 7 個節點、計畫只用 3 個；善化 OSM 0 個） | 候選停靠節點集合＋路徑搜尋的 siding／main 規則＋`repair_physical_platforms.mjs` 的擴充 |
| **R3 時間模型不知道班表設計的交會／待避** | A′ 單線落站間 60＋A 頂到 120 s 上限 21（＋一部分 C） | 通過站時刻由「單車孤立的跑段曲線」回填，實測層 f 又把該車「典型實際誤點型態」帶進準點班表；143 在員林比設計晚 3 分鐘，165 在大武早 3 分鐘，南迴單線交會落到隧道裡 | `index.html` `assignRunProfiles`（10499）與回填；`data/tra_pass_obs.json` 的用法 |
| **R4 偵測漏掉九成** | 閘門只見 ~55 對 | 120 s 取樣對 8～20 s 的迎面互穿幾乎盲；4 s 掃描才看得到 635 場 | `verify_physical_no_overlap.mjs` 加密集模式（本輪已用 `SAMPLE=4`＋新增彙整腳本） |

長編組（`FORMATION_PROBE=long`：區間車 160 m、莒光 177 m）：635→654 場（+19），家族結構不變；同一場事件的共用長度從 60 m 變 160～275 m、時長多 5～15 秒。**車長只放大既有事件，不製造新家族**。所以「能不能開長編組」取決於 R1～R3，不取決於車長本身。

## 二、量測方法（可重跑）

- 密集掃描：`SAMPLE=4 TEST_DATE=<日> REPORT=<json> PORT=<port> node scripts/verify_physical_no_overlap.mjs`（閘門原樣，只把取樣間隔從 120 s 改 4 s；判準仍是 edge resource＋車身區間，與 runtime／求解器同一把鍵）。
- 家族彙整（新增）：`node scripts/summarize_overlap_intervals.mjs <report.json> --list --json <out>`——把連續取樣合併成「一場」、分 A／A′／B／C，再用 `network.json` 幾何判斷「旁邊 14 m 內有沒有平行股道」。
- 逐秒探針（新增）：`TEST_DATE=… CASES='[{"from":"20:10","to":"20:40","trains":["141","143"]}]' node scripts/probe_overlap_timeline.mjs`——從 05:00 連續重放到視窗（hold 演化與閘門一致），視窗內逐秒記錄兩車的 runtime 站表（含回填通過站）、edge、里程、hold、共用公尺；`FORMATION_PROBE=long` 可換長編組對照。
- 證據檔在 `docs/tra-overlap-rootcause-0914/`：三天家族清單（`families-*.txt`）、長編組清單、關鍵案例逐秒時間軸（`probe-0913-prod-keycases.txt`）、兩份程式地圖（`codemap_timing.md`、`codemap_dispatch.md`，逐項附檔案:行號與逐字節錄）。

## 三、家族表（獨立事件場次）

| 家族 | 9/12 | 9/13 | 9/13 長編組 | 9/14 |
|---|---|---|---|---|
| C 通過車穿過停站車（旁有平行股道） | 271 | 288 | 292 | 237 |
| C 通過車穿過停站車（無平行股道） | 10 | 10 | 7 | 8 |
| A′ 對向同股，旁有平行股道 | 196 | 221 | 232 | 186 |
| A′ 對向，單線交會落站間 | 80 | 60 | 61 | 42 |
| B 同月台同節點 | 24 | 28 | 28 | 19 |
| A 追撞、hold 頂到 120 s 上限 | 21 | 21 | 22 | 10 |
| A 追撞未頂上限 | 4 | 6 | 11 | 3 |
| C 同月台進出尾巴 | 0 | 1 | 1 | 1 |
| **合計** | **606** | **635** | **654** | **506** |

「旁有平行股道」的判定是幾何（14 m 內、夾角 ≤25°、排除 siding/crossover/yard），會把**南迴線、臺東線幾條同名隧道 way**（中央隧道 `81151555‖575059356` 4 m、安朔隧道 `81151569‖575070551`、山里隧道 `372059091‖700495282`、內獅–枋山 `871829695‖871829693` 9 m）也算成雙線。南迴線是單線，這些第二條 way 是 OSM 重複繪製還是真有第二股，**未核實**（2026-09-14 直接查 OSM 現行 tag：兩條都 `usage=main`、無 `railway:track_ref`）。依交接規則，核實之前不得拿它當第二股用；扣掉這 50 場疑似案例，A′ 雙線同股仍有 ~170 場。

## 四、關鍵案例逐秒（官方 vs 回填 vs 進路）

### 4.1 臺南 3158／116（交接指定案例）——B 同節點，與車長無關

- 官方：3158 區間車 臺南 09:51–09:59（8 分鐘）；116 自強 臺南 09:55–09:57。兩班同時在站是班表設計，臺南有兩座島式月台。
- 模型：兩班都停在 `1176543136:2`（`usage=main`）**同一個停車節點**，09:54:28–09:57:25 共用 178 s；3 節車（60 m）就已經整節重疊。長編組：09:54:23–09:57:29、187 s、160 m——只是放大。
- 節點供給：臺南在 `nodeTags` 有 **7 個 `railway=stop` 節點**，9/13 的 891 份計畫在臺南只用到 **3 個**，而班表上臺南同時停站（≥60 s）最多 **4 班**。班表層（不看動畫）就能算出臺南 2 對、全線 22 對「同節點同時停站」，落在 10 站：枋寮 6（OSM 7 節點、計畫只用 2）、善化 3（OSM 0 節點、估算 3、同時 4 班）、宜蘭 3（OSM 3、同時 4）、新左營 2、臺南 2、礁溪 2、南港、羅東、瑞芳、福隆各 1。
- 判定：**R2**（候選節點集合／換節點後接不上進出路徑），不是時間模型也不是車長。`scripts/repair_physical_platforms.mjs` 檔頭自述的殘餘原因（「該站拓樸只有一個停車節點／換過去沒有可接的進出路徑」）與此吻合。

### 4.2 善化 3221／1038／123——B 同節點（閘門標成 A′ 是進站尾巴造成的分類噪音）

- 官方：3221 區間車 善化 16:00–16:10（待避 10 分鐘）；1038 區間快 16:06:30–16:09:00；123 自強 16:06–16:07。三班同時在站。
- 模型：3221 停 `966439368:3`，1038 到站後停 `966439368:4`——同一節點的相鄰兩段 edge，16:06:20–16:09:13 共用 174 s（長編組 191 s／160 m）。123 停在另一條正線 `966439369:19`，沒有衝突。
- 善化在 OSM **沒有** `railway=stop` 節點，靠 `infer_physical_stops.mjs` 估算出 3 個，班表需要 4 個。判定 **R2**（路網缺節點）。

### 4.3 員林–永靖 141／143——R3 時間＋R2 進路同時錯

- 官方：141 自強(PP) 員林 **20:18–20:23（停 5 分鐘）**；143 自強(3000) 彰化 20:09 發、不停員林、嘉義 20:58 到。這 5 分鐘就是班表設計的待避：143 應在 141 停站期間通過員林。
- 模型回填：143 花壇 20:18:57、大村 20:21:36、**員林 20:23:36**、永靖 20:25:16——比 141 的離站時刻只晚 36 秒，於是 143 一路追著剛出站的 141，hold 2.8→10→54→**120 s 頂到上限**，20:27:50–20:28:19 在永靖前穿過 141（共用 245.7 m，整列 EMU3000）。
- 為什麼晚 3 分鐘：143 這段用的是實測層 A（`data/tra_pass_obs_model.json` `trains_layerA.143`：花壇 203‰、員林 298‰）。f 的定義是「該站首筆看板時間戳 − (表定發車＋DelayTime)」除以「(表定到站＋DelayTime) − 同上」（`scripts/build_pass_obs.mjs:417`）。143 到彰化時常態誤點 3～5 分、到嘉義時已追回（2026-08-13 原始看板：彰化 dly 4→3，嘉義 dly 0），所以「跑段內時間比例」把**這班車典型的追回型態**當成曲線形狀套回準點班表：頭 6.6 km 花 9:57（40 km/h，`segs["彰化|花壇|SP|e3000"]=40.7 km/h, n=90`），斗六→大林卻要 162 km/h 才對得上。同一天原始看板也證明真實世界的順序：143 員林紀錄 20:23:19（當日誤點 3 分），141 員林離站紀錄 20:24:39→20:25:27（比表定 20:23 晚約 2 分）——**141 真的等 143 過了才走**。
- 進路：141 停在正線 `479816907:6`（`usage=main`），143 通過員林走 `479816907:19→:8` 再切進 **側線 `310770439`**（`service=siding`）。就算時刻修對，也是通過車走側線、停站車佔正線，兩件事都反了。

### 4.4 埔心 107／4103——R3

4103 區間車 埔心 07:44–07:48:30（待避 4.5 分）；107 自強回填通過埔心 **07:48:40**，比 4103 離站晚 10 秒 → 追撞 hold 頂上限 → 07:52 穿過。設計上 107 應在 07:44–07:48 之間通過。

### 4.5 瀧溪–大武 165／428——R3 單線交會落站間

428 自強 大武 19:16–19:18（交會停站）；165 自強回填通過大武 **19:13:03**，比交會窗早 3 分鐘 → 19:13:56 兩班 EMU3000 在瀧溪–大武間迎面（共用 196 m）。南迴線單線，交會只能在站內。

### 4.6 西勢 110／3140——R2（時間對、股道錯）

3140 區間車 西勢 06:25–06:30（待避 5 分）；110 自強回填通過 06:28:46——**時間正確落在待避窗內**。但 3140 停在正線高架 `45665566:31`，而西勢站點 0 m／27 m 處就有兩條 565 m／607 m 的 `service=siding`（`530530119`、`530530118`）沒被用。

### 4.7 東里–東竹 4534／6065（9/12）——輕微，R3

4534 停東里側線 `1095607774:1`（**這站指派是對的**）15:16–15:17；6065 自強通過；4534 出站切回正線 `966427320:2` 時 6065 剛好到同一段，15:17:55–15:17:57 尾巴重疊 27.8 m、3 秒。設計上 6065 應在 4534 離站前通過（或 4534 多等）。

### 4.8 崎頂–香山 112／171、112／193——R1 逆向走股

該區間兩條 way 各 96～99 班車同向使用，**只有 112 一班反向**（`369788782`：正向 99、反向 1；`368387542`：99／1）。整個 9/13：有平行股道的正線 way 中，**1112 條**有「少數（<20%）逆向」的車，合計 2897 個 way-次、**224 班車**；另有 233 條有平行股道的 way 兩個方向各 ≥20%（其中一部分是海線、屏東線單線旁有站內股道被誤判成平行，不全是問題）。最極端的是萬華–臺北隧道 `1551465831`（縱貫線西正線）：**158 班正向＋159 班反向全部擠同一條**，1.9 m 外的 `194118019`（同名西正線）只有 158 班正向——像是拓樸上兩股在某處併成一股，需另查。

## 五、機制證據（程式碼）

1. **位置**：`rail-3d/physical/motion.js:16-37`——站間 `f` 來自班表／2D 貼軌里程，直接乘實體路徑弦長（`motion.js:35`）；兩者不同源，抽樣 1897 段比值 p05 0.985／p50 1.000／p95 1.022，最差烏日–新烏日 1.112（74 段偏差 >5%）。這只讓交會點沿線漂幾十公尺，不是互穿主因。
2. **時間**：`index.html:10499` `assignRunProfiles`——每個跑段一條曲線，優先序 `pre`（10513）→ 實測 PCHIP（10531–10576，`buildObsProfile` 10341）→ 梯形 `buildProfile`（10577）；通過站時刻 = 依里程比例從曲線反查。**沒有任何地方讀其他班車的停站窗**。`data/tra_pass_obs.json` 的 f 定義與閘門見 `scripts/build_pass_obs.mjs:395-480`（`vHi=165`、`vFinalHi=135`、Hampel、分層時間窗）。
3. **hold**：`index.html:10727` `updateBlockHolds`——只依 2D `trainSeg` 分組、棘輪 0.4 km、`BLOCK_CAP_SEC=120`（10714），只在顯示端平移時間（`trainPos` 10676）；實體端 runtime 沒有佔用檢查。上限頂到就穿，這是症狀不是根因，**不得調高**。
4. **派路**：`scripts/build_physical_routes.mjs:39-41` 每對候選節點只求 2 條路（最短＋封鎖中點 resource 的替代）；44-49 的 `preference`（相對側＋渡線數）**只寫進紀錄**，`optimize_physical_dispatch.py:74` 目標函數是 `holds×1e6 + changes`，不含它；`topology.js:113` 只排除 `yard/spur`，**`siding` 不排除、`usage` 台鐵路徑從不讀**（高鐵 9/12 才加的側線／正線規則是 THSR-only）。→ R1、R2 的「通過車走側線」。
5. **月台節點**：`topology.js:132-145` `stopCandidates` 依站名＋距離取 OSM `railway=stop`，沒有就 `infer_physical_stops.mjs` 估算最多 8 個；候選集合不看「同時停幾班」。`repair_physical_platforms.mjs` 只換節點不補拓樸。→ R2 的 B 類。
6. **求解器現況**：`repair_physical_platforms.mjs:3-8` 記載 9/12 CP-SAT 全解四種預算皆 UNKNOWN；`rebuild_physical_cache.mjs:81-98` 把台鐵計畫原樣 passthrough 並寫死 `conflicts:0`。現行 `dispatch.json` 的台鐵計畫**不能假設經過求解器驗證**。9/13 的 922 班台鐵：891 班 exact 綁定、31 班走 `route-template` 借路。

## 六、修法計畫（順序＝依賴順序；每步附驗法）

前提不變：不縮車身、不藏車、不移車、不放鬆基線、`BLOCK_CAP_SEC` 維持 120、未核實的股道不當現役客運線。

**F1 派路方向規則（R1）**
- 在候選路徑產生或求解目標加入「雙線區間每條 way 只准一個行車方向」：以幾何判定平行股（兩條 `usage=main` 相距 ≤14 m、同向），以台鐵靠左行駛決定各自方向（`build_physical_routes.mjs:44-49` 已算出相對側，改成硬約束或 `1e4` 級成本進 `optimize_physical_dispatch.py:74` 的目標）；單線與未核實的第二 way（南迴、臺東隧道）不套用。
- 驗法：逆向 way-次 2897→接近 0、224 班逆向車→0；A′ 雙線同股 221→<20；9/12、9/14 同步量。

**F2 停站股道與節點（R2）**
- 通過段禁走 `service=siding`（除非無替代）；有待避需求的停站（停 ≥90 s 且同向有通過車落在窗內）必須停側線／到發線；路徑搜尋對台鐵也讀 `usage`。
- 節點供給：臺南、枋寮等 OSM 節點夠但計畫沒用到的站，查候選集合與進出路徑為何接不上；善化、埔心、太原、新烏日、高雄、七堵、蘇澳新等 OSM 零節點的站，補 `stop_position` 或以估算節點擴到「同時停站數」以上。
- 驗法：班表層「同節點同時停站」22 對→0（不用動畫就能算）；C 類 298→<30；B 類 28→0。

**F3 交會／待避推論進時間模型（R3）**
- 回填通過站時刻時，查同站其他班車的**官方停站窗**：同向且該車停 ≥90 s（待避）→ 通過時刻夾進 [到站+20 s, 離站−20 s]；單線區間對向車在該站停 ≥60 s（交會）→ 同樣夾進窗內；夾完以該點當額外 knot 重建曲線（`buildObsProfile` 已吃 knot 列表）。只用官方停站窗，不發明資料。
- 實測層：f 相對「表定＋整數分誤點」量，會把常態誤點與追回型態帶進準點班表；至少對「跑段第一個通過站」加物理下限（不得慢於梯形曲線），並在有交會窗證據時以窗為準。
- 驗法：141/143 → 143 員林通過時刻落在 20:18–20:23 且不再 hold；107/4103、165/428、4534/6065 消失；A′ 單線 60→<5、A 頂上限 21→<3。

**F4 偵測成閘門（R4）**
- 把 `SAMPLE=4` 掃描＋`summarize_overlap_intervals.mjs` 的家族場次做成棘輪（現行 120 s 閘門保留），生產編組與 `FORMATION_PROBE=long` 各跑一份。

**F5 長編組**
- F1～F3 落地、三個服務日 4 s 掃描不再有 A′ 雙線與 B 類、且長編組掃描沒有新家族之後，再開 `rail-3d/integration/FORMATIONS.md` 裡的長編組。

## 七、風險與未定

- 南迴線／臺東線同名平行 way 是否真為第二股：未核實，F1 明確排除；需人工對照台鐵單雙線區間表。
- 萬華–臺北隧道 `1551465831` 全數雙向通行：像拓樸缺口（另一股在某端沒接上），未查到節點層。
- 實測層 f 的語意：2026-08-13 原始看板顯示「站名首筆時間戳 ≈ 實際通過時刻」，但 `DelayTime` 是整數分、發車基準偏早；本輪只用一天原始資料核對 143／141，未全面重估 `tra_pass_obs`。
- 「旁有平行股道」的幾何判定會把站內股道算進去（海線、屏東線各有 ~40 條 way 兩向各半），R1 的 233 條「雙向漏斗」是上界不是實數。
- `dispatch.json` 台鐵計畫的來源（求解器／passthrough／repair）沒有標記，F1、F2 落地時要先讓求解器能收斂（9/12 記錄為 UNKNOWN），否則只能走局部修復腳本。

## 八、本輪產物

- `scripts/summarize_overlap_intervals.mjs`（新）、`scripts/probe_overlap_timeline.mjs`（新）
- `docs/tra-overlap-rootcause-0914/`：`families-0912-prod.txt`、`families-0913-prod.txt`、`families-0913-long.txt`、`families-0914-prod.txt`、`probe-0913-prod-keycases.txt`、`codemap_timing.md`、`codemap_dispatch.md`
- 沒有動 `index.html`、`rail-3d/`、`data/`。
- 2026-09-14 追記（第九節）：新增 `scripts/lib/parallel_tracks.mjs`、`scripts/lib/track_directions.mjs`、`scripts/repair_physical_directions.mjs`、`scripts/repair_physical_stations.mjs`、`scripts/verify_tra_overlap_families.mjs`、`scripts/fixtures/tra-overlap-families-baseline.json`；改了 `rail-3d/physical/{network,dispatch,level-profiles}.json`、`data/tra_track_sections.json`、`scripts/fixtures/remaining-routes-0913.json`、`scripts/verify_remaining_station_routes.mjs`。

## 九、修復落地（2026-09-14，同一分支；未併 main、未部署）

### 9.1 做了什麼（順序＝依賴順序，全部可從 HEAD 的輸入重跑、輸出逐 byte 相同）

- **F3 交會／待避推論**：前一輪已落地（`a90c1a20`）。這輪 `build_run_profiles` 的統計：夾回 121 處通過時刻、窗內無解 10、重建不合格 9、位移超過上限 100。
- **F1 方向規則** `scripts/repair_physical_directions.mjs`（方向模型 `scripts/lib/track_directions.mjs`；平行股道幾何 `scripts/lib/parallel_tracks.mjs` 與區間表建置器共用同一份判準，區間表逐 byte 不變）。每份計畫逐站做動態規劃：候選停車節點＝整份派車表曾派過該站的節點，相鄰兩站只准走不逆向通過任何乾淨方向股道的路徑，而且進站段與出站段在停車節點要接得上（`g.canTurn`，狀態帶著進站段）。乾淨方向股道 1729／2819 條有派車的正線。逆向段 **729 → 35**（187 份計畫、換 568 個停車節點、769 段路徑、新落成 582 條路徑）。剩 35 段：三貂嶺→大華 17（平溪線借宜蘭線股道）、新莊→竹中 8、猴硐→瑞芳 8、二水→田中 2。
- **F2 節點／側線指派** `scripts/repair_physical_stations.mjs`：逐日名冊（14 天）；衝突模型 B＝同節點停站時窗相交、C＝停站時窗（前後各 60 s）內另一班的進出段經過該節點。**衝突時刻用 `computeProfiles`（含 F3 推論）的通過時刻，不用班表密化插值**——第一版用插值時刻，漏掉的正是 F3 把通過時刻夾進停站窗的那些（永康 135／3251、北新竹 273／1793、潮州 324／3268）。貪婪修：衝突最多的（車次, 站）先搬，候選＝派過的節點 ∪ 路網裡該站的停車位置（OSM `railway=stop` 與建置時推估停車點，含側線），進出段順向且前一站／本站／下一站三個接點都接得上，只認「該站與前後站衝突變少」。14 天模型 B **642 → 405**、C **9668 → 2652**；搬 367 個停車節點、8 份借路徑的計畫落成、新路徑 169；逆向段 35 → 35。60 個搬移目標是求解器派車表從沒用過的停車位置（都在正線或側線上的 OSM `railway=stop`／建置推估點，沒有 yard／spur）：福隆 7、雙溪 6、富岡 5、樹林 5、鶯歌 4、斗六 4、和仁 4、富里 4、楊梅 3、永康 3、光復 2、富源 2、新城 2、金崙 2，其餘各 1。
- **F4 偵測成閘門** `scripts/verify_tra_overlap_families.mjs`（`npm run check-physical-overlap-families`）：4 秒全日掃描 → `summarize_overlap_intervals` 分家族 → 每個家族不得高於基線、不得出現基線沒有的家族；基線 `scripts/fixtures/tra-overlap-families-baseline.json`（三個服務日 × 生產／長編組）。同輸入重跑六組逐家族相同；突變（基線少 1、刪掉一個家族）都會紅。120 秒閘門的 A≤5／C≤10／B≤55／A′≤18 棘輪照舊，沒有放鬆。
- **F5 長編組：沒開。** 第六節寫的判準是「三個服務日 4 s 掃描不再有 A′ 雙線與 B 類」，現況 A′ 雙線 73／76／62、B 35／39／27，未達。長編組探針的掃描只比生產編組多 +14／+16／+13 場，沒有新家族（9.2 表）。

### 9.2 結果（4 秒全日掃描，獨立事件場次；修前＝F3 之後的基線）

| 家族 | 9/12 | 9/13 | 9/14 |
| --- | --- | --- | --- |
| A′ 雙線同股（旁有平行股道） | 196 → **73** | 221 → **76** | 186 → **62** |
| C 通過車穿過停站車，旁有平行股道 | 271 → **101** | 288 → **102** | 237 → **84** |
| C 無平行股道 | 10 → 0 | 10 → 0 | 8 → 0 |
| A′ 單線交會落站間 | 80 → 58 | 60 → 39 | 42 → 27 |
| A 追撞頂到 120 s 上限 | 21 → 21 | 21 → 21 | 10 → 10 |
| A 追撞未頂上限 | 4 → 3 | 6 → 5 | 3 → 2 |
| B 同月台同節點 | 24 → **35** | 28 → **39** | 19 → **27** |
| C 同月台進出尾巴 | 0 → 1 | 1 → 0 | 1 → 0 |
| **合計** | **606 → 292** | **635 → 282** | **506 → 212** |
| 長編組探針（修後） | 306 | 298 | 225 |

120 秒閘門（`verify_physical_no_overlap`，三日各 12/12 PASS）：9/12 A3／A′7／B39／C6；9/13 A3／A′5／B52／C9（修前 A0／A′14／B26／C5）；9/14 A0／A′4／B28／C7。

**B 變多是預期的**：以前是靠「兩班各走一股、方向亂派」把同月台疊車藏起來的，方向修對之後同向車都回到同一股，站沒有第三個可用節點就疊出來。F2 修不掉的 451 筆裡 438 筆是「無順向路徑」（見 9.3）。

### 9.3 剩下的都是路網（OSM）與時間模型的事，不是判準

- **C 平行 102（9/13）**：四城／礁溪 8、善化／拔林 6、瑞芳／猴硐 5、四腳亭／瑞芳 5、永康／新市 5、岡山／橋頭 5、竹南／崎頂 5、外澳／頭城 4、外澳／龜山 4、南靖／水上 4、竹南／造橋 4。F2 修不掉最多的站：礁溪 26、善化 23、新左營 22、岡山 22、枋寮 21、瑞芳 20、竹南 20、頭城 17、猴硐 16、龜山 15、羅東 11、五堵 10、永康 10——理由幾乎全是「無順向路徑」：候選側線在 OSM 只接一端（善化側線末端只有一組道岔）、缺渡線（岡山）。≤60 m 逆向跳接的放寬試過：0 筆解鎖，所以不是方向模型太嚴，是拓樸缺口，要補 OSM 或路網。
- **B 39（9/13）**：新左營／左營 3、臺南／保安 3、三民／玉里 3、二結／宜蘭 3、善化／拔林 3、松山／臺北 3、四城／礁溪 2、瑞芳／四腳亭 2。玉里那 3 場是加了「道岔不得倒車」之後多出來的（第一版在玉里造出 4 處要倒車轉進道岔另一支的接法，被 `verify_remaining_station_routes` 抓到；合法的改法只剩留在同一股）。
- **A′ 雙線 76（9/13）**：彰化／追分 20、山里／臺東 11、萬華／臺北 10（隧道 `1551465831` 兩向共用，第七節）、瑞穗／三民 6、八堵／七堵 5、枋野／大武 4、日南／苑裡 3——臺東線／南迴線的同名平行 way 仍未核實為第二股，方向模型照第七節不把它們當平行股道。
- **A′ 單線 39 與 A 頂上限 21**：時間模型（交會窗內無解 10、重建不合格 9、位移超過上限 100，都是 `build_run_profiles` 自己列出來的），集中在枋寮／加祿／東海、東竹／富里、枋野；A 在七堵 2 場，其餘各 1。
- **35 段逆向**（9.1）。

### 9.4 順手修的、動了的閘門、沒動的

- `verify_physical_runtime_cache.mjs` 在 origin/main 本來就紅：林鐵推拉方向（`86663b05` v0913e）是刻意加的，基線碼 `b5d7ff27` 沒有；比對前把舊碼的 `formationFacing` 乘上 `afrInitialFacing`，其餘逐值相同。突變（全系統翻面）會紅在台鐵班次。獨立一顆 commit。
- `verify_remaining_station_routes.mjs`＋fixture `remaining-routes-0913.json`：「原派車表用過的停車節點」原本從現行派車表倒推，F1／F2 把別班搬走後集合會少掉當時真的用過的節點（3218@田中、246@羅東），改成釘在 fixture 的 `sourceStops`（768 個，取 `f492a546` 的派車表）。79 個計畫重釘為 F1／F2 之後的內容；四個 09-13 新建的加開模板 F2 各搬了一個停車節點，一併重釘。動態判準沒動，過：75 班、82 處、每秒取樣 89134 點、進出站邊界 870 處最大跳躍 0.07 m。09-13 的 82 處改動有 11 處被搬回 09-13 之前的節點：9 處是 F1（09-13 的目標節點在對向那一股），2 處是 F2（北湖 1163 衝突 78→68、太原 2 衝突 16→0）。
- `verify_physical_tracks_browser.mjs` 第三項（A54 台北六車重放）在 origin/main `86663b05` 就逾時，與本批無關，未查。其餘：`verify_rail_levels`、`verify_run_profiles_match`、`verify_tra_plan_binding`、`verify_tra_pass_continuity`（4/4）、`verify_passing_avoidance` 全過；`data/tra_run_profiles.json` 內容不變。
- 沒動：`index.html`、hold 上限 120、車身、班表時刻、`stopSignature`、yard／spur。

### 9.5 跑法與順序（🔴 重抓班表 `npm run fetch-schedule` 之後整條重跑）

```
node scripts/extend_tra_station_throats.mjs            # F6：重新打包 network.json 之後才需要（有 extensions 記錄就直接略過）
node scripts/repair_physical_directions.mjs            # → output/directions/
OUT_DIR=output/stations NETWORK=output/directions/network.json DISPATCH=output/directions/dispatch.json node scripts/repair_physical_stations.mjs
cp output/stations/{network,dispatch}.json rail-3d/physical/
node scripts/build_physical_display_profiles.mjs       # 只有 way 變多／變了才需要（build_rail_levels 要每條 way 都有剖面）
node scripts/build_rail_structures_official.mjs        # 補了 way 就重跑（官方橋隧改判是逐 way 的）；快取 .cache/nlsc 三份 zip 的 sha256 要等於檔內 datasets
node scripts/build_rail_levels.mjs && node scripts/verify_rail_levels.mjs
node scripts/verify_rail_structure_heights.mjs         # = npm run check-rail-structure-heights；G5b／G6f 是絕對公里 ratchet，不准放寬
node scripts/build_tra_track_sections.mjs               # 區間表變了就 node scripts/build_run_profiles.mjs && node scripts/verify_run_profiles_match.mjs
node scripts/verify_tra_plan_binding.mjs && node scripts/verify_remaining_station_routes.mjs
node scripts/verify_verified_station_routes.mjs        # 09-12 具名路線回歸（ship-web 預檢有跑）
node scripts/verify_track_geojson.mjs                  # tra.json 站座標一改就紅；它會就地重產 data/track_*.geojson，重產結果要提交
TEST_DATE=<服務日> npm run check-physical-overlap        # 三個服務日各跑一次
UPDATE_BASELINE=1 DATES=all node scripts/verify_tra_overlap_families.mjs   # 看過家族表沒有新家族才更新基線
```

`repair_physical_platforms.mjs`（不看方向的舊修法）已被 F2 取代，不要再跑。

🔴 推 main 前：`scripts/ship_web.mjs` 預檢裡的**每一支**閘門都要在**合併後的樹**上跑過；上面只列本批直接相關的，§9.12 就是漏跑一支被擋下。

### 9.6 F6 補回站場咽喉連接段（2026-09-14 下午，同一分支；未併 main、未部署）

**根因**：`build_physical_routes.mjs` 只把候選路徑走過的 way 收進 `.cache`，`pack_physical_network.mjs` 再只打包這些 way；而 `topology.js` 的 `shortestPath` 預設不走 `service=yard`。站場咽喉裡 OSM 標成 yard 的短連接段（16–130 m）從來沒進過 `network.json`，月台旁的到發線只剩一端接著正線，F2 就報「無順向路徑」。乾跑（把 F2 修不掉的 438 筆放到「補齊殘留站上游全部 OSM way」的試驗路網重搜）把它們分成四類：只差 yard 連接段 **81**（新左營 21、枋寮 18、善化 16、岡山 14、竹南 10、新竹 2）；OSM 只畫單向渡線、要倒車才接得上 **133**（礁溪 24、瑞芳 18、猴硐 14、羅東 11…）；要逆向 **43**；幾何不連通 **138**（龜山、貢寮這類兩股無側線的小站）。這一節只做第一類。

**做了什麼**

- `scripts/fixtures/tra-station-throats-osm-0914.json`：Overpass 快照（osm base 2026-09-13T23:10:01Z）裡乾跑證明有人走的 9 條 way（8 條 yard、1 條 siding），含節點座標與標籤。只補這 9 條，不把整個站場搬進路網。
- `scripts/extend_tra_station_throats.mjs`：照 `extend_guangci_physical.mjs` 的原則接回 `network.json`——接頭同 node ID（16 個接頭的 OSM 現況座標與出貨檔逐一比對，差距全為 0 m）、新節點 15 個、不改原始標籤（yard 照留）、記 `extensions`、重跑無害；補入後檢查既有路徑經過接頭仍接得上（24 處，加了第三股之後 `canTurn` 從「接頭直通」變成道岔規則）。
- `scripts/lib/track_directions.mjs` `cleanRoute`：先照舊只找純正線順向路徑，找不到才 `allowYard` 重搜；yard／spur 以 20 倍長度計價，一條路徑的 yard 總長 ≤ `YARD_CAP_M`=150 m（乾跑 81 筆全在 130 m 內）。控制組：新程式碼在舊路網上跑 F1，network／dispatch／report 三檔逐 byte 與前一版相同；補段後 F1 的統計也一字不差（187 份計畫、597 條新路徑、35 段逆向），F1 多落成的 15 條走 yard 的路徑沒有一份計畫採用——差別全在 F2。
- `scripts/repair_physical_stations.mjs`：B 判準改成時窗含端點。起點站／終點站的官方停靠是 a===b 的零長時窗，「嚴格相交」永遠撞不到任何人，F2 就把 3001 搬到 3054 06:25 正要發車的枋寮側線節點——這是接回側線後 4 秒全日掃描多出來的唯一一種新事件（六次掃描各 +1／+2，全在枋寮側線 101917177：3001/3054、3028/3067，比對修前修後的事件清單確認），改完不再搬。修復前可見的 B 從 642 變 752，多出來的 110 對就是零長時窗。
- `scripts/build_tra_track_sections.mjs`：反向走的段序原本從 start−1 起算，與 `restore_physical_routes.mjs`／`route-runtime.js` 的 walk 解碼差一段（12343 段反向走法用正確段序全部連續，用舊段序 8490 段接不上），改成 start＋k·dir。243 站對的單／雙線旗標一個都沒變（只修段序：0；再加 F6 幾何與新派車：0），平行佔比動 ≥0.05 的只有沙鹿｜清水（0.247→0.17）與榮華｜竹東（0.34→0.263）；`tra_run_profiles.json` 內容不變。
- `display-profiles.json`／`level-profiles.json` 重建（加了 way 之後 `build_rail_levels` 先要每條 way 都有剖面）：既有 4364 條 way 的剖面 4356 條不變，改變的 8 條全是接頭所在的 way（共用節點取最大值），最大高程差 0.37 m。
- `remaining-routes-0913.json`：`waysSha256` 重釘為含 9 條補段的 ways（重釘前先驗前 4364 條與 `5689e582` 釘住的 sha 相同），afterPlans 重釘；F2 又搬了加開模板 6835 的兩個停車節點，照上午的做法 beforePlans 釘成與 afterPlans 相同。

**結果**

- F2 修不掉：451 → **374**；「無順向路徑」438 → **355**。新左營 22→0、枋寮 21→0、新竹 2→0、善化 23→7、岡山 22→8、竹南 20→10。37 份計畫走新接回的連接段（新左營→楠梓 7、枋寮↔加祿 10、橋頭→岡山 7、拔林→善化 7、竹南→造橋 5、新竹→三姓橋 1），每條走 yard 最長 130 m。既有兩條 spur（太麻里 179533237 等，09-13 就在用）不在本輪範圍。
- 120 秒閘門（三日各 12/12 PASS）：9/12 A3／A′6／B25／C6（9.2 時 B39）；9/13 A3／A′5／B36／C9（B52）；9/14 A0／A′4／B15／C7（B28）。
- 家族表（4 秒全日掃描，基線＝9.2 修後）：見下表（F4 六次掃描全部 PASS 後才更新基線）。

| 家族 | 9/12 | 9/13 | 9/14 |
| --- | --- | --- | --- |
| A-追撞未頂上限 | 3 → 3 | 5 → 5 | 2 → 2 |
| A-追撞頂到120s上限 | 21 → 21 | 21 → 21 | 10 → 10 |
| A′ 單線交會落站間 | 58 → **51** | 39 → **31** | 27 → **21** |
| A′ 雙線同股 | 73 → **70** | 76 → **73** | 62 → **60** |
| B-同月台同節點 | 35 → **21** | 39 → **22** | 27 → **13** |
| C-同月台進出尾巴 | 1 → **0** | 0 → 0 | 0 → 0 |
| C-通過車穿過停站車，旁有平行股道 | 101 → **83** | 102 → **83** | 84 → **66** |
| **合計** | **292 → 249** | **282 → 235** | **212 → 172** |
| 長編組探針合計 | 306 → 263 | 298 → 251 | 225 → 185 |

- 其餘閘門全過：`verify_rail_levels`（5019 way、0 失敗）、`verify_physical_display_profiles`、`verify_run_profiles_match`、`verify_tra_plan_binding`、`verify_physical_runtime_cache`、`verify_remaining_station_routes`（75 班、82 處、每秒取樣 89134 點、進出站邊界 902 處最大跳躍 0.07 m）、`verify_tra_pass_continuity` 4/4、`verify_passing_avoidance`。`verify_physical_tracks_browser` 第三項在 `32186503`（本節之前）就同樣逾時，與本節無關。`verify_physical_topology.mjs` 要 `.cache/physical-tracks/`，本機沒有，沒跑。
- 沒動：hold 上限 120、車身、班表時刻、`index.html`、yard 標籤。
- 重跑起點：本節的 `rail-3d/physical/{network,dispatch}.json` 是從 `27e1295d`（F1 之前）的兩個檔開始 `extend_tra_station_throats` → F1 → F2 一路產出的，不是疊在 9.1 的產物上再修；F1 本身確定性（同輸入兩次逐 byte 相同）。

**剩下的**：第二類 133 筆要在 OSM 補畫另一向渡線（先用國土測繪中心正射影像核實，公開編輯；礁溪東北咽喉在影像上看得到接西正線的連接、OSM 沒畫），第三類 138 筆是時間模型的事，F5 長編組仍未開。


### 9.7 F8 方向種子改成幾何：做完、量完，**沒有收益，已回退**（2026-09-14 晚；分支未動、沒有 commit）

**一句話**：把「乾淨方向股道」的種子從派車統計改成幾何（`output/audit-0914/residual-fix-candidates.md` §② 的 F8，預估 119 場）**整條鏈跑完了**，4 秒全日掃描三日總場數**一場都沒少**（249／235／172 → 249／235／172）：A′ 雙線同股每日 −1、B 同月台同節點每日 +1，F4 棘輪六次掃描全部因為 B 退步而 FAIL。依棘輪政策**不更新基線**，工作樹已逐檔還原回 `bda9c67c`（十個會動到的檔逐一 `cmp` 對 `git show HEAD:` 全部相同，`git status --porcelain` 只剩本檔）。實作補丁與全部產物留在 scratchpad（見下），要撿回來隨時可以。

**F8 的前提有兩處與實測不符**（這才是沒有收益的原因，不是實作沒做對）：

1. **彰化–成功–追分那 61 場修不掉**。§② 說「145／150 在 `796686558` 上對開，4.4 m 外的 `109806489` 空著」——但 `109806489`／`109806490` 是**成功–彰化**那一段，`796686558`／`841983999` 是**追分–彰化**那一段，兩者只是並排、不是同一段的兩股。把這兩條擋掉重搜，**追分↔彰化 兩個方向都變成無解**（`g.shortestPath` 放寬到 40 km 仍無解），追分的 3 個候選節點 × 彰化的 3 個候選節點 **9 組全部求不到順向路徑**。也就是說它在模型裡是**事實單線**，鎖了只會把 30 段既有通行變成無處可去。
2. **三民–瑞穗那 17 場也不是方向問題**。該走廊五條 way（`801832761`／`762`／`763`／`764`／`767`）的派車統計一模一樣：n=59、順 32／逆 27、`minority` 0.458——模型裡同樣是事實單線。七堵–八堵（14 場）則是三線區段，`830088709` 的幾何方向與 140 段派車的多數方向相反，屬於「最近平行股是中股不是對向股」，對向閘門擋掉是對的。

**實際做了什麼（三種設計，逐一實測）**

| 種子規則 | 新增鎖定 | F1 逆向段（before → after） | 可行？ |
| --- | ---: | --- | --- |
| ① 純幾何（§② 的原設計：`parFrac ≥ 0.8`＋`leftFrac` 明確＋對向閘門） | +239 | 3705 → **1943** | ❌ 59 條種子與上百段派車的多數方向相反（臺北隧道 `1551465831` 170 段、`849808697` 236 段…），鎖了修不掉 |
| ② ①＋「幾何要與派車多數方向一致」 | +110 | 1338 → **353** | ❌ 仍有臺北隧道（minority 0.497）、竹南–崎頂 99 段孤兒 |
| ③ ②＋`minority ≤ 0.2` 照舊（幾何只取代**連坐條款**與 `keepLeft`） | **+61** | 755 → **35**（＝基線） | ✅ 鏈跑得完、除 F4 外閘門全綠 |

③ 的量測（種子細節 `scratchpad/f8-directions/f8-seed.json`，49 條收斂值；`縱貫線 33、宜蘭線 9、臺東線 2、平溪線 1、北迴線 1、成追線 1、南迴線 1`）：

- 幾何可定向 2190 條；對向閘門擋下 294；與派車多數方向相反 53；兩向混用（minority > 0.2）47；派車不足 73。
- **幾何方向與統計判乾淨的方向相衝 0 條**（程式裡是 `assert.equal(conflicts, 0)` 的硬檢查，三輪都 0），與 §② 和獨立複核的預期一致。
- 唯一「幾何會把正線鎖反」的 `197197702`（派車 111/42 順向、幾何判逆向）被 `leftFrac` 門檻與「與派車多數方向一致」兩道同時擋下。
- F1：乾淨方向股道 1729（統計）＋61（幾何）＝1790 → 收斂 1747＋49＝1796；逆向段 755 → **35**，剩的站間與 9.6 完全相同（三貂嶺→大華 17、新莊→竹中 8、猴硐→瑞芳 8、二水→田中 2）；193 份計畫、換節點 584、新落成路徑 544。
- F2：14 天模型 B 794 → 229、C 9700 → 2106（9.6 是 752 → 214、9668 → 2128）；修不掉 374 → **382**（無順向路徑 355 → 363），新增的整批是 **彰化 0 → 10**「無順向路徑」——鎖了成功–彰化那一對之後，F2 在彰化搬不動月台了。

**4 秒全日掃描（生產編組；長編組探針同步 +0）**

| 家族 | 9/12 | 9/13 | 9/14 |
| --- | --- | --- | --- |
| A′ 雙線同股 | 70 → **69** | 73 → **72** | 60 → **59** |
| B 同月台同節點 | 21 → **22** | 22 → **23** | 13 → **14** |
| 其餘家族（A、A′ 單線、C×2） | 不變 | 不變 | 不變 |
| **合計** | **249 → 249** | **235 → 235** | **172 → 172** |

`fam_diff.mjs` 逐場差異（三日完全一致，模型是確定性的）：

- 消失 3 場：`2244/3267 成功/彰化`（way `1553579166`）、`149/438 南港/汐科`（`87192065`，共用 245.7 m）、`1241/438 汐科/南港`（`194492532`）——**正是 F8 鎖上的那幾條**，機制有效。
- 新增 3 場：`122/2540 彰化/彰化` B（siding `198649668`，F2 報「無順向路徑」修不掉）、`420/477` 與 `434/445` 兩場 `瑞穗/三民` A′（way `801832762`／`801832763`）。後兩場的來源是 F1 為了別處的鎖定重解了 477（純 F1 改）與 445（F1＋F2 都改），把它們挪到那條事實單線走廊的另一段去對開——**在單線走廊上換股只是換一對車撞**。

**閘門**（實跑，逐條）：`verify_rail_levels` 0 失敗、`verify_physical_display_profiles`、`build_tra_track_sections`（243 站對單／雙線旗標 **0 改變**、`parallelFrac` 動 ≥0.05 **0 個**）、`verify_run_profiles_match` FAIL 0 且 `data/tra_run_profiles.json` **內容不變**、`verify_tra_plan_binding`、`verify_remaining_station_routes`（fixture 只重釘 afterPlans 24 份，`waysSha256` 不變——本輪沒動任何 way）、`verify_physical_runtime_cache`、`verify_tra_pass_continuity`、`verify_passing_avoidance` **全部 exit 0**；120 秒閘門三日各 **12/12 PASS**（B 25→26、36→37、15→16，A／A′／C 不變）。**只有 `verify_tra_overlap_families`（F4）FAIL：六次掃描六次退步，全部是 B +1。**

**結論與處置**：F8 的可修部分實測只有每日 3 場（南港–汐科 2、成功–彰化 1），而 F1 的重解會在事實單線走廊上再生出 3 場，淨值 0；再加上棘輪 B 退步、且**不得為了讓閘門變綠改判準／基線**，所以**回退**。§② 的 119 場要重新歸因：彰化–追分 61、三民–瑞穗 17 應改列「模型裡的事實單線／OSM 沒有第二股」（F16 家族），七堵–八堵 14 與南港–汐科的 `194492532` 屬三線區段（對向閘門正確地不鎖）。

**留下的材料**（scratchpad `/private/tmp/claude-501/-Users-xuxiang-Code------/3378a3e7-35bd-44a5-9c10-0b5b5695651c/scratchpad/`）：`f8-patch/f8.diff`（兩支程式的完整補丁，已驗證重放出同一組種子數字）、`f8-directions/`（F1 產物＋`f8-seed.json`）、`f8-stations/`（F2 產物＋report）、`chain-f8.log`（整鏈逐步輸出）、`f8-f4.log`（F4 六次掃描）、`gate-default-09{12,13,14}-f8.log`、`f8/head-shipped/`（還原用的 HEAD 檔）、`f8/before/`（fam_diff 的修前家族檔）。逐步紀錄在 `output/audit-0914/f8-run.md`。

### 9.8 F12 時間模型 ＋ F9 資料補齊：整合落地（2026-09-14 傍晚，同一分支；未併 main、未部署）

**使用者裁示（逐字）**

- 「當然是你把資料有的都補上去」「交通部都有資料，那我們就應該知道有，怎麼會是當作沒有核實就不畫？」
  ⇒ OSM／TDX 有的軌道都進路網，TDX 官方逐股幾何算核實來源。
- 「不得把施工線、地面保存線、未核實用途的 yard 隨手當現役客運線」。
- 「位置不用準，時間一定要準：站牌時間完全照官方」。
- 不得靠移動畫面上的列車、隱藏行進列車、縮短車身、放鬆基線或拉高 `BLOCK_CAP_SEC=120` 消除紅燈；
  **不得為了讓閘門變綠改判準、基線或門檻**。

同日稍後使用者提供台鐵官方《路線修築沿革》，一度裁示「南迴線沒有添築雙線紀錄 ⇒ 改回單線」；
獨立核實（`worktrees/f9-prep-0914/output/audit-0914/double-track-truth.md`）指出**沿革表只記施工案，
沒列不等於單線**（沙崙線 2011 建成即雙線、整條表沒列），裁示再訂正為「6 對全部保留核實」。
第二輪退回了 4 對的 TDX 核實旗標，區間表實際改判單線的只有大武|枋野一對（單／雙 62／181 → 63／180，其餘三對本就由幾何判雙線），
第三輪全部訂正回來；243 對逐對依據的詳本已抄進 `docs/tra-double-track-truth-0914.md`（真相表 fixture 的 `provenance` 指向它）。
三輪的產物都留著可比對（`scratchpad/f9/step1-tdx6/`、`step1-officialhist/`、出貨現況），逐輪數字在
`output/audit-0914/f9-run.md` §5.5。

**做了什麼**

1. **F12 時間模型**（`index.html`，46+/7−）：交會／待避推論的夾回改法，通過站時刻只在官方停站窗內移動。
2. **F9 資料補齊**：`scripts/build_tra_station_tracks_fixture.mjs`（新）從 Overpass 快照挑出「OSM 已畫、沒被打包進出貨路網」
   的站區股道 → `scripts/fixtures/tra-station-tracks-osm-0914.json`（**1 266 條 way／307 494 m／96 站**＋`bridge` 2 條）；
   `scripts/extend_tra_station_tracks.mjs`（新）依共用節點接回 `network.json`（接頭同 node id、座標差 <0.5 m、
   `nodeTags` 只補不改、記 `extensions` 以便重跑無害）。**補入 1 268 條、ways 4 373 → 5 641。**
3. **排除的非客運線（照裁示）**：臺中港線 `106915416`／`89697472`、花蓮臨港線 `693143447`／`693144762`／`693144763`
   ——無 `service` 標籤的貨運／港線支線補進去會被 `topology.isTrack()` 當一般正線、不受 `YARD_CAP_M` 限制。
   蘇澳港線 4 條帶 `service=spur` 照舊收。另排除 `581275240`（斗南 crossover，`layer=1` 與唯一相連的既有側線矛盾，
   會讓 `build_rail_levels` 結構性無解；**不動 8% 坡度／7 m 淨距／收斂斷言**，改成不收這條）。
4. **萬華–臺北東正線橋接**（F7）：`1551465832`（OSM 既有東正線末段）＋ `f9-taipei-east-bridge-0914`
   ——**後者是依 TDX 官方逐股幾何擬的合成 way，OSM 沒畫**，fixture 裡 `synthetic: true`、證據在 `bridge.evidence`，
   `extensions.note` 也寫明「含 1 條非 OSM 既有的補缺 way（依 TDX 官方幾何）」。兩條都在路網裡，**目前零派車**。
   注意 `network.json` 打包時沒有帶 `synthetic` 欄位，路網裡只能靠「id 不是純數字」認出合成段（全網僅此一條）；旗標與證據在 fixture `bridge.ways[1]`。
5. **汐科座標訂正**：`data/tra.json` 25.06406/121.65233 → **25.06288/121.649372**（OSM 月台停車點形心），
   `d` 14.2516 → **14.577161497760995**（同一條 `shape` 的投影里程，與其他站的推算法一致）。
   官方營業里程獨立佐證：汐止–汐科 誤差 373 m → **47 m**、汐科–南港 255 m → **71 m**。
   `stopCandidates` 0 → 3（用站表新座標自己重測）。🔴 但 `data/tra_schedule_dense.json` 的站座標是抓班表時從**台鐵官方車站清單 API 的 GPS**
   抄的（`fetch_tra_schedule.py`，不走站表），重抓班表也不會跟上；而 F2 的候選池座標（`repair_physical_stations.mjs` 的 `coords`）
   與執行期站標（`state.schedStations`）都取自密檔 ⇒ 本批 F2 對汐科仍是用官方 GPS 找候選，執行期汐科站標與實體停車點相差 329 m。
   下一批處理：抓班表腳本加「以站表為準」的座標覆寫名單（汐科第一個），重跑 F2。
   → **§9.10／§9.11 做成候選但未落地**（封存在 `output/audit-0914/f18-candidate/`，見 §9.10 開頭）。
   同時訂正本點的一個前提：密檔的座標**不是**抓班表時抄官方 GPS 的，`densify_schedule.py` 對「對得上站表節點」
   的停靠站本來就會改用**站表**座標（該檔 docstring 與 `scripts/densify_schedule.py:247`），密檔的
   25.06406/121.65233 是**舊站表值**（與原始檔的 25.06405/121.65237 差 4 m，正好證明不同源）
   ⇒ 重跑 densify 就會讓密檔跟上，覆寫步驟真正不可少的對象是**原始檔** `data/tra_schedule.json`。
6. **單雙線區間表的真相來源**：TDX GIS v3「軌道路網實體路線」逐股幾何核實 8 對同名隧道 way（6 verified／1 rejected／1 樣本不足），
   再用官方《路線修築沿革》＋鐵道局公告＋維基條目交叉，逐對依據寫進 fixture 的 `truthSource`；
   新增**真相表** `scripts/fixtures/tra-track-sections-truth-0914.json`（243 對）與**新閘門**
   `scripts/verify_tra_track_sections.mjs`（逐對 `tracks` 必須等於真相表；全網里程只印不擋）。
   **里程對帳**（閘門每次印出，不擋）：區間表幾何長 單線 300.6 km／雙線 761.6 km；真相表官方里程 單線 299.5／雙線 758.6 km；
   官方《臺鐵路線及軌道長度統計》2020 年 單線 397.8／雙線 717.4 km。雙線差 **+41.2 km ＝ 2022-11 才完工的花東 4 處瓶頸 +9.1
   ＋「營業雙線里程」與「逐區間幾何加總」的口徑差 +22.5 ＋ 每對只能記 1 或 2 的二值化進位 +4.6（大武｜枋野一對佔 6.4）
   ＋ 母體差 +5.0（243 對 1058.1 km vs 表列各線 1053.1 km）**，四項加總剛好等於差額，沒有一項是逐對判錯，所以只印不擋。
   官方兩份原始檔進 `scripts/fixtures/`：`tra-line-construction-history.csv`（資料集更新至 2024-08，逐 byte 等於官方下載）、
   `tra-track-length-stats.json`（1951–2020 單／雙線里程）。
   **來源與授權：交通部 TDX 運輸資料流通服務／臺灣鐵路股份有限公司開放資料，政府資料開放授權條款第 1 版，使用須顯名。**
7. **🔴 臺／台鍵正規化（本批抓到的真 bug）**：區間表的鍵來自派車表站名（OSM 用字「台東」），
   `index.html` 查表用班表站名（「臺東」），**查不到不報錯 ⇒ 10 對站對（1 873 次）在交會推論裡整個失明**，
   其中 `康樂|臺東` 是真單線被當雙線。修法：`scripts/lib/parallel_tracks.mjs` 新增 `sectionKey()`（正規化成「臺」再排序），
   建置端兩支與 `index.html:10661` 查表入口共用同一把鍵；量測腳本 `output/audit-0914/section_key_miss.mjs`（10 → **0**）。

**結果（4 秒全日掃描，獨立事件；修前＝HEAD `bda9c67c` 基線）**

| 家族 | 9/12 | 9/13 | 9/14 |
| --- | --- | --- | --- |
| A-追撞未頂上限 | 3 → 3 | 5 → 5 | 2 → 2 |
| A-追撞頂到 120s 上限 | 21 → 21 | 21 → 21 | 10 → 10 |
| A′-單線交會落站間 | 51 → **49** | 31 → **30** | 21 → **20** |
| A′-雙線同股 | 70 → **68** | 73 → **71** | 60 → **58** |
| B-同月台同節點 | 21 → **20** | 22 → 22 | 13 → 13 |
| C-通過車穿過停站車 | 83 → 83 | 83 → 83 | 66 → 66 |
| **合計（production）** | **249 → 244** | **235 → 232** | **172 → 169** |
| **合計（long）** | **263 → 258** | **251 → 248** | **185 → 182** |

三日合計 production **656 → 645**、long **699 → 688**（各 −11）。沒有新家族。
台東–山里 31 → 31、大武–枋野 22 → 22、萬華–臺北 26 → 26 **一場都沒少**——那三組要靠派路改，補資料不會動到（見 `f9-run.md` §7.2、§8）。

**閘門**：`verify_tra_track_sections`（新）、`verify_rail_levels`（failed 0）、`verify_physical_display_profiles`、
`verify_run_profiles_match`（FAIL 0）、`verify_tra_plan_binding`、`verify_remaining_station_routes`（最大跳躍 0.0748 m）、
`verify_physical_runtime_cache`、`verify_tra_pass_continuity`（4/4）、`verify_passing_avoidance`、
**官方停靠時刻 21 992 筆差異 0（控制組故意動一筆會 FAIL）**、F4 棘輪 6 次掃描 0 退步、120 秒閘門三日各 12/12 PASS ——
全綠之後才 `UPDATE_BASELINE=1 DATES=all`。唯一非綠是 `verify_physical_tracks_browser` 第三項的既有
`waitForFunction` TimeoutError（`32186503` 以來就有，與 HEAD 那輪逐項相同）。

**出貨檔**：`network.json` 3.82 → 4.39 MB、`display-profiles.json` 10.23 → 11.32 MB、`level-profiles.json` 8.74 → 9.79 MB
（三檔合計 +2.71 MB）；`data/tra_run_profiles.json` 2 700 個跑段中 **152 個不同**。

**重跑起點**：`scratchpad/f9/step0/` 是 HEAD 出貨檔快照；把 `network.json`／`dispatch.json`／`display-profiles.json`／
`level-profiles.json`／`scripts/fixtures/remaining-routes-0913.json`／`…families-baseline.json` 複製回去，
再照 9.5 的順序整條重跑，就會逐 byte 得到同一組產物（本批實測跑了三輪，三輪的 `network.json`／`dispatch.json`／
`tra_run_profiles.json` md5 完全一致）。

**順手修掉的**：`data/data_manifest.json`／`data/data_provenance.json` **在 HEAD 就已經是紅的**
（manifest 釘 `78bc625d…`、HEAD 檔實際是 `32176755…`——F6 那輪重產區間表沒有重跑 `build_data_manifest`），
本批又改了 `data/tra.json`／`tra_track_sections.json`／`tra_run_profiles.json` 三個受管檔。
已照 `build_data_manifest.mjs` 檔頭的規定（「資料檔改動後必須重跑本腳本並一起 commit」）重產兩份，
diff 恰好只有那 3 個雜湊，`verify_data_manifest`／`verify_data_provenance` 都回到綠（7 項全過）。

**剩下的**：汐科的密檔座標（360 筆）要靠抓班表腳本的座標覆寫才會與站表一致（見第 5 點，重抓班表本身不會改）；
`data/seg_distance_audit.json` 會因為汐科的 `d` 改變而過期；萬華–臺北那 26 場要等 F7 續（見 `f9-run.md` §8）。

### 9.5 補充（本批新增的步驟，順序有依賴）

```
# ── 重抓班表那一段（npm run fetch-schedule 已含，離線只有第一步跑不了）────────────────
python3 scripts/fetch_tra_schedule.py                   # 要外網
# [F18 候選，未落地：下一行的腳本不在 HEAD，要重裝先套 output/audit-0914/f18-candidate/]
python3 scripts/apply_station_coord_overrides.py        # F18 ← 新步驟，一定在抓班表之後、densify 之前
python3 scripts/densify_schedule.py                     # 之後照鏈跑 pass_obs → track_sections → run_profiles → …
# ── 實體鏈 ─────────────────────────────────────────────────────────────────────
node scripts/extend_tra_station_throats.mjs             # F6（有 extensions 記錄就略過）
SECTION=ways,bridge node scripts/extend_tra_station_tracks.mjs   # F9 ← 新步驟，一定在 throats 之後
OUT=<暫存> node scripts/build_physical_display_profiles.mjs        # 🔴 補了 way 就一定要重建（build_rail_levels 要每條 way 都有剖面），比對後原子搬入
node scripts/repair_physical_directions.mjs             # F1 ← 會讀 scripts/fixtures/tra-direction-seeds-0914.json（F17-S1 方向種子；改種子就要從這一步整鏈重跑）
# [F18 候選，未落地：下一行的腳本不在 HEAD，要重裝先套 output/audit-0914/f18-candidate/]
OUT_DIR=output/relocations NETWORK=output/directions/network.json DISPATCH=output/directions/dispatch.json node scripts/relocate_physical_station_stops.mjs   # F18b ← 新步驟，一定在 F1 之後、F2 之前（名單 scripts/fixtures/tra-station-relocations-0914.json；§9.11 已整組回退，要出貨才跑）
OUT_DIR=output/stations NETWORK=output/relocations/network.json DISPATCH=output/relocations/dispatch.json node scripts/repair_physical_stations.mjs
cp output/stations/{network,dispatch}.json rail-3d/physical/
node scripts/build_rail_levels.mjs && node scripts/verify_rail_levels.mjs
node scripts/verify_physical_display_profiles.mjs
node scripts/build_tra_track_sections.mjs && node scripts/verify_tra_track_sections.mjs   # ← 新閘門
node scripts/build_run_profiles.mjs && node scripts/verify_run_profiles_match.mjs          # 區間表／index.html／tra.json 任一動了就要重跑
node scripts/verify_tra_plan_binding.mjs && node scripts/verify_remaining_station_routes.mjs
```

### 9.9 F17-S1 方向種子：萬華–臺北東／西正線（2026-09-14 晚，同一分支；未併 main、未部署；**閘門全綠**）

**一句話**：用「OSM way 名稱（縱貫線東正線／西正線）＋台鐵靠左行駛慣例」指名鎖住萬華–臺北隧道那三條 way 的允許方向，
F1 把 171 段臺北→萬華順行派車從西正線 `1551465831` 改走 F9 補進來的東正線鏈，繞路 **+0.17 m**、**換節點 0**、
**F2 的行為與 HEAD 控制組逐筆相同**（它本來就會搬潮州那一次，見下）；4 秒全日掃描三日 **production 645 → 619、long 688 → 658**，消失的 56 場**全部**是萬華–臺北對開、
**零新增**、任何家族任何日期都沒有退步。逐步紀錄在 `output/audit-0914/f17-run.md`。
`verify_remaining_station_routes` 一度紅（25 份已釘計畫被改到＋1 台借模板的車不在名冊裡），依 **2026-09-14 裁示**擴充名冊並附逐份證據後 **EXIT 0**；F4 基線已更新並原樣重跑確認（見「裁示與處置」）。

**做了什麼**

1. 新增 `scripts/fixtures/tra-direction-seeds-0914.json`：三條種子——`1551465831`（縱貫線西正線，允許**逆行**，節點序 **+1**）、
   `1551465832` 與 `f9-taipei-east-bridge-0914`（縱貫線東正線，允許**順行**，節點序 **−1**）。每條寫依據與節點序方向的算法。
   檔頭寫死兩條紀律：**慣例線別相依**（宜蘭線／北迴線順行＝北上，東西正線與縱貫線相反；實測 `194097697` 宜蘭線東正線 170 段**全部**逆行）、
   **七堵–八堵三線區段 `746106068`／`830088709` 排除**（台鐵方向 minority 0.434／0.423，最近平行股是中股不是對向股，§9.7 已判）。
2. `scripts/lib/track_directions.mjs`：`classify()` 產出 `clean` 之後套種子——種子 way **一律**視為乾淨方向股道並鎖成種子方向，
   也就是**整套統計判準都繞過**，不只 `minority`：`parFrac ≥ 0.8`、`n ≥ minUses(10)`、`minority ≤ 0.2`、`keepLeft`，
   以及「每一條夥伴平行股道也要自己合格」的**連坐條款**，五條一條都不必過
   （`1551465831` 的 minority 0.494 正是統計判準的自舉死結：派錯得夠嚴重就永遠不會被判乾淨；另外兩條零派車，`rows` 裡根本沒有它們的列）。
   🔴 **判準本身一個字都沒改**（`parFrac`／`minUses`／`minority`／`keepLeft`／連坐條款原封不動），改的只是「種子這幾條不歸它管」。
   防鎖反是**兩道分工互補**的硬檢查：
   - **統計檢查**（`scripts/lib/track_directions.mjs:109-110`）：種子 way「屬於允許方向的那些車次段」，節點序多數必須等於種子方向。
     它被 `if (n)` 守著 ⇒ **只對已經有派車的種子有牙**；`1551465832` 與 F9 橋接段在**引入當下零派車**（n=0），這道對它們是瞎的。
   - **拓樸連續性檢查**（`scripts/lib/track_directions.mjs:87-104`，2026-09-14 補）：凡 fixture 裡帶 `propagationSource` 的種子
     （就是那兩條零派車的）必須從一條**自己有派車、且只走一個節點序方向**的錨 way，沿 `sharedNodes` 逐段接得起來——
     前一條以它的方向走完會從共用節點出去，下一條以它的**種子方向**走起來就必須從同一個節點進。
     只用節點序拓樸、不用切線內積：方向鎖反時「入口」會變成 way 的另一端，一定對不上。
     突變實測（f17-run.md §12.1）：把 `1551465832` 或橋接段的 `nodeDir` 翻面，**在 HEAD 那份派車表上**也會紅，控制組綠。
   其餘 F1／F2 邏輯零改動。
3. 節點序方向是自己從資料算的：`1551465831` 用派車統計 × 台鐵方向（`data/tra.json` 的 `d` 遞增＝順行）拆開——
   **順行 171 段全部節點序 −1、逆行 175 段全部節點序 +1**，兩向各 100% 純；零派車兩條用沿鏈幾何傳播
   （錨 `871112939` 順行 171 段全部節點序 −1 → 共用節點 `5244930008`，內積 −0.9859 → 橋接段 → 共用節點 `8114403662`，內積 −0.9879 → `1551465832`）。
   🔴 `f9-run.md` §7.2 那句「n=346、順 175／逆 171」指的是 `classify()` 的 `fwd/rev`（**節點序**），不是台鐵方向；
   要改走東正線的是 **171** 段順行。

**結果（4 秒全日掃描，獨立事件；修前＝HEAD `e98f7d82`，同一支掃描器實跑重現基線 244／258／232／248／169／182）**

| 家族 | 09-12 P | 09-12 L | 09-13 P | 09-13 L | 09-14 P | 09-14 L |
| --- | --- | --- | --- | --- | --- | --- |
| A-追撞未頂上限 | 3 → 3 | 6 → 6 | 5 → 5 | 7 → 7 | 2 → 2 | 4 → 4 |
| A-追撞頂到 120s 上限 | 21 → 21 | 21 → 21 | 21 → 21 | 22 → 22 | 10 → 10 | 10 → 10 |
| Ap-單線交會落站間 | 49 → 49 | 50 → 50 | 30 → 30 | 31 → 31 | 20 → 20 | 21 → 21 |
| Ap-雙線同股 | 68 → **60** | 76 → **67** | 71 → **61** | 80 → **68** | 58 → **50** | 66 → **57** |
| B-同月台同節點 | 20 → 20 | 20 → 20 | 22 → 22 | 22 → 22 | 13 → 13 | 13 → 13 |
| C-通過車穿過停站車 | 83 → 83 | 85 → 85 | 83 → 83 | 86 → 86 | 66 → 66 | 68 → 68 |
| **合計** | 244 → **236** | 258 → **249** | 232 → **222** | 248 → **236** | 169 → **161** | 182 → **173** |

三日合計 production **645 → 619**（−26）、long **688 → 658**（−30）。
**萬華–臺北：26 → 0（production，逐日 8／10／8 全歸零）、30 → 0（long，逐日 9／12／9）**——
`f9-run.md` §7.2 列的三組「要靠派路改」的站對，這一組結清了（台東–山里 31、大武–枋野 22 不在本批範圍）。
逐場比對：**消失 56 場、新增 0 場**，56 場全部落在 `1551465831`、家族全部是 `Ap-雙線同股`。
沒有像 §9.7 的 F8 那樣「在事實單線走廊上換一對車撞」。

**F1／F2**

- F1：逆向段（套種子後）**206 → 35**，修不掉的 35 段與 §9.8 **逐站間完全相同**（三貂嶺→大華 17、新莊→竹中 8、猴硐→瑞芳 8、二水→田中 2），**零新增**；
  新落成路徑 14、改到 171 份計畫、**換停車節點 0**；同節點停站時窗相交 158 → 158。171 段全部是臺北→萬華，
  新走法 `…871112939, f9-taipei-east-bridge-0914, 1551465832, 615600483…`（少走一條 crossover `871112937`），繞路 min/median/max 全是 **+0.17 m**。
- F2：修不掉 **370**（無順向路徑 353／道岔接不上 5／無替代節點 4／換了不會更好 8）、B 213、C 2100、搬 1 次（潮州）——
  **與 HEAD 控制組逐筆相同**（控制組＝把兩支程式 `git show HEAD:` 還原後對同一份輸入重跑；HEAD 程式碼在出貨檔上是 no-op）。
- 🔴 **潮州那一搬要單獨交代**（`output/stations/report.json` 的 `moves` 原文）：
  `{"key":"tra_sched:161:20700:44100","i":107,"station":"tra_sched:潮州","from":"12183049788","to":"12183049787","before":6,"after":4}`。
  依據：161 次 **2026-09-12** 停潮州（第 107 站，`arrSec 39300`／`depSec 39420`、官方停靠）停在節點 `12183049788`；
  **6099 次只在 2026-09-12 行駛**，`stop:false` **通過**潮州（`arrSec = depSec = 39324`，剖面時刻 39323.0），
  進站段與出站段的路徑都經過 `12183049788`，落在 161 的停站窗 ±`PASS_MARGIN` 60 s 內
  ⇒ **C 類（通過車穿過停站車）兩場**（進站一場、出站一場）。搬到 `12183049787` 之後這兩場歸零：
  該站與前後站（竹田／潮州／崁頂）局部 **6 → 4**、全域 **C 2102 → 2100**、**B 213 不變**。
  **HEAD 控制組重跑 F2 搬的是同一次**（同 key、同 `i=107`、同 `from`／`to`、同 6→4、同 2102→2100）
  ⇒ 這是 **HEAD 那份派車表本來就有、而 F2 從來不是它的定點**，**不是方向種子造成的**。
- 全部影響：ways 0 改變、新增 14 條 path（21117–21130）；**實際變動段 173**——
  F1 重指 171 段（171 份計畫**各只有 1 段**，全部是臺北→萬華）＋F2 搬潮州再動 2 段
  （同一份計畫 `tra_sched:161:20700:44100` 的第 106 段竹田→潮州 `5264→5263`、第 107 段潮州→崁頂 `8886→20452`，兩條都是既有路徑，`newPaths: 0`）。
  161 是**唯一**變動超過一段的計畫。**`stopSignature` 0 變動、`holds` 0 變動**。
  `scripts/fixtures/remaining-routes-0913.json` 的名冊**不含計畫 161**（`afterPlans`／`changes` 都沒有這個 key），所以 fixture 不必因此再動。

**閘門**：`verify_rail_levels`（failed 0）、`verify_physical_display_profiles`、`verify_tra_track_sections`（243 對不一致 0）、
`verify_run_profiles_match`（**FAIL 0**，且 `data/tra_run_profiles.json` **md5 與 HEAD 逐 byte 相同**）、`verify_tra_plan_binding`、
`verify_passing_avoidance`、`verify_tra_pass_continuity`（4/4）、`verify_physical_runtime_cache`、
**官方停靠時刻 21 992 筆差異 0**、`verify_data_manifest`／`verify_data_provenance`（依檔頭規定重產，diff 只有 `tra_track_sections` 一個雜湊）、
**F4 棘輪 6 次掃描 0 退步**、**120 秒閘門三日各 12/12 PASS**（A′ 9/12 6→5、9/13 5→4、9/14 4→3）、`verify_remaining_station_routes`（裁示後 **EXIT 0**：trains 76／changes 83／samples 89 396／protectedCount 4）。
`display-profiles.json` 沒重建（沒加 way，md5 不變）；`level-profiles.json` 只差 `inputSha256`；
`tra_track_sections.json` 243 對只有 `臺北|萬華` 的 `parallelFrac` 0.964 → 0.970，單／雙線旗標 0 改變。

**裁示與處置：`verify_remaining_station_routes` 紅 → EXIT 0（2026-09-14 裁示）**

紅的內容：F17 改到了 fixture 釘住的 79 份計畫裡的 **25 份**（21 份在 `changes` 名冊內、4 份是 `protectedTemplates`），
外加 `tra_sched:213:37440:48000`——它自己沒有計畫，以 `route-template` 借用 `tra_sched:281:58980:88980`，
借的區段剛好涵蓋模板第 45 段（臺北→萬華）。HEAD 控制組同一支閘門 EXIT 0，證明是 F17 造成、不是既有紅。

裁示原文（節錄）：「**這 5 台走的是同一個修法、不是回歸，准予擴充名冊，但要附證據、不改閘門判準。**」依此處置：

1. **`changes` 補第 83 筆**，新 `kind: "direction-seed"`：
   `{"key":"tra_sched:213:37440:48000","station":"臺北→萬華","oldPaths":[501],"newPaths":[21117],`
   `"from":47100,"to":47361.99998706579,"date":"2026-09-13","timeSec":47100,"holds":"0/0","note":"借用模板 281 的第 45 段隨 F17 改走東正線"}`。
   先驗過閘門的逐 change 迴圈只讀 `key`（`:9`）、`from`／`to`（`:11`）與**可選**的 `toNode`（`:7` 有 `if(c.toNode)` 守著），
   所以 `fromNode`／`toNode` 依裁示省略，**閘門程式一行都沒改**（`git status --porcelain -- 'scripts/verify_*.mjs'` 為空）。
2. **25 份 `afterPlans` 重釘**；`protectedTemplates` 那 4 份的 **`beforePlans` 同步重釘**——
   閘門 `:5` 的比較基準就是 `beforePlans`，只動 `afterPlans` 會讓 `:9` 的「未改車班因模板變更被動換軌」當場紅（實測 EXIT 1）。
   兩邊一起改，§9.6 立下的 `beforePlans === afterPlans`＝「本批不動這 4 份模板」不變式原封不動，`protectedCount === 4` 照常成立。
3. **逐份證據**（`output/audit-0914/f17_repin_evidence.mjs`，對 HEAD 出貨派車表逐份逐段比對，EXIT 0）：
   26 份每一份的「相同段數」**恰好等於總段數 − 1**，唯一那一段的站對**全部是臺北｜萬華**，`pathIds` 以外欄位零變動
   ⇒ 4 份受保護模板 09-13 修的站段（含 `stopSignature`／`holds`）原封不動。
   差異段索引 `1`／`7`／`10`／`17`／`34`／`45`／`49`／`71`／`108` 各不相同，pathId 對照只有兩種：`501→21117`（23 份）、`509→21118`（3 份）。
   完整表格在 `output/audit-0914/f17-run.md` §11.3，fixture 的 `refreshed` 也記了日期、原因與 pathId 對照。
4. **閘門重跑**：`verify_remaining_station_routes` **EXIT 0**（trains 76、changes 83、samples 89 396、boundaries 972、
   maxBoundaryJump 0.075 m、protectedCount 4；多出的 262 筆 samples 恰好是 213 次那一筆的取樣窗，證明新名冊真的被跑到）。
   `UPDATE_BASELINE=1 DATES=all` 更新 F4 基線後**原樣再跑一次 `DATES=all`：PASS、0 退步**，六次逐項與新基線完全相同
   （236／249／222／236／161／173）。基線的逐項差異**只有 `Ap-雙線同股` 一個家族**（六天次合計 −56 場），
   其餘 5 個家族 6 天次逐項不變、`basis` 逐 byte 沒動 ⇒ 是把收益鎖進棘輪，不是放寬棘輪。
   `verify_data_manifest`／`verify_data_provenance` EXIT 0（三個 fixture 都不在這兩份清單涵蓋的 `data/` 開機資料檔裡，不需重產）。

**判準沒有被動過**：兩次天然的紅（只重釘 `afterPlans` 時紅、`beforePlans` 留舊時也紅）就是這道閘門仍有牙的正向對照。

**沒動的**：`index.html`、`BLOCK_CAP_SEC`／hold 上限 120、車身常數、班表時刻、`stopSignature`、任何 way、
任何 `verify_*` 的判準與門檻、`MEET_HEADWAY_SEC`／`MEET_NEAR_SEC`。

### 9.10 F18 汐科座標：站表成為站座標的單一來源（2026-09-14 深夜，同一分支；未併 main、未部署；**閘門全綠，但目標距離沒達成**）

> 🅿️ **封存（2026-09-14 19:40）**：本節與相鄰節（§9.10／§9.11）的程式、fixture、資料變更**全部沒有 commit**，整包在 `output/audit-0914/f18-candidate/`（`f18-tracked.patch`＋`untracked/`，gitignored）；原因是 F18b 讓「Ap-雙線同股」六次掃描各 +1～+2，依「不得放鬆基線」回退，出貨與否交使用者裁示（§9.11 待裁）。HEAD 上汐科維持「站標與停車點一起偏東北 330 m」的一致狀態。

**一句話**：班表原始檔與密檔的汐科座標統一成站表 `data/tra.json` 的 OSM `railway=stop` 形心
（25.06288／121.649372），機制是站表新增的 `stationCoordOverrides` 名單＋新腳本
`scripts/apply_station_coord_overrides.py`（接進 `npm run fetch-schedule`、離線可跑、冪等）。
**官方停靠時刻 21 992 筆差異 0、通過站時刻 14 469 筆差異 0**，閘門全綠、4 秒掃描六次 0 退步。
**但「站標貼著車」沒有達成**：修前 188/188 < 60 m 是**兩個錯互相抵消**（站標與停車點一起錯在東北 330 m），
修後站標對了、停車點仍在舊位置 ⇒ **0/188**。逐步紀錄在 `output/audit-0914/f18-run.md`。

**現況量測（動手前）**

汐科同時有四份座標：站表 25.06288/121.649372（F9 已改，0 m）、原始班表 25.06405/121.65237（官方 ODS `gps`，**328.8 m**）、
密檔 25.06406/121.65233（**舊站表值**，325.6 m）、`data/tra_station_info.json` 25.06406/121.65233（TDX，325.6 m）。
`stopCandidates('汐科')` 用站表座標回 **3** 個 `railway=stop` 節點（`289132000` 1.6 m、`2046001385` 5.9 m、
`2046001420` 7.5 m），用官方 GPS 或密檔座標回 **0** 個，只給站名也回 0（那三個節點沒有 `name` 標籤）。
出貨派車表裡汐科的 188 個官方停靠用了 `2046001446`（92 班，285.5 m）、`12054459153`（89 班，331.5 m）、
`12054459154`（7 班，331.7 m）——**沒有一個是 `railway=stop`**，全是 `build_physical_routes.mjs:22-27` 在
`stopCandidates` 回 0 時的 `estimated-stop-on-osm-track` 退路用錯座標挑出來的。

**做了什麼**

1. `data/tra.json` 新增頂層 **`stationCoordOverrides`**（只有汐科一筆；`lines` 一個字沒動）：
   `name`／`since`／`reason`／`supersededCoords[]`（兩個上游原值與偏移）／`evidence`／`assertStationCoord`。
   **覆寫值不寫在名單裡**，一律取自站表 `lines`，避免長出第二份真相。
2. 新增 **`scripts/apply_station_coord_overrides.py`**：斷言站表該站座標 ≡ `assertStationCoord`
   （`fetch_tra.py` 把它退回上游時當場紅）→ 把 `data/tra_schedule.json` 同名站每一筆 stop 的 `lat`/`lon`
   換成站表座標 → `source_notes` 尾端重寫覆寫紀錄。**冪等實測**：連跑兩次，第二次改動 0 筆、輸出逐 byte 相同。
3. `package.json` 的 `fetch-schedule` 插入這一步（在 `fetch_tra_schedule.py` 之後、`densify_schedule.py` 之前）；
   `fetch_tra_schedule.py` 只加檔頭註解，抓取邏輯一行沒改。

**數字**

- 原始檔逐欄比對：差異欄位**只有汐科的 `lat` 188 筆與 `lon` 188 筆**＋`source_notes` 尾段；時刻零變動。
- 密檔：汐科 360 筆（官方 188／通過 172）座標**全部等於站表**；
  **官方停靠列 21 992 筆時刻差異 0、通過列 14 469 筆時刻差異 0**——連經過汐科的車都沒變，
  因為內插與最短路徑的權重取自 `data/tra_station_of_line.json` 的官方累計里程（`mileage_fallback_edges=0/243`），
  改站座標動不到任何時刻。正向對照：故意把 1217 次汐科 `arrSec` +1 秒，同一支比對當場 `FAIL`。
- `tra_track_sections.json`／`tra_run_profiles.json`／`transfer_departures.json` **md5 與 HEAD 逐 byte 相同**；
  `tra_widget_schedule.json` 只差 `stations[29]` 兩個座標＋`generated` 時戳；manifest／provenance 只改兩個雜湊。
- **站標 ↔ 停車點**：修前 min/中位/max = 12.8/17.8/47.4 m（188/188 < 60 m，但站標錯 330 m）；
  修後 285.5/331.5/331.7 m（**0/188**）。

**實體鏈重跑：做了、量了、整組回退**

F1 零改動；F2 搬 **3** 次（汐科 2：`1235`、`4135`，`2046001446 → 2046001420`；潮州 1），C 2102 → 2097。
控制組（HEAD 資料檔原樣重跑 F1／F2）搬 **1** 次（潮州，同 key、同 `i=107`、同 6→4，方向與 §9.9 那次**相反**
⇒ **F2 對潮州 161 不是定點，會來回翻**，既有行為、與本批無關）。
`verify_remaining_station_routes` 因 `4135` 在 fixture 釘住的 79 份裡而紅，重釘 `afterPlans` 後 EXIT 0
（boundaries 972 → 974，多的 2 個正是新的汐科進出站邊界），其餘閘門含 120 秒三日 12/12 也全綠。

**但 `DATES=all` 的 4 秒全日掃描 6 次有 4 次退步**，全部集中在 `A-追撞未頂上限`：
09-13 P 5→8、09-13 L 7→8、09-14 P 2→5、09-14 L 4→5（09-12 兩項不變；其餘 5 個家族 6 天次逐項不變，C 一場都沒少）。
逐場核對：新增事件**全部**是 `1235/5257`、站段 `汐止/汐止`／`汐止/汐科`、時間 64 448–64 484 s。
**根因是半套搬遷**——F2 只在「有 B／C 衝突且搬了會變少」時才搬，188 班裡只有 2 班搬到真月台、186 班還在 330 m 外，
同一站出現相距 330 m 的兩個停車位置，1235 的走行幾何整個變了就和後面的 5257 追撞。
F2 的模型只數「停站時窗 × 節點」的 B／C、不模擬行車，所以它賺到的 C 在掃描上一場都沒兌現。
依「不得為了讓閘門變綠改判準、基線或門檻」與「逐家族逐日期不得上升」，**不更新基線、不放寬判準，整組回退**：
`rail-3d/physical/{network,dispatch}.json` 與 `scripts/fixtures/remaining-routes-0913.json` 用 `git show HEAD:` 還原，
`level-profiles.json` 重建後 md5 與 HEAD 逐 byte 相同。產物留在 `output/directions/`、`output/stations/`（控制組 `output/*-ctl/`）。

**targeted 重派做不到（不是不想做）**：`build_physical_routes.mjs` 沒有 targeted 模式（一次跑完全部站對，
再經 `pack_physical_network` 與 `assemble_physical_dispatch` 整份重組＝被禁止的整包重解）；
它的輸入 `.cache/physical-tracks/network-with-stations.json` 在這棵樹裡**不存在**、repo 裡沒有任何腳本產生它
（要回頭抓 OSM，本批沒有外網）；而且它取站座標用的是 `data/tra_station_info.json`，不是站表。
⇒ **站標已對、停靠點仍舊。**

**閘門**：官方停靠時刻 21 992 筆差異 0（含正向對照）、`verify_rail_levels`（failed 0）、
`verify_physical_display_profiles`、`verify_tra_track_sections`（不一致 0）、`verify_run_profiles_match`（FAIL 0）、
`verify_tra_plan_binding`、`verify_remaining_station_routes`（trains 76／changes 83／samples 89 396／
boundaries 972／maxBoundaryJump 0.0748 m／protectedCount 4）、`verify_passing_avoidance`、
`verify_tra_pass_continuity`（4/4）、`verify_physical_runtime_cache`、`verify_data_manifest`／`verify_data_provenance`、
**120 秒閘門三日各 12/12**、**`DATES=all` 六次掃描 0 退步**（236／249／222／236／161／173，逐項等於基線）。
`UPDATE_BASELINE=1` **沒有跑**——結果與基線逐項相同，不必動也不該動。

**風險**

1. 🔴 **`fetch_tra.py:345-361` 會拿 `data/tra_station_info.json` 覆寫站表每一站的座標**，下次跑它，
   F9 的汐科修正會被靜默退回（該檔註解自己就寫著 2026-07-11 修過「汐科(偏0.4km)」）。
   `assertStationCoord` 守門人只在覆寫腳本跑到時才叫，而 `fetch_tra.py` 不在 `fetch-schedule` 鏈裡。
   ✅ **已於 §9.11（F18b）根治**：名單內的站跳過 TDX 覆寫，守門人 `npm run check-station-coord-overrides`（含正向對照）。
2. **站標與車差 330 m 是使用者看得到的新落差**（修前是兩個錯抵消才貼合）。依「位置不用準，時間一定要準」
   在裁示範圍內，但要不要這樣出貨請裁示。
   ⚠️ **§9.11（F18b）把落差收到 1.6–7.5 m 了，但因為家族棘輪退步而整組回退** ⇒ 這一條**仍然成立**，
   等裁示要不要收下那批（候選產物在 `output/stations/`，裝法見 `output/audit-0914/f18b-run.md` §7）。
3. `build_pass_obs.mjs` 與 `fetch_tra_schedule.py` 離線跑不了 ⇒ 「抓班表 → 覆寫」這一段**沒有端到端跑過**，
   要等有外網那一輪才算驗到底。
4. `data/seg_distance_audit.json` 仍因汐科的 `d` 改變而過期（F9 留下的尾巴）。

**沒動的**：`index.html`、`BLOCK_CAP_SEC`／hold 上限 120、`MEET_*`、車身常數、班表時刻、`stopSignature`、
任何 way、任何 `verify_*` 的判準與門檻、`rail-3d/physical/*`、`scripts/fixtures/*`。

### 9.11 F18b 汐科站位遷移：機制做好、距離達標、**實體層整組回退**（2026-09-14 深夜，同一分支；未併 main、未部署）

> 🅿️ **封存（2026-09-14 19:40）**：本節與相鄰節（§9.10／§9.11）的程式、fixture、資料變更**全部沒有 commit**，整包在 `output/audit-0914/f18-candidate/`（`f18-tracked.patch`＋`untracked/`，gitignored）；原因是 F18b 讓「Ap-雙線同股」六次掃描各 +1～+2，依「不得放鬆基線」回退，出貨與否交使用者裁示（§9.11 待裁）。HEAD 上汐科維持「站標與停車點一起偏東北 330 m」的一致狀態。

**一句話**：新增 `scripts/relocate_physical_station_stops.mjs`（接在 F1 之後、F2 之前），
把汐科**全部 360 個車次鍵**（官方停靠 188 ＋ 通過 172）的節點從初次派路挑錯的舊位置搬到 OSM 三個
`railway=stop` 月台——**離站標 285–332 m → 1.6–7.5 m，188/188 與 172/172 全部 < 60 m**，§9.10 沒達成的
目標這一批達成了；官方停靠時刻 21 992 筆差異 0、`tra_run_profiles.json` 與 HEAD 逐 byte 相同、
120 秒閘門三日各 12/12、其餘閘門全綠。**但 4 秒全日掃描的 `Ap-雙線同股` 六次掃描全部 +1（production）／
+2（long）**，根因在**汐止站的股道指派**（南下與北上本來就都走中正線 `194089087`），不是汐科；
依「不得為了讓閘門變綠改判準、基線或門檻」與「逐家族逐日期不得上升」**整組回退**，逐檔 md5 回到 HEAD。
逐步紀錄與逐場證據在 `output/audit-0914/f18b-run.md`。

**機制**（`scripts/fixtures/tra-station-relocations-0914.json`：站名／`since`／`maxGapM`=60／`includePassing`／
正確座標來源＝`data/tra.json`／原因與證據）

* 要搬誰＝「經過該站、且現行節點離**現查站表**座標 > `maxGapM`」；語意是**一定要搬**，不是 F2 的「搬了會更好才搬」。
* 候選＝`topology.stopCandidates(正確座標)` 且 ≤ `maxGapM` 的節點（OSM 標的停車位置，不憑空造月台）；
  挑法與 F2 同一套（`cleanRoute` 順向路徑、三個接點 `g.canTurn`、日別 B／C 衝突最少、同分挑路徑短的）。
* 候選為 0 或無順向路徑／道岔接不上 ⇒ **留原地並記錄原因**；收尾斷言「沒搬的每一筆都要有原因」。本批留原地 **0 筆**。
* **冪等**：拿自己的輸出再跑一次 ⇒ 要搬 0、搬了 0、新路徑 0（門檻是「離站標 > `maxGapM`」，搬完就沒人符合）。

**🔴 通過車（`stop:false`）也要搬——這是第一輪的教訓**：通過車在該站的節點不是停車位置，而是進站段／出站段的
**切點**，motion 就用那個切點把通過時刻對到地面上。只搬 188 班停靠車的那一輪，`A-追撞未頂上限`
在 09-13／09-14 各 +3（新增事件全部是 `1235/5257`，與 §9.10 F2 半套搬遷量到的是同一組）。逐秒定位：
同一個「汐止｜汐科」站間，停靠車的終點在真月台（1 082 m）、通過車的終點還在 285 m 外的舊點（948 m），
官方時間不變 ⇒ 兩類車被拉出不同的速度，1235 追上前面的 5257，兩車間距在 64 464 s 從 HEAD 的 266 m 掉到 **58.8 m**。
`includePassing: true` 把 172 筆通過一起搬之後，同一時刻間距是 **345 m（比 HEAD 還大）**，
`A-追撞未頂上限` 六次掃描逐項回到基線。

**搬完的結果**：股道血統幾乎完全保留（東正線 `2046001446`→`2046001420` 92+87 筆、
西正線 `12054459153`→`2046001385` 89+82 筆、中正線 `12054459154`→`289132000` 5+1 筆），
只有 4 筆從中正線改到西正線（衝突數相同、路徑短 37 m）。**356/360 的新舊路徑總長差 0 m**——
新舊節點在同一條走廊上，變的只有切點。區間表只有兩對變：`汐止|汐科` 948→1082 m、`南港|汐科` 5128→4969 m（`tracks` 都還是 2）。

**為什麼回退**：`Ap-雙線同股` 六次掃描全退步，逐場只有兩個新事件，**都在中正線 `194089087`、都在
`汐科/汐止` 站間**：`4013/472`（32 200 s，共用 0.5 m／long 15.2 m，六次全有）與 `1228/1235`
（64 424–64 428 s，共用 21.0 m，只在 long 探針）。兩對都是對向車，而**HEAD 的路徑本來就都走那段中正線**
（汐止站的咽喉）——這正是這個家族在講的事（基線本來就有 50–68 場）。本批把站間長度改對之後
（南下 964→1251 m、北上 916→1247 m，官方時刻不變 ⇒ 兩向都跑得比原來快），交會點往那段共用中正線上挪，
各多量到一場。**不是「還有班沒搬」**（360/360 全搬、留原地 0），**也不是汐止站標偏移**
（汐止的停車節點離站標只有 3.5–23.1 m，257/257 < 60 m）。要根治得動汐止的股道指派／方向模型，
而中正線是三線區段的中股，§9.7 已明文禁止照名稱把中股列入方向種子 ⇒ 超出本批範圍。

**回退驗證**：`rail-3d/physical/{network,dispatch,level-profiles}.json`、`scripts/fixtures/remaining-routes-0913.json`、
`data/tra_track_sections.json`、`data/tra_run_profiles.json` **六個檔逐 byte 等於 HEAD**；回退後十道閘門複跑全 EXIT 0。
`UPDATE_BASELINE=1` **沒有跑**。候選產物完整留在 `output/relocations/`、`output/stations/`，
裁示要出貨的話兩行指令就裝得回去（`f18b-run.md` §7）。

**順帶根治 §9.10 風險 1（`fetch_tra.py` 的靜默退回）**：把那段抽成兩支可離線單測的函式
（`load_station_coord_overrides()`＋`apply_station_coords()`），名單內的站**跳過 TDX 覆寫**、改用名單釘住的
`assertStationCoord`（那組值與站表 `lines` 的值由 `apply_station_coord_overrides.py` 的斷言綁在一起），
並印一行跳過紀錄；名單本身在重寫 `data/tra.json` 時原樣帶回去（不然名單會被自己洗掉）。
新守門人 `scripts/verify_station_coord_overrides.py`（`npm run check-station-coord-overrides`）離線重演那一段：
A 名單內座標不變且等於 `assertStationCoord`；B 名單外 240 站照舊等於 TDX 值（其中 201 站與覆寫前不同 ⇒
覆寫真的有發生，這一項不是恆真）；**C 正向對照**——把名單清空，汐科就被退回 25.06406/121.65233（離站表 325.6 m）。

**這一輪順手量到、但沒處理的**：站表現值與 `data/tra_station_info.json` 不一致的站有 **202 站**
（中位 28.6 m，> 50 m 的 35 站：漢本 182.7、基隆 151.9、和平 141.5…）⇒ 跑一次 `fetch_tra.py` 會搬動這 202 站，
覆寫名單目前只保護汐科。另外**南港（143.5–148.5 m）與松山（126.0–141.8 m）的停車節點也離站標超過 60 m**，
與汐科同一類缺陷；機制已經在了（加進 fixture 即可），但要先確認那兩站的「正確站標」本身可信
（汐科有官方營業里程佐證；南港／松山是地下站、月台很長，143 m 也可能只是月台中心與停車位置的正常偏移）。

**沒動的**：`index.html`、`BLOCK_CAP_SEC`／hold 上限 120、`MEET_*`、車身常數、班表時刻、`stopSignature`、
任何 way、任何 `verify_*` 的判準與門檻、`scripts/repair_physical_stations.mjs`（F2）本體、家族基線。

### 9.12 出貨嘗試：被 3D 橋隧高度閘門擋下，main 已退回（2026-09-14 19:49）

- 本分支併進 main（`4a5a3f6f`，零衝突；BUILD v0914d；更新紀錄沿用 `remainingtracks0913` 並補中英日翻譯）推上後，
  `npm run ship-web` 預檢被 **`verify_rail_structure_heights`**（`npm run check-rail-structure-heights`）擋下，沒有部署：
  - G6f 台鐵平面段浮空 >10 m：**6.49 → 6.62 km**（基準 6.6，最高點仍 29.2 m @way 1270414589）
  - G5b 隧道軌面高於地表、整段不畫：**3.23 → 3.46 km**（基準 3.4）
- 對照：合併前 main（`239fdbf7`）這支通過；本分支 `bab68011` 單獨跑就紅 ⇒ 是本分支造成（F6／F9 新增 way 與 rail levels 重算），
  不是環境。**§9.5 的閘門清單一直沒有這支**，所以分支上從沒量到。
- 處置：main 以 `d5e3a113` 整顆退回合併（另補 `aba8f003` 漏更新的 4 個捷運班表雜湊），正式站未變動（仍 v0914c）。
  🔴 **再併本分支時要先 revert `d5e3a113`**，否則 git 會把分支當成已合併而略過內容。
- 下一步（不放寬基準）：逐 way 比對 `239fdbf7` 與本分支的 G6f／G5b 貢獻，找出新增的浮空與不畫段、修高度；
  把 `check-rail-structure-heights` 加進 §9.5 閘門清單；推 main 前跑完整 ship-web 預檢。

### 9.13 修高度：基隆隧道回到 main 的值；蘇澳港線待裁（2026-09-14 晚，同一分支；未併 main、未部署）

- 逐 way 比對合併前 main（`d5e3a113`）與分支的 G6f／G5b 貢獻（兩棵樹各跑同一份量測再相減）：
  - G5b 隧道不畫 +0.23 km 全在**基隆站場**：新增股道鏈「橋 1254269078（16 m，layer 1）→ 明示隧道 1434789997（13 m）→ 1254269077（187 m，只有 layer −1）」
    接到第一A月台停靠線 533464243 北端。隧道求解器把洞口釘在橋面高度（離地 CLEAR 6 m），縱坡 2.5% 下 200 m 內降不到覆土，整段高於地表、一根線都不畫。
  - G6f 平面浮空 +0.13 km 全在**蘇澳港線** 4 條新 spur（145608233、1527875178、1527875179、1033291385），既有 way 零變化。
- 根因與修法（`06847626`）：官方橋隧對照表的反向改判只用 DEM 起伏當裁判，對官方結構碼 3（都市地下段，上方沒有山）永遠沒有鑑別力，
  「來源標橋、官方判地下、地形沒有山」這一格一定落進 unresolved。1254269078 官方涵蓋 100%、起伏 0.1 m，端點直接接上來源明示 tunnel=yes 的股道
  ⇒ 產生器補 `flushTunnel` 第二裁判。全網只命中這一條；另一條 unresolved 的捷運環狀線 741259917 兩端接高架，不受影響。
  - 對照表重產：既有 290 條逐條不變；新增 1254269078（改判地下）與 101917173 枋寮一號橋（新增股道的一般升級）。
    控制組在 main 重產，逐條等於已提交版；快取 zip 三份 sha256 與檔內記錄相同。
  - 重跑 build_rail_levels：**G5b 3.46 → 3.23 km，逐 way 與 main 零差異**。
    G1 對第二裁判條目從 network 原始標記重算鄰接、重驗涵蓋並釘死名單；突變（起伏改 25 m／拿掉 arbiter）各自被抓，控制組只剩 G6f。
- 🔴 **蘇澳港線（未解，待裁示）**：軌道中心線 DEM 在 80 m 內從 7 m 升到 17 m 再降回 5 m，南側約 40 m 是 33 m 的小山頂；
  國土測繪中心同一段判「一般平面」、前一段是蘇澳橋 ⇒ 實際是 20 m DTM 解析不到的路塹。
  求解器「平面不低於地表」＋縱坡 2.5% 只能把軌道抬過山肩再慢慢降，兩側尾段浮空 10.6–12.5 m。
  畫在真實高度會埋進地形（G6e 上限 0.1 km，現況 0.06 km），維持抬升則 G6f 6.62 km 超過 6.6。
  蘇澳橋以東這 4 條 spur 合計 385 m，都是死端，沒有任何列車使用。
- 預檢順帶補的：`verify_track_geojson` G0 在分支紅（本分支 tra.json 已更正汐科座標，track_stations.geojson 沒重跑）⇒ `a1031e81` 重產並提交，607 點只有汐科改變。
  `verify_verified_station_routes` 在 `b87dc013` 就紅：4234 七堵—八堵的新進路踩到 09-12 擋掉的對向資源；1208 埔心—中壢的起訖停車點變了。另案處理。
  ship-web 預檢中與台鐵／軌道／班表相關的另 34 支，在分支上除 verified_station_routes 外全過；i18n／manifest 類要在合併後的樹上跑。
