# 台南重播頁列車網格 v3（10/16 版，真實比例）

`memories/tainan-2026-10-16/fleet/` 重播頁用的 14 種車廂網格（每種一份近景、一份遠景）與編組規則 `catalog.json`。
本目錄是 `tainan-fleet-v2`（輸出 9/12 版）的延伸：產生器、零件庫、檢視器原樣沿用，差別只有下面三點。

1. **只新增一種網格**：`emu800-mid`（EMU800 沒有集電弓的中間車 EMA／EMB）。其餘 13 種（26 個 `.bin.gz`）從已封存的 9/12 `fleet/` 逐 byte 複製，不重新匯出；它們在 catalog 裡的條目也原樣沿用。
2. **三組編組有變動**：`emu800` 由 3 節改 8 節、`e200` 由 3 節改 9 節、新增 `e500`（環島之星 7 節）。`emu3000`、`temu2000`、`e1000` 三組與 9/12 逐字相同（匯出時逐項斷言）。
3. **匯出器不會寫進 9/12**：目的地落在 `memories/tainan-2026-09-12/` 底下一律中止；`--regen-all` 也不能指向 10/16 正式目錄。

## 需求

- Python 3.9+、`numpy`、`scipy`、`shapely`（產生器本身不需要 Blender）。
- `python3 -I` 會忽略使用者 site-packages，而這三個套件通常裝在那裡；`export_fleet.py`、`build.py` 開頭會把該固定目錄加進 `sys.path`，所以可以照樣用 `-I` 執行。
- Node（實測 v24.14.0）：`verify_fleet.mjs`、`audit_formations.mjs` 只用內建模組；`render_lineups.mjs` 另需 `playwright` 與本機 Google Chrome（無視窗模式 `channel:'chrome', headless:true`，不會開視窗）。
- `blender_compare.py` 才需要 Blender（實測 5.2.1，背景模式 `-b`）。

## 重新產生

```sh
cd prototypes/tiny-trains/blender/tainan-fleet-v3
python3 -I export_fleet.py            # 寫入 memories/tainan-2026-10-16/fleet/：26 檔逐 byte 複製＋emu800-mid 近／遠景＋catalog.json
node --no-warnings verify_fleet.mjs   # 應 exit 0（印出 ALL PASS）
```

之後由主流程用 `scripts/seal_tainan_memory.mjs` 重新封存 `integrity.json`；本目錄的腳本不寫它。

- 匯出器自帶上限檢查：近景 ≤ 16,000 三角形、遠景 ≤ 2,000 三角形，超過就中止。
- 目的地若有清單以外的檔案就中止，不刪除任何檔案。原始（未壓縮）`.bin` 只放暫存目錄（`TMPDIR`），跑完即刪。
- 匯出前先斷言：9/12 catalog 的 `schema`／`lod`／`note` 與這裡一致、網格清單恰為「9/12 既有＋`NEW_MESHES`」、沒改的編組與 9/12 相同；複製檔的解壓後雜湊與 gz 大小要與 9/12 catalog 記載一致；`totals` 等於磁碟上 `.bin.gz` 的實際合計。
- **產生器仍重現 9/12 的驗證**：`python3 -I export_fleet.py --regen-all --dest <暫存目錄>` 把 14 種全部重新產生。實測 9/12 既有的 26 個 `.bin.gz` 位元組全同、13 個舊 catalog 條目 JSON 全同，所以新網格與舊網格出自同一個工具狀態。

## 檔案

