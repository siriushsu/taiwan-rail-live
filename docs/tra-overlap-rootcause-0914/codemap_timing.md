# 軌島台鐵列車速度／時間模型 程式地圖

工作樹：/private/tmp/railisland-overlap-repair-0912（已核對：HEAD = origin/main = 86663b05，git status 乾淨）
所有路徑相對此工作樹根目錄。本檔邊查邊寫。

---

## A. 位置怎麼算出來的（台鐵、physical 模式）

### A-1 呼叫鏈總覽

- `trainPos(tr, t)` — **index.html:10665**
  ```js
  function trainPos(tr, t) { return trainPosAt(tr, t - liveDelaySec(tr) - blockHoldSec(tr)); }
  ```
  （`trainPosAt` 在 index.html:10664 上一行開始定義，見下方 A-6；本身會再扣掉即時誤點秒數與 block hold 秒數才丟給 `trainPosAt`。）

- `trainPosAt` 對台鐵 physical 車種會呼叫 physical 模組的 `sample()`（見 A-6 找到的呼叫細節）。physical 模組本身：
  - `rail-3d/physical/motion.js` 的 `createPhysicalMotion(pack,profiles,dispatch,...)` 回傳 `{sample,record,geometry,has}`（motion.js:7, 38）。
  - `record(tr)`：motion.js:9-15。
  - `sample(tr,clockSec,{officialDelaySec,wrap})`：motion.js:16-37。
  - `sample()` 內部呼叫 `rail-3d/physical/timing.js` 的 `profileProgress(p,t)`（timing.js:4-8）與（間接）`turnbackProgress`（timing.js:25-29，只在 `afr_sched` 系統時觸發，見 motion.js:34）。

### A-2 record()：schedule 怎麼建、欄位有哪些

檔案：rail-3d/physical/motion.js:9-15
```js
function record(tr){if(cache.has(tr))return cache.get(tr);const binding=requireSignature?bind(tr):{plan:dispatch.plans[physicalTrainKey(tr)],basis:'unchecked'},plan=binding?.plan;
 if(!plan||plan.pathIds.length!==tr.stops.length-1){cache.set(tr,null);return null;}
 const holds=plan.holds||plan.departureHolds.map((departure,i)=>({arrival:plan.departureHolds[Math.max(0,i-1)],departure}));
 const schedule=tr.stops.map((s,i)=>({arrSec:s.arrSec+holds[i].arrival,depSec:s.depSec+holds[i].departure}));
 const reversals=[];for(let i=1;i<plan.pathIds.length;i++){const a=geometry.unfold(plan.pathIds[i-1]),b=geometry.unfold(plan.pathIds[i]);if(isScheduledTurnback(tr.sys||tr.system,tr.stops[i].name,a,b))reversals.push(i);}
 const value={plan,bindingBasis:binding.basis,sourceKey:binding.sourceKey,holds,schedule,maxHold:Math.max(...holds.map(h=>h.departure)),reversals,initialFacing:afrInitialFacing(tr)??1};cache.set(tr,value);return value;
}
```

**schedule 陣列的每個 entry 只有兩個欄位：`{arrSec, depSec}`**——直接等於 `tr.stops[i].arrSec/depSec` 再加上該站的 hold 秒數（`holds[i].arrival`／`holds[i].departure`，來自 plan-binding 的 `plan.holds` 或退回 `plan.departureHolds` 位移一格湊出的 arrival）。**沒有獨立的 pass／dwell 欄位**——是否為通過站、是否在停留，是 `sample()` 執行當下才動態判斷（見 A-3），不是 schedule 本身的靜態欄位。真正標記「這一站是不是通過站」的旗標在**來源物件 `tr.stops[i].stop`**（`stop===false`），而 `record()` 建出的 `schedule` 只留 `arrSec/depSec`，沒有把 `.stop` 複製過來——`sample()` 判斷 dwell 靠的是「解出來的 arrSec 是否等於 depSec」這個間接效果（見 A-3），不是直接讀 `.stop`。

`cache` 是 `WeakMap`（motion.js:8），以 `tr` 物件為 key，所以同一班車物件重複呼叫 `record()`/`sample()` 不會重算 binding／schedule，除非 `tr` 物件本身被換掉。

### A-3 sample()：從時刻 t 算位置的完整公式

檔案：rail-3d/physical/motion.js:16-37
```js
function sample(tr,clockSec,{officialDelaySec=0,wrap=(s,t,grace)=>t<s[0].arrSec&&t+86400<=s.at(-1).depSec+grace?t+86400:t}={}){
 const r=record(tr);if(!r)return undefined;const t=wrap(tr.stops,clockSec-officialDelaySec,r.maxHold),schedule=r.schedule;
 if(t<schedule[0].arrSec||t>schedule.at(-1).depSec)return null;
 if(r.bindingBasis!=='route-template'&&dispatch.handoffs?.some(h=>h.from===physicalTrainKey(tr))&&t>=schedule.at(-1).arrSec)return null;
 let lo=0,hi=schedule.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(schedule[m].arrSec<=t)lo=m;else hi=m;}
 const i=t>=schedule[hi].arrSec?hi:lo,s=tr.stops[i],dwell=t<=schedule[i].depSec;
 const segment=Math.min(i,r.plan.pathIds.length-1),legStart=r.reversals.filter(k=>k<=segment).at(-1)||0,legEnd=r.reversals.find(k=>k>segment)||r.plan.pathIds.length;
 const from=Math.max(legStart,segment-1),to=Math.min(legEnd,segment+2);
 if(!r.activeRoute||r.routeFrom!==from||r.routeTo!==to){r.activeRoute=geometry.route(r.plan.pathIds.slice(from,to),tr.sys||tr.system,tr.color||'#547466',{prefixM:from===legStart?250:0,suffixM:to===legEnd?250:0});r.routeFrom=from;r.routeTo=to;}
 const route=r.activeRoute,formationFacing=r.initialFacing*(r.reversals.filter(k=>k<=segment).length%2?-1:1);
 let f=0,rawTime;
 if(dwell)rawTime=Math.min(s.depSec,s.arrSec+Math.max(0,t-schedule[i].arrSec));
 else{const elapsed=t-schedule[i].depSec,span=tr.stops[i+1].arrSec-s.depSec;rawTime=s.depSec+elapsed;
  if(s.rp){const runTime=(s.depSec-s.rpDep)+elapsed,distance=profileProgress(s.rp,runTime)*s.rp.L,length=s.rpSegKm*1000;f=length>0?Math.max(0,Math.min(1,(distance-s.rpOff)/length)):0;}
  else f=span>0?Math.max(0,Math.min(1,elapsed/span)):0;
 }
 if(!dwell&&(tr.sys||tr.system)==='afr_sched')f=turnbackProgress(f,s,tr.stops[i+1]);
 const chainageM=route.offsets[i-from]+(dwell?0:(route.offsets[i+1-from]-route.offsets[i-from])*f),point=route.path.at(Math.max(0,Math.min(route.path.length,chainageM)));
 return {lat:point.coordinate[1],lon:point.coordinate[0],physical:true,route,chainageM,railDirection:1,formationFacing,segmentIndex:segment,stopIndex:i,dwell,f,rawTime,estimatedHoldSec:Math.max(0,t-rawTime)};
}
```

**時間軸**：`clockSec` 由呼叫端傳入（見 A-6），內部先減 `officialDelaySec`（官方即時誤點秒數，預設 0，由呼叫端決定要不要傳）；`wrap()` 只處理跨午夜繞圈（t 小於首站到站時刻且加一天仍在末站離站時刻+maxHold 內，就整段 +86400）。**沒有再疊加任何「模擬時鐘 vs 真實時鐘」轉換**——t 就是呼叫端給的秒數扣掉誤點。Hold 已經在 `record()` 建 schedule 時疊進 `arrSec/depSec`（見 A-2），所以這裡的 `schedule[i].arrSec/depSec` 已含 hold。

