# 國際列車位置視覺化／鐵道迷掛機網站調查

> 調查目的：供台灣鐵道動畫網站（單檔 index.html + Leaflet，無後端，時刻表模擬）借鏡功能。
> 調查時間：2026-07-09

## Mini Tokyo 3D (https://minitokyo3d.com/, https://github.com/nagix/mini-tokyo-3d)

定位：東京公共運輸（電車＋部分航班）即時 3D 數位地圖，個人開源專案（Akihiko Kusanagi / nagix）。

資料方式：即時（實際時刻表＋即時誤點資訊，日本 ODPT 開放資料）。

亮點功能：
- **雙時鐘模式：即時模式 vs 「playback 模式」**（可指定任意日期/時間＋調整播放速度，觀察該時段的排班樣貌）— 對我們可行性：**高，且是本次調查最值得借鏡的單一功能**。我們已是時刻表模擬（本來就每天都能算出任意時刻的列車位置），只是現在只有「當下」與「深夜重播尖峰」兩種模式；做一個「時間滑桿＋播放速度選擇（1x/5x/20x/60x…）」讓使用者自由跳到任一時刻觀察，幾乎是純前端邏輯延伸，不需要新資料源。
- **8 種列車追蹤鏡頭視角**（Position only／Back／Top-back／Front／Top-front／Helicopter／Drone／Bird）— 對我們可行性：中。我們已有「點車跟隨」，但只有平面地圖視角；若要做「跟隨鏡頭切換」需要 3D 引擎（MapLibre GL + 3D building/terrain），純 Leaflet 2D 難以完全複製，但可簡化成「跟隨時自動置中＋輕微縮放/旋轉」的 2D 版本。
- **日夜循環＋天色漸變**（依東京日出日落時間變化場景色調、夕陽餘暉）— 對我們可行性：高。我們已有明暗主題與「深夜重播尖峰」，可再加「依當下時刻自動漸變地圖色調」讓視覺更有「一天感」，純前端計算日出日落時間即可（無需後端）。
- **即時天氣動畫**（依真實天氣顯示下雨動畫）— 對我們可行性：低。需要即時天氣 API（金鑰／後端），且我們是時刻表模擬非即時，動機不強。
- **地下／地面視圖切換**（地鐵入地下時的視覺呈現）— 對我們可行性：低～中。北捷/高捷有地下段，但純 2D 地圖難呈現「地下」視覺差異，除非用淡化/虛線區分地下段路線（可行，中等成本）。
- **即時路線規劃／到站路徑搜尋（含誤點反映的多候選路線）**— 對我們可行性：低。我們無即時誤點資料，此功能動機薄弱。
- **多語系介面**（日/英/法/中/韓/泰/尼泊爾/葡/西/德）— 對我們可行性：中。若有國際訪客需求可考慮中英雙語，非急件。
- **列車以官方路線色＋簡單方塊/長條造型表示，站點與轉乘連線清楚標示**— 對我們可行性：高。這與我們現有復古站名牌風格可並存，路線官方色我們已有。

來源：https://minitokyo3d.com/ ／ https://github.com/nagix/mini-tokyo-3d ／ https://github.com/nagix/mini-tokyo-3d/blob/master/docs/user-guide/overview.md ／ https://minitokyo3d.com/docs/master/user-guide/configuration.html ／ https://www.pcgamer.com/watch-tokyo-come-alive-with-this-real-time-map-of-its-transit-system/

## Travic / TRAVIC Transit Visualization Client (https://travic.app/, geOps + University of Freiburg)

定位：全球大眾運輸（電車/地鐵/鐵路/巴士/渡輪）動態視覺化，學術＋商業（geOps）合作專案，涵蓋 200+ 個資料 feed。

資料方式：**與我們同型**——主要基於「靜態時刻表資料」計算車輛位置，若該 agency 有提供即時資料才疊加使用。這是本次調查中與我們立場最接近的先例。