| 檔案 | 內容 |
|---|---|
| `kit.py` | 網格容器與輸出（每頂點 10 個 float32：位置、法線、sRGB 顏色、光澤；三角形不共用頂點）、基本形狀、鼻錐放樣 `Nose`、前視／側視貼花 |
| `parts.py` | 車體斷面 `Profile`、側牆色帶與開口 `Layout`、車頂、底盤、轉向架、集電弓、折棚 |
| `common.py` | 中間車 `build_mid`、駕駛車 `build_cab`、窗列與門的共用函式 |
| `t_emu3000.py` `t_emu800.py` `t_temu2000.py` | EMU3000（ED／EM／EP）、EMU800（ED／EP／**EMA‧EMB 中間車**）、TEMU2000（TED／TEM／TEP） |
| `t_pp.py` | PP 客車（`ppcoach`、機車端 `ppcoach-end`）、莒光客車 `juguang` |
| `t_loco.py` | 雙端駕駛室機車 E500、E200 |
| `cars.py` | 車款註冊表（`BUILDERS[id](lod)`；lod 0＝近景、1＝遠景） |
| `build.py` | 只輸出 `out/<id>.near.bin`、`out/<id>.far.bin`（給檢視器與統計用，`out/` 已被 `.gitignore` 忽略） |
| `export_fleet.py` | 正式輸出：網格、`catalog.json`（尺寸來源、採用值、矛盾值、推斷項、塗裝、編組規則、LOD 門檻）；`META`、`FORMATIONS` 是資料來源 |
| `audit_formations.mjs` | 盤點範圍內每班車的 `formationFor(v,'actual')` 結果（見下） |
| `verify_fleet.mjs` | 驗證 `fleet/`：檔案與雜湊、`arrange()` 條件模擬、集電弓位置、對照組、封存用雜湊清單 |
| `render_lineups.mjs` | 用檢視器把整列編組算成圖（無視窗 Chrome），輸出到 `output/tainan-1016-fleet/` |
| `viewer.html` | 本機檢視器，用網頁同一支 shader 畫網格（`vendor/` 取自 `memories/tainan-2026-10-16/vendor/`，唯讀引用） |
| `blender_compare.py` | 用 Blender Cycles 渲染側視與 3/4 視圖，供與參考照片並排比對 |

## 編組依據與哪些是推估

重播頁的 `arrange()`（`replay.js`）用 `snapshot.json` 該班的 `formation.id` 查 `catalog.formations[id]`，節數對不上就在開機時丟出「缺少編組規則」。節數來自 `rail-3d/integration/formations.js` 的 `formationFor(v,'actual')`：區間車 8 節、莒光 9 節（機車＋8 客車）、環島之星 7 節（機車＋6 客車）。`snapshot.json` 只用到 `formation.id` 與 `parts` 的數量，各節的網格名稱不影響畫面。

| formation.id | 節數 | 逐節網格（由車頭起） | 依據 | 性質 |
|---|---|---|---|---|
| `emu800` | 8 | `emu800`（ED）‧`emu800-mid`（EMA）‧`emu800-ep`（EP）‧`emu800-mid`（EMB）×2 ‧`emu800-ep` 轉 180° ‧`emu800-mid` ‧`emu800` 轉 180° | 實車 8 輛編組 ED‑EMA‑EP‑EMB‑EMB‑EP‑EMA‑ED（維基百科 台鐵EMU800型電聯車）；EP 的集電弓、電氣室與廁所靠 EMB 端 | 編組型態有出處；**班次對應是推估**（見下） |
| `e200` | 9 | `e200`＋`juguang` ×8 | 維基百科 莒光號列車記載 2004 年起常態編組為 8 輛，沒說明是否含機車；取客車 8 輛 | **推估** |
| `e500` | 7 | `e500`＋`juguang` ×6 | `formations.js` 的 star 條目（機車 17 m＋客車 6×20 m，註明為推估）；交通部運輸研究所報告記載環島之星每列次 4 節商務車廂、1 節客廳車、1 節餐車 | **推估**；客車外觀沿用主站 3D 對 e500 模板用的莒光客車網格，實車為不同彩繪，未建模 |

推估的部分（每一項都寫在 catalog 該編組的 `notes`，當班實際編組未確認）：

