# 台鐵實體股道派車管線 code map（對向穿越 root cause 調查）

工作樹：/Users/xuxiang/Code/捷運小動畫/.claude/worktrees/overlap-rootcause （= origin/main 86663b05）
產生時間：2026-09-14。逐項附 檔案:行號＋逐字節錄；找不到寫「未找到（grep 關鍵字）」。

---

## A. 路網建置

### A1. OSM 來源與抓取 — `scripts/build_physical_track_graph.py`

- 來源格式：Overpass API JSON（`out body geom`），台灣範圍 bbox。逐字節錄（第 10 行）：
  ```python
  QUERY = '[out:json][timeout:45];way[railway~"^(rail|subway|light_rail|tram|monorail|narrow_gauge)$"](21.8,119.8,25.4,122.1);out body geom;'
  ```
- 抓取頻率：程式本身不含 cron／排程，是被 `scripts/rebuild_physical_cache.mjs` 或人工在需要重建拓樸時呼叫的一次性建置腳本；快照存放於 README 提到但本檔沒有的 `.cache/physical-tracks/`（不在版控，本工作樹未見該目錄）。

### A2. `tracks=2`／`railway:track_ref`／`service`／`usage`／`railway=construction|disused|abandoned` 逐一核對

**`tracks=2` — 未展開，甚至未收集。** `TAGS` 清單（第 12–14 行）逐字：
```python
TAGS = ['railway', 'name', 'name:zh', 'ref', 'operator', 'network', 'gauge', 'usage', 'service',
        'bridge', 'tunnel', 'layer', 'level', 'oneway', 'railway:preferred_direction',
        'railway:bidirectional', 'railway:track_ref', 'railway:traffic_mode', 'electrified', 'voltage']
```
`tracks` 不在這份白名單裡——連當 metadata 存都沒有，全 repo（`scripts/`＋`rail-3d/`，排除 vendor 與音樂／UI 用途的同名欄位）grep `'tracks'`／`tags.tracks` 零命中於派車管線。沒有任何程式碼依 `tracks=2` 把一條 way 展開成兩條平行 edge——**如果 OSM 原始資料把雙線路段畫成單一條 way（常見簡化畫法），此圖結構上只有一條 edge／一個佔用資源**，兩個方向的車必然共用它。

**`railway:track_ref`** — 有收集（第 14、71 行）與計數（第 59 行），但全 repo 唯一「消費」處在 `rail-3d/physical/topology.js:141`，只用來組 stopCandidates 的 metadata 欄位 `trackRefs`（供顯示／除錯），不影響 `shortestPath`／edge 篩選／方向選擇。

**`service`（siding／crossing／yard）** — 收集但無專屬 TRA 分流規則：
- `topology.js:113`：`if(!allowYard&&['yard','spur'].includes(edge.tags.service))continue;`——只排除 `yard`／`spur`，`allowYard` 預設 false（僅阿里山 `afr_sched` 呼叫時傳 true，見 `build_physical_routes.mjs:39`）。
- `siding` 不在任何排除清單中，可被一般路徑搜尋使用（THSR 對 `siding` 另有專屬規則，見下方 usage 段落，但那是 THSR-only）。
- `crossing`／`railway_crossing` 出現的是**節點**（平交道）而非 way 的 `service` 值，處理在 `topology.js:87-91`（`canTurn` 內，決定平交道只能直行、共用同一衝突資源，見 A3）。程式碼裡沒有 `service==='crossing'` 這個值的分支；grep 到的是 `service==='crossover'`（渡線，不同語意，見下）。

**`usage`** — 收集但只在 THSR 專屬腳本消費：`scripts/verify_thsr_station_tracks.mjs:12`、`scripts/rebuild_physical_cache.mjs:22` 都寫 `net.ways[wi].tags.service||net.ways[wi].tags.usage||'?'`，且限定 `e.system==='thsr_sched'`。**TRA（`tra_sched`）路徑沒有任何檔案讀 `usage` 值**——README 描述的「側線／正線」規則是 2026-09-12 專為高鐵站內股道加的，未套用到台鐵站間正線。

**`railway=construction|disused|abandoned`** — 結構性排除於 Overpass 查詢本身：第 10 行 regex 只抓 `railway~"^(rail|subway|light_rail|tram|monorail|narrow_gauge)$"`，`construction`／`disused`／`abandoned` 是不同的 `railway=*` tag 值（OSM 慣例），查詢階段就不會回傳；`build()` 內第 23 行再次以 `RAILWAYS` 白名單過濾（`{'rail','subway','light_rail','tram','monorail','narrow_gauge'}`）雙重保險。

**`railway:preferred_direction`／`railway:bidirectional`／`oneway`** — 只在 `build_physical_track_graph.py` 收集＋計數（第 57-58 行 `explicitOneway`／`preferredDirection`），從未在下游（`build_physical_routes.mjs`／`optimize_physical_dispatch.*`／`physical_candidate_conflicts.mjs`）grep 到消費。**下游唯一讀 `oneway` 的是 `topology.js:60-63`**（見 A3），但那是路徑搜尋時「能不能反向走這條 edge」的合法性檢查，不是「南下走哪股、北上走哪股」的股道分派規則（後者屬於 B 項，B 項未找到任何規則）。

### A3. 節點合併、道岔、edge／resource 定義 — `rail-3d/physical/topology.js`（真正的圖建置在這裡，`build_physical_track_graph.py` 只是抓 OSM 原始資料的前置步驟）

節點身分：`topology.js:20`——`nodes=new Map(Object.entries(data.nodes)...)`，直接用 OSM node id 當 key，**不做座標接近合併**（檔頭註解第 1 行：「節點身分與道岔決定連接，不以座標接近合併股道」）。

Edge／resource 產生（第 32-46 行），逐字節錄關鍵行：
```js
// 重複 way 的相同節點對仍共用一個佔用資源，不能冒充第二股。
const resource=[system,...[a.id,b.id].sort()].join(':');
const id=way.id+':'+(i-1),edge={id,resource,a:a.id,b:b.id,length,wayId:String(way.id),system,tags:way.tags};
```
`resource` 用排序過的 `[a.id,b.id]` 組字串——**同一對節點無論哪個方向都得到同一把 resource 鎖**（這對 C 項的衝突檢查是好事：確保兩個方向在同一 edge 上會被偵測到衝突）。但註解本身點名的是防止「重複 way」被誤當成第二股，並不是在處理「OSM 真的兩條分開的 way（實體雙線）」情境——那種情況下兩條 way 會有不同的節點鏈、各自得到不同 resource，於是變成兩條可分別指派的股道；哪一條該給哪個方向的車，取決於 B 項的路徑選擇邏輯（未找到方向規則）。

道岔（`railway=switch`）：不是獨立建模，而是在 `canTurn()`（第 77-101 行）於「轉彎合法性」判斷時用 `node.tags.railway==='switch'` 作為關鍵字之一（第 80、86 行）；`trackGroups`（第 47-57 行）把「非道岔、度數 ≤2」的連續節點串成同一組（`trackGroup`），用於停靠點分群，不是幾何合併。