**位置公式（重點，逐字）**：
1. 二分搜尋出目前所在站序 `i`（依 `schedule[m].arrSec<=t`）。
2. `dwell = t<=schedule[i].depSec` → 還沒開出這一站。
3. 若 `dwell`：位置固定在站上（`chainageM=route.offsets[i-from]`，公式裡 `f` 恆為 0，`dwell?0:...`那段不加）。
4. 若不 dwell（跑段中）：
   - **有 `s.rp`（跑段速度曲線，見 B 節）**：
     - `runTime = (s.depSec - s.rpDep) + elapsed` —— 換算成「跑段（run，可能含好幾個通過站）起點以來的秒數」。
     - `distance = profileProgress(s.rp, runTime) * s.rp.L` —— 用 timing.js 的 `profileProgress` 算出「這個時間點跑了整條跑段曲線的幾成」，再乘上曲線自身的總長 `s.rp.L`（曲線的 `L` 是**建曲線當下的 `runKm*1000`**，即整個 run 的**時刻表／貼軌里程**，見 B 節）。
     - `length = s.rpSegKm * 1000` —— **這一小段（單一站間，i→i+1）**的時刻表／貼軌公里數（同樣來自 B 節的 `schedSegKmOf`）。
     - `f = (distance - s.rpOff) / length`，夾在 0..1。
   - **沒有 `s.rp`**：退化成等速：`f = elapsed / span`，`span = tr.stops[i+1].arrSec - s.depSec`（純時刻表時間比例，不涉及任何里程）。
5. `afr_sched` 系統另外把 `f` 丟進 `turnbackProgress`（timing.js:25-29）做分道漸停/漸開的頭尾平滑，其餘系統不動 `f`。
6. **`chainageM = route.offsets[i-from] + (route.offsets[i+1-from]-route.offsets[i-from]) * f`** —— 把上面算出的 `f`（0..1，來源是時刻表／貼軌里程 `s.rpSegKm`／`s.rp.L`）**直接**乘上 `route.offsets` 的差值。`route.offsets` 是 physical 路線的實際股道弦長（見 A-4），跟 `s.rpSegKm`／`s.rp.L` **不是同一個資料源**——這裡沒有任何換算或校正，隱含假設「時刻表里程走了幾成＝實體股道弦長走了幾成」。

### A-4 「曲線距離」用的長度 vs physical route 的實際長度 — 是否同源

**結論（先講重點）：不同源。`f` 由時刻表／2D 貼軌 shape 的里程算出，但拿去乘的是 3D physical route 的獨立弦長，兩者在整條路徑上沒有互相校準，換算點就是 motion.js:35 那一行乘法本身（沒有做任何單位換算，只是把 0..1 的比例原封不動套用）。**

證據鏈（file:line + 逐字）：

**(a) `s.rp`／`s.rpSegKm`／`s.rpOff` 的來源＝時刻表＋2D 貼軌 shape 里程，不是 physical pack。**

- `schedSegKmOf`（index.html:10488）：
  ```js
  function schedSegKmOf(s, i) { return s[i].segLn ? schedSegmentKm(s[i]) : haversineKm(s[i], s[i + 1]); }
  ```
- `schedSegmentKm`（index.html:10873-10875）：
  ```js
  function schedSegmentKm(seg) {
    return Math.abs(seg.dB - seg.dA) + (seg.bridgeKm || 0);
  }
  ```
  `seg.dA`/`seg.dB` 是「這一站間貼在哪條 2D shape（`seg.segLn`）上、沿該 shape 的弧長距離」，由 `assignSchedShapePathsFor`（index.html:10936-11004）在**排班/貼軌階段**算好塞進 `tr.stops[i].segLn/dA/dB`（貼軌本身：index.html:10963-10974，`best = {ln:a.ln, dA:a.d, dB:b.d}` 取「同一條 line.shape 上、A/B 兩站里程差最小」的那條）。`haversineKm`（index.html:7655）是貼不到 shape 時的直線大圓距離退路。
- `assignRunProfiles`（index.html:10499-10600）用 `schedSegKmOf` 把整個 run 的每一小段公里數存進 `segKm[]`、累加成 `runKm`，再：
  - `buildProfile(runKm, runT, ...)` / `buildObsProfile(runKm, runT, ...)`（index.html:10298, 10341）用 `Lkm=runKm` 建曲線，曲線的 `L = Lkm*1000`（index.html:10299 `const L = Lkm * 1000`；10342 同）——**這就是 `s.rp.L`**。
  - 逐段指派（index.html:10586）：`s[i].rp = rp; s[i].rpDep = runDep; s[i].rpOff = cum * 1000; s[i].rpSegKm = segKm[i - k0];` —— **`rpSegKm` 直接等於 `schedSegKmOf` 算出的那一段公里數**，和 physical pack 完全無關。

**(b) `route.offsets` 的來源＝獨立的 physical 股道網（`pack.ways`/`pack.paths`），走的是另一套資料。**

- `createRouteRuntime(pack,profiles)`（rail-3d/physical/route-runtime.js:5）：`pack.ways`/`pack.paths` 是外部傳入的實體股道網資料包（OSM way 幾何＋節點拓樸，非時刻表／2D shape）。
- `unfold(id)`（route-runtime.js:13-16）沿 `pack.paths[id].walk` 走訪 `ways[wi].coordinates`，用 `makePath(coordinates)` 算出真實座標路徑長 `path.length`。
- `route(ids,...)`（route-runtime.js:26-31）：
  ```js
  function route(ids,system,color,{prefixM=0,suffixM=0}={}){const key=ids.join(',')+':'+prefixM+':'+suffixM,cached=routes.get(key);if(cached)return cached;const coordinates=[],edges=[],offsets=[0],nodeIds=[];
   for(const id of ids){const p=unfold(id);if(nodeIds.length&&nodeIds.at(-1)!==p.nodeIds[0])throw Error('車站股道不連續');coordinates.push(...p.coordinates.slice(coordinates.length?1:0));nodeIds.push(...p.nodeIds.slice(nodeIds.length?1:0));edges.push(...p.edges);offsets.push(offsets.at(-1)+p.path.length);}
   ...
  }
  ```
  `offsets` 是逐段累加 `p.path.length`（每個 pathId 展開後的**實體座標弦長**，來自 `makePath(coordinates)` 對 `pack.ways[].coordinates` 算出的幾何長度）——與 (a) 的 `rpSegKm`/`s.rp.L` 沒有任何函式呼叫上的交集，兩套長度各自獨立計算、互不校準。

**(c) 換算發生的唯一位置＝motion.js:35，且沒有做換算：**
```js
const chainageM=route.offsets[i-from]+(dwell?0:(route.offsets[i+1-from]-route.offsets[i-from])*f)
```
`f`（0..1，來自 (a) 的時刻表里程比例）被直接乘上 `(route.offsets[i+1-from]-route.offsets[i-from])`（(b) 的 physical 弦長差）。如果 (a) 算出的「這一段時刻表/貼軌里程」與 (b) 「這一段 physical 股道實際弦長」數值不同，則同一個 `f`（例如 0.5＝時刻表跑了一半的時間對應的里程比例）會被放到 physical 路線上不同的實際位置——早到或晚到交會點的落差就會發生在這裡。

**觀察（非結論，只標記線索）**：index.html:10871-10872 的註解「跨線直通車的兩條來源 shape 在共站可能落於不同股道（八堵／成功／彰化實測約20m）」與 motion.js:24-25 的註解「全台活躍車超過共用 LRU 容量時，仍由這班車持有當前的三段線形」都在描述**同一份 2D shape 系統内部**的接續誤差；沒有任何註解提到 (a)(時刻表/貼軌里程) 與 (b)(physical 股道弦長) 這兩套長度之間的關係，兩邊的注釋各自完整、互不引用對方——這是「兩套系統各自被當成唯一真相」的訊號，不是「明知不同源、已經處理」的訊號。

### A-5 trainPos/trainPosAt 怎麼在 physical 與 legacy 2D 之間切換

檔案：index.html:10664-10666（`trainPosAt` 開頭）：
```js
// 純表定軸位置:不扣即時誤點、不含阻擋回撥。整趟速度曲線與阻擋自己的速度探針走這裡。
function trainPosAt(tr, t) {
  const physical=window.railIslandPhysical?.sample(tr,t,{wrap:schedWrapT});if(physical!==undefined)return physical;
  const g = trainSeg(tr, t);
  ...
```
**優先序：先問 `window.railIslandPhysical.sample(tr,t,...)`（rail-3d/physical/motion.js 的 sample，見 A-3），只有它回傳 `undefined`（該車系統不在 `PHYSICAL_SYSTEMS` 名單，或 `record()` 綁不到 plan）才退回舊的 2D `trainSeg`（index.html:10632-10661，用 `segLn/dA/dB` 貼軌系統）。** `window.railIslandPhysical` 由 `rail-3d.js:13` 非同步賦值：
```js
if(params.get('tracks')!=='legacy')import('./rail-3d/physical/client.js').then(m=>m.loadPhysicalMotion()).then(m=>{window.railIslandPhysical=m;glTracks.sig='';}).catch(e=>console.error('實體股道',e));
```
即網址帶 `?tracks=legacy` 會整個跳過 physical 模組載入，永遠退回 2D `trainSeg`。`loadPhysicalMotion()`（rail-3d/physical/client.js:24-49）非同步 fetch 六份 JSON（`network.json`／`display-profiles.json`／`dispatch.json`／`metro-network.json`／`metro-display-profiles.json`／`level-profiles.json`，皆在 `rail-3d/physical/` 下）後才 resolve，`sample`/`has` 只對 `PHYSICAL_SYSTEMS=['tra_sched','thsr_sched','afr_sched']`（client.js:23）生效（client.js:48-49：`sample:(tr,...rest)=>covered(tr)?motion.sample(tr,...rest):undefined`）。

