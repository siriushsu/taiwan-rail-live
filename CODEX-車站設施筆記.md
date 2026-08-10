# 車站設施資料調查筆記

## 工作邊界

- 所有新建／修改只限本 worktree 的 `scripts/`、`data/` 與本筆記。
- `index.html` 僅唯讀；禁止任何 git 寫操作；TDX 憑證只從主樹 `.env` 讀入記憶體，不落地、不輸出。

## 已確認的既有接線規則

- 前端既有站名正規化函式是 `index.html` 第 10466–10468 行的 `transferStationName(name)`：先 `String(name || '').normalize('NFKC')`，再做 `臺→台`、去掉開頭的 `高鐵`／`台鐵`、依序去掉尾綴 `火車站`／`車站`／`站`，最後 `trim()`。
- 本次 fetch 與 verify 會逐字採用同一串轉換，避免另創規則造成查表失配。

## 待實測

- TDX TRA 與 Metro StationFacility 的實際可用版本、路徑、回應容器與四類設施欄位。
- 實際站數、四項完整度、StationOfLine 對接率；若整體只有約一成資料或語意不足以區分「沒有」與「未知」，依停止條件不產生正式資料。

## 2026-08-10 實測與來源盤點

### 實際成功呼叫

- 實際以 TDX 訪客 API 呼叫 `https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/StationFacility/TYMC?$top=30&$format=JSON`，取得 JSON array，共 22 站（A1–A22，含 A14a）。這不是文件範例，而是端點的即時回應；回應中的 `SrcUpdateTime` 為 `2026-03-13T00:00:00+08:00`、`UpdateTime` 為 `2026-07-17T04:45:12+08:00`、`VersionID` 為 474。
- 實際觀察到每站的頂層欄位：`StationID`、`StationName`、`FacilityMapURLs`、`Elevators`、`InformationSpots`、`DrinkingFountains`、`Toilets`、`SrcUpdateTime`、`UpdateTime`、`VersionID`。
- 設施陣列元素實際欄位為 `Description`、`FloorLevel`。22 站的實際回應完全未出現 `NursingRooms`，因此哺集乳室不能推成 `false`，只能是 `null`。
- 回應同時存在空陣列（例如多站的 `InformationSpots: []`）與明文無設施（A13 的 `DrinkingFountains`、`Toilets` 各有一筆 `Description: "無"`）。因此安全語意必須是：欄位缺失或空陣列 → `null`；至少一筆非「無」描述 → `true`；只有明文「無」→ `false`。把空陣列直接轉成 `false` 會違反需求並誤導使用者。

### 官方 schema／端點範圍

- HACKRAIL 的 TDX 資料指南也列出 Metro StationFacility schema：`Elevators`、`DrinkingFountains`、`Toilets`、`NursingRooms`，並提供 TYMC 的同一支 v2 端點。這與上述實際回應的前三項相符；`NursingRooms` 是 schema 可選欄位，不代表每個營運者或每站實際供應。
- TDX 目前「公共運輸－軌道 v3」官方 Swagger（識別碼 `5fa88b0c-120b-43f1-b188-c379ddb2593d`）只列 TRA 與 AFR tag；搜尋與資料開放平臺的 TRA API 清單只找到 Station、StationOfLine、時刻表、即時看板、通阻等，未找到 TRA StationFacility。故候選 `/v3/Rail/TRA/StationFacility` 沒有文件依據，不能拿來宣稱台鐵設施資料存在。
- 政府資料開放平臺另有北捷設施 CSV、鐵道局「各級鐵路車站基本設施」CSV 等非 TDX 來源，但任務明定從 TDX 抓取，且停止條件禁止用網路爬取資料補洞，因此未混入。

### 涵蓋分母與停止判斷

- 依 repo 現有 `data/tra_station_of_line.json` 與 `data/tdx/*_StationOfLine.json`，套用前端同一正規化後的唯一站數：TRA 242；TRTC 108；TYMC 22；TMRT 18；KRTC 38；KLRT 37；NTMC 14；NTDLRT 14；NTALRT 9；SANYING 12。台鐵＋各捷運／輕軌合計 514 站（另有 THSR 12，依需求列缺；AFR 不在「台鐵與各捷運」分母）。
- 目前唯一能以 TDX 實際回應確認的 StationFacility 是 TYMC 22 站，對 514 站只有 **4.28%**。把 HACKRAIL schema 另有明列、但本環境尚未成功取回的 TMRT 18 站全部算入，已確認＋有明確 schema 依據的範圍也只有 **40/514 = 7.78%**。這不是全體 TDX 的理論上限：其他營運者端點因網路限制尚未逐一取得 HTTP 回應，不能宣稱它們一定為空。
- 命令列網路在送出 HTTP 前即被 sandbox 阻擋：DNS 為 `ENOTFOUND`，直接連 IP 也被拒；in-app browser 此環境沒有可用 browser binding。TDX 訪客 API 的 TYMC 成功回應是透過唯讀網頁取用工具取得。因無法逐營運者取回 HTTP status，不能把其他營運者寫成「確認為空」；只能列為未確認／缺資料。
- 結論：已證實的完整度低於一成，而且此環境無法完成其餘端點的逐一實測，依 critical stop condition／verification loop 停手，不建立 `data/station_facility.json`、正式 fetch 或 verify 腳本。產一份只有 TYMC、或用非 TDX CSV 補洞，都會讓設施資訊在使用者的無障礙決策情境中看似完整而實際嚴重偏缺。

## 交付前檢查

- `git status --porcelain` 只有 `?? CODEX_NOTES.md`；`index.html` 逐 byte 未出現在 diff。
- 本 worktree 不存在 `scripts/*station_facility*`、探測暫存腳本或 `data/station_facility.json`。
- 以 `.env` 中兩個 TDX 憑證值逐字掃描本次留下的檔案，命中數為 0；掃描過程只輸出命中數，未輸出憑證內容。

---

## 主對話更正（2026-08-10，非 Codex 產出）

上面「已證實的完整度低於一成」**量的是 Codex sandbox 沒有網路**（它自己記錄了
`DNS 為 ENOTFOUND`），不是 TDX 的實況。主對話從有網路的環境用同一組憑證實打八個端點，
**全部 HTTP 200 有資料**，實際填充率是：

| 系統 | 站數 | Elevators | Toilets | DrinkingFountains | FacilityMapURLs |
|---|---|---|---|---|---|
| TRA 台鐵 | 245 | 245 (100%) | 0 | 0 | 245 (100%) |
| TRTC 北捷 | 121 | **0** | **0** | **0** | 108 (89%) |
| TYMC 機捷 | 22 | 22 (100%) | 22 (100%) | 22 (100%) | 22 (100%) |
| KRTC 高捷 | 39 | 37 (95%) | 37 (95%) | 37 (95%) | 39 (100%) |
| TMRT 中捷 | 18 | 18 (100%) | 18 (100%) | 18 (100%) | 18 (100%) |
| NTMC 環狀線 | 14 | 14 (100%) | 14 (100%) | 14 (100%) | 11 (79%) |
| KLRT／NTDLRT | — | 端點回 200 但零筆 | | | |

合計：**電梯 336/459＝73%**、**廁所與飲水機 91/459＝20%**。

所以「停手」這個結論方向對，但**理由錯了**：不是抓不到，是抓得到而資料本身薄
（最大宗的北捷 121 站四個結構化欄位全空，只有設施圖 PDF）。可做的版本是
**只做電梯**、北捷改給官方設施圖連結、沒資料一律顯示「未提供」而非「沒有」。
