/* 軌島「乘車導覽模式」互動展示原型。
 * 不連任何即時 API：班次與停靠站來自 data/routes.js（臺鐵開放資料時刻表快照），
 * 列車位置是依時刻表手動推進的「示範位置」，地方內容來自 data/content.js（每則附來源），
 * 店家來自 data/places.js（OpenStreetMap）。缺的欄位以「模擬」值補上並在畫面標示。
 * 狀態分兩種：
 *   導航狀態（畫面／路線／班次／覆蓋層）走 history，返回鍵可以一層層退；
 *   旅程狀態（目的站／語言／分頁／示範位置）不進 history——返回關掉地圖或故事時，選擇不會被倒回去。 */
(function () {
  'use strict';

  const DATA = window.RIDE_ROUTES;
  const C = window.RIDE_CONTENT;
  const PLACES = window.RIDE_PLACES || { stations: {} };
  const app = document.getElementById('app');
  // 資料檔沒載到時不要留白畫面：直接說哪裡壞了
  if (!DATA || !C) {
    app.innerHTML = '<p style="padding:24px 16px;max-width:40em">示範資料沒有載入（data/routes.js 或 data/content.js）。請重新整理頁面。<br>The demo data did not load. Please reload the page.</p>';
    return;
  }
  const sheetRoot = document.createElement('div');
  document.body.appendChild(sheetRoot);

  const LINES = Object.keys(DATA.routes);
  const TRAINS = {};
  const NAMES = {};
  for (const [line, r] of Object.entries(DATA.routes)) {
    r.trains.forEach((tr) => { TRAINS[tr.no] = { ...tr, line }; });
    for (const [id, st] of Object.entries(r.stations)) NAMES[id] = { zh: st.zh, en: st.en };
  }
  // 示範情境：車廂 QR 通常在剛上車時被掃到——往菁桐的車剛離開瑞芳（台北來的旅客在這裡轉乘）；其他班次從起站剛開出。
  const START = { 4816: 'ruifang' };
  // 入口的「車廂 QR」：每條示範路線一班
  const CAR_QR = [{ line: 'pingxi', train: '4816', fk: 'scan-car' }, { line: 'huadong', train: '4528', fk: 'scan-car-huadong' }, { line: 'haixian', train: '2527', fk: 'scan-car-haixian' }];
  const mqDesk = matchMedia('(min-width:1080px)');
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');

  /* ───────── 文案 ───────── */
  const UI = {
    zh: {
      htmlLang: 'zh-Hant',
      title: '軌島乘車導覽',
      demoBadge: '互動展示・示範班次',
      demoShort: '示範',
      entryEyebrow: 'RAIL ISLAND · 乘車導覽模式',
      entryTitle: '掃車廂 QR code，看這趟車目的站的地方故事',
      entryLead: '這是給鐵道業者、觀光單位與地方內容伙伴看的互動展示。旅客掃 QR code 後，依這班車的目的站切換地方介紹、歷史文化、散步建議和下車交通。下面三種 QR 模擬不同的進入方式。',
      scanCarT: '車廂 QR', scanCarD: '帶路線與班次，直接進入這趟旅程。三條示範路線各有一班：',
      scanPlatT: '月台 QR', scanPlatD: '只帶路線，進入後選班次。',
      scanBareT: '一般連結', scanBareD: '沒有帶資訊，進入後選路線與班次。',
      scanBtn: '模擬掃描',
      qrNote: '示意，不可掃',
      aboutBtn: '關於這個展示：哪些是示範資料',
      routeTitle: '選擇路線', routeLead: '三條示範路線：北部支線、花東縱谷、西部海線。',
      trainTitle: '選擇班次',
      trainLead: (r) => `只列出示範資料裡的班次。時刻取自臺鐵開放資料，${r} 每日行駛。`,
      back: '返回',
      to: (x) => `往${x}`,
      runs: (a, at, b, bt) => `${a} ${at} 開 → ${b} ${bt} 到`,
      next: '下一站',
      arrAt: (t) => `${t} 到`,
      depAt: (t) => `${t} 開`,
      simPos: '示範位置',
      between: (a, b) => `${a} → ${b} 行駛中`,
      basis: (d) => `依臺鐵 ${d} 公告時刻表排出的示範位置，不是即時列車位置。`,
      mapBtn: '地圖',
      mapBtnLong: '展開地圖與旅程進度',
      tabGuide: '目的站導覽', tabAlong: '沿途故事',
      dockLabel: '目的站', hasGuide: '有導覽',
      chooseTitle: '你要在哪一站下車？',
      chooseLead: '從畫面下方選目的站。這裡會換成那一站的介紹、故事、散步建議和下車交通。',
      chooseQuick: '這班車接下來會停、而且有導覽內容的站：',
      sec: { intro: '認識這裡', highlights: '必看亮點', routes: '推薦路線', shops: '在地店家', stories: '文化故事', next: '下一班車', access: '怎麼抵達', practical: '實用資訊', sources: '本站資料來源' },
      secEn: { intro: 'About', highlights: 'Highlights', routes: 'Routes', shops: 'Local shops', stories: 'Culture', next: 'Next trains', access: 'Getting there', practical: 'Good to know', sources: 'Sources' },
      readMore: '閱讀全文 ›',
      source: '來源',
      checked: (d) => `查核日期 ${d}`,
      stopsLeft: (n) => (n === 1 ? '下一站就是' : `還有 ${n} 站`),
      arrDep: (a, d) => (a === d ? `${a} 停靠` : `${a} 到・${d} 開`),
      termArr: (a) => `${a} 到（終點）`,
      byTimetable: '依時刻表',
      walkTotal: (m) => `步行合計約 ${m} 分鐘`,
      walkTotalTbd: '步行合計待查核',
      walkTotalPartial: '部分步行時間已查核，其餘待查核',
      spanMin: (a, b, m) => `${a}到${b}合計約 ${m} 分鐘`,
      spanIn: '含在上一段的時間內',
      straight: (m) => `直線約 ${m} 公尺`,
      walkPoints: (n) => `${n} 個點`,
      walkLoop: '從車站出發、回到車站',
      walkMapNote: '點與點之間以直線示意順序，不是實際步行路徑；「直線約」是座標直線距離，不是步行路程。',
      legMin: (m) => `步行約 ${m} 分鐘`,
      legTbd: '步行時間待查核',
      station: '車站',
      noContentTitle: (x) => `${x}的地方內容還沒建立`,
      noContentLead: '這個展示只建立了十分、平溪、菁桐三站。之後可由業者、觀光單位或地方伙伴提供並審核內容，軌島負責旅程介面。',
      noContentAlong: (x) => `「沿途故事」裡有一則和${x}有關的故事。`,
      readStory: '讀這則故事',
      seeOthers: '看看有內容的站：',
      passedTitle: (x) => `示範位置已經過${x}`,
      passedLead: (x) => `內容先保留。可以改選前方的站，或把示範位置調回${x}之前。`,
      passedBtn: (x) => `調回${x}之前`,
      alongIntro: '依這班車的行駛順序，介紹車窗外經過的地方，點開就能讀。想下車逛逛，請看「目的站導覽」。',
      tagNext: '下一站', tagDest: '目的站', tagPassed: '已經過', tagAfter: '目的站之後', tagOrigin: '起站', tagTerminal: '終點',
      trainHere: '列車在這裡（示範）',
      toGuide: '看目的站導覽',
      mapTitle: '地圖與旅程進度',
      backToGuide: '回到導覽',
      mapAttr: '軌道線形：© OpenStreetMap 貢獻者（ODbL），由軌島整理。示意圖；列車位置為示範，不是即時位置。',
      stepPrev: '示範位置退一站', stepNext: '示範位置前進一站',
      ttStation: '車站', ttTime: '時刻（依時刻表）',
      ttBasis: (d, r) => `時刻表快照 ${d} 抓取，適用 ${r}。`,
      close: '關閉',
      fromCar: (l, n, d) => `已從車廂 QR 帶入：${l}・${n} ${d}。不用重選，直接選目的站。`,
      fromPlat: (l) => `已從月台 QR 帶入路線：${l}。請選班次。`,
      badLine: (x) => `網址裡的路線「${x}」不在示範資料中，請重新選擇。`,
      badTrain: (x) => `網址裡的班次「${x}」不在示範資料中，請重新選擇。`,
      badDest: (x) => `網址裡的目的站「${x}」不是這班車接下來會停的站，已略過，請從下方重選。`,
      restart: '回到 QR 模擬入口',
      photo: '照片',
      photoMissing: '照片待補：還沒找到授權可用的照片。',
      timetableLink: (x) => `在軌島查${x}車站時刻表`,
      scale: (n) => `${n} 公里`,
      scaleM: (n) => `${n} 公尺`,
      north: '北',
      storyAt: (x) => `沿途故事・${x}`,
      storyOf: (x) => `${x}・歷史與文化`,
      sourcesH: '來源',
      aboutTitle: '關於這個展示',
      tbd: '待補',
      entryPlateL: '三條示範路線',
      guidesAt: (x) => `導覽站：${x}`,
      stopsCount: (n) => `停靠 ${n} 站`,
      changeNote: '時間與班次可能變動，出發前請以官方來源為準。',
      osmAttr: (d) => `店家資料：© OpenStreetMap 貢獻者（${d} 擷取）`,
      factArr: '到站', factLeft: '距離', factStay: '建議停留',
      stopsShort: (n) => `還有 ${n} 站`,
      legendLead: '資料標示：',
      legendSrc: '已查證，附來源',
      legendOsm: '地圖資料，未逐一查證',
      legendSim: '模擬值，正式版由業者或地圖服務提供',
      provSim: '模擬',
      meters: (n) => `${n} 公尺`, km: (n) => `${n} 公里`,
      fromStation: (d) => `距車站 ${d}`,
      fromStationH: '距車站（直線）',
      hlNote: '距離為座標直線距離。點卡片看介紹與來源。',
      mode: { walk: '步行', bike: '單車', bus: '公車' },
      totalAbout: (m) => `合計約 ${m} 分鐘`,
      legMode: (label, m) => `${label}約 ${m} 分鐘`,
      cat: { all: '全部', eat: '吃', drink: '喝', buy: '買' },
      shopsLead: (n) => `車站 1.5 公里內，地圖上有名字的在地店家 ${n} 家，依距離排序。`,
      hours: '營業時間',
      showAll: (n) => `顯示全部 ${n} 家`, showLess: '收合',
      shopsNote: (d) => `店名與位置取自 OpenStreetMap（${d} 擷取），不是廣告，也沒有付費排序；營業時間標「模擬」的是示範值。連鎖超商與速食已排除。`,
      kind: { restaurant: '餐廳', fast_food: '小吃', food_court: '美食街', cafe: '咖啡・茶飲', ice_cream: '冰品', bar: '酒吧', bakery: '麵包', confectionery: '糕餅', tea: '茶葉', gift: '伴手禮', farm: '農產', deli: '熟食', pastry: '糕點', beverages: '飲料', souvenir: '紀念品', craft: '工藝', seafood: '海產', greengrocer: '蔬果' },
      cuisine: { breakfast: '早餐', taiwanese: '台菜', chinese: '中式', noodle: '麵食', amis: '阿美族料理', vietnamese: '越式', brunch: '早午餐', coffee_shop: '咖啡', bubble_tea: '手搖飲', ice_cream: '冰品', regional: '在地料理', vegetarian: '素食', '港式': '港式' },
      nextLead: (t, d) => `示範列車 ${t} 到站後，從本站開出的班次（示範日 ${d} 時刻表）。`,
      depTime: '開車', depTrain: '車次', depTo: '往',
      typeName: { 區間車: '區間車', 區間快: '區間快', 自強: '自強', '莒光/復興': '莒光' },
      hlOf: (x) => `${x}・必看亮點`,
    },
    en: {
      htmlLang: 'en',
      title: 'Rail Island Ride Guide',
      demoBadge: 'Interactive demo · sample train',
      demoShort: 'Demo',
      entryEyebrow: 'RAIL ISLAND · RIDE GUIDE MODE',
      entryTitle: 'Scan the QR code on board and read about where this train is taking you',
      entryLead: 'An interactive demo for rail operators, tourism bodies and local content partners. After scanning, riders see an introduction, history, a short walk and onward transport for the stop they choose on this train. The three QR codes below simulate different ways in.',
      scanCarT: 'In-car QR', scanCarD: 'Carries the line and the train and opens the journey directly. One train per demo line:',
      scanPlatT: 'Platform QR', scanPlatD: 'Carries the line only. Pick a train next.',
      scanBareT: 'Plain link', scanBareD: 'Carries nothing. Pick a line and a train.',
      scanBtn: 'Simulate scan',
      qrNote: 'Mock-up, not scannable',
      aboutBtn: 'About this demo: what is sample data',
      routeTitle: 'Choose a line', routeLead: 'Three demo lines: a northern branch line, the East Rift Valley and the west coast.',
      trainTitle: 'Choose a train',
      trainLead: (r) => `Only trains in the demo data are listed. Times come from TRA open data and run daily ${r}.`,
      back: 'Back',
      to: (x) => `for ${x}`,
      runs: (a, at, b, bt) => `${a} ${at} → ${b} ${bt}`,
      next: 'Next stop',
      arrAt: (t) => `arr. ${t}`,
      depAt: (t) => `dep. ${t}`,
      simPos: 'Demo position',
      between: (a, b) => `${a} → ${b}, running`,
      basis: (d) => `Demo position laid out from the TRA timetable published ${d}. This is not a live train location.`,
      mapBtn: 'Map',
      mapBtnLong: 'Open map and journey progress',
      tabGuide: 'Destination guide', tabAlong: 'Along the way',
      dockLabel: 'Get off at', hasGuide: 'guide',
      chooseTitle: 'Where are you getting off?',
      chooseLead: 'Pick a stop at the bottom of the screen. This area switches to that stop’s introduction, stories, walk and onward transport.',
      chooseQuick: 'Upcoming stops on this train that have a guide:',
      sec: { intro: 'About this place', highlights: 'Highlights', routes: 'Suggested routes', shops: 'Local shops', stories: 'Culture & stories', next: 'Next trains', access: 'Getting there', practical: 'Good to know', sources: 'Sources for this stop' },
      secEn: {},
      readMore: 'Read ›',
      source: 'Source',
      checked: (d) => `Checked ${d}`,
      stopsLeft: (n) => (n === 1 ? 'Next stop' : `${n} stops to go`),
      arrDep: (a, d) => (a === d ? `stops ${a}` : `arr. ${a} · dep. ${d}`),
      termArr: (a) => `arr. ${a} (terminus)`,
      byTimetable: 'timetable',
      walkTotal: (m) => `About ${m} min walking in total`,
      walkTotalTbd: 'Total walking time not yet verified',
      walkTotalPartial: 'Some walking times verified, others not yet',
      spanMin: (a, b, m) => `${a} to ${b}: about ${m} min in all`,
      spanIn: 'included in the time above',
      straight: (m) => `${m} m in a straight line`,
      walkPoints: (n) => `${n} stops`,
      walkLoop: 'Starts and ends at the station',
      walkMapNote: 'Straight lines only show the order, not the walking path. “In a straight line” distances are measured between coordinates, not along the route.',
      legMin: (m) => `About ${m} min on foot`,
      legTbd: 'Walking time not yet verified',
      station: 'Station',
      noContentTitle: (x) => `No local guide for ${x} yet`,
      noContentLead: 'This demo covers three stops: Shifen, Pingxi and Jingtong. Later, operators, tourism bodies or local partners could supply and review content while Rail Island runs the journey interface.',
      noContentAlong: (x) => `“Along the way” has a story about ${x}.`,
      readStory: 'Read the story',
      seeOthers: 'Stops with a guide:',
      passedTitle: (x) => `The demo position is already past ${x}`,
      passedLead: (x) => `The guide stays open. Pick a stop ahead, or move the demo position back to before ${x}.`,
      passedBtn: (x) => `Move back before ${x}`,
      alongIntro: 'Places outside the window, in the order this train passes them. Tap one to read. For walks at your stop, see “Destination guide”.',
      tagNext: 'Next', tagDest: 'Your stop', tagPassed: 'Passed', tagAfter: 'After your stop', tagOrigin: 'Origin', tagTerminal: 'Terminus',
      trainHere: 'Train is here (demo)',
      toGuide: 'Open destination guide',
      mapTitle: 'Map & journey progress',
      backToGuide: 'Back to guide',
      mapAttr: 'Track geometry: © OpenStreetMap contributors (ODbL), processed by Rail Island. Schematic; the train position is a demo, not live.',
      stepPrev: 'Move demo position back one stop', stepNext: 'Move demo position forward one stop',
      ttStation: 'Station', ttTime: 'Time (timetable)',
      ttBasis: (d, r) => `Timetable snapshot fetched ${d}, valid ${r}. `,
      close: 'Close',
      fromCar: (l, n, d) => `Line and train came from the in-car QR: ${l} · ${n} ${d}. No need to choose again; pick your stop.`,
      fromPlat: (l) => `Line came from the platform QR: ${l}. Pick a train.`,
      badLine: (x) => `The line “${x}” in the link is not in the demo data. Please choose again.`,
      badTrain: (x) => `The train “${x}” in the link is not in the demo data. Please choose again.`,
      badDest: (x) => `“${x}” in the link is not an upcoming stop of this train, so it was skipped. Pick a stop below.`,
      restart: 'Back to the QR demo entry',
      photo: 'Photo',
      photoMissing: 'Photo to come: no suitably licensed photo found yet.',
      timetableLink: (x) => `${x} Station timetable on Rail Island`,
      scale: (n) => `${n} km`,
      scaleM: (n) => `${n} m`,
      north: 'N',
      storyAt: (x) => `Along the way · ${x}`,
      storyOf: (x) => `${x} · History & culture`,
      sourcesH: 'Sources',
      aboutTitle: 'About this demo',
      tbd: 'to be added',
      entryPlateL: 'Three demo lines',
      guidesAt: (x) => `Guides: ${x}`,
      stopsCount: (n) => `${n} stops`,
      changeNote: 'Hours and schedules change. Check the official source before you go.',
      osmAttr: (d) => `Shop data: © OpenStreetMap contributors (fetched ${d})`,
      factArr: 'Arrives', factLeft: 'Distance', factStay: 'Suggested stay',
      stopsShort: (n) => `${n} stops`,
      legendLead: 'Data labels: ',
      legendSrc: 'verified, with source',
      legendOsm: 'map data, not individually checked',
      legendSim: 'simulated; the real version would come from partners or a map service',
      provSim: 'Simulated',
      meters: (n) => `${n} m`, km: (n) => `${n} km`,
      fromStation: (d) => `${d} from the station`,
      fromStationH: 'From the station (straight line)',
      hlNote: 'Distances are straight lines between coordinates. Tap a card for details and sources.',
      mode: { walk: 'Walk', bike: 'Bike', bus: 'Bus' },
      totalAbout: (m) => `About ${m} min in total`,
      legMode: (label, m) => `${label} about ${m} min`,
      cat: { all: 'All', eat: 'Eat', drink: 'Drink', buy: 'Shop' },
      shopsLead: (n) => `${n} named local shops within 1.5 km of the station on the map, nearest first.`,
      hours: 'Hours',
      showAll: (n) => `Show all ${n}`, showLess: 'Show fewer',
      shopsNote: (d) => `Names and locations from OpenStreetMap (fetched ${d}). Not advertising, no paid ranking. Hours marked “Simulated” are demo values. Chain convenience stores and fast food are excluded.`,
      kind: { restaurant: 'Restaurant', fast_food: 'Quick eats', food_court: 'Food court', cafe: 'Café & drinks', ice_cream: 'Ice cream', bar: 'Bar', bakery: 'Bakery', confectionery: 'Sweets', tea: 'Tea', gift: 'Gifts', farm: 'Farm produce', deli: 'Deli', pastry: 'Pastries', beverages: 'Drinks', souvenir: 'Souvenirs', craft: 'Crafts', seafood: 'Seafood', greengrocer: 'Greengrocer' },
      cuisine: { breakfast: 'breakfast', taiwanese: 'Taiwanese', chinese: 'Chinese', noodle: 'noodles', amis: 'Amis cuisine', vietnamese: 'Vietnamese', brunch: 'brunch', coffee_shop: 'coffee', bubble_tea: 'bubble tea', ice_cream: 'ice cream', regional: 'local', vegetarian: 'vegetarian', '港式': 'Hong Kong style' },
      nextLead: (t, d) => `Departures from this station after the demo train arrives at ${t} (timetable for the demo day, ${d}).`,
      depTime: 'Dep.', depTrain: 'Train', depTo: 'To',
      typeName: { 區間車: 'Local', 區間快: 'Fast Local', 自強: 'Tze-Chiang', '莒光/復興': 'Chu-Kuang' },
      hlOf: (x) => `${x} · Highlights`,
    },
  };

  /* ───────── 狀態 ───────── */
  const state = {
    screen: 'entry', line: null, train: null, overlay: null, sheet: null,
    dest: null, lang: 'zh', view: 'guide', pos: 0,
    notice: null,           // 一次性提示 {kind:'info'|'warn', text: fn(lang)}
    entryVia: null,         // 'car' | 'platform' | 'bare' | 'url'
    under: null,            // 故事面板開在地圖上時記住底下是地圖
    routeTab: 0, shopCat: 'all', shopAll: false,
    tour: false,            // 簡報導覽驅動中：不寫入 history，避免示範時返回鍵退出頁面
  };
  let busyUntil = 0;
  let lastFocusKey = null;

  const T = () => UI[state.lang];
  const L = (o) => (o == null ? '' : typeof o === 'string' ? o : (o[state.lang] ?? o.zh ?? ''));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hhmm = (sec) => { const s = ((sec % 86400) + 86400) % 86400; return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`; };
  const stName = (id) => L(NAMES[id]) || id;
  const route = () => DATA.routes[state.line] || DATA.routes[(TRAINS[state.train] || {}).line];
  const train = () => TRAINS[state.train];
  const stops = () => train().stops;
  const idxOf = (id) => stops().findIndex((s) => s.id === id);
  const terminal = () => stops()[stops().length - 1];
  const dirText = () => T().to(stName(terminal().id));
  const lineName = () => L(C.lines[state.line].name);
  const fmtRange = () => {
    const [a, b] = DATA.scheduleRange;
    return state.lang === 'en' ? `${a} – ${b}` : `${a.replace(/-/g, '/')}～${b.slice(5).replace('-', '/')}`;
  };
  const isDesk = () => mqDesk.matches;
  const hasGuide = (id) => !!C.stations[id];
  const storyFor = (id) => C.along.find((a) => a.station === id);
  const now = () => performance.now();

  function resetTrainState() {
    const tr = train();
    if (!tr) return;
    const s = START[tr.no];
    state.pos = Math.max(0, Math.min(tr.stops.length - 2, s ? tr.stops.findIndex((x) => x.id === s) : 0));
    if (state.dest && !isUpcoming(state.dest)) state.dest = null;
  }
  const isUpcoming = (id) => { const i = idxOf(id); return i > state.pos; };

  /* ───────── URL 與 history ───────── */
  function parseLocation() {
    const out = {};
    const q = new URLSearchParams(location.search);
    for (const k of ['line', 'train', 'dest', 'lang', 'view', 'tour']) if (q.get(k)) out[k] = q.get(k).trim();
    // Artifact 預覽只帶得進 #純字元錨點：#pingxi-4816-shifen-en 這種逐段比對
    const h = location.hash.replace(/^#/, '');
    if (h && /^[A-Za-z0-9._~-]+$/.test(h)) {
      for (const tok of h.split(/[-.~_]/)) {
        const k = tok.toLowerCase();
        if (C.lines[k]) out.line = k;
        else if (/^\d{3,5}$/.test(k)) out.train = k;
        else if (NAMES[k]) out.dest = k;
        else if (k === 'en' || k === 'zh') out.lang = k;
        else if (k === 'along') out.view = 'along';
      }
    }
    return out;
  }

  function urlFor(nav) {
    const q = new URLSearchParams();
    if (nav.line) q.set('line', nav.line);
    if (nav.train) q.set('train', nav.train);
    if (nav.screen === 'journey' && state.dest) q.set('dest', state.dest);
    if (state.lang !== 'zh') q.set('lang', state.lang);
    const s = q.toString();
    return location.pathname + (s ? `?${s}` : '');
  }

  function navEntry(over) {
    return { rg: 1, screen: state.screen, line: state.line, train: state.train, overlay: state.overlay, sheet: state.sheet, ...over };
  }

  function writeHistory(entry, replace) {
    const fn = replace || state.tour ? 'replaceState' : 'pushState';
    try { history[fn](entry, '', urlFor(entry)); return; } catch (e) { /* 沙盒或 file:// 不給改網址 */ }
    try { history[fn](entry, ''); } catch (e) { /* 連 state 都不給就只靠頁內返回鈕 */ }
  }

  function go(nav, { replace = false } = {}) {
    const depth = (history.state && history.state.rg ? history.state.depth || 0 : 0) + (replace ? 0 : 1);
    const entry = navEntry({ ...nav, depth });
    applyNav(entry);
    writeHistory(entry, replace);
  }

  function syncUrl() {
    const cur = history.state && history.state.rg ? history.state : navEntry({ depth: 0 });
    writeHistory(cur, true);
  }

  function applyNav(nav) {
    // 班次只在「換到另一班」時重設；退回選班次畫面再選同一班，目的站與示範位置都保留
    if (nav.train && nav.train !== state.train) { state.train = nav.train; state.dest = null; resetTrainState(); }
    const prevOverlay = state.overlay;
    state.screen = nav.train || nav.screen !== 'journey' ? nav.screen : 'train';
    state.line = nav.line || null;
    state.overlay = nav.overlay || null;
    state.sheet = nav.overlay === 'sheet' ? nav.sheet || null : null;
    state.under = nav.overlay === 'sheet' ? nav.under || null : null;
    if (state.overlay === 'map' && isDesk()) state.overlay = null;
    render();
    // 覆蓋層開關時的焦點：開地圖移到「回到導覽」，關地圖回到原本的按鈕
    if (state.tour) return; // 簡報導覽驅動時不搬焦點，畫面上不會殘留焦點框
    if (state.overlay === 'map' && prevOverlay !== 'map') focusKey('map-close');
    else if (prevOverlay === 'map' && state.overlay !== 'map' && state.overlay !== 'sheet') focusKey(mapReturnKey);
  }
  let mapReturnKey = 'map-open';
  function focusKey(k) {
    const el = k && document.querySelector(`[data-fk="${CSS.escape(k)}"]`);
    if (el && el.offsetParent !== null) el.focus({ preventScroll: true });
  }

  window.addEventListener('popstate', (e) => {
    const s = e.state;
    if (s && s.rg) applyNav(s);
    else applyNav({ screen: 'entry' });
    syncUrl(); // 退回的那一層網址可能還是舊的目的站／語言
  });

  /* ───────── 進入（真的網址或模擬掃描都走這裡） ───────── */
  function enter(params, { via = 'url', push = false } = {}) {
    if (params.lang === 'en' || params.lang === 'zh') state.lang = params.lang;
    state.notice = null;
    state.entryVia = via;
    let nav;
    if (!params.line) {
      nav = { screen: via === 'url' ? 'entry' : 'route' };
    } else if (!C.lines[params.line]) {
      state.notice = { kind: 'warn', text: (t) => t.badLine(params.line) };
      nav = { screen: 'route' };
    } else if (!params.train) {
      if (via === 'platform') state.notice = { kind: 'info', text: (t) => t.fromPlat(L(C.lines[params.line].name)) };
      nav = { screen: 'train', line: params.line };
    } else if (!TRAINS[params.train] || TRAINS[params.train].line !== params.line) {
      state.notice = { kind: 'warn', text: (t) => t.badTrain(params.train) };
      nav = { screen: 'train', line: params.line };
    } else {
      nav = { screen: 'journey', line: params.line, train: params.train };
    }
    if (nav.train !== state.train) { state.train = nav.train || null; state.dest = null; if (state.train) resetTrainState(); }
    if (nav.screen === 'journey') {
      state.view = params.view === 'along' ? 'along' : 'guide';
      if (via === 'car') {
        const tr = TRAINS[nav.train];
        state.notice = { kind: 'info', text: (t) => t.fromCar(lineName(), tr.no, dirText()) };
      }
      if (params.dest) {
        if (isUpcoming(params.dest)) state.dest = params.dest;
        else state.notice = { kind: 'warn', text: (t) => t.badDest(params.dest) };
      }
    }
    go(nav, { replace: !push });
  }

  /* ───────── 動作 ───────── */
  function setDest(id) {
    if (!id || state.dest === id) { scrollToContent(); return; } // 重複點同一站：不重繪，只確保看得到內容
    if (idxOf(id) < 0) return;
    state.dest = id;
    state.view = 'guide';
    state.notice = null;
    state.routeTab = 0; state.shopCat = 'all'; state.shopAll = false;
    paintJourney({ fade: true });
    scrollToContent();
    syncUrl();
  }

  function setLang(lang) {
    if (lang === state.lang || !UI[lang]) return;
    state.lang = lang;
    render();
    syncUrl();
  }

  function setView(v) {
    if (v === state.view) return;
    state.view = v;
    paintJourney({});
    scrollToContent();
  }

  function step(dir) {
    const n = stops().length;
    const p = Math.max(0, Math.min(n - 2, state.pos + dir));
    if (p === state.pos) return;
    state.pos = p;
    paintJourney({});
  }

  function moveBefore(id) {
    const i = idxOf(id);
    if (i < 1) return;
    state.pos = Math.min(i - 1, stops().length - 2);
    paintJourney({});
    scrollToContent();
  }

  function openMap(fromKey) {
    if (isDesk() || state.overlay === 'map') return;
    mapReturnKey = fromKey || 'map-open';
    go({ overlay: 'map' });
  }
  function closeOverlay(kind) {
    if (state.overlay !== kind) return;
    if (history.state && history.state.rg && history.state.overlay === kind && (history.state.depth || 0) > 0) history.back();
    else go({ overlay: null, sheet: null }, { replace: true });
  }
  function openSheet(spec) {
    if (state.overlay === 'sheet' && state.sheet && state.sheet.kind === spec.kind && state.sheet.id === spec.id) return;
    lastFocusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk || null : null;
    // 地圖開著時讀故事：故事疊在地圖上，關掉回到地圖
    go({ overlay: 'sheet', sheet: spec, under: state.overlay === 'map' ? 'map' : null }, { replace: state.overlay === 'sheet' });
  }
  function back() {
    if (history.state && history.state.rg && (history.state.depth || 0) > 0) { history.back(); return; }
    const parent = state.screen === 'journey' ? { screen: 'train', line: state.line }
      : state.screen === 'train' ? { screen: 'route' } : { screen: 'entry' };
    go(parent, { replace: true });
  }

  function scrollToContent() {
    const a = document.getElementById('content-anchor');
    if (!a) return;
    const bar = document.querySelector('.jbar');
    const off = bar ? bar.getBoundingClientRect().height : 0;
    const top = a.getBoundingClientRect().top + window.scrollY - off;
    if (window.scrollY > top + 2) window.scrollTo({ top, behavior: mqReduce.matches ? 'auto' : 'smooth' });
  }

  app.addEventListener('click', onClick);
  sheetRoot.addEventListener('click', onClick);
  function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act;
    if (el.tagName === 'A' && act === 'jump') {
      e.preventDefault();
      const target = document.getElementById(el.dataset.target);
      if (target) target.scrollIntoView({ behavior: mqReduce.matches ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    // 換畫面的動作擋連點：同一個 tick 連按兩下只算一次
    const screenActs = { scan: 1, 'pick-line': 1, 'pick-train': 1, back: 1, restart: 1 };
    if (screenActs[act]) {
      if (now() < busyUntil) return;
      busyUntil = now() + 400;
    }
    switch (act) {
      case 'scan': {
        const p = Object.fromEntries(new URLSearchParams(el.dataset.query || ''));
        enter(p, { via: el.dataset.via, push: true });
        break;
      }
      case 'pick-line': state.notice = null; go({ screen: 'train', line: el.dataset.line }); break;
      case 'pick-train': {
        state.notice = null;
        if (state.train !== el.dataset.train) { state.train = el.dataset.train; state.dest = null; resetTrainState(); }
        state.view = 'guide';
        go({ screen: 'journey', line: state.line, train: el.dataset.train });
        break;
      }
      case 'back': back(); break;
      case 'restart':
        state.notice = null; state.train = null; state.dest = null; state.view = 'guide';
        go({ screen: 'entry', line: null, train: null, overlay: null, sheet: null });
        break;
      case 'dest': setDest(el.dataset.id); break;
      case 'lang': setLang(el.dataset.lang); break;
      case 'view': setView(el.dataset.view); break;
      case 'map-open': openMap(el.dataset.fk); break;
      case 'map-close': closeOverlay('map'); break;
      case 'story': openSheet({ kind: el.dataset.kind || 'story', id: el.dataset.id }); break;
      case 'about': openSheet({ kind: 'about', id: 'about' }); break;
      case 'sheet-close': closeOverlay('sheet'); break;
      case 'step': step(Number(el.dataset.dir)); break;
      case 'move-before': moveBefore(el.dataset.id); break;
      case 'dismiss': state.notice = null; paintJourney({}); break;
      case 'route-tab': state.routeTab = Number(el.dataset.i) || 0; paintJourney({}); break;
      case 'shop-cat': if (state.shopCat !== el.dataset.cat) { state.shopCat = el.dataset.cat; state.shopAll = false; paintJourney({}); } break;
      case 'shop-all': state.shopAll = !state.shopAll; paintJourney({}); break;
      default: break;
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.overlay === 'sheet') closeOverlay('sheet');
    else if (state.overlay === 'map') closeOverlay('map');
  });
  mqDesk.addEventListener('change', () => {
    if (isDesk() && state.overlay === 'map') go({ overlay: null }, { replace: true });
    else render();
  });

  /* ───────── 畫面 ───────── */
  function render() {
    const t = T();
    document.documentElement.lang = t.htmlLang;
    document.title = t.title;
    const fk = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
    if (state.screen === 'journey' && state.train) {
      if (!app.querySelector('[data-screen="journey"]')) {
        app.innerHTML = journeyShell();
        window.scrollTo(0, 0);
      }
      paintJourney({ keepFocus: fk });
    } else {
      const key = [state.screen, state.lang, state.line, state.notice ? state.notice.text(T()) : ''].join('|');
      if (app.dataset.key !== key) {
        const screenChanged = !app.querySelector(`[data-screen="${state.screen}"]`);
        app.innerHTML = state.screen === 'route' ? routeScreen() : state.screen === 'train' ? trainScreen() : entryScreen();
        app.dataset.key = key;
        if (screenChanged) window.scrollTo(0, 0);
        restoreFocus(fk);
      }
    }
    if (state.screen === 'journey') app.dataset.key = '';
    renderSheet();
  }

  function restoreFocus(fk) {
    if (!fk) return;
    const el = document.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if (el) el.focus({ preventScroll: true });
  }

  function noticeHtml() {
    if (!state.notice) return '';
    return `<div class="notice ${state.notice.kind === 'info' ? 'info' : ''}" role="status">${esc(state.notice.text(T()))}</div>`;
  }

  /* 入口：三種 QR 模擬 */
  function entryScreen() {
    const t = T();
    const base = 'railisland.tw/ride/';
    const carBtns = CAR_QR.map((c, i) => {
      const tr = TRAINS[c.train];
      const last = tr.stops[tr.stops.length - 1].id;
      const guides = tr.stops.filter((x) => hasGuide(x.id)).map((x) => stName(x.id)).join(state.lang === 'en' ? ', ' : '・');
      return `<button class="btn ${i === 0 ? 'primary' : ''} block scan-opt" data-act="scan" data-via="car" data-query="line=${c.line}&amp;train=${c.train}" data-fk="${c.fk}">
        <span>${esc(L(C.lines[c.line].name))} <span class="num">${c.train}</span> ${esc(t.to(stName(last)))}</span><small>${esc(t.guidesAt(guides))}</small></button>`;
    }).join('');
    const scans = [
      { via: 'car', title: t.scanCarT, desc: t.scanCarD, code: `${base}?line=pingxi&train=4816`, body: `<div class="scan-opts">${carBtns}</div>` },
      { via: 'platform', title: t.scanPlatT, desc: t.scanPlatD, code: `${base}?line=huadong`, body: `<button class="btn block" data-act="scan" data-via="platform" data-query="line=huadong" data-fk="scan-platform">${esc(t.scanBtn)}：${esc(t.scanPlatT)}</button>` },
      { via: 'bare', title: t.scanBareT, desc: t.scanBareD, code: base, body: `<button class="btn block" data-act="scan" data-via="bare" data-query="" data-fk="scan-bare">${esc(t.scanBtn)}：${esc(t.scanBareT)}</button>` },
    ];
    return `<div class="wrap entry" data-screen="entry">
      <div class="entry-head">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <span class="eyebrow">${esc(t.entryEyebrow)}</span>${langToggle()}
        </div>
        <div class="plate" aria-hidden="true"><div class="pn">${state.lang === 'en' ? 'Ride Guide' : '乘車導覽'}</div><div class="ps">Rail Island</div>
          <div class="plate-foot"><span>◀ ${esc(t.entryPlateL)}</span><span>${esc(t.demoShort)} ▶</span></div></div>
        <h1 style="font-size:24px;line-height:1.35">${esc(t.entryTitle)}</h1>
        <p>${esc(t.entryLead)}</p>
        <span><span class="demo-badge">${esc(t.demoBadge)}</span></span>
      </div>
      ${noticeHtml()}
      <ul class="scan-list">
        ${scans.map((s) => `<li class="scan">
          <div class="qr" aria-hidden="true">${fakeQr(s.via)}<small>${esc(t.qrNote)}</small></div>
          <div style="min-width:0">
            <h3>${esc(s.title)}</h3>
            <p>${esc(s.desc)}</p>
            <code>${esc(s.code)}</code>
            ${s.body}
          </div></li>`).join('')}
      </ul>
      <p class="foot-note"><button class="btn ghost small" data-act="about" data-fk="about-entry">ⓘ ${esc(t.aboutBtn)}</button></p>
    </div>`;
  }

  function routeScreen() {
    const t = T();
    return `<div class="wrap entry" data-screen="route">
      <div class="back-row"><button class="btn small" data-act="back" data-fk="back">‹ ${esc(t.back)}</button><span style="flex:1"></span>${langToggle()}</div>
      ${noticeHtml()}
      <h2>${esc(t.routeTitle)}</h2>
      <p style="margin:0;color:var(--muted)">${esc(t.routeLead)}</p>
      <ul class="pick-list">${LINES.map((l) => {
        const guides = Object.keys(DATA.routes[l].stations).filter(hasGuide).map(stName).join(state.lang === 'en' ? ', ' : '・');
        return `<li><button class="pick" data-act="pick-line" data-line="${l}" data-fk="line-${l}">
          <b>${esc(L(C.lines[l].name))}</b><span class="meta">${esc(L(C.lines[l].desc))}</span><span class="meta">${esc(t.guidesAt(guides))}</span></button></li>`;
      }).join('')}</ul>
      <p class="foot-note"><span class="demo-badge">${esc(t.demoBadge)}</span></p>
    </div>`;
  }

  function trainScreen() {
    const t = T();
    const list = DATA.routes[state.line].trains.map((tr) => {
      const a = tr.stops[0], b = tr.stops[tr.stops.length - 1];
      return `<li><button class="pick" data-act="pick-train" data-train="${tr.no}" data-fk="train-${tr.no}">
        <span class="row"><span class="type-pill">${esc(state.lang === 'en' ? (t.typeName[tr.type] || tr.type) : tr.type)}</span><b class="num">${tr.no}</b><b>${esc(t.to(stName(b.id)))}</b><span class="demo-badge">${esc(t.demoShort)}</span></span>
        <span class="meta num">${esc(t.runs(stName(a.id), hhmm(a.dep), stName(b.id), hhmm(b.arr)))}</span>
        <span class="meta">${esc(t.stopsCount(tr.stops.length))}</span></button></li>`;
    }).join('');
    return `<div class="wrap entry" data-screen="train">
      <div class="back-row"><button class="btn small" data-act="back" data-fk="back">‹ ${esc(t.back)}</button><span style="flex:1"></span>${langToggle()}</div>
      ${noticeHtml()}
      <h2>${esc(t.trainTitle)}・${esc(lineName())}</h2>
      <p style="margin:0;color:var(--muted)">${esc(t.trainLead(fmtRange()))}</p>
      <ul class="pick-list">${list}</ul>
    </div>`;
  }

  function langToggle() {
    return `<div class="lang" role="group" aria-label="語言 Language">
      <button data-act="lang" data-lang="zh" data-fk="lang-zh" aria-pressed="${state.lang === 'zh'}" lang="zh-Hant">中文</button>
      <button data-act="lang" data-lang="en" data-fk="lang-en" aria-pressed="${state.lang === 'en'}" lang="en">EN</button></div>`;
  }

  // 示意 QR：固定圖樣，刻意不編碼任何網址（避免有人真的去掃）
  function fakeQr(seed) {
    let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const rnd = () => ((h = (h * 1103515245 + 12345) >>> 0) / 4294967296);
    const N = 21; let r = '';
    const finder = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7" fill="#1E2C40"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="#1E2C40"/>`;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const inF = (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
      if (!inF && rnd() > 0.52) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="#1E2C40"/>`;
    }
    return `<svg viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges">${r}${finder(0, 0)}${finder(14, 0)}${finder(0, 14)}</svg>`;
  }

  /* 旅程畫面骨架：各區塊由 paintJourney 個別重繪 */
  function journeyShell() {
    return `<div data-screen="journey">
      <header class="jbar" id="jbar"></header>
      <div class="layout">
        <div class="col-main" id="col-main">
          <div class="wrap journey" id="journey"></div>
          <div id="content-anchor"></div>
          <div class="tabs"><div class="wrap"><div class="seg" role="tablist" id="tabs"></div></div></div>
          <main class="content wrap" id="content" tabindex="-1"></main>
        </div>
        <aside class="mappanel" id="mappanel" aria-labelledby="mp-title"></aside>
      </div>
      <nav class="dock" id="dock" aria-label=""></nav>
    </div>`;
  }

  function paintJourney({ fade = false, keepFocus = null } = {}) {
    if (!app.querySelector('[data-screen="journey"]')) { render(); return; }
    const fk = keepFocus || (document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null);
    const chipsEl = document.querySelector('#dock .chips');
    const chipScroll = chipsEl ? chipsEl.scrollLeft : 0;
    const mpBody = document.querySelector('#mappanel .mp-body');
    const mpScroll = mpBody ? mpBody.scrollTop : 0;

    document.getElementById('jbar').innerHTML = barHtml();
    document.getElementById('journey').innerHTML = journeyCardHtml();
    document.getElementById('tabs').innerHTML = tabsHtml();
    const content = document.getElementById('content');
    content.innerHTML = (state.view === 'along' ? alongHtml() : guideHtml())
      + `<div class="view-foot"><button class="btn ghost small" data-act="about" data-fk="about-foot">ⓘ ${esc(T().aboutBtn)}</button></div>`;
    content.setAttribute('aria-labelledby', `tab-${state.view}`);
    content.setAttribute('role', 'tabpanel');
    if (fade && !mqReduce.matches) { content.classList.remove('fade-in'); void content.offsetWidth; content.classList.add('fade-in'); }

    const mp = document.getElementById('mappanel');
    const mapVisible = isDesk() || state.overlay === 'map' || (state.overlay === 'sheet' && state.under === 'map');
    mp.hidden = !mapVisible;
    mp.innerHTML = mapPanelHtml();
    const dock = document.getElementById('dock');
    dock.setAttribute('aria-label', T().dockLabel);
    dock.innerHTML = dockHtml();

    // 地圖覆蓋層開著時，背後的內容不可聚焦（底部目的站選擇器仍可用）
    const mobileMap = mapVisible && !isDesk();
    for (const id of ['jbar', 'col-main']) {
      const el = document.getElementById(id);
      if (mobileMap) el.setAttribute('inert', ''); else el.removeAttribute('inert');
    }

    const newChips = document.querySelector('#dock .chips');
    if (newChips) {
      newChips.scrollLeft = chipScroll;
      const sel = newChips.querySelector('[aria-pressed="true"]');
      if (sel) {
        const cr = newChips.getBoundingClientRect(), sr = sel.getBoundingClientRect();
        if (sr.left < cr.left || sr.right > cr.right) newChips.scrollLeft += sr.left - cr.left - 8;
      }
    }
    const newMp = document.querySelector('#mappanel .mp-body');
    if (newMp) newMp.scrollTop = mpScroll;
    restoreFocus(fk);
  }

  function barHtml() {
    const t = T();
    const tr = train();
    const nx = stops()[state.pos + 1];
    return `<div class="wrap">
      <div class="jbar-id">
        <span class="l1"><span>${esc(lineName())}</span><span class="demo-badge">${esc(t.demoShort)}</span></span>
        <span class="l2 num"><span class="trno">${tr.no} ${esc(dirText())}</span> · ${esc(t.next)} ${esc(stName(nx.id))}</span>
      </div>
      <button class="icon-btn map-open-btn" data-act="map-open" data-fk="map-open" aria-label="${esc(t.mapBtnLong)}" aria-expanded="${state.overlay === 'map'}">${icon('map')}<span>${esc(t.mapBtn)}</span></button>
      ${langToggle()}
    </div>`;
  }

  function journeyCardHtml() {
    const t = T();
    const s = stops();
    const cur = s[state.pos], nx = s[state.pos + 1];
    const strip = stripSvg();
    return `${noticeHtml()}
      <section class="jcard" aria-label="${esc(lineName())} ${train().no}">
        <div class="jcard-top">
          <div style="min-width:0">
            <p class="now">${esc(t.simPos)}・${esc(t.between(stName(cur.id), stName(nx.id)))}</p>
            <p class="next">${esc(t.next)} ${esc(stName(nx.id))}<span class="t num">${esc(t.arrAt(hhmm(nx.arr)))}</span></p>
          </div>
          <span class="demo-badge">${esc(t.demoShort)}</span>
        </div>
        ${isDesk() ? `<div class="strip" aria-hidden="true">${strip}</div>`
          : `<button class="strip" data-act="map-open" data-fk="strip" aria-label="${esc(t.mapBtnLong)}">${strip}</button>`}
        <p class="basis">${esc(t.basis(DATA.scheduleSnapshot))}</p>
        <p class="about-row"><button class="btn ghost small" data-act="about" data-fk="about-card">ⓘ ${esc(t.aboutTitle)}</button></p>
      </section>`;
  }

  // 簡化路線圖：等距站點，起訖站名、目的站紅圈、列車藍塊
  function stripSvg() {
    const s = stops();
    const n = s.length;
    const W = 340, pad = 22, gap = (W - pad * 2) / (n - 1), y = 28;
    const x = (i) => pad + i * gap;
    const di = state.dest ? idxOf(state.dest) : -1;
    const trainX = (x(state.pos) + x(state.pos + 1)) / 2;
    let g = `<line x1="${x(0)}" y1="${y}" x2="${trainX}" y2="${y}" stroke="var(--navy)" stroke-width="4" stroke-linecap="round" opacity=".35"/>`;
    g += `<line x1="${trainX}" y1="${y}" x2="${x(n - 1)}" y2="${y}" stroke="var(--navy)" stroke-width="4" stroke-linecap="round"/>`;
    s.forEach((st, i) => {
      const passed = i <= state.pos;
      if (i === di) g += `<circle cx="${x(i)}" cy="${y}" r="9" fill="none" stroke="var(--red)" stroke-width="2.5"/>`;
      g += `<circle cx="${x(i)}" cy="${y}" r="${i === 0 || i === n - 1 ? 5.5 : 4.5}" fill="${passed ? 'var(--navy)' : 'var(--paper)'}" stroke="var(--navy)" stroke-width="2"/>`;
      if (hasGuide(st.id)) g += `<circle cx="${x(i)}" cy="${y - 10}" r="2.2" fill="var(--red)"/>`;
    });
    g += `<rect x="${trainX - 11}" y="${y - 7}" width="22" height="14" rx="4" fill="var(--train)" stroke="var(--paper)" stroke-width="2"/>`;
    g += `<path d="M${trainX + (state.pos < n ? 3 : -3)} ${y - 3} l4 3 -4 3z" fill="#fff"/>`;
    const lab = (i, anchor, txt, color, dy) => `<text x="${x(i)}" y="${y + dy}" text-anchor="${anchor}" font-size="12" font-weight="800" fill="${color}" paint-order="stroke" stroke="var(--paper)" stroke-width="3">${esc(txt)}</text>`;
    g += lab(0, 'start', stName(s[0].id), 'var(--muted)', 24);
    g += lab(n - 1, 'end', stName(s[n - 1].id), 'var(--muted)', 24);
    if (di > 0) {
      const anchor = di === n - 1 ? 'end' : di <= 1 ? 'start' : 'middle';
      g += `<text x="${x(di)}" y="${y - 15}" text-anchor="${anchor}" font-size="12" font-weight="900" fill="var(--red)" paint-order="stroke" stroke="var(--paper)" stroke-width="3">★ ${esc(stName(s[di].id))}</text>`;
    }
    return `<svg viewBox="0 0 ${W} 58" role="img" aria-label="${esc(stName(s[0].id))} → ${esc(stName(s[n - 1].id))}">${g}</svg>`;
  }

  function tabsHtml() {
    const t = T();
    return ['guide', 'along'].map((v) => `<button role="tab" id="tab-${v}" aria-selected="${state.view === v}" aria-controls="content" data-act="view" data-view="${v}" data-fk="tab-${v}">${esc(v === 'guide' ? t.tabGuide : t.tabAlong)}</button>`).join('');
  }

  /* 底部目的站選擇器：只列這班車接下來會停的站 */
  function dockHtml() {
    const t = T();
    const s = stops();
    const items = [];
    const di = state.dest ? idxOf(state.dest) : -1;
    if (di >= 0 && di <= state.pos) items.push({ st: s[di], passed: true });
    s.forEach((st, i) => { if (i > state.pos) items.push({ st, passed: false }); });
    const chips = items.map(({ st, passed }) => {
      const i = idxOf(st.id);
      const last = i === s.length - 1;
      return `<button class="chip ${passed ? 'passed' : ''}" data-act="dest" data-id="${st.id}" data-fk="chip-${st.id}" aria-pressed="${state.dest === st.id}">
        <b>${esc(stName(st.id))}${hasGuide(st.id) ? `<i class="has" aria-label="${esc(t.hasGuide)}"></i>` : ''}</b>
        <small>${esc(passed ? t.tagPassed : last ? t.tagTerminal + ' ' + hhmm(st.arr) : hhmm(st.arr))}</small></button>`;
    }).join('');
    return `<div class="wrap"><div class="dock-label"><span>${esc(t.dockLabel)}</span><small><i class="has" aria-hidden="true"></i>${esc(t.hasGuide)}</small></div>
      <div class="chips" role="group" aria-label="${esc(t.dockLabel)}">${chips}<span class="chips-end"></span></div></div>`;
  }

  /* ───────── 目的站導覽 ─────────
   * 觀光網站式的閱讀順序：主視覺（站名牌＋一句話主題）→ 認識這裡 → 必看亮點 → 推薦路線 → 在地店家
   * → 文化故事 → 下一班車 → 怎麼抵達 → 實用資訊 → 來源。
   * 每一筆資料都標出處：來源連結＝已查證；OSM＝地圖資料（未逐一查證）；模擬＝示範假設值。 */
  function guideHtml() {
    const t = T();
    if (!state.dest) return chooseHtml();
    const id = state.dest;
    const s = C.stations[id];
    const passed = idxOf(id) <= state.pos;
    let h = '<div class="view">';
    if (!s) return h + plateBlock(id) + (passed ? passNote(id) : '') + noGuideHtml(id) + '</div>';

    h += heroHtml(id, s);
    if (s.notice) {
      h += `<section class="alert-card" id="sec-alert" role="note" aria-labelledby="h-alert"><h2 id="h-alert">${icon('alert')}${esc(L(s.notice.title))}</h2>
        <p>${esc(L(s.notice.text))}</p>${srcLine(s.notice.src, true)}</section>`;
    }
    if (passed) h += passNote(id);
    const shops = shopsFor(id);
    const routes = routesOf(s);
    const nexts = nextDepartures(id);
    const keys = [
      ['intro', 1], ['highlights', (s.highlights || []).length], ['routes', routes.length], ['shops', shops.length],
      ['stories', (s.stories || []).length], ['next', nexts.length], ['access', (s.access || []).length], ['practical', (s.practical || []).length],
    ].filter(([, n]) => n).map(([k]) => k);
    h += `<nav class="jump" aria-label="${esc(stName(id))}">${keys.map((k) => `<a href="#sec-${k}" data-act="jump" data-target="sec-${k}">${esc(t.sec[k])}</a>`).join('')}</nav>`;

    const sec = (key, inner, extra = '') => `<section class="card" id="sec-${key}" aria-labelledby="h-${key}">
      <div class="sec-h"><h2 id="h-${key}">${esc(t.sec[key])}</h2>${extra || (t.secEn[key] ? `<span class="en">${esc(t.secEn[key])}</span>` : '')}</div>${inner}</section>`;

    h += sec('intro', `<p class="lead">${esc(L(s.intro.text))}</p>${srcLine(s.intro.src)}`);
    if (keys.includes('highlights')) h += sec('highlights', highlightsHtml(id, s));
    if (keys.includes('routes')) h += sec('routes', routesHtml(id, routes));
    if (keys.includes('shops')) h += sec('shops', shopsHtml(id, shops), `<span class="prov osm">OSM</span>`);
    if (keys.includes('stories')) {
      h += sec('stories', `<div class="stories">${s.stories.map((st) => `<button class="story" data-act="story" data-kind="station-story" data-id="${id}:${st.id}" data-fk="story-${id}-${st.id}">
        <b>${esc(L(st.title))}</b><span>${esc(L(st.teaser))}</span><span class="more">${esc(t.readMore)}</span></button>`).join('')}</div>`);
    }
    if (keys.includes('next')) h += sec('next', departuresHtml(id, nexts));
    if (keys.includes('access')) {
      h += sec('access', `<dl class="rows">${s.access.map((r) => `<div><dt>${esc(L(r.label))}</dt><dd>${r.tbd ? `<div class="tbd-box">${esc(L(r.text))}</div>` : esc(L(r.text))}${r.prov === 'sim' ? ' ' + provChip('sim') : ''}${srcLine(r.src, true)}</dd></div>`).join('')}</dl>${linkRow(id)}`);
    }
    if (keys.includes('practical')) {
      h += sec('practical', `<dl class="rows">${s.practical.map((r) => `<div><dt>${esc(L(r.label))} <span class="checked">${esc(t.checked(r.checked || C.checkedOn))}</span></dt><dd>${r.tbd ? `<div class="tbd-box">${esc(L(r.text))}</div>` : esc(L(r.text))}${srcLine(r.src, true)}</dd></div>`).join('')}</dl>
        <p class="src">${esc(t.changeNote)}</p>`);
    }
    const all = stationSourceIds(s);
    h += `<section class="card" aria-labelledby="h-sources"><div class="sec-h"><h2 id="h-sources" style="font-size:16px">${esc(t.sec.sources)}</h2></div>
      <ul class="srclist" style="margin:0;padding-left:1.2em">${all.map((k) => `<li>${srcAnchor(k)}</li>`).join('')}
      ${shops.length ? `<li>${esc(t.osmAttr(PLACES.fetched))} <a class="ext" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">ODbL</a></li>` : ''}</ul>
      <p class="src">${esc(t.checked(C.checkedOn))}</p></section>`;
    return h + '</div>';
  }

  function passNote(id) {
    const t = T();
    return `<div class="pass-note" role="status"><b>${esc(t.passedTitle(stName(id)))}</b><span>${esc(t.passedLead(stName(id)))}</span>
      <span><button class="btn small" data-act="move-before" data-id="${id}" data-fk="move-before">${esc(t.passedBtn(stName(id)))}</button></span></div>`;
  }

  function plateHtml(id) {
    const t = T();
    const s = stops();
    const i = idxOf(id);
    const prev = s[i - 1], nxt = s[i + 1];
    const other = state.lang === 'en' ? (NAMES[id] && NAMES[id].zh) : (NAMES[id] && NAMES[id].en);
    return `<div class="plate" role="heading" aria-level="1" aria-label="${esc(stName(id))}">
        <div class="pn" aria-hidden="true">${esc(stName(id))}</div>
        <div class="ps" aria-hidden="true">${esc(other || '')}</div>
        <div class="plate-foot" aria-hidden="true"><span>${prev ? '◀ ' + esc(stName(prev.id)) : ''}</span><span class="dirmark">${esc(dirText())}</span><span>${nxt ? esc(stName(nxt.id)) + ' ▶' : esc(t.tagTerminal)}</span></div>
      </div>`;
  }

  // 沒有導覽內容的站：只放站名牌＋到站時間
  function plateBlock(id) {
    const t = T();
    const s = stops();
    const i = idxOf(id);
    const st = s[i];
    const last = i === s.length - 1;
    const left = Math.max(0, i - state.pos);
    return `<div class="dest-hero">${plateHtml(id)}
      <div class="dest-meta num"><span><b>${esc(last ? t.termArr(hhmm(st.arr)) : t.arrDep(hhmm(st.arr), hhmm(st.dep)))}</b>（${esc(t.byTimetable)}）</span>${left > 0 ? `<span>${esc(t.stopsLeft(left))}</span>` : ''}</div>
    </div>`;
  }

  function heroHtml(id, s) {
    const t = T();
    const p = s.hero && C.photos[s.hero];
    const i = idxOf(id);
    const st = stops()[i];
    const left = Math.max(0, i - state.pos);
    return `<section class="dhero" aria-label="${esc(stName(id))}">
      <div class="dhero-media">${p ? `<img src="${esc(p.file)}" alt="${esc(L(p.alt))}" decoding="async" width="1200" height="800">` : '<div class="dhero-fallback"></div>'}</div>
      <div class="dhero-body">
        ${plateHtml(id)}
        ${s.tagline ? `<p class="tagline">${esc(L(s.tagline))}</p>` : ''}
        ${s.themes ? `<div class="themes">${s.themes.map((th) => `<span class="theme">${icon(th.icon)}<span>${esc(L(th.label))}</span></span>`).join('')}</div>` : ''}
        <dl class="facts num">
          <div><dt>${esc(t.factArr)}</dt><dd>${hhmm(st.arr)}<small>${esc(t.byTimetable)}</small></dd></div>
          <div><dt>${esc(t.factLeft)}</dt><dd>${left > 0 ? esc(t.stopsShort(left)) : '—'}</dd></div>
          ${s.stay ? `<div><dt>${esc(t.factStay)}</dt><dd>${esc(L(s.stay))} ${provChip('sim')}</dd></div>` : ''}
        </dl>
        ${p ? `<p class="credit">${esc(L(p.caption))}・${esc(t.photo)}：${esc(p.author)}・<a href="${esc(p.licenseUrl)}" target="_blank" rel="noopener">${esc(p.license)}</a>・<a class="ext" href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">Wikimedia Commons</a></p>` : ''}
      </div>
    </section>
    <p class="prov-legend">${esc(t.legendLead)}<span><span class="srcmark">↗</span>${esc(t.legendSrc)}</span><span><span class="prov osm">OSM</span>${esc(t.legendOsm)}</span><span><span class="prov sim">${esc(t.provSim)}</span>${esc(t.legendSim)}</span></p>`;
  }

  function provChip(kind) {
    const t = T();
    if (kind === 'sim') return `<span class="prov sim" title="${esc(t.legendSim)}">${esc(t.provSim)}</span>`;
    if (kind === 'osm') return `<span class="prov osm" title="${esc(t.legendOsm)}">OSM</span>`;
    return '';
  }

  function fmtDist(m) {
    const t = T();
    return m < 1000 ? t.meters(Math.round(m / 10) * 10) : t.km((m / 1000).toFixed(1));
  }
  // 模擬估算：直線距離 × 1.3（繞路係數）÷ 速度。步行每分鐘 75 公尺，單車每分鐘 220 公尺。
  function estMin(m, mode) {
    const v = mode === 'bike' ? 220 : mode === 'bus' ? 350 : 75;
    const x = (m * 1.3) / v;
    return x < 10 ? Math.max(1, Math.ceil(x)) : Math.round(x / 5) * 5;
  }
  const stationLL = (id) => { const s = route().stations[id]; return [s.lat, s.lon]; };

  /* 必看亮點：橫向卡片，點開看詳情 */
  function highlightsHtml(id, s) {
    const t = T();
    const here = stationLL(id);
    return `<div class="hl-row">${s.highlights.map((hl) => {
      const p = hl.photo && C.photos[hl.photo];
      const d = haversineKm(here, [hl.lat, hl.lon]) * 1000;
      return `<button class="hl" data-act="story" data-kind="hl" data-id="${id}:${hl.id}" data-fk="hl-${id}-${hl.id}">
        <span class="hl-media">${p ? `<img src="${esc(p.file)}" alt="" loading="lazy" decoding="async">` : `<span class="hl-tile">${icon(hl.icon || 'pin')}</span>`}</span>
        <span class="hl-body"><b>${esc(L(hl.name))}</b><span class="hl-desc">${esc(L(hl.teaser || hl.desc))}</span>
        <span class="hl-meta num">${icon('pin')}${esc(t.fromStation(fmtDist(d)))}</span></span></button>`;
    }).join('')}</div><p class="src" style="margin-top:6px">${esc(t.hlNote)}</p>`;
  }

  /* 推薦路線：一站可有多條（步行／單車），分頁切換 */
  function routesOf(s) {
    if (s.routes) return s.routes;
    return s.walk ? [{ id: 'walk', mode: 'walk', ...s.walk }] : [];
  }
  function routesHtml(id, routes) {
    const t = T();
    const k = Math.min(state.routeTab || 0, routes.length - 1);
    const tabs = routes.length > 1 ? `<div class="rtabs" role="tablist">${routes.map((r, i) => `<button role="tab" aria-selected="${i === k}" data-act="route-tab" data-i="${i}" data-fk="rtab-${i}">${icon(r.mode)}<span>${esc(L(r.name))}</span></button>`).join('')}</div>` : '';
    return tabs + routeHtml(id, routes[k]);
  }
  function routeHtml(id, w) {
    const t = T();
    const mode = w.mode || 'walk';
    const stn = route().stations[id];
    const stnName = stName(id) + (state.lang === 'en' ? ' Station' : '車站');
    const pts = [{ station: true, lat: stn.lat, lon: stn.lon }, ...w.stops];
    if (w.loop) pts.push({ station: true, lat: stn.lat, lon: stn.lon });
    const ptName = (p) => (p.station ? stnName : L(p.name));
    const legs = w.legs || [];
    const spans = w.spans || [];
    const spanOf = (k) => spans.find((sp) => k >= sp.from && k < sp.to);
    // 合計：有來源的時間照用；沒有的用「模擬估算」補，並在合計標示含模擬
    let total = 0, anySim = false;
    const legInfo = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const sp = spanOf(k);
      const leg = legs[k] || {};
      const dist = haversineKm([pts[k].lat, pts[k].lon], [pts[k + 1].lat, pts[k + 1].lon]) * 1000;
      if (sp) { if (k === sp.from) total += sp.min; legInfo.push({ kind: k === sp.from ? 'span' : 'in-span', sp, dist, leg }); }
      else if (typeof leg.min === 'number') { total += leg.min; legInfo.push({ kind: 'src', min: leg.min, dist, leg }); }
      else { const m = estMin(dist, leg.mode || mode); total += m; anySim = true; legInfo.push({ kind: 'sim', min: m, dist, leg }); }
    }
    const modeLabel = t.mode[mode] || t.mode.walk;
    let h = `<p class="lead" style="margin-bottom:10px"><b>${esc(L(w.name))}</b>${w.summary ? (state.lang === 'en' ? ': ' : '：') + esc(L(w.summary)) : ''}</p>`;
    h += `<div class="walk-sum"><span>${icon(mode)} ${esc(modeLabel)}</span><span>${esc(t.totalAbout(total))}${anySim ? ' ' + provChip('sim') : ''}</span><span>${esc(t.walkPoints(w.stops.length))}</span>${w.loop ? `<span>${esc(t.walkLoop)}</span>` : ''}</div>`;
    if (w.photo) h += photoFigure(w.photo);
    h += `<div class="walk-map">${pointsMapSvg(id, w.stops.map((p) => ({ lat: p.lat, lon: p.lon })), { line: true, loop: w.loop, label: L(w.name) })}</div>
      <p class="walk-map-note">${esc(t.walkMapNote)}${w.coordSrc ? ` ${esc(t.source)}：${srcInline(w.coordSrc)}` : ''}</p>`;
    h += '<ol class="steps">';
    pts.forEach((p, k) => {
      if (p.station) {
        h += `<li class="step"><span class="stamp stn" aria-hidden="true">${esc(state.lang === 'en' ? 'Stn' : '站')}</span><div><b>${esc(stnName)}</b></div></li>`;
      } else {
        h += `<li class="step"><span class="stamp" aria-hidden="true">${k}</span><div><b>${esc(L(p.name))}</b>${p.desc ? `<p>${esc(L(p.desc))}</p>` : ''}</div></li>`;
      }
      if (k < pts.length - 1) {
        const li = legInfo[k];
        const legLabel = t.mode[li.leg.mode] || modeLabel; // 單段可換交通方式（例：公車兩段後步行）
        let time;
        if (li.kind === 'span') time = `${esc(t.spanMin(ptName(pts[li.sp.from]), ptName(pts[li.sp.to]), li.sp.min))}（${srcInline(li.sp.src)}）`;
        else if (li.kind === 'in-span') time = esc(t.spanIn);
        else if (li.kind === 'src') time = `${esc(t.legMode(legLabel, li.min))}${li.leg.src ? `（${srcInline(li.leg.src)}）` : ''}`;
        else time = `${esc(t.legMode(legLabel, li.min))} ${provChip('sim')}`;
        const note = li.leg.note ? ` · ${esc(L(li.leg.note))}${li.leg.src && li.kind !== 'src' ? `（${srcInline(li.leg.src)}）` : ''}` : '';
        h += `<li class="leg"><span class="rail" aria-hidden="true"></span><span class="lt">${time} · <span class="num">${esc(t.straight(Math.round(li.dist / 10) * 10))}</span>${note}</span></li>`;
      }
    });
    h += '</ol>';
    if (w.src) h += srcLine(w.src);
    return h;
  }

  /* 在地店家：OSM 真實店名與位置；缺的營業時間以模擬補上並標示。依距離排序，不是廣告。 */
  const CAT_ORDER = ['eat', 'drink', 'buy'];
  function shopsFor(id) {
    const rows = (PLACES.stations && PLACES.stations[id]) || [];
    const generic = /^(餐廳|小吃|小吃店|咖啡|早餐|飲料|商店|restaurant|cafe)$/i; // OSM 上只寫類別、沒有店名的點不列
    return rows.filter((r) => r.distM <= 1500 && !generic.test(r.name.trim()));
  }
  function simHours(r) {
    // 模擬值：依店型給一個常見時段（固定、可重現），畫面一律標「模擬」
    if (r.cuisine && /breakfast/.test(r.cuisine)) return '06:00–12:00';
    return { eat: '10:30–19:30', drink: '10:00–18:00', buy: '09:00–19:00' }[r.cat] || '10:00–18:00';
  }
  function fmtOsmHours(h) {
    if (state.lang === 'en') return h;
    const day = { Mo: '一', Tu: '二', We: '三', Th: '四', Fr: '五', Sa: '六', Su: '日' };
    return h.replace(/24\/7/g, '24 小時').replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, (d) => `週${day[d]}`).replace(/;\s*/g, '；').replace(/\s*-\s*/g, '–');
  }
  function shopsHtml(id, shops) {
    const t = T();
    const cat = state.shopCat || 'all';
    const counts = Object.fromEntries(CAT_ORDER.map((c) => [c, shops.filter((r) => r.cat === c).length]));
    const list = shops.filter((r) => cat === 'all' || r.cat === cat);
    const shown = state.shopAll ? list : list.slice(0, 6);
    const chips = [['all', shops.length], ...CAT_ORDER.map((c) => [c, counts[c]])].filter(([, n]) => n)
      .map(([c, n]) => `<button class="fchip" aria-pressed="${cat === c}" data-act="shop-cat" data-cat="${c}" data-fk="shopcat-${c}">${c === 'all' ? '' : icon(c)}${esc(t.cat[c])} <span class="num">${n}</span></button>`).join('');
    let h = `<p class="lead" style="font-size:14px;color:var(--muted);margin-bottom:10px">${esc(t.shopsLead(shops.length))}</p>`;
    h += `<div class="fchips" role="group" aria-label="${esc(t.sec.shops)}">${chips}</div>`;
    h += `<div class="walk-map">${pointsMapSvg(id, shown.map((r) => ({ lat: r.lat, lon: r.lon, cat: r.cat })), { line: false, label: t.sec.shops })}</div>`;
    h += `<ol class="shops">${shown.map((r, i) => `<li class="shop">
        <span class="shop-n cat-${r.cat}" aria-hidden="true">${i + 1}</span>
        <div class="shop-body">
          <b>${esc(r.name)}</b>${r.nameEn && state.lang === 'en' ? ` <span class="en">${esc(r.nameEn)}</span>` : ''}
          <span class="shop-kind">${icon(r.cat)}${esc(kindLabel(r))}</span>
          <span class="shop-meta num">${esc(fmtDist(r.distM))}・${esc(t.legMode(t.mode.walk, estMin(r.distM, 'walk')))} ${provChip('sim')}</span>
          <span class="shop-meta num">${esc(t.hours)}：${r.hours ? `${esc(fmtOsmHours(r.hours))} ${provChip('osm')}` : `${esc(simHours(r))} ${provChip('sim')}`}</span>
        </div>
        <a class="shop-osm ext" href="https://www.openstreetmap.org/${esc(r.osm)}" target="_blank" rel="noopener" aria-label="${esc(r.name)}：OpenStreetMap">OSM</a>
      </li>`).join('')}</ol>`;
    if (list.length > 6) h += `<p style="margin:10px 0 0"><button class="btn small" data-act="shop-all" data-fk="shop-all">${esc(state.shopAll ? t.showLess : t.showAll(list.length))}</button></p>`;
    const extra = C.stations[id] && C.stations[id].shopsNote;
    if (extra) h += `<div class="tbd-box" style="margin-top:10px">${esc(L(extra))}</div>`;
    h += `<p class="src">${esc(t.shopsNote(PLACES.fetched))}</p>`;
    return h;
  }
  function kindLabel(r) {
    const t = T();
    const k = t.kind[r.kind] || t.cat[r.cat];
    const c = r.cuisine && t.cuisine[r.cuisine.split(';')[0]];
    return c ? `${k}・${c}` : k;
  }

  /* 下一班車：示範日在這站開出的班次（真實時刻表），從示範列車到站時間起算 */
  function nextDepartures(id) {
    const list = (route().departures || {})[id] || [];
    const st = stops()[idxOf(id)];
    if (!st) return [];
    return list.filter((d) => d.dep >= st.arr && d.no !== state.train).slice(0, 6);
  }
  function departuresHtml(id, list) {
    const t = T();
    const color = { 區間車: '#2E6FB0', 區間快: '#16A085', 自強: '#C0392B', '莒光/復興': '#E8792B' };
    return `<p class="lead" style="font-size:14px;color:var(--muted);margin-bottom:8px">${esc(t.nextLead(hhmm(stops()[idxOf(id)].arr), DATA.demoDate))}</p>
      <table class="tt dep"><thead><tr><th>${esc(t.depTime)}</th><th>${esc(t.depTrain)}</th><th>${esc(t.depTo)}</th></tr></thead><tbody>
      ${list.map((d) => `<tr><td class="t">${hhmm(d.dep)}</td><td><span class="type-pill" style="background:${color[d.type] || '#8E44AD'}">${esc(state.lang === 'en' ? (t.typeName[d.type] || d.type) : d.type)}</span> <span class="num">${esc(d.no)}</span></td><td>${esc(t.to(L(d.to)))}</td></tr>`).join('')}
      </tbody></table>${srcLine(['tra-schedule'])}`;
  }

  function chooseHtml() {
    const t = T();
    const ahead = stops().filter((s, i) => i > state.pos && hasGuide(s.id));
    return `<div class="view"><div class="card empty">
      <h2>${esc(t.chooseTitle)}</h2>
      <p>${esc(t.chooseLead)}</p>
      ${ahead.length ? `<p style="font-weight:700;color:var(--ink)">${esc(t.chooseQuick)}</p>
      <div class="quick">${ahead.map((s) => `<button class="btn primary" data-act="dest" data-id="${s.id}" data-fk="quick-${s.id}">${esc(stName(s.id))} <span class="num" style="font-weight:600;opacity:.85">${hhmm(s.arr)}</span></button>`).join('')}</div>` : ''}
      <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" style="color:var(--faint)"><path d="M12 4v14m0 0l-6-6m6 6l6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div></div>`;
  }

  function noGuideHtml(id) {
    const t = T();
    const story = storyFor(id);
    const ahead = stops().filter((s, i) => i > state.pos && hasGuide(s.id) && s.id !== id);
    return `<div class="card empty" role="status">
      <h2>${esc(t.noContentTitle(stName(id)))}</h2>
      <p>${esc(t.noContentLead)}</p>
      ${story ? `<p>${esc(t.noContentAlong(stName(id)))}</p><button class="btn" data-act="story" data-kind="along" data-id="${esc(story.id)}" data-fk="nostory-${id}">${esc(t.readStory)}</button>` : ''}
      ${ahead.length ? `<p style="font-weight:700;color:var(--ink)">${esc(t.seeOthers)}</p><div class="quick">${ahead.map((s) => `<button class="btn primary" data-act="dest" data-id="${s.id}" data-fk="quick-${s.id}">${esc(stName(s.id))}</button>`).join('')}</div>` : ''}
    </div>`;
  }

  function haversineKm(a, b) {
    const r = (x) => (x * Math.PI) / 180;
    const dLat = r(b[0] - a[0]), dLon = r(b[1] - a[1]);
    const q = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371.0088 * Math.asin(Math.sqrt(q));
  }

  function linkRow(id) {
    const t = T();
    const r = C.stations[id] && C.stations[id].railisland;
    if (!r) return '';
    const url = (state.lang === 'en' && r.en) || r.zh; // 英文版車站頁沒有的站退回中文頁
    return `<p style="margin:14px 0 0"><a class="btn small ext" href="${url}" target="_blank" rel="noopener">${esc(t.timetableLink(stName(id)))}</a></p>`;
  }

  /* 沿途故事：依這班車停靠順序 */
  function alongHtml() {
    const t = T();
    const s = stops();
    const di = state.dest ? idxOf(state.dest) : -1;
    let h = `<div class="view"><p class="along-intro">${esc(t.alongIntro)}</p><ol class="tl">`;
    s.forEach((st, i) => {
      const passed = i <= state.pos;
      const isNext = i === state.pos + 1;
      const isDest = i === di;
      const after = di >= 0 && i > di;
      const cls = [passed ? 'passed' : '', isDest ? 'dest' : '', after ? 'after' : ''].join(' ');
      const tags = [];
      if (i === 0) tags.push(['passed', t.tagOrigin]);
      if (i === s.length - 1) tags.push(['after', t.tagTerminal]);
      if (passed && i !== 0) tags.push(['passed', t.tagPassed]);
      if (isNext) tags.push(['next', t.tagNext]);
      if (isDest) tags.push(['dest', '★ ' + t.tagDest]);
      if (after && !isDest) tags.push(['after', t.tagAfter]);
      const story = storyFor(st.id);
      const time = i === 0 ? t.depAt(hhmm(st.dep)) : t.arrAt(hhmm(st.arr));
      h += `<li class="${cls}"><span class="dot" aria-hidden="true"></span><div class="body">
        <div class="name"><b>${esc(stName(st.id))}</b><span class="t num">${esc(time)}</span>${tags.map(([c, x]) => `<span class="tag ${c}">${esc(x)}</span>`).join('')}</div>
        ${story ? `<button class="story" data-act="story" data-kind="along" data-id="${esc(story.id)}" data-fk="along-${esc(story.id)}"><b>${esc(L(story.title))}</b><span>${esc(L(story.teaser))}</span><span class="more">${esc(t.readMore)}</span></button>` : ''}
        ${isDest && hasGuide(st.id) ? `<button class="btn small" style="margin-top:8px" data-act="view" data-view="guide" data-fk="to-guide">${esc(t.toGuide)}</button>` : ''}
      </div></li>`;
      if (i === state.pos) h += `<li class="train-li"><span class="tchip" aria-hidden="true"></span><span class="tlabel">${esc(t.trainHere)}</span></li>`;
    });
    h += '</ol></div>';
    return h;
  }

  /* ───────── 地圖與進度 ───────── */
  function mapPanelHtml() {
    const t = T();
    const s = stops();
    const cur = s[state.pos], nx = s[state.pos + 1];
    const di = state.dest ? idxOf(state.dest) : -1;
    const rows = s.map((st, i) => {
      const passed = i <= state.pos, isNext = i === state.pos + 1, isDest = i === di;
      const time = i === 0 ? hhmm(st.dep) : i === s.length - 1 ? hhmm(st.arr) : st.arr === st.dep ? hhmm(st.arr) : `${hhmm(st.arr)}–${hhmm(st.dep)}`;
      const tags = [isNext ? `<span class="tag next">${esc(t.tagNext)}</span>` : '', isDest ? `<span class="tag dest">★ ${esc(t.tagDest)}</span>` : ''].join('');
      return `<tr class="${passed ? 'passed' : ''} ${isNext ? 'next' : ''} ${isDest ? 'dest' : ''}"><td>${esc(stName(st.id))}${tags}</td><td class="t">${time}</td></tr>`;
    }).join('');
    return `<div class="mp-head"><h2 id="mp-title">${esc(t.mapTitle)}</h2>
        <button class="btn small primary mp-close" data-act="map-close" data-fk="map-close">${esc(t.backToGuide)}</button></div>
      <div class="mp-body"><div class="mp-inner">
        <div class="routemap">${routeMapSvg()}<div class="map-attr">${esc(t.mapAttr)}</div></div>
        <div class="simctl" role="group" aria-label="${esc(t.simPos)}">
          <button class="icon-btn" data-act="step" data-dir="-1" data-fk="step-prev" aria-label="${esc(t.stepPrev)}" ${state.pos <= 0 ? 'disabled' : ''}>◀</button>
          <div class="st"><span class="demo-badge">${esc(t.simPos)}</span><b>${esc(t.between(stName(cur.id), stName(nx.id)))}</b><span class="num" style="color:var(--muted);font-size:13px">${esc(t.depAt(hhmm(cur.dep)))} → ${esc(t.arrAt(hhmm(nx.arr)))}</span></div>
          <button class="icon-btn" data-act="step" data-dir="1" data-fk="step-next" aria-label="${esc(t.stepNext)}" ${state.pos >= s.length - 2 ? 'disabled' : ''}>▶</button>
        </div>
        <table class="tt"><thead><tr><th>${esc(t.ttStation)}</th><th>${esc(t.ttTime)}</th></tr></thead><tbody>${rows}</tbody></table>
        <p class="src" style="margin:0">${esc(t.ttBasis(DATA.scheduleSnapshot, fmtRange()))}${srcAnchor('tra-schedule')}</p>
      </div></div>`;
  }

  // 路線里程累積（給列車位置內插用），每條路線算一次
  const GEO = {};
  function geo() {
    const line = state.line;
    if (!GEO[line]) {
      const path = DATA.routes[line].path;
      const cum = path.reduce((out, p, i) => { out.push(i ? out[i - 1] + haversineKm(path[i - 1], p) : 0); return out; }, []);
      GEO[line] = { path, cum };
    }
    return GEO[line];
  }
  function pointAtKm(km) {
    const { path, cum } = geo();
    if (cum[cum.length - 1] <= km) return path[path.length - 1];
    const i = Math.max(1, cum.findIndex((c) => c >= km));
    const tt = (km - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * tt, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * tt];
  }

  // 等距圓柱投影（台灣緯度、幾十公里內足夠）。寬度固定，高度隨資料，但不超過 maxH；放不滿的方向置中。
  function projector(points, W, padL, padR, padT, padB, maxH = 420, minH = 0) {
    const lats = points.map((p) => p[0]), lons = points.map((p) => p[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const spanX = Math.max((maxLon - minLon) * k, 0.002), spanY = Math.max(maxLat - minLat, 0.002);
    const S = Math.min((W - padL - padR) / spanX, (maxH - padT - padB) / spanY);
    const H = Math.max(minH, Math.round(spanY * S + padT + padB));
    const ox = padL + ((W - padL - padR) - ((maxLon - minLon) * k) * S) / 2;
    const oy = padT + ((H - padT - padB) - (maxLat - minLat) * S) / 2;
    const pxPerKm = S / 111.32; // 每度約 111.32 公里
    return { H, pxPerKm, xy: ([la, lo]) => [+(ox + (lo - minLon) * k * S).toFixed(1), +(oy + (maxLat - la) * S).toFixed(1)] };
  }

  // 平溪線站多且末段擠：依實際地理手調標籤位置。其他路線只標重點站（起訖、下一站、目的站、有導覽的站）。
  const LABEL = {
    pingxi: {
      badouzi: [10, 4, 'start'], haikeguan: [-10, 4, 'end'], ruifang: [-11, 5, 'end'], houtong: [10, 5, 'start'],
      sandiaoling: [10, 8, 'start'], dahua: [0, 22, 'middle'], shifen: [0, -12, 'middle'], wanggu: [0, 22, 'middle'],
      lingjiao: [0, -12, 'middle'], pingxi: [2, 22, 'middle'], jingtong: [-2, -12, 'middle'],
    },
  };

  function routeMapSvg() {
    const t = T();
    const W = 360;
    const { path, cum } = geo();
    const P = projector(path, W, 46, 96, 26, 40, state.line === 'pingxi' ? 420 : 520);
    const s = stops();
    const st = route().stations;
    const di = state.dest ? idxOf(state.dest) : -1;
    const cur = st[s[state.pos].id], nx = st[s[state.pos + 1].id];
    const trainKm = (cur.km + nx.km) / 2;
    const aKm = st[s[0].id].km;
    const lo = Math.min(aKm, trainKm), hi = Math.max(aKm, trainKm);
    const seg = [pointAtKm(lo), ...path.filter((_, i) => cum[i] > lo && cum[i] < hi), pointAtKm(hi)];
    const poly = (pts) => pts.map((p) => P.xy(p).join(',')).join(' ');
    const manual = LABEL[state.line];
    const keyStops = new Set([s[0].id, s[s.length - 1].id, s[state.pos + 1].id, state.dest].filter(Boolean));
    s.forEach((x) => { if (hasGuide(x.id)) keyStops.add(x.id); });
    let g = `<rect x="0" y="0" width="${W}" height="${P.H}" fill="var(--paper)"/>`;
    g += `<polyline points="${poly(path)}" fill="none" stroke="var(--navy)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
    g += `<polyline points="${poly(seg)}" fill="none" stroke="var(--line)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
    s.forEach((x, i) => {
      const [px, py] = P.xy([st[x.id].lat, st[x.id].lon]);
      const passed = i <= state.pos;
      if (i === di) g += `<circle cx="${px}" cy="${py}" r="11" fill="none" stroke="var(--red)" stroke-width="3"/>`;
      g += `<circle cx="${px}" cy="${py}" r="${keyStops.has(x.id) ? 5.5 : 4}" fill="${passed ? 'var(--line)' : 'var(--paper)'}" stroke="var(--navy)" stroke-width="2.5"><title>${esc(stName(x.id))}</title></circle>`;
    });
    // 列車畫在站名下層：站名有底色描邊，壓在列車上仍讀得到
    const [tx, ty] = P.xy(pointAtKm(trainKm));
    g += `<g aria-label="${esc(t.trainHere)}"><rect x="${tx - 17}" y="${ty - 9}" width="34" height="18" rx="5" fill="var(--train)" stroke="var(--paper)" stroke-width="2"/><text x="${tx}" y="${ty + 4}" text-anchor="middle" font-size="10.5" font-weight="900" fill="#fff">${train().no}</text></g>`;
    s.forEach((x, i) => {
      if (!manual && !keyStops.has(x.id)) return;
      const [px, py] = P.xy([st[x.id].lat, st[x.id].lon]);
      const passed = i <= state.pos;
      const [dx, dy, anchor] = (manual && manual[x.id]) || (px > W * 0.62 ? [-11, 4, 'end'] : [11, 4, 'start']);
      const isD = i === di;
      g += `<text x="${px + dx}" y="${py + dy}" text-anchor="${anchor}" font-size="${isD ? 13 : 12}" font-weight="${isD ? 900 : 700}" fill="${isD ? 'var(--red)' : passed ? 'var(--faint)' : 'var(--ink-strong)'}" paint-order="stroke" stroke="var(--paper)" stroke-width="3.5" stroke-linejoin="round">${isD ? '★ ' : ''}${esc(stName(x.id))}</text>`;
    });
    // 比例尺與指北
    const scaleKm = route().lengthKm > 40 ? 10 : 2;
    const len = scaleKm * P.pxPerKm;
    g += `<g transform="translate(${(W - 60 - len).toFixed(1)} ${P.H - 16})"><rect x="0" y="0" width="${len.toFixed(1)}" height="4" fill="var(--ink-strong)"/><text x="${(len + 6).toFixed(1)}" y="5" font-size="11" fill="var(--muted)">${esc(t.scale(scaleKm))}</text></g>`;
    g += `<g transform="translate(${W - 22} 24)"><path d="M0 -12 L6 4 L0 0 L-6 4Z" fill="var(--ink-strong)"/><text x="0" y="17" text-anchor="middle" font-size="10" font-weight="800" fill="var(--muted)">${esc(t.north)}</text></g>`;
    return `<svg viewBox="0 0 ${W} ${P.H}" role="img" aria-label="${esc(t.mapTitle)}">${g}</svg>`;
  }

  // 站周邊示意圖：真實座標點。路線用紅色虛線連起來；店家只放編號點（顏色依類別）。
  function pointsMapSvg(id, pts, { line = true, loop = false, label = '' } = {}) {
    const t = T();
    const stn = route().stations[id];
    const all = [[stn.lat, stn.lon], ...pts.map((p) => [p.lat, p.lon])];
    const W = 340;
    const P = projector(all, W, 34, 34, 30, 34, 280, 170);
    const H = P.H;
    const xy = P.xy;
    let g = `<rect x="0" y="0" width="${W}" height="${H}" fill="var(--bg-stage)"/>`;
    g += `<polyline points="${geo().path.map((p) => xy(p).join(',')).join(' ')}" fill="none" stroke="var(--navy)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/>`;
    if (line && pts.length) {
      const seq = [[stn.lat, stn.lon], ...pts.map((p) => [p.lat, p.lon])];
      if (loop) seq.push([stn.lat, stn.lon]);
      g += `<polyline points="${seq.map((p) => xy(p).join(',')).join(' ')}" fill="none" stroke="var(--red)" stroke-width="2.5" stroke-dasharray="2 6" stroke-linecap="round"/>`;
    }
    const [sx, sy] = xy([stn.lat, stn.lon]);
    g += `<rect x="${sx - 13}" y="${sy - 11}" width="26" height="22" rx="5" fill="var(--navy)"/><text x="${sx}" y="${sy + 4.5}" text-anchor="middle" font-size="${state.lang === 'en' ? 9.5 : 12}" font-weight="900" fill="var(--on-navy)">${state.lang === 'en' ? 'Stn' : '站'}</text>`;
    const catColor = { eat: 'var(--red)', drink: 'var(--ok)', buy: 'var(--gold)' };
    pts.forEach((p, k) => {
      const [x, y] = xy([p.lat, p.lon]);
      const c = p.cat ? catColor[p.cat] : 'var(--red)';
      g += `<circle cx="${x}" cy="${y}" r="11" fill="var(--paper)" stroke="${c}" stroke-width="2.5"/><text x="${x}" y="${y + 4.5}" text-anchor="middle" font-size="12" font-weight="900" fill="${c}">${k + 1}</text>`;
    });
    const m = [100, 200, 500, 1000].find((v) => (v / 1000) * P.pxPerKm >= 40) || 1000;
    const len = (m / 1000) * P.pxPerKm;
    g += `<g transform="translate(12 ${H - 14})"><rect x="0" y="0" width="${len.toFixed(1)}" height="3.5" fill="var(--ink-strong)"/><text x="${(len + 6).toFixed(1)}" y="5" font-size="11" fill="var(--muted)">${esc(m >= 1000 ? t.scale(m / 1000) : t.scaleM(m))}</text></g>`;
    g += `<g transform="translate(${W - 18} 20)"><path d="M0 -10 L5 3 L0 0 L-5 3Z" fill="var(--ink-strong)"/><text x="0" y="14" text-anchor="middle" font-size="9" font-weight="800" fill="var(--muted)">${esc(t.north)}</text></g>`;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${g}</svg>`;
  }

  /* ───────── 來源、照片 ───────── */
  function srcAnchor(k) {
    const s = C.sources[k];
    if (!s) return esc(k);
    return `<a class="ext" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(L(s.name))}</a>`;
  }
  function srcInline(ids) { return (ids || []).map(srcAnchor).join('、'); }
  function srcLine(ids, compact) {
    if (!ids || !ids.length) return '';
    return `<p class="src"${compact ? ' style="margin-top:4px"' : ''}><span>${esc(T().source)}：</span>${ids.map(srcAnchor).join('')}</p>`;
  }
  function stationSourceIds(s) {
    const set = new Set();
    const add = (a) => (a || []).forEach((k) => set.add(k));
    add(s.intro.src);
    (s.highlights || []).forEach((x) => { add(x.src); if (x.hours) add(x.hours.src); });
    (s.stories || []).forEach((x) => add(x.src));
    routesOf(s).forEach((w) => { add(w.src); add(w.coordSrc); (w.stops || []).forEach((x) => add(x.src)); (w.legs || []).forEach((x) => add(x.src)); (w.spans || []).forEach((x) => add(x.src)); });
    (s.access || []).forEach((x) => add(x.src));
    (s.practical || []).forEach((x) => add(x.src));
    return [...set];
  }
  function photoFigure(key) {
    const t = T();
    const p = key && C.photos[key];
    if (!p) return `<div class="photo-missing">${esc(t.photoMissing)}</div>`;
    return `<figure class="photo"><img src="${esc(p.file)}" alt="${esc(L(p.alt))}" loading="lazy" decoding="async" width="1200" height="800">
      <figcaption>${esc(L(p.caption))}・${esc(t.photo)}：${esc(p.author)}・<a href="${esc(p.licenseUrl)}" target="_blank" rel="noopener">${esc(p.license)}</a>・<a class="ext" href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">Wikimedia Commons</a>${p.modified ? `・${esc(L(p.modified))}` : ''}</figcaption></figure>`;
  }

  /* ───────── 閱讀面板 ───────── */
  function renderSheet() {
    const open = state.overlay === 'sheet' && state.sheet;
    const prevOpen = !!sheetRoot.firstChild;
    if (!open) {
      sheetRoot.innerHTML = '';
      app.removeAttribute('inert');
      if (prevOpen && lastFocusKey) { restoreFocus(lastFocusKey); lastFocusKey = null; }
      return;
    }
    const t = T();
    const { kind, id } = state.sheet;
    let k = '', body = '';
    if (kind === 'about') {
      k = t.demoBadge;
      body = aboutHtml();
    } else if (kind === 'hl') {
      const [sid, hid] = String(id).split(':');
      const hl = C.stations[sid] && (C.stations[sid].highlights || []).find((x) => x.id === hid);
      if (!hl) { k = t.close; body = `<p>${esc(t.tbd)}</p>`; }
      else { k = t.hlOf(stName(sid)); body = hlBody(sid, hl); }
    } else if (kind === 'along') {
      const a = C.along.find((x) => x.id === id);
      if (!a) { k = t.close; body = `<p>${esc(t.tbd)}</p>`; }
      else { k = t.storyAt(stName(a.station)); body = storyBody(a); }
    } else {
      const [sid, stid] = String(id).split(':');
      const st = C.stations[sid] && C.stations[sid].stories.find((x) => x.id === stid);
      if (!st) { k = t.close; body = `<p>${esc(t.tbd)}</p>`; }
      else { k = t.storyOf(stName(sid)); body = storyBody(st); }
    }
    const was = sheetRoot.querySelector('.sheet-body');
    const keepScroll = was && was.dataset.key === `${kind}:${id}` ? was.scrollTop : 0;
    sheetRoot.innerHTML = `<div class="sheet-wrap"><button class="sheet-scrim" data-act="sheet-close" tabindex="-1" aria-label="${esc(t.close)}"></button>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div class="sheet-head"><span class="k">${esc(k)}</span><button class="btn small" data-act="sheet-close" data-fk="sheet-close">${esc(t.close)}</button></div>
        <div class="sheet-body" data-key="${esc(kind + ':' + id)}">${body}</div></div></div>`;
    sheetRoot.querySelector('.sheet-body').scrollTop = keepScroll;
    app.setAttribute('inert', '');
    if (!prevOpen && !state.tour) sheetRoot.querySelector('[data-fk="sheet-close"]').focus({ preventScroll: true });
  }

  function storyBody(st) {
    const t = T();
    const paras = L(st.body);
    return `<h2 id="sheet-title">${esc(L(st.title))}</h2>${st.photo ? photoFigure(st.photo) : ''}
      ${(Array.isArray(paras) ? paras : [paras]).map((p) => `<p>${esc(p)}</p>`).join('')}
      <h3>${esc(t.sourcesH)}</h3><ul class="srclist">${(st.src || []).map((s) => `<li>${srcAnchor(s)}</li>`).join('')}</ul>
      <p class="src">${esc(t.checked(C.checkedOn))}</p>`;
  }

  function hlBody(sid, hl) {
    const t = T();
    const st = DATA.routes[TRAINS[state.train].line].stations[sid];
    const d = haversineKm([st.lat, st.lon], [hl.lat, hl.lon]) * 1000;
    const paras = L(hl.desc);
    return `<h2 id="sheet-title">${esc(L(hl.name))}</h2>${hl.photo ? photoFigure(hl.photo) : ''}
      ${(Array.isArray(paras) ? paras : [paras]).map((p) => `<p>${esc(p)}</p>`).join('')}
      <dl class="rows" style="margin-bottom:12px">
        <div><dt>${esc(t.fromStationH)}</dt><dd class="num">${esc(fmtDist(d))}${hl.travel ? `・${esc(L(hl.travel.text))}${hl.travel.src ? `（${srcInline(hl.travel.src)}）` : ` ${provChip('sim')}`}` : `・${esc(t.legMode(t.mode.walk, estMin(d, 'walk')))} ${provChip('sim')}`}</dd></div>
        ${hl.hours ? `<div><dt>${esc(t.hours)} <span class="checked">${esc(t.checked(C.checkedOn))}</span></dt><dd>${esc(L(hl.hours.text))}${hl.hours.src ? srcLine(hl.hours.src, true) : ' ' + provChip('sim')}</dd></div>` : ''}
      </dl>
      <h3>${esc(t.sourcesH)}</h3><ul class="srclist">${(hl.src || []).map((x) => `<li>${srcAnchor(x)}</li>`).join('')}</ul>`;
  }

  function aboutHtml() {
    const t = T();
    const a = C.about;
    return `<h2 id="sheet-title">${esc(t.aboutTitle)}</h2>
      ${a.sections.map((s) => `<h3>${esc(L(s.title))}</h3><ul>${L(s.items).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}
      <p style="margin-top:16px"><button class="btn" data-act="restart" data-fk="restart">${esc(t.restart)}</button></p>`;
  }

  // 單色線條圖示，吃 currentColor；亮暗主題都跟著字色走
  const ICONS = {
    map: '<path d="M9 4L3 6.5v13L9 17l6 3 6-2.5v-13L15 7 9 4z M9 4v13 M15 7v13"/>',
    pin: '<path d="M12 21s-6-5.6-6-11a6 6 0 1 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
    alert: '<path d="M12 3.5L2.5 20h19L12 3.5z M12 10v4.5 M12 17.2v.3"/>',
    walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2-6-2.5-3 1-5 3 3 3 1 M12 15l3 6 M9.5 7.5L6.5 11"/>',
    bike: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7 M10 9l3 7h-1 M14 6h3"/>',
    bus: '<rect x="5" y="3.5" width="14" height="14" rx="2.5"/><path d="M5 11h14 M8 20.5v-3 M16 20.5v-3"/><circle cx="8.5" cy="14.5" r=".8"/><circle cx="15.5" cy="14.5" r=".8"/>',
    eat: '<path d="M7 3v8 M5 3v4a2 2 0 0 0 4 0V3 M7 11v10 M16 3c-2 1.5-2.5 4-2.5 7H17V21 M17 3v7"/>',
    drink: '<path d="M6 8h11v5a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5V8z M17 9h1.5a2.5 2.5 0 0 1 0 5H17 M9 3.5c0 1.5 1 1.5 1 3 M13 3.5c0 1.5 1 1.5 1 3 M5 21h13"/>',
    buy: '<path d="M5 8h14l-1 12H6L5 8z M9 8V6a3 3 0 0 1 6 0v2"/>',
    train: '<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12 M9 20l-2 1.5 M15 20l2 1.5 M8.5 16l-1.5 4h10l-1.5-4"/><circle cx="9.5" cy="13" r=".8"/><circle cx="14.5" cy="13" r=".8"/>',
    leaf: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z M5 19l7-7"/>',
    wave: '<path d="M3 10c2-2 4-2 6 0s4 2 6 0 4-2 6 0 M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',
    torii: '<path d="M3 6c6 1 12 1 18 0 M5 9.5h14 M7 6.5V21 M17 6.5V21"/>',
    factory: '<path d="M3 21V11l5 3V11l5 3V5h4l1 9h3v7H3z M7 18h2 M12 18h2"/>',
    lantern: '<path d="M8 6h8l1.5 9a3 3 0 0 1-3 3.5h-5a3 3 0 0 1-3-3.5L8 6z M10 3h4 M12 18.5V21"/>',
    people: '<circle cx="8" cy="7" r="2.5"/><circle cx="16.5" cy="8" r="2"/><path d="M3.5 19c.5-4 2.5-6 4.5-6s4 2 4.5 6 M13 18.5c.4-3 1.8-4.5 3.5-4.5s3 1.5 3.5 4.5"/>',
    mountain: '<path d="M2.5 19l6.5-11 4 6 2.5-3.5L21.5 19z"/>',
    water: '<path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z"/>',
    bridge: '<path d="M2 15h20 M4 15V9 M20 15V9 M4 9c4 4 12 4 16 0 M8 15v-3 M12 15v-2.5 M16 15v-3"/>',
    salt: '<path d="M12 3l7 4v8l-7 4-7-4V7l7-4z M5 7l7 4 7-4 M12 11v8"/>',
    shrine: '<path d="M3 10l9-6 9 6 M5 10v10h14V10 M10 20v-5h4v5"/>',
  };
  function icon(name) {
    const p = ICONS[name];
    return p ? `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>` : '';
  }

  /* ───────── 簡報導覽：present.html 以 postMessage 送來畫面狀態 ─────────
   * 每一幕都是「完整的目標狀態」而不是「上一步之後再做什麼」，所以可以任意跳前跳後，不會累積誤差。 */
  function applyScene(sc) {
    state.tour = true;
    document.querySelectorAll('.tour-focus').forEach((el) => el.classList.remove('tour-focus'));
    state.lang = sc.lang === 'en' ? 'en' : 'zh';
    if (sc.screen === 'entry' || !sc.line) {
      state.notice = null; state.train = null; state.dest = null; state.view = 'guide';
      go({ screen: 'entry', line: null, train: null, overlay: null, sheet: null }, { replace: true });
    } else {
      state.train = sc.train;
      resetTrainState();
      state.dest = sc.dest || null;
      state.view = sc.view || 'guide';
      state.routeTab = sc.routeTab || 0; state.shopCat = 'all'; state.shopAll = false;
      state.notice = sc.via === 'car' ? { kind: 'info', text: (t) => t.fromCar(lineName(), sc.train, dirText()) } : null;
      // 先回到乾淨的旅程頁再套覆蓋層，避免上一幕的故事面板殘留
      go({ screen: 'journey', line: sc.line, train: sc.train, overlay: null, sheet: null }, { replace: true });
      paintJourney({});
      if (sc.overlay === 'map') go({ overlay: 'map' }, { replace: true });
    }
    const smooth = mqReduce.matches ? 'auto' : 'smooth';
    requestAnimationFrame(() => {
      if (sc.scroll === 'content') {
        const a = document.getElementById('content-anchor');
        const bar = document.querySelector('.jbar');
        if (a) window.scrollTo({ top: a.getBoundingClientRect().top + window.scrollY - (bar ? bar.getBoundingClientRect().height : 0), behavior: smooth });
      } else if (sc.scroll) {
        const el = document.getElementById(sc.scroll);
        if (el) el.scrollIntoView({ behavior: smooth, block: 'start' });
      } else {
        window.scrollTo({ top: 0, behavior: smooth });
      }
      // 故事面板在捲動到位後才開，畫面上看得出是從哪張卡片點開的
      if (sc.sheet) setTimeout(() => go({ overlay: 'sheet', sheet: sc.sheet }, { replace: true }), 650);
      if (sc.focus) setTimeout(() => { const el = document.querySelector(sc.focus); if (el) el.classList.add('tour-focus'); }, 450);
    });
  }
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.rideTour !== 1 || !m.scene) return;
    applyScene(m.scene);
  });
  window.RideGuide = { applyScene };

  /* ───────── 開機 ───────── */
  const params = parseLocation();
  if (params.tour) state.tour = true;
  enter(params, { via: 'url', push: false });
})();
