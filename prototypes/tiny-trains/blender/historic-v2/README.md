# 歷史建物平面校正版 v2

25 組主體已於 2026/9/9 上線。2026/9/12 對照正式站後，另補 11 組的外觀與附屬設施；詳見 [本輪補件與驗證紀錄](COMPLETION-2026-09-12.md)。這是地圖外觀模型，完整立面及實測高度仍不在已完成範圍。

- 25 組均保留校正工作檔與近／遠景輸出。
- 25 組主體已可匯入地圖；嘉義製材所包含北側主工場與動力室；未定位的附屬構件仍保留在原草模。
- 勝興、車埕與橋頭：官方場域資料加衛星屋頂目視比對，位置、軸向及外框仍屬估計。斗南改為沿鐵道連續六棟，以官方面積比例估計分段，未宣稱分界或序號已經測繪確認。
- 北門驛使用嘉義市政府的舊站座標及 95.15㎡面積參考；不是北側的新站輪廓。
- 花蓮水塔使用 OSM 節點定位，塔身尺度估計。主廳舍雙翼及角塔依官方空拍與衛星屋頂調整為 L 形，武道館採 OSM 輪廓；高度與立面仍為估計。
- 主體以 OSM 建物平面包圍框校正尺度與軸向，並非逐邊重建或工程測繪。正反面、屋頂細節及高度仍須現況照片／測量覆核。
- 不採用沒有來源的月台、貨台、附屬小屋位置；移除清單記錄在每組 `omittedUnlocatedComponents`。

`placements-source.json` 包含此次使用的原始輪廓與逐棟對應。`placements/*.json` 是地圖放樣資料；X 東、Y 北、Z 上，米制，世界錨點為 WGS84 經緯度。海拔保持空值，地圖逐棟查詢地形高程，不使用鐵路高程充當建物高程。

## 重建

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python-exit-code 1 --python build_calibrated.py
python3 finalize.py
/Applications/Blender.app/Contents/MacOS/Blender --background --python-exit-code 1 --python audit_calibrated.py
node verify_browser.mjs
node serve.mjs
```

`build_calibrated.py` 使用 `export_core.py` 的原生建模／匯出工具及 `geometry.py`，經 `completion.py` 補件後套用 `calibration.py`。原草模 `historic-v1` 保持不變。地圖匯入腳本位於 repo 的 `scripts/import_historic_buildings.py`。

工坊「輪廓比對」綠線為來源輪廓，橘線為估計外框；可搭配俯看檢查。驗證程式核對格式、雜湊、渲染與互動，不代表建築現實精度獲得認證。

來源：© OpenStreetMap contributors，ODbL 1.0；官方頁面逐組列於 `model.json`。沒有將參考照片作為貼圖或重新發布照片。