### A-6 formationPoses 怎麼從頭部位置往回延伸（銜接 D 節）

`rail-3d/integration/map3d.js:245` 的 `routeProfile(v)` 會把 `v.chainageM`（來自 sample() 的頭部里程）當 `hint` 丟給 `path.locate([v.longitude,v.latitude], hint)`（train-path.js:11-29，幾何最近點投影，`hint` 只用來縮小搜尋窗），把投影結果 `nearest.s` 存回 `motion.set(v.id,{path,s:nearest.s,direction,...})`（map3d.js:247）。對 physical 車而言，這個投影點理論上會落回幾乎同一個 `chainageM`（因為 `(lon,lat)` 本來就是拿同一個 `path` 在該 `chainageM` 算出來的），但**實際餵給 `formationPoses` 的 `s` 是這個重新投影過的值，不是直接傳遞 `chainageM` 本身**——這是另一層獨立的幾何重算，不是單純傳值。

---

## B. 速度曲線怎麼建的（index.html）

### B-1 三個函式總覽

| 函式 | 位置 | 簽名 |
|---|---|---|
| `buildProfile` | index.html:10298 | `function buildProfile(Lkm, T, aK, bK, vK, coast)` |
| `buildObsProfile` | index.html:10341 | `function buildObsProfile(Lkm, T, pts, vTopK, zones)` |
| `assignRunProfiles` | index.html:10499 | `function assignRunProfiles(s, perf, obs, zoneCls, pre)` |

呼叫方向：`assignRunProfiles` 是唯一入口（呼叫點 index.html:11001，見 A-4(a) 已附上下文），對每個「run」（相鄰兩個真停靠站之間，中間可能夾通過站）挑一種曲線：優先序 **預算剖面（pre，離線算好）→ 實測剖面 `buildObsProfile` → 梯形 `buildProfile`（含較硬煞車/加速的重試退路）**。

### B-2 buildProfile（梯形／四相位剖面）

檔案：index.html:10298-10331，簽名 `buildProfile(Lkm, T, aK, bK, vK, coast)`：
- 輸入：`Lkm`＝整個 run 的公里數（時刻表/貼軌里程,見 A-4）、`T`＝run 總秒數（`arrSec[終]-depSec[起]`）、`aK/bK`＝加速/煞車 km/h/s、`vK`＝車種極速 km/h、`coast`＝可選的惰行參數 `{c, rho}`（目前只有高鐵掛，index.html:10289 註解）。
- 輸出（`prof` 物件欄位，index.html:10315）：`{T, L, a, b, c, vc, vb, tAcc, tCru, tCoast, tDec, dAcc, dCru, dCoast, dDec}`，其中 `L = Lkm*1000`（公尺）、`vc`＝巡航速度(m/s)、`tAcc/tCru/tCoast/tDec`＝各相位秒數、`dAcc/dCru/dCoast/dDec`＝各相位公尺數。
- 解不出（`disc<0` 或 `vc>vmax` 或 `tCru<0`）就回 `null`，由呼叫端（`assignRunProfiles`）退回等速（`f=elapsed/span`，A-3 步驟4 的 else 分支）。

### B-3 buildObsProfile（實測剖面，僅台鐵、僅有通過站實測折點時）

檔案：index.html:10341-10434，簽名 `buildObsProfile(Lkm, T, pts, vTopK, zones)`：
- `pts`：`[{t:段內秒, d:距跑段起點公尺}]`，來自 `data/tra_pass_obs.json`（註解 index.html:10335，7 天 TDX 官方歷史逐站觀測煉出的跑段內時間比例）。
- `vTopK`：該車種極速 km/h，用來設定速度上限 `VCAP`（10400）與端點更嚴的 `VS_END`（10361）。
- `zones`：可選地點式速限 `[{d0,d1,v}]`（彎道節點）。
- 輸出：`{T, L, obs:true, xs, ys, h, m}`（Fritsch–Carlson 單調三次 Hermite 插值的節點/斜率陣列），**`obs:true` 是後續 `profileProgress`/`profTimeToProg` 用來分辨走哪條算式的旗標**。

### B-4 assignRunProfiles（組裝＋通過站時刻回填）

檔案：index.html:10499-10600（全文已在 A-4(a) 引用一半，這裡補完整）：
```js
function assignRunProfiles(s, perf, obs, zoneCls, pre) {
  let k0 = 0;
  for (let k1 = 1; k1 < s.length; k1++) {
    if (s[k1].stop === false && k1 < s.length - 1) continue; // 通過站併入本跑段;末節點強制收尾
    const segKm = []; let runKm = 0;
    for (let i = k0; i < k1; i++) { const km = schedSegKmOf(s, i); segKm.push(km); runKm += km; }
    const runDep = s[k0].depSec, runT = s[k1].arrSec - runDep;
    ...
    if (rp && runKm > 0) {
      let cum = 0;
      for (let i = k0; i < k1; i++) {
        s[i].rp = rp; s[i].rpDep = runDep; s[i].rpOff = cum * 1000; s[i].rpSegKm = segKm[i - k0];
        cum += segKm[i - k0];
        if (i + 1 < k1 && s[i + 1].stop === false)
          s[i + 1].arrSec = s[i + 1].depSec = runDep + profProgToTime(rp, cum / runKm);
      }
    }
    k0 = k1;
  }
}
```

**「跑段（run）」的定義（停站 vs 通過站怎麼區分）**：從 `k0`（上一個真停靠站）掃到下一個 `s[k1].stop !== false` 的站（`stop===false` 才是通過站，見 index.html:10502 `if (s[k1].stop === false && k1 < s.length - 1) continue;`）——**這就是「停站與通過站怎麼區分」的答案：靠 `tr.stops[i].stop` 這個布林欄位（`false`＝通過站，其餘＝真停靠站）**，一個 run 可以橫跨多個通過站，中間不重新起降速。

**通過站時刻回填規則（逐字節錄見上，index.html:10594-10595）**：
```js
if (i + 1 < k1 && s[i + 1].stop === false)
  s[i + 1].arrSec = s[i + 1].depSec = runDep + profProgToTime(rp, cum / runKm);
```
即：把「這個通過站距跑段起點的累計公里數 `cum` 除以整個跑段公里數 `runKm`」得到一個 0..1 的**里程比例**，丟進 `profProgToTime(rp, f)`（index.html:10455-10471，`profileProgress`/`profTimeToProg` 的反函式：距離進度→段內秒數）反解出「跑了這個里程比例時對應的秒數」，加上跑段發車秒 `runDep` 就是回填的到／離站時刻（兩者相等，代表通過站不佔用時間寬度）。

**回填規則的本質：按里程比例插值進「已經解出來的速度曲線」（梯形或實測 PCHIP 曲線），不是等速、也不是單純按車種極速。** 若曲線是梯形（`buildProfile`），則距離與時間之間是分段二次/線性關係（加速段拋物線、巡航段線性、煞車段拋物線）；若是實測剖面（`buildObsProfile`），則是三次 Hermite 插值反解——不論哪種都不是「等速」，是曲線在該里程比例下對應的時刻。

**單位/欄位小結**：
- `rp`：run 的速度曲線物件（`buildProfile`/`buildObsProfile` 的回傳值，含 `.L`＝整個 run 的公尺數、`.T`＝整個 run 的秒數、`.obs` 旗標）。
- `rpDep`：整個 run 的發車秒（`s[k0].depSec`，同一個 run 內所有站共用同一個值）。
- `rpOff`：**這一小段（i→i+1）**的起點距 run 起點的累計公尺數（`cum*1000`，逐站遞增）。
- `rpSegKm`：**這一小段**自己的公里數（`schedSegKmOf` 算出來、單位公里，用時要 `*1000`）。

### B-5 通過站時刻回填 grep 結果

