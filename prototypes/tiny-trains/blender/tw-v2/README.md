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
| `compare_page.py` | 改前（fleet-v1）／改後三角度對照頁，渲染圖內嵌成單一 HTML；參考照片只連 Commons 縮圖，其他來源只放文字連結 |
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
| `emu500` `emu600` `haifeng` `shanlan` `emu800` `emu800r` 區間車 | 精修，對照 Commons 照片與官方示意圖修過三次（2026-11-01） |
| `emu900` `emu700` 區間車 | 精修，車頭高度照正面照量、門窗配置照側面照（2026-11-01） |
| `temu1000` `temu2000` 自強號 | 精修，車頭高度照正面照量、車側色帶照側面照比例（2026-11-01） |
| `700t` 高鐵、`e1000` `ppcoach` 推拉式自強號 | 精修，車鼻輪廓與窗罩照正側面照量、E1000 與客車色帶同高（2026-11-01） |
| `dr3100` `dr1000` `dr2700` 柴油客車、`emu100` `emu1200` 早期自強號 | 精修，車頭各自照正面照量、車側壓紋與門窗配置照側面照（2026-11-01） |
| `airportlocal` `airportexpress` 機場捷運、`y100` 環狀線、`sanying` 三鶯線、`taichung` 台中捷運、`kaohsiung` 高雄捷運、`val256` 文湖線 | 精修，車頭各自照正面照量（VAL256 照工程圖），機捷兩款同一支函式換色、環狀線與三鶯線同一個車殼各自塗裝；VAL256 加膠輪與水平導向輪（2026-11-01） |
| `e200` `e300` `e400` `mingri` GE 電力機車（鳴日號經典車頭是 E405）、`e500` `r200` 新機車 | 精修，車頭各自照正面照量、車側塗裝照正側面照比例；E200／E300／E400 同車體共用一支；轉向架之間拿掉電聯車車下設備箱（第 9 批，2026-11-01） |
| `r100` `blue` `r150` `r180` `r20` 柴電機車（藍皮是 R135）、`dhl100` 調車機車 | 精修，短鼻、駕駛室、機房比例照正側面照量，扶手只放照片上有的；EMD 五款共用一支換參數，車頭是短鼻端（2026-11-01） |
| `juguang` 莒光號、`mingricoach` 鳴日號、`bluecoach` 藍皮解憂客車 | 精修，色帶與窗的高度、窗的順序照正側面照量，顏色跟同編組的機車同一組；莒光號與鳴日號同車體共用一支，藍皮客車是淺拱車頂的舊型車殼（2026-11-01） |
| `dl25` `dl38` `dl39` `dl45` 林鐵柴油機車、`alicoach` 阿里山號、`hinoki` 檜木列車、`fushen` 福森號、`xuyue` 栩悅號 | 精修，四款機車共用一支換參數、車頭改成駕駛室短鼻端（照片上行駛中都是這端朝外），高度照正側面照量；阿里山號紅色跟機車同色，三款觀光客車照各自照片取色，福森號、栩悅號的觀景端是車頭（2026-11-01） |

## 照片與標誌

照片只在本機比對，不當貼圖、不進交付包；每款的照片作者與授權記在 `catalog-source.json`。不放營運商標；車號用可移除的示意字牌。
