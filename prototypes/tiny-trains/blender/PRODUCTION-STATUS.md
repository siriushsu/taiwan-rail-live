# 全量車站與地標製作進度

日期：2026-10-13（臺灣時間）。範圍為423筆站碼、27個舊場景，以及臺北101和臺北站前新光摩天大樓。站碼不等於獨立建築，轉乘與不同建築版本分別追蹤。

目前已產出六組站體／入口資產：冬山、士林、美麗島地面入口、新竹、臺南舊站房及臺中舊驛站。這些仍待實拍校正及地圖放樣；正式地圖未套用。臺南是既有細模整理，其餘五組是新建候選。連同先前臺北車站修訂02，共七組站體候選；驗收完成數仍為0。

| 批次 | Blender／GLB 下載 | 預覽與驗證 |
| --- | --- | --- |
| 冬山、士林、美麗島 | [模型包（17.3 MB）](https://github.com/siriushsu/taiwan-rail-live/actions/runs/38291816538/artifacts/11766327401) | [預覽](station-priority/contact-sheet.jpg) · [驗證](station-priority/validation.json) |
| 新竹、臺南舊站、臺中舊驛站 | [模型包（18.4 MB）](https://github.com/siriushsu/taiwan-rail-live/actions/runs/38294205615/artifacts/11767494868) | [預覽](station-heritage/contact-sheet.jpg) · [驗證](station-heritage/validation.json) |
| 臺北車站修訂02 | [模型包（4.8 MB）](https://github.com/siriushsu/taiwan-rail-live/actions/runs/38284520589/artifacts/11763126290) | [說明與比較](taipei-preview/README.md) |
| 101、新光及13組既有車站工作檔 | [模型包（22.7 MB）](https://github.com/siriushsu/taiwan-rail-live/actions/runs/38288479241/artifacts/11764298352) | [說明與比較](building-batch/README.md) |

ZIP由Actions保存至2027-01-10，建模程式留在分支，可重建。最新總表為[station-manifest.json](building-batch/station-manifest.json)，舊ZIP中的清單反映打包時狀態。

## 製作順序與剩餘項目

[production-queue.json](production-queue.json)保留全部423筆站碼、27個場景及額外建築版本的順序與狀態。它是工作清單，不表示全部背景建模已啟動。

接續優先為高雄舊站房、集集、十分、談文／大山、高鐵新竹，再處理其餘都會區地面／高架站及臺鐵站。現役臺中高架站、臺南地下新站與美麗島地下光之穹頂，仍是獨立待辦。美麗島四個入口目前共用原型，尚未逐出口校正。13組恢復工作檔保留原網格，沒有重製外觀。

每項完成條件：可編輯Blender、近／遠地圖模型、照片逐面比對、地理放樣及手機效能。參考工具目前只回傳照片占位符，尚未完成新的照片像素比對，不能把匯出成功當作實景外觀驗收。

## 已完成的模型自身檢查

四個Blender工作流程皆成功：臺北樣站、地標批次、特色站第一批與古蹟站第二批。第二批三組GLB往返包圍盒誤差均為0，並檢查屋頂覆蓋與窗洞可見性，修正新竹牛眼窗遭屋面遮蔽、臺中飾帶穿窗。

臺南近景保留35,598三角形，遠景7,632，單獨列8,000面預算，其餘新站體遠景不超過6,000面。這些預算未經手機效能驗收。所有估值、來源與待修項目隨model.json保存，臺南另保存16項原有pendingChecks。
