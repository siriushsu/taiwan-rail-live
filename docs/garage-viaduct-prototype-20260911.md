# 西部幹線高架・月台：一車一景樣板 03（帶參數的場景原型）

2026-09-11，基於 `4d7ccca6`，工作樹 `.claude/worktrees/garage-scene-03`（分支 `garage/scene-03`）。

## 預覽

```sh
# 同一棵工作樹，伺服器已啟動（5251／5252 是既有的南迴海岸／阿里山林鐵）
python3 -m http.server 5253 --bind 127.0.0.1
```

開啟 `http://127.0.0.1:5253/prototypes/garage-viaduct/`。右上可返回同一工作樹的阿里山林鐵。

桌面預設高架全景；手機首次開啟預設跟車。可切換平原晴日／黃昏側光／月台夜燈、暫停、拖曳旋轉、雙指縮放與鍵盤。這個場景沒有折返，是固定單向的環線，約 60 秒一圈（弧長 126.27 單位 ÷ 每秒 2.1 單位）。「看月台」把列車直接停在月台正中央並暫停播放，方便端詳編組與雨棚。

## 視覺與實作

- 沿用 EMU3000 既有三節模型（頭尾對稱雙駕駛室＋中間車）。manifest 本身就是完整三節編組，不會觸發 `createConsist` 給單一動力車補兩節藍皮客車的預設邏輯；沒有新增或改寫模型資產。
- `rail-3d/garage-scenes/viaduct.js` 是第一個「場景原型＋參數」：`createScene(params)` 接受 `platformLength`／`pierHeight`／`pierSpacing`／`canopy`（`'modern'` 薄平頂／`'simple'` 單斜頂）／`backdrop`（`'coast'` 靠海／`'fields'` 水田）／`label`，未傳參數時等同 EMU3000 那組預設值。本頁 `main.js` 用預設值建場景；不同參數只在驗證腳本裡建立獨立實例測試，不影響這個頁面顯示的場景。
- 路徑模型比照南迴海岸：單一環線 `scene.path`（`path.sample(s)` 回 `{x,y,z,heading}`、`path.length`），沒有阿里山那種多支路折返 `journey`。車廂跟隨改用 `consist-3d.js` 的 `createTerrainFollower`（依前後轉向架的 3D 取樣建立車身座標基底），不是 `garage-model.js` 內建的平面 `train.follow()`；這個場景本身是平的，俯仰角固定為 0，是預期行為。
- 高架橋面、月台、雨棚、站房、樹木與小屋皆為程式生成並以 `InstancedMesh` 合批；`backdrop`／`canopy` 參數切換的是實際材質與方塊數量（例如水田用 9 個色塊、海景另外多繪一片帶 shader 波浪的海面＋26 顆礫石），不是只換顏色的假參數化——驗證腳本的三角形計數證明了這點。
- 「看月台」按鈕把 `distance` 設為 0：`viaduct.js` 的 `sample(0)` 正好落在前直線中點、面對月台，這是既有座標系本身的性質，不是另外指定的錨點。
- 除錯介面 `window.viaductPreview` 比照阿里山／南迴海岸的形狀，但方法名稱依任務指示採用 `setTime(t)`（不是南迴海岸的 `setDistance`）：`time` 與 `distance`（沿路徑前進的弧長）用同一個係數 `SPEED=2.1` 綁定，`setTime(t)` 同時設定 `time=t` 與 `distance=t*SPEED`，等同於「跳到播放進行到第 t 秒時的狀態」，與逐幀播放的自然關係一致。
- 直接繪製到獨立 WebGL canvas，不載背景地圖；暫停／背景分頁停止動畫，離頁釋放資源；WebGL 中斷提供重新開啟。
- 目前是獨立展示頁；`prototypes/` 受既有部署排除規則保護，正式車庫、其 catalog 及 index.html 未修改。
- `viaduct.js` 本身在這輪沒有被修改——驗證過程沒有發現需要修的 bug。