- 班表分不出當班是 EMU500／700／800／900 哪一型、掛幾輛，所以範圍內的區間車一律畫成 EMU800 8 輛。臺鐵 113 年度附屬單位決算書的車輛說明提到 EMU800 型 8 輛編組、EMU900 型 10 輛編組，也提到部分區間車原為 4 輛。
- 畫面一列的長度由各網格的 `pitchM` 加總：`emu800` 165.0 m、`e200` 177.4 m、`e500` 141.12 m；`formations.js` 的長度（160／177／137 m）是占用計算用的代表值，兩者不同，畫面以 catalog 為準。
- EMA 與 EMB 外觀相同（座位同為 56、全高同為 3,990 mm），共用 `emu800-mid`；EMB 末端多一組尾部標示燈，是小燈具，不建模。
- EMA／EMB 的每側 3 門、六扇大窗位置與車頂 2 具冷氣、車下設備是依照片估，沿用 v2 產生器對 EMA 的註記；細節與矛盾來源列在 catalog `meshes['emu800-mid']` 的 `adopted`／`conflicts`／`inferred`。

### `emu800-mid`

- 連結器間距 20.3 m、車體 19.6 m、寬 2.89 m、全高 3.99 m（含冷氣）；沒有集電弓，降弓全高 4.234 m 只有 EP。
- 與 `emu800-ep` 同一份產生程式（車體、窗列、車門、塗裝相同），差別只在：沒有集電弓與高壓電氣室罩、沒有廁所霧面小窗（維基只寫 ED 與 EP 設廁所）。
- 近景 4,524 三角形（gz 34,028 B）、遠景 764 三角形（gz 5,584 B）；EP 近景 4,656、遠景 788。
- 集電弓畫在 `emu800-ep` 的 −X 端：第 3 輛 `flip=false`、集電弓靠第 4 輛；第 6 輛 `flip=true`、集電弓轉向第 5 輛。兩具集電弓都貼著中間的兩輛 EMB。

## 驗證

```sh
node --no-warnings verify_fleet.mjs [--fleet <目錄>] [--control <目錄>] [--snapshot <snapshot.json>] [--json <輸出檔>]
node --no-warnings audit_formations.mjs [--json <輸出檔>]
node --no-warnings render_lineups.mjs [--out <目錄>]
```

- `audit_formations.mjs`：範圍＝停靠表含大橋、臺南或保安任一站的 10/16 班次，加上 10/15 跨午夜且臺南站 23:30 以後才離站的班次（班表取自 commit `32244b8a`）。`v` 的寫法照主站 `carModelOf`，經 `specialOf` 傳 `stockId`／`branchId`／`namedId`；`specialOf` 依賴瀏覽器端狀態，這裡照它的三個查表重做（`data/tra_special_trains.json`：具名列車依營運日的車次、車輛型式依 `carName`、支線依停靠站名）。同時印出「只傳 `systemId`＋`carName`」的結果對照。
- `verify_fleet.mjs`（任一項不過就非零退出）：
  - A 檔案：目錄裡只有 catalog 列出的檔；每個 `.bin.gz` 解壓後的雜湊、長度、頂點數、三角形數、包圍盒與 gz 大小都和 catalog 一致；`totals` 正確。
  - B 編組：範圍內每班車算出的 `formation.id` 與 `parts` 數，照 `arrange()` 的條件比對（規則存在且 `cars.length === parts.length`），每個 `cars[].mesh` 都在 catalog 裡、`pitchM` 有限。
  - C 集電弓：EMU800 三種網格的頂點高度分佈（只有 `emu800-ep` 超過 3.995 m），以及 8 節編組中兩具集電弓旁邊的車是 EMB。
  - D 對照組：同一個比對用在 9/12 的 catalog，必須在 `emu800`、`e200`、`e500` 失敗（確認檢查真的會紅）。
  - E 封存清單：照 `scripts/seal_tainan_memory.mjs` 的規則（`.bin.gz` 取解壓後雜湊、鍵名去 `.gz`）印出 `fleet/` 每個檔的 sha256。
  - 給 `--snapshot` 時，另外拿 `snapshot.json` 實際的 `formation.id` 與 `parts.length` 逐班比對。
