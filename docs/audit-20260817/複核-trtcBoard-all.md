# 對抗式複核：「_trtcBoard.all 會把認錯的量散佈到整線沒配到的車，且自己在跳」

結論：**推翻（refuted）**。原發現一半成立一半不成立，且提出的修法打錯目標。

## 0. 先證明我讀的是出貨樹（心得 38）

| 項目 | 值 |
|---|---|
| worktree | `/Users/xuxiang/Code/捷運小動畫/.claude/worktrees/trtc-zombie`（branch `fix/trtc-zombie-retire`） |
| HEAD | `d5ff87d` 「北捷位置改成純班表——不再套誤點校正,也不做官方看板錨定」 |
| index.html | 22,904 行，md5 `ba2f3b5694f07e4d8bcf4bb955b89b72` |
| 正式站 railisland.tw（`-H 'Cache-Control: no-cache'`） | 22,904 行，md5 `ba2f3b5694f07e4d8bcf4bb955b89b72` |
| 對照 | origin/main `e947372…`、ship/v0817a `23f0666…`、v0816d `3b524f6…`、v0816c `e3da15d…` 皆不同 |
| 頁面自報 | `BUILD=v0817c`、`OFFICIAL_ROSTER_ENABLED=false`、`TRTC_PURE_SCHEDULE_POSITION=true` |

⇒ **正式站跑的就是 HEAD**，本複核的原始碼引用與實測同源同版本。

## 1. 機制本身：成立

`index.html:17321`
```
if (ln._trtcBoard && on) { const v = ln._trtcBoard.shifts.get(tr); target = v != null ? v : ln._trtcBoard.all; }
```
`all` 的來源確認是「已配到的那批 shift 的中位數」：`index.html:17904`／`17700`
`all: Math.round(trtcMedian(rec.values) || 0)`，而 `rec.values` 只在配對成功時 push（`17864`）。
所以「分母正是被配到的那批」這句敘述在原始碼層面是對的。

## 2. `all 自己在跳`：重現成功

正式站（捷頁籤，4 分鐘 × 5 秒取樣 = 48 輪）：

| 線 | all 範圍 | 單輪最大跳動 | 備註 |
|---|---|---|---|
| O_XINZHUANG | 11 … 1736 | **1687**（49 → 1736 → 64） | 與原發現的 48–1764 同量級 |
| R | 50 … 553 | 500（66→543→51→526→50→550） | 在兩群之間來回 |
| Y | −194 … 76 | 225（31→−194） | shifts 本身 min −483 / max 994 |
| BL / G / O_LUZHOU / BR | 26…85 / 190…227 | ≤ 30 | 穩定 |

原始檔：`docs/audit-20260817/probe_default.json`

**但這只是「中位數在雙峰樣本上翻面」**：O_XINZHUANG 只有 n=5~6 個配到的班次，Y 的 shifts 散佈是
−483…994；`trtcMedian` 取 `a[n>>1]`，一個樣本進出就換群。這是小樣本統計現象，
不需要「認錯」這個假設就能解釋（原發現把它直接歸因為「認錯的量」屬未證實的歸因）。

## 3. 「散佈到整線沒配到的車」：**實測不成立**（現行正式站）

`target` 那一行被 `on = metroLiveOn(ln)` 守著（`index.html:17314`），而 `metroLiveOn` 在
`index.html:16946` 第一行就是：
```
if (TRTC_PURE_SCHEDULE_POSITION && isTrtcBoardLine(ln)) return false;
```
`TRTC_PURE_SCHEDULE_POSITION = !OFFICIAL_ROSTER_ENABLED`（`4342`/`4345`），而
`trtcOfficialRosterEnabled()` 只有 `?officialroster=1` 才回 true ⇒ 預設 **true**。

實測（不是讀程式碼推論，是在正式站對每條線每個活躍班次呼叫既有全域函式量的）：

- `metroLiveOn(ln)`：兩支探針合計 88 輪 × 7~9 條有 board 的線，**值集合恆為 `[false]`**。
- 沒配到的班次（`board.shifts.has(tr) === false`）的 `metroShiftSec(ln,tr)` **實際輸出**：
  357 個「線 × 取樣」中 **335 個全 0**；剩下 22 個非零的全部是**單調衰減的殘留**
  （−145 → −141 → −137 → −133 …，約 +0.75 s/s，正是 `easedShift` 的 rise 上限），
  跟當下的 `all` 完全無關。
- 「沒配到的班次拿到 ≈ `all`」的次數（|all|>100 且差 <5 秒）：**0 次**。
  O_XINZHUANG 的 all 衝到 1736 那一輪，該線 4 個沒配到的班次輸出全是 0。

