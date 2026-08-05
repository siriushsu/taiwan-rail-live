# Android 平台差異盤點

日期：2026-08-05

範圍只含根目錄 `index.html` 與 `app/src/native-bridge.mjs` 的平台差異；階段二結論已回填。可在無憑證 Debug APK 驗證的項目均已有實測結論；必須依賴後台設定的項目明列為本階段驗不了，不以推論冒充成功。

| 項目 | iOS 現況（檔案:行號） | Android 是否需要 | 建議做法 | 風險 |
|---|---|---|---|---|
| Capacitor 平台分支／小工具地點同步 | `native-bridge.mjs:9,17-22` 只在 iOS 註冊 `RailPlaces`；`index.html:7320-7344` 只在 bridge 存在時把地點同步給桌面小工具 | 現階段不需要；若 Android 要桌面 Widget 則需要 | Android 殼先維持 bridge 缺席的 no-op；下一階段若排 Widget，再做 Android App Widget 與專用 bridge，不要假裝已支援 | 中：核心 App 不受影響，但 iPhone 已有的小工具功能在 Android 缺席 |
| Apple 登入撤銷憑證 | `native-bridge.mjs:24-35`：iOS 取 `authorizationCode`，其他平台取 `accessToken`；`index.html:6928-6935,6992-7011` 在原生重驗後撤銷 Apple token | **本階段驗不了：缺 Firebase Android 後台設定** | 本輪無 `google-services.json` 且 `ACCOUNT_ENABLED=false`，不能啟動真實登入／刪帳鏈；Firebase Android 設定齊全後實測 Apple 登入、重新驗證與刪帳，確認 provider 回傳的 `credential.accessToken` 可供撤銷 | 高：帳號功能日後啟用時，失敗會卡刪帳合規流程；不得用假設定或 iOS key 代測 |
| RevenueCat 平台 key | `native-bridge.mjs:73-95` 已依 iOS／Android 選 `iosApiKey`／`androidApiKey`，缺 key 就不掛 Plus adapter | 程式分支已備妥；設定待後台 | 取得正式 Android public SDK key 後只注入 runtime 設定，再測 configure／purchase／restore；本階段留空 | 高：填錯或沿用 iOS key 會使付款不可用；目前 Plus 入口仍關閉 |
| 音訊音量 | 階段二已把首繪 class 改為只對 iOS 加 `music-volume-unavailable`；CSS 仍隱藏 iOS 滑桿，實際音量仍由既有 `audio.volume` 與淡入淡出流程控制 | **已實測、已修正** | Pixel 7／Android 15 WebView 實際播放：設定 `1.0→0.3`，立即與 750 ms 延遲讀回皆為 `0.3`；AudioFlinger speaker power 下降 `10.4 dB`，符合預期 `10.46 dB`。保留 Android 滑桿，iOS 行為不變 | 低：安全 APK 不含正式音樂檔，測試以同 WebView 本地 PCM 音訊驗證平台能力；正式音樂資產回歸留到含資產 build |
| 安全區／瀏海／手勢列 | `viewport-fit=cover`、top 避讓與底部 `env(safe-area-inset-bottom)` 維持現況 | **已實測通過** | Pixel 7／Android 15 edge-to-edge 實際切換手勢與三鍵導覽並截圖：header 均在狀態列下，tab bar 分別在 gesture pill／三鍵區上方，無遮擋 | 低：本輪覆蓋單一 Pixel 7 AVD profile；異形折疊螢幕尚未覆蓋 |
| 鍵盤與搜尋 sheet | 搜尋仍採上下錨定與既有 focus／blur 流程 | **已實測，有已知缺陷** | 直式 IME 搜尋結果完整可見；橫向 IME 時 viewport 高僅 122 px，輸入框與結果落到鍵盤後方。Android Back 可先收鍵盤並恢復結果。依本輪邊界只記錄、不修 | 中：橫向使用搜尋時結果不可見；後續應評估橫向 compact 版面或最小高度／捲動策略，不先加 Keyboard 外掛 |
| iOS pinch 補擋 | WebKit `gesturestart/gesturechange` listener 保持不變 | **Android 已實測通過** | Android WebView 雙觸點張開後 Leaflet zoom `8→10`；`visualViewport.scale=1`、頁面寬度維持 412，證明只縮放地圖、不縮放頁面。不需 Android 專屬修法 | 低：事件由 CDP 送進 WebView 的雙觸點，未覆蓋特定廠牌觸控韌體 |
| 開機定位與請求時機 | 原生開機仍先低精度 `getCurrentPosition`，使用者點附近車站才請求高精度 | **已實測通過（API 35）** | 清資料後分別走完整同意、拒絕、Keep approximate：Fine/Coarse 分別為 true/true、false/false、false/true；三路核心地圖都已在 prompt 後方載入。precise 與 coarse 都能開附近站，coarse 顯示較大精度圈；拒絕改用落釘 | 中：本輪只覆蓋 Android 15／API 35，Android 13、14、16 的 permission controller 文案／流程仍需未來裝置矩陣補測 |
| 定位拒絕後指引 | 階段二已以 Android UA + `IS_NATIVE_APP` 分流；原生 bridge 的 `openSettings` 仍為 null | **已實測、已修正文案** | Android App 連續拒絕開機約略定位與附近車站精確定位後，toast 顯示「系統設定→應用程式→軌島→權限→位置允許」；截圖確認不含「網址列」。一般 Android 網頁與 iOS 文案不變 | 低：沒有開設定頁按鈕，仍需使用者手動走系統設定；另保留「釘」手動落點退路 |
| GPS 連續取樣與前景恢復 | `native-bridge.mjs:40-44` 只提供前景 watch／clear；`index.html:11236-11256` 原生優先、瀏覽器 fallback；`:8918-8942` 回前景重取 wake lock 並重錨時鐘 | **已實測通過（API 35 precise）** | 原生 watch 收到 5 m accuracy fix；Home 背景與熄屏時 `document.hidden=true` 的 callback 都是 0，回前景與喚醒後各恢復收到新座標；`clearWatch` 後再次移動 callback 數不再增加。證據 `gps-bridge-audit.json` | 中：功能目前旗標關閉；只覆蓋 Pixel 7 AVD，OEM 省電策略可能不同，功能重啟前仍應補實體機長時間測試，不加入背景定位權限 |
| 本地通知權限時機 | `native-bridge.mjs:50-67` 提供 check/request/schedule；`index.html:13104-13135,13199-13215` 先 check，只有使用者按儲存並通過 primer 後才 request | **已實測通過（Android 15／API 35）** | 首次為 `prompt`；實際拒絕回 `denied`，隨後 `prompt-with-rationale` 可重試並允許。產品 sheet 真觸控「設定提醒」先出 primer，確認後才出系統 prompt；允許後排程 2551 次提醒。另以 7 秒排程確認通知實際送達，cancel 後 pending 移除，測試提醒已清乾淨 | 中：Android 12 以下的直接 granted 分支本輪沒有對應映像，明確未覆蓋；`openSettings:null` 仍只有文字退路，非精確 alarm 在省電模式可能延遲 |
| 原生分享 | iOS／Android 共用 Capacitor Share，原生失敗才退 Web Share／clipboard | **Android 已實測通過** | 畫面分享與 `?tripshare=1` 行程分享都開 Android Chooser；Back 取消都回 MainActivity。停用全部 9 個 text/plain handlers 後顯示系統 `No apps can perform this action.`，無 crash；隨後 handlers 已全數恢復 | 低：本輪驗證系統 preview／取消／零 targets，未把內容真正送進第三方 App，因此各 target 如何顯示 URL/text 仍由對方實作決定 |
| 原生 WebView 的 in-app-browser 誤判 | `Capacitor.isNativePlatform()` 仍在外部瀏覽器偵測前排除原生殼 | **Android 已實測通過** | UA 雖含 Android `wv`，實測 `#iabHint.hidden=true`、按鈕數 0、rect 0×0，沒有逃生卡。一般 LINE／IG WebView 路徑本輪不在原生 APK 內模擬 | 低：若未來 bridge 注入時序改變需再回歸；目前首載正常 |

## 下一階段優先順序

1. 優先處理本輪發現的橫向 IME 搜尋內容被鍵盤覆蓋；此缺陷已留證但依階段二邊界未修。
2. Firebase／RevenueCat 正式 Android 設定取得後，才驗登入撤銷與購買恢復；不要用假設定測通流程。
3. GPS 校正功能重新開旗標前補 OEM 實體機長時間背景／熄屏矩陣；通知另補 Android 12 以下與省電延遲矩陣。
