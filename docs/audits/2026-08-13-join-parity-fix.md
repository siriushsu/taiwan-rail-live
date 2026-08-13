# 2026-08-13 `joinBoardRowsToTrips` parity 修正

## 1. 改法與理由

末段不再用計數器把重複 `tripKey`／`trackId` 的列全部刪掉，而是先建立 `trackId → fullKey` 與
`fullKey → trackId` 的雙向關係：只有任一側連到兩個不同身分，才視為後端身分資料損壞並
fail closed；同一個 `(fullKey, trackId)` 下有多筆不同站點預報，則視為正常的「一台車多站預報」。
active binding 建表前原有的一對一檢查也保留，所以損壞 binding 在更早一層就會整組拒絕。

正常多站預報的勝者取 `arrEpoch` 最小者，理由是最早到站的預報離列車當下最近，對動畫是最即時
的官方約束。若 `arrEpoch` 完全相同，再以輸出完整內容的 canonical tuple 做 total-order
tie-break；最後整個輸出陣列也按 `(fullKey, trackId)` 排序。所有排序鍵都只來自列內容，不讀
陣列索引，因此同批 `rows` 任意洗牌仍逐筆相同。`bestCount === 1` 的無號列並列拒絕未改動。

## 2. A–E 改前／改後

| 判準 | 改前（`4f76966` drop-all） | 改後 | Mutation control |
|---|---:|---:|---:|
| A production parity | 17 輪、1,473 個可比較 trip-round 身分中，`only production=64`、`only replay=0`，0/17 輪完全涵蓋 | `only production=0`、`only replay=0`、選中 tuple 不在 production=0，17/17 輪完全涵蓋 | M-A 改回重複全丟：`only production=64`，紅 |
| B 決定性 | 20 輪 × 24 次＝480 次洗牌，逐筆陣列 480 次不同（舊版輸出次序跟著 rows） | 480/480 相同，差異 0 | M-B 改取陣列第一列：416/480 次不同，紅 |
| C 身分唯一 | 20 輪輸出 1,669 筆；重複 `trackId=0`、重複 `fullKey=0` | 20 輪輸出 1,743 筆；重複 `trackId=0`、重複 `fullKey=0` | M-C 允許重複：1,817 筆中兩側各 74 個超額重複，紅 |
| D 損壞輸入 fail closed | 2 個 trip 共用 1 個 `trackId`、配 2 列，輸出 0 | 同一 fixture 輸出 0 | M-D 同時拆掉前後兩道一對多防線：輸出 2，紅 |
| E 既有零回歸 | 基底未在本輪環境重跑完整 E2E；不可編造通過數 | 指定 4 支完整命令均跑到環境邊界，0/4 得到 exit 0；在邊界前未出現本次 join 的語意紅燈 | A–D 新 gate 與 4/4 mutation controls 完整 exit 0 |

20 輪原始輸出筆數另列：回歸版 1,669，修正版 1,743（恢復 74 個唯一身分），拆掉 filter
但允許重複為 1,817，`origin/main` 重播為 1,818。修正版刻意只給每個身分一列，所以不能拿
1,743 與舊版含多站重複的 1,818 當成同一定義的 coverage；A 的主判準以唯一 trip-round 身分
集合比對，並另外要求修正版挑中的完整 tuple 必須確實存在於 production payload。

Production fixture 有兩類不相容樣本，未混稱為「全部是時差」：

- 04、15、17 輪即使用 `origin/main` 舊 join 配同一份落盤 dyn，也無法重現 production tuple，
  因此不能拿來裁決新 join。04：`dyn.at=1786593935`、`boardPos.at=1786593935`、HTTP
  `at=1786593941.056`，舊重播 `only production/replay=2/10`；15：`1786594295`、
  `1786594280`、`1786594292.860`（dyn 明確比 board 新 15 秒），差異 `1/6`；17：
  `1786594355`、`1786594355`、`1786594362.726`，差異 `2/7`。04/17 的時間戳只足以證明
  fixture 落在同一 cron 秒附近，無法再區分是 transaction 邊界或 HTTP 快取版本；排除依據是
  舊 production 程式本身已不能忠實重播，不把它們硬歸因給本次演算法。
- 其餘 17 輪中，02 輪有 1 個 production 身分是舊版「同分取陣列第一個」產物；新版本依明示
  要求保留 `bestCount === 1`，故將它排除於本次 uniqueness parity 的可比較池。若不排除，
  修後對完整 production 身分集合是 1,473/1,474、16/17 輪完全一致；排除這一筆後才是上表
  的 `only production=0` 與 17/17。跨全部 20 輪的原始身分集合則為 16/20 輪一致、
  `only production=3`、`only replay=19`，其中包含上述三輪 snapshot 不忠實差異。

