# 收藏車庫 Blender 精修模型

來源：prototypes/tiny-trains/blender/fleet-v1 的 62 款交付。原始網格逐 byte 無損 gzip，解壓後核對 metadata 的 SHA-256；保留原位置、法線與 PBR 材質。縮圖為同批 Blender 渲染。首頁不下載網格，車庫僅載入選中的單款，換車與關閉時釋放。

原照只作建模參考，沒有封裝成貼圖；逐款來源列於 train-garage-catalog.js。模型為 Q 版紀念展示，尺寸不等於真車工程長度，車牌不代表即時派車。

重建：`python3 scripts/import_garage_blender.py --source <Blender 交付目錄>`。驗證：`npm run check-garage-assets`；啟動本機網站後執行 `GARAGE_URL=http://127.0.0.1:5198/ npm run check-garage`。

## 2026-09-08 藍皮外觀校正

本輪只更新 `blue` 與 `bluecoach`，來源為 Blender 精修包的 R135 第二輪修正版及復古客車。機車改短鼻、外凸燈組、深海軍藍、白飛翼及黃黑 V 紋；客車為全藍側牆、白腰線與銀灰拱頂。
車庫保留 R135 範例車籍號及可移除的獨立文字材質，並非即時派車。增量匯入可加 `--models blue bluecoach`，不重寫其他已出貨款式。
