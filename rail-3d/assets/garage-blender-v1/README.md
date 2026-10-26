# 收藏車庫 Blender 精修模型

來源：prototypes/tiny-trains/blender/fleet-v1 的 62 款交付。網格 gzip 出貨，解壓後核對 metadata 的 SHA-256；保留原位置、法線與 PBR 材質。有疊面的車款修過：同位置的重複三角形只留一份，同向共面、不同材質的兩片照繪製順序拉開 1 mm（後畫的留在上面，跟原本大部分像素看到的一樣，只是不再閃爍）；接近平面的四邊形切在內凹那條對角線、讓後面的零件從中間穿出來的，改切另一條（同樣是後畫的在上面）；改前的雜湊與修了什麼記在該款 json 的 `meshRepair`。縮圖為同批 Blender 渲染。首頁不下載網格，車庫僅載入選中的單款，換車與關閉時釋放。

原照只作建模參考，沒有封裝成貼圖；逐款來源列於 train-garage-catalog.js。模型為 Q 版紀念展示，尺寸不等於真車工程長度，車牌不代表即時派車。

重建：`python3 scripts/import_garage_blender.py --source <Blender 交付目錄>`，接著 `Blender -b --factory-startup --python scripts/repair_garage_blender.py -- --all`（只重寫有疊面要修的車款），再照 `../blender-map-v1/README.md` 重產地圖 LOD。驗證：`npm run check-garage-assets`；啟動本機網站後執行 `GARAGE_URL=http://127.0.0.1:5198/ npm run check-garage`。

## 2026-09-08 藍皮外觀校正

本輪只更新 `blue` 與 `bluecoach`，來源為 Blender 精修包的 R135 第二輪修正版及復古客車。機車改短鼻、外凸燈組、深海軍藍、白飛翼及黃黑 V 紋；客車為全藍側牆、白腰線與銀灰拱頂。
車庫保留 R135 範例車籍號及可移除的獨立文字材質，並非即時派車。增量匯入可加 `--models blue bluecoach`，不重寫其他已出貨款式。