grep 關鍵字 `derived-pass-times`、`passTimes`、`backfill`、`interp`：均**未找到**（僅找到中文註解「回填」與程式邏輯本身，沒有以上英文識別字）。實際回填邏輯就是 B-4 的 `assignRunProfiles` 內建行為，沒有另外獨立命名的函式或模組。

---

## C. hold／占用限制

### C-1 updateBlockHolds：作用的時間軸與入口

呼叫點：index.html:16021 `updateBlockHolds(); // 後車不穿越前車:算完 simSec 之後、任何人問位置之前先更新阻擋回撥(相機與繪製都吃 trainPos)`。

**分組依據＝舊的 2D `trainSeg`（貼軌系統），不是 physical 的 `route.offsets`**：
```js
// index.html:10741-10750
if (!BLOCK_SYS[tr.sys]) continue;
const key = blockKeyOf(tr), h = _blockHold.get(key) || 0;
const g = trainSeg(tr, state.simSec - liveDelaySec(tr) - h);
if (!g || !g.ln) { _blockHold.delete(key); ...; continue; }
const k = g.ln.id + '|' + g.dir;                       // 同一條線形+同方向才是同一條軌道
let a = groups.get(k); if (!a) groups.set(k, a = []);
a.push({ tr, key, h, g });
```
`BLOCK_SYS = { tra_sched: 1 }`（index.html:10705，只開台鐵）。同一組內用 `g.d`（`trainSeg` 算出的沿 2D shape 里程）比較前後車距，棘輪式逼近 `BLOCK_GAP_KM=0.4`（400m 標準車距，10706）、下限 `BLOCK_GAP_MIN_KM=0.02`（10712）、每秒長 `BLOCK_GAP_GROW=10/3600 km/s`（10713）。

**上限**：`BLOCK_CAP_SEC = 120`（index.html:10714，逐字：`// hold 上限(秒)`），套用處：
```js
// index.html:10796
if (h2 > BLOCK_CAP_SEC) { h2 = BLOCK_CAP_SEC; _blockCapped.add(it.key); }
```
註解（10701-10704）說明這個上限是「誠實邊界」：超過兩分鐘化解不了代表時刻表真的要求超車、目前不模擬待避。

**入口：只改畫面用的時間參數，不改 schedule。**`blockHoldSec(tr)`（index.html:10726）：
```js
function blockHoldSec(tr) { return _blockHold.size && BLOCK_SYS[tr.sys] ? (_blockHold.get(blockKeyOf(tr)) || 0) : 0; }
```
消費點只有 `trainPos`（index.html:10665）：`trainPosAt(tr, t - liveDelaySec(tr) - blockHoldSec(tr))`——`blockHoldSec` 的值被拿去**往回推移**丟進 `trainPosAt` 的時間參數 `t`，不論 `trainPosAt` 內部走 physical `sample()` 還是 legacy `trainSeg`，兩條路徑收到的都已經是「延後過的 t」。**`tr.stops[i].arrSec/depSec/rp/...`（schedule 本身）完全沒被 `updateBlockHolds` 動過**——這純粹是顯示層的「有效時鐘偏移」技巧。

**觀察（標記，不下結論）**：`updateBlockHolds` 算「誰在誰前面、間隔多少」完全依賴 legacy 2D 的 `trainSeg`/`g.d`（貼軌 shape 里程），但實際畫面上很多台鐵車的位置是由**另一套不同源的 physical chainage**（A 節已證明兩者不同源）決定的。也就是說：這個防追撞機制認定「安全」的車距，量測基準跟實際顯示位置的基準不是同一把尺。

**歷史脈絡（逐字節錄，2026-09-12 之前的一次修復記錄，附在同一個迴圈正上方，index.html:10735-10740）**：
```js
// 🔴 這裡曾經加上「走實體股道的車就跳過」(0f5bb774 v0907n)，因為那一版另有一套橫移避讓
// (rail-3d/integration/passing-avoidance.js)接手。那套在 06dd0034 v0908f 依裁示整個移除了
// (車廂必須沿指派股道走、不准整列橫移)，短路卻留在原地 ⇒ 台鐵 918 班全部 has()=true
// ⇒ issue #17 的防追撞在台鐵上變成 100% 死碼。實測 05:00–23:55 每 5 分抽樣 228 個時點，
// 同向在途車身互相穿透 9 對(七堵→八堵 278/6652 車頭距 0.39 公尺、車身重疊 60 公尺)，
// 這 9 對全部落在同一個 ln.id|dir 分組內 ⇒ 拿掉短路就接得住，不必改分組的尺。
```
目前程式碼（HEAD 86663b05）**沒有**看到「走實體股道就跳過」這行短路（迴圈裡只有 `if (!BLOCK_SYS[tr.sys]) continue;`），所以就文字描述而言這個特定短路已經移除。這段歷史與使用者現在要查的「同股道互穿」症狀描述高度相似（七堵→八堵、車身重疊），但這是**過去的修復記錄**，不代表現在沒有其他成因——是否仍有殘餘、或問題已轉移到 A 節發現的長度不同源，需要另外驗證。

### C-2 physical 端沒有獨立的防追撞/占用 hold

grep `hold|reservation|occupanc`（大小寫不拘）於 `rail-3d/physical/*.js` 的結果只有：
- `motion.js` 裡的 `holds`／`plan.holds`／`plan.departureHolds`——這些是**時刻表停站的到離站 hold（月台停留秒數的官方/推估調整值）**，與防追撞無關，是 A-2 節 `record()` 讀的東西。
- `motion.js:36` 的 `estimatedHoldSec:Math.max(0,t-rawTime)`——這是 `sample()` 回傳物件裡的一個**診斷欄位**（現在時刻 t 減掉「模型本身走到的時間」）。**grep 全專案找不到任何讀取 `estimatedHoldSec` 的地方**（只有 motion.js:36 這一處賦值），目前是沒人消費的輸出欄位。
- `reservations.js` 的 `vehicleReservations(network,tr,ids,schedule)`——這是**派車求解器（dispatch optimizer）用的離線資源預約表**，不是執行期防追撞：呼叫者只有 `scripts/optimize_physical_dispatch.mjs:34`（離線最佳化派車）與 `scripts/verify_thsr_reservation_motion.mjs`（高鐵專用驗收），**與 `verify_physical_no_overlap.mjs`／執行期畫面無關**。內有預設車長退路 `const half=(tr.lengthM||240)/2+3`（reservations.js:5，`240` 是沒給 `tr.lengthM` 時的預設全車長，見 D 節）。

**結論：physical 模組本身沒有任何「執行期」的車間距/占用限制邏輯；唯一的執行期防追撞是 index.html 的 `updateBlockHolds`/`blockHoldSec`（C-1），且只對畫面位置的時間參數生效，只認 `BLOCK_SYS={tra_sched:1}`。**

### C-3 plan-binding.js／route-runtime.js 的查詢入口

- **`createPlanBinding(dispatch)`**（rail-3d/physical/plan-binding.js:23-47）回傳一個函式 `tr => {plan, basis, sourceKey?}`（無獨立命名，是 motion.js `record()` 裡的 `bind(tr)`，見 A-2）。決定一班車綁到哪份 `plan`（進而綁到哪串 `plan.pathIds`）的規則優先序：
  1. `dispatch.plans[physicalTrainKey(tr)]`（plan-binding.js:2 `physicalTrainKey=tr=>[tr.sys||tr.system,tr.train,tr.stops[0].depSec,tr.stops.at(-1).arrSec].join(':')`）精確命中且站序簽章完全相同 → `basis:'exact'`（plan-binding.js:28）。
  2. 簽章不同但「只有通過站的時刻變了」→ `sameDerivedPasses(plan,tr)`（plan-binding.js:8-16）→ `basis:'derived-pass-times'`（29）。
  3. 高鐵當日改班且站序/站名相同 → `basis:'retimed'`（31）。
  4. 加開車／找不到精確 plan → 從同系統既有 plan 裡找「連續子序列站名相同」的模板借路徑切片 → `basis:'route-template'`（45）。
  查無 → 回 `null`（motion.js 的 `record()` 因此回 `null`，`sample()` 回 `undefined`）。
- **`route-runtime.js` 的入口**：`createRouteRuntime(pack,profiles)`（route-runtime.js:5）回傳 `{unfold,route,drawingWays,atHeight,levelAt,wayById}`。「這一段車綁到哪條實體路徑」的查詢是 `unfold(id)`（13-16，單一 pathId 展開成座標/節點/edges）與 `route(ids,system,color,{prefixM,suffixM})`（26-31，把一串 pathId 接成一條可查 `offsets`/`elevation`/`level` 的完整路線，含快取 `routes` Map，size>128 會 LRU 淘汰）。motion.js 的 `sample()` 每次呼叫 `geometry.route(r.plan.pathIds.slice(from,to),...)`（motion.js:26）取得目前這 1~2 段的 `route` 物件。

