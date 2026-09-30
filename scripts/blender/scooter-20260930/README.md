# garage-scooter-v1（2026-09-30，光華街涵洞景的機車與安全帽）

使用者 2026-09-30 08:16 說「附近有一個大家都在拍照的地下道 我希望做成一個3D車庫的景」，選項回覆機車＝「Blender 新做機車＋零件庫騎士」。
以下尺寸、姿勢都是主對話判讀或一般規格估計，不是使用者原話。

- 造型：125cc 速克達（前擋板＋平踏板＋座墊＋後車身、龍頭兩支後照鏡、前大燈與尾燈、前後輪 12 吋 5 輻）；騎士戴 3/4 半罩安全帽。
- 前車身（2026-09-30 依主對話要求加厚）：前擋板改成前後深 .28～.31 m（z .46～.60）的厚前車身，前面往前伸、後面（貼膝蓋那面）沒動；前緣貼著前胎後上緣（胎是固定的 110/70-12，z<.46 的深度被前胎限住，最小 .118@z .35），把前叉包進去；前土除是獨立零件 `scooter-fender`，後段埋進前車身下緣。
- 規格錨點：SYM JET SL 官方頁 https://tw.sym-global.com/jetsl125 「性能規格」逐字 長寬高「1815x680x1115」、軸距「1290 mm」、前「110/70-12」、後「120/70-12」。頁面沒有座高（取 .78 m＝一般規格估計）。
- 資產：`rail-3d/assets/garage-scooter-v1/scooter.json`＋`scooter.bin.gz`（garage-parts-v1；機車 2264 三角形〔輪子一份，畫面上兩個實例＝2756〕、安全帽 432）。
  座標同 garage-people-v1（面向 +X、左手 +Y、地面 z＝0、公尺），原點在兩軸中點正下方。安全帽的網格相對人的頸軸 [0,0,1.42]。
- 執行期：`rail-3d/garage-scooter.js`（`loadScooterKit`、`createScooterRider`、`riderPose`）。靜態部分（車殼、座墊、騎士、安全帽）烤成一個帶頂點色的網格，輪子一個 InstancedMesh，前燈、尾燈各一個網格＝4 次 draw call。

## 腳本
| 腳本 | 用途 | 指令 |
|---|---|---|
| `build_scooter.py` | 建資產（自檢：無退化三角形、每零件朝外） | `/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 --python scripts/blender/scooter-20260930/build_scooter.py` |
| `render_scooter_sheet.py` | Blender 對照表（Workbench 平光；沒有 PIL 時留六張分圖，用系統 python3 拼） | `… --python scripts/blender/scooter-20260930/render_scooter_sheet.py -- <輸出資料夾>` |
| `measure_scooter.mjs` | M1～M4＋前車身（側面深度、前叉外露、前土除接合）：從載入後的網格量尺寸、形狀、騎士、面數（含正向對照） | `node scripts/blender/scooter-20260930/measure_scooter.mjs [輸出檔]` |
| `render_views.mjs` | M5、M6、瀏覽器 draw call、console：無視窗 Chrome，自己起靜態伺服器（port 0）跑完就關 | `node scripts/blender/scooter-20260930/render_views.mjs <輸出資料夾>` |

輸出的中繼檔在 `output/scooter/`，不進 repo。照片與 PDF 不進 repo。

## 已知限制
- 騎士是「一個固定坐姿」（烤死），沒有身體隨路面晃動；輪子會轉，車身不會傾斜。
- 騎士的腿是人零件庫的腿零件縮放成大腿＋小腿（大腿加粗 1.2 倍），膝蓋是兩個圓頭柱相接；不是真的關節。
- 安全帽沒有面罩、帽舌、下巴帶；頭髮不畫（被帽子蓋住）。
- 機車沒有側柱、後貨架；車牌是空白白板（沒有字）。
- 夜間只有前後燈自發光（沒有真的光錐、沒有煞車燈變亮）。