亮點功能：
- **交通工具類別篩選**（Trams／Subways／Rail／Busses／Ferries／Other）— 對我們可行性：中。我們目前系統別（北捷/高捷/中捷/台鐵/輕軌）已用顏色與圖示區分，若列表變多可加開關篩選，成本低。
- **標準播放列控制**（play/pause、速度切換、timeline 拖曳、‹‹ ›› 跳轉）— 對我們可行性：高。與 Mini Tokyo 3D 的 playback 模式呼應，是「時間軸可操控」這個大方向的第二個獨立先例，強化了值得做的信心。
- **Overview 總覽按鈕**（一次看到全部可用 feed／城市總覽）— 對我們可行性：低。我們只服務台灣，無多城市總覽需求。
- **點擊車輛顯示資料出處與授權條款連結**— 對我們可行性：中。我們用 TDX 資料，目前有無在頁面上清楚標示資料來源／授權可以檢查一下，這是好的透明度實踐，成本很低（加一行文字/連結）。

來源：https://travic.app/ ／ https://geoawesome.com/travic-this-geoawesomemap-shows-the-worlds-public-transportation-moving-in-real-time/ ／ https://ad-publications.informatik.uni-freiburg.de/GIS_travicdemo_BBS_2014

## vasile.ch / Swiss Railways Network Simulation (https://maps.vasile.ch/transit-sbb/)

定位：瑞士 SBB／RhB 鐵路網「依官方時刻表」的動畫模擬地圖，個人專案（Vasile Coțovanu），開源（github.com/vasile/transit-map）。是「時刻表模擬」這個做法最早的知名先例之一（2013 年前後即有報導）。

資料方式：**與我們同型**——完全依官方時刻表模擬，非即時 GPS。

亮點功能：
- **播放速度選單（1x/5x/10x/20x/50x/100x/200x/500x）**— 對我們可行性：高。比 Travic 更細緻的速度階梯，適合「快轉看一天車流」的掛機情境；純前端時間縮放，我們現有的時間模擬引擎應可直接支援多段速度選項。
- **即時「目前運行列車數」計數器**— 對我們可行性：高。低成本、高氛圍感的資訊，可放在角落當作「這個系統現在有 N 班車在跑」，純粹從我們已模擬的資料算數量即可，不需新資料源。
- **點擊列車顯示：所屬業者、當前／即將停靠站與到離站時間、終點站、車輛資訊**— 對我們可行性：高（我們的列車介紹卡已涵蓋大部分，可對照補齊「當前業者」欄位，因為我們未來若納入台鐵以外更多業者會需要）。
- **點擊車站顯示該站進出站列車列表（站牌看板式）**— 對我們可行性：高，我們已有車站到站看板，功能已對齊，可視為驗證我們方向正確。
- **依業者篩選側欄**— 對我們可行性：中，同 Travic 的類別篩選，等系統數變多時再考慮。

來源：https://maps.vasile.ch/transit-sbb/ ／ https://github.com/vasile/transit-map ／ https://www.thewebtrain.co.uk/blog/2013/01/live-sbb-trains-map-swiss-railway-system/

## 英國群：Realtime Trains + Open Train Times + Signalbox（三種互補取徑）

### Realtime Trains（https://www.realtimetrains.co.uk/）
定位：英國鐵路「詳細時刻表＋事後誤點歸因」查詢站，鐵道迷／從業者常用的深度資料工具（非即時地圖）。
資料方式：時刻表＋Network Rail TRUST 系統的事後真實運行紀錄。

亮點功能：
- **詳細班次頁：每個停靠點的計畫時間 vs 實際回報時間，並標示資料來源代碼（TD 訊號區碼、TRUST 的 SMART/GPS/SDR/TOPS/DA 等）**— 對我們可行性：低～中。我們沒有誤點資料來源可標示，但「每站時間都附一個小圖示告知資料是模擬非即時」這個透明度概念可以借鏡（例如車站看板旁註明「時刻表模擬，非即時動態」）。
- **車廂編成／車輛所屬（stock/formation）顯示，且以「查詢車站當下的車長」為準（因中途可能增解編）**— 對我們可行性：低。我們無編成資料且台鐵/北捷資料難以取得車廂數，動機低，除非未來 TDX 有提供。
- **會車/分聯查詢（associations，列車在途中分併結）**— 對我們可行性：中～高。我們的旅程日誌已有「交會/待避事件」，這與其呼應；可考慮再加「本班車是否為分聯／併結列車」的標示（若 TDX 資料能判斷），強化鐵道迷向的深度資訊。

來源：https://www.realtimetrains.co.uk/ ／ https://blog.realtimetrains.com/2020/04/reading-our-detailed-service-pages/ ／ https://blog.realtimetrains.com/2019/11/about-offsets/

