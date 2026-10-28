# 軌島列車工坊：台灣缺車與經典老車 v1

把台灣鐵道還沒建模的現役車，以及已退役的經典老車，用跟台灣 62 款同一套 Blender 管線建模。精細度以世界車精修 world-v1 的銀座線 1000 系試做為準。只建模，沒有接進 App 或網站。

- 盤點清單：[`inventory.html`](inventory.html)（要做的、做完的、查過不做的，每款附來源與參考照片）
- 模型總覽：[`compare/batch-tw.html`](compare/batch-tw.html)（斜側渲染格子，點進去是跟照片並排的對照頁）

## 跟台灣車隊的關係

- `blender_parts.py`、`build_models.py` 從 `../fleet-v1/` 原樣複製（fleet-v1 沒進 git）。不要在這裡改這兩支，改了會跟台灣車隊分岔。新零件寫在 `tw_models.py`。
- `tw_models.py` 開頭的 `zoned_shell`、`front_patch` 等幾支照抄 world-v1（分支 `claude/world-fleet-garage`），`zoned_shell` 多了 `double`（兩端都是車頭）。兩邊各自維護。
- 軸向、錨點、Q 版比例、匯出格式（`.blend`、GLB、`.mesh.bin`、`model.json`、三角度 Cycles 渲染）都跟 fleet-v1 相同，之後可以用 `scripts/import_garage_blender.py --source prototypes/tiny-trains/blender/tw-classics-v1` 匯入車庫。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `tw_specs.py` | 每款的 Q 版尺寸與基本設定 |
| `tw_models.py` | 每款的建模函式；`railcar` 是台鐵電聯車／柴聯車與捷運車共用骨架，`loft_shell` 是新幹線型流線車殼，`shay` 是直立汽缸齒輪式蒸機 |
| `build_tw.py` | Blender 入口 |
| `catalog-source.json` | 每款名稱、狀態、資料來源、照片來源與授權、對過的地方與刻意簡化 |
| `inventory-excluded.json` | 查過但這次不做的車款與理由 |
| `make_pages.py` | 產生盤點清單、對照頁、總覽頁與 360×240 縮圖 |
| `compare/<id>.html` | 渲染圖與參考照片並排（照片直接連 Commons，不複製） |

大檔（`.blend`、GLB、`.mesh.bin`、渲染圖、縮圖）不進 git，用下面的指令重建。

## 重建

在 repo 根目錄：

```sh
~/Applications/Blender-5.2.1.app/Contents/MacOS/Blender -b --factory-startup -t 6 --python prototypes/tiny-trains/blender/tw-classics-v1/build_tw.py -- n700st
python3 prototypes/tiny-trains/blender/tw-classics-v1/make_pages.py
```

不給 ID 就全部重建。Blender 一定要 5.2.1：4.0.2 在匯出網格時會失敗（`corner_normals` 是 4.1 之後的 API）。

## 進度

| 款 | 類別 | 狀態 |
| --- | --- | --- |
| `n700st` 台灣高鐵 N700ST | 現役（2026-08 運抵、測試中） | 精修，對照照片修過一次，45,936 三角形 |
| `c381a` 台北捷運 CR381A | 現役（2026 交車、北投機廠測試中） | 精修，65,452 三角形；尺寸照 C381 |
| `wanda` 台北捷運萬大線 Alstom Metropolis | 現役（交車、主線測試中） | 精修，對照照片調過一次色，50,750 三角形 |

## 照片與標誌

照片只在本機比對，不當貼圖、不進交付包；每款的照片作者與授權記在 `catalog-source.json`。部分照片是政府機關上傳 Commons 的 GWOIA（政府網站資料開放宣告）授權，要求標示出處，條件跟 CC BY 4.0 相容。不放營運商標；車號用可移除的示意字牌。