平交道（`railway_crossing`／`crossing`）：`canTurn()` 第 87-91 行，逐字：
```js
if (['railway_crossing','crossing'].includes(kind)) {
  // 平面交叉不是道岔。只接行进方向最直的一支；每個穿越共用衝突資源。
  const options=node.edges.filter(e=>e.system===incoming.system&&e.resource!==incoming.resource).map(e=>({edge:e,score:cosine(vector(from,via),vector(via,e.a===via?e.b:e.a))}));
  const best=Math.max(...options.map(x=>x.score));
  return alignment>.95&&alignment>=best-1e-8;
}
```

`oneway` 方向合法性檢查（第 60-63 行，`directed()`，被 `shortestPath` 第 112 行呼叫，只影響「這條 edge 可不可以反向走」，不影響「哪個方向該走哪一股」）：
```js
function directed(edge,from) {
  const oneway=edge.tags.oneway;
  return !(oneway==='-1'&&from===edge.a || ['yes','1','true'].includes(oneway)&&from===edge.b);
}
```

### A4. 月台停車節點（stop node）決定 — `scripts/lib/infer_physical_stops.mjs`（29 行，全讀）

- 已標記的 `railway=stop` 節點：由 `topology.js:132-145` 的 `stopCandidates()` 依站名（正規化）＋（若有座標）500m／300m 距離門檻找出，並依 `trackGroup` 去重取最近者（第 142-144 行）。
- 缺 `stop_position` 的站：`infer_physical_stops.mjs` 沿既有 `known` 候選算出的站區中心軸線（第 7-8 行 `axis`），在同系統、排除 `yard/spur/crossover` 的 edge 上找「沿軸向 ≤70m、垂直軸向 ≤65m」且不與已知候選重疊的最近點（第 11-17 行），取前 `8-known.length` 個分數最低的候選插入為新的 estimated stop node（第 19-23 行），並把新節點 splice 進對應 way 的節點序列（第 27 行）。全程沒有依「方向」篩選候選——只有幾何鄰近度。

### A5. `pack_physical_network.mjs` 打包後 `network.json` 欄位

`scripts/pack_physical_network.mjs` 全文只有 7 行，逐字節錄：
```js
import fs from'node:fs';const read=p=>JSON.parse(fs.readFileSync(p)),n=read('.cache/physical-tracks/routes.json'),source=read('.cache/physical-tracks/routed-source.json');const wayIds=[...new Set(Object.values(n.edges).map(e=>e.wayId))],wayIndex=new Map(wayIds.map((id,i)=>[id,i])),byId=new Map(source.ways.map(w=>[String(w.id),w]));
const ways=wayIds.map(id=>{const w=byId.get(id);return {id,system:Object.values(n.edges).find(e=>e.wayId===id).system,tags:w.tags,nodes:w.nodes.map(String),coordinates:w.nodes.map(id=>source.nodes[id])};});
const dispatch=read('rail-3d/physical/dispatch.json'),selected=new Set(Object.values(dispatch.plans).flatMap(p=>p.pathIds));
const paths=Object.fromEntries(n.paths.flatMap((p,pathId)=>{if(!selected.has(pathId))return [];...}));
const stations=Object.fromEntries(Object.entries(n.stations).map(([k,s])=>[k,{name:s.name,system:s.system,lat:s.lat,lon:s.lon,candidates:s.candidates}]));
const result={version:1,inferredStops:n.inferredStops,source:n.source,nodeSource:n.nodeSource,assignmentBasis:'inferred',railElevationM:null,paths,ways,nodeTags:source.nodeTags};
```
**關鍵結構性事實**：`network.json` 的 `paths` **只保留 `dispatch.json` 目前實際選用（`pathIds`）的路徑**（第 3-4 行：`selected=new Set(...dispatch.plans...pathIds)`，`if(!selected.has(pathId))return []`），`ways` 則是**全部來源股道幾何**（供地圖繪製，不代表當班使用）。實測 `rail-3d/physical/network.json` 頂層欄位：`version, inferredStops(297筆), source, nodeSource, assignmentBasis:"inferred", railElevationM:null, paths(1625筆), ways(4364筆), nodeTags(10756筆)`——**沒有 `stations` 或 `edges` 頂層欄位**；`edges` 只以壓縮過的 `paths[].walk`（`[wayIndex, 起始edge索引, 方向]` 序列，見打包腳本第 4 行）內嵌，配合 `ways[].nodes`／`ways[].coordinates` 才能還原座標。`ways[].tags` 保留原始 OSM tag（含 `usage`／`service`，但不含 `tracks`——上游從未收集，見 A2）。

### A6. 觀察：崎頂–香山窗口內的來源幾何實測（非結論，僅供 B／C 對照）

用站址 bbox（崎頂 24.72291,120.87183 – 香山 24.76311,120.91388）過濾 `network.json.ways` 中 `system==='tra_sched'` 者，命中 23 條 way；其中多條 `usage:"main", name:"縱貫線"`（非 siding）。抽樣一對 `369788732`（46 節點）／`368387542`（48 節點）：
- 兩者 **zero 共用節點**（`shared nodes A/B: set()`）。
- 座標序列反向對應（A 從 `[120.913437,24.7616176]`→`[120.9287838,24.7875406]`，B 從 `[120.9288143,24.7874948]`→`[120.9134789,24.7616047]`，端點互相對應）。
- 兩線間**最短側向距離實測 3.815 公尺**——典型雙線鐵路軌距間隔量級。

這代表**至少此一窗口，OSM 來源本身已把雙線畫成兩條「不同節點鏈」的獨立 way**（不是 A2 描述的「單一 way 代表雙線」情境）。也就是說 `topology.js` 在此處會產生**兩個不同的 `resource`**（因為兩條 way 節點集合互斥），圖結構上並非只有一股可走。這把「為何仍有 281 場對向迎面」的問題，從 A（路網有沒有把雙線拆開）**部分轉移到 B／C**（路徑候選有沒有把兩股都納入、求解器選路徑時有沒有依方向把兩股分開用）——但本節不代表全台鐵雙線區間都是這個模式，也可能有其他窗口仍是單一 way（A2 的結構性缺口本身仍成立，只是這個特定窗口不受影響）。

---

## B. 派路（route）— `scripts/build_physical_routes.mjs`（57 行，全讀）

### B1. 路徑怎麼搜出來

`build_physical_routes.mjs:39-41`：
```js
const primary=graph.shortestPath({from:ca.nodeId,to:cb.nodeId,system:pair.system,maxLength,allowYard:pair.system==='afr_sched'});paths=[];
if(primary){paths.push(primary);const pivot=primary.edgeIds[Math.floor(primary.edgeIds.length/2)];
 if(pivot){const alt=graph.shortestPath({from:ca.nodeId,to:cb.nodeId,system:pair.system,maxLength:primary.lengthM*1.15+100,allowYard:pair.system==='afr_sched',blocked:new Set([graph.edges.get(pivot).resource])});if(alt)paths.push(alt);}
}
```
是 Dijkstra 最短路（`topology.js:shortestPath`，見 A3），限制條件：同系統（`system`）、`maxLength`（起訖直線距離 × 4 倍再 +1000m，阿里山×9）、預設不許進 `yard`。**每一對候選停靠點只求兩條路徑**：`primary`（全域最短）與 `alt`（把 primary 路徑中點所在的 resource 封鎖後再求一次、且長度上限放寬到 primary×1.15+100，找到才收），不是窮舉所有可能股道。若一站有多個候選停靠點（月台／到發線），會對每組 `(ca,cb)` 候選對都各跑一次，結果數量隨候選數相乘（第 37 行 `for(const ca of a.candidates)for(const cb of b.candidates)`）。

