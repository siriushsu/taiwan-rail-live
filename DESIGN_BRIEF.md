# 列車有時 — Claude Design 打磨簡報（第二輪 · v0710k 基準）

> 給 Claude Design 的工作說明。上傳 `design-mock.html` 這一個檔案即可開工。
> 第一輪已把工程黑底風改成現在的「米色琺瑯站牌」風；這一輪是全站打磨——
> 尤其是第一輪之後新增的大量元件（見「本輪重點」）。

## 這是什麼網站

台鐵×高鐵即時列車動畫地圖（https://taiwan-rail-live.sirius1984.workers.dev）。
全台列車依真實時刻表在地圖上跑，可以點車跟隨、點站看班次、收集完乘章。
單檔 vanilla JS（index.html ~4000 行），地圖用 Leaflet，列車與車站畫在 canvas 上。

## 工作方式（重要）

- **只改 `design-mock.html`**。它的 `<style>` 區塊與正式版 index.html 完全同步（自動抽取），
  body 是各元件「真實使用中狀態」的靜態複製——所見即正式版樣式。
- 改完後把整個 design-mock.html 交回（或匯出 bundle），Claude Code 會把 CSS diff
  合併回 index.html、並把 canvas 規格移植進 JS 繪圖碼。
- 檔尾有 `<style id="mockOverrides">`：那是 mock 專用的展示用樣式（讓浮動面板攤平陳列），
  **不要把設計改寫進這一塊**，正式合併時整段忽略。
- 頁尾「specimen 區」（`.mock-spec`）正式版不存在：看板家族攤開、公告展開、
  **canvas 繪製規格**（車牌／車站圖示／軌道線）、色票。改 specimen 的樣式＝改規格，
  合併時 Claude Code 照著改 JS 繪圖碼。

## 不可改的硬約束

1. **所有元素 id 不可改名**（JS 綁定）。
2. **JS 切換的 class 不可改名**（可以改它們的樣式）：
   `active / idle / off / run / show / routes-closed / closed / cur / dark / fs /
   immersive / past / playing / sat / sheet-open / tools-open / ambient / on / miss / got / na / rt`
3. **資料定義色不可改**（設計要能容納它們）：
   車種色——其他 `#8E44AD`、區間快 `#16A085`、區間車 `#2E6FB0`、自強 `#C0392B`、
   莒光/復興 `#E8792B`、高鐵 `#E85D0D`；路線色與捷運官方色由資料檔給值，
   一律經由 inline `style="background:..."` 或 canvas 繪圖進畫面。
4. 結構（DOM 巢狀）盡量不動；要動請在交回說明中點名，Claude Code 評估後合併。

## 現行設計語彙（第一輪定調，可微調不可翻盤）

- 概念：**日式琺瑯站名牌×老車站告示板**。米色紙感、藏青、印章紅。
- Tokens：底 `#f7f0dd`、面板 `#fffdf6`、邊框 `#c9b98f`、藏青 `#2a4a73`、
  紅 `#d23c2a`、正文 `#3a3226`／`#1e2c40`、次要 `#7a6c50`。
- 陰影是硬投影 `0 2px 0`（不是模糊 blur），圓角 6–12px。
- 字體棧 CJK：`-apple-system, "PingFang TC", "Noto Sans TC", sans-serif`；
  數字 `font-variant-numeric: tabular-nums`。

## 本輪重點（第一輪之後新增、還沒被設計手摸過的面）

1. **系統群頁籤**（`.grouptabs`＋`.groupmembers`）：國家鐵路／北北桃／中南部／全台同框
   ＋台鐵/高鐵勾選 chip。
2. **地圖工具直欄**（`.stage-tools`：探/★/旅/隨/介/衛/☾/簡/⛶）＋手機 ☰ 抽屜（`#toolsFab`）。
3. **跟隨面板**（`#followPanel`）：mock 裡故意放了「誤點＋長 eta 擠到換行」的真實痛點狀態。
4. **列車卡**（`#trainCard`）：介紹＋旅程日誌＋全程速度曲線。
5. **旅程收集護照**（`#passport`）：章（`.stamp` / `.got` / `.na` 成就）＋完乘記錄列。
6. **今日亮點/最愛/旅程看板**（specimen 區攤開的三張 `.board`）。
7. **通阻公告**：橫幅（`#alertBanner`）＋展開（`.alert-detail`）。
8. **音樂控制**（`#musicCtl`：播放中紅底＋等化器動畫、⏭、音量）。
9. **高鐵車牌**（canvas：白子彈橘框）vs 台鐵膠囊——specimen 區有規格。
10. **停站站牌**（`#dwellPlate`）與**特殊站介紹**（`.dp-intro`、`.stnMeta`）。
11. **頁尾**（更新紀錄／資料來源／贊助）。

## 手機（務必看）

- 把預覽窗縮到 **390px** 寬：`@media (max-width: 640px)` 全部生效，單欄堆疊、
  看板變全寬 bottom sheet、工具鈕收進 ☰ 抽屜。
- 模擬狀態用 body class：`tools-open`（抽屜展開）、`ambient`（放空模式極簡 UI）、
  `fs`（全畫面）、`ambient fs` 連用＝手機放空全畫面（跟隨小卡縮到 176px、
  控制列只剩「放空模式」鈕靠右下角）。
- 手機鐵則：**不可出現橫向捲動**；地圖上的浮動元件不可擋住列車本體。

## 已知想改善的點（給設計的起手線索,不是限制）

- 跟隨面板資訊擠（誤點時換行）——見 mock 現況。
- 地圖上同時開「停站站牌＋車站看板＋公告橫幅」時的層疊關係與視覺優先序。
- 徽章區（成就 `.stamp.na`）與收集章視覺區隔可以更有「印章感」。
- 手機版時鐘 badge 與公告橫幅同列偏擠。

## 驗收（交回前自查）

- 桌面 1440px ＋手機 390px 都不破版、無橫向捲動。
- 所有 id 與第 2 條的 class 名原封未動。
- 檔案自包含：無 CDN、無外部字體、無網路請求。
- mockOverrides 區塊仍在檔尾且未混入正式樣式。