---

## D. 車長

### D-1 現行值（rail-3d/integration/formations.js:9-46）

`FORMATIONS` 物件逐車種列出（`lengths` 陣列單位公尺，`spec()`＝`countBasis:'standard',lengthKnown:true`；`estimated()`＝`countBasis:'estimated',lengthKnown:false`；`unknown()`＝`countBasis:'unknown',lengthKnown:false`，皆為 formations.js:3-8 定義的工廠函式）：

| id（FORMATIONS key） | 節數/長度陣列(m) | 總長(m，各節加總) | 分類 | 備註 |
|---|---|---|---|---|
| `700t`（高鐵） | 27+10×25+27 | 304 | standard | |
| `emu3000`（自強3000） | 21.35+10×20.3+21.35 | 245.7 | standard | |
| `taroko`（temu1000太魯閣） | 8×21 | 168 | **approximate**(`lengthKnown:false`) | 「長度暫用近似值」 |
| `puyuma`（temu2000普悠瑪） | 22.095+6×20.7+22.095 | 168.39 | standard | |
| `pp`（e1000，PP自強） | 17.4+12×20+17.4 | 274.8 | **approximate** | 前後機車＋12節客車 |
| `dr1000`（支線柴聯車） | 3×20 | 60 | **estimated** | 「平日 2~3 輛，取常態 3 輛」 |
| `dr3100`（柴聯自強） | 3×20 | 60 | **estimated** | 「固定3輛一組，連假最多5組重聯」 |
| `commuter`（區間車 emu800） | 3×20 | 60 | **unknown** | 見 D-2 |
| `chukuang`（莒光 e200） | 17+20+20 | 57 | **unknown** | 見 D-2 |
| `blue`／`haifeng`／`shanlan`／`mingri`／`star`（藍皮／海風號等具名觀光列車） | 17+20+20 或 3×20 | 57~60 | **unknown** | |
| `forest`（阿里山林鐵） | 10+12+12 | 34 | standard | |
| `wenhu`（文湖線） | 4×13.78 | 55.12 | standard | |
| `c321`／`c381`（北捷中運量） | 6×23.5 | 141 | standard | |
| `metro-short`（支線） | 3×23.5 | 70.5 | standard | |
| `y100`（環狀線） | 4×17.1 | 68.4 | standard | |
| `kaohsiung`（高捷紅橘線） | 3×21.82 | 65.45 | standard | |

**其餘 sanying/taichung/airportlocal/airportexpress/danhai/ankeng/caf 見 formations.js:37-45，皆非台鐵，與本次調查關聯較低，故不逐條列出。**

`tr.lengthM` 的預設退路（找不到編組時）＝**240 公尺**，見 `rail-3d/physical/reservations.js:5`：`const half=(tr.lengthM||240)/2+3;`（僅該離線派車模組用到；`verify_physical_no_overlap.mjs` 走的是 `formationFor`/`assembleFormation` 算出的 `m.lengthM`，見 E 節，沒有這個退路，找不到編組直接 `continue` 跳過比對，見 E 節 `__scan` 的 `if (!m) continue;`）。

### D-2 觀察：commuter／chukuang 的長度被刻意壓短，且與 A/A′ 棘輪直接相關

逐字節錄（rail-3d/integration/formations.js:19-24）：
```js
// 區間車 8 輛／160 m、莒光 8 客車＋機車／177 m 仍未解鎖。
// 已修正車型判準與部分派軌，2026-09-12 長編組全日仍超過 A／A′ 棘輪。
// 不加大 120 秒 hold，不靠縮小驗收分母通過。重驗方式與殘餘案例見 FORMATIONS.md。
commuter:unknown('emu800',repeat(3,20),2.9),
chukuang:unknown('e200',[17,20,20],2.9),
```
即：註解明講區間車真實編組應為 8 輛/160m、莒光應為 8 客車+機車/177m，但目前程式碼實際使用的是 `unknown(...)` 只給 3 節（60m／57m）。**此觀察與 E 節 `verify_physical_no_overlap.mjs` 的 `FORMATION_PROBE=long` 機制（腳本第 97-102 行，把 commuter/chukuang 動態換成 8/9 節再重量一次）直接對應**——即目前程式庫裡確實有「換長編組會讓 A/A′ 類判準變糟」這個已知但未解的狀態，`FORMATIONS.md`（本次未讀取此檔，因其在工作樹之外或未被要求）應有更完整記錄。這是觀察，不是結論：沒有做實驗，不代表「這就是使用者回報症狀的成因」，但長度低估必然讓 `verify_physical_no_overlap.mjs` 的車身佔用計算（`occupancy(route,chainageM,lenM)`，E 節）對這兩種車種系統性地低估車身涵蓋範圍。

### D-3 車身在畫面上怎麼從車頭位置往後延伸

**答案：沿 physical route 的 chainage（同一個 `path`/`route.offsets` 座標系）往前後展開，不是直線位移、也不是另一套獨立座標。**

`assembleFormation(spec,catalog)`（formations.js:95-106）把 `spec.lengths`（每節車長）換算成**相對車頭的偏移量** `offsetM`（車頭為 0，往後遞減，formations.js:101-104：`let front=lengthM/2; ...front-=lengthM;`），輸出 `parts[]`，每個 part 含 `lengthM`/`bodyLengthM`/`bodyShiftM`/`offsetM`。

真正把 `offsetM` 換算成畫面座標的是 `formationPoses(path,s,direction,parts,elevation)`（rail-3d/integration/train-path.js:38-43，逐字）：
```js
export function formationPoses(path,s,direction,parts,elevation=()=>.65){
  const first=parts[0],last=parts.at(-1),front=s+direction*(first.offsetM+first.lengthM/2),back=s+direction*(last.offsetM-last.lengthM/2);
  if(!path.at(front)||!path.at(back))return null; // 未知的接續段不畫直線、也不把車廂堆在端點。
  return parts.map(part=>{const chainage=s+part.offsetM*direction,c=path.at(chainage),half=Math.min(8,part.lengthM*.32),a=path.at(chainage-direction*half),b=path.at(chainage+direction*half),z=elevation(chainage),za=elevation(a.s),zb=elevation(b.s);
    const dx=(b.coordinate[0]-a.coordinate[0])*Math.cos(c.coordinate[1]*Math.PI/180),dy=b.coordinate[1]-a.coordinate[1];return {coordinate:c.coordinate,s:chainage,height:z,angle:Math.atan2(dy,dx),pitch:Math.atan2(zb-za,distanceM(a.coordinate,b.coordinate))};});
}
```
每一節車的畫面座標 `chainage = s + part.offsetM*direction`（`s`＝車頭 chainage，`direction`＝行進方向 ±1）都是用 `path.at(chainage)`（train-path.js:9，沿同一條 `path` 的弧長座標插值）算出來的——**車尾（乃至每一節車廂）都是沿著車頭所在的那條 physical route 弧長座標往回推，不會離開股道、也不會用直線內插跳過彎道**。呼叫端 `rail-3d/integration/map3d.js:283`：`formationPoses(path,profile.s,profile.direction*(v.formationFacing||1),m.model.parts,s=>railHeight(path,s))`，其中 `path`／`profile.s` 來自 `routeProfile(v)`（map3d.js:245-248，見 A-6）。

grep `formation|length|carLen|tail|rear` 補充：專案內沒有 `carLen` 或 `rear` 這兩個識別字（grep 全專案 0 命中）；`tail` 只出現在少數不相關的檔名/字串（未見於車長延伸邏輯）。

---

## E. 全日偵測腳本 `scripts/verify_physical_no_overlap.mjs`

### E-1 怎麼起

- 自帶 Node `http.createServer`（腳本 60-73 行）直接吃 repo `ROOT`（腳本 46 行 `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')`，即工作樹根目錄）當靜態站，`/api/*` 一律回 `{}` 除了 `/api/thsr-schedule` 回 `data/thsr_schedule_dense.json`。不需要外部 server（腳本標頭註解第 33 行）。
- 用 **Playwright**：`chromium`（預設）或 `webkit`（`ENGINE=webkit`），`browser.launch()` → `ctx.newPage()`（腳本 79-82 行）。
- 開啟頁面 URL（腳本 104 行）：
  ```
  http://127.0.0.1:${PORT}/?g=all&scene=3d&lang=zh-TW&at=24.6,121.8&z=13&t=09:56
  ```
  等待條件（105 行）：`state.ready && state.trains?.length > 0 && window.railIslandPhysical`。

