# 軌島列車工坊：台灣車隊精修 v2（tw-v2）

收藏車庫與地圖上的台灣列車，照世界車 world-v1 的精細度重做。fleet-v1（目前上線的 62 款）沒進 git，這裡從它的 Q 版尺寸、軸向與匯出格式接著做，逐家族換掉。

## 跟 fleet-v1、world-v1 的關係

- `blender_parts.py`、`build_models.py` 從 `../fleet-v1/` 原樣複製，跟 world-v1 的兩支也逐 byte 相同。不要在這裡改，改了三套會分岔。
- `refine_parts.py` 收 world-v1 `world_models.py` 裡可共用的零件（`zoned_shell` 依高度分塗裝的車殼、`front_patch` 貼著車頭曲面的色塊、`front_glass`、`ramp`），加上台灣電聯車／捷運共用骨架 `emu_body`。
- 軸向、錨點、Q 版比例、匯出格式（`.blend`、GLB、`.mesh.bin`、`model.json`、三角度 Cycles 渲染）跟 fleet-v1 相同，所以匯入流程不變：`scripts/import_garage_blender.py --source prototypes/tiny-trains/blender/tw-v2 --models <id> ...`，再衍生地圖網格。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `tw_specs.py` | 每款的 Q 版尺寸、門數、車頂設備 |
| `tw_models.py` | 每款的建模函式；同車體的家族共用一支（例如北捷高運量的 `metro_body`、`metro_black_face`） |
| `build_tw.py` | Blender 入口 |
| `finalize_tw.py` | 渲染完之後產 360×240 WebP 縮圖與 `catalog.json`（給車庫匯入讀） |
| `compare_page.py` | 改前（fleet-v1）／改後三角度對照頁，渲染圖內嵌成單一 HTML；參考照片只連 Commons |
| `catalog-source.json` | 每款名稱、說明、車庫顯示的參考連結、比對用照片的作者與授權 |
| `catalog.json` | `finalize_tw.py` 產出，fleet-v1 同格式 |

大檔（`.blend`、GLB、`.mesh.bin`、渲染圖、縮圖）不進 git，用下面的指令重建。

## 重建

在 repo 根目錄：

```sh
~/Applications/Blender-5.2.1.app/Contents/MacOS/Blender -b --factory-startup -t 6 --python prototypes/tiny-trains/blender/tw-v2/build_tw.py -- c301 c321 c341 c371 c381
python3 prototypes/tiny-trains/blender/tw-v2/finalize_tw.py c301 c321 c341 c371 c381
```

北捷五款約 70 秒（2026-11-01 實測 69～76 秒）。Blender 一定要 5.2.1，4.0.2 匯出時會失敗（`corner_normals`）。

## 進度

| 款 | 狀態 |
| --- | --- |
| `c301` `c321` `c341` `c371` `c381` 北捷高運量 | 精修，對照 Commons 照片量過車頭高度並修過兩次（2026-11-01） |

## 照片與標誌

照片只在本機比對，不當貼圖、不進交付包；每款的照片作者與授權記在 `catalog-source.json`。不放營運商標；車號用可移除的示意字牌。