### Open Train Times（https://www.opentraintimes.com/maps）
定位：用「訊號區間 Train Describer」資料畫出的手繪式訊號區間圖，顯示列車在哪個閉塞區間，鐵道迷／號誌迷向。
資料方式：真即時（訊號系統資料，每日 750,000 筆 TRUST 訊息＋725 萬筆 TD 步進，月訪客破百萬）。

亮點功能：
- **列車以 4 碼車次代碼（headcode，如 1A66）在訊號區間（berth）間跳動顯示**— 對我們可行性：低。這是訊號系統資料的視覺化，我們沒有訊號資料，且我們的地圖走的是地理位置模擬路線而非區間跳動的抽象圖，方向不同、動機低。
- **「手繪」風格線路圖（非地理精確，強調邏輯關係）**— 對我們可行性：低（我們已選擇地理正確地圖＋復古站名牌路線，非抽象邏輯圖，不需要另做一套）。
- 對我們最大的借鏡其實是**專案定位啟示**：這站證明「小眾、資料受限但呈現誠實」的鐵道迷站也能吸引百萬月訪客——支持我們「誠實標示模擬 vs 即時」的路線是可行且會被鐵道迷社群接受的。

來源：https://www.opentraintimes.com/maps ／ https://www.opentraintimes.com/maps/help ／ https://www.railengineer.co.uk/open-train-times/

### Signalbox（https://www.signalbox.io/、https://www.map.signalbox.io/）
定位：英國新創，用手機感測器資料反推列車即時位置（非官方訊號資料），主打「找出我在哪班車上」與即時地圖。
資料方式：即時（專有演算法，用手機動作/訊號資料匹配列車軌跡，非 GPS 非官方號誌資料）。

亮點功能：
- **地圖網址可帶座標／位置參數，直接開到特定地點附近的列車（"hackable URLs"）＋支援瀏覽器定位「顯示我附近的列車」**— 對我們可行性：中。我們已有 `?train=&t=` 深連結，可考慮加「依使用者所在地／或指定座標，預設地圖置中並高亮附近車站」的參數，屬合理延伸，純前端 geolocation API 即可、不需後端。
- **列車方向標記清楚區分對向列車＋顯示列車最終目的地**— 對我們可行性：高，我們的車廂/圖示與到站看板已大致做到，可再檢查方向箭頭是否清楚。
- **點擊列車看時刻表＋各站到離站預估與即時狀態**— 對我們可行性：高，與我們列車卡功能重疊，屬驗證方向正確。
- HN 讀者的重要提醒（見下方 Top10 前的風險註記）：多位使用者指出這類「用間接資料推算位置」的地圖常出現「車輛顯示位置與實際不符、忽動忽停、方向跳變」的觀感問題——**這正是任何「非真即時、用推算/模擬呈現位置」的產品共同風險，我們的時刻表模擬也要留意同類問題（列車在時刻表資料有缺口時的插值是否會跳動）**。

來源：https://www.signalbox.io/ ／ https://www.map.signalbox.io/ ／ https://www.signalbox.io/news/live-train-map-britain ／ https://news.ycombinator.com/item?id=48802535（Hacker News 討論串，含跨國比較與批評）

## bahn.expert（https://bahn.expert/，德國，開源前身 marudor/BahnhofsAbfahrten）

定位：德鐵（DB）車站到離站看板＋列車詳情查詢站，德國鐵道迷/通勤族常用工具，原開源、近期作者聲明「不再維護 GitHub 上的公開版本」（原始碼倉庫僅留做 issue 追蹤）。

資料方式：即時（串接 DB 官方 API）。

亮點功能（部分因 SPA 前端無法用純文字抓取工具讀到完整畫面，靠既有搜尋資訊與過往認知的網站定位交叉確認，標記於下）：
- **車站到離站看板（Bahnhofstafel）** — 對我們可行性：高，我們已有等同功能（車站到站看板），屬驗證方向正確。
- **列車詳情／全程路線（Zuglauf）查詢** — 對我們可行性：高，我們的列車介紹卡＋旅程日誌已對齊此概念。
- 其餘細節（誤點視覺化樣式、月台變更提示、通知功能等）**查無**——SPA 前端內容無法用文字抓取工具取得完整畫面，GitHub README 亦已不含功能說明；不作腦補。

來源：https://bahn.expert/ ／ https://github.com/marudor/bahn.expert （README 現況：僅供 issue，非文件）

## Flightradar24（https://www.flightradar24.com/，非鐵道但為「掛機視覺化」UX 標竿）