- `render_lineups.mjs`：以 `arrange()` 同樣的算法（用 `pitchM` 首尾相接、以編組中心置中、車頭在 +X）排出整列，輸出同一比例尺的整列比較圖（10/16 與 9/12 並排）、EP 與 `emu800-mid` 並排、第 1–4 輛側視、3/4 透視、第 3–6 輛俯視，另有遠景 LOD 的整列。輸出在 `output/`（已被 `.gitignore` 忽略）。

## 座標與尺寸規約

- `+X` 車頭、`+Y` 車左、`z=0` 為鋼軌面；`x=0` 為該車連結器間距（pitch）的中心。
- 中間車車體兩端各留 0.35 m 半縫；駕駛車／機車只在連結端留半縫，車體相對 pitch 中心偏 +0.175 m，車頭尖端落在 `+pitch/2`。
- 連結端各有半段深灰折棚；PP 客車機車端（`ppcoach-end`）沒有折棚。
- 高度採「全高、集電弓降下」；來源矛盾時 catalog 的 `conflicts` 列出兩者，差 < 0.2 m 者不另處理。`emu800-mid` 的 infobox 高度（3,958 mm）與本文／Train Collection（3,990 mm）矛盾，採 3,990，與 ED、EP 同一基準。
- 找不到資料的細節一律用最中性的處理，並列在該車款 catalog 的 `inferred`。

## 檢視器

在 repo 根目錄起一個靜態伺服器（例如 `python3 -m http.server 5411`），再開：

```
/prototypes/tiny-trains/blender/tainan-fleet-v3/viewer.html?files=../../../../memories/tainan-2026-10-16/fleet/emu800-mid.near.bin.gz&yaw=270&span=24&cz=1.9
```

參數：`files=路徑:x偏移:flip`（逗號分隔可串接多輛）、`yaw`／`pitch`（度）、`span`（視窗高度，公尺）、`cx`／`cz`、`persp=1`（透視）、`rails=0`、`hud=0`。載入完成後 `window.viewerReady===true`。

## Blender 比對渲染

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python blender_compare.py -- \
    --fleet ../../../../memories/tainan-2026-10-16/fleet --out <輸出目錄> [--ids emu800,emu800-mid,emu800-ep] [--lod near|far] [--samples 64]
```

輸出 `<id>-<lod>-side.png`（側視，機頭朝右）與 `<id>-<lod>-q34.png`（前右 3/4）。參考照片只用來人工比對，不放進 repo。

## 與重播頁的介面（`fleet/catalog.json`，schema 2）

- `lod.nearBelowSpan`／`lod.farAboveSpan`：相機視野跨度（公尺）低於前者用近景網格、高於後者用遠景網格，中間保持現狀。
- `meshes[id]`：`pitchM`、`bodyM`、`widthM`、`heightM`、`near`／`far`（`file`、`sha256`、`triangles`、`gzBytes`、包圍盒）＋來源與說明欄位。
- `formations[snapshot 的 formation.id].cars[]`：逐輛 `{mesh, flip}`；輛數必須與 `snapshot.json` 該編組的 `parts` 數一致，否則重播頁開機時丟出「缺少編組規則」。`listedFor` 只用在前後不對稱的編組（EMU3000）。
- `replay.js` 依 catalog 用各車型 `pitchM` 首尾相接、以編組中心為基準重排；`snapshot.json` 不動。重播頁開機會把 catalog 裡所有網格都載入，所以沒有任何編組用到的網格只會多花下載量。

## 加新車款

1. 在 `t_*.py` 寫 `BUILDERS[id](lod)`，回傳 `(Mesh, spec)`；在 `cars.py` 已列的模組裡註冊，或新增模組並加進 `cars.py` 的清單。
2. 在 `export_fleet.py` 的 `META`（尺寸、來源、採用值、矛盾、推斷、塗裝）與 `FORMATIONS`（逐輛網格與轉向）補資料，並把新 id 加進 `NEW_MESHES`；編組有變動就加進 `CHANGED_FORMATIONS`。
3. 執行「重新產生」兩步，並用 `--regen-all` 確認既有網格的位元組沒變。
