/* 委員簡報導覽：present.html 依序播放，影片也由同一份腳本錄製。
 * layout: 'title' 全版標題頁；'phone' 左手機右說明。
 * scene：傳給 index.html 的畫面狀態（路線、班次、目的站、語言、分頁、覆蓋層、捲到哪一區、要框出的元素）。
 * dur：自動播放的秒數（影片節奏）。points 每點一行，簡報要講得完。 */
window.RIDE_TOUR = {
  title: '軌島 乘車導覽模式',
  steps: [
    {
      id: 'open', layout: 'title', dur: 5,
      kicker: '互動展示原型',
      title: '乘車導覽模式', plate: '乘車導覽',
      body: '掃一下車廂 QR code，這班車的目的地就開始說故事。',
      points: ['給鐵道業者、觀光單位與地方內容伙伴的展示'],
    },
    {
      id: 'problem', layout: 'title', dur: 7,
      kicker: '為什麼要做',
      title: '旅客在車上，資訊卻散在各處',
      body: '觀光網站不知道你搭哪一班車，鐵道 App 只講時刻。',
      points: ['把「這一班車」和「目的地內容」接起來', '旅程介面由軌島負責，地方內容由在地伙伴提供'],
    },
    {
      id: 'entry', layout: 'phone', dur: 6, chapter: '01', title: '掃 QR 進入',
      body: '車廂、月台、一般連結三種 QR。帶的資訊越多，旅客要選的就越少。',
      points: ['車廂 QR：直接帶入路線與班次', '月台 QR：只帶路線，再選班次'],
      scene: { screen: 'entry', focus: '.scan-list > li:first-child' },
    },
    {
      id: 'journey', layout: 'phone', dur: 7, chapter: '02', title: '這班車就是入口',
      body: '不用再選路線與班次。頁首直接顯示方向、下一站與簡化路線圖。',
      points: ['列車位置清楚標示「示範」，不假裝是即時資料'],
      scene: { line: 'pingxi', train: '4816', via: 'car', focus: '#journey .jcard' },
    },
    {
      id: 'dock', layout: 'phone', dur: 6, chapter: '03', title: '只列這班車會停的站',
      body: '目的站選擇器固定在底部，單手就能點；紅點表示有導覽內容。',
      points: ['不會停的站不出現，避免誤導'],
      scene: { line: 'pingxi', train: '4816', via: 'car', focus: '#dock' },
    },
    {
      id: 'dest', layout: 'phone', dur: 7, chapter: '04', title: '選目的站，內容立刻切換',
      body: '十分：照片、站名牌、一句話主題，加上到站時間和建議停留。',
      points: ['像觀光網站一樣的閱讀順序'],
      scene: { line: 'pingxi', train: '4816', dest: 'shifen', scroll: 'content', focus: '.dhero' },
    },
    {
      id: 'highlights', layout: 'phone', dur: 6, chapter: '05', title: '必看亮點',
      body: '每張卡片都有距離和來源，點開看完整介紹。',
      points: ['內容取自官方公開資料，逐則附連結'],
      scene: { line: 'pingxi', train: '4816', dest: 'shifen', scroll: 'sec-highlights', focus: '#sec-highlights' },
    },
    {
      id: 'routes', layout: 'phone', dur: 7, chapter: '06', title: '推薦路線',
      body: '依官方行程排出景點順序，每段標距離與時間。',
      points: ['官方寫明的時間附來源', '沒有寫明的以「模擬」估算，畫面清楚標示'],
      scene: { line: 'pingxi', train: '4816', dest: 'shifen', scroll: 'sec-routes', focus: '#sec-routes .walk-sum' },
    },
    {
      id: 'shops', layout: 'phone', dur: 7, chapter: '07', title: '在地店家',
      body: '店名與位置取自 OpenStreetMap 開放地圖，依距離排序。',
      points: ['不是廣告，也沒有付費排序', '缺的營業時間以「模擬」值示意'],
      scene: { line: 'pingxi', train: '4816', dest: 'shifen', scroll: 'sec-shops', focus: '#sec-shops' },
    },
    {
      id: 'story', layout: 'phone', dur: 7, chapter: '08', title: '歷史與文化',
      body: '故事卡可以點開閱讀，底下列出來源。',
      points: ['口述傳統標明是口述，不寫成史實'],
      scene: { line: 'pingxi', train: '4816', dest: 'shifen', scroll: 'sec-stories', sheet: { kind: 'station-story', id: 'shifen:film' } },
    },
    {
      id: 'change', layout: 'phone', dur: 6, chapter: '09', title: '臨時改行程',
      body: '改選平溪，介紹、亮點與路線一起換，不必重來。',
      points: ['選擇器一直在底部'],
      scene: { line: 'pingxi', train: '4816', dest: 'pingxi', scroll: 'content', focus: '#dock [aria-pressed="true"]' },
    },
    {
      id: 'english', layout: 'phone', dur: 6, chapter: '10', title: '外國旅客',
      body: '一鍵切換英文，目的站和閱讀位置都保留。',
      points: ['英文為展示用翻譯，正式版需校稿'],
      scene: { line: 'pingxi', train: '4816', dest: 'pingxi', lang: 'en', scroll: 'content', focus: '.lang' },
    },
    {
      id: 'map', layout: 'phone', dur: 6, chapter: '11', title: '地圖與旅程進度',
      body: '展開地圖看路線、示範位置和時刻表；回到導覽時，選擇都還在。',
      points: ['軌道線形來自 OpenStreetMap'],
      scene: { line: 'pingxi', train: '4816', dest: 'pingxi', overlay: 'map' },
    },
    {
      id: 'along', layout: 'phone', dur: 6, chapter: '12', title: '沿途故事',
      body: '依行駛順序介紹車窗外經過的地方，旅客自己點，不需要定位。',
      points: ['和「目的站怎麼逛」分開'],
      scene: { line: 'pingxi', train: '4816', dest: 'pingxi', view: 'along', scroll: 'content', focus: 'ol.tl .story' },
    },
    {
      id: 'guangfu', layout: 'phone', dur: 8, chapter: '13', title: '同一套介面，換到花東',
      body: '臺東線 4528 到光復：阿美族部落、糖廠、濕地。',
      points: ['換路線只需要換內容，介面不必重做', '災後復原中的地方，先提醒旅客確認現況'],
      scene: { line: 'huadong', train: '4528', dest: 'guangfu', scroll: 'content', focus: '.alert-card' },
    },
    {
      id: 'tongxiao', layout: 'phone', dur: 7, chapter: '14', title: '西部海線：通霄',
      body: '海線 2527 到通霄：神社遺跡、鹽業與虎頭山；下車前就能看到之後的班次。',
      points: ['班次取自臺鐵開放資料時刻表'],
      scene: { line: 'haixian', train: '2527', dest: 'tongxiao', scroll: 'sec-next', focus: '#sec-next' },
    },
    {
      id: 'honest', layout: 'title', dur: 7,
      kicker: '資料誠實標示',
      title: '每一筆資料都看得出從哪裡來',
      body: '',
      points: ['已查證：附官方或權威來源連結', 'OSM：開放地圖資料，未逐一查證', '模擬：示範用的假設值，正式版由伙伴或地圖服務提供', '不使用業者標誌、不宣稱合作、不放廣告'],
    },
    {
      id: 'next', layout: 'title', dur: 7,
      kicker: '合作模式與下一步',
      title: '在地伙伴提供內容，軌島負責旅程介面',
      body: '',
      points: ['串接即時列車位置與誤點', '內容後台：供稿、審核、定期查核', '選一條路線做真實 QR 試點'],
    },
    {
      id: 'end', layout: 'title', dur: 4,
      kicker: '軌島 Rail Island',
      title: '謝謝', plate: '謝謝',
      body: '乘車導覽模式・互動展示原型',
      points: [],
    },
  ],
};
