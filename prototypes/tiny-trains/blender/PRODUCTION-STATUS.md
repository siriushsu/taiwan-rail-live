# 全量車站與地標製作進度

日期：2026-10-13（臺灣時間）。範圍為423筆站碼、27個舊場景，以及臺北101和臺北站前新光摩天大樓。站碼不等於獨立建築，轉乘與不同建築版本分別追蹤。

目前共11組站體／入口候選：臺北、冬山、士林、美麗島地面入口、新竹、臺南舊站房、臺中舊驛站、高雄1941帝冠舊站房、集集、談文及大山，另有1組十分月台配置研究。臺南是既有細模整理；其他為候選模型。十分站房尚未製作，不計入站房數。所有候選仍待實拍校正、地圖放樣及手機效能驗收；驗收完成數為0，正式地圖未套用。

| 批次 | Blender／GLB 下載 | 預覽與驗證 |
| --- | --- | --- |
| 高雄帝冠舊站、集集、談文、大山；另十分月台研究 | [第三批模型包（20.6 MB）](https://github.com/siriushsu/taiwan-rail-live/actions/runs/38351239057/artifacts/11790814349) | ZIP內 contact-sheet.jpg、review.html 與 validation.json |
| 冬山、士林、美麗島 | [模型包（17.3 MB）](https://github.com/siriushsu/taiwan-rail-live/actions/runs/38291816538/artifacts/11766327401) | [預覽](station-priority/contact-sheet.jpg) · [驗證](station-priority/validation.json) |
| 新竹、臺南舊站、臺中舊驛站 | [模型包（18.4 MB）](https://github.com/siriushsu/taiwan-rail-live/actions/runs/38294205615/artifacts/11767494868) | [預覽](station-heritage/contact-sheet.jpg) · [驗證](station-heritage/validation.json) |
| 臺北車站修訂02 | [模型包（4.8 MB）](https://github.com/siriushsu/taiwan-rail-live/actions/runs/38284520589/artifacts/11763126290) | [說明與比較](taipei-preview/README.md) |
| 101、新光及13組既有車站工作檔 | [模型包（22.7 MB）](https://github.com/siriushsu/taiwan-rail-live/actions/runs/38288479241/artifacts/11764298352) | [說明與比較](building-batch/README.md) |

前兩批ZIP由Actions保存至2027-01-10，第三批保存至2027-01-11。建模程式留在分支，可重建。第三批ZIP內的 station-manifest.json 已收錄本次4個站房候選及1個月台研究，是目前最新的完整清單快照；儲存庫中的[station-manifest.json](building-batch/station-manifest.json)及[production-queue.json](production-queue.json)仍是第三批前的工作基線。站碼不等於獨立站房，11是資產候選數，不是423筆站碼中的11筆已驗收。

## 製作順序與剩餘項目

[production-queue.json](production-queue.json)保留全部423筆站碼、27個場景及額外建築版本的順序與狀態。它是工作清單，不表示全部背景建模已啟動。

高雄帝冠舊站、集集、談文／大山已有初稿，十分只有月台研究。下一步先補真實外觀核對與缺漏，再處理十分站房、高鐵新竹，以及其餘都會區地面／高架站及臺鐵站。現役臺中高架站、臺南地下新站與美麗島地下光之穹頂，仍是獨立待辦。美麗島四個入口目前共用原型，尚未逐出口校正。13組恢復工作檔保留原網格，沒有重製外觀。

每項完成條件：可編輯Blender、近／遠地圖模型、照片逐面比對、地理放樣及手機效能。參考工具目前只回傳照片占位符，尚未完成新的照片像素比對，不能把匯出成功當作實景外觀驗收。

## 已完成的模型自身檢查

五個Blender工作流程皆成功：臺北樣站、地標批次、特色站第一批、古蹟站第二批與第三批。第二批三組GLB往返包圍盒誤差均為0，並檢查屋頂覆蓋與窗洞可見性，修正新竹牛眼窗遭屋面遮蔽、臺中飾帶穿窗。

臺南近景保留35,598三角形，遠景7,632，單獨列8,000面預算，其餘新站體遠景不超過6,000面。這些預算未經手機效能驗收。所有估值、來源與待修項目隨model.json保存，臺南另保存16項原有pendingChecks。

## 第三批可重現交付

來源提交：`dda83e11973e1686dfee3b3c6c537866c5d4881a`；[Blender 執行及檢查紀錄](https://github.com/siriushsu/taiwan-rail-live/actions/runs/38351239057)。完整 specs/build/verify/compose 保存在[工作流程](../../../.github/workflows/station-next.yml)；ZIP內 source 保留相同目錄結構，可直接重建。

本次已目視檢查 Blender 的正面、斜角及屋頂渲染，修正牆面三角形繞序與自訂法線不一致造成的黑色破面。這是模型渲染檢查，沒有完成實拍逐面比對。驗證原檔可重開、遠近兩級 GLB 可往返、尺寸邊界一致，並檢查法線、屋面覆蓋、窗洞、雜湊及材質群組；全部通過。所有模型 productionReady=false，anchor/rotation 維持 null。

| 資產 | 可編輯物件 | 近景／遠景三角形 | 外觀與交付限制 |
| --- | ---: | ---: | --- |
| 高雄1941帝冠舊站房 | 81 | 2,254／1,024 | 與現役 Mecanoo 主站、舊打狗驛分開；冠頂、唐破風比例與顏色待照片校正 |
| 集集重建站房 | 278 | 5,294／1,280 | 文資文字確認木構及黑瓦；窗位、屋瓦細部與尺寸仍為估值 |
| 談文 | 195 | 3,854／932 | 附屬半寄棟量體未製作；L形屋脊收尾及交谷仍是研究形體 |
| 大山 | 172 | 3,146／836 | 歷史出札柵欄、附屬量體未製作；立面及屋頂待校正 |
| 十分月台研究 | 51 | 1,778／216 | 站房未製作；月台長度、雨棚及鐵路方位未校正，僅配置研究 |

四座站房的背面與側面目前是未開門窗的體塊，不能當作完整真實外觀。第一批美麗島仍共用入口原型，其餘批次原有待核事項保持有效。照片來源頁面與授權線索保存在各模型的 stations.json/model.json，未將照片當作貼圖。參考工具目前未提供可目視照片像素，因此外觀精修尚有阻礙；不可依靠推測批量標示完成。

第三批GLB往返包圍盒誤差均為0公尺（數值比較），材質群組近景5–7組、遠景3–7組。這些是結構與匯出驗證，沒有涵蓋地圖整合、照片符合度或實機流暢度。

本次ZIP SHA-256：`72034a0be080c2c60c28fd364489df8dd7b351b0dc3b73e4b798efac951782e1`。ZIP內統計以本次來源清單為基線；後續若把ZIP清單回存儲存庫，須先將工作流程的增量計數改成依候選ID去重重算，避免重跑加算。

最後核對：2026-10-13。工作環境仍回報 pending/offline；本批實際由 GitHub Actions 完成 Blender 製作與檢查。這份清單保存續作位置，不代表其餘車站已在背景自動建模。