### B2. 方向與正線的關係 — grep 結果

**未找到**任何「南下走某股、北上走某股」的規則。逐一交代 grep 範圍與結果：
- 在 `build_physical_routes.mjs`／`optimize_physical_dispatch.mjs`／`optimize_physical_dispatch.py`／`scripts/lib/physical_candidate_conflicts.mjs`／`topology.js`／`reservations.js`／`route-runtime.js`／`plan-binding.js`／`client.js` 這九個檔案內 grep `南下`、`北上`、`direction`、`\bdir\b`、`upTrain`、`downTrain`、`isUp`、`isDown`、`'up'`／`"up"`、`'down'`／`"down"`、`\bleft\b`、`\bright\b`、`parallel`、`opposite` —— **全部零命中**。
- 全 repo（`scripts/*.mjs`）grep `南下`／`北上` 有大量命中，但全部落在其他子系統：捷運（`build_metro_times.mjs`）、高鐵班表建置（`build_thsr_schedule.mjs`，僅用於站序排序方向 D0/D1，不涉派軌）、台南記憶動畫（`build_tainan_memory.mjs`，是另一套獨立於實體股道派車的展示功能）、車站看板顯示分組（`verify_board_direction_groups.mjs`，管 UI 分組與配色，不碰股道指派）。**沒有一處落在台鐵實體股道的路徑候選或派車求解器裡**。
- `railway:track_ref` 唯一被讀取的地方是 `topology.js:141`（見 A2），只寫進 `stopCandidates` 回傳物件的 `trackRefs` 欄位供顯示／除錯，`build_physical_routes.mjs` 沒有讀取或使用這個欄位做路徑篩選（grep `trackRefs` 於 `build_physical_routes.mjs`：零命中，該檔只在第 26 行為「估算停靠點」寫死 `trackRefs:[]`）。

**唯一與「側」相關的邏輯，且明確聲明不是官方方向**——`build_physical_routes.mjs:44-49`，逐字節錄：
```js
for(const path of paths){const center=list=>[list.reduce((v,c)=>v+c.coordinate[0],0)/list.length,list.reduce((v,c)=>v+c.coordinate[1],0)/list.length];
 const side=(c,mid,x,y)=>{const scale=Math.cos(c[1]*Math.PI/180),dx=(y[0]-x[0])*scale,dy=y[1]-x[1],ox=(c[0]-mid[0])*scale*111320,oy=(c[1]-mid[1])*111320;return (dx*oy-dy*ox)/(Math.hypot(dx,dy)||1);};
 // 推估方向慣例而非官方行車方向：在來源股道中維持相同相對側，減少不必要的換線。
 const aSide=side(ca.coordinate,center(a.candidates),path.coordinates[0],path.coordinates[1]),bSide=side(cb.coordinate,center(b.candidates),path.coordinates.at(-2),path.coordinates.at(-1));
 const preference=(Math.max(0,-aSide)+Math.max(0,-bSide))*10+path.edgeIds.filter(id=>graph.edges.get(id).tags.service==='crossover').length*2;
```
`preference` 只是附加在每條候選路徑上的一個**分數**（越低越好），依「這條路徑端點是否落在候選群集的慣用相對側」與「用了幾段渡線（crossover）」加權——**這個分數本身在 `build_physical_routes.mjs` 裡沒有被用來剔除或排序路徑**（`preference` 只是寫進 `record` 隨路徑一起輸出，第 49 行），實際挑哪條路徑是下游 `optimize_physical_dispatch.*`（C 項）依 `result.pairs[key]`（候選路徑 id 陣列）配合求解器目標函數決定。換句話說：**B 項只產生候選集合＋一個「非官方方向」的側偏好分數，真正拍板選哪一股是 C 項的事，而 C 項的挑選邏輯裡同樣沒有方向規則（見 C2）**。

### B3. 站序方向如何進入候選集合

`pairs` 的 key 是「有向」的（`a+'>'+b`，第 16 行），資料來源是官方時刻表相鄰停靠站序（第 13-16 行：`for(let i=1;i<tr.stops.length;i++)`），所以「南下車」與「北上車」在同一對相鄰站之間，本來就會各自查到 `A>B` 與 `B>A` 兩個不同的 pair key（第 30-33 行對於未被班表覆蓋的區間點也雙向補上）。但因為 `shortestPath` 對 `A>B` 與 `B>A` 是各自獨立呼叫 Dijkstra（`topology.js:102`），**如果兩個方向的最短路收斂到同一批 edge（例如 A2 情境的單一 way，或即使有兩條 way 但其中一條在成本函數下顯著更短／唯一連通）**，兩個方向的 `pairs['A>B']` 與 `pairs['B>A']` 各自對應的路徑仍會落在同一組 `resource` 上——這件事在 B 項的程式碼裡沒有任何機制去偵測或阻止（B 項不知道「另一個方向也選了同一股」，因為兩次 `shortestPath` 呼叫互相獨立、沒有共享的「已用股道」狀態；資源層級的協調，若存在，屬於 C 項）。

### B4. 同一站兩班車的停車節點怎麼分配

`build_physical_routes.mjs:21-28`：`stopCandidates()`（`topology.js:132-145`，見 A4）先用官方站名／座標找已知 `railway=stop` 節點；若一個都沒有（`!st.candidates.length`），退回在該系統、排除 `yard/spur/crossover` 的 edge 上找 250m 內最近節點、依 `trackGroup` 去重、取最近 8 個（第 23-27 行）。**這一步只決定「候選集合」，不分配給特定班次**——實際上每班車用哪個候選、是否兩班車撞用同一節點，是 C 項（`optimize_physical_dispatch.*`）依時間窗與求解器決定，B 項本身沒有「已被別班車佔用就跳過」的邏輯。

---

## C. 求解器 — `optimize_physical_dispatch.py`（CP-SAT 模型本體，89 行全讀）＋`optimize_physical_dispatch.mjs`（外層協調，77 行全讀）＋`scripts/lib/physical_candidate_conflicts.mjs`（38 行全讀）＋`rail-3d/physical/reservations.js`（29 行全讀）

### C0. 架構總覽（先講清楚三支檔案怎麼分工，才看得懂衝突判斷落在哪）