定位：全球飛機即時追蹤龍頭站，我們「放空模式」在互動設計上的直接參照對象。

資料方式：即時（ADS-B 等機載訊號）。

亮點功能：
- **Playback／時光倒轉：可選日期＋時間，重播當時全球或單機的飛行軌跡，速度可調（最高到 300x）**— 對我們可行性：高。這與 Mini Tokyo 3D 的 playback clock、vasile.ch 的多段變速是同一方向的第三個獨立先例；我們是時刻表模擬，理論上任何時段都能重播，做「選日期＋時段回放」完全可行、且比即時類產品更容易做到（我們沒有「資料只留 N 天」的限制）。
- **單機資訊面板分區（Flight／Aircraft／Movement／Data source），上滑可看高度/速度歷史圖**— 對我們可行性：中。我們的列車卡已有下一站/ETA/時速，若要再加「本趟旅程的速度時間軸圖」屬中等工程量（需要記錄軌跡點時速取樣），可視為進階加值功能而非必要項。
- **機場資訊面板／天氣圖層**— 對我們可行性：低，非鐵道情境核心需求。

來源：https://www.flightradar24.com/playback/ ／ https://www.flightradar24.com/blog/inside-flightradar24/updated-individual-playback-in-the-flightradar24-app/ ／ https://www.flightradar24.com/blog/an-overview-of-the-updated-flight-information-panel-on-flightradar24-com/ ／ https://support.fr24.com/support/solutions/articles/3000120423-how-to-view-playback-on-the-flightradar24-website-

## OpenRailwayMap（https://www.openrailwaymap.org/、https://openrailwaymap.app/）

定位：鐵道基礎設施圖資（非列車位置），以 OpenStreetMap 資料呈現軌道／號誌／電氣化／速限／軌距等圖層，全球涵蓋。

資料方式：靜態基礎設施資料（OSM 貢獻），非列車位置。

亮點功能：
- **五種疊加圖層：Infrastructure（里程碑/道岔/軌道編號/號誌樓）／Signalling（號誌與列車防護系統，含國家別號誌樣式）／Max speed（速限）／Electrification（電氣化，beta）／Track gauge（軌距，beta）**— 對我們可行性：低～中。我們的軌道幾何資料已有（見 commit 「軌道幾何除毛刺」），若要疊加「電氣化區間／速限」屬於「錦上添花的知識向圖層」，成本中等（需額外靜態資料，TDX 較難取得完整速限資料，可考慮只做「電氣化與否」這種較粗的分類，若有現成資料源）。
- **底圖可切換山影／等高線等地形背景**— 對我們可行性：低，我們已有衛星圖切換，非優先。
- 對我們的啟示：**基礎設施圖層是與「列車動態」正交的另一個豐富化維度**，若日後想做「進階/鐵道迷模式」，這是一個現成的圖層分類參考架構（號誌／速限／電氣化／軌距），但目前無資料源支撐，優先度低。

來源：https://openrailwaymap.app/ ／ https://wiki.openstreetmap.org/wiki/OpenRailwayMap ／ https://blog.openrailwaymap.org/

## 加碼發現：Trafimage / maps.trafimage.ch（瑞士 SBB 官方版）

定位：SBB 官方地圖平台，多合一（路網圖／車站圖／即時列車追蹤／準點率視覺化），由 geOps 承包開發，也是 Hacker News 讀者評為「同類最佳」的參照站。

資料方式：即時列車位置＋誤點資訊（SBB 官方資料）。

亮點功能：
- **「Train tracker」圖層：列車以圓點沿路網移動，並可視覺化準點率（punctuality）**— 對我們可行性：中。準點率視覺化需要誤點資料，我們沒有；但「同一張圖切換不同視覺化主題（路網圖／即時列車圖）」的產品架構值得參考——我們目前地圖與各系統資料已整合在一張圖，方向已對齊。
- **同一套地圖資料同時輸出到車站看板螢幕／車廂顯示器／網頁**（multi-surface 一源多用）— 對我們可行性：低，我們無實體佈點通路，非核心。

來源：https://maps.trafimage.ch/ ／ https://geops.com/en/solution/sbb-map-and-stations-plans ／ https://www.maproomblog.com/2017/10/trafimage-interactive-swiss-railway-map/ ／ https://news.ycombinator.com/item?id=48802535（HN 討論中被提及為標竿）