⇒ 原發現宣稱的傷害路徑，在現行出貨版本上**沒有任何一次發生**。

### 這是不是「量在下游／同源」？
不是。`all` 是驅動量、`metroShiftSec` 的回傳值是它唯一的出口，我量的是出口本身；
另外用一條**獨立判準**交叉驗證：把 `freqTrainPosAt`（渲染真值）與純班表
`freqTrainPosRaw(ln,tr,rosterTime)` 逐班比 haversine——若 `all` 真的被套上去，
沒配到的車會整批偏離班表 `all` 秒對應的距離。實測沒有這種整批偏移（見第 5 節）。

## 4. 提出的修法會退掉東西

1. **打錯目標**。同一份資料裡，**已配到**的班次自己的 shift 就散在 −483…+994 秒（Y）、
   −402…+65（R）。把「沒配到 → 給 0」改掉，留下的仍是每台配到的車各自被拖 8~16 分鐘。
   誤差主體不在退路值。
2. **與既有理由相衝**（`index.html:17319-17320` 原註解）：給 0 等於宣告「這班準點」，
   同一時刻整線一起誤點時，沒配到的車會與旁邊配到的車錯開 → 疊車／穿越（issue17 家族）。
3. **現行出貨版已經比它更強**：`metroLiveOn` 對北捷回 false ⇒ **配到的、沒配到的一律 0**。
   「配不到給 0」是未來要恢復校正時的設計選項，不是現在的缺陷修復。

## 5. 順手抓到的**另一個**真缺陷（不是本發現，不要混為一談）

「純班表」這個修法有個後門：`applyTrtcBoard` **直接寫 `_easedShift`**，完全不經 `metroLiveOn`：

`index.html:17871-17873`
```
const ek = trtcEasedMotionKey(ln, tr, physicalKey), old = _easedShift.get(ek);
if (old) { old.cur = visualShift; old.sim = motionSec; old.at = performance.now(); }
else _easedShift.set(ek, { cur: visualShift, at: performance.now(), sim: motionSec, ep: _metroGateEp.ep });
```
而 `easedShift`（`16774`）在 **entry 已存在時不看 target 是不是 0**，只做速率鉗制的衰減。
於是 `metroShiftSec` 雖然 target=0，仍持續回傳非零值。實測（`probe_eased.json`，40 輪）：

- `_easedShift` 裡的 `mrt:` key 在觀測期間從 19 個長到 35 個，值持續被刷新（4 秒 +1.4）。
- `metroShiftSec` 對北捷的輸出 **1067/3806 次非零**，最大 265 秒（Y）。
- 渲染位置 vs 純班表的偏離：Y 最大 **1.07 km**、BL 0.91 km、G 0.55 km、O_XINZHUANG 0.50 km。
- 5 秒步進 3498 筆中有 7 筆 >0.5 km，含一筆 **−1.09 km（倒退）**；p50 0.048 km、p99 0.144 km。

**這條只影響「配到的」班次、用的是各車自己的 `visualShift`，與 `_trtcBoard.all` 無關。**
使用者回報的「倒退跑」若在 v0817c 之後仍存在，這裡才是要查的地方。

## 6. 未確定點

- 觀測時段為凌晨 03:06–03:16（離峰），配到的班次數少（n=5~15），`all` 的雙峰翻面
  在尖峰樣本較多時是否仍這麼劇烈，本輪沒量。
- 第 5 節那條缺陷我只做到「量出偏離」，沒有做控制組（需改本機副本源碼），
  所以「拿掉 17871-17873 那三行偏離就歸零」屬**未驗證**推論，不要當結論用。
- 若未來把 `TRTC_PURE_SCHEDULE_POSITION` 翻回去（恢復校正），第 3 節的實測結論即失效，
  17321 那條路徑會重新變成活的——原發現屆時要重新評估，但屆時的主要誤差來源仍應先看
  「配到的班次自己的 shift 為何散到 ±8~16 分鐘」。

## 檔案

- `docs/audit-20260817/probe_all.mjs` / `probe_default.json`（48 輪，all / shifts / metroShiftSec 分群輸出 / 位置）
- `docs/audit-20260817/probe_eased.mjs` / `probe_eased.json`（40 輪，_easedShift 全表 + 位置 vs 純班表偏離）
- `docs/audit-20260817/probe_who.mjs` / `probe_who.json`（找出誰在寫 _easedShift）
- `docs/audit-20260817/summarize.mjs`