`optimize_physical_dispatch.mjs` 是外層協調者：讀 `.cache/physical-tracks/routes.json`（B 項產出的候選路徑）與班表，組出每班車的 `pairs`（每段可選路徑 id 集合，直接來自 B 項 `result.pairs[key]`）與 `transitions`（相鄰段路徑要能實際銜接），寫成一份輸入檔，用 `spawn('python3',['scripts/optimize_physical_dispatch.py',input],...)`（第 25 行）起一個常駐子行程，用 stdin/stdout 的 JSON-lines 協定交換「新衝突約束」與「求解結果」，最多跑 200 輪（第 30 行 `for(let round=0;round<200;round++)`）直到某輪掃描不到新衝突（第 74 行 `if(!found.length){final=...break;}`），檔頭第 1 行註解逐字：「用完整車體佔用回饋約束求解器；每輪仍以獨立資源掃描驗證，不能只信 solver 回傳可行。」

`optimize_physical_dispatch.py` 是純 CP-SAT 模型，**它本身不知道「站」「股道」「衝突」是什麼**——只認得「第 ti 班車第 i 段的路徑變數 `paths[ti][i]`（定義域＝該段候選路徑 id 集合）」與「外部傳進來的 `(a,b)` 衝突 tuple」，逐一轉成析取（disjunction）或固定順序約束（見 C3）。**「這兩個路徑片段算不算衝突」的定義完全在 mjs／候選衝突產生器裡決定，不在 py 裡**。

### C1. Resource 鍵與時間窗怎麼算 — 站間 edge 有沒有被檢查（🔴 核心問題，程式碼證據）

**站間平面段（edge）明確被當成 resource 檢查，且是逐條 edge 檢查，不是只檢查站區。** 兩處產生「佔用清單」的程式碼，邏輯完全對稱：

`rail-3d/physical/reservations.js:19-21`（求解器每輪驗證時，依 CP-SAT 剛選出的 `pathIds` 算完整車體佔用）：
```js
for(let i=0;i<paths.length;i++){const p=paths[i];let d=distances[i];
 for(let j=0;j<p.edgeIds.length;j++){const e=network.edges[p.edgeIds[j]],end=d+e.length;add(e.resource,d,end,i);add(tr.system+':node:'+p.nodeIds[j],d,d,i);d=end;}
 add(tr.system+':node:'+p.nodeIds.at(-1),d,d,i);
}
```
逐一走訪路徑上**每一條 edge**（`p.edgeIds`，包含站與站之間的所有正線 edge，不只是停靠站節點），對每條 edge 呼叫 `add(e.resource, d, d+e.length, i)`——`e.resource` 就是 A3 節錄的 `topology.js:42`／`route-runtime.js:12` 那把 `[system,節點A,節點B].sort().join(':')` 鍵。另外也對每個**節點**（含道岔、停靠點）各加一筆零長度佔用（`add(tr.system+':node:'+p.nodeIds[j], d, d, i)`）。

`scripts/lib/physical_candidate_conflicts.mjs:8`（求解前「預先窮舉」所有候選路徑的佔用，讓求解器一開始就看到潛在衝突，避免每次換軌才臨時發現）——同構：
```js
for(let j=0;j<p.edgeIds.length;j++){const e=n.edges[p.edgeIds[j]];add(e.resource,d,d+e.length,j);add(p.system+':node:'+p.nodeIds[j],d,d,j);d+=e.length;}add(p.system+':node:'+p.nodeIds.at(-1),d,d,p.nodeIds.length-2);
```

`optimize_physical_dispatch.mjs:34,36`（求解器回傳一組指派後，外層**獨立**重新掃描；這是真正決定「這輪還有沒有衝突」的地方，不信任 CP-SAT 自稱可行）：
```js
for(const r of vehicleReservations(n,tr,p.pathIds,schedule)){if(!booked.has(r.resource))booked.set(r.resource,[]);booked.get(r.resource).push(r);}
...
const found=[];for(const list of booked.values()){list.sort((a,b)=>a.start-b.start);const active=[];for(const b of list){for(let i=active.length-1;i>=0;i--)if(active[i].end<=b.start+.001)active.splice(i,1);for(const a of active)if(a.train!==b.train&&!sameHandoff(a.train,b.train)&&Math.min(a.end,b.end)-Math.max(a.start,b.start)>.001)found.push({a,b});active.push(b);}}
```
這是**依 resource 分組、掃描線（sweep-line）判斷時間區間是否重疊**——`booked` 是「以 resource 為 key 的佔用清單」，站間 edge 的 resource 與站內節點的 resource 一視同仁地被丟進同一個 `Map`，一起做重疊檢查。所以**站間平面段確實是 resource、確實被檢查對向衝突**，而且對向（迎面）與同向（追撞）在這一層完全沒有區分——只要時間區間重疊、車次不同、不是同一組銜接車（`!sameHandoff`），就算衝突，不管兩車是同向還是對向。

時間窗計算：`reservations.js:6-13`（`time()` 內部函式）用**線性插值＋`segmentTime()`**（`timing.js:10-22`）換算車身某個里程點對應的時刻；`segmentTime` 優先用班表帶的跑段曲線 `st.rp`（否則第 12 行 `if(!st.rp)return (next.arrSec-st.depSec)*f;` 退回等速內插——README 已指出這在高鐵會造成 27 秒均差、p95 108 秒，台鐵是否同樣受影響本節未驗證，見風險清單）。車身長度：`half=(tr.lengthM||240)/2+3`（`reservations.js:5`，車長取自班表或預設 240m，兩端各加 3m 安全裕度），佔用區間即「車頭進入 resource 前 half 公尺」到「車尾駛離 resource 後 half 公尺」對應的時刻，並整體再加減 2 秒容差（`reservations.js:16`：`start:a.t-2,end:b.t+2`）。

**時間解析度**：不是固定 tick，是連續數值（浮點秒／十分之一秒——py 檔內 `holds` 變數用 `*10` 存整數 decisecond，見 `optimize_physical_dispatch.py:16,20,52`），不是本任務開頭提到的「4 秒重放」那種離散抽樣；4 秒重放（`STEP=4`）是**另一支獨立的瀏覽器驗收腳本** `scripts/verify_physical_no_overlap.mjs`（見 C4），不是這個求解器本身的時間解析度。

### C2. 目標函數與變數

`optimize_physical_dispatch.py:9`：`v=model.new_int_var_from_domain(cp_model.Domain.from_values(ids),f'p{ti}_{i}')`——每班車每段一個整數變數，定義域就是 B 項算出的候選路徑 id 集合（`ids=source['pairs'][pair]`，即 `build_physical_routes.mjs` 輸出、經 `optimize_physical_dispatch.mjs:13` 原樣轉交的 `n.pairs[key]`）。**候選路徑數＝B 項該站對每組 (起點候選,訖點候選) 各跑 primary＋alt 兩次 `shortestPath` 的結果總和**（B1），不是窮舉整個路網。