## 加碼發現：Carto Tchoo（法國，https://carto.tchoo.net/，原名 Carto Graou）

定位：法國鐵路基礎設施＋即時列車位置合一地圖，個人開發者（Nicolas Wurtz）維護，SNCF Réseau＋OpenStreetMap 資料，法國鐵道迷圈知名。

資料方式：即時（SNCF Réseau 開放資料，每分鐘更新）。

亮點功能：
- **把 OpenRailwayMap 式的基礎設施點位（平交道、熱軸偵測器 hotbox detector、變電站、無線電天線、隧道、股道等）與即時列車位置疊在同一張圖**— 對我們可行性：低～中。這是「基礎設施圖層＋動態列車」合一的具體案例，證明這條路可行，但我們目前無等量的基礎設施點位資料源（平交道/隧道等），若要做需另外建置靜態資料，工程量不小，非急件。
- **點擊列車顯示速度、起訖站、誤點，每分鐘更新**— 對我們可行性：高，功能已與我們列車卡對齊。
- **完全免安裝、無需帳號、瀏覽器直接用**— 對我們可行性：高（我們本來就是如此，屬驗證而非新學）。

來源：https://carto.tchoo.net/ ／ https://www.futura-sciences.com/en/he-put-all-running-trains-on-a-live-map-and-you-wont-want-to-look-away_20797/ ／ https://www.veilletechno-it.bzh/carto-tchoo-trafic-ferroviaire/

## 加碼發現：Treinposities.nl（荷蘭）

定位：荷蘭全國列車即時位置站（NS／Arriva／Blauwnet／R-net 等），個人專案，社群色彩濃厚（會員可看歷史紀錄、使用者可上傳照片）。

資料方式：即時。

亮點功能：
- **列車/車次歷史紀錄查詢（過去某趟車的時刻與事件），並自動附上該趟車或該地點的社群照片**— 對我們可行性：中。我們的「旅程日誌」概念相近（停靠/交會/待避事件），但 Treinposities 多了「使用者生成內容（照片）」與「跨日期歷史回顧」；後者若簡化為「查看某車次過去 N 天的旅程日誌」在我們的模擬架構下技術上可行（因為我們是算出來的，理論上任何一天都能重算），成本中等，但社群照片功能不適用（我們無使用者上傳機制，也非優先）。
- **6 個月以上的歷史紀錄需要帳號**— 對我們可行性：低，我們無帳號系統也不需要。
- **不尋常車輛調度提示（unusual rolling stock alerts）**— 對我們可行性：低，我們無車輛調度資料。

來源：https://en.treinposities.nl/ ／ https://en.treinposities.nl/over/changelog

## 查無／被擋／低相關性略記（誠實記錄，不腦補）

- **transitmap.io**：網域無法解析（DNS 查無此站，可能已關站或改名），僅搜尋摘要顯示過「no vehicle · Timetable · Click on a vehicle」等字樣，內容細節**查無**。
- **ThirdRails（thirdrails.org）**：性質是「Train Simulator / Train Sim World 玩家的線上雷達網路」（模擬器玩家彼此在共享地圖上看到對方的虛擬列車），不是真實列車追蹤站，與我們「真實路網時刻表模擬」性質不同，對我們可行性：低，僅記錄不深入。
- **Traintrackr（traintrackr.io）**：是**實體 LED 電路板產品**（掛在牆上的物理地圖，非網站），顯示各城市地鐵/捷運即時到站；概念上與我們「掛機看板」精神相通（含夜間模式），但屬硬體零售商品，功能無法直接借鏡到網頁產品，對我們可行性：低，僅記錄不深入。
- **OpenTrack（opentrack.ch）**：專業鐵路調度模擬「引擎/軟體」（付費商用工具，給鐵路業者做班表衝突分析用），非公開網站產品，對我們可行性：低，不深入研究。

## 可借鏡功能 Top 10

跨站綜合排序（同一個方向若多站各自獨立出現，視為「已驗證的好點子」，排序拉高）。

1. **時間軸可操控：指定任意日期/時間＋可調播放速度（1x/5x/20x/60x…）重播全天車流**
   出處：Mini Tokyo 3D（playback clock mode）、Travic（play/pause/timeline）、vasile.ch（1x–500x 八段變速）、Flightradar24（最高 300x 回放）— **四站獨立收斂到同一個功能**。
   價值：我們本來就是「算出來的」時刻表模擬，任何時刻的位置都能算，這功能幾乎是把現有引擎包一層時間滑桿 UI，投報率全場最高；也直接強化「放空模式」的可玩性（可跳到早高峰／深夜末班車而不必等）。
   無後端可行性：高（純前端，沿用現有模擬邏輯）。