E 的完整命令與失敗邊界如下；沒有一支被假設通過：

- `node scripts/verify_trip_binding.mjs`：exit 1。R1/R2/R3/R7a/R7b/R8/R11/R12/R13/R14/R5/HG、
  R10（含新多站決勝）全綠；其內嵌 `verify_board_ledger` 因 `listen 127.0.0.1:43187`
  得到 `EPERM`，R4 又因禁止 git 寫入，`git worktree add --detach ...` 無法寫 `.git/worktrees`。
- `node scripts/verify_board_ledger.mjs`：exit 1。純函式 V2–V8 全綠，啟 fixture server
  `127.0.0.1:43187` 時 `listen EPERM`。
- `node scripts/verify_trtc_ontime.mjs`：exit 1。join／poll／trackId 等前置靜態 gate 全綠，
  啟 `127.0.0.1:6740` 時 `listen EPERM`。
- `node scripts/verify_trtc_direct_board.mjs`：exit 1。瀏覽器前的純函式／靜態 gate 全綠；
  Playwright Chromium 啟動因 macOS MachPort `Permission denied (1100)` 中止。
- 額外依派工說明執行 `node scripts/verify_trtc_motion_round2.mjs`：exit 1；預設基準
  `/Users/xuxiang/Code/軌島-北捷運動-基準/index.html` 已不存在（`ENOENT`）。未改期望值。

## 3. 逐線接上率

下表只用 17 輪能由 `origin/main` 忠實重播 production tuple 的樣本。每格第一個數字是主要
可比較指標「production 唯一身分覆蓋」；括號是診斷用的「輸出列／live rows」。舊版可對同一
身分輸出多個站點列，所以括號中的 `origin/main` 數字可高於唯一身分數，不應拿來要求修正版
也輸出重複。

| 線 | 修復前 | 修復後 | `origin/main` |
|---|---:|---:|---:|
| BL | 100.0%（296/296）；82.5%（296/359） | 100.0%（296/296）；82.5%（296/359） | 100.0%（296/296）；82.5%（296/359） |
| BR | 88.6%（257/290）；58.9%（257/436） | 99.7%（289/290）；66.3%（289/436） | 100.0%（290/290）；73.9%（322/436） |
| G | 98.8%（168/170）；83.6%（168/201） | 100.0%（170/170）；84.6%（170/201） | 100.0%（170/170）；85.6%（172/201） |
| G_XBT | 100.0%（13/13）；40.6%（13/32） | 100.0%（13/13）；40.6%（13/32） | 100.0%（13/13）；40.6%（13/32） |
| O_LUZHOU | 96.2%（127/132）；77.4%（127/164） | 100.0%（132/132）；80.5%（132/164） | 100.0%（132/132）；83.5%（137/164） |
| O_XINZHUANG | 97.7%（130/133）；66.7%（130/195） | 100.0%（133/133）；68.2%（133/195） | 100.0%（133/133）；69.7%（136/195） |
| R | 93.7%（283/302）；78.6%（283/360） | 100.0%（302/302）；83.9%（302/360） | 100.0%（302/302）；89.2%（321/360） |
| R_XBT | 100.0%（33/33）；97.1%（33/34） | 100.0%（33/33）；97.1%（33/34） | 100.0%（33/33）；97.1%（33/34） |
| Y | 97.1%（102/105）；58.6%（102/174） | 100.0%（105/105）；60.3%（105/174） | 100.0%（105/105）；62.1%（108/174） |

BR 修後仍少的 1/290 正是上節明列、依要求保留的 `bestCount === 1` 同分拒絕，不是 uniqueness
filter 尚未恢復。

## 4. 未處理的邊界與風險

- 最早 `arrEpoch` 的挑法依賴上游已把過期／無效看板列濾掉；`joinBoardRowsToTrips` 本身沒有
  `boardPos.at`，若未來呼叫端把過期列混進來，最早一筆可能反而是 stale。要改成「離 now 最近」
  時應明確把觀測基準傳入，不可在純函式內用 `Date.now()`。
- `bestCount === 1` 刻意保留，因此 production 舊版順序決勝的 1 個身分不會恢復；這是已知、
  可區分於 uniqueness filter 的保守拒絕。
- 04／15／17 三輪不是忠實 replay fixture；本報告保留完整時戳與雙向差異，沒有用它們為 parity
  背書。若要把 20/20 都變成外部真值，擷取必須由 Worker 同一請求回傳實際使用的 dyn 版本戳。
- listener、瀏覽器、R4 D1 round-trip 與 motion round2 基準樹驗收都受本執行環境限制，尚未完成；
  部署前仍須由主對話在可啟 browser/listener、可用基準樹的環境補跑。