真正求解時用的目標函數（互動迴圈內，每輪都重設，`optimize_physical_dispatch.py:74`）：
```python
model.minimize(sum(h for row in holds for h in row)*10**6+sum(changes))
```
`changes` 是「這個變數的值是否偏離上一輪答案」的指示變數集合（第 68-73 行註解：「每輪優先保留上一輪股道，避免無關路段在等成本解之間反覆換線」）。**目標函數只優化「總延遲（hold）」與「與上一輪的變動量」，完全不含 B 項算出的 `preference`（那個『維持相同相對側』的非官方方向啟發式）**——grep `preference` 於 `optimize_physical_dispatch.py` 零命中。`preference` 唯一被讀取的地方是 `optimize_physical_dispatch.mjs:23`，用在**沒有既有 hint 時**的貪婪暖啟動猜測（逐段挑 `preference` 最小者），逐字：
```js
const cost=old.cost+(n.paths[id].preference||0)+n.paths[id].lengthM*.00001;
```
這只是給 CP-SAT 一個初始猜測值（`model.add_hint`，`optimize_physical_dispatch.py:14`），CP-SAT 可以不理它。**觀察**：這代表即使 B 項算出「維持相同相對側」的分數，只要一班車已經有歷史 hint（`output/dispatch-coord-all.json`，見下），求解器選股道時完全不看這個分數，只看「延遲最小」＋「跟上次差異最小」；`preference` 實質上只在「全新加開、從未跑過的車」第一次被排時才有影響力。

暖啟動來源：`optimize_physical_dispatch.mjs:20`：`hints=JSON.parse(fs.readFileSync('output/dispatch-coord-all.json')).plans;`——這個檔案在本工作樹不存在、也未被 git 追蹤（`git ls-files output/` 零結果），屬於執行期產物，本節無法重放驗證其內容（見風險清單）。

### C3. 求解結果怎麼寫進 `dispatch.json`

`optimize_physical_dispatch.mjs:74`：全部衝突歸零後，`final={plans:result.plans,failures:[],conflicts:0,networkSha256,profileSha256,...,handoffs:handoffs.map(...)}`，寫到 `process.env.OUT||'output/dispatch-optimized.json'`（不是直接寫 `dispatch.json`——中間還要經過 E 項提到的 `assemble_physical_dispatch.mjs` 合併多個結果檔＋`pack_physical_network.mjs` 打包才變成 `rail-3d/physical/dispatch.json`）。

- **`plans`**：`{[physicalTrainKey]: {pathIds:[...], departureHolds:[...], officialDelaySec}}`（`optimize_physical_dispatch.py:84`），key 是 `plan-binding.js:2` 定義的 `physicalTrainKey`（`system:車次:首站發車秒:末站到站秒`）。`pathIds[i]` 是第 i 段實際指派的候選路徑 id（對應 B 項某條 `shortestPath` 結果）。
- **`groups`**：本三支檔案內未出現這個欄位名——grep `groups` 於 C 項四檔零命中；README 提到的「日型分組 `groups`」是 THSR 專屬、由 `assemble_physical_dispatch.mjs` 依 `timetable-thsr-days.json` 另外附加，不在這裡產生（屬 E／既有修復腳本外的高鐵專用路徑，超出本次核對範圍，僅指出出處避免誤認）。
- **`handoffs`**：`optimize_physical_dispatch.mjs:17` 算出（僅 `afr_sched` 阿里山系統，尾站停留 >180 秒且下一班同站接續發車者），標記兩班車是「同一組人員／車體的接續關係」，`basis:'matching-timetable-turnaround'`；`vehicleReservations` 的衝突掃描會用 `sameHandoff()` 排除這種「同車體前後兩班」誤判成衝突（`optimize_physical_dispatch.mjs:36`：`!sameHandoff(a.train,b.train)`）。

### C4. 🔴 為何求解器有「站間 edge 衝突檢查」，仍可能有 281 場對向迎面——觀察，非結論

以下逐條列出程式碼與文件中彼此相關、但本節不代表已判定因果的觀察，供對照 A／B 的路網與路徑證據：

**觀察 1：TRA／林鐵路徑在部分重建流程中是「原封不動搬過去」，不會重新跑求解器。** `scripts/rebuild_physical_cache.mjs:81-98`（此檔不在 C 項清單內，但因直接影響「dispatch.json 裡的 TRA 計畫是否真的來自本節求解器」而記錄於此）逐字：
```js
const passthrough={},trains=[];
... const system=id.split(':')[0];if(system==='thsr_sched')continue;passthrough[id]=p;
...
write('output/dispatch-passthrough.json',{plans:passthrough,handoffs:dispatch.handoffs||[],conflicts:0,failures:[],source:net.source,nodeSource:net.nodeSource});
```
第 98 行的 `conflicts:0` 是**寫死的字面值**，不是重新掃描算出來的——這份檔案只在**改建 THSR 班表**的流程裡，把既有 `dispatch.json` 的**非 THSR（含 TRA `tra_sched`、林鐵 `afr_sched`）計畫原樣複製**，貼上 `conflicts:0` 標籤，讓下游 `assemble_physical_dispatch.mjs:17` 的把關（`if((d.conflicts!==0||...)&&!allowYield)throw Error('派車尚未驗證 '+file)`）能通過。這代表**至少存在一條會被實際使用的程式路徑，讓 TRA 計畫繞過本節（C）的衝突掃描迴圈、卻仍被標記為『已驗證零衝突』**。

**觀察 2：README 與修復文件都明確記載「全日台鐵派軌仍有未消除的占用交疊」，且明確選擇不重跑全域求解器。** `docs/physical-overlap-repair-0912.md` 逐字：「沒有重啟先前已量出假紅的全局 CP-SAT 佔用模型。」（該文件同段亦列出 9/12、9/14 兩個服務日、現行編組下的 A（同向）5/1、A′（對向）19/17→17/14、B（兩車同停）48/42、C（一停一跑）44/40 等**非零**殘餘互穿計數，來自 `verify_physical_no_overlap.mjs` 兩分鐘取樣、120 秒視窗。）「假紅」（false positive）字樣意味團隊過去測過這個 CP-SAT 模型與實際判準之間**存在已知落差**，但本節查無說明落差的具體成因（時間窗估計誤差／resource 定義分歧／其他），屬未確定點。

**觀察 3：`verify_physical_no_overlap.mjs`（出貨閘門用的獨立驗收器，不在 C 項四檔清單內，但檔頭註解直接回答本節問題）明確聲明它與求解器用同一把 resource 鍵**，逐字節錄該檔第 12-14 行註解：
```
//   * 「互相穿越」＝兩列車的車身佔用了**同一個 `resource`**（`system:節點A:節點B`，＝一段實體
//     股道；`route-runtime.js:12` 造的那把鍵，也是派車求解器用的同一把）。兩列車同時佔同一段
//     股道在物理上不可能，所以這條判準不需要距離門檻，也不會隨線形精度漂移。
```
且明講其驗收標準是**棘輪（不得比基線差）而非「必須為零」**：「既有 B／A′／C 仍有殘餘，棘輪只代表不得惡化，不代表零互穿。」——換句話說，**repo 自己的出貨閘門本來就不宣稱台鐵全日零互穿**，這與本任務起頭「4 秒解析度掃到 635 場」在方向上是一致的（同一個已知、被追蹤、尚未清零的狀態），差異可能只是取樣解析度（該驗收器預設 `SAMPLE=120` 秒聚合取樣、`STEP=4` 秒步進——即 verify 腳本本身也是 4 秒步進，但每 120 秒才記一次快照，語意上會漏掉短暫衝突，該檔本身註解也承認：「兩分鐘取樣會漏掉短暫衝突」）。

