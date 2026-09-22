# 驗收閘門：觀看面板搬家後的入口失效與殘留紅 — 2026-09-18

## 起因

v0914c（`31452e3b`）把 3D、底圖、日夜光影、列車光環、字級、背景音樂等設定列從「更多」抽屜搬進「觀看」面板（`rail-3d/integration/view-controls.js`）。
至少 18 支瀏覽器驗收腳本仍先開「更多」再真點這些列，**從 09-14 起全部卡在入口逾時**；
逾時被當成一般紅，入口後面的判準四天沒有被量過，期間其他改動（v0914b 構圖、v0912o 平坦橋面等）讓部分判準過期也沒人發現。

新入口（同 `verify_view_controls`）：桌面 `.view-rail [data-view=KEY]`；手機 `#viewSettingsBtn` → `.view-tabs [data-view=KEY]`；關閉 `.view-close`（點到 `data-close`、`track`、`fontscale`、`immBtn` 會自己關，所以一律「可見才點」）。
分頁 KEY 與各列歸屬以 `view-controls.js` 的 `categories` 為準。

## 已修並驗過

| commit | 內容 | 驗證 |
|---|---|---|
| `aa7eb0ee` | `verify_3d_integration` 入口＋平面車高判準（寫死 .65 → 對開地形前同班同座標的量測） | 雙引擎 × 桌面＋6 寬 74/74；突變兩條各自轉紅、控制組全綠 |
| `82e81761` | 3d_framing／rail_grounding_browser／rail_levels_mobile／rail_structures_browser／satellite_buildings 入口；接地閘門平坦期望改讀 `flatOffsetM` | structures 60/60；grounding 966445954 flat 轉綠，突變（平坦改回 `offsetM`）雙引擎轉紅 |
| `c79f81d3` | 另 12 支入口（只動入口與作用域，未改期望值） | 6 支全綠：glass_priority、map_orientation、metro_compact_alias、sat_retina、train_halo、ambient_lock |
| `9fa703f8` | **產品**：開著車站卡也能按「觀看」（09-18 使用者裁示「應該開著車站卡要能看」）——隱藏條件拿掉 `.sheet-open`，收面板觀察器改成只在狀態「剛出現」時收 | view_controls_gate 26／view_controls 415／immersive 8／layers 30 全綠；突變 CSS 層→鈕 `visibility:hidden`、閘門轉紅；突變 JS 層→鈕可點但面板立刻被自己關掉、閘門轉紅；控制組全綠。直式 360～414、橫式 844×390／667×375、小手機＋大／特大字級＋卡片中段 18 格都點得中 |
| `63afe5e3` | verify_sunlight_controls 三處過期判準 | 雙引擎 14/14。①公告改走 `renderAlertBanner`（手機只亮頂列 ⚠ 鈕），並只量 fs=true（手機殼不能退出全畫面）；②偏好鍵改讀 `SUNLIGHT_PREF_KEY`＋外觀後綴；③「關閉偏好保留」原本空轉（明亮外觀預設就是關，從沒點下去），改成先開、重載驗開，再關、重載驗關 |

## 殘留紅（入口已通過，紅在後面）

分類依 judgment §7.8：**過期判準**／**環境**／**產品行為**／**未定**。
本輪實跑時本機 load average 10～14（另一個 session 同時在跑 ship-web 與 Android 模擬器），逾時類結果須在閒置時重跑才算數。

