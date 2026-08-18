# 對抗式複核：「ref 與判準同源 ⇒ 錯一次就永久自洽」

複核時間 2026-08-17 10:54–11:05（台北）。全程唯讀，未改任何產品檔、未 commit、未部署。
使用資產：`/tmp/trtclive_mine.json`（正式站 `/api/trtc-live` 快照，`boardPos.at=1786935266`）、
`/tmp/rk_poll/s01..s09.json`（3 分鐘連續輪詢）、`docs/audit-20260817/rk_ledger_traced.mjs`
（`scripts/trtc_board_ledger.mjs` 的逐候選拒絕原因插樁副本，唯一行為差異＝可切換 cost 函式）。

## 結論

**核心缺陷成立**（我用自己的對照實驗獨立重現），**但提出者指認的機制與修法都是錯的**。

| 子主張 | 判定 | 證據 |
|---|---|---|
| ref＝同 line\|dir 20 分鐘窗內綁定的 lastShift 中位數 | ✅ 屬實 | `trtc_board_ledger.mjs:1004-1013`、`:812` |
| 出生 cost=\|shift−ref\|，上限 600 | ✅ 屬實 | `:1140-1144`、`:814` |
| 安全閥比 \|lastShift−ref\|，群體同量偏移下恆 ≈0 ⇒ 永不觸發 | ✅ 屬實且是「永久」的真正成因 | `:1017-1024`；實測見下 |
| 準點的車在結構上綁不回正確班次 | ✅ 重現 | 實驗 B/C/F/I |
| **阻擋者是 cost 同源上限（capped）** | ❌ **不成立** | 實驗 B `capped=0`；全網統計 capped 只佔 4% |
| **修法：cost 錨點改成與班表的絕對距離** | ❌ **實測無效且會退掉東西** | 實驗 C/F/I |
| 引用的 `ref=median(1611,1656,1708,1744)=1682` | ⚠️ 數字來自捏造輸入 | payload 不帶 `boundEpoch` |

## 一、缺陷本身：確認（我自己的對照實驗）

同一份瞬時資料，只改「先前狀態」這一個變因：

- 現況原樣重放：`O_XINZHUANG|1` 六台 shift = `[1662,1732,1736,1780,1782,1785]`，
  `capped=0 evictedSafety=0`，穩定不動。
- 只清掉該 dir 的 prior（實驗 E）／整線冷啟動（實驗 D）：同一批 track 立刻綁成
  **`[-18,-8,-4,40,42]`**——班表上此刻 roster-active 恰好 5 筆，與 5 台車一一對上。

⇒ 資料本身容得下一組準點解，是「先前狀態」把它鎖住的。

**這組 +1750 確定是錯的，不是真誤點**（排除「更簡單的解釋」）：
1. 同一條線 `O_XINZHUANG|2` 同時只有 +9；`O_LUZHOU|1` +1172 而 `|2` +12。中和新蘆兩支的
   實體列車在幹線共用、終端折返——同一批車不可能單向誤點 29 分鐘而反向準點。
2. `/api/metro-alert` 當下臺北捷運「正常營運」。
3. 班表發車間隔 540–600s，1750 ≈ **3 個班距**——是整數格位移，典型的鎖定特徵。

**「永久」也確認，而且不是 harness 假象**：正式站連續輪詢 3 分鐘（`/tmp/rk_poll/`），
`O_XINZHUANG|1` 全程維持 1683–1807，期間 **新生一台車（trip `38460@…`）直接以 shift=1764 出生**
——新世代繼承偏移，這是線上實況，不經任何 harness。

## 二、被推翻的部分（提出者的機制與修法）

### 2.1 阻擋者不是 capped

插樁逐候選記錄拒絕原因。拿掉 `O_XINZHUANG|1` 一台車的綁定後（＝實驗 D1 的形狀）：

```
occupied ×3（正確班次被同群偏移的鄰居佔著）
tooEarly ×2（shift −1818 / −2418，禁早發 −90 擋下）
capped   ×0        ← 提出者指認的機制，一次都沒觸發
```

連 D2 的形狀（**連正確班次也讓出來**）也一樣：正確候選 `20@36720>0@39517 shift=−18` 被
**`noReversal`**（§5.1(b) 與同群偏移鄰居比修正後發車時刻）擋下，`capped` 仍為 0。

全網掃描（實驗 I：對 84 筆綁定逐一拿掉再放回）：
非結構性淘汰 `occupied=343, tooEarly=68, noReversal=20, **capped=18**`——capped 佔 4%。
17 台 |shift|>600 的「鎖住」中，8 台綁得回來但**都綁回原本那個錯的 shift**
（1782→1782、1178→1178…），沒有一台回到準點。