**本節不下因果結論**：以上三個觀察分別指向「部分 TRA 計畫可能未經求解器驗證（passthrough）」「求解器與獨立驗收器之間過去已知有落差且團隊選擇不修」「repo 自己的驗收標準本來就允許非零殘餘」——三者何者（或是否三者皆非、另有他因）造成崎頂–香山等雙線區間的 281 場對向迎面，需要對照當前 `dispatch.json` 內這些車次的 `plans[key]` 實際內容（是否真的來自 `optimize_physical_dispatch.mjs` 的輸出、還是繼承自 passthrough）才能判定，本節查核範圍未涵蓋此逐筆資料比對。

---

## D. Runtime 端 — `rail-3d/physical/plan-binding.js`（47 行全讀）、`route-runtime.js`（35 行全讀）、`client.js`（50 行全讀）

### D1. 一班車在瀏覽器裡怎麼綁到 plan

綁定鍵：`plan-binding.js:2`：`export const physicalTrainKey=tr=>[tr.sys||tr.system,tr.train,tr.stops[0].depSec,tr.stops.at(-1).arrSec].join(':');`——用**系統＋車次＋首站發車秒＋末站到站秒**四元組，不是只用車次（同車次不同日、誤點改點會產生不同 key，這樣才能分辨「今天的 1234 次」與「昨天的 1234 次」）。

`createPlanBinding(dispatch)`（`plan-binding.js:23-46`）依序嘗試四種綁定基礎（`basis`），逐一對照 D 項要求的「用車次？用日型？」：
1. **`'exact'`**（第 28 行）：`dispatch.plans[key]` 存在且 `stopSignature` 完全相同（含所有停靠站的到離站秒）。
2. **`'derived-pass-times'`**（第 29 行，見下方 D1a）：`stopSignature` 只在**明確標成不停靠**（`p.stop===false`）的中途站上有差異，且該站已收斂成到＝離站同一秒。
3. **`'retimed'`**（第 31 行）：**限定 `thsr_sched`**——同車次、同站序，只有時刻不同（當日時刻表調整），沿用原股道但時間全部用今天的。
4. **`'route-template'`**（第 33-45 行）：`dispatch.plans` 裡完全找不到這班車時，向 `TEMPLATE_SYSTEMS=['tra_sched','thsr_sched','afr_sched']` 內既有計畫「借」一段連續、有序、站名完全吻合的路徑切片（第 38-43 行逐一比對候選模板的站名子序列，用停靠型態相符優先＋來源 key 決勝，`templateEligible!==false` 限制哪些計畫不可外借——即 A5 打包提到的太麻里非電化股道 `templateEligible:false` 機制），**不繼承來源車的時間、待避或接車關係**（第 33 行註解、`borrow()` 函式第 17 行把 holds 全歸零）。

**「用日型」**：本三檔內沒有「日型」（day-type）概念的程式碼——`dispatch.plans` 是以上述四元組 key 直接查找的**單一巨型字典**，不分日型分組查找；README 提到的「六種日型聯集 214」是 THSR 專屬的班表輸入端處理（在 `assemble_physical_dispatch.mjs`／`rebuild_physical_cache.mjs`，屬 C4 觀察 1 提到但不在本節範圍的檔案），對 runtime 端的 `plan-binding.js` 而言全部攤平成同一個 `plans` 字典，靠 `physicalTrainKey` 裡的「首末站時刻」自然區分不同日子的同車次。

### D1a. `sameDerivedPasses`（`plan-binding.js:8-16`，全文）
```js
export function sameDerivedPasses(plan,tr){
 if(!noHolds(plan)||!validTimes(tr)||(tr.sys||tr.system)!=='tra_sched')return false;
 let old;try{old=JSON.parse(plan.stopSignature);}catch{return false;}
 return old.length===tr.stops.length&&old.every((s,i)=>{
  const p=tr.stops[i];if(s[0]!==stationKey(tr.sys||tr.system,p.name))return false;
  if(s[1]===p.arrSec&&s[2]===p.depSec)return true;
  return i>0&&i<old.length-1&&p.stop===false&&s[1]===s[2]&&p.arrSec===p.depSec&&Number.isFinite(p.arrSec);
 });
}
```
**限定 `tra_sched`**（第 9 行），且 `plan.holds` 必須全零（`noHolds`，第 5 行：無待避、無誤點）。這個函式**只做比對驗證，不計算新的通過時刻**——它假設呼叫端傳進來的即時 `tr.stops[i].arrSec/depSec` 已經是某處算好的「推估通過時間」，只負責判斷「這個新時刻是否僅僅是把原本非停靠站的到離站時刻收攏成同一秒」，若是則允許沿用原計畫（`basis:'derived-pass-times'`）。

**通過時刻實際在哪裡算，本節查核邊界**：`derived-pass-times`／`derivePass`／`passTime`／`backfill` 四個關鍵字在全 repo（`scripts/`、`rail-3d/physical/`、`rail-3d/integration/`、`index.html`，排除 vendor）grep 結果：`derived-pass-times` 字面值只出現在 `plan-binding.js:29`、`scripts/repair_physical_platforms.mjs:13`（註解）、`scripts/verify_tra_plan_binding.mjs:8`（測試斷言）、`rail-3d/integration/FORMATIONS.md:99`（文件）——**沒有一個「計算」函式用這幾個字命名**。往上追一層：`rail-3d/physical/motion.js:8`（`createPhysicalMotion` 內）呼叫 `bind=createPlanBinding(dispatch)`，但傳進 `bind(tr)` 的 `tr` 是**外部呼叫端**已經組好、帶著 `arrSec/depSec/rp/rpDep/rpOff/rpSegKz` 等欄位的班表物件；`motion.js:31` 只用 `s.rp`（跑段曲線，`timing.js:profileProgress`）在**兩個已知到離站時刻之間**內插目前這一刻的地理位置，**不會反過來重新推算 `arrSec/depSec` 本身**。真正把「明確不停靠站」的到離站時刻算成同一個推估值的邏輯，落在呼叫 `createPhysicalMotion`／`bind()` 之前、組出 `tr.stops[]` 物件的地方——那是 `index.html` 自己的班表建置流程（`buildProfile`／`assignRunProfiles`，README 用語，`scripts/lib/thsr_run_profiles.mjs` 是把它搬進 Node vm 沙箱重跑的版本），**不在 D 項指定的三個檔案內**，本節只確認邊界所在，未深入 index.html 內部。

### D2. `route-runtime.js`：路徑展開與 resource 鍵（runtime 版）

