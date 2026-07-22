# App Store Connect 送審填寫清單 — 第一版（純免費）

> 對照著 ASC 一格一格填。文案與 `STORE_LISTING_v1_FREE.md` 同步，改動時兩份都要改。
> 入口：https://appstoreconnect.apple.com/apps → 軌島
> 標「你填」= 只有你能決定的值；其餘可直接複製。

---

## 一、App 資訊（App Information，跨版本共用）

| 欄位 | 值 |
|---|---|
| Name | 軌島：台灣鐵道動態地圖 |
| Subtitle | 全台列車依時刻表同步運行 |
| Bundle ID | tw.railisland.app（已建） |
| SKU | railisland-ios（已建） |
| Primary Language | Chinese (Traditional) 繁體中文 |
| Category｜Primary | Travel 旅遊 |
| Category｜Secondary | Navigation 導航 |
| Content Rights | 勾「含第三方內容」——App 使用 TDX 交通資料與 Stadia／Esri 底圖，你有 attribution／授權 |
| Age Rating | 填分級問卷，所有暴力／成人／賭博等一律選「無」→ 會得 4+ |
| 裝置支援 | **只 iPhone**（2026-07-23 於 project.pbxproj 設 `TARGETED_DEVICE_FAMILY=1`）→ 免 iPad 截圖；上傳 iPhone-only build 後，ASC 的 iPad 截圖欄位會自動消失 |

## 二、App 隱私（App Privacy）

| 欄位 | 值 |
|---|---|
| Privacy Policy URL | https://railisland.tw/privacy.html |
| 資料蒐集 | 純免費版幾乎全部 Data Not Collected（見下） |

純免費版問卷怎麼答：
- 「Do you or your third-party partners collect data from this app?」→ App 本身不建立帳號、不同步、無廣告／分析 SDK。
- 定位：只在按「附近列車」後於**裝置內**運算，不上傳、不連結身分 → 依 Apple 定義不列為 collected（但系統權限用途要如實寫）。
- Cloudflare 伺服器 log（IP、請求時間）：service provider 的必要安全記錄、不連結身分、不做追蹤。
- 保守做法：若你要最乾淨，選 Data Not Collected；若要把 Cloudflare log 也揭露，填「Diagnostics／不連結身分／不追蹤」。兩者送審都過，擇一即可。

## 三、定價與供應（Pricing and Availability）

| 欄位 | 值 |
|---|---|
| Price | Free 免費 |
| Availability | 全球；歐盟由「數位服務法」那頁宣告非交易者自動排除，這裡不用逐國取消 |

歐盟排除改走 DSA 非交易者路線（見下方第八節）——比手動取消 27 國乾淨，且不用公開你的住家地址／電話。

## 四、版本資訊（1.0 版頁面）

| 欄位 | 值 |
|---|---|
| Version | 1.0 |
| Copyright | © 2026 Hsu Hsiang |
| Support URL | https://railisland.tw/app-support.html |
| Marketing URL | https://railisland.tw |
| Keywords | 台鐵,高鐵,捷運,輕軌,火車,鐵道,列車,時刻表,台灣,地圖 |

Promotional Text（宣傳文字）：
```
打開台灣鐵道的另一種觀看方式：台鐵、高鐵、捷運與輕軌在同一時間軸上運行。可自由縮放、放空巡航、跟隨列車、收藏旅程，沒有網路圖磚時仍看得到台灣與鐵道。
```

Description（描述，整段複製）：
```
軌島把台灣所有主要鐵道系統放進同一張動態地圖。

台鐵、高鐵、台北捷運、新北捷運、桃園機場捷運、台中捷運與高雄捷運／輕軌，會依當日時刻表在同一條時間軸上運行。你可以從全台同框開始，縮放到熟悉的城市、跟隨一班列車，或進入放空模式觀看整座島的鐵道流動。

主要功能：

・全台鐵道同時運行的動態地圖
・台鐵即時誤點與各系統營運公告
・點擊列車跟隨、站點來車看板與附近列車
・自由調整時間與播放速度
・放空巡航、全畫面與省電模式
・收藏地點、列車與完乘紀錄
・到站／離站本地提醒通知
・分享目前畫面與跟車連結
・內建台灣輪廓、軌道與時刻表；線上底圖中斷時不會只剩空白畫面

資料說明：地圖上的列車多數是依公開時刻表與軌道幾何推演，台鐵另套用可取得的即時誤點。捷運與輕軌通常不是營運單位提供的即時車輛定位。實際乘車、營運與安全資訊請以交通營運單位及現場公告為準。

軌島是獨立開發的開源專案，並非任何交通營運單位的官方 App。
```

