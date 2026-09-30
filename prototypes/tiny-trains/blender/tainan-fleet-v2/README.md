# 台南重播頁列車網格 v2（真實比例）

`memories/tainan-2026-09-12/` 重播頁用的 13 種車廂網格（每種一份近景、一份遠景），由本目錄的純 Python 產生器程序化建出。
車廂 1 單位＝1 公尺、網頁一律不縮放車體；各車型的真實連結器間距（pitch）與尺寸來源記在輸出的 `fleet/catalog.json`。

## 需求

- Python 3.9+、`numpy`、`scipy`、`shapely`（產生器本身不需要 Blender）。
- `blender_compare.py` 才需要 Blender（實測 5.2.1，背景模式 `-b`）。

## 重新產生（改了 `t_*.py`、`parts.py`、`common.py` 或 `kit.py` 之後）

```sh
cd prototypes/tiny-trains/blender/tainan-fleet-v2
python3 export_fleet.py            # 寫入 memories/tainan-2026-09-12/fleet/：<id>.near.bin.gz、<id>.far.bin.gz＋catalog.json，並刪掉不在清單內的舊網格
cd ../../../..
node scripts/seal_tainan_memory.mjs --seal-reviewed-snapshot   # 重新封存 integrity.json
node scripts/verify_tainan_memory.mjs                          # 應 exit 0
```

`export_fleet.py` 自帶上限檢查：近景 ≤ 16,000 三角形、遠景 ≤ 2,000 三角形，超過就中止。加 `--dest <目錄>` 可輸出到別處試做，不動真樹。

## 檔案

| 檔案 | 內容 |
|---|---|
| `kit.py` | 網格容器與輸出（每頂點 10 個 float32：位置、法線、sRGB 顏色、光澤；三角形不共用頂點）、基本形狀、鼻錐放樣 `Nose`、前視／側視貼花 |
| `parts.py` | 車體斷面 `Profile`、側牆色帶與開口 `Layout`、車頂、底盤、轉向架、集電弓、折棚 |
| `common.py` | 中間車 `build_mid`、駕駛車 `build_cab`、窗列與門的共用函式 |
| `t_emu3000.py` `t_emu800.py` `t_temu2000.py` | EMU3000（ED／EM／EP）、EMU800（ED／EP）、TEMU2000（TED／TEM／TEP） |
| `t_pp.py` | PP 客車（`ppcoach`、機車端 `ppcoach-end`）、莒光客車 `juguang` |
| `t_loco.py` | 雙端駕駛室機車 E500、E200 |
| `cars.py` | 車款註冊表（`BUILDERS[id](lod)`；lod 0＝近景、1＝遠景） |
| `build.py` | 只輸出 `out/<id>.near.bin`、`out/<id>.far.bin`（給檢視器與統計用，`out/` 已被 `.gitignore` 忽略） |
| `export_fleet.py` | 正式輸出：網格、`catalog.json`（尺寸來源、採用值、矛盾值、推斷項、塗裝、編組規則、LOD 門檻） |
| `viewer.html` | 本機檢視器，用網頁同一支 shader 畫網格 |
| `blender_compare.py` | 用 Blender Cycles 渲染側視與 3/4 視圖，供與參考照片並排比對 |

## 座標與尺寸規約

- `+X` 車頭、`+Y` 車左、`z=0` 為鋼軌面；`x=0` 為該車連結器間距（pitch）的中心。
- 中間車車體兩端各留 0.35 m 半縫；駕駛車／機車只在連結端留半縫，車體相對 pitch 中心偏 +0.175 m，車頭尖端落在 `+pitch/2`。
- 連結端各有半段深灰折棚；PP 客車機車端（`ppcoach-end`）沒有折棚。
- 高度採「全高、集電弓降下」；來源矛盾時 catalog 的 `conflicts` 列出兩者，差 < 0.2 m 者不另處理。
- 找不到資料的細節一律用最中性的處理，並列在該車款 catalog 的 `inferred`。

## 檢視器

在 repo 根目錄起一個靜態伺服器（例如 `python3 -m http.server 5411`），再開：

```
/prototypes/tiny-trains/blender/tainan-fleet-v2/viewer.html?files=../../../../memories/tainan-2026-09-12/fleet/e500.near.bin.gz&yaw=270&span=24&cz=1.9
```

參數：`files=路徑:x偏移:flip`（逗號分隔可串接多輛）、`yaw`／`pitch`（度）、`span`（視窗高度，公尺）、`cx`／`cz`、`persp=1`（透視）、`rails=0`、`hud=0`。載入完成後 `window.viewerReady===true`。

## Blender 比對渲染

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python blender_compare.py -- \
    --fleet ../../../../memories/tainan-2026-09-12/fleet --out <輸出目錄> [--ids emu3000,e500] [--lod near|far] [--samples 64]
```

輸出 `<id>-<lod>-side.png`（側視，機頭朝右）與 `<id>-<lod>-q34.png`（前右 3/4）。參考照片只用來人工比對，不放進 repo。

## 與重播頁的介面（`fleet/catalog.json`，schema 2）

- `lod.nearBelowSpan`／`lod.farAboveSpan`：相機視野跨度（公尺）低於前者用近景網格、高於後者用遠景網格，中間保持現狀。
- `meshes[id]`：`pitchM`、`bodyM`、`widthM`、`heightM`、`near`／`far`（`file`、`sha256`、`triangles`、`gzBytes`、包圍盒）＋來源與說明欄位。
- `formations[snapshot 的 formation.id].cars[]`：逐輛 `{mesh, flip}`；輛數必須與 `snapshot.json` 該編組的 `parts` 數一致，否則重播頁開機時丟出「缺少編組規則」。
- `replay.js` 依 catalog 用各車型 `pitchM` 首尾相接、以編組中心為基準重排；`snapshot.json` 不動。

## 加新車款

1. 在 `t_*.py` 寫 `BUILDERS[id](lod)`，回傳 `(Mesh, spec)`；在 `cars.py` 已列的模組裡註冊，或新增模組並加進 `cars.py` 的清單。
2. 在 `export_fleet.py` 的 `META`（尺寸、來源、採用值、矛盾、推斷、塗裝）與 `FORMATIONS`（逐輛網格與轉向）補資料。
3. 執行上面的「重新產生」三步。
