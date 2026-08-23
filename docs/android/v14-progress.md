# 軌島 Android v14 進度

更新：2026-08-23

## 1.4.10／versionCode 15 修正版

2026-08-23 複查發現，Android v14 合併時以 iOS build 75 的整份 `index.html` 覆蓋 App 分支，造成已經在舊版完成的 App 專屬功能與地圖同步修補一併遺失。這次直接找回既有實作，不另造第二套行為：

- 補回跟車面板的鎖定畫面通行證倒數入口（`renderLaCta`／`#fpLaCta`）。
- 補回衛星底圖高解析通行證提示（`maybeSatPlusNotice`）。
- 補回方案面板的「捷運小工具放多站／自動最近的站」項目。
- 補回使用說明中心的「捷運小工具」與「在這站等車」章節。
- 補回 App 前景持續定位與定位鏡頭跟隨。
- 補回 11 組先前遺失的 App 更新紀錄，另新增本次修正版公開紀錄。
- 補回既有地圖跨層同步修正：MapLibre 重繪、Leaflet move 同步繪製、縮放校準及 gesture 收尾，避免底圖、軌道、車輛在拖曳或縮放時脫鉤。

修正版使用 `versionName 1.4.10`、`versionCode 15`。Google Play 已存在 versionCode 14，因此修正版不能沿用 14；iOS 專案仍維持 1.4.9 (75)，Android 版號由打包參數獨立注入。

### 修正版驗證

```text
通行證 CTA：97/97 PASS（Chromium + WebKit）
App 功能：101/101 PASS（360/375/414/768、真實 touch）
持續定位與鏡頭：110/110 PASS（Chromium + WebKit）
WebKit 地圖 drag/pinch：2/2 PASS，跨層誤差分別不超過 0.9px／0.7px
Chromium 地圖直接數值 gate：跨層誤差不超過 1.0px，縮放比例正確
verify-release：PASS，v0823f，178 檔，146.3 MB
Gradle clean assembleRelease bundleRelease：BUILD SUCCESSFUL（346 tasks）
Android 15 Pixel 7 Play 模擬器：安裝、冷啟動、定位權限、使用說明實際觸控均通過
logcat：0 筆 FATAL／AndroidRuntime／Chromium error／Capacitor Console ERROR
```

Chromium 的 `pinchpan` screencast 影像配對 gate 仍量到約 6px 瞬時差，但同時期在未改動的舊修正版分支也能穩定重現；兩邊的直接跨層數值均為 1px 內、縮放倍率一致，WebKit 的 drag／pinch 影像 gate 也全綠，因此判定為目前 Chromium CDP compositor 擷取時序差異，沒有把它誤報成 7/7 通過。

### 修正版產物

```text
app/android/app/build/outputs/apk/release/app-release.apk
  SHA-256=f451815d75a7b3ac537cb66f6690ef01fbe9140e055b9489b60052b6c4c0362e

app/android/app/build/outputs/bundle/release/app-release.aab
  SHA-256=b05f8ad027302f2e704c015729d22973800f71bae4fbd44197492a6422b3ea33

APK／AAB manifest：tw.railisland.app，versionName=1.4.10，versionCode=15
APK：apksigner v2=true，upload key certificate SHA-256=3836e4…
AAB：jarsigner `jar verified`
app/www 與 Android native public index MD5：88e033d7115d46b4983b9b1aa9f8c02a
```

修正版尚未上傳 Google Play 封閉式測試；必須以 versionCode 15 新增 release，不能覆寫已存在的 versionCode 14。

## v14 原始驗收記錄（已由上方修正版取代）

## 目前結論

- **Android v14 已完成實作、實機驗收與 signed release 出包。**
- 指定 worktree、分支與基底正確；JDK 21／Gradle 正常；預置依賴與簽章設定存在。
- 正確主站 API `https://railisland.tw/api/trtc-live` 在提高權限後可連線。
- 任務提供的快照契約成立：`board[]` 318 列，其中 225 列帶 `eta2`、93 列沒有。
- versionCode 已升為 14，versionName 維持 1.4.9。
- Android 已完成 `eta2` 合成 approx 列、快取旗標往返、`ceil` 分鐘與過期留白；官方列保留既有 `floor` 規則。
- 精度 gate 控制組有效：暫時突變成 `04:00` 後三條判準同時變紅，還原後全綠。
- web bundle 已以 feature 模式重建並 `cap sync android`；app/www 與 Android assets 的 `index.html` MD5 相同，bundle 身分為 v0822a。
- API 35 Pixel 7 Play 模擬器 instrumentation tests 2/2 通過；桌面實掛小工具的 eta2 正向與無 eta2 負向截圖均已保存。
- Android 強制更新閘門已實際注入、點擊：全螢幕遮罩可見，外開 Intent 為 Google Play 軌島頁。
- 既有地圖與等車通知已回歸：地圖顯示 182 班奔跑中；台北車站由「追蹤這站」實際點擊後，Web、native 與通知列三層均顯示 active，測後已由產品停止流程清除。
- 最終 `clean assembleRelease bundleRelease` 成功（346 tasks）；release APK 與 AAB 均已用預置 upload key 簽章，版號為 1.4.9 (14)。
- APK 以 build-tools 36 的 `zipalign -c -P 16 4` 驗證通過，APK／AAB 均無原生 `.so`，16 KB page size 維持通過。
- Data safety 不變：相對基底沒有 AndroidManifest／package 依賴變更；release 權限集合沒有因本批 approx 功能增加蒐集或 runtime 權限。