### E-2 可調環境變數（全部列出，逐字對照腳本行號）

| 變數 | 預設 | 行號 | 用途 |
|---|---|---|---|
| `PORT` | 5531 | 47 | 自帶 server 埠號 |
| `TEST_DATE` | 無（用真實今天） | 48-49, 83 | 固定服務日，格式 `YYYY-MM-DD`，餵給 `page.clock.install`（見 F 節） |
| `STEP` | 4（秒） | 50 | 重放步長：`__step` 每次推進的模擬秒數 |
| `SAMPLE` | 120（秒） | 51 | 取樣間隔：每隔多少模擬秒才做一次 `__scan` |
| `FROM` | `5*3600`=18000（05:00） | 52 | 掃描視窗起點（模擬秒） |
| `TO` | `24*3600-1`=86399（23:59:59） | 53 | 掃描視窗終點；註解特別警告縮小視窗會讓 G3 分母斷言刻意變紅（38 行） |
| `FORMATION_PROBE` | 無；`long` 才生效 | 36, 97-102 | 把 `commuter`/`chukuang` 換成 8/9 節長編組再重量一次（見 D-2），**只在瀏覽器試驗，不寫回產品原始碼** |
| `ENGINE` | chromium | 37, 79 | 換 `webkit` 引擎 |
| `REPORT` | `output/physical-no-overlap.json` | 261 | 完整事件報告輸出路徑 |
| `NETWORK` | 無 | 103 | 覆蓋 `rail-3d/physical/network.json` 內容(檔案路徑) |
| `DISPATCH` | 無 | 103 | 覆蓋 `rail-3d/physical/dispatch.json` 內容(檔案路徑) |

（`FROM`/`TO` 標頭註解特別聲明「只給除錯用」，全日才是正式契約，36-38 行。）

### E-3 位置採樣用哪個函式

**用畫面同一入口 `trainPos`/`trainPosAt`，不是另外直接呼叫 physical `sample()`**（逐字，腳本 142-148 行 `window.__scan`）：
```js
window.__scan = (useHold) => {
  const vs = [];
  for (const tr of state.trains) {
    if (tr.sys !== 'tra_sched' || tr.loop) continue;
    // 位置走畫面同一個入口。useHold=false 是正向對照組(把防追撞關掉重量一次)。
    const p = useHold ? trainPos(tr, state.simSec) : trainPosAt(tr, state.simSec - liveDelaySec(tr));
    if (!p || !p.physical) continue;
    ...
```
`useHold=true`（正式量測）呼叫 `trainPos(tr,state.simSec)`（即 A 節的 `trainPos`，含 `liveDelaySec`/`blockHoldSec` 扣減）；`useHold=false`（G8 對照組，防追撞關閉）直接呼叫 `trainPosAt(tr, state.simSec - liveDelaySec(tr))`（跳過 `blockHoldSec`）。**兩者都只收 `p.physical===true` 的車**（等於只量走 physical 路線、且 `sample()` 沒回退到 legacy 2D 的那些台鐵車）。

### E-4 A／A′／B／C 判定邏輯（逐字節錄）

**車身佔用計算**（腳本 126-137 行 `occupancy`）：把車頭 `chainageM` 往前後各展開 `lenM/2`（`lenM=m.lengthM`，來自 `formationFor`+`assembleFormation`，見 D 節），對 `route.edges`/`route.path.d` 逐段算出「這節車身覆蓋了哪個 `edgeId`、覆蓋區間（用 edge 自己的參數 t∈[0,1] 表示)」：
```js
const occupancy = (route, chainageM, lenM) => {
  const d = route.path.d, s0 = Math.max(0, chainageM - lenM / 2), s1 = Math.min(route.path.length, chainageM + lenM / 2), res = new Map();
  for (let i = 0; i < route.edges.length && i < d.length - 1; i++) {
    const a = d[i], b = d[i + 1]; if (b <= s0 || a >= s1) continue;
    const e = route.edges[i], span = (b - a) || 1, wspan = Math.abs(e.b - e.a) || 1, lo0 = Math.min(e.a, e.b);
    const u0 = (Math.max(a, s0) - a) / span, u1 = (Math.min(b, s1) - a) / span;
    const t0 = (e.a + (e.b - e.a) * u0 - lo0) / wspan, t1 = (e.a + (e.b - e.a) * u1 - lo0) / wspan;
    const prev = res.get(e.edgeId), cur = [Math.min(t0, t1), Math.max(t0, t1), span];
    res.set(e.edgeId, prev ? [Math.min(prev[0], cur[0]), Math.max(prev[1], cur[1]), span] : cur);
  }
  return res;
};
```
**判定「互穿」＝兩車 `occupancy` 結果在同一個 `edgeId` 上有區間交集 >0.01（sharedMetres，138-141 行）**：
```js
const sharedMetres = (ra, rb) => { let m = 0; const keys = [];
  for (const [k, ta] of ra) { const tb = rb.get(k); if (!tb) continue;
    const ov = Math.min(ta[1], tb[1]) - Math.max(ta[0], tb[0]); if (ov > 1e-9) { m += ov * ta[2]; keys.push(k); } }
  return { m, keys }; };
```
**分類（206 行，逐字）**：
```js
const cls = h => h.dwellA && h.dwellB ? 'B 兩車都停站' : (!h.sameDir ? 'A′ 對向' : (h.dwellA || h.dwellB ? 'C 一停一跑' : 'A 同向在途'));
```
`h.sameDir`＝`A.dir===B.dir`，而 `A.dir`/`B.dir` 來自 **`trainSeg`**（腳本 150 行：`const g = trainSeg(tr, state.simSec - liveDelaySec(tr) - (useHold ? blockHoldSec(tr) : 0)); ... dir: g?.dir ?? null`）——**分組/分類用的方向判斷同樣是 legacy 2D 系統，不是 physical route 的方向**（腳本本身的頭部註解第 19 行也明講：「分組（同向／對向／停站中）用 `trainSeg`；分組不是判準，判準是分組之後量到的佔用交集」）。

**棘輪基準值（非零容忍，逐字，腳本 54-58 行）**：
```js
const BASE_A = 5;             // 同向在途互穿:實測基線(對照組關掉防追撞是 12 筆)。棘輪,只准往下
const BASE_B = 55;            // 9/13 派軌修復後三服務日最大 47，上限降低以防退步
const BASE_C = 10;           // 9/13 派軌修復後三服務日最大 6，上限降低以防退步
const BLOCK_CAP = 120;        // 與 index.html 的 BLOCK_CAP_SEC 同值,只用來寫進訊息
const BASE_OPP = 18;          // 9/13 派軌修復後三服務日最大 15，上限降低以防退步
```
對應閘門 G2（A≤BASE_A）、G5（C≤BASE_C）、G6（B≤BASE_B）、G7（A′≤BASE_OPP），另有 G0（伺服器吐的樹與磁碟 md5 相符）、G1（physical 已就緒且覆蓋 ≥99% 台鐵班）、G1b（三個具名車型/長度抽查）、G1c（`TEST_DATE` 時服務日相符）、G3（分母沒有縮水：`samples>=500 && runSum/samples>=100 && comparedSum>=3000`）、G4（hold 真的有進到 `trainPos`）、G8（正向對照：關掉防追撞 A 類必須明顯變多）、G9（頁面無 JS 例外）。

### E-5 輸出 JSON 欄位

`REPORT`（預設 `output/physical-no-overlap.json`，腳本 261-263 行）：
```js
writeFileSync(reportPath,JSON.stringify({serviceDate:setup.serviceDate,formationProbe:process.env.FORMATION_PROBE||'production',setup,step:STEP,sample:SAMPLE,samples,counts,events,results},null,2));
```
欄位：`serviceDate`（`setup.serviceDate`，見 F 節）、`formationProbe`（`'production'` 或 `'long'`）、`setup`（初始 `page.evaluate` 回傳的物件，含 `identities`/`serviceDate`/`trains`/`traTotal`/`hasCovered`/`physicalReady`/`live`）、`step`/`sample`（STEP/SAMPLE 的值）、`samples`（實際取樣次數）、`counts`（各分類 A/A′/B/C 累計次數的物件）、`events`（逐筆命中事件陣列，每筆＝`{timeSec, a, b, sharedM, resources, edgeIds, minM, dwellA, dwellB, sameDir, holds, headM, centreM, stop}`）、`results`（G0-G9 的 `{name,pass,detail}` 陣列）。

