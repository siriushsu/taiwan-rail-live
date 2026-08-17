# 對抗式複核：「配不到看板退回全線中位數」——判定 REFUTED

日期 2026-08-17 約 10:50–11:00，正式站 https://railisland.tw （BUILD `v0817c`，md5 `ba2f3b5694f07e4d8bcf4bb955b89b72`，與 worktree HEAD `d5ff87d` 同內容）。
探針：`docs/audit-20260817/probe_median_fallback.mjs`（量 `metroShiftSec()` 回傳的驅動量本身，未覆寫任何頁面函式）。
原始輸出：`out_roster0.json`、`out_roster1.json`。

## 一、程式碼引用正確，但「影響」不成立：該路徑在出貨版是死碼

`index.html:17321`
```js
if (ln._trtcBoard && on) { const v = ln._trtcBoard.shifts.get(tr); target = v != null ? v : ln._trtcBoard.all; }
```
兩個必要條件 `ln._trtcBoard` 與 `on = metroLiveOn(ln)` 在出貨版的**兩種可達組態下互斥**：

| 組態 | `_trtcBoard` | `metroLiveOn` | 17321 可達？ |
|---|---|---|---|
| 預設（`OFFICIAL_ROSTER_ENABLED=false`，PURE=true） | 有（`applyTrtcBoard` 有跑） | **false**（`index.html:16946` `if (TRTC_PURE_SCHEDULE_POSITION && isTrtcBoardLine(ln)) return false;`） | 否 |
| `?officialroster=1`（PURE=false） | **無**（`index.html:17968` 走 `applyTrtcOfficialRoster` 後 `clearTrtcBoard()`） | false | 否 |

`_trtcBoard` 的唯一寫入者 `applyTrtcBoard` 的母體是 `filter(ln => isTrtcBoardLine(ln) && ...)`，
與 16946 的排除條件**同一個 predicate** ⇒ 凡有 `_trtcBoard` 的線必被 16946 判 false。無縫隙。

實測（roster0，預設）：九條北捷線 `liveOn` 全為 `false`；`boardAll` 分別 176/48/388/50/79/34/37，
而同線每一台名冊車的 `metroShiftSec` 回傳值**沒有任何一台等於 boardAll**，未配到的車全部為 0：

```
BR  boardAll=176 unmatched=9  driveShift 全 0（n=20）
O_XINZHUANG boardAll=50 unmatched=4 driveShift 全 0（n=11）
BL  boardAll=34  unmatched=4  driveShift 0/12/48/20/…（皆非 34）
```
實測（roster1）：全線 `hasBoard=false`、`boardAll=null`、`driveShift` 全 0（n=97）。

⇒ 「沒配到的車也被拖 1611 秒」在出貨版**無法發生**。提出的修法（中位數健全性閘門）是 no-op。

## 二、「整群都錯、中位數忠實反映錯的那群」也與實測分佈相反

實測 `_trtcBoard.shifts` 的值分佈是**清楚的雙峰**，不是整群偏移：

```
O_XINZHUANG: [-9, -3, 13, 50, 1736, 1764, 1784]     4 乾淨 + 3 汙染(≈3 個班距)
BL:          [-5,-5,17,20,25,25,28,34,53,55, 536,571,577,581,599]  10 乾淨 + 5 汙染(≈1 個班距)
R:           [3,18,18,36,44,48,50, 538,554,578,580]  7 乾淨 + 4 汙染
G:           [20,25,40,59,67, 388,457,497,509,524]   5 乾淨 + 5 汙染
BR:          [121,127,127,147,147,176, 364,405,689,1550,1791]
```
七條線裡有五條的中位數落在 34–79 秒（乾淨群），這正是「離群值只汙染了一部分」的典型形狀；
汙染值群聚在 ~536–599（一個班距）與 ~1736–1791（約三個班距），是**配錯 N 個班距**的離散誤差，
不是整條線一起誤點。原敘述引的「534–1744」本身就橫跨兩個不同的錯誤群，
用「整群都錯」概括不成立；那一輪之所以中位數是 1611，只是汙染子集恰好過半。

## 三、修法的副作用（就算把路徑打開也一樣）

1. 閘門殺的是**未配到**的車，被畫錯最兇的是**已配到卻配錯**的那 3–5 台（1736–1791 秒），
   閘門完全不碰它們 ⇒ 症狀留著，卻會給人「已修好」的錯覺。
2. 「|median| 超過半個班距 ⇒ 整線回 0」在汙染剛好過半時，會把 BL 那種
   10 個乾淨值（中位 34 秒）算出來的好中位數一起丟掉。分佈既然是雙峰，
   正解是**逐值剔除**（先丟掉 > 半個班距的值再取中位），不是整線 kill switch。

## 四、順帶量到的、真正還活著的洩漏（與本發現無關，另案）

`index.html:17871-17873` 在 `applyTrtcBoard` 裡**直接寫 `_easedShift`**：
```js
const ek = trtcEasedMotionKey(ln, tr, physicalKey), old = _easedShift.get(ek);
if (old) { old.cur = visualShift; ... } else { _easedShift.set(ek, { cur: visualShift, ... }); }
```
這條**不經過 `metroLiveOn`**。實測預設（PURE=true、應為純班表）仍有 14/99 台名冊車的
`metroShiftSec` 非 0：R 線最大 46 秒、Y 線一台 −381 秒（Y 的 `boardValues` 裡正有 −391）。
即「純班表」目前不是真的純班表，官方 per-train `visualShift` 仍從 eased 種子滲進位置。
注意這洩漏的是**逐車 visualShift，不是 `all`**，所以不能拿來救原發現。
