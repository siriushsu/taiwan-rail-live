# iPad Pro 13 吋 App Store 截圖（v0903k）

這組素材對應軌島 `1.5.4 (92)`、Web build `v0903k`，共 6 張繁體中文橫向截圖。

- `2752x2064/`：可直接上傳 App Store Connect 的 iPad 13 吋橫向 PNG。
- `AppStore_iPad_13-inch_2752x2064_v0903k.zip`：六張送審圖的乾淨交付包。
- `source/`：iPad Pro 13-inch (M5)／iOS 26.5 Simulator 的原始 framebuffer 截圖。
- `contact-sheet.png`：6 張縮圖總覽，僅供內部審稿。
- `manifest.json`：版本、裝置、尺寸、來源與隱私說明。
- `render_ipad_store_assets.mjs`：以真實 App 截圖重製送審圖的腳本。

## 敘事順序

1. 全台同框
2. 台北站來車看板
3. 跟隨 149 次列車
4. 今日亮點
5. 旅程護照
6. iPad 橫向工具與設定

## 來源原則

所有 App UI 像素都由實際 Universal App 安裝到 iPad Simulator 後操作取得；沒有重建、生成或改寫介面。後製只包含品牌標題、說明、背景、等比例縮放與圓角遮罩。地圖 attribution 完整保留，畫面不含個人資料。

## 重製

```sh
RAIL_IPAD_SHOT_SOURCE=/private/tmp/railisland-ipad-shots/raw \
  node app/review-assets/ipad-13-v0903k/render_ipad_store_assets.mjs
```

Apple 官方規格允許 13 吋 iPad 橫向使用 `2752×2064`，並可由最高解析度向下縮放到較小尺寸：

- https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