`edgeRecord`（第 12 行，全文）：
```js
const edgeRecord=(w,a,b)=>({wayId:String(w.id),edgeId:w.id+':'+Math.min(a,b),a:sourcePath(w).d[a],b:sourcePath(w).d[b],resource:[w.system,...[w.nodes[a],w.nodes[b]].sort()].join(':')});
```
與 `topology.js:42`（建置期）逐字同構（`[system,節點A,節點B 排序].join(':')`），確認**建置期圖、求解器驗證、瀏覽器 runtime、獨立驗收器 `verify_physical_no_overlap.mjs` 四處共用同一把 resource 鍵公式**，不存在「定義分歧」這個解釋（C4 已引用 `verify_physical_no_overlap.mjs` 註解佐證同一結論）。

`unfold(id)`（第 13-16 行）把 `pack.paths[id].walk`（打包時壓縮的 `[wayIndex,起始索引,方向]` 序列，見 A5）展開回完整 `coordinates/edges/nodeIds`，並用 LRU（`paths.size>512` 就丟最舊的，第 15 行）快取；`route()`（第 26-32 行）把多段 `pathIds` 串成一條可繪製、可查詢高度的路徑物件，`extension()`（第 18-25 行）處理車頭車尾伸出已指派路徑之外時（例如車身比單一 leg 還長）沿路網幾何延伸，一樣呼叫 `g.canTurn()`（A3）保證延伸方向合法。這一層**不做任何衝突檢查**，純粹是幾何展開＋繪製，衝突判斷已經在 C 項的求解／驗收階段完成。

### D3. `client.js`：哪些系統走實體股道

`PHYSICAL_SYSTEMS=['tra_sched','thsr_sched','afr_sched']`（第 23 行）是**唯一**判斷「這條線要不要換成實體股道」的白名單來源（第 41-42 行註解：「systems 是這份白名單的唯一出處」），台鐵、高鐵、阿里山林鐵三者才有股道級動畫，捷運（`mrt`／`krtc`／`tmrt`／`tymc`／`ntdlrt`／`ntalrt`）另有獨立的 `metro-motion.js`／`metro-network.json` 路徑（`client.js:28` 分開建構 `metro` 物件），不共用本次調查的派車求解器。`covered(tr)=PHYSICAL_SYSTEMS.includes(tr.sys||tr.system)`（第 40 行）決定 `sample()`／`has()` 是否回傳實體股道結果，否則呼叫端（`index.html`）會退回既有示意線形（`posAlongShape`，第 38 行註解）。

---

## E. 既有修復腳本

### E1. `scripts/repair_physical_platforms.mjs`（144 行，讀了前 40 行含完整檔頭說明；下略實作細節）

**改什麼**：換「兩班車同時停在同一個停車節點」那一族的**停車節點**（月台／到發線），連帶改該站的進出兩段路徑（第 10 行：「只做一件事:換停車節點,同時改該站的進出兩段路徑」）。

**不改什麼**：不新增股道（第 11 行）、不動 `network.json`（第 12 行，故不必重跑 `build_rail_levels`）、不加任何 hold（第 13 行）、**不處理站間（inter-station）正線 edge 上的交會或追撞**——它的判準明講是「兩班車的停站時窗在同一個節點上相交」（第 7-8 行），完全是**站內節點**尺度，範圍不含 A/A′/C 三類（同向、對向、一停一跑，都發生在站間 edge），只處理 B 類（兩車同停同一節點）。

**🔴 為什麼不重跑求解器——檔頭第 3-8 行逐字節錄，直接回答本次調查的核心疑問**：
```
// 為什麼不是重跑 optimize_physical_dispatch：
//   CP-SAT 全解在 2026-09-12 連續四種預算(30/60/120/240/900 秒)都回 UNKNOWN,加了 FOCUS
//   把非衝突車釘在現況也一樣。而且它的目標函數是「佔用預約無重疊」,那個模型我做不出可信的
//   正向對照 —— 拿高鐵(出貨閘門宣稱零重疊、當天才剛修好)重算,同一日型內照樣量到 811~1296 筆,
//   代表我重建不出求解器當初的輸入。所以這支**不用佔用模型**,只用停站時刻的區間重疊:
//   兩班車的停站時窗在同一個節點上相交 —— 這件事跟行車曲線、跟車長都無關,不會漂。
```
**觀察**：這段是 2026-09-12 撰寫者親自嘗試重跑 C 項求解器（`optimize_physical_dispatch.py`／`.mjs`）失敗的第一手記錄——四種時間預算（含 900 秒）皆回 `UNKNOWN`（CP-SAT 既未證明可行也未證明不可行，見 C1 對 `status not in [OPTIMAL,FEASIBLE]` 分支），且撰寫者另外嘗試用同一套「佔用預約」模型（`vehicleReservations`）去重算**已宣稱零重疊**的高鐵資料做正向對照，量到 811~1296 筆（非零），因而判定「我重建不出求解器當初的輸入」。這與 C4 三個觀察合起來看：C 項的 CP-SAT＋資源掃描架構在程式碼層面確實會檢查站間 edge（C1），但至少在 2026-09-12 這個時間點，**這整套機制對台鐵全日規模的問題無法在合理時間內收斂求解**，此後的修復都改用範圍更窄、不依賴 CP-SAT 佔用模型的專用腳本（本節 E1／E2／E3）。

**實測成效**（第 17-20 行）：14 天同月台同時佔用合計 1626→449 筆（去重 229→49 對），動 94 班、新落成 25 份計畫；出貨閘門 B 類 188→51 筆。**明講剩餘修不掉的三種原因**：該站拓樸只有一個停車節點（例：太麻里）、換過去沒有可接的進出路徑、換了反而更糟——並明講「要再往下清得補拓樸或重解，不是這支的範圍」（第 20 行）。

### E2. `scripts/repair_remaining_station_routes.mjs`（8 行，全讀）

**改什麼**：把 `scripts/fixtures/remaining-routes-0913.json`（見 E4）裡預先算好、已通過驗證的候選路徑（`newPaths`）與計畫變更（`afterPlans`）套用到 `network.json`／`dispatch.json`，寫到 `output/remaining-station-routes/` 目錄（第 8 行，**不直接覆蓋產品檔**，檔頭第 1 行註解：「只寫候選目錄，不自動部署」）。

**不改什麼**：不重新計算任何東西——純粹是「重放」（replay）已經算好並經多車雙引擎驗收的結果（第 1 行：「重放已通過多車與雙引擎驗收的局部進路」）。有兩層防呆：第 5 行用 `waysSha256` 比對確保來源股道沒變過（變了就 assert 失敗，第 2 行註解：「原始 ways 必須未變；來源更新後須重新查核，不能把舊節點序號套進新路網」）；第 7 行用 `beforePlans` 逐班比對「這班車在套用前是否仍是 fixture 記錄的原狀」，不符就 assert 失敗（避免疊掉別人同時做的修改）。

### E3. `scripts/lib/restore_physical_routes.mjs`（21 行，全讀）

