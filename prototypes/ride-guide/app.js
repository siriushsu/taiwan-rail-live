/* 軌島「乘車導覽模式」互動展示原型。
 * 不連任何即時 API：班次與停靠站來自 data/route-pingxi.js（臺鐵開放資料時刻表快照），
 * 列車位置是依時刻表手動推進的「示範位置」，地方內容來自 data/content.js（每則附來源）。
 * 狀態分兩種：
 *   導航狀態（畫面／路線／班次／覆蓋層）走 history，返回鍵可以一層層退；
 *   旅程狀態（目的站／語言／分頁／示範位置）不進 history——返回關掉地圖或故事時，選擇不會被倒回去。 */
(function () {
  'use strict';

  const ROUTE = window.RIDE_ROUTE;
  const C = window.RIDE_CONTENT;
  const app = document.getElementById('app');
  const sheetRoot = document.createElement('div');
  document.body.appendChild(sheetRoot);

  const LINE = 'pingxi';
  const TRAINS = Object.fromEntries(ROUTE.trains.map((t) => [t.no, t]));
  // 示範情境：車廂 QR 通常在剛上車時被掃到——往菁桐的車剛離開瑞芳（台北來的旅客在這裡轉乘），回程剛離開菁桐。
  const START = { 4816: 'ruifang', 4827: 'jingtong' };
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
      scanCarT: '車廂 QR', scanCarD: '帶路線與班次，直接進入這趟旅程。',
      scanPlatT: '月台 QR', scanPlatD: '只帶路線，進入後選班次。',
      scanBareT: '一般連結', scanBareD: '沒有帶資訊，進入後選路線與班次。',
      scanBtn: '模擬掃描',
      qrNote: '示意，不可掃',
      aboutBtn: '關於這個展示：哪些是示範資料',
      routeTitle: '選擇路線', routeLead: '第一版只做一條示範路線。',
      routeName: '平溪線', routeDesc: '八斗子—瑞芳—三貂嶺—菁桐直通車（行經深澳線、宜蘭線、平溪線）',
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
      sec: { intro: '認識這裡', stories: '歷史與文化', walk: '下車怎麼逛', access: '怎麼抵達', practical: '實用資訊', sources: '本站資料來源' },
      secEn: { intro: 'About', stories: 'History & culture', walk: 'Walk', access: 'Getting there', practical: 'Good to know', sources: 'Sources' },
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
    },
    en: {
      htmlLang: 'en',
      title: 'Rail Island Ride Guide',
      demoBadge: 'Interactive demo · sample train',
      demoShort: 'Demo',
      entryEyebrow: 'RAIL ISLAND · RIDE GUIDE MODE',
      entryTitle: 'Scan the QR code on board and read about where this train is taking you',
      entryLead: 'An interactive demo for rail operators, tourism bodies and local content partners. After scanning, riders see an introduction, history, a short walk and onward transport for the stop they choose on this train. The three QR codes below simulate different ways in.',
      scanCarT: 'In-car QR', scanCarD: 'Carries the line and the train. Opens this journey directly.',
      scanPlatT: 'Platform QR', scanPlatD: 'Carries the line only. Pick a train next.',
      scanBareT: 'Plain link', scanBareD: 'Carries nothing. Pick a line and a train.',
      scanBtn: 'Simulate scan',
      qrNote: 'Mock-up, not scannable',
      aboutBtn: 'About this demo: what is sample data',
      routeTitle: 'Choose a line', routeLead: 'This first version covers one demo line.',
      routeName: 'Pingxi Line', routeDesc: 'Through trains Badouzi – Ruifang – Sandiaoling – Jingtong (Shen’ao, Yilan and Pingxi lines)',
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
      sec: { intro: 'About this place', stories: 'History & culture', walk: 'A short walk', access: 'Getting there', practical: 'Good to know', sources: 'Sources for this stop' },
      secEn: { intro: '', stories: '', walk: '', access: '', practical: '', sources: '' },
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
    },
  };

  /* ───────── 狀態 ───────── */
  const state = {
    screen: 'entry', line: null, train: null, overlay: null, sheet: null,
    dest: null, lang: 'zh', view: 'guide', pos: 0,
    notice: null,           // 一次性提示 {kind:'info'|'warn', text: fn(lang)}
    entryVia: null,         // 'car' | 'platform' | 'bare' | 'url'
    under: null,            // 故事面板開在地圖上時記住底下是地圖
  };
  let busyUntil = 0;
  let lastFocusKey = null;

  const T = () => UI[state.lang];
  const L = (o) => (o == null ? '' : typeof o === 'string' ? o : (o[state.lang] ?? o.zh ?? ''));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hhmm = (sec) => { const s = ((sec % 86400) + 86400) % 86400; return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`; };
  const stName = (id) => L(C.stationNames[id]) || id;
  const train = () => TRAINS[state.train];
  const stops = () => train().stops;
  const idxOf = (id) => stops().findIndex((s) => s.id === id);
  const terminal = () => stops()[stops().length - 1];
  const dirText = () => T().to(stName(terminal().id));
  const lineName = () => L(C.lines[LINE].name);
  const fmtRange = () => {
    const [a, b] = ROUTE.scheduleRange;
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
    for (const k of ['line', 'train', 'dest', 'lang', 'view']) if (q.get(k)) out[k] = q.get(k).trim();
    // Artifact 預覽只帶得進 #純字元錨點：#pingxi-4816-shifen-en 這種逐段比對
    const h = location.hash.replace(/^#/, '');
    if (h && /^[A-Za-z0-9._~-]+$/.test(h)) {
      for (const tok of h.split(/[-.~_]/)) {
        const k = tok.toLowerCase();
        if (C.lines[k]) out.line = k;
        else if (/^\d{3,5}$/.test(k)) out.train = k;
        else if (C.stationNames[k]) out.dest = k;
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
    const fn = replace ? 'replaceState' : 'pushState';
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
    } else if (!TRAINS[params.train]) {
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
    const scans = [
      { via: 'car', q: `line=${LINE}&train=4816`, title: t.scanCarT, desc: t.scanCarD, primary: true },
      { via: 'platform', q: `line=${LINE}`, title: t.scanPlatT, desc: t.scanPlatD },
      { via: 'bare', q: '', title: t.scanBareT, desc: t.scanBareD },
    ];
    return `<div class="wrap entry" data-screen="entry">
      <div class="entry-head">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <span class="eyebrow">${esc(t.entryEyebrow)}</span>${langToggle()}
        </div>
        <div class="plate" aria-hidden="true"><div class="pn">${state.lang === 'en' ? 'Ride Guide' : '乘車導覽'}</div><div class="ps">Rail Island</div>
          <div class="plate-foot"><span>◀ ${esc(L(C.lines[LINE].name))}</span><span>${esc(t.demoShort)} ▶</span></div></div>
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
            <code>${esc(base)}${s.q ? '?' + esc(s.q) : ''}</code>
            <button class="btn ${s.primary ? 'primary' : ''} block" data-act="scan" data-via="${s.via}" data-query="${esc(s.q)}" data-fk="scan-${s.via}">${esc(t.scanBtn)}：${esc(s.title)}</button>
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
      <ul class="pick-list"><li><button class="pick" data-act="pick-line" data-line="${LINE}" data-fk="line-${LINE}">
        <b>${esc(t.routeName)}</b><span class="meta">${esc(t.routeDesc)}</span></button></li></ul>
      <p class="foot-note"><span class="demo-badge">${esc(t.demoBadge)}</span></p>
    </div>`;
  }

  function trainScreen() {
    const t = T();
    const list = ROUTE.trains.map((tr) => {
      const a = tr.stops[0], b = tr.stops[tr.stops.length - 1];
      return `<li><button class="pick" data-act="pick-train" data-train="${tr.no}" data-fk="train-${tr.no}">
        <span class="row"><span class="type-pill">${esc(state.lang === 'en' ? 'Local' : tr.type)}</span><b class="num">${tr.no}</b><b>${esc(t.to(stName(b.id)))}</b><span class="demo-badge">${esc(t.demoShort)}</span></span>
        <span class="meta num">${esc(t.runs(stName(a.id), hhmm(a.dep), stName(b.id), hhmm(b.arr)))}</span></button></li>`;
    }).join('');
    return `<div class="wrap entry" data-screen="train">
      <div class="back-row"><button class="btn small" data-act="back" data-fk="back">‹ ${esc(t.back)}</button><span style="flex:1"></span>${langToggle()}</div>
      ${noticeHtml()}
      <h2>${esc(t.trainTitle)}・${esc(t.routeName)}</h2>
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
        <p class="basis">${esc(t.basis(ROUTE.scheduleSnapshot))}</p>
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

  /* ───────── 目的站導覽 ───────── */
  function guideHtml() {
    const t = T();
    if (!state.dest) return chooseHtml();
    const id = state.dest;
    const s = C.stations[id];
    const i = idxOf(id);
    const passed = i <= state.pos;
    let h = `<div class="view">`;
    h += plateBlock(id);
    if (passed) {
      h += `<div class="pass-note" role="status"><b>${esc(t.passedTitle(stName(id)))}</b><span>${esc(t.passedLead(stName(id)))}</span>
        <span><button class="btn small" data-act="move-before" data-id="${id}" data-fk="move-before">${esc(t.passedBtn(stName(id)))}</button></span></div>`;
    }
    if (!s) return h + noGuideHtml(id) + '</div>';

    const sec = (key, inner, extra = '') => `<section class="card" id="sec-${key}" aria-labelledby="h-${key}">
      <div class="sec-h"><h2 id="h-${key}">${esc(t.sec[key])}</h2>${t.secEn[key] ? `<span class="en">${esc(t.secEn[key])}</span>` : ''}${extra}</div>${inner}</section>`;

    const jumps = [['intro', 1], ['stories', s.stories && s.stories.length], ['walk', 1], ['access', 1], ['practical', s.practical && s.practical.length]]
      .filter(([, ok]) => ok).map(([k]) => `<a href="#sec-${k}" data-act="jump" data-target="sec-${k}">${esc(t.sec[k])}</a>`).join('');
    h += `<nav class="jump" aria-label="${esc(stName(id))}">${jumps}</nav>`;

    // 認識這裡
    h += sec('intro', `${photoFigure(s.photo)}<p class="lead">${esc(L(s.intro.text))}</p>${srcLine(s.intro.src)}`);

    // 歷史與文化
    if (s.stories && s.stories.length) {
      h += sec('stories', `<div class="stories">${s.stories.map((st) => `<button class="story" data-act="story" data-kind="station-story" data-id="${id}:${st.id}" data-fk="story-${id}-${st.id}">
        <b>${esc(L(st.title))}</b><span>${esc(L(st.teaser))}</span><span class="more">${esc(t.readMore)}</span></button>`).join('')}</div>`);
    }

    // 下車怎麼逛
    h += sec('walk', walkHtml(id, s.walk));

    // 怎麼抵達
    h += sec('access', `<dl class="rows">${s.access.map((r) => `<div><dt>${esc(L(r.label))}</dt><dd>${r.tbd ? `<div class="tbd-box">${esc(L(r.text))}</div>` : esc(L(r.text))}${srcLine(r.src, true)}</dd></div>`).join('')}</dl>
      ${linkRow(id)}`);

    // 實用資訊（有才放）
    if (s.practical && s.practical.length) {
      h += sec('practical', `<dl class="rows">${s.practical.map((r) => `<div><dt>${esc(L(r.label))} <span class="checked">${esc(t.checked(r.checked || C.checkedOn))}</span></dt><dd>${r.tbd ? `<div class="tbd-box">${esc(L(r.text))}</div>` : esc(L(r.text))}${srcLine(r.src, true)}</dd></div>`).join('')}</dl>
        <p class="src">${esc(state.lang === 'en' ? 'Hours and schedules change. Check the official source before you go.' : '時間與班次可能變動，出發前請以官方來源為準。')}</p>`);
    }

    // 本站資料來源
    const all = stationSourceIds(s);
    h += `<section class="card" aria-labelledby="h-sources"><div class="sec-h"><h2 id="h-sources" style="font-size:16px">${esc(t.sec.sources)}</h2></div>
      <ul class="srclist" style="margin:0;padding-left:1.2em">${all.map((k) => `<li>${srcAnchor(k)}</li>`).join('')}</ul>
      <p class="src">${esc(t.checked(C.checkedOn))}</p></section>`;
    return h + '</div>';
  }

  function plateBlock(id) {
    const t = T();
    const s = stops();
    const i = idxOf(id);
    const prev = s[i - 1], nxt = s[i + 1];
    const st = s[i];
    const last = i === s.length - 1;
    const left = Math.max(0, i - state.pos);
    const en = C.stationNames[id].en;
    return `<div class="dest-hero">
      <div class="plate" role="heading" aria-level="1" aria-label="${esc(stName(id))}">
        <div class="pn" aria-hidden="true">${esc(stName(id))}</div>
        <div class="ps" aria-hidden="true">${esc(state.lang === 'en' ? C.stationNames[id].zh : en)}</div>
        <div class="plate-foot" aria-hidden="true"><span>${prev ? '◀ ' + esc(stName(prev.id)) : ''}</span><span class="dirmark">${esc(dirText())}</span><span>${nxt ? esc(stName(nxt.id)) + ' ▶' : esc(t.tagTerminal)}</span></div>
      </div>
      <div class="dest-meta num"><span><b>${esc(last ? t.termArr(hhmm(st.arr)) : t.arrDep(hhmm(st.arr), hhmm(st.dep)))}</b>（${esc(t.byTimetable)}）</span>${left > 0 ? `<span>${esc(t.stopsLeft(left))}</span>` : ''}</div>
    </div>`;
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

  function walkHtml(id, w) {
    const t = T();
    if (!w || !w.stops || !w.stops.length) return `<div class="tbd-box">${esc(t.tbd)}</div>`;
    const stn = ROUTE.stations[id];
    const stnName = stName(id) + (state.lang === 'en' ? ' Station' : '車站');
    const pts = [{ station: true, lat: stn.lat, lon: stn.lon }, ...w.stops];
    if (w.loop) pts.push({ station: true, lat: stn.lat, lon: stn.lon });
    const ptName = (p) => (p.station ? stnName : L(p.name));
    const legs = w.legs || [];
    const spans = w.spans || [];
    const spanOf = (k) => spans.find((sp) => k >= sp.from && k < sp.to);
    // 合計：每一段都要有來源時間（單段或跨段）才算得出來；算不出來就誠實說待查核
    let total = 0, known = true, anyKnown = spans.length > 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const sp = spanOf(k);
      const leg = legs[k] || {};
      if (sp) { if (k === sp.from) total += sp.min; }
      else if (typeof leg.min === 'number') { total += leg.min; anyKnown = true; }
      else known = false;
    }
    let h = `<p class="lead" style="margin-bottom:10px"><b>${esc(L(w.name))}</b>${w.summary ? (state.lang === 'en' ? ': ' : '：') + esc(L(w.summary)) : ''}</p>`;
    h += `<div class="walk-sum"><span>${esc(known ? t.walkTotal(total) : anyKnown ? t.walkTotalPartial : t.walkTotalTbd)}</span><span>${esc(t.walkPoints(w.stops.length))}</span>${w.loop ? `<span>${esc(t.walkLoop)}</span>` : ''}</div>`;
    if (w.photo) h += photoFigure(w.photo);
    h += `<div class="walk-map">${walkMapSvg(id, w)}</div><p class="walk-map-note">${esc(t.walkMapNote)}${w.coordSrc ? ` ${esc(t.source)}：${srcInline(w.coordSrc)}` : ''}</p>`;
    h += '<ol class="steps">';
    pts.forEach((p, k) => {
      if (p.station) {
        h += `<li class="step"><span class="stamp stn" aria-hidden="true">${esc(state.lang === 'en' ? 'Stn' : '站')}</span><div><b>${esc(stnName)}</b></div></li>`;
      } else {
        h += `<li class="step"><span class="stamp" aria-hidden="true">${k}</span><div><b>${esc(L(p.name))}</b>${p.desc ? `<p>${esc(L(p.desc))}</p>` : ''}</div></li>`;
      }
      if (k < pts.length - 1) {
        const leg = legs[k] || {};
        const sp = spanOf(k);
        const q = pts[k + 1];
        let time;
        if (sp && k === sp.from) time = `${esc(t.spanMin(ptName(pts[sp.from]), ptName(pts[sp.to]), sp.min))}（${srcInline(sp.src)}）`;
        else if (sp) time = esc(t.spanIn);
        else if (typeof leg.min === 'number') time = `${esc(t.legMin(leg.min))}${leg.src ? `（${srcInline(leg.src)}）` : ''}`;
        else time = `<span class="tbd">${esc(t.legTbd)}</span>`;
        const dist = Math.round(haversineKm([p.lat, p.lon], [q.lat, q.lon]) * 100) * 10;
        const note = leg.note ? ` · ${esc(L(leg.note))}${leg.src && typeof leg.min !== 'number' ? `（${srcInline(leg.src)}）` : ''}` : '';
        h += `<li class="leg"><span class="rail" aria-hidden="true"></span><span class="lt">${time} · <span class="num">${esc(t.straight(dist))}</span>${note}</span></li>`;
      }
    });
    h += '</ol>';
    if (w.src) h += srcLine(w.src);
    return h;
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
        <div class="sim" role="group" aria-label="${esc(t.simPos)}">
          <button class="icon-btn" data-act="step" data-dir="-1" data-fk="step-prev" aria-label="${esc(t.stepPrev)}" ${state.pos <= 0 ? 'disabled' : ''}>◀</button>
          <div class="st"><span class="demo-badge">${esc(t.simPos)}</span><b>${esc(t.between(stName(cur.id), stName(nx.id)))}</b><span class="num" style="color:var(--muted);font-size:13px">${esc(t.depAt(hhmm(cur.dep)))} → ${esc(t.arrAt(hhmm(nx.arr)))}</span></div>
          <button class="icon-btn" data-act="step" data-dir="1" data-fk="step-next" aria-label="${esc(t.stepNext)}" ${state.pos >= s.length - 2 ? 'disabled' : ''}>▶</button>
        </div>
        <table class="tt"><thead><tr><th>${esc(t.ttStation)}</th><th>${esc(t.ttTime)}</th></tr></thead><tbody>${rows}</tbody></table>
        <p class="src" style="margin:0">${esc(t.ttBasis(ROUTE.scheduleSnapshot, fmtRange()))}${srcAnchor('tra-schedule')}</p>
      </div></div>`;
  }

  // 路線里程累積（給列車位置內插用）
  const PATH = ROUTE.path;
  const CUM = PATH.reduce((out, p, i) => { out.push(i ? out[i - 1] + haversineKm(PATH[i - 1], p) : 0); return out; }, []);
  function pointAtKm(km) {
    const i = Math.max(1, CUM.findIndex((c) => c >= km));
    if (CUM[CUM.length - 1] <= km) return PATH[PATH.length - 1];
    const tt = (km - CUM[i - 1]) / (CUM[i] - CUM[i - 1] || 1);
    return [PATH[i - 1][0] + (PATH[i][0] - PATH[i - 1][0]) * tt, PATH[i - 1][1] + (PATH[i][1] - PATH[i - 1][1]) * tt];
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

  // 站名標籤位置（依實際地理手調，避免平溪線末段擠在一起）
  const LABEL = {
    badouzi: [10, 4, 'start'], haikeguan: [-10, 4, 'end'], ruifang: [-11, 5, 'end'], houtong: [10, 5, 'start'],
    sandiaoling: [10, 8, 'start'], dahua: [0, 22, 'middle'], shifen: [0, -12, 'middle'], wanggu: [0, 22, 'middle'],
    lingjiao: [0, -12, 'middle'], pingxi: [2, 22, 'middle'], jingtong: [-2, -12, 'middle'],
  };

  function routeMapSvg() {
    const t = T();
    const W = 360;
    const P = projector(PATH, W, 46, 84, 26, 40);
    const s = stops();
    const st = ROUTE.stations;
    const di = state.dest ? idxOf(state.dest) : -1;
    const cur = st[s[state.pos].id], nx = st[s[state.pos + 1].id];
    const trainKm = (cur.km + nx.km) / 2;
    // 已走過的部分（依行駛方向）
    const aKm = st[s[0].id].km;
    const lo = Math.min(aKm, trainKm), hi = Math.max(aKm, trainKm);
    const seg = [pointAtKm(lo), ...PATH.filter((_, i) => CUM[i] > lo && CUM[i] < hi), pointAtKm(hi)];
    const poly = (pts) => pts.map((p) => P.xy(p).join(',')).join(' ');
    let g = `<rect x="0" y="0" width="${W}" height="${P.H}" fill="var(--paper)"/>`;
    g += `<polyline points="${poly(PATH)}" fill="none" stroke="var(--navy)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
    g += `<polyline points="${poly(seg)}" fill="none" stroke="var(--line)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
    s.forEach((x, i) => {
      const [px, py] = P.xy([st[x.id].lat, st[x.id].lon]);
      const passed = i <= state.pos;
      if (i === di) g += `<circle cx="${px}" cy="${py}" r="11" fill="none" stroke="var(--red)" stroke-width="3"/>`;
      g += `<circle cx="${px}" cy="${py}" r="5.5" fill="${passed ? 'var(--line)' : 'var(--paper)'}" stroke="var(--navy)" stroke-width="2.5"/>`;
    });
    // 列車畫在站名下層：站名有底色描邊，壓在列車上仍讀得到
    const [tx, ty] = P.xy(pointAtKm(trainKm));
    g += `<g aria-label="${esc(t.trainHere)}"><rect x="${tx - 17}" y="${ty - 9}" width="34" height="18" rx="5" fill="var(--train)" stroke="var(--paper)" stroke-width="2"/><text x="${tx}" y="${ty + 4}" text-anchor="middle" font-size="10.5" font-weight="900" fill="#fff">${train().no}</text></g>`;
    s.forEach((x, i) => {
      const [px, py] = P.xy([st[x.id].lat, st[x.id].lon]);
      const passed = i <= state.pos;
      const [dx, dy, anchor] = LABEL[x.id] || [8, 4, 'start'];
      const isD = i === di;
      g += `<text x="${px + dx}" y="${py + dy}" text-anchor="${anchor}" font-size="${isD ? 13 : 12}" font-weight="${isD ? 900 : 700}" fill="${isD ? 'var(--red)' : passed ? 'var(--faint)' : 'var(--ink-strong)'}" paint-order="stroke" stroke="var(--paper)" stroke-width="3.5" stroke-linejoin="round">${isD ? '★ ' : ''}${esc(stName(x.id))}</text>`;
    });
    // 比例尺與指北
    const km2 = 2 * P.pxPerKm;
    g += `<g transform="translate(${(W - 60 - km2).toFixed(1)} ${P.H - 16})"><rect x="0" y="0" width="${km2.toFixed(1)}" height="4" fill="var(--ink-strong)"/><text x="${(km2 + 6).toFixed(1)}" y="5" font-size="11" fill="var(--muted)">${esc(t.scale(2))}</text></g>`;
    g += `<g transform="translate(${W - 22} 24)"><path d="M0 -12 L6 4 L0 0 L-6 4Z" fill="var(--ink-strong)"/><text x="0" y="17" text-anchor="middle" font-size="10" font-weight="800" fill="var(--muted)">${esc(t.north)}</text></g>`;
    return `<svg viewBox="0 0 ${W} ${P.H}" role="img" aria-label="${esc(t.mapTitle)}">${g}</svg>`;
  }

  // 散步示意圖：真實座標、直線連接
  function walkMapSvg(id, w) {
    const t = T();
    const stn = ROUTE.stations[id];
    const pts = [[stn.lat, stn.lon], ...w.stops.map((p) => [p.lat, p.lon])];
    const W = 340;
    const P = projector(pts, W, 34, 34, 30, 34, 280, 170);
    const H = P.H;
    const xy = P.xy;
    let g = `<rect x="0" y="0" width="${W}" height="${H}" fill="var(--bg-stage)"/>`;
    // 鐵道（只畫附近：其餘被 viewBox 裁掉）
    g += `<polyline points="${PATH.map((p) => xy(p).join(',')).join(' ')}" fill="none" stroke="var(--navy)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/>`;
    const seq = [[stn.lat, stn.lon], ...w.stops.map((p) => [p.lat, p.lon])];
    if (w.loop) seq.push([stn.lat, stn.lon]);
    g += `<polyline points="${seq.map((p) => xy(p).join(',')).join(' ')}" fill="none" stroke="var(--red)" stroke-width="2.5" stroke-dasharray="2 6" stroke-linecap="round"/>`;
    const [sx, sy] = xy([stn.lat, stn.lon]);
    g += `<rect x="${sx - 13}" y="${sy - 11}" width="26" height="22" rx="5" fill="var(--navy)"/><text x="${sx}" y="${sy + 4.5}" text-anchor="middle" font-size="${state.lang === 'en' ? 9.5 : 12}" font-weight="900" fill="var(--on-navy)">${state.lang === 'en' ? 'Stn' : '站'}</text>`;
    w.stops.forEach((p, k) => {
      const [x, y] = xy([p.lat, p.lon]);
      g += `<circle cx="${x}" cy="${y}" r="11" fill="var(--paper)" stroke="var(--red)" stroke-width="2.5"/><text x="${x}" y="${y + 4.5}" text-anchor="middle" font-size="12" font-weight="900" fill="var(--red)">${k + 1}</text>`;
    });
    // 比例尺：挑一個 100/200/500 m 的整數長度
    const m = [100, 200, 500, 1000].find((v) => (v / 1000) * P.pxPerKm >= 40) || 1000;
    const len = (m / 1000) * P.pxPerKm;
    g += `<g transform="translate(12 ${H - 14})"><rect x="0" y="0" width="${len.toFixed(1)}" height="3.5" fill="var(--ink-strong)"/><text x="${(len + 6).toFixed(1)}" y="5" font-size="11" fill="var(--muted)">${esc(m >= 1000 ? t.scale(m / 1000) : t.scaleM(m))}</text></g>`;
    g += `<g transform="translate(${W - 18} 20)"><path d="M0 -10 L5 3 L0 0 L-5 3Z" fill="var(--ink-strong)"/><text x="0" y="14" text-anchor="middle" font-size="9" font-weight="800" fill="var(--muted)">${esc(t.north)}</text></g>`;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(L(w.name))}">${g}</svg>`;
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
    (s.stories || []).forEach((x) => add(x.src));
    if (s.walk) { add(s.walk.src); add(s.walk.coordSrc); (s.walk.stops || []).forEach((x) => add(x.src)); (s.walk.legs || []).forEach((x) => add(x.src)); }
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
    if (!prevOpen) sheetRoot.querySelector('[data-fk="sheet-close"]').focus({ preventScroll: true });
  }

  function storyBody(st) {
    const t = T();
    const paras = L(st.body);
    return `<h2 id="sheet-title">${esc(L(st.title))}</h2>${st.photo ? photoFigure(st.photo) : ''}
      ${(Array.isArray(paras) ? paras : [paras]).map((p) => `<p>${esc(p)}</p>`).join('')}
      <h3>${esc(t.sourcesH)}</h3><ul class="srclist">${(st.src || []).map((s) => `<li>${srcAnchor(s)}</li>`).join('')}</ul>
      <p class="src">${esc(t.checked(C.checkedOn))}</p>`;
  }

  function aboutHtml() {
    const t = T();
    const a = C.about;
    return `<h2 id="sheet-title">${esc(t.aboutTitle)}</h2>
      ${a.sections.map((s) => `<h3>${esc(L(s.title))}</h3><ul>${L(s.items).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}
      <p style="margin-top:16px"><button class="btn" data-act="restart" data-fk="restart">${esc(t.restart)}</button></p>`;
  }

  function icon(name) {
    if (name === 'map') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4L3 6.5v13L9 17l6 3 6-2.5v-13L15 7 9 4z M9 4v13 M15 7v13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
    return '';
  }

  /* ───────── 開機 ───────── */
  const params = parseLocation();
  enter(params, { via: 'url', push: false });
})();