⇒ 真正的鎖鏈是 **occupied（鄰居佔住正確格）→ tooEarly／noReversal（唯一出口被封）→
安全閥同源（唯一解鎖路徑瞎掉）**。cost 上限只是配角。

### 2.2 提出的修法無效，而且會退掉東西

把 cost 換成 `|shift|`（＝「與班表的絕對距離」）後：

- 實驗 C（D1 形狀）：結果**與原 cost 逐字相同**，目標仍 UNBOUND。
- 實驗 F（D2 形狀）：目標仍 UNBOUND，而且該 dir 綁定從 5 台掉到 4 台、`unbound 2→3`。
- 實驗 I（全網 84 筆）：**綁得回來 67→63，綁不回來 17→21，capped 18→28，可用候選 83→73。**
  原因：偏移群自己的 re-bind 被 `|shift|>600` 打掉，但準點格仍被 occupied/tooEarly 封著
  ⇒ 車不是回到準點，是直接失去綁定（失身分）。

⇒ 只換 cost 錨點是**淨負**。真正有效的是提出者附帶的第二項（群體同量偏移偵測）：
實驗 E 證明只要讓那一群同時鬆綁，同一份資料立刻收斂到準點。

### 2.3 引用的數字建立在捏造輸入上

`boardPos.trips[]` 只有 `line/dir/key/trackId/shift/eta`——**沒有 `boundEpoch`**
（`worker.js` 只把它寫進 D1 `trtc_state.trip_dyn` 與 `trtc_trip_bindings.bound_epoch`）。
而 ref 的成員資格**完全由 `boundEpoch` 決定**（`:1008`，窗 1200s）。
`exp_ref_lock.mjs` 與我的第一版都用 `boundEpoch = nowEpoch − 60` 捏造，等於強迫全部進窗。

敏感度實測（`rk_probe3.mjs`）：
- 全體年齡 60s（捏造值）：badStreak 恆 0，`evictedSafety=0`，十輪不動——複製出提出者的結論。
- 全體年齡 3600s（出窗）：ref 變 0 ⇒ badStreak 1→2→3→**第 4 輪 `evictedSafety=6`**，
  隨即重綁成 `[-18,-8,-4,40,42]` 並穩定。**結論整個翻面。**

我另補了一個有依據的年齡模型（`rk_probe4.mjs`：每筆的出生時刻＝其綁定班次發車秒＋shift，
交錯分佈 0/166/764/1410/1954/2564s）。這是線上真實形態，實測 **10 輪 `evictedSafety=0`**
——因為最年輕的三筆本身就帶著同一個偏移進窗，ref 仍是 1782。
⇒ 結論在真實年齡下**仍然成立**，但提出者給的那條證據鏈不成立，要換成這一條。

## 三、影響面（供裁量嚴重度）

正式站現在 `TRTC_PURE_SCHEDULE_POSITION = !OFFICIAL_ROSTER_ENABLED`（index.html:4345，官方名冊預設關）
⇒ `metroLiveOn()` 對北捷線回 false，**畫面位置目前不吃這個 shift**（站上公告「列車位置暫時改用班表推估」）。
但 `applyTrtcBoard(...)` 仍在跑（index.html:17969），`boardPos.trips` 仍用於**車號／身分**指派——
偏移 3 格的綁定＝把 29 分鐘前那班的車次貼到這台車上。

## 四、附帶未確定點

- D1 的 `trtc_trip_bindings.bound_epoch` 我沒查到（MCP query 被權限攔下），
  年齡模型是從 `key` 的發車秒＋shift 反推的，屬推導不是實測。
- 我的 harness 用 `boardPos.rows` 當 tracks（沿用 exp_ref_lock 的做法），不是真正的
  `claimBoardRows→collapseClaims` 產物；tuple join 84/84 全中，但這仍是近似。
- 3 分鐘輪詢只涵蓋一個時窗；「跨整個營運日永不恢復」我沒有驗到。

## 檔案

- `docs/audit-20260817/rk_ledger_traced.mjs`（插樁副本）
- `docs/audit-20260817/rk_probe.mjs`（實驗 A–E）
- `docs/audit-20260817/rk_probe2.mjs`（實驗 F：D2 形狀 × 兩種 cost）
- `docs/audit-20260817/rk_probe3.mjs`（boundEpoch 敏感度）
- `docs/audit-20260817/rk_probe4.mjs`（交錯年齡＝真實形態）
- `docs/audit-20260817/rk_probe5.mjs`（全網 84 筆逐一拿掉重放）
