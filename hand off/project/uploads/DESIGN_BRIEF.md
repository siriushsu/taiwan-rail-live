# DESIGN BRIEF — 帶去 Claude Design 的打磨指示

> 給 Claude Design(claude.ai)新專案的第一則訊息可以直接貼這份檔案,
> 並上傳 `design-mock.html`(必要)與 `index.html`(參考)。

## 你(Claude Design)要做什麼

**只做視覺設計打磨,不改任何邏輯。** 對象是一個「台灣鐵道列車即時動畫」單頁 app:
真實地圖上有動態列車,周邊是操作 UI。目前功能完整、風格是「能用但素」的暗色工程風,
目標是把它打磨成有品牌感、有層級、值得分享的作品。

## 用哪個檔案工作(重要)

- **`design-mock.html` — 在這裡改。** 完全自包含(無 CDN、無外部圖磚、無資料請求),
  在 Claude Design 的預覽可以 100% 渲染。它复制了正式版全部 CSS 與所有 UI 元件的
  「真實使用中狀態」(時刻板開啟、跟隨列車中、圖例兩組、流量圖有資料),
  地圖區用內嵌 SVG 假地圖代替(真品是 CARTO 圖磚,不歸設計管)。
- **`index.html` — 只讀參考,別在 Claude Design 裡跑。** 它依賴 Leaflet CDN、
  CARTO 圖磚、`./data/*.json`,在沙盒裡會是破圖。最終合併由 Claude Code 在本機做。

## 設計面清單(要打磨的 surfaces)

1. **Header**:標題「台灣鐵道 · 列車流動動畫」+ 副標。目前太素,缺品牌感。
2. **系統切換 pills**:台北捷運/台鐵(班距)/台鐵·真實班表。
3. **Stage 上的 HUD badge**(左上):時鐘 19:49 + 模式膠囊 + 「運行列車 N 班」。
4. **車站時刻板**(右上浮動面板):站名+副標+班次列(色點/車次/車種/往/時刻/幾分後)。
   這是最有「產品感」潛力的元件——可以往真實車站電子看板的方向設計。
5. **控制列**:暫停/播放、速度滑桿(1–60×)、時間滑桿、「現在」按鈕。
6. **搜尋列**:車次輸入框 + 跟隨資訊膠囊(色點/車次/區間/時段/取消按鈕;
   另有 `.followbar.miss` 查無車次的警告態)。
7. **流量圖**:全日 144 根柱狀 + 白色現在游標 + 說明文字。可以更像儀表板元件
   (尖峰高亮、整點刻度、hover 樣式)。
8. **圖例 chips 兩組**:「車種(篩選列車)」5 顆、「鐵道路線(顯示/隱藏軌道)」15 顆,
   `.off` 為半透明關閉態。15 顆會換行,目前視覺很擠。
9. **註腳 note**:資料來源說明。
10. **RWD**:目前桌面優先(max-width 1040px),手機版值得重排(控制列、時刻板、圖例)。

## 目前的設計 tokens(現狀,可重定義)

- 背景 `#0b0e14`;面板 `#10141c` / `#151b26` / `#1a2130`;邊框 `#1e2530` / `#2a3546`
- 文字 `#e6e9ef`;次要 `#9aa3b2` / `#8590a2`;強調藍 `#6ea8fe`(滑桿 accent)
- 跟隨膠囊 `#12233f`/`#26405f`;警告態 `#3a2417`/`#5a3a24`/`#ffb27a`
- 圓角:pills/按鈕 8px、stage 14px、面板 12px、chips 999px
- 字體:`-apple-system, "PingFang TC", "Noto Sans TC", sans-serif`;
  數字處用 `font-variant-numeric: tabular-nums`