### E-6 與台鐵時間模型驗證相關的既有腳本（grep：verify_tra_motion、verify_untouched、probe_、replay_ 等，各一句用途）

| 腳本 | 一句用途 |
|---|---|
| `scripts/verify_tra_motion.mjs` | 驗「畫面速度上界」有沒有真的夾在移動的那個點上，而不是只夾在顯示用的文字（issue：EMU3000 顯示 148km/h 的顯示層漏夾） |
| `scripts/verify_untouched.mjs` | issue #17 安全邊界閘門：凡走「純表定時間軸」的東西（到離站時刻、effT/effTLive、整趟速度曲線）必須與**改動前的版本**逐點相同，另起 server 用改動前的程式碼當基準 |
| `scripts/verify_run_profiles_match.mjs` | 離線預算剖面「搬家」的三方比對（離線產物 vs 前端現算 vs 前端讀預算值），確保移植沒有讓計算結果偷偷改變 |
| `scripts/verify_seg_cumdist.mjs` | 驗 `data/tra_seg_cumdist.json`（累積里程資料）本身的合理性 |
| `scripts/verify_speed_cap.mjs` | 台鐵位置模型的速度合理性回歸測試（issue #15：EMU3000 顯示 148km/h），四項判準分工驗顯示層/模型層 |
| `scripts/verify_physical_motion.mjs` | 用 `createPhysicalMotion` 直接（非瀏覽器）取樣多個跑段時間點，斷言算出的經緯度與 `route.path.at(chainageM)` 完全一致、高程有限值 |
| `scripts/verify_physical_display_profiles.mjs` | 驗 physical 股道的高程剖面（`display-profiles.json`）與地表 DEM 的關係（股道不能穿地）、同節點高度一致性 |
| `scripts/verify_physical_official_capture.mjs` | 瀏覽器（chromium+webkit）擷取 physical 模式下 metroCore/官方項目對照，用於 3D physical 整合回歸 |
| `scripts/verify_physical_runtime_cache.mjs` | 用同一份真實班表比較「改動前(`git show <sha>`動態載入舊版模組)」與現版的逐幀採樣差異 |
| `scripts/verify_physical_topology.mjs` | 驗 `topology.js` 的最短路徑/道岔可轉性邏輯（不含時間模型，是股道拓樸層） |
| `scripts/verify_tra_pass_continuity.mjs` | 驗「通過站前後位置連續性」——**其標頭註解描述的缺陷（`assignRunProfiles` 把通過站到離站時刻 `Math.round` 到整秒，`index.html:7374`）在目前程式碼中已找不到對應的 `Math.round`**（現在的 `assignRunProfiles`，index.html:10594-10595，直接用浮點秒數回填，且旁邊有明文註解「不可以取整」，見 B-4）——**觀察**：此腳本標頭引用的行號（7374）與現在的實際行號（10499 一帶）差距很大，且描述的整數捨入行為現在看不到，可能是舊版缺陷已修但腳本描述文字未同步更新，也可能是行號因檔案成長而漂移、邏輯其實仍在別處以其他形式存在——本次未逐行核對該腳本其餘內容，僅核對其標頭主張與目前 `assignRunProfiles` 原始碼的差異，留給後續判斷 |
| `scripts/verify_tra_binding_continuity.mjs` | 驗車輛在通過站前後 ±1ms 取樣位置跳動 <1m，且 elevation 有限值、方向有正有負（用 `scripts/fixtures/tra-runtime-binding-0909.json`） |
| `scripts/verify_tra_plan_binding.mjs` | 驗 `createPlanBinding` 對特定通過站案例能正確判定 basis |
| `scripts/verify_no_overtake.mjs` | issue #17 原始驗收：只看 `trainPos` 吐出的經緯度算「後車是否穿過前車」，判準與實作（`trainSeg`/`_blockHold`）完全獨立——**`verify_physical_no_overlap.mjs` 標頭明講此腳本因為等待條件寫法（只等 `state.trains.length>300`）而從未等到 `window.railIslandPhysical` 就緒，所以从來沒有真的驗過 physical 路徑（2026-09-12 之前的狀態）** |
| `scripts/verify_side_offset.mjs` | issue #17 並排偏移驗收，判準從「畫出來的那顆點」反推，不讀 `_blockSideEase` 自己的簿記 |
| `scripts/verify_block_cost.mjs` | `updateBlockHolds` 的效能回歸閘門（車數翻倍耗時不得翻超過四倍） |
| `scripts/verify_train_overlap_pick.mjs` | 驗兩車重疊時使用者「點得到下層那台車」（UI 點擊命中問題，非位置模型本身） |
| `scripts/verify_passing_avoidance.mjs` | 回歸 A54 真機在台北車站實測到的情境，比對原始股道線段（非只用同一條 path 自證） |
| `verify_pass_obs.mjs`（repo 根目錄） | 驗「通過站實測剖面」（快車跳站校正 Phase 2），判準取材與實作無關的來源（HEAD 舊版行為、物理常數） |
| `eval_pass_obs.mjs`（repo 根目錄） | 獨立量測模型對「不知道會停的站」的預測誤差，真值來自官方表定+官方 DelayTime，避免同源指標獎勵錯誤模型 |
| `proto_replay.mjs`（repo 根目錄） | 拿 D1 逐站觀測（2026-07-24）還原列車當日真實位置，與表定版並排比較 |
| `scripts/build_run_profiles.mjs` | **不是驗收腳本**：離線產生台鐵跑段速度剖面（`buildObsProfile`/彎道速限/梯形）寫進班表檔，供 `assignRunProfiles` 的 `pre` 參數讀取（見 B-4） |
| `scripts/build_pass_obs.mjs` | **不是驗收腳本**：從 TDX 7 天歷史逐站觀測產生 `data/tra_pass_obs.json`（通過站實測折點資料源） |
| `scripts/_probe_prod_tradaily.mjs` | 正式站煙測：台鐵今日停駛偵測有沒有真的在跑（讀 `state.traDaily`，非時間/速度模型） |
| `scripts/_probe_tra_daily_mobile.mjs` | 停駛列 UI 在手機四種寬度下的幾何/命中測試（非時間模型） |
| `scripts/probe_workerd_clock.mjs` | 驗 Cloudflare Workers 的 `Date.now()` 是否會在 `await fetch()` 後前進（Workers 執行環境時鐘假設，與台鐵位置模型無直接關係，但同屬「時鐘」關鍵字命中） |
| `scripts/verify_tra_daily_delta.mjs`／`verify_tra_daily_sentinel.mjs`／`verify_tra_daily_worker.mjs` | 台鐵「今日停駛」偵測鏈路的前端/worker/哨兵驗收（與停駛判定有關，非速度/時間模型本身） |
| `scripts/verify_tra_eased_roster_day.mjs` | 驗 `liveDelaySec` 的漸變鍵（`_easedShift`）不得跨營運日重用 |
| `scripts/verify_tra_wait_core.mjs`／`verify_tra_wait_push.mjs` | 台鐵「等站卡」（到站倒數卡片）純邏輯與推播鏈驗收，非位置模型本身 |

**grep 關鍵字逐一交代**：`verify_tra_motion`＝`scripts/verify_tra_motion.mjs`（存在）；`verify_untouched`＝`scripts/verify_untouched.mjs`（存在）；`probe_`＝`scripts/_probe_diag_mobile.mjs`／`_probe_diag_realpath.mjs`／`_probe_prod_tradaily.mjs`／`_probe_tra_daily_mobile.mjs`／`probe_bus_transfer_live.mjs`／`probe_centroids.mjs`／`probe_workerd_clock.mjs`／`scripts/probes/`（目錄，未展開細看）；`replay_`＝工作樹外層原始 repo 只在**未 commit 的工作目錄雜項**中看到 `scripts/replay_metro_receive_continuity.mjs`（那是本次 git status 顯示的未追蹤檔案之一，且是**捷運**不是台鐵，與本次台鐵時間模型調查關聯低，本工作樹 `/private/tmp/railisland-overlap-repair-0912` 內未見此檔，因為它是乾淨的 origin/main checkout，未包含未 commit 的雜項檔案）。

---

## F. 服務日與時鐘

### F-1 服務日（哪一天的班表）：由真實/瀏覽器系統時鐘決定，沒有 URL 參數可覆蓋

