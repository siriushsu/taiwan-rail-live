# 對抗式複核：applyTrtcBoard 繞過 metroLiveOn 寫 _easedShift

日期 2026-08-17 10:57–11:00（台北）
結論：**推翻失敗，發現成立**（因果鏈已用「只動資料、不覆寫函式」的差分實驗獨立驗證）。

## 0. 先證明我讀的是出貨樹（judgment 心得 38）

- 正式站 `curl -H 'Cache-Control: no-cache'` → `md5 = ba2f3b5694f07e4d8bcf4bb955b89b72`、`BUILD = 'v0817c'`
- 本 worktree `HEAD = d5ff87d`、`index.html` 同 md5、22904 行 → 逐 byte 相同。

## 1. 靜態鏈（全部逐行核對過）

| 位置 | 內容 |
|---|---|
| index.html:4342-4345 | `OFFICIAL_ROSTER_ENABLED = trtcOfficialRosterEnabled(location.search)`；`TRTC_PURE_SCHEDULE_POSITION = !OFFICIAL_ROSTER_ENABLED` |
| index.html:16946 | `if (TRTC_PURE_SCHEDULE_POSITION && isTrtcBoardLine(ln)) return false;`（metroLiveOn 對北捷九線恆 false） |
| index.html:17313-17333 | `metroShiftSec`：`on=false` ⇒ `target` 恆 0，但 **`dch` 照樣算成 `'track:'+physicalKey`**（分支條件是 `ln._trtcTripMode`，不是 `on`） |
| index.html:16774-16781 | `easedShift` fast path：無 entry 且 `target=0` ⇒ 直接 return 0、**不建 entry** |
| index.html:17969 | `else if (validBoardPos) applyTrtcBoard(...)` ⇐ **applyTrtcBoard 只在 `OFFICIAL_ROSTER_ENABLED===false` 時跑，也就是只在純班表模式下跑** |
| index.html:17871-17873 | `const ek = trtcEasedMotionKey(ln, tr, physicalKey), old = _easedShift.get(ek); if (old) {...} else _easedShift.set(ek, {cur: visualShift, ...})` ← **零閘門** |
| index.html:5273 | `freqTrainBaseAt`：`const sh = metroShiftSec(ln, tr); const shifted = clamp(rosterTime - sh)` ⇒ 位置真的被移 |
| index.html:17148 | `trtcBoardPosition`：`if (!rec || !metroLiveOn(ln) ...) return null` ⇒ 錨點側**有**閘門（所以 anchored 全 0，符合原回報） |
| index.html:18129 | `setInterval(pollTrtcLive, 15e3)` |

`trtcEasedMotionKey`(16977-16980) 與 `metroShiftSec` 的 key 組法逐字相同（`freqSysIdOf(ln)+':'+ln.id+':track:'+physicalKey`）——**已用實測比對確認同一把 key**（見下 §2 的 `ek`/`ent` 欄）。

推論：純班表模式下 `easedShift` 自己不可能建 entry（target 恆 0 走 fast path），`trtcBindPhysicalIdentity`(16991) 只複製既有 entry，因此 **17873 是唯一可能的來源**。

## 2. 實測（正式站 v0817c，headless chromium，`docs/audit-20260817/probe2.mjs`）

九條北捷線 `metroLiveOn` 全 `false`、`TRTC_PURE_SCHEDULE_POSITION=true`、`anchored` 全程 0 台。

| 快照 | 時刻(UTC) | `_easedShift` keys | \|shift\|>0.5s 的車 | 畫出位置 vs 純班表 最大偏離 | 畫出位置 vs 「班表−shift」最大偏離 |
|---|---|---|---|---|---|
| t0（開機、第一輪 poll 前） | 02:57:02 | 0 | **0 / 99** | **0.0 m** | 0.0 m |
| t20（一輪 poll 後） | 02:57:22 | 42 | 18 / 99 | **1685.8 m** | 0.0 m |
| 清空 `_easedShift` 後立刻量 | 02:57:22 | 0 | **0 / 99** | **0.0 m** | 0.0 m |
| 再等一輪 poll | 02:57:44 | 46 | 23 / 98 | **1147.5 m** | 0.0 m |

關鍵讀法：
- **`dDrawnShifted` 在四個快照、全部 99 台上恆為 0.0 m** ⇒ 畫出的位置精確等於 `freqTrainPosRaw(clamp(rosterTime − metroShiftSec))`。headway gate、官方錨點都沒有貢獻，偏離 **100% 來自 shift**。
- **`zeroShiftButOffset` 恆為 0** ⇒ 沒有「shift=0 卻偏離」的車，反向也成立。
- t0 與「清空後」是兩個**真正的控制組**（同一組函式、同一批車、只有 `_easedShift` 這份資料不同）：偏離精確歸零。這不是同源自比。
- 18/18、23/23 非零 shift 的車 **全部** `endpoint=true`、`pk` 有值、`ent === sh`（entry 值與 metroShiftSec 回傳值逐位相同）。BR（文湖線）`nPos=0` ⇒ 沒有 endpoint ⇒ 沒有一台被污染，與「無 endpoint 就沒事」一致。

