# Android 平台差異盤點

日期：2026-08-04

範圍只含根目錄 `index.html` 與 `app/src/native-bridge.mjs` 的現況；本階段不實作。`待驗` 代表必須在可執行 Android Debug APK 的真機／模擬器確認。

| 項目 | iOS 現況（檔案:行號） | Android 是否需要 | 建議做法 | 風險 |
|---|---|---|---|---|
| Capacitor 平台分支／小工具地點同步 | `native-bridge.mjs:9,17-22` 只在 iOS 註冊 `RailPlaces`；`index.html:7320-7344` 只在 bridge 存在時把地點同步給桌面小工具 | 現階段不需要；若 Android 要桌面 Widget 則需要 | Android 殼先維持 bridge 缺席的 no-op；下一階段若排 Widget，再做 Android App Widget 與專用 bridge，不要假裝已支援 | 中：核心 App 不受影響，但 iPhone 已有的小工具功能在 Android 缺席 |
| Apple 登入撤銷憑證 | `native-bridge.mjs:24-35`：iOS 取 `authorizationCode`，其他平台取 `accessToken`；`index.html:6928-6935,6992-7011` 在原生重驗後撤銷 Apple token | 需要，待驗 | Firebase Android 設定齊全後實測 Apple 登入、重新驗證與刪帳；確認 Android provider 回傳的 `credential.accessToken` 可供撤銷 | 高：帳號功能日後啟用時，失敗會卡刪帳合規流程；目前 `ACCOUNT_ENABLED=false` |
| RevenueCat 平台 key | `native-bridge.mjs:73-95` 已依 iOS／Android 選 `iosApiKey`／`androidApiKey`，缺 key 就不掛 Plus adapter | 程式分支已備妥；設定待後台 | 取得正式 Android public SDK key 後只注入 runtime 設定，再測 configure／purchase／restore；本階段留空 | 高：填錯或沿用 iOS key 會使付款不可用；目前 Plus 入口仍關閉 |
| 音訊音量 | `index.html:2902-2912` 對「iOS 或任何 native App」都加 `music-volume-unavailable`；CSS 於 `:445-446` 隱藏滑桿；實際音量仍由 `:9092-9117,9147-9164` 寫 `audio.volume` | **需要修正，待 Android WebView 實測** | 先在 Android WebView 實測滑桿與淡入淡出；若正常，平台 class 只對 iOS 加入，不要以 `nativeApp` 一刀切 | 中：目前 Android 會無條件失去 App 內音量滑桿，即使 WebView 支援；系統音量鍵仍可用 |
| 安全區／瀏海／手勢列 | `index.html:5-7,118-125` 開 `viewport-fit=cover` 並避讓 top；底部 tab bar／sheet 用 `env(safe-area-inset-bottom)`（`:2240-2268,2491-2504,2551-2568`） | 需要，待驗 | 在挖孔螢幕、三鍵導覽、手勢導覽與 Android 15+ edge-to-edge 各測一次；若 WebView 的 CSS env 為 0，優先用現有 CSS 變數注入 WindowInsets，避免到處新增常數 | 高：頂部可被狀態列遮住、底部可被手勢列蓋住；現有規則主要由 iPhone 真機問題演進而來 |
| 鍵盤與搜尋 sheet | `index.html:2525-2534` 為避免 iOS 鍵盤蓋住底部輸入框，把搜尋改成上下錨定；`:14484-14502` 同步 focus／blur 控制鍵盤 | 需要，待驗 | 先確認 Android Activity 預設 resize 行為、旋轉與返回鍵收鍵盤；若仍遮擋，再考慮 manifest `adjustResize`，不要先加 Keyboard 外掛 | 中：Android 若採 pan 或 edge-to-edge resize 不符預期，搜尋結果可能被 IME 蓋住或高度跳動 |
| iOS pinch 補擋 | `index.html:5-7,8945-8948` 用 WebKit `gesturestart/gesturechange` 補 Safari 忽略 viewport 的問題 | 不需 Android 專屬對應；待回歸 | 保留目前 listener；Android 只驗頁面 pinch 被 viewport／touch-action 擋住、Leaflet 地圖 pinch 仍可用 | 低：若 Android 事件模型受這段意外影響，可能傷害地圖縮放，但預期 WebKit 專有事件不觸發 |
| 開機定位與請求時機 | `native-bridge.mjs:38-48` 暴露原生 geolocation；`index.html:6113-6119,6157-6170,16060-16064` 在原生開機早期以低精度 `getCurrentPosition` 觸發權限；`:6184-6207` 使用者開附近車站時才高精度 | 需要，現有共用流程可用但待驗 | Android 13–16 首次啟動、拒絕、只給粗略位置、之後改精確位置都測；確認開機 prompt 不阻塞核心地圖 | 高：首次開機即詢問定位可能影響接受率；只給 coarse 時附近站精度與 GPS 校正流程要能清楚降級 |
| 定位拒絕後指引 | `index.html:6214-6229` 依 UA 顯示 iPhone／Android 網站設定文字；原生 bridge 的 `openSettings` 目前為 null（`native-bridge.mjs:45-47`） | **需要修正** | 原生 Android 被拒絕時不要顯示「網址列旁圖示」；下一階段加入明確 App 設定指引，或評估一個最小、可審核的開設定頁原生方法 | 中：功能有手動落釘退路，但目前 Android App 指引錯誤，使用者難以恢復權限 |
| GPS 連續取樣與前景恢復 | `native-bridge.mjs:40-44` 只提供前景 watch／clear；`index.html:11236-11256` 原生優先、瀏覽器 fallback；`:8918-8942` 回前景重取 wake lock 並重錨時鐘 | 需要，待驗 | Android 只以前景精確定位驗證開始／停止、切背景／回前景、螢幕熄滅；不要加入背景定位權限 | 高：若 Activity 暫停後 callback／watch id 行為不同，可能漏樣或停止鈕清不掉；功能目前旗標關閉但程式保留 |
| 本地通知權限時機 | `native-bridge.mjs:50-67` 提供 check/request/schedule；`index.html:13104-13135,13199-13215` 先 check，只有使用者按儲存並通過 primer 後才 request | 需要，現有時機合理，待驗 | Android 13+ 驗證 primer→系統 prompt、拒絕後重試與排程；Android 12 以下確認 request 直接 granted；維持不加 exact-alarm 權限 | 高：拒絕後 `openSettings:null` 只剩文字退路；非精確 alarm 在省電模式可能延遲 |
| 原生分享 | `native-bridge.mjs:69-71` iOS／Android 共用 Capacitor Share；`index.html:16715-16737,16777-16790` 原生失敗才退 Web Share／clipboard | 需要，現有共用 bridge 應可用，待驗 | 在 Android 分享目前畫面與行程，驗取消、沒有可接收 App、URL/text 預覽；不新增儲存／媒體權限 | 低：目前只分享文字與 URL，權限面小；不同 share target 可能忽略部分欄位 |
| 原生 WebView 的 in-app-browser 誤判 | `index.html:17136-17157` 已先用 `Capacitor.isNativePlatform()` 排除 iOS WKWebView 與 Android WebView，再做外部瀏覽器逃生提示 | 不需新增；要回歸 | Android Debug APK 驗證不顯示「用瀏覽器開啟」逃生提示；一般 LINE／IG Android WebView 仍應顯示 | 中：若 bridge 注入時序改變，App 自己可能被誤判成外部 in-app browser |

## 下一階段優先順序

1. 先修／驗 Android 音量 class 與定位拒絕文字，兩者是目前程式碼可直接看出的 Android 體驗差異。
2. 再做 edge-to-edge、安全區、鍵盤與前景定位的真機矩陣；這些不能只靠桌面瀏覽器推論。
3. Firebase／RevenueCat 設定取得後，才驗登入撤銷與購買恢復；不要用假設定測通流程。
