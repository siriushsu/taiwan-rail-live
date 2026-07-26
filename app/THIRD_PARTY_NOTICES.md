# 軌島 iOS — 第三方元件授權清單

> 產出：2026-07-26 稽核。**授權欄不是查表推定的，是逐一讀 `app/ios/App/Pods/<pod>/LICENSE*`
> 與 `node_modules/<pkg>/package.json` 的實際內容**；轉移依賴（Firebase 拉進來的
> GoogleUtilities、Promises、AppAuth 等）以前沒有逐一列出，這份補上。
>
> 重跑方式：`bash app/scripts/dump-notices.sh`（見文末），改依賴後要重跑。

## 為什麼要有這份

Apple 不會替你確認轉移依賴的授權。之前的做法是在 `terms.html` 用一句
「所有第三方商標與資料權利屬原權利人」概括，那是聲明不是清單——真的被要求出示時
（下架申訴、企業採購問卷、授權爭議）拿不出逐項證據。

所有列出的元件皆為 **Apache-2.0 或 MIT**，兩者都允許商業散布，條件是保留著作權聲明
與授權條文。IPA 內已隨 CocoaPods 產生的 `Pods-App-acknowledgements.plist` 附帶完整條文。

---

## 原生元件（CocoaPods，實測 `Pods/*/LICENSE*`）

| 元件 | 授權 | 來源 |
|---|---|---|
| AppAuth | Apache-2.0 | 轉移（GoogleSignIn） |
| AppCheckCore | Apache-2.0 | 轉移（FirebaseAuth） |
| FirebaseAppCheckInterop | Apache-2.0 | 轉移 |
| FirebaseAuth | Apache-2.0 | 直接（登入） |
| FirebaseAuthInterop | Apache-2.0 | 轉移 |
| FirebaseCore | Apache-2.0 | 轉移 |
| FirebaseCoreExtension | Apache-2.0 | 轉移 |
| FirebaseCoreInternal | Apache-2.0 | 轉移 |
| GTMAppAuth | Apache-2.0 | 轉移 |
| GTMSessionFetcher/Core | Apache-2.0 | 轉移 |
| GoogleSignIn | Apache-2.0 | 直接（Sign in with Google） |
| GoogleUtilities（7 個 subspec） | Apache-2.0 | 轉移 |
| IONGeolocationLib | MIT | 轉移（CapacitorGeolocation） |
| PromisesObjC | Apache-2.0 | 轉移 |
| PromisesSwift | Apache-2.0 | 轉移 |
| PurchasesHybridCommon | MIT | 轉移（RevenueCat Capacitor） |
| RecaptchaInterop | Apache-2.0 | 轉移 |
| RevenueCat | MIT | 直接（訂閱） |

## Capacitor 外掛（npm，`package.json` 的 license 欄）

| 套件 | 版本 | 授權 |
|---|---|---|
| @capacitor/core | 8.4.2 | MIT |
| @capacitor/ios | 8.4.2 | MIT |
| @capacitor-firebase/authentication | 8.3.0 | Apache-2.0 |
| @capacitor/geolocation | 8.2.0 | MIT |
| @capacitor/local-notifications | 8.2.1 | MIT |
| @capacitor/share | 8.0.1 | MIT |
| @revenuecat/purchases-capacitor | 13.2.2 | MIT |

## 網頁端

| 元件 | 版本 | 授權 |
|---|---|---|
| Leaflet | 1.9.4 | BSD-2-Clause |

## 資料與圖磚（非軟體授權，另有條款）

這些**不是**開源授權，是各自的服務條款，條件比 MIT／Apache 嚴格得多，且已知有踩過線的紀錄：

| 來源 | 用途 | 注意 |
|---|---|---|
| TDX 運輸資料流通服務 | 班表、即時位置、誤點 | 需標示來源 |
| Stadia Maps | 一般／深色底圖 | 影片散布與商業錄影需 Enterprise（2026-07-21 報價 US$6,000/年）；金鑰須有來源限制 |
| Esri World Imagery | 衛星底圖 | 需 token；網站版由 Worker `/api/basemap-token` 下發，不寫進公開 repo |
| OpenStreetMap 貢獻者 | 底圖圖資 | ODbL，需標示 |
| Suno（背景音樂） | App 內音樂 | 商用權以 Pro 訂閱期間生成為條件，見 `MUSIC_LICENSE_CHECKLIST.md` |

---

## 重新產生

```sh
cd app/ios/App
for d in Pods/*/; do n=$(basename "$d"); L=$(ls "$d" | grep -iE '^LICENSE' | head -1); \
  [ -n "$L" ] && echo "$n: $(head -20 "$d$L" | grep -oiE 'Apache License|MIT License|BSD [0-9]-Clause' | head -1)"; done
```

npm 端：`node -p "require('./node_modules/<pkg>/package.json').license"`