| 腳本 | 紅 | 分類 | 證據 | 下一步 |
|---|---|---|---|---|
| verify_3d_framing | 三節示意維持原構圖、俯視維持整列中心（要求 `distanceM===0`） | 過期判準 | v0914b `f8cfd20b` 拿掉「非完整編組不移注視點」，註解明寫「不能以側看程度關掉正面與俯視構圖」 | 改驗 v0914b 契約：車頭完整在畫面內（`fits`）＋車輛座標不變 |
| verify_3d_framing | 360～414 手機側面 z20 車頭不裁切 ×8（雙引擎） | 未定，疑環境 | 腳本以 1280 開頁再縮到 360，量到 `padding.left=192`（手機不合理，像桌面跟車卡留白殘留） | 對照「全新 360 頁」與「1280 縮 360」；注意 `select()` 在窄畫面找不到候選車，對照組要改用網址帶入的 117 次 |
| verify_rail_grounding_browser | 103544834 terrain（surface 案例整條 way 要零橋墩） | 過期判準 | 該 way 端點緊鄰真橋 966452189／966452190（`kind=bridge`，地形高 33.57 vs 33.35），共用節點帶高而蓋出 3 段橋面 1 墩；列車本身貼地（lift −0.17～0.28） | 判準改成「列車所在範圍下方沒有結構」，不要整條 way 計數 |
| verify_satellite_buildings | 起伏地形保持完整原貌 ×4（chromium 360/375/768、webkit 1280） | 未定 | 各寬度時有時無，像 DEM 載入競態；另 2 條啟動逾時（兩引擎並行＋高負載） | 失敗當下再等數秒重量：收斂＝量太早（判準要等完成訊號）；不收斂＝建物卡在舊地面高度（產品 bug） |
| ~~verify_sunlight_controls~~ | ~~車站卡＋觀看面板仍可操作~~ | 已修 | 09-18 裁示後修產品（`9fa703f8`）；另外兩格是閘門自己造出手機不存在的橫幅／非全畫面狀態（`63afe5e3`） | — |
| ~~verify_sunlight_controls~~ | ~~分享連結 `sun=on` 覆蓋本次偏好~~ | 過期判準，已修 | 讀的是 v0912 前的舊偏好鍵（恆 null）；`sun=on` 本身正常（實測 `enabled:true`）。先前記「`enabled` 為假」是從 AND 在一起的單一布林誤推的。同批發現「關閉偏好保留」是空轉通過（`63afe5e3`） | — |
| verify_landscape_basemap | 768 手機流程 | 疑產品 | 該狀態下 `.view-rail` 可見但地圖 canvas 攔截點擊（乾淨 768 頁側欄是 `display:none`） | 重現那個狀態，確認側欄是否真的會被地圖蓋住；其餘兩條為負載逾時 |
| verify_font_scale | F4 小字倍率比主倍率溫和 | 未定 | std：small 1.00 vs main 0.96；large：1.14 vs 1.20 | 查字級倍率設計是否已改 |
| verify_font_scale | O3／O5／Q5 更多抽屜結構 | 過期判準 | 更多改版後分組標題變成 7 組（含「其他設定」）、部分列高 30 | 依新抽屜結構重寫 |
| verify_font_scale | K12 webkit 再點跟隨中的車 | 未定 | 只 webkit | 單獨重跑 |
| verify_sunlight_browser | 四時段天空色差、光源讀數 undefined | 未定 | 四時段天空同為 ≈212 灰；`readings[6].light` undefined | 閒置時重跑，再判環境或回歸 |
| verify_plus_ctas | W2* 小工具說明文案 | 過期判準或文案回歸 | 說明頁小工具那節沒有「自動選站／多站／需要通行證」等字樣 | 對照現行說明文案決定 |
| verify_plus_ctas | 無 JS 例外 | 環境 | OpenFreeMap sprite 請求被中止 | 閒置重跑 |
| verify_rail_levels_mobile | 啟動逾時 90s | 環境 | 兩次各在不同寬度（768、414），其餘 21/22 過 | 閒置重跑 |
| verify_tunnel_mobile | 啟動逾時、`railIslandIntegration is not defined` | 環境 | 高負載下 | 閒置重跑 |

## 未處理

- `scripts/verify_batch1.mjs`：v0718i 那一批的一次性驗收（HEAD 對工作樹視覺零變化），沒有任何腳本或出貨鏈引用。D 段量的 `.ms-row[data-proxy="satBtn"]` 已不存在，C 段的鍵盤走訪依賴已搬走的列。重寫或退役待決定。
- 出貨鏈（`scripts/ship_web.mjs`）只跑 `verify_font_scale` 的 F0 靜態段，以上瀏覽器腳本都不在出貨鏈上——所以四天沒被擋下來，也不會擋別人出貨。