## 3. 寫入者身分（`docs/audit-20260817/probe3.mjs`）

沒有覆寫任何頁面函式（那是無效實驗）。改為 instrument **`_easedShift` 這顆 Map 實例自己的 `.set` 方法** ——所有呼叫端都走同一顆物件，一定攔得到——再 `clear()` 後觀察 25 秒：

- 18 次 `mrt:` key 的寫入，**唯一堆疊**：
  `applyTrtcBoard (https://railisland.tw/:17873:24)` ← `pollTrtcLive (https://railisland.tw/:17969:35)`
- 沒有任何其他寫入者。

`metroMotion` 實測 `maxRate`：BL 1.373、R 1.331、G 1.329、O_XINZHUANG 1.339、**O_LUZHOU 1.459**、BR 1.382、Y 1.332（R_XBT/G_XBT 1.91）。⇒ 衰減側每模擬秒只還 `maxRate−1` = 0.33–0.46 秒，而 poll 每 15 秒重播一次。

## 4. 三個必查項

**(a) 證據是否量在被測物下游／同源？** 否。`freqTrainPosAt` 就是 draw loop（index.html:6185）用的那支；`freqTrainPosRaw(ln,tr,rosterTime)`（不減 shift）是「純班表位置」的定義本身，不經過 `metroShiftSec`。而且有兩個歸零控制組。

**(b) 有沒有更簡單的解釋？** 逐一排除：
- 讀錯樹／版號過期 → md5 逐 byte 相同（§0）。
- 環境條件（本機缺 token 之類）→ 量的是正式站真實流量，t0 已證明同一環境下偏離為 0。
- 判準過期 → 判準是「畫出的點與班表點的大圓距離」，是幾何事實不是釘死的期望值。
- 別的位移來源（headway gate / 官方錨點 / 疊車避讓）→ `dDrawnShifted ≡ 0`、`anchored ≡ 0` 直接排除。
- 開機殘留 → 清空後又長回來，且每 15 秒重播。

**(c) 修法會不會退掉別的東西？** 這裡要訂正提出者：
- **提出的 A 案（`if (!TRTC_PURE_SCHEDULE_POSITION)`）事實上等於刪掉那三行**：applyTrtcBoard 只在 17969 的 `else` 分支被呼叫，也就是**只在 `OFFICIAL_ROSTER_ENABLED===false` 時跑**，而該旗標恰恰定義 `TRTC_PURE_SCHEDULE_POSITION`。條件在該處恆真。能用，但語意誤導，且哪天兩個旗標解耦就會出錯。
- **提出的 B 案（`metroShiftSec` 在 `!metroLiveOn(ln)` 直接 `return 0`）會造成回歸**：`metroLiveOn` 也管**非北捷**系統（krtc / klrt / tymc / ntmc）與 `metroLiveGate()`（時間旅行、快轉）。目前 live 轉 stale 時是靠 `easedShift` **平滑衰減**回 0；改成硬 `return 0` 會讓那些線在資料超過 30 分或使用者撥時鐘的瞬間**整批瞬移**（幾百公尺到數公里），正好打掉 easedShift 存在的理由，也踩到「位置恆不倒退／不亂跳」那條長期契約。
- **最小且對稱的修法**：把 17871-17873 的寫入閘門改成 `metroLiveOn(ln)`（與 17148 `trtcBoardPosition` 同一道閘門）。live 開著時逐字等價，live 關著時結構上不可能建 entry。
- 順帶：`metroShiftSec` 也餵**車站看板倒數**（index.html:19506、19686）。19506 對「官方看板已涵蓋的方向」會 early-return 走官方值，但未涵蓋的方向仍會吃到這個殭屍 shift ——本發現的影響面比原回報再大一格（原回報只講位置）。

## 5. 未確定點 / 誇大之處（不影響結論）

- 原文「衰減每模擬秒只還 0.33–0.38 秒」低估：O_LUZHOU 實測 0.459。方向一致。
- 原文「永遠回不到 0」過強：一台車脫離 endpoint 後就不再被重播，會衰減到 0；成立的是「只要它還在 endpoint 覆蓋範圍內就每 15 秒被重播」。
- 原文「index.html:3839 更新紀錄那句目前是假的」——精確說法是：對**當下有 endpoint 的那 18–23 台（約兩成）** 為假，其餘八成確實是純班表。最大偏離本次量到 1685.8 m，比原回報的 940 m 更大。
- 本次量測時段為週一 10:57 離峰前，尖峰時 endpoint 覆蓋率可能更高，污染比例只會更大不會更小。

## 產物

- `docs/audit-20260817/probe2.mjs`、`probe3.mjs`（可重跑）
- `docs/audit-20260817/snaps.json`（四個快照逐車原始資料）
- `docs/audit-20260817/setlog.json`（寫入者堆疊）
