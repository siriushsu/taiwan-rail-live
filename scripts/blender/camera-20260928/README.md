# garage-camera-v1（2026-09-28，多良景攝影者）

使用者 09-27 裁示「其他五景輕量精緻化」，05 多良的重點是「遊客的頭與相機跟著經過的列車轉」；09-28 另裁示
「細節還是都需要用 Blender 製作」。所以相機與雙手舉相機的彎臂都是 Blender 資產，執行期
（`rail-3d/garage-scenes/duoliang.js`）只做擺放、轉動、上色。

- 資產：`rail-3d/assets/garage-camera-v1/camera.json` ＋ `camera.bin.gz`（garage-parts-v1，1640 三角形，8 個零件）
  - `camera-body`／`camera-top`／`camera-lens`／`camera-glass`：固定色（深炭灰／銀／近黑／深藍紫），中心在 `rig.cameraCenter`，鏡頭軸 +X。
  - `grip-sleeve-l／-r`（tint top）與 `grip-hand-l／-r`（tint skin）：彎臂與手；左右各自一份幾何（彎臂不是鏡像對稱）。
  - 所有零件轉軸＝[0,0,0]，直接寫在 garage-people-v1 的「人的座標系」（面向 +X、左手 +Y、腳底 z=0、公尺）裡，
    所以場景端擺放時只要乘人的根矩陣；攝影者上半身（頭、髮、上衣、這幾個零件）繞人的中軸一起轉。
  - 搭配的人不要戴帽子（帽簷會穿過相機）。
- 建置：`Blender -b --factory-startup -t 4 --python scripts/blender/camera-20260928/build_camera.py`
  （自檢：無退化三角形、每個零件有號體積 > 0；輸出中繼檔在 `output/camera/build/`，不進 repo）。
- 一覽圖：`… --python scripts/blender/camera-20260928/render_camera_sheet.py`，四張分圖在 `output/camera/sheet-*.png`
  （再用 PIL 拼成 `camera-sheet.png`：攝影者三視角＋1.7 m 普通人比例尺＋相機特寫）。
