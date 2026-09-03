/* 軌島 公車轉乘 UI 模組（全臺客運鐵路、捷運與輕軌站）
 *
 * 定位：三階段轉乘流程的同一張卡，phase 由呼叫者傳入（模組不猜行程狀態）。
 *
 *   planning    規劃中    建議路線、營運時間／班距、上下車站、步行資訊。不顯示現在的倒數，不打任何 API。
 *   approaching 接近轉乘站 列車預估抵達、候選公車、預估銜接裕度。一般規劃卡不查即時；
 *                          轉乘助手則只在宿主送進 15 分／5 分／到站里程碑時各查一次。
 *   arrived     已抵達      提供「查看現在可搭公車」主操作；使用者按下才打 /api/bus-transfer，
 *                          再點某一路線才打 /api/bus-leg-live。
 *
 * 前一階的內容不消失，降級成一行摘要，使用者可自行展開——這樣同一張卡不會同時塞進三階全部資訊。
 *
 * 契約與邊界（刻意的設計，改動前請先讀）：
 * - 本檔不碰 index.html 既有的任何 DOM、class、事件。所有 selector 一律 .btu- 前綴，
 *   所有事件都綁在呼叫者交進來的 root 上（delegated，單一 listener）。
 * - 沒有 setInterval、沒有 setTimeout、沒有背景輪詢、沒有 visibilitychange 重取。
 * - mount() 本身不發任何 API 請求，任何 phase 都是。轉乘助手的查詢只由 refresh() 的明確
 *   里程碑事件觸發；模組自己沒有 timer，也不會沿途每站自動查。
 * - 已載入資料與展開狀態存在模組層 Map（DOM 之外），依 stationId／viewKey 保存；
 *   renderBoardBody 反覆重建 innerHTML 之後重新 mount，狀態與資料都會恢復且不會重打 API。
 * - 語意如實呈現：N1 空白區分四種以上成因、資料年齡外顯、stale 不得偽裝成正常即時、
 *   步行時間標明是戶外估算、vehicle binding 分 exact／candidate／未識別（不補假車號）、
 *   擁擠度只呈現既有狀態。
 * - 導航是外部輔助，不取代任何聲明：卡片在所有 phase 都保留「戶外步行估算／未計站內步行」。
 */