**改什麼**：不改任何檔案——這是一個**唯讀還原函式**，從已出貨的 `network.json`（只含壓縮過的 `paths[].walk`）反推回派車管線需要的完整拓樸（`nodeIds`／`edgeIds`／`edges[].resource`），供 `rebuild_physical_cache.mjs`（OSM 快照不在磁碟時）與 `verify_thsr_reservation_motion.mjs`（在出貨樹上重算佔用）呼叫（檔頭註解第 2-4 行）、以及本節 E1 的 `repair_physical_platforms.mjs`（第 27 行 `import {restorePhysicalRoutes}`）用來取得 `paths`。第 14 行會逐邊核對「舊路徑的每一條 edge 是否還在拓樸裡」，第 15 行核對端點是否吻合，任一不符就 `throw Error`——這是防止「網路拓樸變了但派車計畫沒跟著改」的完整性檢查，不做任何修復或改寫。

### E4. `scripts/fixtures/remaining-routes-0913.json` 結構（實測，python json.load 取頂層 keys 與型別）

```
version: 1
basis: "2026-09-13：既有來源股道、既有派車表曾使用的停車點；局部多車初篩後，三個服務日真瀏覽器全日複驗。不是官方當班月台。"
waysSha256: <sha256 hex>
changes: list, 82 筆。每筆例：{key, train, pair, station, kind:'station-track', fromNode, toNode, oldPaths:[...], newPaths:[...], from, to, others, samples, gain, date, timeSec, holds}
protectedTemplates: list, 4 筆（例："tra_sched:6841:32280:45360"，避免被其他加開車借走的模板計畫 key）
beforePlans: dict, 79 筆，key＝`physicalTrainKey`，value＝完整 plan 物件（pathIds／departureHolds／officialDelaySec／holds／stopSignature／lengthM）
afterPlans: dict, 79 筆，同構，套用修復後的版本
newPaths: dict, 156 筆，key＝路徑 id 字串，value＝完整路徑物件（from／to／fromGroup／toGroup／system／lengthM／preference／walk）
```
**觀察**（非本節要求但直接相關）：抽樣的 `changes[0]` 是車次 281 在「北新竹」的 `station-track` 調動；同一筆 `beforePlans`／`afterPlans` 的 `stopSignature` 顯示這班車的路線完整經過「香山」「崎頂」（本次調查的具名雙線區間），但 `changes` 的 82 筆全部標記 `kind:'station-track'`——與 E1 的檔頭聲明一致：**這份 fixture 只記錄站內節點調動，不包含任何站間 edge 的重新指派**，崎頂—香山之間若有對向共用同一 resource 的情況，不在這批已修復的 82 筆之內。

---

## F. 補充：`rail-3d/physical/dispatch.json` 實測頂層欄位

```
version: 2
assignmentBasis: "inferred"
conflictPolicy: "scheduled-hold"   ← 本次讀的 C／D 六個檔案內都沒有產生或消費這個欄位的程式碼，
                                      推測是 assemble_physical_dispatch.mjs 附加的標籤，未追查（超出指定檔案範圍）。
plans: dict，1214 筆（其中 tra_sched 開頭 948 筆）
handoffs: list，1 筆
source: dict，6 筆
coverage: dict，2 筆
thsrProfileSha256: <sha256 hex>
groups: list，6 筆   ← 證實 C3 的判斷：C 項四個檔案不產生 groups，但確實存在於最終 dispatch.json，
                        來自組裝階段（assemble_physical_dispatch.mjs，不在本次指定範圍）。
```
`plans[key]` 逐筆欄位：`pathIds, departureHolds, officialDelaySec, holds, stopSignature, lengthM`——**沒有任何「這筆計畫是求解器算出來、passthrough 帶過來、還是 repair 腳本改過」的來源標記**。這代表無法只看 `dispatch.json` 本身分辨崎頂—香山那幾班車的 `pathIds` 是否曾經過 C 項 CP-SAT 迴圈驗證，只能得知它與 `network.json` 的 `paths` 一致（結構上可解出座標）。

## 風險與未確定點

1. **`.cache/physical-tracks/` 整個目錄在本工作樹不存在**（README／各腳本描述的中繼檔：`network-with-stations.json`、`routes.json`、`routed-source.json`、`timetable.json`）。B／C 項的分析建立在讀原始碼＋讀最終 `network.json`／`dispatch.json` 交叉推論，**沒有實際重跑 `build_physical_routes.mjs` 或 `optimize_physical_dispatch.mjs` 驗證這些檔案現在真正的內容**。
2. **`output/dispatch-coord-all.json`（求解器暖啟動用的歷史 hints）不存在也未被 git 追蹤**，C2 對「`preference` 實際上多常真正影響選股」的推論只到「程式碼結構上如此」，未能實測目前系統裡有 hint 的班次比例。
3. **無法從 `dispatch.json` 本身判斷崎頂—香山（或任何特定雙線區間）目前的 TRA 計畫，是否來自 C 項 CP-SAT 完整求解、`rebuild_physical_cache.mjs` 的 passthrough（`conflicts:0` 寫死）、還是 `repair_physical_platforms.mjs`／`repair_remaining_station_routes.mjs` 局部修過**——三條路徑在程式碼上都存在且都可能是目前資料的來源，`dispatch.json` 沒有留下可分辨的欄位（F 項已確認）。這是本次調查「A／B／C 何者是 281 場對向迎面的近因」最大的未確定點，需要額外去比對某班具體車次的 `pathIds` 與 `output/` 下（若存在）各中繼檔的差異才能判定，本次未做。
4. **A6 的「崎頂–香山 OSM 已是兩條分開的 way」只是單一窗口的抽樣**，不能推論全台雙線區間皆如此；A2 指出的「`tracks=2` 從未展開」是結構性事實（程式碼層級成立），但對任一特定路段是否真的受影響，要看該路段的 OSM 原始資料實際怎麼畫（一條 way 還是兩條）。
5. **`segmentTime()`（`timing.js:12`）在缺 `st.rp` 時的等速內插誤差**，README 只量化了 THSR 的影響（p95 108 秒），本次未查證 TRA 班表目前是否普遍有 `rp` 曲線（即該誤差是否也適用於台鐵，進而影響 C1 時間窗精準度）。
6. **`physical_candidate_conflicts.mjs` 的 `orderSameDirection` 旗標**（預設 `false`，由環境變數 `ORDER_SAME_DIRECTION` 控制）本次只讀了程式碼定義，未追查目前實際執行 `optimize_physical_dispatch.mjs` 的呼叫方（例如 `package.json` scripts 或 CI）是否有開啟它——若從未開啟，代表「同向」與「對向」衝突在求解器眼裡從建立候選衝突那一刻起就沒有被區分過，這對解讀 C4 的觀察會有影響，但本節未確認。
7. **`derived-pass-times` 實際計算通過時刻的程式碼落在 `index.html`（或其呼叫的 `scripts/lib/thsr_run_profiles.mjs` 同類的台鐵版本）**，不在 D 項指定的三個檔案內，本節只確認了邊界（`motion.js:8,31` 是消費端），未深入該計算本身是否也有方向相關邏輯。
8. **`assemble_physical_dispatch.mjs`、`build_rail_levels.mjs`、`verify_physical_no_overlap.mjs` 的完整實作**都只在本次調查中被引用/抽樣（因為它們的註解或行為直接回答了 C／E 的問題），沒有像 A–E 指定檔案那樣逐行核對，其餘部分可能還有本地圖未捕捉到的邏輯。