2. **依時刻自動漸變的地圖日夜色調（日出日落、夕陽餘暉）**
   出處：Mini Tokyo 3D。
   價值：低成本大幅提升「一天感」與沉浸氛圍，跟我們已有的明暗主題／深夜重播是互補而非取代。
   無後端可行性：高（純前端計算台灣的日出日落時間）。

3. **即時「目前運行列車數」計數器**
   出處：vasile.ch。
   價值：一眼可見的氛圍資訊，強化「掛機」時的活躍感，幾乎零成本。
   無後端可行性：高（從既有模擬資料直接算數量）。

4. **系統別／類別篩選開關（可個別顯示/隱藏北捷、高捷、中捷、台鐵、輕軌）**
   出處：Travic（Trams/Subways/Rail/Bus 篩選）、vasile.ch（依業者篩選側欄）。
   價值：系統數已有 5 個且會再增加，篩選能讓使用者專注在想看的路網，避免地圖過於擁擠。
   無後端可行性：高（純前端 UI 狀態切換）。

5. **資料誠實揭露：明確標示「時刻表模擬、非即時動態」與資料來源／授權**
   出處：Realtime Trains（逐站標示資料來源代碼）、Travic（點擊車輛附授權連結）、Open Train Times（以誠實透明贏得百萬鐵道迷月訪客的先例）。
   價值：我們本來就誠實聲明「無即時位置」，但可以做得更好——在列車卡或關於頁清楚寫「本站為 TDX 時刻表模擬，非車輛即時回報位置」，並附資料來源連結；國際先例證明鐵道迷社群不會因誠實聲明而卻步，反而更信任。
   無後端可行性：高（純文案/UI）。

6. **深連結延伸：URL 可帶座標／地點，或用瀏覽器定位顯示「我附近的列車」**
   出處：Signalbox（hackable URLs＋geolocation）。
   價值：我們已有 `?train=&t=` 深連結，加上座標參數或「附近車站」定位是自然延伸，對行動裝置使用者（例如真的在車站等車時打開網站）特別實用。
   無後端可行性：高（純前端 Geolocation API＋URL 參數解析）。

7. **指定任意一天重播（不只是「深夜重播尖峰」，而是可選過去/未來任一天的班表樣貌）**
   出處：Treinposities.nl（歷史回顧）＋ Mini Tokyo 3D 的 playback 概念延伸。
   價值：我們的模擬本質上「任何一天都能算」，比起即時類產品（受限於資料只保留幾天）更有優勢；可做成「選擇星期幾/特定日期」看時刻表差異（比如假日 vs 平日班距）。
   無後端可行性：高，但需處理平／假日時刻表差異的資料完整性（中風險：若 TDX 假日時刻表資料不完整，這功能會露餡）。

8. **列車卡加「本趟旅程時速走勢圖」**
   出處：Flightradar24（上滑看高度/速度歷史圖）。
   價值：對鐵道迷有吸引力的深度資訊，讓「列車介紹卡」更豐富，與旅程日誌互補。
   無後端可行性：中（需要在模擬時額外記錄/計算沿途時速取樣點，工程量比前面幾項高一些）。

9. **基礎設施知識圖層（電氣化區間／隧道／平交道等靜態鐵道知識）**
   出處：OpenRailwayMap（五種疊加圖層）、Carto Tchoo（基礎設施點位＋即時列車合一）。
   價值：鐵道迷向的「進階模式」加值內容，能讓網站從「動畫展示」進階到「鐵道知識地圖」。
   無後端可行性：中（不需後端，但需額外靜態資料製作/收集，目前無現成資料源，優先度可放較後）。

10. **列車追蹤鏡頭效果（跟隨時自動置中/縮放，模擬「跟拍」感）**
    出處：Mini Tokyo 3D（8 種 3D 追蹤視角）。
    價值：強化「點車跟隨」的臨場感，是體驗打磨而非新功能。
    無後端可行性：中（純 2D 版本如「跟隨時自動微幅縮放＋平滑置中」可行；完整 3D 運鏡需要換引擎，成本高，不建議做到那個程度）。