(function (global) {
  'use strict';

  const VERSION = '0.8.0';
  const COVERAGE = 'all_active_rail_stations';
  const API_BASE = '';
  const STALE_LABEL_SEC = 180;
  // 不用 timer。只有使用者再次展開同一區塊時，超過 Worker 的 20 秒 raw cache
  // 才重新查；看板自己每 20 模擬秒重繪不會觸發請求。
  const QUERY_REFRESH_AFTER_SEC = 20;
  const MAPS_DIR = 'https://www.google.com/maps/dir/?api=1';
  const JOURNEY_STORAGE_KEY = 'rail-island-bus-journey-v1';
  const JOURNEY_MAX_AGE_MS = 12 * 3600 * 1000;

  // 宿主傳入既有的 t()。整個 App 同一時間只會使用一種介面語言；重新 mount
  // （例如切換語言後重繪看板）會更新這個函式。未提供時安全退回繁中。
  let translateImpl = null;
  function tr(source, vars = {}, count = vars.n) {
    if (typeof translateImpl === 'function') return translateImpl(source, vars, count);
    return String(source).replace(/\{([\w]+)\}/g, (_, key) => vars[key] == null ? '' : String(vars[key]));
  }

  // 真正的營運站清單由宿主的 tra_station_info＋目前班表決定，Worker 再以 manifest 做第二道 gate。
  // UI 只接受四碼台鐵 StationID，避免任意字串進入 API；不在這裡複製一份 239 站白名單造成漂移。
  // 台鐵沿用四碼 StationID；其餘鐵路／捷運優先用官方系統 StationID，新站尚未進官方共站表時
  // 使用 RI 穩定 id。只接受單一冒號與安全字元，實際是否存在仍由 Worker manifest 判定。
  const isSupportedStationId = stationId => /^[A-Z]+:[A-Za-z0-9_]+$/.test(String(stationId || ''));

  const PHASES = ['planning', 'approaching', 'arrived'];
  const PHASE_META = {
    planning: { chip: '規劃', title: '轉乘規劃', lede: '抵達後可以怎麼接' },
    approaching: { chip: '接近', title: '銜接裕度', lede: '快到了，接得上嗎' },
    arrived: { chip: '已抵達', title: '現在可搭什麼', lede: '我現在在這站附近能搭什麼' },
  };

  // ── 模組層狀態（DOM 之外）────────────────────────────────────────
  // 掛在 global 上的單一 store：宿主若因熱重載或重複載入而把本檔求值兩次，
  // 第二次會沿用第一次的容器，否則兩份 DATA 會各自打一次 API。
  const store = global.__btuStore || (global.__btuStore = {
    DATA: new Map(),
    VIEW: new Map(),
    INSTANCES: new Set(),
    JOURNEY: undefined,
  });
  const DATA = store.DATA;
  const VIEW = store.VIEW;
  const INSTANCES = store.INSTANCES;

  function readJourney() {
    try {
      const value = JSON.parse(global.localStorage && global.localStorage.getItem(JOURNEY_STORAGE_KEY) || 'null');
      if (!value || value.version !== 1 || !value.stationId || !value.arrivalKey ||
          !['waiting', 'aboard'].includes(value.phase) || Date.now() - Number(value.updatedAt || 0) > JOURNEY_MAX_AGE_MS) {
        if (value && global.localStorage) global.localStorage.removeItem(JOURNEY_STORAGE_KEY);
        return null;
      }
      return value;
    } catch (error) { return null; }
  }
  if (store.JOURNEY === undefined) store.JOURNEY = readJourney();

  function journeyValue() { return store.JOURNEY || null; }
  function emitJourney(reason, previous = null) {
    const detail = { journey: journeyValue(), previous, reason: String(reason || 'updated') };
    for (const instance of [...INSTANCES]) {
      if (typeof instance.onJourneyChange === 'function') {
        try { instance.onJourneyChange(detail); } catch (error) { /* 宿主 callback 不得打斷卡片 */ }
      }
    }
    try { global.dispatchEvent(new CustomEvent('rail-bus-journey-change', { detail })); } catch (error) {}
  }
  function writeJourney(next, reason) {
    const previous = store.JOURNEY || null;
    store.JOURNEY = next ? { ...next, version: 1, updatedAt: Date.now() } : null;
    try {
      if (store.JOURNEY) global.localStorage.setItem(JOURNEY_STORAGE_KEY, JSON.stringify(store.JOURNEY));
      else global.localStorage.removeItem(JOURNEY_STORAGE_KEY);
    } catch (error) { /* 私密模式仍可在本次頁面使用 */ }
    renderAll();
    emitJourney(reason, previous);
    return store.JOURNEY;
  }

  const stationData = stationId => {
    if (!DATA.has(stationId)) DATA.set(stationId, {
      status: 'idle', data: null, error: null, fetchedAt: 0, inflight: null,
      controller: null, legs: new Map(),
    });
    return DATA.get(stationId);
  };
  const legData = (stationId, arrivalKey) => {
    const legs = stationData(stationId).legs;
    if (!legs.has(arrivalKey)) legs.set(arrivalKey, {
      status: 'idle', data: null, error: null, fetchedAt: 0, inflight: null, controller: null,
      routeStatus: 'idle', routeData: null, routeError: null, routeInflight: null, routeController: null,
    });
    return legs.get(arrivalKey);
  };
  const viewState = viewKey => {
    if (!VIEW.has(viewKey)) VIEW.set(viewKey, {
      expanded: false,    // 已抵達階段的即時面板
      showAll: false,
      planOpen: false,    // 降級後的規劃摘要是否展開
      slackOpen: false,   // 降級後的裕度摘要是否展開
      openLegs: new Set(),
      pickArrivalKey: null,
    });
    return VIEW.get(viewKey);
  };

  // ── 文案表 ───────────────────────────────────────────────────────
  const N1_STATE = {
    arriving:        { tone: 'live',  label: '即將進站' },
    countdown:       { tone: 'live',  label: null },
    scheduled:       { tone: 'sched', label: '依時刻表' },
    not_departed:    { tone: 'wait',  label: '尚未發車', note: '這班還沒從起點開出' },
    last_bus_passed: { tone: 'off',   label: '末班已過', note: '今日這個方向已無班次' },
    no_estimate:     { tone: 'gap',   label: '暫無預估', note: '有營運，但來源這一刻沒給預估時間' },
    not_operating:   { tone: 'off',   label: '今日未營運', note: '今日這條路線不行駛' },
    skipped:         { tone: 'gap',   label: '交管不停靠', note: '來源標記此站暫時不停' },
    unknown:         { tone: 'gap',   label: '狀態不明', note: '來源沒給預估也沒給停靠狀態' },
    stale:           { tone: 'stale', label: '資料已過期' },
  };

  const OCCUPANCY = {
    available:    { comfortable: '座位充足', normal: '車上普通', crowded: '車上擁擠' },
    stale:        '擁擠度資料過期，不採用',
    unavailable:  '這台車沒取到擁擠度',
    not_provided: '此縣市未提供擁擠度',
    not_loaded:   '點開路線後才查擁擠度',
  };

  const BINDING = {
    exact_n1_plate: '已對上倒數的那一班（車牌經同路線重新驗證）',
    candidate_set: '無法確認哪一台是倒數的那一班，以下為同路線同方向的候選車輛',
  };

  const VEHICLE_BINDING = {
    n1_plate_verified: '倒數這班',
    route_candidate: '同路線候選',
    route_candidate_unidentified: '同路線候選（此車未提供車牌）',
  };

  const WALK_NOTE_FULL = '步行時間是車站座標到路邊站牌的戶外直線估算（×1.25，每分鐘 75 公尺），不含月台、閘門、地下街或站內轉乘的步行時間。導航由 Google 地圖提供，同樣從路邊起算。';
  const WALK_NOTE_TIGHT = '步行為戶外直線估算，不含站內步行。';

  // ── 小工具 ───────────────────────────────────────────────────────
  const esc = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const ageText = sec => {
    if (sec == null || !Number.isFinite(sec)) return tr('來源未提供更新時間');
    if (sec < 60) return tr('{n} 秒前的資料', { n: Math.round(sec) }, Math.round(sec));
    if (sec < 3600) return tr('{n} 分前的資料', { n: Math.floor(sec / 60) }, Math.floor(sec / 60));
    return tr('{n} 小時前的資料', { n: Math.floor(sec / 3600) }, Math.floor(sec / 3600));
  };

  // 渲染那一刻重算年齡：回應裡的 ageSec 加上「這份回應在本地放了多久」。
  // 誠實（不假裝資料比實際新），也不需要任何 timer——只有重繪時才會重算。
  const liveAge = (baseAgeSec, fetchedAt) => {
    if (baseAgeSec == null || !Number.isFinite(baseAgeSec)) return null;
    const held = fetchedAt ? Math.max(0, (Date.now() - fetchedAt) / 1000) : 0;
    return Math.round(baseAgeSec + held);
  };

  const etaText = sec => {
    if (sec == null || !Number.isFinite(sec)) return '—';
    if (sec <= 30) return tr('進站中');
    if (sec < 60) return tr('約 1 分');
    const minutes = Math.floor(sec / 60);
    return tr('{n} 分', { n: minutes }, minutes);
  };

  const clockText = iso => {
    const ms = Date.parse(iso || '');
    if (!Number.isFinite(ms)) return null;
    const date = new Date(ms);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  const minutesUntil = iso => {
    const ms = Date.parse(iso || '');
    if (!Number.isFinite(ms)) return null;
    return Math.round((ms - Date.now()) / 60000);
  };

  const routeLabel = route => {
    const name = route.routeName || tr('（未命名路線）');
    const sub = route.subRouteName && route.subRouteName !== name ? route.subRouteName : '';
    return { name, sub };
  };

  // 導航必須用該方向實體 StopUID 的精確經緯度，不以站牌名稱代替
  // （同名站牌兩側方向不同、Google 的名稱比對會挑錯邊）。
  function walkUrl(stopPosition, arrived, originPosition) {
    if (!stopPosition || !Number.isFinite(stopPosition.lat) || !Number.isFinite(stopPosition.lon)) return null;
    const parts = [MAPS_DIR, `destination=${encodeURIComponent(`${stopPosition.lat},${stopPosition.lon}`)}`];
    if (arrived) {
      // 已抵達：省略 origin 並加 dir_action=navigate，讓 Google 地圖用裝置當下位置起算。
      parts.push('dir_action=navigate');
    } else if (originPosition && Number.isFinite(originPosition.lat) && Number.isFinite(originPosition.lon)) {
      parts.push(`origin=${encodeURIComponent(`${originPosition.lat},${originPosition.lon}`)}`);
    }
    parts.push('travelmode=walking');
    return parts.join('&');
  }

  function navLink(stopPosition, arrived, originPosition, stopName) {
    const url = walkUrl(stopPosition, arrived, originPosition);
    if (!url) return '';
    const label = tr(arrived ? '步行導航到站牌' : '預覽步行路線');
    const cls = arrived ? 'btu-nav btu-nav-go' : 'btu-nav';
    return `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}<span class="btu-opt">${stopName ? `：${esc(stopName)}` : ''}</span></a>`;
  }

  // ── 密度 ─────────────────────────────────────────────────────────
  // 「還塞得下多少字」＝容器實際寬度 ÷ 生效字級倍率。只看 viewport 會誤判：
  // 同一支手機在特大字下能容納的字數少得多，而桌面也可能把模組掛在 264px 的小卡裡。
  const COMPACT_BELOW = 340;
  function densityOf(root) {
    // mount 的那一刻 root 常常還沒有寬度（尚未 layout）。量到 0 就往上找最近一個
    // 量得到寬度的祖先當代理，不要因為量不到就預設 full——那會讓手機窄卡的第一畫
    // 永遠是錯的分層，而且必須依賴 observer 收尾。
    let node = root;
    let width = 0;
    while (node && !width) {
      width = node.clientWidth || (node.getBoundingClientRect ? node.getBoundingClientRect().width : 0);
      node = node.parentElement;
    }
    if (!width) return 'full';
    const ui = parseFloat(getComputedStyle(root).getPropertyValue('--ui')) || 1;
    return width / ui < COMPACT_BELOW ? 'compact' : 'full';
  }

  // ── 樣式（一次注入；全部 .btu- 前綴，不觸碰 .board 或任何既有 selector）──
  const STYLE_ID = 'btu-styles';
  function ensureStyles(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.btu-root{font-family:var(--font,-apple-system,"PingFang TC","Noto Sans TC",sans-serif);color:var(--ink,#3A3226);font-variant-numeric:tabular-nums}
.btu-root.btu-board-slot{margin:10px 10px 12px}
.btu-root *{box-sizing:border-box}
.btu-card{border:1.5px solid var(--line,#C9B98F);border-radius:var(--r-m,8px);background:var(--paper,#FFFDF6);overflow:hidden}
.btu-phasebar{display:flex;align-items:center;gap:6px;padding:7px 12px;border-bottom:1.5px dashed var(--line-dash,#D8CBA9)}
.btu-phasebar .btu-ph{font-size:calc(10.5px * var(--uis,1));font-weight:700;color:var(--faint,#8A7C62);padding:1px 8px;border-radius:var(--r-pill,999px);border:1px solid transparent}
.btu-phasebar .btu-ph.on{color:var(--on-navy,#FFFDF6);background:var(--navy,#2A4A73);border-color:var(--navy,#2A4A73);font-weight:800}
.btu-phasebar .btu-ph.done{color:var(--muted,#6B5F4A);border-color:var(--line,#C9B98F)}
.btu-phasebar .btu-phsep{font-size:calc(9px * var(--uis,1));color:var(--line,#C9B98F)}
.btu-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:5px 10px;padding:9px 12px;border-bottom:1.5px dashed var(--line-dash,#D8CBA9)}
.btu-head .btu-ttl{font-size:calc(14px * var(--ui,1));font-weight:900;color:var(--ink-strong,#1E2C40)}
.btu-head .btu-basis{flex:1 1 100%;font-size:calc(11.5px * var(--uis,1));line-height:1.5;color:var(--muted,#6B5F4A);text-wrap:pretty}
.btu-meta{display:flex;flex-wrap:wrap;gap:4px 12px;padding:7px 12px;font-size:calc(11px * var(--uis,1));color:var(--faint,#8A7C62);border-bottom:1.5px dashed var(--line-dash,#D8CBA9)}
.btu-train{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;padding:10px 12px;background:var(--bg-stage,#F7F0DD);border-bottom:1.5px dashed var(--line-dash,#D8CBA9)}
.btu-train .btu-tnum{font-size:calc(19px * var(--ui,1));font-weight:900;color:var(--ink-strong,#1E2C40);line-height:1.1}
.btu-train .btu-tlbl{font-size:calc(11.5px * var(--uis,1));font-weight:700;color:var(--muted,#6B5F4A)}
.btu-train .btu-age{flex:1 1 100%}
.btu-list{display:flex;flex-direction:column}
.btu-row{border-top:1px solid var(--line-faint,#ECE2C8)}
.btu-row:first-child{border-top:0}
.btu-plan{display:flex;flex-direction:column;gap:3px;padding:10px 12px}
.btu-rowbtn{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:4px 11px;width:100%;min-height:calc(52px * var(--uit,1));padding:9px 12px;font:inherit;text-align:left;background:none;border:0;cursor:pointer;color:inherit}
.btu-rowbtn:hover{background:var(--bg-stage,#F7F0DD)}
.btu-eta{grid-column:1;justify-self:start;min-width:calc(56px * var(--ui,1));font-size:calc(19px * var(--ui,1));font-weight:900;line-height:1.1;color:var(--ink-strong,#1E2C40)}
.btu-eta.btu-t-live{color:var(--red,#D23C2A)}
.btu-eta.btu-t-sched{color:var(--navy,#2A4A73)}
.btu-eta.btu-t-stale,.btu-eta.btu-t-off,.btu-eta.btu-t-gap,.btu-eta.btu-t-wait{font-size:calc(12.5px * var(--ui,1));font-weight:800;color:var(--muted,#6B5F4A);white-space:normal}
.btu-eta.btu-t-stale{color:var(--warn-ink,#A3641A)}
.btu-main{grid-column:2;min-width:0;display:flex;flex-direction:column;gap:2px}
.btu-route{font-size:calc(14px * var(--ui,1));font-weight:800;color:var(--ink-strong,#1E2C40)}
.btu-route .btu-sub{font-size:calc(11px * var(--uis,1));font-weight:600;color:var(--faint,#8A7C62);margin-left:6px}
.btu-sec{font-size:calc(11.5px * var(--uis,1));color:var(--muted,#6B5F4A);line-height:1.45;text-wrap:pretty}
.btu-slack{font-size:calc(11.5px * var(--uis,1));line-height:1.45;color:var(--ink,#3A3226);font-weight:700}
.btu-verdict{font-size:calc(13.5px * var(--ui,1));font-weight:900;line-height:1.35;color:var(--ink-strong,#1E2C40)}
.btu-verdict.btu-v-ok{color:var(--ok,#1B8F4D)}
.btu-verdict.btu-v-tight{color:var(--warn-ink,#A3641A)}
.btu-verdict.btu-v-miss{color:var(--red,#D23C2A)}
.btu-verdict.btu-v-unknown{color:var(--muted,#6B5F4A);font-weight:800;font-size:calc(12px * var(--ui,1))}
.btu-caveat{font-size:calc(11px * var(--uis,1));line-height:1.45;color:var(--warn-ink,#A3641A);text-wrap:pretty}
.btu-age{font-size:calc(10.5px * var(--uis,1));color:var(--faint,#8A7C62)}
.btu-rowcaret{grid-column:3;font-size:calc(11px * var(--uis,1));color:var(--faint,#8A7C62);font-weight:700}
.btu-tag{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:var(--r-pill,999px);border:1px solid var(--line,#C9B98F);font-size:calc(10.5px * var(--uis,1));font-weight:700;color:var(--muted,#6B5F4A);background:var(--bg-stage,#F7F0DD)}
.btu-tag.btu-warn{background:var(--warn-bg,#FBE9DF);border-color:var(--warn-line,#E0A37E);color:var(--warn-ink,#A3641A)}
.btu-tag.btu-navy{background:none;border-color:var(--navy,#2A4A73);color:var(--navy,#2A4A73)}
.btu-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:1px}
/* 導航是外部輔助：安靜的文字連結，刻意不做成與主操作同級的實心鈕。 */
.btu-nav{display:inline-flex;align-items:center;gap:5px;align-self:flex-start;margin-top:3px;min-height:calc(36px * var(--uit,1));padding:5px 0;font-size:calc(11.5px * var(--uis,1));font-weight:700;color:var(--navy,#2A4A73);text-decoration:none;border-bottom:1px dashed currentColor}
.btu-nav:hover{color:var(--red,#D23C2A)}
.btu-nav::before{content:"↗";font-weight:800;opacity:.7}
.btu-nav-go{align-self:stretch;justify-content:center;margin-top:8px;padding:8px 12px;min-height:calc(44px * var(--uit,1));border:1.5px solid var(--navy,#2A4A73);border-bottom-style:solid;border-radius:var(--r-m,8px);background:var(--paper,#FFFDF6)}
.btu-nav-go:hover{background:var(--bg-stage,#F7F0DD);color:var(--navy,#2A4A73)}
.btu-leg{padding:10px 12px 12px;background:var(--bg-stage,#F7F0DD);border-top:1px dashed var(--line-dash,#D8CBA9)}
.btu-leg .btu-legbasis{font-size:calc(11px * var(--uis,1));line-height:1.5;color:var(--muted,#6B5F4A);margin:0 0 8px;text-wrap:pretty}
.btu-journey{padding:10px 12px;background:var(--bg-stage,#F7F0DD);border-bottom:1.5px dashed var(--line-dash,#D8CBA9)}
.btu-journeytop{display:flex;align-items:baseline;gap:6px 10px;flex-wrap:wrap}
.btu-journeytop b{font-size:calc(14px * var(--ui,1));color:var(--ink-strong,#1E2C40)}
.btu-journeyphase{font-size:calc(10.5px * var(--uis,1));font-weight:800;color:var(--on-navy,#FFFDF6);background:var(--navy,#2A4A73);border-radius:var(--r-pill,999px);padding:2px 8px}
.btu-journeyline{display:block;margin-top:4px;font-size:calc(11.5px * var(--uis,1));line-height:1.45;color:var(--muted,#6B5F4A)}
.btu-journeyactions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:7px;margin-top:9px}
.btu-jbtn{min-height:calc(44px * var(--uit,1));padding:7px 10px;font:inherit;font-size:calc(12px * var(--ui,1));font-weight:800;color:var(--navy,#2A4A73);background:var(--paper,#FFFDF6);border:1.5px solid var(--navy,#2A4A73);border-radius:var(--r-m,8px);cursor:pointer}
.btu-jbtn.primary{color:var(--on-navy,#FFFDF6);background:var(--navy,#2A4A73)}
.btu-jbtn.danger{color:var(--red,#D23C2A);border-color:var(--red,#D23C2A)}
.btu-picker{display:flex;flex-direction:column;gap:7px;margin-top:9px;padding-top:9px;border-top:1px dashed var(--line-dash,#D8CBA9)}
.btu-picker label{font-size:calc(11.5px * var(--uis,1));font-weight:800;color:var(--muted,#6B5F4A)}
.btu-picker select{width:100%;min-height:calc(44px * var(--uit,1));padding:7px 9px;font:inherit;font-size:calc(13px * var(--ui,1));color:var(--ink,#3A3226);background:var(--paper,#FFFDF6);border:1.5px solid var(--line,#C9B98F);border-radius:var(--r-m,8px)}
.btu-pickeractions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:7px}
.btu-veh{display:flex;flex-direction:column;gap:3px;padding:8px 10px;background:var(--paper,#FFFDF6);border:1px solid var(--line-faint,#ECE2C8);border-radius:var(--r-s,4px)}
.btu-veh+.btu-veh{margin-top:6px}
.btu-veh .btu-plate{font-family:var(--mono,ui-monospace,Menlo,monospace);font-size:calc(13px * var(--ui,1));font-weight:800;color:var(--ink-strong,#1E2C40);letter-spacing:.5px}
.btu-veh .btu-noplate{font-size:calc(12px * var(--uis,1));font-weight:700;color:var(--muted,#6B5F4A)}
/* 已抵達階段唯一的主操作。導航不跟它競爭：導航只出現在使用者選定路線之後的展開區內。 */
.btu-primary{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:calc(48px * var(--uit,1));padding:10px 14px;font:inherit;font-size:calc(14px * var(--ui,1));font-weight:800;cursor:pointer;background:var(--navy,#2A4A73);color:var(--on-navy,#FFFDF6);border:0;box-shadow:inset 0 3px 0 var(--gold,#D2A12A)}
.btu-primary:hover{opacity:.94}
.btu-summary{display:flex;align-items:center;gap:8px;width:100%;min-height:calc(40px * var(--uit,1));padding:7px 12px;font:inherit;font-size:calc(11.5px * var(--uis,1));font-weight:700;cursor:pointer;text-align:left;color:var(--muted,#6B5F4A);background:none;border:0;border-top:1px dashed var(--line-dash,#D8CBA9)}
.btu-summary:hover{background:var(--bg-stage,#F7F0DD)}
.btu-summary .btu-caret{margin-left:auto;color:var(--faint,#8A7C62);font-weight:700}
.btu-more,.btu-retry{display:block;width:100%;min-height:calc(44px * var(--uit,1));padding:8px 12px;font:inherit;font-size:calc(12.5px * var(--uis,1));font-weight:700;cursor:pointer;color:var(--navy,#2A4A73);background:none;border:0;border-top:1px dashed var(--line-dash,#D8CBA9)}
.btu-more:hover,.btu-retry:hover{background:var(--bg-stage,#F7F0DD)}
.btu-note{padding:9px 12px;font-size:calc(11px * var(--uis,1));line-height:1.55;color:var(--faint,#8A7C62);border-top:1px dashed var(--line-dash,#D8CBA9);text-wrap:pretty}
.btu-msg{padding:12px;font-size:calc(12.5px * var(--uis,1));line-height:1.55;color:var(--muted,#6B5F4A)}
.btu-msg.btu-err{background:var(--warn-bg,#FBE9DF);color:var(--warn-ink,#A3641A)}
.btu-skel{padding:12px;font-size:calc(12.5px * var(--uis,1));color:var(--faint,#8A7C62)}
/* 密度分層：data-btu-density 由 JS 依「容器寬度 ÷ 生效字級倍率」寫入（見 densityOf）。
   手機窄卡、264px 小卡、大字／特大字都會落到 compact。compact 收掉的只有闡述性內容；
   狀態標籤、資料年齡、stale 標記、車牌與「未提供車牌」、裕度警語在任何密度下都不收。 */
.btu-root:not([data-btu-density=compact]) .btu-tight{display:none}
.btu-root[data-btu-density=compact] .btu-opt{display:none}
.btu-root[data-btu-density=compact] .btu-rowbtn{grid-template-columns:auto 1fr;gap:2px 9px;padding:9px 10px}
.btu-root[data-btu-density=compact] .btu-eta{grid-row:1;min-width:0;font-size:calc(17px * var(--ui,1))}
.btu-root[data-btu-density=compact] .btu-eta.btu-t-stale,
.btu-root[data-btu-density=compact] .btu-eta.btu-t-off,
.btu-root[data-btu-density=compact] .btu-eta.btu-t-gap,
.btu-root[data-btu-density=compact] .btu-eta.btu-t-wait{font-size:calc(12px * var(--ui,1))}
.btu-root[data-btu-density=compact] .btu-rowcaret{grid-column:2;grid-row:1;justify-self:end;font-size:calc(11px * var(--uis,1))}
.btu-root[data-btu-density=compact] .btu-main{grid-column:1 / -1;grid-row:2}
.btu-root[data-btu-density=compact] .btu-route{font-size:calc(13.5px * var(--ui,1))}
.btu-root[data-btu-density=compact] .btu-route .btu-sub{display:block;margin-left:0}
.btu-root[data-btu-density=compact] .btu-head,
.btu-root[data-btu-density=compact] .btu-meta,
.btu-root[data-btu-density=compact] .btu-note,
.btu-root[data-btu-density=compact] .btu-plan,
.btu-root[data-btu-density=compact] .btu-train{padding-left:10px;padding-right:10px}
.btu-root[data-btu-density=compact] .btu-leg{padding:9px 10px 10px}
`;
    (doc.head || doc.documentElement).appendChild(style);
  }

  // ── 共用片段 ─────────────────────────────────────────────────────
  function renderAccess(access) {
    if (!access) return { full: tr('站牌位置未知'), tight: tr('站牌位置未知') };
    return {
      full: tr('步行約 {minutes} 分（約 {meters} 公尺，戶外估算）', { minutes: access.estimatedWalkMin, meters: access.estimatedWalkM }),
      tight: tr('步行約 {minutes} 分', { minutes: access.estimatedWalkMin }),
    };
  }

  function renderPhaseBar(phase) {
    const index = PHASES.indexOf(phase);
    return `<div class="btu-phasebar">${PHASES.map((name, i) => {
      const cls = i === index ? 'btu-ph on' : (i < index ? 'btu-ph done' : 'btu-ph');
      return `${i ? '<span class="btu-phsep" aria-hidden="true">›</span>' : ''}<span class="${cls}"${i === index ? ' aria-current="step"' : ''}>${esc(tr(PHASE_META[name].chip))}</span>`;
    }).join('')}</div>`;
  }

  function renderHead(phase, stationName) {
    const meta = PHASE_META[phase];
    return `<div class="btu-head">
<span class="btu-ttl">${esc(tr(meta.title))}</span>
<span class="btu-basis">${esc(stationName)}・${esc(tr(meta.lede))}</span>
</div>`;
  }

  function renderWalkNote() {
    return `<p class="btu-note btu-opt">${esc(tr(WALK_NOTE_FULL))}</p><p class="btu-note btu-tight">${esc(tr(WALK_NOTE_TIGHT))}</p>`;
  }

  function renderAssistantShare(instance) {
    if (!instance.assistant || !instance.journeyContext || !instance.journeyContext.rail || journeyValue()) return '';
    const label = global.__railJourneyShareActive ? tr('分享中・管理') : tr('分享這段旅程');
    return `<div class="btu-pickeractions"><button type="button" class="btu-jbtn" data-btu-act="journey-share">${esc(label)}</button></div>`;
  }

  // ── 規劃中 ───────────────────────────────────────────────────────
  function serviceText(service) {
    if (!service) return { line: '營運時間與班距未提供', headway: null };
    const bits = [];
    if (service.firstBus && service.lastBus) bits.push(`${esc(service.firstBus)}–${esc(service.lastBus)}`);
    else if (service.lastBus) bits.push(`末班 ${esc(service.lastBus)}`);
    if (Number.isFinite(service.headwayMin)) bits.push(`約每 ${service.headwayMin} 分一班`);
    if (service.days) bits.push(esc(service.days));
    return {
      line: bits.length ? bits.join('・') : '營運時間與班距未提供',
      headway: Number.isFinite(service.headwayMin) ? service.headwayMin : null,
    };
  }

  function renderPlanRoute(route, stationPosition, arrived) {
    const { name, sub } = routeLabel(route);
    const walk = renderAccess(route.access);
    const service = serviceText(route.service);
    const lines = [];
    lines.push({ cls: '', text: `上車：${esc(route.boardStopName || '站牌未定')}・${walk.tight}` });
    lines.push({ cls: 'btu-opt', text: `步行 ${route.access ? `約 ${route.access.estimatedWalkM} 公尺（戶外估算）` : '距離未知'}` });
    if (route.alightStopName) lines.push({ cls: '', text: `下車：${esc(route.alightStopName)}` });
    lines.push({ cls: '', text: service.line });
    return `<div class="btu-row"><div class="btu-plan">
<span class="btu-route">${esc(name)}${sub ? `<span class="btu-sub">${esc(sub)}</span>` : ''}${route.headsign ? `<span class="btu-sub">往 ${esc(route.headsign)}</span>` : ''}</span>
${lines.map(line => `<span class="btu-sec${line.cls ? ` ${line.cls}` : ''}">${line.text}</span>`).join('')}
${navLink(route.boardStopPosition, arrived, stationPosition, route.boardStopName)}
</div></div>`;
  }

  function renderPlanBody(instance, view) {
    if (instance.assistant) {
      return `${renderTrainEta(instance.trainEta)}
<div class="btu-msg">${esc(tr('轉乘站已設定。抵達前 15 分鐘會開始比對公車動態；在那之前不發出即時查詢。'))}</div>
${renderAssistantShare(instance)}${renderWalkNote()}`;
    }
    const plan = instance.plan;
    const routes = plan && Array.isArray(plan.routes) ? plan.routes : [];
    if (!routes.length) {
      return `<div class="btu-msg">這一段還沒有可用的公車轉乘建議。規劃資料由行程來源提供，不是此刻的公車動態。</div>${renderWalkNote()}`;
    }
    const shown = view.showAll ? routes : routes.slice(0, 3);
    const rest = routes.length - shown.length;
    const position = plan.stationPosition || null;
    return `<div class="btu-meta"><span>路線與班表資訊，不是此刻的公車位置</span><span class="btu-opt">共 ${routes.length} 條候選</span></div>
<div class="btu-list">${shown.map(route => renderPlanRoute(route, position, false)).join('')}</div>
${rest > 0 ? `<button type="button" class="btu-more" data-btu-act="more">再顯示其餘 ${rest} 條</button>` : ''}
${view.showAll && routes.length > 3 ? '<button type="button" class="btu-more" data-btu-act="less">只顯示前三條</button>' : ''}
${renderWalkNote()}`;
  }

  // ── 接近轉乘站 ───────────────────────────────────────────────────
  function renderTrainEta(trainEta) {
    if (!trainEta) return '<div class="btu-train"><span class="btu-tlbl">列車預估抵達時間未提供</span></div>';
    const clock = clockText(trainEta.arrivalAt);
    const mins = minutesUntil(trainEta.arrivalAt);
    const head = clock ? `${clock}` : '—';
    const rel = mins == null ? '' : (mins <= 0 ? '即將抵達' : `約 ${mins} 分後`);
    return `<div class="btu-train">
<span class="btu-tnum">${esc(head)}</span>
<span class="btu-tlbl">列車預估抵達${rel ? `・${esc(rel)}` : ''}</span>
<span class="btu-age">${esc(ageText(trainEta.ageSec))}${trainEta.source ? `・來源 ${esc(trainEta.source)}` : ''}</span>
</div>`;
  }

  // 裕度只由「抵達後步行時間」與「班距」推得，不用現在的公車倒數——
  // 現在的倒數說的是現在站在這裡的人搭得到什麼，不是使用者抵達後搭得到什麼。
  // 裕度判語。有呼叫者提供的公車到站預估（busEtaAt）時才能算真裕度；
  // 沒有就說「尚未提供」，不拿現在的倒數充当未來的承諾。不寫保證性文案。
  const SAFETY_BUFFER_MIN = 2;

  // 動態轉乘助手的可行性判斷。公車 etaSec 是「Worker 回應產生時到站還有幾秒」，前端收到後
  // 以 fetchedAt 當基準換成絕對時刻；列車 arrivalAt 則由跟車狀態提供。兩者都存在且資料未過期
  // 才能比較。Math.floor 刻意向下取整，避免在不足整分鐘時高估轉乘餘裕。
  function liveConnectionVerdict(arrival, trainEta, fetchedAt) {
    const live = arrival && arrival.live || {};
    const trainMs = Date.parse(trainEta && trainEta.arrivalAt || '');
    const walkMin = arrival && arrival.access && Number.isFinite(arrival.access.estimatedWalkMin)
      ? arrival.access.estimatedWalkMin : null;
    const usable = ['countdown', 'arriving', 'scheduled'].includes(live.state)
      && Number.isFinite(live.etaSec) && Number.isFinite(trainMs) && Number.isFinite(fetchedAt) && walkMin != null;
    if (!usable) return { tone: 'unknown', text: tr('目前無法判斷能否接上') };
    const busMs = fetchedAt + live.etaSec * 1000;
    const slack = Math.floor((busMs - trainMs) / 60000) - walkMin - SAFETY_BUFFER_MIN;
    if (slack >= 4) return { tone: 'ok', text: tr('預估可轉乘・保守裕度 {n} 分', { n: slack }, slack), slack };
    if (slack >= 0) return { tone: 'tight', text: tr('轉乘時間偏緊・保守裕度 {n} 分', { n: slack }, slack), slack };
    return { tone: 'miss', text: tr('這一班目前可能接不上'), slack };
  }
  function slackVerdict(route, trainEta) {
    const walkMin = route.access && Number.isFinite(route.access.estimatedWalkMin) ? route.access.estimatedWalkMin : null;
    const busMs = Date.parse(route.busEtaAt || '');
    const trainMs = Date.parse((trainEta && trainEta.arrivalAt) || '');
    if (!Number.isFinite(busMs) || !Number.isFinite(trainMs) || walkMin == null) {
      return { tone: 'unknown', text: '公車即時資訊尚未提供，無法估算裕度' };
    }
    const slack = Math.round((busMs - trainMs) / 60000) - walkMin - SAFETY_BUFFER_MIN;
    if (slack >= 5) return { tone: 'ok', text: `預估有 ${slack} 分鐘裕度` };
    if (slack >= 0) return { tone: 'tight', text: `轉乘時間偏緊，預估裕度約 ${slack} 分` };
    return { tone: 'miss', text: '目前看來可能接不上' };
  }

  function slackOf(route, trainEta) {
    const walkMin = route.access && Number.isFinite(route.access.estimatedWalkMin) ? route.access.estimatedWalkMin : null;
    const headway = route.service && Number.isFinite(route.service.headwayMin) ? route.service.headwayMin : null;
    const lines = [];
    if (walkMin == null) {
      lines.push({ cls: 'btu-slack', text: '無法估算：缺站牌位置，算不出步行時間' });
    } else if (headway == null) {
      lines.push({ cls: 'btu-slack', text: `抵達後步行約 ${walkMin} 分到站牌；此路線未提供班距，無法估算等候` });
    } else {
      const avg = Math.ceil(headway / 2);
      lines.push({ cls: 'btu-slack', text: `抵達後步行約 ${walkMin} 分到站牌` });
      lines.push({ cls: 'btu-sec', text: `此路線約每 ${headway} 分一班，平均等候約 ${avg} 分、最壞 ${headway} 分` });
    }
    // 抵達時刻已過末班：這是使用者最需要提前知道的一件事。
    const lastBus = route.service && route.service.lastBus;
    const clock = clockText(trainEta && trainEta.arrivalAt);
    if (lastBus && clock && String(clock) > String(lastBus)) {
      lines.push({ cls: 'btu-caveat', text: `你預估 ${clock} 抵達，已晚於這條路線的末班 ${esc(lastBus)}` });
    }
    return lines;
  }

  function renderSlackRoute(route, stationPosition, trainEta) {
    const { name, sub } = routeLabel(route);
    const verdict = slackVerdict(route, trainEta);
    const lines = slackOf(route, trainEta);
    return `<div class="btu-row"><div class="btu-plan">
<span class="btu-route">${esc(name)}${sub ? `<span class="btu-sub">${esc(sub)}</span>` : ''}${route.headsign ? `<span class="btu-sub">往 ${esc(route.headsign)}</span>` : ''}</span>
<span class="btu-verdict btu-v-${verdict.tone}">${esc(verdict.text)}</span>
${lines.map(line => `<span class="${line.cls}">${line.text}</span>`).join('')}
<span class="btu-caveat">依目前狀況推估，仍可能變動；不保證接得上；未計月台到出口的站內步行。</span>
${navLink(route.boardStopPosition, false, stationPosition, route.boardStopName)}
</div></div>`;
  }

  function renderApproachingBody(instance, view) {
    if (instance.assistant) {
      const dataState = stationData(instance.stationId);
      const lead = renderTrainEta(instance.trainEta);
      if (dataState.status === 'idle') {
        return `${lead}<div class="btu-msg">${esc(tr('已設定本站轉乘；抵達前 15 分鐘才開始查公車動態。'))}</div>${renderWalkNote()}`;
      }
      return `${lead}<div class="btu-meta"><span>${esc(tr('依列車抵達、站外步行與公車到站時間保守估算'))}</span></div>
${renderLivePanel(instance, view)}${renderAssistantShare(instance)}${renderWalkNote()}`;
    }
    const plan = instance.plan;
    const routes = plan && Array.isArray(plan.routes) ? plan.routes : [];
    const position = plan && plan.stationPosition || null;
    const body = routes.length
      ? `<div class="btu-list">${routes.slice(0, 3).map(route => renderSlackRoute(route, position, instance.trainEta)).join('')}</div>
${routes.length > 3 ? `<button type="button" class="btu-summary" data-btu-act="plan">其餘 ${routes.length - 3} 條候選路線<span class="btu-caret" aria-hidden="true">${view.planOpen ? '收合' : '展開'}</span></button>` : ''}
${view.planOpen && routes.length > 3 ? `<div class="btu-list">${routes.slice(3).map(route => renderSlackRoute(route, position, instance.trainEta)).join('')}</div>` : ''}`
      : '<div class="btu-msg">這一段沒有候選公車路線可估算銜接裕度。</div>';
    return `${renderTrainEta(instance.trainEta)}
<div class="btu-meta"><span>裕度由班距推估，不是此刻的公車倒數</span></div>
${body}
${renderWalkNote()}`;
  }

  // ── 已抵達：即時面板 ─────────────────────────────────────────────
  function renderEta(arrival) {
    const live = arrival.live || {};
    const spec = N1_STATE[live.state] || N1_STATE.unknown;
    // stale 一律不顯示倒數數字。過期的資料拿來當即時倒數是這個模組最不能犯的錯。
    if (live.state === 'stale') return { tone: 'stale', text: tr('資料已過期') };
    if (live.state === 'countdown' || live.state === 'arriving' || live.state === 'scheduled') {
      return { tone: spec.tone, text: etaText(live.etaSec) };
    }
    return { tone: spec.tone, text: spec.label ? tr(spec.label) : '—' };
  }

  function renderArrivalRow(arrival, station, fetchedAt, openLegs, trainEta) {
    const live = arrival.live || {};
    const spec = N1_STATE[live.state] || N1_STATE.unknown;
    const eta = renderEta(arrival);
    const { name, sub } = routeLabel(arrival);
    const age = liveAge(live.ageSec, fetchedAt);
    const open = openLegs.has(arrival.key);
    const selected = !!(journeyValue() && journeyValue().stationId === station.id && journeyValue().arrivalKey === arrival.key);

    const lines = [];
    if (live.state === 'stale') {
      const srcSpec = N1_STATE[live.sourceState] || N1_STATE.unknown;
      const srcText = live.sourceState === 'countdown' || live.sourceState === 'arriving' || live.sourceState === 'scheduled'
        ? tr('過期前為倒數 {eta}', { eta: etaText(live.etaSec) })
        : tr('過期前狀態為「{state}」', { state: srcSpec.label ? tr(srcSpec.label) : live.sourceState });
      const staleSec = live.staleAfterSec || STALE_LABEL_SEC;
      lines.push({ cls: 'btu-opt', text: tr('{state}；超過 {seconds} 秒未更新，不作為即時資訊。', { state: srcText, seconds: staleSec }) });
      lines.push({ cls: 'btu-tight', text: tr('超過 {seconds} 秒未更新，不作為即時資訊', { seconds: staleSec }) });
    } else if (spec.note) {
      lines.push({ cls: 'btu-opt', text: tr(spec.note) });
    }
    const walk = renderAccess(arrival.access);
    const stopName = esc(arrival.stopName || tr('站牌'));
    lines.push({ cls: 'btu-opt', text: `${stopName}・${walk.full}` });
    lines.push({ cls: 'btu-tight', text: `${stopName}・${walk.tight}` });
    if (arrival.headsign) lines.push({ cls: '', text: tr('往 {destination}', { destination: esc(arrival.headsign) }) });

    const connection = trainEta ? liveConnectionVerdict(arrival, trainEta, fetchedAt) : null;

    const tags = [];
    if (live.state === 'stale') tags.push(`<span class="btu-tag btu-warn">${esc(tr('過期'))}</span>`);
    if (arrival.occupancy && arrival.occupancy.state === 'not_loaded') {
      tags.push(`<span class="btu-tag btu-opt">${esc(tr(OCCUPANCY.not_loaded))}</span>`);
    } else if (arrival.occupancy && arrival.occupancy.state === 'not_provided') {
      // not_provided 是資料品質事實，任何密度下都不隱藏。
      tags.push(`<span class="btu-tag">${esc(tr(OCCUPANCY.not_provided))}</span>`);
    }
    if (arrival.routeMatch && arrival.routeMatch !== 'exact') {
      tags.push(`<span class="btu-tag btu-opt">${esc(tr('路線比對非精確'))}</span>`);
    }
    if (selected) tags.unshift(`<span class="btu-tag btu-navy">${esc(tr('接續旅程'))}</span>`);

    return `<div class="btu-row">
<button type="button" class="btu-rowbtn" data-btu-act="leg" data-btu-arrival="${esc(arrival.key)}" aria-expanded="${open ? 'true' : 'false'}">
<span class="btu-eta btu-t-${eta.tone}">${esc(eta.text)}</span>
<span class="btu-main">
<span class="btu-route">${esc(name)}${sub ? `<span class="btu-sub">${esc(sub)}</span>` : ''}</span>
${connection ? `<span class="btu-verdict btu-v-${connection.tone}">${esc(connection.text)}</span>` : ''}
${lines.map(line => `<span class="btu-sec${line.cls ? ` ${line.cls}` : ''}">${line.text}</span>`).join('')}
<span class="btu-age">${esc(ageText(age))}</span>
${tags.length ? `<span class="btu-tags">${tags.join('')}</span>` : ''}
</span>
<span class="btu-rowcaret" aria-hidden="true">${esc(tr(selected ? '已選' : (open ? '收合' : '跟車')))}</span>
</button>
${open ? renderLeg(station.id, arrival) : ''}
</div>`;
  }

  function renderVehicle(vehicle) {
    const bindingText = tr(VEHICLE_BINDING[vehicle.binding] || vehicle.binding);
    // route_candidate_unidentified 沒有車牌。這裡絕不用索引、GPS 或任何推導值假造車號。
    const head = vehicle.plate
      ? `<span class="btu-plate">${esc(vehicle.plate)}</span>`
      : `<span class="btu-noplate">${esc(tr('此車未提供車牌'))}</span>`;

    const lines = [];
    const progress = vehicle.progress || {};
    if (progress.state === 'approaching' && progress.stopsBefore != null) {
      lines.push(progress.stopsBefore === 0 ? tr('已到你要上車的站') : tr('還差 {n} 站到你要上車的站', { n: progress.stopsBefore }, progress.stopsBefore));
    } else if (progress.state === 'passed') {
      lines.push(tr('已駛過你要上車的站'));
    } else {
      lines.push(tr('停站進度未知（來源未提供或站序無法對上）'));
    }
    if (progress.currentStopName) lines.push(tr('最近回報位置：{stop}', { stop: esc(progress.currentStopName) }));
    if (!vehicle.inService) lines.push(tr('這台車目前未在營運狀態'));

    const occ = vehicle.occupancy || { state: 'not_provided' };
    const occText = occ.state === 'available'
      ? tr(OCCUPANCY.available[occ.level] || '擁擠度不明')
      : tr(OCCUPANCY[occ.state] || '擁擠度不明');

    const tags = [
      `<span class="btu-tag${vehicle.binding === 'n1_plate_verified' ? ' btu-navy' : ''}">${esc(bindingText)}</span>`,
      `<span class="btu-tag${occ.state === 'available' ? '' : ' btu-warn'}">${esc(occText)}</span>`,
    ];
    if (!vehicle.fresh) tags.push(`<span class="btu-tag btu-warn">${esc(tr('定位過期'))}</span>`);

    return `<div class="btu-veh">
${head}
${lines.map(line => `<span class="btu-sec">${line}</span>`).join('')}
<span class="btu-age">${esc(tr('定位 {age}', { age: ageText(vehicle.ageSec) }))}</span>
<span class="btu-tags">${tags.join('')}</span>
</div>`;
  }

  function renderJourney(instance) {
    const journey = journeyValue();
    if (!journey || journey.stationId !== instance.stationId) return '';
    const station = stationData(journey.stationId);
    const arrival = station.data && Array.isArray(station.data.arrivals)
      ? station.data.arrivals.find(row => row.key === journey.arrivalKey) : null;
    const leg = legData(journey.stationId, journey.arrivalKey);
    const vehicles = leg.data && Array.isArray(leg.data.vehicles) ? leg.data.vehicles : [];
    // 沒有官方車牌綁定時不得拿同路線候選的第一台冒充使用者搭的車；寧可不算剩餘站數。
    const vehicle = journey.plate
      ? vehicles.find(item => String(item.plate || '') === String(journey.plate)) || null
      : (vehicles.find(item => item.binding === 'n1_plate_verified') || null);
    const route = journey.routeName || (arrival && arrival.routeName) || tr('公車');
    const alight = journey.alightStop && journey.alightStop.stopName;
    const board = journey.boardStop && journey.boardStop.stopName;
    const lines = [];
    if (journey.phase === 'waiting') {
      let eta = arrival ? renderEta(arrival).text : null;
      if (!arrival && journey.expectedAt) {
        const remainSec = Math.round((Date.parse(journey.expectedAt) - Date.now()) / 1000);
        eta = Number.isFinite(remainSec) && remainSec >= -120
          ? etaText(remainSec)
          : tr('原預估已過，請重新查詢');
      }
      lines.push(tr('在 {stop} 等車{eta}', { stop: board || tr('上車站'), eta: eta ? `・${eta}` : '' }));
      lines.push(tr('下車：{stop}', { stop: alight || tr('尚未設定') }));
      if (journey.plate) lines.push(tr('已對上車牌 {plate}', { plate: journey.plate }));
      else lines.push(tr('尚未確認車牌，上車前請再核對路線與方向'));
    } else {
      const current = vehicle && vehicle.progress && vehicle.progress.currentStopSequence;
      const target = journey.alightStop && journey.alightStop.stopSequence;
      const remaining = Number.isFinite(current) && Number.isFinite(target) ? target - current : null;
      if (remaining != null && remaining > 0) lines.push(tr('距 {stop} 還有 {n} 站', { stop: alight, n: remaining }, remaining));
      else if (remaining === 0) lines.push(tr('已到 {stop}，請準備下車', { stop: alight }));
      else if (remaining != null && remaining < 0) lines.push(tr('車輛回報已駛過 {stop}', { stop: alight }));
      else lines.push(tr('往 {stop} 行駛中；目前無法算剩餘站數', { stop: alight || tr('下車站') }));
      if (vehicle && vehicle.progress && vehicle.progress.currentStopName) {
        lines.push(tr('最近回報位置：{stop}', { stop: vehicle.progress.currentStopName }));
      }
    }
    const shareLabel = global.__railJourneyShareActive ? tr('分享中・管理') : tr('分享這段旅程');
    const buttons = journey.phase === 'waiting'
      ? `<button type="button" class="btu-jbtn primary" data-btu-act="journey-board">${esc(tr('我上車了'))}</button>
<button type="button" class="btu-jbtn" data-btu-act="journey-refresh">${esc(tr('重新查詢'))}</button>
<button type="button" class="btu-jbtn" data-btu-act="journey-share">${esc(shareLabel)}</button>
<button type="button" class="btu-jbtn danger" data-btu-act="journey-cancel">${esc(tr('取消接續'))}</button>`
      : `<button type="button" class="btu-jbtn primary" data-btu-act="journey-complete">${esc(tr('我下車了'))}</button>
<button type="button" class="btu-jbtn" data-btu-act="journey-update">${esc(tr('更新車況'))}</button>
<button type="button" class="btu-jbtn" data-btu-act="journey-share">${esc(shareLabel)}</button>`;
    return `<section class="btu-journey" aria-label="${esc(tr('接續旅程'))}">
<div class="btu-journeytop"><span class="btu-journeyphase">${esc(tr(journey.phase === 'waiting' ? '等公車' : '公車行駛中'))}</span><b>${esc(route)}${journey.headsign ? `・${esc(tr('往 {destination}', { destination: journey.headsign }))}` : ''}</b></div>
${lines.map(line => `<span class="btu-journeyline">${esc(line)}</span>`).join('')}
<div class="btu-journeyactions">${buttons}</div>
</section>`;
  }

  function renderJourneyPicker(stationId, arrival, leg) {
    const active = journeyValue();
    if (active && active.stationId === stationId && active.arrivalKey === arrival.key) return '';
    if (leg.routeStatus === 'loading') return `<div class="btu-picker"><div class="btu-skel">${esc(tr('正在載入這一路的下車站…'))}</div></div>`;
    if (leg.routeStatus === 'error') return `<div class="btu-picker"><div class="btu-msg btu-err">${esc(tr('暫時無法取得這一路的完整站序，請稍後重試。'))}</div>
<button type="button" class="btu-jbtn" data-btu-act="journey-pick" data-btu-arrival="${esc(arrival.key)}">${esc(tr('重試'))}</button></div>`;
    if (leg.routeStatus !== 'ready' || !leg.routeData) {
      return `<div class="btu-picker"><button type="button" class="btu-jbtn primary" data-btu-act="journey-pick" data-btu-arrival="${esc(arrival.key)}">${esc(tr('接續這班'))}</button></div>`;
    }
    const route = leg.routeData;
    if (route.state !== 'ready' || !Array.isArray(route.stops) || !route.stops.length) {
      const message = route.state === 'ambiguous'
        ? tr('這一路有多種不同站序，目前無法安全判定下車站。')
        : tr('這一路目前沒有可選的後續下車站。');
      return `<div class="btu-picker"><div class="btu-msg">${esc(message)}</div></div>`;
    }
    return `<div class="btu-picker">
<label>${esc(tr('選擇下車站'))}</label>
<select data-btu-role="alight" aria-label="${esc(tr('選擇下車站'))}">${route.stops.map(stop =>
      `<option value="${esc(stop.stopUid)}">${esc(stop.stopName)}</option>`).join('')}</select>
<div class="btu-pickeractions"><button type="button" class="btu-jbtn primary" data-btu-act="journey-start" data-btu-arrival="${esc(arrival.key)}">${esc(tr('開始接續旅程'))}</button>
<button type="button" class="btu-jbtn" data-btu-act="journey-pick-cancel">${esc(tr('取消'))}</button></div>
</div>`;
  }

  function renderLeg(stationId, arrival) {
    const leg = legData(stationId, arrival.key);
    if (leg.status === 'loading') return `<div class="btu-leg"><div class="btu-skel">${esc(tr('正在查這一路的車輛位置…'))}</div></div>`;
    if (leg.status === 'error') {
      return `<div class="btu-leg"><div class="btu-msg btu-err">${esc(tr('暫時無法取得這一路的車輛位置，請稍後重試。'))}
<button type="button" class="btu-retry" data-btu-act="leg-retry" data-btu-arrival="${esc(arrival.key)}">${esc(tr('重試'))}</button></div></div>`;
    }
    if (leg.status !== 'ready' || !leg.data) return '';

    const data = leg.data;
    const binding = data.binding || { state: 'candidate_set' };
    const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
    const sources = (data.live && Array.isArray(data.live.sources)) ? data.live.sources : [];
    // Worker 的正常即時來源用 live；fixtures 曾用 ok。兩者都不能被誤標為降級。
    const degraded = sources.filter(source => !['live', 'ok', 'available'].includes(source.state));

    const body = vehicles.length
      ? vehicles.map(renderVehicle).join('')
      : `<div class="btu-msg">${esc(tr('這一路目前沒有可用的車輛定位。沒有定位不等於沒有車，只代表來源這一刻沒回報。'))}</div>`;

    return `<div class="btu-leg">
<p class="btu-legbasis">${esc(tr(BINDING[binding.state] || binding.state))}</p>
${body}
${degraded.length ? `<p class="btu-legbasis">${esc(tr('來源降級：{sources}。以上進度可能不完整。', { sources: degraded.map(source => `${source.kind} ${source.state}`).join('、') }))}</p>` : ''}
<p class="btu-legbasis btu-opt">${esc(tr('此區塊只在你點開時查一次，不會自動更新。'))}</p>
${navLink(arrival.stopPosition, true, null, arrival.stopName)}
${renderJourneyPicker(stationId, arrival, leg)}
</div>`;
  }

  function renderLivePanel(instance, view) {
    const state = stationData(instance.stationId);
    if (state.status === 'loading') return `<div class="btu-skel">${esc(tr('正在查 {station} 附近的公車…', { station: instance.stationName }))}</div>`;
    if (state.status === 'error') {
      return `<div class="btu-msg btu-err">${esc(tr('暫時無法取得附近公車資訊，請稍後重試。'))}
<button type="button" class="btu-retry" data-btu-act="retry">${esc(tr('重試'))}</button></div>`;
    }
    if (state.status !== 'ready' || !state.data) return '';

    const data = state.data;
    const arrivals = Array.isArray(data.arrivals) ? data.arrivals : [];
    const shown = view.showAll ? arrivals : arrivals.slice(0, 3);
    const rest = arrivals.length - shown.length;
    const generatedAge = state.fetchedAt ? Math.round((Date.now() - state.fetchedAt) / 1000) : null;

    const meta = [];
    meta.push(esc(tr('查詢於 {age}', { age: ageText(generatedAge) })));
    if (data.live && data.live.cache === 'hit') meta.push(`<span class="btu-opt">${esc(tr('來源為邊緣快取'))}</span>`);
    if (data.live && data.live.state && !['live', 'no_nearby_stops'].includes(data.live.state)) {
      meta.push(esc(tr('來源狀態：{state}', { state: data.live.state })));
    }
    if (data.totals && data.totals.rejected) meta.push(`<span class="btu-opt">${esc(tr('{n} 筆來源資料不在目前靜態索引內，未顯示', { n: data.totals.rejected }, data.totals.rejected))}</span>`);

    const noNearbyStops = data.live && data.live.state === 'no_nearby_stops';
    const rows = arrivals.length
      ? shown.map(arrival => renderArrivalRow(arrival, data.station || { id: instance.stationId }, state.fetchedAt, view.openLegs,
          instance.assistant ? instance.trainEta : null)).join('')
      : noNearbyStops
        ? `<div class="btu-msg">${esc(tr('目前靜態索引在本站 600 公尺內沒有找到可用公車站牌，因此這次沒有發出即時查詢。你仍可改用地圖查看更遠的站牌。'))}</div>`
      : `<div class="btu-msg">${esc(tr('這一刻來源沒有回報任何本站附近的公車班次。這不代表沒有公車路線經過，只代表現在沒有可呈現的預估。'))}</div>`;

    return `<div class="btu-meta">${meta.map(item => `<span>${item}</span>`).join('')}</div>
<div class="btu-list">${rows}</div>
${rest > 0 ? `<button type="button" class="btu-more" data-btu-act="more">${esc(tr('再顯示其餘 {n} 筆', { n: rest }, rest))}</button>` : ''}
${view.showAll && arrivals.length > 3 ? `<button type="button" class="btu-more" data-btu-act="less">${esc(tr('只顯示最近三筆'))}</button>` : ''}
<button type="button" class="btu-retry" data-btu-act="retry">${esc(tr('重新查詢'))}</button>`;
  }

  function renderArrivedBody(instance, view) {
    const plan = instance.plan;
    const routes = plan && Array.isArray(plan.routes) ? plan.routes : [];
    const position = plan && plan.stationPosition || null;
    // 主操作在最前面：先看即時公車。導航只在使用者點開某一路線之後才出現（見 renderLeg）。
    const primary = instance.assistant ? ''
      : `<button type="button" class="btu-primary" data-btu-act="toggle" aria-expanded="${view.expanded ? 'true' : 'false'}">${esc(tr(view.expanded ? '收合即時公車' : '查看現在可搭公車'))}</button>`;
    const live = view.expanded ? renderLivePanel(instance, view) : '';
    // 前兩階降級成摘要，不消失也不搶版面。
    const summary = routes.length ? `<button type="button" class="btu-summary" data-btu-act="plan">轉乘規劃：${routes.length} 條候選路線與班表<span class="btu-caret" aria-hidden="true">${view.planOpen ? '收合' : '展開'}</span></button>
${view.planOpen ? `<div class="btu-list">${routes.map(route => renderPlanRoute(route, position, true)).join('')}</div>` : ''}` : '';
    return `${primary}${live}${summary}${renderWalkNote()}`;
  }

  // ── 渲染 ─────────────────────────────────────────────────────────
  function render(instance) {
    if (!instance.root || !instance.root.isConnected) return;
    // 密度在每次渲染重算（mount、使用者互動、容器改寬）。不是 timer，也不發請求。
    instance.density = densityOf(instance.root);
    instance.root.setAttribute('data-btu-density', instance.density);
    instance.root.setAttribute('data-btu-phase', instance.phase);
    const view = viewState(instance.viewKey);
    const body = instance.phase === 'planning' ? renderPlanBody(instance, view)
      : instance.phase === 'approaching' ? renderApproachingBody(instance, view)
      : renderArrivedBody(instance, view);
    instance.root.innerHTML = `<div class="btu-card">
${renderPhaseBar(instance.phase)}
${renderHead(instance.phase, instance.stationName)}
${renderJourney(instance)}
${body}
</div>`;
  }

  function sweepDisconnectedInstances() {
    for (const instance of [...INSTANCES]) {
      if (!instance.root || !instance.root.isConnected) {
        // renderBoardBody 會直接換掉整段 innerHTML，舊 root 不一定有機會收到 unmount。
        // 這裡把 ResizeObserver 與 listener 一併拆掉，避免已斷線節點被長期保留。
        if (instance.root) instance.root.removeEventListener('click', instance.handler);
        if (instance.observer) instance.observer.disconnect();
        INSTANCES.delete(instance);
      }
    }
  }

  function renderAll(viewKey) {
    sweepDisconnectedInstances();
    for (const instance of [...INSTANCES]) {
      if (!viewKey || instance.viewKey === viewKey) render(instance);
    }
  }

  // ── 取得資料（只在使用者動作時呼叫，且只有 arrived 階段有動作可觸發）──
  async function request(instance, url, signal) {
    const response = await instance.fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = body && (body.error || body.message);
      throw new Error(reason || `HTTP ${response.status}`);
    }
    return body;
  }

  function rememberRequestError(target, label, error) {
    const detail = error && error.message ? error.message : String(error);
    // 診斷資訊只留在記憶體與 console；畫面一律使用固定、可翻譯的友善文案。
    target.error = detail;
    if (global.console && typeof global.console.warn === 'function') {
      global.console.warn(`[BusTransferUI] ${label} request failed`, error);
    }
  }

  function loadStation(instance) {
    const state = stationData(instance.stationId);
    // DOM 重建後的 mount 不會走到這裡；只有使用者明示展開／重試才會呼叫。
    // 同一份資料 20 秒內重用，超過後下一次使用者展開才刷新。
    const fresh = state.fetchedAt && Date.now() - state.fetchedAt < QUERY_REFRESH_AFTER_SEC * 1000;
    if (state.status === 'ready' && state.data && fresh) return Promise.resolve(state.data);
    if (state.inflight) return state.inflight;

    state.status = 'loading';
    state.error = null;
    const controller = new AbortController();
    state.controller = controller;
    const url = `${instance.apiBase}/api/bus-transfer?station=${encodeURIComponent(instance.stationId)}`;
    state.inflight = request(instance, url, controller.signal).then(data => {
      state.status = 'ready';
      state.data = data;
      state.fetchedAt = Date.now();
      return data;
    }).catch(error => {
      if (error && error.name === 'AbortError') { state.status = 'idle'; return null; }
      state.status = 'error';
      rememberRequestError(state, 'station', error);
      return null;
    }).finally(() => {
      if (state.controller === controller) {
        state.inflight = null;
        state.controller = null;
      }
      renderAll();
    });
    renderAll();
    return state.inflight;
  }

  function loadLeg(instance, arrivalKey) {
    const leg = legData(instance.stationId, arrivalKey);
    const fresh = leg.fetchedAt && Date.now() - leg.fetchedAt < QUERY_REFRESH_AFTER_SEC * 1000;
    if (leg.status === 'ready' && leg.data && fresh) return Promise.resolve(leg.data);
    if (leg.inflight) return leg.inflight;

    leg.status = 'loading';
    leg.error = null;
    const controller = new AbortController();
    leg.controller = controller;
    const url = `${instance.apiBase}/api/bus-leg-live?station=${encodeURIComponent(instance.stationId)}&arrival=${encodeURIComponent(arrivalKey)}`;
    leg.inflight = request(instance, url, controller.signal).then(data => {
      leg.status = 'ready';
      leg.data = data;
      leg.fetchedAt = Date.now();
      const journey = journeyValue();
      if (journey && journey.stationId === instance.stationId && journey.arrivalKey === arrivalKey) {
        const snapshot = exactJourneyVehicle(journey, data);
        if (snapshot && JSON.stringify(snapshot) !== JSON.stringify(journey.vehicle || null)) {
          writeJourney({ ...journey, vehicle: snapshot }, 'vehicle-updated');
        }
      }
      return data;
    }).catch(error => {
      if (error && error.name === 'AbortError') { leg.status = 'idle'; return null; }
      leg.status = 'error';
      rememberRequestError(leg, 'leg', error);
      return null;
    }).finally(() => {
      if (leg.controller === controller) {
        leg.inflight = null;
        leg.controller = null;
      }
      renderAll();
    });
    renderAll();
    return leg.inflight;
  }

  function loadRouteStops(instance, arrivalKey) {
    const leg = legData(instance.stationId, arrivalKey);
    if (leg.routeStatus === 'ready' && leg.routeData) return Promise.resolve(leg.routeData);
    if (leg.routeInflight) return leg.routeInflight;
    leg.routeStatus = 'loading';
    leg.routeError = null;
    const controller = new AbortController();
    leg.routeController = controller;
    const url = `${instance.apiBase}/api/bus-route-stops?station=${encodeURIComponent(instance.stationId)}&arrival=${encodeURIComponent(arrivalKey)}`;
    leg.routeInflight = request(instance, url, controller.signal).then(data => {
      leg.routeStatus = 'ready';
      leg.routeData = data;
      return data;
    }).catch(error => {
      if (error && error.name === 'AbortError') { leg.routeStatus = 'idle'; return null; }
      leg.routeStatus = 'error';
      rememberRequestError(leg, 'route', error);
      leg.routeError = leg.error;
      return null;
    }).finally(() => {
      if (leg.routeController === controller) {
        leg.routeInflight = null;
        leg.routeController = null;
      }
      renderAll();
    });
    renderAll();
    return leg.routeInflight;
  }

  function refreshJourney(instance) {
    const journey = journeyValue();
    if (!journey || journey.stationId !== instance.stationId) return;
    const state = stationData(instance.stationId);
    const leg = legData(instance.stationId, journey.arrivalKey);
    state.fetchedAt = 0;
    leg.fetchedAt = 0;
    loadStation(instance).then(data => {
      if (!data || !Array.isArray(data.arrivals) || !data.arrivals.some(row => row.key === journey.arrivalKey)) return;
      loadLeg(instance, journey.arrivalKey);
    });
  }

  function exactJourneyVehicle(journey, data) {
    if (!journey || !data || !Array.isArray(data.vehicles)) return null;
    const plate = String(journey.plate || (data.binding && data.binding.state === 'exact_n1_plate' && data.binding.plate) || '');
    if (!plate) return null;
    const vehicle = data.vehicles.find(item => item && item.binding === 'n1_plate_verified' && String(item.plate || '') === plate);
    if (!vehicle || !vehicle.position || !Number.isFinite(vehicle.position.lat) || !Number.isFinite(vehicle.position.lon)) return null;
    const at = Date.parse(vehicle.gpsAt || '');
    if (!Number.isFinite(at)) return null;
    return { lat: vehicle.position.lat, lon: vehicle.position.lon, at, label: plate };
  }

  // ── 事件（單一 delegated listener，只綁在 root 上）────────────────
  function onClick(instance, event) {
    const target = event.target && event.target.closest ? event.target.closest('[data-btu-act]') : null;
    if (!target || !instance.root.contains(target)) return;   // 導航連結沒有 data-btu-act，走瀏覽器原生開新視窗
    event.preventDefault();
    event.stopPropagation();   // 不讓點擊冒泡到 .board 既有的 row handler
    const act = target.getAttribute('data-btu-act');
    const view = viewState(instance.viewKey);
    const arrivalKey = target.getAttribute('data-btu-arrival');

    if (act === 'toggle') {
      // 只有 arrived 階段有這顆鈕，所以整個模組唯一的第一支 API 觸發點就在這裡。
      view.expanded = !view.expanded;
      render(instance);
      if (view.expanded) loadStation(instance);
      return;
    }
    if (act === 'plan') { view.planOpen = !view.planOpen; render(instance); return; }
    if (act === 'more') { view.showAll = true; render(instance); return; }
    if (act === 'less') { view.showAll = false; render(instance); return; }
    if (act === 'retry') {
      const state = stationData(instance.stationId);
      state.status = 'idle'; state.data = null; state.error = null; state.legs.clear();
      view.openLegs.clear();
      loadStation(instance);
      return;
    }
    if (act === 'leg' && arrivalKey) {
      if (view.openLegs.has(arrivalKey)) { view.openLegs.delete(arrivalKey); render(instance); return; }
      view.openLegs.add(arrivalKey);
      render(instance);
      loadLeg(instance, arrivalKey);   // 點某一路線才發第二支 API
      return;
    }
    if (act === 'leg-retry' && arrivalKey) {
      const leg = legData(instance.stationId, arrivalKey);
      leg.status = 'idle'; leg.data = null; leg.error = null;
      loadLeg(instance, arrivalKey);
      return;
    }
    if (act === 'journey-pick' && arrivalKey) {
      loadRouteStops(instance, arrivalKey);
      return;
    }
    if (act === 'journey-pick-cancel') {
      if (arrivalKey) {
        const leg = legData(instance.stationId, arrivalKey);
        leg.routeStatus = 'idle'; leg.routeData = null; leg.routeError = null;
      } else {
        for (const leg of stationData(instance.stationId).legs.values()) {
          if (leg.routeStatus === 'ready') { leg.routeStatus = 'idle'; leg.routeData = null; }
        }
      }
      render(instance);
      return;
    }
    if (act === 'journey-start' && arrivalKey) {
      const state = stationData(instance.stationId);
      const arrival = state.data && Array.isArray(state.data.arrivals)
        ? state.data.arrivals.find(row => row.key === arrivalKey) : null;
      const leg = legData(instance.stationId, arrivalKey);
      const select = target.closest('.btu-picker') && target.closest('.btu-picker').querySelector('[data-btu-role="alight"]');
      const alight = leg.routeData && Array.isArray(leg.routeData.stops)
        ? leg.routeData.stops.find(stop => stop.stopUid === (select && select.value)) : null;
      if (!arrival || !alight) return;
      const exactPlate = leg.data && leg.data.binding && leg.data.binding.state === 'exact_n1_plate'
        ? leg.data.binding.plate : null;
      const etaSec = arrival.live && Number.isFinite(arrival.live.etaSec) ? arrival.live.etaSec : null;
      const expectedAt = etaSec != null && state.fetchedAt
        ? new Date(state.fetchedAt + etaSec * 1000).toISOString() : null;
      writeJourney({
        id: `${instance.stationId}|${arrivalKey}|${Date.now()}`,
        stationId: instance.stationId,
        stationName: instance.stationName,
        arrivalKey,
        routeName: arrival.routeName || '',
        subRouteName: arrival.subRouteName || '',
        headsign: arrival.headsign || '',
        boardStop: { stopUid: arrival.stopUid, stopName: arrival.stopName, stopSequence: arrival.stopSequence,
          position: arrival.stopPosition || null },
        alightStop: alight,
        phase: 'waiting',
        plate: exactPlate || null,
        vehicle: exactJourneyVehicle({ plate: exactPlate }, leg.data),
        expectedAt,
        originTrainKey: instance.journeyContext && instance.journeyContext.trainKey || null,
        originRail: instance.journeyContext && instance.journeyContext.rail || null,
        createdAt: Date.now(),
      }, 'started');
      return;
    }
    if (act === 'journey-board') {
      const journey = journeyValue();
      if (!journey || journey.stationId !== instance.stationId) return;
      const leg = legData(journey.stationId, journey.arrivalKey);
      const exactPlate = leg.data && leg.data.binding && leg.data.binding.state === 'exact_n1_plate'
        ? leg.data.binding.plate : journey.plate;
      writeJourney({ ...journey, phase: 'aboard', plate: exactPlate || null,
        vehicle: exactJourneyVehicle({ ...journey, plate: exactPlate }, leg.data) || journey.vehicle || null,
        boardedAt: Date.now() }, 'boarded');
      return;
    }
    if (act === 'journey-share') {
      try { global.dispatchEvent(new CustomEvent('rail-bus-journey-share-request', {
        detail: { journey: journeyValue(), context: instance.journeyContext || null },
      })); } catch (error) {}
      return;
    }
    if (act === 'journey-refresh' || act === 'journey-update') { refreshJourney(instance); return; }
    if (act === 'journey-cancel') { writeJourney(null, 'cancelled'); return; }
    if (act === 'journey-complete') {
      writeJourney(null, 'completed');
    }
  }

  // ── 公開 API ─────────────────────────────────────────────────────
  function mount(options) {
    const opts = options || {};
    const root = opts.root;
    const stationId = opts.stationId;
    if (!root || !root.nodeType) throw new Error('BusTransferUI.mount 需要 root 元素');
    if (!stationId) throw new Error('BusTransferUI.mount 需要 stationId');
    if (!isSupportedStationId(stationId)) return null;
    if (typeof opts.translate === 'function') translateImpl = opts.translate;
    // 即使資料已在快取、這輪不會有 request/finally，仍在每次看板重建時回收舊 root。
    sweepDisconnectedInstances();

    const phase = PHASES.indexOf(opts.phase) >= 0 ? opts.phase : 'planning';
    const viewKey = opts.viewKey || `${stationId}|${phase === 'arrived' ? 'arrived' : 'journey'}`;

    // 冪等：同一個 root 已經 mount 過同一站同一 viewKey 時，只更新行程輸入並重繪，不重取。
    // phase 前進就是走這條路——呼叫者用新的 phase 再 mount 一次即可。
    const existing = root.__btuInstance;
    if (existing && existing.stationId === stationId && existing.viewKey === viewKey) {
      existing.phase = phase;
      if (opts.plan !== undefined) existing.plan = opts.plan;
      if (opts.trainEta !== undefined) existing.trainEta = opts.trainEta;
      if (opts.assistant !== undefined) existing.assistant = !!opts.assistant;
      if (opts.journeyContext !== undefined) existing.journeyContext = opts.journeyContext;
      if (opts.onJourneyChange !== undefined) existing.onJourneyChange = opts.onJourneyChange;
      if (opts.stationName) existing.stationName = opts.stationName;
      render(existing);
      return existing;
    }
    if (existing) unmount(root);

    ensureStyles(root.ownerDocument || document);
    root.classList.add('btu-root');

    const instance = {
      root,
      stationId,
      stationName: opts.stationName || stationId,
      phase,
      plan: opts.plan || null,
      trainEta: opts.trainEta || null,
      assistant: !!opts.assistant,
      journeyContext: opts.journeyContext || null,
      onJourneyChange: typeof opts.onJourneyChange === 'function' ? opts.onJourneyChange : null,
      requestKeys: new Set(),
      viewKey,
      apiBase: opts.apiBase != null ? String(opts.apiBase).replace(/\/$/, '') : API_BASE,
      fetchImpl: opts.fetchImpl || ((...args) => global.fetch(...args)),
      handler: null,
      observer: null,
      densityPending: false,
      density: 'full',
    };
    instance.handler = event => onClick(instance, event);
    root.addEventListener('click', instance.handler);
    // 容器寬度或字級改變時重算密度。layout 事件驅動，不是輪詢，也永遠不發請求。
    // 重繪必須推出 callback（在裡面同步改寫被觀測元素的 innerHTML 會被判定為 resize loop
    // 而丟掉後續通知），但不能用 requestAnimationFrame：文件隱藏時（背景分頁、列印、
    // 預覽偵測）瀏覽器不跑 rAF，那等於整條路徑死掉。microtask 在隱藏文件下照跑。
    if (typeof global.ResizeObserver === 'function') {
      instance.observer = new global.ResizeObserver(() => {
        if (instance.densityPending) return;
        instance.densityPending = true;
        Promise.resolve().then(() => {
          try {
            if (!instance.root || !instance.root.isConnected) return;
            if (densityOf(instance.root) !== instance.density) render(instance);
          } finally {
            instance.densityPending = false;   // finally：旗標永遠不可能卡住
          }
        });
      });
      instance.observer.observe(root);
    }
    root.__btuInstance = instance;
    INSTANCES.add(instance);
    render(instance);   // mount 只畫當前階段的靜態內容，不發任何請求
    return instance;
  }

  function unmount(root) {
    const instance = root && root.__btuInstance;
    if (!instance) return false;
    root.removeEventListener('click', instance.handler);
    if (instance.observer) instance.observer.disconnect();
    // 請求屬於 station／arrival 共用 store，不屬於某一塊 DOM。看板重繪卸載一個
    // instance 時不得把另一張卡共用中的請求取消；真正離開車站由 reset() 中止。
    INSTANCES.delete(instance);
    delete root.__btuInstance;
    root.classList.remove('btu-root');
    root.removeAttribute('data-btu-density');
    root.removeAttribute('data-btu-phase');
    root.innerHTML = '';
    return true;
  }

  function getState(stationId) {
    const views = [...VIEW.entries()].filter(([key]) => key.startsWith(`${stationId}|`));
    const state = DATA.get(stationId);
    const phases = [...INSTANCES].filter(instance => instance.stationId === stationId).map(instance => instance.phase);
    return {
      stationId,
      supported: isSupportedStationId(stationId),
      phases,
      expanded: views.some(([, view]) => view.expanded),
      views: views.map(([key, view]) => ({ viewKey: key, expanded: view.expanded, showAll: view.showAll, planOpen: view.planOpen, openLegs: [...view.openLegs] })),
      status: state ? state.status : 'idle',
      fetchedAt: state ? state.fetchedAt : 0,
      arrivals: state && state.data && Array.isArray(state.data.arrivals) ? state.data.arrivals.length : 0,
      openLegs: [...new Set(views.flatMap(([, view]) => [...view.openLegs]))],
      legStatuses: state ? [...state.legs.entries()].map(([key, leg]) => ({ key, status: leg.status })) : [],
      journey: journeyValue(),
    };
  }

  function abortState(state) {
    if (!state) return;
    try { if (state.controller) state.controller.abort(); } catch (error) { /* 已中止 */ }
    for (const leg of state.legs ? state.legs.values() : []) {
      try { if (leg.controller) leg.controller.abort(); } catch (error) { /* 已中止 */ }
      try { if (leg.routeController) leg.routeController.abort(); } catch (error) { /* 已中止 */ }
    }
  }

  // 站被切換／行程結束時由呼叫者丟掉快取；這是事件驅動，不是 timer。
  function reset(stationId) {
    if (stationId) {
      abortState(DATA.get(stationId));
      DATA.delete(stationId);
      for (const key of [...VIEW.keys()]) if (key.startsWith(`${stationId}|`)) VIEW.delete(key);
    } else {
      for (const state of DATA.values()) abortState(state);
      DATA.clear(); VIEW.clear();
    }
    renderAll();
  }

  global.BusTransferUI = {
    VERSION,
    COVERAGE,
    PHASES: [...PHASES],
    isSupported: isSupportedStationId,
    mount,
    unmount,
    // 已抵達階段的主操作（等同使用者按下「查看現在可搭公車」）。回傳 loadStation 的 promise；
    // 已展開或已有資料時回 null，不重打。
    openStation(root) {
      return this._expand(root);
    },
    // 轉乘助手的事件驅動刷新。requestKey 由宿主傳入 near-15／near-5／arrived；同一個里程碑
    // 無論 updateFollowPanel 跑多少幀都只會觸發一次。這不是背景輪詢，也不接受空 key。
    refresh(root, requestKey) {
      const instance = root && root.__btuInstance;
      const key = String(requestKey || '');
      if (!instance || !instance.assistant || !key || instance.requestKeys.has(key)) return null;
      instance.requestKeys.add(key);
      const view = viewState(instance.viewKey);
      view.expanded = true;
      render(instance);
      return loadStation(instance);
    },
    getState,
    getJourney() { return journeyValue(); },
    clearJourney() { return writeJourney(null, 'cleared'); },
    reset,
    walkUrl,
    // 測試用：不透過點擊也能驅動同一條路徑（仍然只在被呼叫時發請求）。
    _expand(root) {
      const instance = root && root.__btuInstance;
      if (!instance) return null;
      const view = viewState(instance.viewKey);
      if (view.expanded) return null;
      view.expanded = true;
      render(instance);
      return loadStation(instance);
    },
    _openLeg(root, arrivalKey) {
      const instance = root && root.__btuInstance;
      if (!instance || !arrivalKey) return null;
      const view = viewState(instance.viewKey);
      if (view.openLegs.has(arrivalKey)) return null;
      view.openLegs.add(arrivalKey);
      render(instance);
      return loadLeg(instance, arrivalKey);
    },
    _showAll(root, showAll) {
      const instance = root && root.__btuInstance;
      if (!instance) return false;
      viewState(instance.viewKey).showAll = showAll !== false;
      render(instance);
      return true;
    },
    _openPlan(root, open) {
      const instance = root && root.__btuInstance;
      if (!instance) return false;
      viewState(instance.viewKey).planOpen = open !== false;
      render(instance);
      return true;
    },
  };
  global.addEventListener('rail-journey-share-state', () => renderAll());
})(typeof window !== 'undefined' ? window : globalThis);