**`resolveScheduleDay(data)`**（index.html:31863-31908）決定 `state.trains` 要用 `data.dates` 裡哪一天的班次子集：
```js
// index.html:31867-31874
const today = todayStr('Asia/Taipei');
let key = today, stale = false;
if (!data.dates[key]) {
  key = nearestSameWeekday(today, keys);
  stale = true;
  console.warn(...);
}
```
**`todayStr(tz)`**（index.html:24260-24262）：
```js
function todayStr(tz) {
  return new Date().toLocaleDateString('sv', { timeZone: tz || 'Asia/Taipei' });
}
```
即完全依賴 JS 引擎的 `new Date()`（真實系統時鐘或瀏覽器時鐘），**沒有任何 `?date=`／`?day=` 之類的 URL 參數可以覆蓋**（grep `params.get('date')`／`get('date')` 全專案 0 命中）。`state.wallDay = today`（index.html:31902）記錄下來，供跨午夜判斷（`schedWrapT`／`_noPrevWrap` 等，A-2/A-3 提過的 `wrap`）使用。

**這就是為什麼 `verify_physical_no_overlap.mjs` 要用 Playwright 的 `page.clock.install` 而不是 URL 參數**（腳本 83-84 行）：
```js
const clockStart = TEST_DATE ? new Date(TEST_DATE + 'T12:00:00+08:00') : new Date();
await page.clock.install({time:clockStart});
```
`page.clock.install` 是在瀏覽器的 JS 引擎層級偽造 `Date`/計時器，讓頁面內任何 `new Date()`（包括 `todayStr`）都讀到假時間，藉此把 `resolveScheduleDay` 騙成載入指定的 `TEST_DATE` 服務日。

### F-2 當日時刻（simSec）：URL `?t=HH:MM` 或程式呼叫 `setSimSec(sec)`

**URL 解析**（index.html:35146-35149，深連結解析區）：
```js
const qs = new URLSearchParams(location.search);
deepTrain = qs.get('train');
const mt = /^(\d{1,2}):(\d{2})$/.exec(qs.get('t') || '');
if (mt) deepT = (+mt[1] % 24) * 3600 + (+mt[2]) * 60;
```
套用點（index.html:35186）：`if (deepT != null) setSimSec(deepT);`（只精確到分鐘，秒數固定為 0）。

**`setSimSec(sec)`**（index.html:7636-7651）：
```js
function setSimSec(sec) {
  state.simSec = ((sec % 86400) + 86400) % 86400;
  sunlight?.update();
  state.clockAtNow = false;
  if (state.followTrain) state.followTimeJumped = true;
  syncTimeUI();
  if (state.mode !== 'sched') { ... }
  if (state.boardStation) renderBoard();
  updateCount();
}
```
呼叫後 `state.clockAtNow=false`——代表模擬時鐘**不再**自動追著真實「現在」跑，但若 `state.playing===true`，遊戲迴圈仍會逐幀推進 `state.simSec`（index.html:16009/16015：`state.simSec = (state.simSec + dt * state.speedMult * SCHED_K) % 86400;`）。**這正是 `verify_physical_no_overlap.mjs` 的 `__step()` 要顯式關閉 `state.playing` 的原因**（腳本 121 行）：
```js
window.__step = (sec) => { state.playing = false; setSimSec(sec); updateBlockHolds(); };
```

**其餘 grep 關鍵字**：`simSec`（`state.simSec` 賦值點已列於上方搜尋結果，共 9 處，主要是 `setSimSec`、`nowSecOfDay` 相關的「回到現在」路徑、與遊戲迴圈的逐幀推進）；`serviceDay`（專案用的是 `state.wallDay`／`_schedDay`／`taipeiServiceDayStr`，沒有字面叫 `serviceDay` 的識別字——`taipeiServiceDayStr(epochMs)`，index.html:24263+，是「北捷等捷運系統 00:00-04:00 仍算前一營運日」的另一套切點，與台鐵的 `todayStr`/`resolveScheduleDay` 不同函式）；`?date=`＝0 命中；`__setSim`／`setSimTime`／`freezeClock`＝**全部 0 命中**（專案沒有這些識別字；程式化控制模擬時鐘的入口是 `setSimSec(sec)`，`verify_physical_no_overlap.mjs` 自己在 `page.evaluate` 內定義了 `window.__step`/`window.__reset`/`window.__scan`/`window.__wired` 這幾個測試專用的全域函式，不是專案原生就有的識別字）。

### F-3 重現「9/13 09:54 台南」的機制（只描述機制，不代查台南實際座標）

依 E/F 節證據，機制上需要：
1. 讓頁面裡的 `new Date()` 回報 2026-09-13（`resolveScheduleDay`/`todayStr` 才會載入該服務日班表）——頁面本身**沒有**任何 URL 參數能做到這件事，只能靠外部手段偽造系統/瀏覽器時鐘（例如 Playwright 的 `page.clock.install`/`setFixedTime`，或瀏覽器 devtools 的 Sensors 時間覆寫；直接改作業系統時鐘也可以但影響全系統，不建議）。
2. URL 帶 `?t=09:54` 把 `state.simSec` 設到 9:54（分鐘精度，index.html:35148-35149,35186）。
3. URL 帶 `?at=<lat>,<lon>&z=<zoom>` 把地圖中心移到台南（本次未查台南站實際座標，避免編造數字；可從 `data/tra.json` 或現有腳本裡台南對應的既有座標抄用，例如 `scripts/verify_physical_official_capture.mjs:5` 用的是 `at=25.0477,121.5171`(台北)、`verify_physical_no_overlap.mjs:104` 用的是 `at=24.6,121.8`（沒有特定城市，只是台灣中部概略座標）——這兩個都不是台南，僅供格式參考）。
4. 若要精準卡在某一幀而非只是「開機當下」，用 `setSimSec(sec)`（頁面全域函式，控制台或注入腳本都呼叫得到）或比照 `verify_physical_no_overlap.mjs` 自訂 `window.__step`。

---

## 風險與未確定點（總結）

1. **A 節的「兩個長度不同源」是本次調查信心最高的發現**（有完整呼叫鏈與逐字程式碼佐證），但**沒有做實際數值比對**（例如挑一班七堵→八堵的車，實際算出 `rpSegKm*1000` 與 `route.offsets` 差值多少公尺）——這需要另外寫小工具才能驗證「不同源」在數值上造成多大落差，本次任務範圍只到「不同源」的程式證據為止。
2. **D-2 節的 commuter/chukuang 長度低估與 A/A′ 棘輪的關聯是程式庫自己的註解＋腳本機制對應出來的，本次沒有實際跑 `FORMATION_PROBE=long` 驗證數字**（沒有執行任何腳本，純讀碼）。`FORMATIONS.md` 檔案本次未讀取（不在被要求的檔案清單內，且時間有限）。
3. **C-1 節的「歷史修復記錄」（0f5bb774/06dd0034 commit）是否代表七堵→八堵那 9 對已經解決、或問題以别的形式殘留，本次未查證**（未跑 git log/git show 確認這兩個 commit 的完整內容，只讀了 index.html 現有註解與程式碼）。
4. **E-6 節 `verify_tra_pass_continuity.mjs` 標頭引用的 `index.html:7374 Math.round` 與現況（10594-10595 無 round）的落差，可能只是行號漂移或指涉別處，本次沒有用 `git log -p` 追這個函式的歷史版本去確認「哪一個 commit 移除了 Math.round」，只並排比較了現在的兩份文字。**
5. **本次完全沒有執行任何程式碼**（沒有起 server、沒有跑 Playwright、沒有跑任何 verify_*.mjs），純粹靜態讀碼——所有「行為」描述都是從程式碼邏輯推導，未經執行期驗證。若程式碼中有動態 import、條件式 polyfill、或本次 grep 沒覆蓋到的別名（例如透過 `window[...]` 動態組字串呼叫），可能有漏網之魚。
6. **F-3 節刻意不假造台南站座標**——這是任務指示「不准編造」的直接體現，需要主對話自行從 `data/tra.json`／`data/tra_seg_cumdist.json` 或既有腳本查證。
7. `rail-3d/physical/metro-motion.js`（捷運版的 physical motion）本次完全沒讀——任務六項都限定台鐵，故略過；但如果日後懷疑台鐵/捷運共用某段邏輯（例如 `route-runtime.js`／`train-path.js` 是共用的），需要另外檢查 metro-motion.js 是否有相同的「長度不同源」模式。
8. 本檔所有逐字節錄均直接複製自 `/private/tmp/railisland-overlap-repair-0912` 內的檔案內容（已核對 HEAD=86663b05=origin/main，git status 乾淨），行號為該工作樹當時的行號。

---