## 關鍵證據

工作樹與 Git：

```text
pwd
/Users/xuxiang/Code/捷運小動畫/.claude/worktrees/android-v14/app/android

git branch --show-current
codex/android-1.4.9-v14

任務基底
4ae2cf1
```

Gradle／Java：

```text
Gradle 8.14.3
Launcher JVM: 21.0.12 (Homebrew 21.0.12)
Daemon JVM: /opt/homebrew/Cellar/openjdk@21/21.0.12/libexec/openjdk.jdk/Contents/Home
OS: Mac OS X 27.0 aarch64
```

預置項目：

```text
app/node_modules=present
app/android/key.properties=present
app/android/app/google-services.json=present
```

網路與 fixture 自檢：

```text
GET https://railisland.tw/api/trtc-live
HTTP 回應 JSON，src=trtc

docs/android/fixtures/trtc-live-sample-20260822.json
bytes=449250 board=318 eta2=225 withoutEta2=93
```

原生邏輯 gate：

```text
正常實作：八種狀態 gate 全過（含 eta2「約 N 分」與 mm:ss 反向判準）
突變實作：FAIL 3
  eta2 次班只准顯示「約 N 分」，實得 再下班 04:00 分
  夜行看板的 eta2 次班也必須帶「約」，實得 04:00
  eta2 次班絕不准出現 mm:ss 秒級倒數
還原實作：八種狀態 gate 全過
```

bundle／模擬器：

```text
app/www/index.html MD5                         8b642a8dea5d73a8d03d1fdf7c9cef15
app/android/.../assets/public/index.html MD5  8b642a8dea5d73a8d03d1fdf7c9cef15
bundle BUILD                                  v0822a
instrumentation                              OK (2 tests)
```

實掛小工具：

```text
docs/android/shots/v14-widget-eta2-approx.png  台北車站：再下班 約 9 分
docs/android/shots/v14-widget-no-eta2.png      萬芳醫院：第二班整行留白
快取 snapshot                                 approx:true round-trip；負向 snapshot 僅 1 列
```

強更／既有功能：

```text
docs/android/shots/v14-force-update-gate.png
  appGateCheck({minAppVersion:'99.0.0'})：全螢幕「需要更新」
  ADB 真實點擊後 resumed=com.android.vending
  Intent=https://play.google.com/store/apps/details?id=tw.railisland.app

docs/android/shots/v14-map-live-trains.png
  v0822a、182 班奔跑中、canvas overlay 有非透明內容

docs/android/shots/v14-notification-tracking.png
  台北車站「追蹤這站」→「最快一班」均以 ADB 實際點擊
  Web state／RailMetroWait.status() 均 active；Android NotificationRecord id=46301
```

最終 release 產物：

```text
app/android/app/build/outputs/apk/release/app-release.apk
  bytes=122311598
  SHA-256=5294e01bc3623afda5ff06f7bf2d8d0f09c08d9f94c79daded89f2d4084edbeb

app/android/app/build/outputs/bundle/release/app-release.aab
  bytes=121682836
  SHA-256=4e586d10562cfcbba356c2065d8fa65c82f9ee027991f7b70ddefb3534666136

aapt2 dump badging
  package='tw.railisland.app' versionCode='14' versionName='1.4.9'

APK：apksigner verify 通過，v2=true，signers=1
AAB：Gradle signReleaseBundle 完成，jarsigner 回 jar verified
16 KB：zipalign -c -P 16 4 exit 0；APK/AAB native .so count=0
```

最終 gate：

```text
verify-release：PASS，v0822a，178 檔，146.3 MB，音樂／線上底圖開啟
verify_metro_plate_states：PASS（八種狀態，含 approx 與 mm:ss 反向判準）
verify_widget_layouts：PASS（7 張版面、60 個 id）
verify_metro_widget_data：PASS 34／FAIL 0
verify_app_gate_source：PASS 29／FAIL 0
git diff --check：PASS
```

Data safety／權限：

```text
相對 4ae2cf1，以下檔案零 diff：
  app/android/app/src/main/AndroidManifest.xml
  app/package.json
  app/package-lock.json

release 權限：INTERNET、COARSE/FINE_LOCATION、POST_NOTIFICATIONS、
POST_PROMOTED_NOTIFICATIONS、RECEIVE_BOOT_COMPLETED、WAKE_LOCK、
ACCESS_NETWORK_STATE、BILLING、READ_GSERVICES、AndroidX signature receiver permission。
沒有因 eta2／approx 增加權限或資料蒐集。
```

## 待辦與風險

- Play 上傳未執行，依派工書由使用者親自上傳 AAB。
- Gradle 仍有既有的 Kotlin plugin 重複載入與 deprecated API 警告；未阻擋 release build，本批沒有改依賴。