## 驗證

`node scripts/verify_garage_viaduct.mjs`，結果與截圖在 `output/viaduct/`（不進版控）。**50 項，PASS 50，FAIL 0**（Chromium／WebKit 各跑一輪）。

- 純路網數學（不需瀏覽器，直接在 Node 匯入 `viaduct.js`）：環線取樣 2000 點沿路徑無跳動；繞完一圈回到起點，座標與朝向逐位元相同。
- EMU3000 三節編組（頭―中―尾）身分確認；三節車體的實際像素 A/B（比照阿里山做法，量真實渲染像素，不是讀設定值），每節都有 30 像素以上的可見差異。
- 三個時段不只比對 `state.period` 變數，另外把畫面縮成 24×16 網格取平均色，任兩個時段的畫面都有 40 格以上（共 384 格）實際不同。
- 跟車視角三節完整構圖；全景視角在環線四個代表位置（起點、四分之一、二分之一、四分之三）分別用 `setTime` 跳過去驗證，三節車都完整落在畫面內——不是只驗證當下任意時刻。
- 「看月台」實際點擊後確認車廂停在 `distance===0` 且 `running===false`。
- 🔴 參數化證明（在頁面裡用動態 `import()` 直接載入 `viaduct.js`，不是讀原始碼推論）：預設／`{platformLength:9}`／`{backdrop:'fields',canopy:'simple'}` 三組參數的三角形總數彼此不同（12396／12312／12106）；`scene.params` 逐欄反映傳入值；四次建構（含一組刻意重複預設參數的正向對照）都能 `dispose()` 且 `group.children` 歸零。正向對照那兩組（都用預設參數）三角形總數完全相同（12396＝12396），證明這個計數判準本身有鑑別力，不是「不等於 0」式的恆真斷言。
- 360／375／390／414／520／768／1280 px 真觸控：全按鈕（含新的「看月台」與返回阿里山連結）命中、尺寸 ≥43px、兩兩不相交、無水平溢出。
- 視角與時段各切換 3 輪，`renderer.info.memory` 的 geometries／textures 不累積；暫停後 250ms 內 `draws` 計數不變（不重繪）；手機視窗＋減少動態偏好下預設跟車且不播放。
- 無 JS／WebGL 主控台錯誤（Chromium／WebKit 皆 0 筆）。
- 回歸檢查：同輪重跑既有 `verify_garage_alishan.mjs`（42 PASS／0 FAIL）與 `verify_garage_south_coast.mjs`（42 PASS／0 FAIL），確認本輪新增檔案沒有弄壞既有兩個樣板。

尚未驗證：A54／iPhone 真機長時間效能與耗電——桌面／手機模擬的畫面正確不代表真機效能，這點與阿里山、南迴海岸兩個樣板的既有限制相同。夜間車窗／月台燈的視覺強度沒有另外量化，只驗證了「三時段畫面確實不同」這個較弱但可靠的訊號。四組參數化測試涵蓋 `platformLength`／`backdrop`／`canopy` 三個欄位；`pierHeight`／`pierSpacing`／`label` 三個欄位目前只驗證了 `params` 正確回顯，沒有另外對三角形計數或視覺做交叉驗證。

## 參考

- 使用者提供《收藏車庫：一車一景（場景系統）設計書》：以共用場景介面為方向；這是第一個實作「場景原型＋參數」的樣板，供沒有專屬場景的車款之後共用。
- [Blair Yu／EMU3000 原始攝影文章](https://blair-train.blogspot.com/2019/12/emu3000-tra-emu3000-type-electric.html)：`rail-3d/assets/blender-map-v1/manifest.json` 中 `emu3000` 條目列出的車型來源之一。
- [Hitachi：台灣鐵路 EMU3000 設計資料](https://www.hitachi.com/rd/research/design/product/taiwan_tra/index.html)：同一 manifest 條目列出的官方設計與車輛資料來源。