- 路線/車種色(資料定義,**不可改**,設計要能容納它們):
  車種:其他 `#8E44AD`、區間快 `#16A085`、區間車 `#2E6FB0`、自強 `#C0392B`、莒光/復興 `#E8792B`
  台鐵線:縱貫北 `#2E6FB0`、山 `#E8792B`、海 `#3AA76D`、縱貫南 `#C0392B`、屏東 `#8E44AD`、
  南迴 `#16A085`、臺東 `#D4A017`、北迴 `#5D6D7E`、宜蘭 `#C2185B`、內灣 `#00A0B0`、
  六家 `#7FB800`、平溪 `#E4572E`、深澳 `#F2A104`、集集 `#6A8EAE`、沙崙 `#B565A7`
  北捷:BR `#C48C31`、R `#E3002C`、G `#008659`、O `#F8B61C`、BL `#0070BD`、Y `#FFDB00`

## 硬約束(破壞任何一條,合併就會失敗)

1. **所有元素 id 不可改名/刪除**(JS 綁定):
   `map, overlay, clock, peak, count, board, pp, ppIcon, ppTxt, speed, speedOut,
   tod, todOut, nowBtn, flowWrap, flowChart, flowLbl, searchRow, trainSearch,
   trainList, followBar, lineToggles, systems, note`
   以及 JS 動態產生的 `boardClose, unfollow`。
2. **JS 產生/切換的 class 名不可改**:`.active`(系統鈕)、`.off`(chips)、
   `.followbar` / `.followbar.miss`、`.legend-lbl`、`.chip`,
   以及 JS innerHTML 動態產生的結構類:`.dot`(chip/followbar/board 的色點)、
   board 內的 `.row` / `.dest` / `.t` / `.min` / `.sub` / `.empty` / `.close`。
   想改這些元素的外觀 → **改 CSS 規則本身,不要改類名**(JS 會繼續輸出舊類名,改名=樣式失效)。
3. `#overlay` 必須維持 `position:absolute; inset:0; pointer-events:none;` 且蓋在 `#map` 上
   (z-index 500 級);`.badge`、`.board` 要在其上(600+)。`.stage` 維持 `position:relative`
   與明確高度。
4. **畫在 canvas 上的東西 CSS 管不到**:列車標籤(`drawTag`)、光點(`drawDot`)、
   站名(`tryLabel`)、跟隨雙圈(`drawFollowMarker`)、軌道線(3.4px, alpha 0.7/0.75)、
   流量柱(`drawFlow`)。想改它們的樣式,請在 mock 裡把新樣式做成
   「canvas 視覺 spec」註解區(顏色/字級/圓角/粗細寫清楚),Claude Code 會改進 JS。
5. 不引入任何外部資源(字體、框架、圖)——正式版要能離線+本機跑;系統字棧內發揮。
6. 深色為主題基調(地圖圖磚是深色的);可以提出亮色副主題,但深色是預設。

## 交回格式(給 Claude Code 合併)

改完的 `design-mock.html` 整檔傳回即可,並在檔案頂端加一段
`<!-- DESIGN CHANGELOG: ... -->` 列出:(1)改了哪些 CSS 區塊(2)動了哪些 DOM 結構
(3)canvas 視覺 spec(如果有)。Claude Code 會把樣式移植回 `index.html`、
接回真地圖與真資料、在本機 preview 逐項驗證(三系統、時刻板、跟車、流量圖、RWD)。

## 建議的打磨方向(參考,可自由發揮)

- 標題列做出「路網圖海報」的品牌感(字重對比、字距、小 LOGO 符號如 ●▬●)。
- 時刻板往真實車站 LED/LCD 看板靠(等寬數字、行分隔、即將進站的醒目態)。
- HUD badge 整合成一個玻璃擬態或儀表卡。
- 流量圖加尖峰帶高亮(07-09、17-19:30)與整點刻度。
- chips 兩組改成可折疊/分區塊,解決 15 顆換行的擁擠。
- 手機直立版:地圖滿寬、控制沉底、時刻板改 bottom sheet。