Screenshots：iPhone 只需一種尺寸，系統會自動縮放給其他機型。已從 17 Pro 截圖產好兩套，放在 `app/review-assets/screenshots/`：主夾 **1284×2778**（6.5 吋，對應你在 ASC 遇到的欄位）、`_6.9吋備用_1320x2868/`（若 ASC 另有 6.9 吋欄位才用）。擇一上傳 10 張即可。⚠️ 17 Pro 是 6.3 吋（1206×2622），原檔不合任何欄位，一定要用這裡放大過的版本。

## 五、App 審查資訊（App Review Information）

| 欄位 | 值 |
|---|---|
| Sign-in required | No（第一版無登入） |
| First / Last name | 你填（Hsu / Hsiang） |
| Phone | 你填 |
| Email | 你填（審查聯絡信箱） |
| Notes | 見 `APP_REVIEW_NOTES_v1_FREE.md`（英文整段貼上，記得替換 email/phone） |

## 六、App 加密文件（加密合規）

- **不要按「上傳」**——上傳是給「使用非標準／專屬加密」的 app 準備的。
- 軌島只用 HTTPS 標準加密 → 屬豁免，不需要提供任何加密文件。
- 已在 `Info.plist` 加 `ITSAppUsesNonExemptEncryption = false`（2026-07-22）→ 下一個 build 起，送審不會再問加密這題，這一格自動滿足。
- 若 ASC 上已有一個沒帶這個 key 的舊 build，送審時它問「是否使用加密」，選「否／No」即可。

## 七、App Store 規範與許可

- **數位服務法（DSA）**：按「設定」→ 宣告**非交易者（not a trader）**。v1 免費、無內購、無廣告、無營收的個人專案，符合非交易者定義。效果：app 自動不在歐盟 27 國上架（正是我們要的），其他地區照常，且不用公開住家地址／電話。⚠️ 日後 1.1 開 Plus（有內購營收）要重新評估交易者身分。
- **越南遊戲許可證**：軌島是旅遊／導航 App、不是遊戲，這塊不用理會，跳過。

## 八、版本發布（Version Release）

- 建議選「手動發布」——過審後由你自己按發布，時間可控。

## 九、這些區塊 v1 免費版全部跳過（不用填）

| 區塊 | 為什麼跳過 | 1.1 開 Plus 時 |
|---|---|---|
| 受監管醫療器材 | 旅遊／導航類、年齡分級全選無，不觸發 | 仍不適用 |
| App Store 伺服器通知（實際／沙箱 URL） | 內購事件通知，v1 無內購 | 填 RevenueCat 提供的 URL |
| App 專用共享密鑰 | 驗證訂閱收據用，v1 無訂閱 | 按「管理」產生一組貼進 RevenueCat |
| 越南遊戲許可證 | 不是遊戲 | 仍不適用 |
| 其他資訊（檢視／權限／移除 App） | 都是連結，沒有要填的欄位 | 同 |

---

## 只有你要決定／準備的（彙整）

1. 公開客服信箱（ASC 聯絡人 + `app-support.html` 內要一致，會公開，跟私人信箱分開）
2. 審查聯絡電話
3. 截圖已產好（1284×2778 × 10 張，在 `app/review-assets/screenshots/`）——剩你上傳（App 預覽影片選填，首發可略過）
4. App icon（已是 07-20 定案的琺瑯路牌，要換再說）
5. DSA 那頁按「設定」宣告非交易者（歐盟就自動排除，不用逐國取消）
6. 加密：已加 Info.plist key，你不用動；ASC 加密那格不要按上傳
