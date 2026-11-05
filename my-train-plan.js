// 自製列車：排班用的純函式（車款表、名字、路線、站等、停站方式、跑時、時刻表）。
// 畫面與儲存在 my-train-ui.js，接進網頁的部分在 index.html 的 ownTrain 系列函式。
// 🔴 不碰 DOM、不碰 state、不碰 localStorage：只吃參數。Node 的守門腳本用 vm 直接跑這一份。
// 🔴 所有函式掛在 globalThis.MyTrainPlan，呼叫一律寫 MyTrainPlan.xxx(...)，模組內部也一樣。
//    隔離守門腳本在頁面載入前用計數替身包住 findRoute／buildRunStats，
//    直接呼叫區域函式的話替身包不到，「沒用這個功能的人零成本」就量不出來。
//    也因此這個物件不可以 Object.freeze。
(() => {
  'use strict';
  const TRA = 'tra_sched', HSR = 'thsr_sched', AFR = 'afr_sched';

  // ── 車款表──────────────────────────────────────────────
  // cls＝跑時類別。台鐵用 index.html PERF_RULES 第一個命中 carName 的那條 regex 的 source 字串；
  // 高鐵一律 'hsr'、林鐵一律 'afr'。index.html 的 ownTrainClassOf 產生同一個鍵空間。
  const CLS = {
    local: '電車|區間', jg: '莒光|復興', pk: '普快車|普通車', taroko: '\\(太', puyuma: '\\(普',
    pp: '\\(PP', emu3000: '\\(3000|110[KM]', dmu: '\\(D\\d', tc: '自強', hsr: 'hsr', afr: 'afr',
  };
  // 性能表那一列。數字抄自 index.html 的 PERF_RULES／PERF_HSR／PERF_DR1000；
  // scripts/verify_my_train_plan.mjs 會把那三個常數從 index.html 抽出來逐列比對，改了沒跟上就紅。
  const ROW = {
    local: { a: 2.5, b: 3.0, v: 120 }, dr1000: { a: 1.5, b: 2.448, v: 110 }, jg: { a: 1.5, b: 2.6, v: 120 },
    pk: { a: 1.3, b: 2.4, v: 100 }, taroko: { a: 1.88, b: 3.6, v: 135 }, puyuma: { a: 1.84, b: 3.6, v: 135 },
    pp: { a: 1.6, b: 2.8, v: 130 }, emu3000: { a: 2.52, b: 3.6, v: 135 }, dmu: { a: 1.5, b: 2.448, v: 110 },
    tc: { a: 1.8, b: 2.9, v: 130 }, hsr: { a: 1.4, b: 1.5, aAlt: 2.0, bAlt: 2.7, v: 300, coast: { c: 0.45, rho: 0.45 } },
    afr: { a: 0.7, b: 1.1, v: 45 },
  };
  // perf.v＝「那一列的 v」與「車款極速」取小；pushDown＝被往下壓。
  const model = (sys, cls, row, vmax) => {
    const perf = { a: row.a, b: row.b, v: Math.min(row.v, vmax) };
    if (row.aAlt != null) { perf.aAlt = row.aAlt; perf.bAlt = row.bAlt; }   // 高鐵：真車解不出來時的較硬加減速（PERF_HSR）
    if (row.coast) perf.coast = Object.freeze({ c: row.coast.c, rho: row.coast.rho });
    return Object.freeze({ sys, cls, perf: Object.freeze(perf), vmax, pushDown: vmax < row.v });
  };
  const MODELS = Object.freeze({
    dr1000: model(TRA, CLS.local, ROW.dr1000, 110),
    dr2700: model(TRA, CLS.local, ROW.local, 110),
    emu100: model(TRA, CLS.local, ROW.local, 120),
    emu1200: model(TRA, CLS.local, ROW.local, 120),
    emu500: model(TRA, CLS.local, ROW.local, 110),
    emu600: model(TRA, CLS.local, ROW.local, 110),
    emu700: model(TRA, CLS.local, ROW.local, 130),
    emu800: model(TRA, CLS.local, ROW.local, 130),
    emu800r: model(TRA, CLS.local, ROW.local, 130),
    emu900: model(TRA, CLS.local, ROW.local, 130),
    haifeng: model(TRA, CLS.local, ROW.local, 110),
    shanlan: model(TRA, CLS.local, ROW.local, 110),
    ck124: model(TRA, CLS.jg, ROW.jg, 85),
    ct273: model(TRA, CLS.jg, ROW.jg, 100),
    dt668: model(TRA, CLS.jg, ROW.jg, 85),
    e200: model(TRA, CLS.jg, ROW.jg, 110),
    e300: model(TRA, CLS.jg, ROW.jg, 110),
    e400: model(TRA, CLS.jg, ROW.jg, 110),
    r150: model(TRA, CLS.jg, ROW.jg, 110),
    r180: model(TRA, CLS.jg, ROW.jg, 110),
    r200: model(TRA, CLS.jg, ROW.jg, 110),
    blue: model(TRA, CLS.pk, ROW.pk, 100),
    dhl100: model(TRA, CLS.pk, ROW.pk, 75),
    r100: model(TRA, CLS.pk, ROW.pk, 100),
    r20: model(TRA, CLS.pk, ROW.pk, 100),
    temu1000: model(TRA, CLS.taroko, ROW.taroko, 135),
    temu2000: model(TRA, CLS.puyuma, ROW.puyuma, 135),
    e1000: model(TRA, CLS.pp, ROW.pp, 130),
    e500: model(TRA, CLS.pp, ROW.pp, 130),
    emu3000: model(TRA, CLS.emu3000, ROW.emu3000, 135),
    dr3100: model(TRA, CLS.dmu, ROW.dmu, 110),
    mingri: model(TRA, CLS.tc, ROW.tc, 130),
    '700t': model(HSR, CLS.hsr, ROW.hsr, 300),
    dl25: model(AFR, CLS.afr, ROW.afr, 45),
    dl38: model(AFR, CLS.afr, ROW.afr, 45),
    dl39: model(AFR, CLS.afr, ROW.afr, 45),
    dl45: model(AFR, CLS.afr, ROW.afr, 45),
  });

  // 車庫目錄的 family → 能不能開。目錄出現沒登記的 family 時回 'coach'（按不了），
  // 守門腳本另外斷言目錄裡每一個 family 都有登記，不會靜默漏掉。
  const FAMILY = {
    railcar: 'drivable', express: 'drivable', electric: 'drivable', hood: 'drivable', forestloco: 'drivable', steam: 'drivable',
    metro: 'metro', tram: 'metro', coach: 'coach', forestcoach: 'coach',
  };
  function familyStatus(family) { return FAMILY[family] || 'coach'; }

  // ── 車牌顏色（顏色只能選自己系統真車的色盤，不能用亮螢光色）───────────
  // 三個資料檔 .types 的 key/color 原文照抄；scripts/verify_my_train_plan.mjs 另外直接讀那三個
  // 資料檔逐一比對，不是拿這裡的常數當期望值。TRA 的鍵序＝表單色鈕由左到右的顯示順序。
  const TRA_COLORS = { '自強': '#C0392B', '莒光/復興': '#E8792B', '區間車': '#2E6FB0', '區間快': '#16A085', '其他': '#8E44AD' };
  const AFR_COLORS = { '阿里山號': '#B03A2E', '神木線': '#CB6A4A', '沼平線': '#D98A5F', '祝山線': '#E0A458' };
  const HSR_COLORS = { '高鐵': '#E85D0D' };
  const COLOR_PALETTE = { [TRA]: TRA_COLORS, [AFR]: AFR_COLORS, [HSR]: HSR_COLORS };
  // 車款預設色：跟這台車平常掛的真車牌同一格（預設＝這台車本來會有的顏色）。
  const CLS_DEFAULT_COLOR_KEY = {
    [CLS.local]: '區間車', [CLS.jg]: '莒光/復興', [CLS.pk]: '其他',
    [CLS.taroko]: '自強', [CLS.puyuma]: '自強', [CLS.pp]: '自強', [CLS.emu3000]: '自強', [CLS.dmu]: '自強', [CLS.tc]: '自強',
    [CLS.hsr]: '高鐵', [CLS.afr]: '阿里山號',
  };
  function defaultColor(modelId) {
    const m = MyTrainPlan.MODELS[modelId];
    if (!m) return null;
    const key = CLS_DEFAULT_COLOR_KEY[m.cls];
    const palette = COLOR_PALETTE[m.sys] || {};
    return (key && palette[key]) || null;
  }
  // 存檔內容裡的顏色一律先過這關：合法（同系統色盤裡的值，不分大小寫）就轉成色盤原文寫法；
  // 其他情況（別系統的顏色、亂填、undefined、舊紀錄沒這欄）一律退回這台車的預設色，不是原樣收下。
  function normalizeColor(modelId, value) {
    const m = MyTrainPlan.MODELS[modelId];
    if (!m) return null;
    const palette = COLOR_PALETTE[m.sys] || {};
    if (typeof value === 'string') {
      const v = value.toLowerCase();
      for (const hex of Object.values(palette)) { if (hex.toLowerCase() === v) return hex; }
    }
    return MyTrainPlan.defaultColor(modelId);
  }

  // ── 名字────────────────────────────────────────────
  const NAME_MAX = 5;
  const CTRL = new RegExp('[\u0000-\u001F\u007F-\u009F' + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + ']', 'g');   // 換行分隔字元(U+2028/U+2029)與控制字元：直接去掉
  function normalizeName(raw) {
    return String(raw == null ? '' : raw).replace(CTRL, '').replace(new RegExp('^[\\s' + String.fromCharCode(0x3000) + ']+|[\\s' + String.fromCharCode(0x3000) + ']+$', 'g'), '');
  }
  // 字數照畫面上看到的字算（字素）；沒有 Intl.Segmenter 的環境退回 code point。
  function nameLength(s) {
    const str = String(s == null ? '' : s);
    const Seg = typeof Intl !== 'undefined' && Intl && Intl.Segmenter;
    if (Seg) { let n = 0; for (const _ of new Seg(undefined, { granularity: 'grapheme' }).segment(str)) n++; return n; }
    return Array.from(str).length;
  }
  function validateName(raw) {
    const name = MyTrainPlan.normalizeName(raw);
    const n = MyTrainPlan.nameLength(name);
    if (n === 0) return { ok: false, name, reason: 'empty' };
    if (n > NAME_MAX) return { ok: false, name, reason: 'too_long' };
    return { ok: true, name, reason: null };
  }

  // ── 站鍵：跟 railcore PhysicalJs.stationKey／網頁 rail-3d/physical/timing.js 的
  // stationKey 同語意，三個系統統一（不再分台鐵／其他）：sys 前綴＋臺→台＋去括號（全形半形都算、全域、
  // 懶惰、可在字串中間）＋去尾端「-環島」＋trim。scripts/verify_my_train_plan.mjs 借 timing.js 那一份
  // 原樣抽出來跑，當獨立真值來源逐字比對，不是拿這裡的實作自己比自己。
  function stationKey(sys, name) {
    return sys + ':' + String(name == null ? '' : name).replaceAll('臺', '台')
      .replace(/\s*[（(].*?[）)]/g, '').replace(/-環島$/, '').trim();
  }

  // ── 站點圖與最短路徑───────────────────────────────────────
  // 節點＝站鍵；邊＝同一條線上相鄰兩站，長度＝兩站 d 的差（公里）。站名顯示用「去掉尾端括號註記」
  // 的名字（「新城 (太魯閣)」→「新城」），跟班表的站名一致，貼軌的 byName 才對得上。
  const plainName = name => String(name).replace(/\s*[(（][^()（）]*[)）]\s*$/, '').trim();
  function buildGraph(lines, sys) {
    if (sys !== TRA && sys !== HSR && sys !== AFR) throw new Error('buildGraph: sys 必須是 tra_sched／thsr_sched／afr_sched');
    const nodes = new Map(), adj = new Map();
    const node = (st, lineId) => {
      const key = MyTrainPlan.stationKey(sys, st.name);
      let n = nodes.get(key);
      if (!n) { n = { key, name: plainName(st.name), lat: st.lat, lon: st.lon, lines: {} }; nodes.set(key, n); adj.set(key, []); }
      n.lines[lineId] = st.d;
      return n;
    };
    const link = (a, b, km, line) => {
      const list = adj.get(a), old = list.find(e => e.to === b);
      if (!old) list.push({ to: b, km, line });
      else if (km < old.km) { old.km = km; old.line = line; }
    };
    for (const ln of lines || []) {
      const sts = (ln.stations || []).filter(st => st && st.name != null && Number.isFinite(st.d));
      let prev = null;
      for (const st of sts) {
        const cur = node(st, ln.id);
        if (prev && prev.key !== cur.key) {
          const km = Math.abs(st.d - prev.d);
          link(prev.key, cur.key, km, ln.id); link(cur.key, prev.key, km, ln.id);
        }
        prev = { key: cur.key, d: st.d };
      }
    }
    return { sys, nodes, adj };
  }
  // 不對外的 Dijkstra。bannedLine：這條線的邊一律不走（山線／海線切換用）。
  // dirSign：+1 只准順行、-1 只准逆行、0 不限；只有環上的邊受限（見 loopDirs）。
  function shortest(graph, from, to, bannedLine, dirSign) {
    if (!graph.nodes.has(from) || !graph.nodes.has(to)) return null;
    const dirs = dirSign ? loopDirs(graph) : null;
    const dist = new Map([[from, 0]]), prev = new Map(), done = new Set();
    for (;;) {
      let u = null, du = Infinity;
      for (const [k, d] of dist) if (!done.has(k) && d < du) { u = k; du = d; }
      if (u === null) return null;
      if (u === to) break;
      done.add(u);
      for (const e of graph.adj.get(u)) {
        if (bannedLine && e.line === bannedLine) continue;
        if (dirs && dirs.get(u + '|' + e.to) === -dirSign) continue;
        const nd = du + e.km;
        if (!dist.has(e.to) || nd < dist.get(e.to) - 1e-9) { dist.set(e.to, nd); prev.set(e.to, { from: u, line: e.line, km: e.km }); }
      }
    }
    const path = [];
    for (let k = to; k !== from;) { const p = prev.get(k); path.push({ key: k, line: p.line, km: p.km }); k = p.from; }
    path.push({ key: from, line: null, km: 0 });
    path.reverse();
    return { km: dist.get(to), path };
  }
  // ── 順行／逆行──────────────────
  // 台鐵環島那一圈上的兩站，繞島兩個方向都到得了：預設照舊走最短那邊，另一邊也可以選。
  // 順行＝台鐵定義的逆時針（西部南下、東部北上），逆行相反——跟 index.html 懸賞卡 dir 契約同一個定義。
  // data/tra.json 這九條幹線的里程 d 都往順行方向遞增（臺東線從臺東、宜蘭線從蘇澳起算），所以一條邊兩端
  // 在同一條幹線上，就用那條線的 d 差定方向（不看邊記在哪條線：新竹到北新竹那段合併後記在內灣線）。
  // 只有環上的邊受限：拿掉就斷開的邊（支線，以及八堵到基隆、蘇澳新到蘇澳這兩段盡頭）兩個方向都能走，
  // 不然從那裡出發的車出不來。成追線兩端不在同一條幹線上，方向記 0，兩個方向都能走。
  const LOOP_LINES = ['縱貫線北段', '山線', '海線', '縱貫線南段', '屏東線', '南迴線', '臺東線', '北迴線', '宜蘭線'];
  const DIR_SIGN = { shun: 1, ni: -1 };
  function loopDirs(graph) {
    if (graph._loopDirs) return graph._loopDirs;
    // 找橋（Tarjan）。buildGraph 的 link 會合併同兩站之間的邊，圖上沒有平行邊，略過父節點就夠。
    const tin = new Map(), low = new Map(), bridge = new Set();
    let clock = 0;
    const visit = (u, parent) => {
      tin.set(u, ++clock); low.set(u, clock);
      for (const e of graph.adj.get(u)) {
        if (e.to === parent) continue;
        if (tin.has(e.to)) { low.set(u, Math.min(low.get(u), tin.get(e.to))); continue; }
        visit(e.to, u);
        low.set(u, Math.min(low.get(u), low.get(e.to)));
        if (low.get(e.to) > tin.get(u)) { bridge.add(u + '|' + e.to); bridge.add(e.to + '|' + u); }
      }
    };
    for (const k of graph.nodes.keys()) if (!tin.has(k)) visit(k, null);
    const dirs = new Map();
    for (const [u, list] of graph.adj) for (const e of list) {
      if (bridge.has(u + '|' + e.to)) continue;
      const a = graph.nodes.get(u).lines, b = graph.nodes.get(e.to).lines;
      const L = LOOP_LINES.find(id => a[id] != null && b[id] != null);
      dirs.set(u + '|' + e.to, L ? Math.sign(b[L] - a[L]) : 0);
    }
    graph._loopDirs = dirs;
    return dirs;
  }
  // 一條路徑在環上往哪個方向繞：+1 順行、-1 逆行；0＝沒走到環上，或中途換了方向（例如臺中經成追線到大甲）。
  function pathSign(graph, path) {
    const dirs = loopDirs(graph);
    let s = 0;
    for (let i = 1; i < path.length; i++) {
      const d = dirs.get(path[i - 1].key + '|' + path[i].key) || 0;
      if (!d) continue;
      if (s && d !== s) return 0;
      s = d;
    }
    return s;
  }

  // 山線／海線：路徑同時經過竹南和彰化（含起訖本身），而且只走山線、只走海線都走得通、兩條路不一樣，
  // 才有切換，預設山線（竹南到彰化選逆行繞一圈時，兩端都經過了，但兩條路都沒走到山線海線）。
  // 山線＝不走 id 為「海線」的線；海線＝不走 id 為「山線」的線（資料 data/tra.json 的線 id）。
  // VIA_KEYS 存的是站鍵（sys 前綴），不是顯示名：跟 best.path[].key 比對才對得上。
  // 有順行／逆行可選時，山線、海線兩條路也照同一個方向繞：不然剛好繞半圈的站（例如臺北到加祿）選海線會掉頭走東部。
  const VIA_KEYS = ['竹南', '彰化'].map(n => stationKey(TRA, n));
  const VIA_BAN = { mountain: '海線', coast: '山線' };
  function findRoute(graph, fromKey, toKey, opts) {
    const via = opts && opts.via, want = opts && opts.dir;
    if (!graph || !graph.nodes.has(fromKey) || !graph.nodes.has(toKey)) return { ok: false, reason: 'unknown_station' };
    if (fromKey === toKey) return { ok: false, reason: 'same' };
    let best = shortest(graph, fromKey, toKey, null, 0);
    if (!best) return { ok: false, reason: 'no_path' };
    // 最短路徑整段往同一個方向繞、另一個方向也到得了，才有得選；預設＝最短那邊的方向。
    let dirChoice = false, dir = null, sign = 0;
    if (graph.sys === TRA) {
      const s = pathSign(graph, best.path);
      const other = s ? shortest(graph, fromKey, toKey, null, -s) : null;
      if (other) {
        dirChoice = true; sign = s;
        if (DIR_SIGN[want] === -s) { best = other; sign = -s; }
        dir = sign > 0 ? 'shun' : 'ni';
      }
    }
    const passed = new Set(best.path.map(p => p.key));
    let viaChoice = false, chosen = null;
    if (graph.sys === TRA && VIA_KEYS.every(k => passed.has(k))) {
      const m = shortest(graph, fromKey, toKey, VIA_BAN.mountain, sign), c = shortest(graph, fromKey, toKey, VIA_BAN.coast, sign);
      const same = m && c && m.path.length === c.path.length && m.path.every((p, i) => p.key === c.path[i].key);
      if (m && c && !same) { viaChoice = true; chosen = via === 'coast' ? 'coast' : 'mountain'; best = chosen === 'coast' ? c : m; }
    }
    // line：從前一站過來那段路記在哪條線（第一站取第一段的）；lines：這一站在哪幾條線上（停車時間的普快例外用）。
    let km = 0;
    const stops = best.path.map((p, i) => {
      km += p.km;
      const n = graph.nodes.get(p.key);
      return { name: n.name, key: n.key, lat: n.lat, lon: n.lon, km, line: i === 0 ? best.path[1].line : p.line, lines: Object.keys(n.lines) };
    });
    return { ok: true, stops, km: stops[stops.length - 1].km, viaChoice, via: chosen, dirChoice, dir };
  }

  // ── 站等與停站方式──────────────────────────────────────────
  const CLS_TIER = { '特等': 0, '一等': 1, '二等': 2, '三等': 3 };
  const excludedTrain = tr => !!(tr.loop || tr.est || tr.stops._prevNight);
  function stationTiers(sysId, trains, stnClassMap) {
    const count = new Map(), names = new Set();
    for (const tr of trains || []) {
      if (!tr || !Array.isArray(tr.stops)) continue;
      for (const s of tr.stops) names.add(s.name);
      if (excludedTrain(tr)) continue;
      for (const s of tr.stops) if (s.stop !== false) count.set(s.name, (count.get(s.name) || 0) + 1);
    }
    const table = new Map();
    if (sysId === TRA) for (const [k, v] of Object.entries(stnClassMap || {})) {
      const nk = String(k).replace(/\s*[(（][^()（）]*[)）]\s*$/, '').trim();
      if (!table.has(nk)) table.set(nk, v);
    }
    const tiers = new Map();
    for (const name of names) {
      const c = sysId === TRA ? (table.get(name) || table.get(name.replace(/台/g, '臺')) || table.get(name.replace(/臺/g, '台'))) : null;
      const n = count.get(name) || 0;
      tiers.set(name, c ? (CLS_TIER[c] != null ? CLS_TIER[c] : 4) : n >= 200 ? 1 : n >= 90 ? 2 : n >= 30 ? 3 : 4);
    }
    return tiers;
  }
  const PATTERNS = ['all', 'major', 'express'];
  function applyPattern(stops, pattern, tiers, sysId) {
    if (!PATTERNS.includes(pattern)) throw new Error('applyPattern: 不認得的停站方式 ' + pattern);
    if (pattern === 'major' && sysId === AFR) throw new Error('applyPattern: 林鐵沒有只停大站');
    const last = stops.length - 1;
    return stops.map((s, i) => {
      let stop;
      if (i === 0 || i === last || pattern === 'all') stop = true;
      else if (pattern === 'express') stop = false;
      else { const t = tiers && tiers.get(s.name); stop = t != null && t <= 2; }
      return { ...s, stop };
    });
  }

  // ── 跑時統計───────────────────────────────────────────────
  const BUCKETS = [
    { id: '0-5', max: 5 }, { id: '5-10', max: 10 }, { id: '10-20', max: 20 }, { id: '20-40', max: 40 }, { id: '40+', max: Infinity },
  ];
  const MIN_N = 20;
  const bucketOf = km => BUCKETS.findIndex(b => km < b.max);
  const median = arr => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  // 高鐵的 depSec 在貼軌時被改成「那一分的中點」(index.html assignSchedShapePathsFor 的 HSR_DEP_MID_SEC)，
  // 原值留在 dep0。統計一律用原值，高鐵有沒有載入過，算出來的都一樣。
  const depOf = s => (s.dep0 != null ? s.dep0 : s.depSec);
  // 別名站合併：跟 index.html canonicalizeAliasTrains（網頁併站正本）
  // 同三個條件，缺一不併（「臺北-環島」這類刻意整併的站，才不會變成好幾個臺北站）：
  //  (1) 名字含 "-" 且不在開頭；
  //  (2) "-" 前面那一段本身也是這份班表資料裡出現過的站名（存在檢查，用第一次看到那站的座標）；
  //  (3) 兩者座標相距 ≤0.2km（haversineKm；防未來出現「X-Y」但離 X 很遠的站被誤併——這條 canonicalizeAliasTrains
  //      有、下面 stationKey 硬編碼的「-環島$」沒有，是兩件不同的事：一個是字元正規化，一個是併站判斷）。
  function haversineKm(a, b) {
    const R = 6371, toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    const la1 = a.lat * toR, la2 = b.lat * toR;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  // 站名 → 這份班表第一次看到這站時的座標（只用來取座標，跟 canonicalizeAliasTrains 的 `at` 同做法）。
  function nameLocations(trains) {
    const at = new Map();
    for (const tr of trains || []) for (const s of (tr && tr.stops) || []) if (s && !at.has(s.name)) at.set(s.name, { lat: s.lat, lon: s.lon });
    return at;
  }
  // 回傳併站後的「基準站名」，三條件任一不成立回 null（不算別名，呼叫端照舊當查無此站處理）。
  function aliasBaseName(name, nameLoc) {
    const i = String(name).indexOf('-');
    if (i <= 0) return null;
    const base = String(name).slice(0, i), st = nameLoc.get(name), bs = nameLoc.get(base);
    if (!st || !bs) return null;
    return MyTrainPlan.haversineKm(st, bs) <= 0.2 ? base : null;
  }
  function buildRunStats(sysId, trains, classOf, graph) {
    const pairKm = new Map();
    // 班表站名 → 圖上的站鍵。stationKey 自己會去掉寫死的「-環島」尾綴（PhysicalJs 契約），一般名字、
    // 也含「-環島」的別名都直接算得出來；查不到才試 MyTrainPlan.aliasBaseName 的三條件併站（見上）。
    const nameLoc = MyTrainPlan.nameLocations(trains);
    const keyOfName = name => {
      const k = MyTrainPlan.stationKey(sysId, name);
      if (graph.nodes.has(k)) return k;
      const base = MyTrainPlan.aliasBaseName(name, nameLoc);
      if (base == null) return null;
      const bk = MyTrainPlan.stationKey(sysId, base);
      return graph.nodes.has(bk) ? bk : null;
    };
    const kmBetween = (na, nb) => {
      const a = keyOfName(na), b = keyOfName(nb);
      if (!a || !b) return null;
      if (a === b) return 0;
      const id = a < b ? a + '|' + b : b + '|' + a;
      if (!pairKm.has(id)) { const r = shortest(graph, a, b, null); pairKm.set(id, r ? r.km : null); }
      return pairKm.get(id);
    };
    const speeds = new Map(), sysSpeeds = BUCKETS.map(() => []), sysAll = [], dwells = new Map(), sysDwells = [];
    const skipped = { loop: 0, est: 0, prevNight: 0, nonPositive: 0, unmeasured: 0 };
    for (const tr of trains || []) {
      if (!tr || !Array.isArray(tr.stops) || tr.stops.length < 2) continue;
      if (tr.loop) { skipped.loop++; continue; }
      if (tr.est) { skipped.est++; continue; }
      if (tr.stops._prevNight) { skipped.prevNight++; continue; }
      const cls = classOf(tr, sysId), s = tr.stops, idx = [];   // 第二個參數給 host 用：沒載入的系統，真車身上沒有 tr.sys
      for (let i = 0; i < s.length; i++) if (s[i].stop !== false) idx.push(i);
      for (let k = 0; k + 1 < idx.length; k++) {
        const i = idx[k], j = idx[k + 1], sec = s[j].arrSec - depOf(s[i]);
        if (!(sec > 0)) { skipped.nonPositive++; continue; }
        let km = 0;
        for (let q = i; q < j && km != null; q++) { const d = kmBetween(s[q].name, s[q + 1].name); km = d == null ? null : km + d; }
        if (km == null || !(km > 0)) { skipped.unmeasured++; continue; }
        const kmh = km / (sec / 3600), b = bucketOf(km);
        if (!speeds.has(cls)) speeds.set(cls, BUCKETS.map(() => []));
        speeds.get(cls)[b].push(kmh); sysSpeeds[b].push(kmh); sysAll.push(kmh);
      }
      for (let i = 1; i < s.length - 1; i++) {
        if (s[i].stop === false) continue;
        const d = depOf(s[i]) - s[i].arrSec;
        if (!(d >= 0)) continue;
        if (!dwells.has(cls)) dwells.set(cls, []);
        dwells.get(cls).push(d); sysDwells.push(d);
      }
    }
    const grp = arr => ({ n: arr.length, kmh: median(arr) });
    const out = {
      sys: sysId, buckets: BUCKETS.map(b => b.id), cls: {}, sysBuckets: sysSpeeds.map(grp), sysAll: grp(sysAll),
      dwell: {}, sysDwell: { n: sysDwells.length, sec: median(sysDwells) }, skipped,
    };
    for (const [c, arrs] of speeds) out.cls[c] = arrs.map(grp);
    for (const [c, arr] of dwells) out.dwell[c] = { n: arr.length, sec: median(arr) };
    return out;
  }
  // 退路：同類別本桶 → 同類別短一級 → 同類別長一級 → 同系統同桶 → 同系統不分長度，
  // 取第一個有 20 段以上的。group.cls 不分類別時是 '*'，group.bucket 不分長度時是 '*'。
  function runSpeed(stats, cls, km) {
    const b = bucketOf(km), own = stats.cls[cls], tries = [];
    if (own) {
      tries.push([cls, b, own[b]]);
      if (b > 0) tries.push([cls, b - 1, own[b - 1]]);
      if (b < BUCKETS.length - 1) tries.push([cls, b + 1, own[b + 1]]);
    }
    tries.push(['*', b, stats.sysBuckets[b]]);
    tries.push(['*', -1, stats.sysAll]);
    const pick = ([c, bi, g]) => ({ kmh: g.kmh, group: { sys: stats.sys, cls: c, bucket: bi < 0 ? '*' : BUCKETS[bi].id, n: g.n, kmh: g.kmh } });
    for (const t of tries) if (t[2] && t[2].n >= MIN_N) return pick(t);
    return pick(tries[tries.length - 1]);   // 連整個系統都不到 20 段：照給，守門腳本會擋
  }
  // 停車時間：該類別中間停靠站停車時間的中位數；該類別一筆都沒有才退同系統。
  // 普快例外：普快類別的樣本只有南迴線那幾班專開的普通車，
  // 一站常停十幾分鐘，套到別的線上，臺北到高雄站站停會開超過一天。所以普快只在南迴線的站（stop.lines 有南迴線，
  // 枋寮、臺東兩端也算）用自己的中位數，其他站用全系統的。
  function dwellSec(stats, cls, stop) {
    const g = stats.dwell[cls], all = stats.sysDwell.n > 0 ? Math.round(stats.sysDwell.sec) : 0;
    if (!g || !(g.n > 0)) return all;
    if (cls === CLS.pk && !(stop && stop.lines && stop.lines.includes('南迴線'))) return all;
    return Math.round(g.sec);
  }
  // 物理最短時間：對 buildProfile 二分搜尋最小可行 T。
  // buildProfile 的可行與否只看梯形那一步（ρ=1），T 越大越可行，所以二分成立。
  function physMinSec(km, perf, buildProfile) {
    if (!(km > 0)) return 0;
    const ok = T => !!buildProfile(km, T, perf.a, perf.b, perf.v, perf.coast);
    let hi = Math.max(1, km / perf.v * 3600);
    for (let i = 0; i < 60 && !ok(hi); i++) hi *= 2;
    if (!ok(hi)) throw new Error('physMinSec: 找不到可行的時間');
    let lo = 0;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
    return hi;
  }

  // ── 時刻表──────────────────────────────────
  // 每一段＝停靠站到下一個停靠站：ceil(max(距離÷分組中位數均速, 物理下限))；
  // finer（同一路線、比較密的那種停站方式的 segs）給了的話，這一段不超過 finer 在同一段路上的行駛時間總和。
  // 通過站照距離比例內插。時刻跨午夜直接超過 86400（跟真車記錄同一種表示法）。
  function buildTimetable(opts) {
    const { stops, cls, perf, stats, depSec, buildProfile, finer } = opts;
    const idx = [];
    stops.forEach((s, i) => { if (s.stop) idx.push(i); });
    if (idx[0] !== 0 || idx[idx.length - 1] !== stops.length - 1) throw new Error('buildTimetable: 起訖兩站一定要停');
    const segs = [];
    for (let k = 0; k + 1 < idx.length; k++) {
      const i = idx[k], j = idx[k + 1], km = stops[j].km - stops[i].km;
      const sp = MyTrainPlan.runSpeed(stats, cls, km);
      const statSec = sp.kmh > 0 ? km / sp.kmh * 3600 : 0;
      const physSec = MyTrainPlan.physMinSec(km, perf, buildProfile);
      let runSec = Math.ceil(Math.max(statSec, physSec)), capped = false;
      if (finer) {
        const parts = finer.filter(f => f.fromIdx >= i && f.toIdx <= j);
        const tiled = parts.length && parts[0].fromIdx === i && parts[parts.length - 1].toIdx === j
          && parts.every((p, n) => !n || p.fromIdx === parts[n - 1].toIdx);
        if (!tiled) throw new Error('buildTimetable: finer 蓋不滿這一段');
        const cap = parts.reduce((t, p) => t + p.runSec, 0);
        if (runSec > cap) { runSec = cap; capped = true; }
      }
      segs.push({ fromIdx: i, toIdx: j, runSec, group: sp.group, km, statSec, physSec, capped });
    }
    const out = stops.map(s => ({ name: s.name, lat: s.lat, lon: s.lon, arrSec: depSec, depSec, stop: !!s.stop }));
    for (const g of segs) {
      const t0 = out[g.fromIdx].depSec, span = stops[g.toIdx].km - stops[g.fromIdx].km;
      for (let q = g.fromIdx + 1; q < g.toIdx; q++) {
        const f = span > 0 ? (stops[q].km - stops[g.fromIdx].km) / span : 0;
        out[q].arrSec = out[q].depSec = Math.round(t0 + g.runSec * f);
      }
      const arr = t0 + g.runSec;
      out[g.toIdx].arrSec = arr;
      out[g.toIdx].depSec = g.toIdx === stops.length - 1 ? arr : arr + MyTrainPlan.dwellSec(stats, cls, stops[g.toIdx]);
    }
    return { stops: out, segs, totalSec: out[out.length - 1].arrSec - depSec };
  }

  // ── 從儲存的選擇組出執行時記錄───────────────────────
  const ZONE = { temu2000: 'puyuma', temu1000: 'tilting' };
  function planTrain(saved, ctx) {
    if (!saved || typeof saved !== 'object' || !ctx) return { ok: false, reason: 'bad_saved' };
    const m = MyTrainPlan.MODELS[saved.modelId];
    if (!m) return { ok: false, reason: 'model_gone' };
    if (saved.sys !== m.sys) return { ok: false, reason: 'sys_mismatch' };
    if (!PATTERNS.includes(saved.pattern) || (saved.pattern === 'major' && m.sys === AFR)) return { ok: false, reason: 'bad_pattern' };
    if (!Number.isInteger(saved.depSec) || saved.depSec < 0 || saved.depSec >= 86400) return { ok: false, reason: 'bad_dep' };
    const nm = MyTrainPlan.validateName(saved.name);
    if (!nm.ok) return { ok: false, reason: 'bad_name' };
    const graph = ctx.graph || MyTrainPlan.buildGraph(ctx.lines, m.sys);
    const route = MyTrainPlan.findRoute(graph, saved.from, saved.to, { via: saved.via, dir: saved.dir });
    if (!route.ok) return { ok: false, reason: route.reason === 'unknown_station' ? 'station_gone' : route.reason };
    const stats = ctx.stats || MyTrainPlan.buildRunStats(m.sys, ctx.denseTrains || ctx.trains, ctx.classOf, graph);
    const needTiers = saved.pattern !== 'all' && m.sys !== AFR;
    const tiers = needTiers ? (ctx.tiers || MyTrainPlan.stationTiers(m.sys, ctx.trains, ctx.stnClassMap)) : null;
    const chain = saved.pattern === 'all' ? ['all'] : saved.pattern === 'major' ? ['all', 'major']
      : m.sys === AFR ? ['all', 'express'] : ['all', 'major', 'express'];
    let tt = null;
    for (const p of chain) {
      const stops = MyTrainPlan.applyPattern(route.stops, p, tiers, m.sys);
      tt = MyTrainPlan.buildTimetable({ stops, cls: m.cls, perf: m.perf, stats, depSec: saved.depSec,
        buildProfile: ctx.buildProfile, finer: tt ? tt.segs : null });
    }
    // 繞島另一邊可以長到八百多公里，慢車款站站停可能超過一天：隔天同一班發車時上一趟還在路上才不成立；恰好 24 小時則是抵達後立即發下一趟，允許。
    if (tt.totalSec > 86400) return { ok: false, reason: 'over_day' };
    const cat = ctx.catalog && ctx.catalog[saved.modelId];
    const perf = { ...m.perf };   // 複製一份：record 會被執行時程式碼讀寫，不能拿到凍結的 MODELS 本體
    if (m.perf.coast) perf.coast = { ...m.perf.coast };
    const record = {
      train: saved.id, label: nm.name, mine: true, modelId: saved.modelId, perf,
      zoneClass: ZONE[saved.modelId] || 'regular', sys: m.sys,
      typeName: cat && cat.name ? String(cat.name) : saved.modelId, carName: '', color: MyTrainPlan.normalizeColor(saved.modelId, saved.color),
      stops: tt.stops, _ownPattern: saved.pattern, _ownVia: route.via, _ownDir: route.dir,
    };
    return { ok: true, record, stats, route, timetable: tt };
  }

  // ── 事件列的時間運算───────────────────────────
  // rel＝「距離本趟發車幾秒」：0 是發車、全程秒數是抵達。跨午夜的班照樣是一串連續的數字，
  // 所以排序、掃描都用 rel，不用模擬時鐘的「一天中的第幾秒」。
  function tripRel(simSec, depSec) {
    return ((simSec - depSec) % 86400 + 86400) % 86400;
  }
  // 只有「連續前進」才掃：往前的量不超過「兩次掃描之間的牆鐘秒數 × 倍速，再加 5 秒」。
  // 其他任何跳動（往前跳、往回走、剛打開）都只把掃描起點移到新的時刻，不補算、不插說明。
  function scanSpan(lastSimSec, nowSimSec, wallDtSec, speed) {
    if (lastSimSec == null) return { continuous: false, from: null, to: nowSimSec };
    const fwd = ((nowSimSec - lastSimSec) % 86400 + 86400) % 86400;
    return { continuous: fwd <= wallDtSec * Math.max(1, speed) + 5, from: lastSimSec, to: nowSimSec };
  }
  // 這一趟是哪天發的車：台北牆鐘此刻已經過了發車時刻就是今天，還沒過就是昨天。跟模擬時鐘無關。
  function tripDay(depSec, wallSecOfDay, today, yesterday) {
    return wallSecOfDay >= depSec ? today : yesterday;
  }
  // 什麼時候要判斷「是不是新的一趟」：連續前進走過發車點；或車在路上，而且還沒有發車日、或這一拍是跳動。
  // 跳動落在路上也要判斷：頁面在背景過夜、隔天回前景時車正在路上，不判斷的話前一天的紀錄會跟今天混在一起、
  // 今天的停靠也會被前一天的同站條目去重吃掉。連續前進中途不重判：倍速跑到一半牆鐘剛好過了發車時刻，
  // 重判會把正在跑的這一趟清空。relFrom 在跳動時沒有意義（傳 NaN）。
  function tripDayCheck(continuous, relFrom, relTo, dur, tripDay) {
    if (continuous && relFrom > relTo) return true;
    return relTo <= dur && (tripDay == null || !continuous);
  }
  // 自己的時刻表上，本趟秒數落在 relFrom～relTo 的發車／停靠／抵達。relFrom > relTo 代表跨過了發車點，
  // 拆成「relFrom 之後」與「relTo 之前」兩段。下界也算進來：剛好停在某個時刻的那一拍，前後兩次掃描
  // 都會看到它，交給 addEvent 去重——漏掉一條比多看一次糟。通過站不記。
  // key 用站名：時刻表的站是 findRoute 的最短路徑，同一趟不會經過同一站兩次。
  function stopEventsBetween(timetable, relFrom, relTo) {
    const s = timetable && timetable.stops;
    if (!s || s.length < 2) return [];
    const dep0 = s[0].depSec, last = s.length - 1, out = [];
    const inSpan = rel => (relFrom <= relTo ? rel >= relFrom && rel <= relTo : rel >= relFrom || rel <= relTo);
    for (let i = 0; i <= last; i++) {
      const st = s[i];
      if (i > 0 && i < last && st.stop === false) continue;
      const rel = (i === 0 ? st.depSec : st.arrSec) - dep0;
      if (!inSpan(rel)) continue;
      out.push({ kind: i === 0 ? 'depart' : i === last ? 'arrive' : 'stop', key: String(st.name), name: st.name, rel });
    }
    return out;
  }
  // 照 rel 插進已排序的 items，回傳插入的位置；重複或被上限丟掉時回 -1。
  // 去重前後都算：發車／停靠／抵達同一站一趟一次；交會／從旁通過同一班真車（key）在 rel 前後 900 秒內一次
  // （真車版 pushFollowEvent 只擋之後的 15 分鐘，倒帶重看會早兩秒再記一次）。超過 cap 丟 rel 最小的。
  const STOP_KIND = { depart: true, stop: true, arrive: true };
  function addEvent(items, ev, cap = 5000) {
    const isStop = !!STOP_KIND[ev.kind];
    for (const it of items) {
      if (it.key !== ev.key || !!STOP_KIND[it.kind] !== isStop) continue;
      if (isStop || Math.abs(it.rel - ev.rel) < 900) return -1;
    }
    let i = items.length;
    while (i > 0 && items[i - 1].rel > ev.rel) i--;
    items.splice(i, 0, ev);
    if (items.length > cap) { items.shift(); i--; }
    return i;
  }

  // ── 車隊：六股、路線分段、親手趟（存檔形狀與讀寫在 my-train-ui.js，這裡只有規則）────
  // TRACKS 是股道數；FLEET_MAX 是存檔上限，比股道多的車 track 是 null（待命），資料留著、不上地圖。
  // day 一律是台灣日期 YYYY-MM-DD。legs：每段 { day 起始日, km 每趟公里, stops 每趟停站數, dep 發車秒, dur 全程秒, tags 路線標籤,
  // rise／set 經過太麻里、海線的本趟秒數, meets 每趟交會數（null＝還沒算）, twin 有同款真車, kin 會交會的自製車 }，
  // 里程＝各段「每趟公里 × 該段天數」加總，所以改路線只開新段，不回頭動舊段。
  // hand：各裝置分開記 { n 次數, km, stops, meets }，帳號合併時每台取最大。outRun：進行中的親手趟 { at 按下去的毫秒, dep 發車秒, dur 全程秒 }。
  // firstDay：第一班每日班次的日子，當天發車時刻已過就是隔天（親手發車會把它提前到按下去那天）。
  // earned：{ 成就鍵: 拿到那天 }。judged：判斷到哪一天（那天的班次已經算過）。look：{ mark 頭牌, plate 車牌框 }。
  const TRACKS = 6, FLEET_MAX = 12;
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/, DEVICE_RE = /^[0-9A-Za-z-]{8,64}$/;
  const num0 = v => (Number.isFinite(v) && v >= 0 ? v : 0);
  const int0 = v => (Number.isInteger(v) && v >= 0 ? v : 0);
  const km1 = v => Math.round(v * 10) / 10;
  // 當天的班次跑完了沒。過午夜的班要到隔天才算。
  const doneToday = (leg, nowSec) => !!leg && leg.dur > 0 && leg.dep + leg.dur < 86400 && nowSec >= leg.dep + leg.dur;
  function taipeiDay(ms) { return new Date(ms + 8 * 3600e3).toISOString().slice(0, 10); }
  // 成就存檔：日期合法的留下。新版才有的成就 id 舊版讀到也不丟，同步回去才不會少。
  const earnedOf = o => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([, d]) => DAY_RE.test(d)));
  // 排班以外的欄位：認得的留下，其他丟掉。形狀錯了不丟整列車，壞的那一欄回到空值。
  function fleetFields(t) {
    const legs = [], hand = {};
    for (const l of Array.isArray(t.legs) ? t.legs : []) {
      if (l && DAY_RE.test(l.day)) legs.push({ day: l.day, ...legFields(l) });
    }
    for (const [dev, h] of Object.entries(t.hand && typeof t.hand === 'object' ? t.hand : {})) {
      if (DEVICE_RE.test(dev) && h && typeof h === 'object') hand[dev] = { n: int0(h.n), km: num0(h.km), stops: int0(h.stops), meets: int0(h.meets) };
    }
    const r = t.outRun, look = t.look && typeof t.look === 'object' ? t.look : {};
    return {
      track: Number.isInteger(t.track) && t.track >= 0 && t.track < TRACKS ? t.track : null,
      firstDay: DAY_RE.test(t.firstDay) ? t.firstDay : null,
      legs, hand,
      outRun: r && Number.isFinite(r.at) && Number.isInteger(r.dep) && r.dep >= 0 && r.dep < 86400 && Number.isFinite(r.dur) && r.dur > 0
        ? { at: r.at, dep: r.dep, dur: r.dur } : null,
      earned: earnedOf(t.earned),
      judged: DAY_RE.test(t.judged) ? t.judged : null,
      look: { mark: MyTrainPlan.MARK_IDS.includes(look.mark) ? look.mark : null, plate: PLATES[look.plate] ? look.plate : null },
    };
  }
  // 一段路線的內容（不含起始日）。兩段算同一段的標準是這裡每一欄都一樣，meets、twin、kin 是掃出來的結果，不算。
  function legFields(l) {
    const rel = v => (Number.isFinite(v) && v >= 0 ? v : null), pair = Array.isArray(l.set) && l.set.length === 2 && l.set.every(v => rel(v) !== null);
    return {
      km: num0(l.km), stops: int0(l.stops), dep: int0(l.dep), dur: num0(l.dur),
      tags: Array.isArray(l.tags) ? l.tags.filter(k => typeof k === 'string') : [], rise: rel(l.rise), set: pair ? [l.set[0], l.set[1]] : null,
      meets: Number.isInteger(l.meets) && l.meets >= 0 ? l.meets : null, twin: l.twin === true,
      kin: Array.isArray(l.kin) ? l.kin.filter(k => typeof k === 'string') : [],
    };
  }
  const sameRoute = (a, b) => a.km === b.km && a.stops === b.stops && a.dep === b.dep && a.dur === b.dur && a.rise === b.rise
    && String(a.tags) === String(b.tags) && String(a.set) === String(b.set);
  // 股道撞號或沒有股道的車，依序補進空股；補不下的就是待命。空出來的股道也由待命的車遞補。
  function assignTracks(trains) {
    const used = new Set();
    const kept = trains.map(t => {
      if (t.track === null || used.has(t.track)) return { ...t, track: null };
      used.add(t.track);
      return t;
    });
    return kept.map(t => {
      const free = t.track === null ? [...Array(TRACKS).keys()].find(i => !used.has(i)) : undefined;
      if (free === undefined) return t;
      used.add(free);
      return { ...t, track: free };
    });
  }
  function freeTrack(trains) {
    const used = new Set(trains.map(t => t.track));
    const i = [...Array(TRACKS).keys()].find(n => !used.has(n));
    return i === undefined ? -1 : i;
  }
  // 排班存進車隊：id 已經在就只換排班（股道與紀錄留著），不在就進指定的股（沒指定就第一條空股）；股道沒空回 null。
  // 改了路線或時間，進行中的親手趟跟著取消，不然地圖上那台還照舊路線跑；只改名字用 keepRun 留著。
  function fleetPut(trains, train, firstDay, keepRun, track = MyTrainPlan.freeTrack(trains)) {
    const old = trains.find(t => t.id === train.id);
    if (old) return trains.map(t => (t === old ? { ...old, ...train, outRun: keepRun ? old.outRun : null } : t));
    if (track < 0 || trains.some(t => t.track === track)) return null;
    return [...trains, { ...train, ...MyTrainPlan.fleetFields({ track, firstDay }) }];
  }
  // 第一班每日班次：今天的發車時刻還沒到就是今天，過了就是明天。
  function firstRunDay(depSec, nowSec, today) { return nowSec < depSec ? today : dayOf(dayNo(today) + 1); }
  // graph 給了才看路線標籤。
  function legOf(result, graph) {
    const stops = result.timetable.stops;
    return legFields({
      km: km1(result.route.km), stops: stops.filter(s => s.stop !== false).length, dep: stops[0].depSec, dur: result.timetable.totalSec,
      ...(graph ? MyTrainPlan.routeTraits(graph, result.route, stops) : null),
    });
  }
  // 回傳的是同一個陣列就代表沒有變動。同一天改好幾次只留最後一次。
  function syncLegs(legs, leg, firstDay, today) {
    const last = legs[legs.length - 1];
    if (!last) return [{ day: firstDay || today, ...leg }];
    if (sameRoute(last, leg)) return legs;
    if (last.day >= today) return [...legs.slice(0, -1), { day: last.day, ...leg }];
    return [...legs, { day: today, ...leg }];
  }
  // 親手發車：次數與公里按下去就記，outRun 只管地圖上那一台，跑完收掉也不會少算。
  // 頭班、末班看按下去那一刻，車還沒跑完也算；首航日若還沒到，提前到今天。
  function addHandRun(train, device, run, leg, today) {
    const h = train.hand[device] || { n: 0, km: 0, stops: 0, meets: 0 };
    const earned = { ...train.earned }, give = honorGiver(earned);
    if (today) {
      give('maiden', today);
      if (run.dep < 6 * 3600) give('dawn', today);
      if (run.dep >= 23 * 3600) give('late', today);
    }
    return {
      ...train, outRun: run, earned, firstDay: today && train.firstDay > today ? today : train.firstDay,
      hand: { ...train.hand, [device]: { n: h.n + 1, km: km1(h.km + leg.km), stops: h.stops + leg.stops, meets: h.meets + (leg.meets || 0) } },
    };
  }
  function runEnded(run, nowMs) { return nowMs >= run.at + run.dur * 1000; }
  // 累計數字。每日班次：跑完一趟算一天，當天的班次跑完才算進去（過午夜的班隔天才算），每段「每趟×該段天數」加總，
  // 改路線時舊段收到前一天、累計不歸零；親手趟另外加。
  function fleetStats(train, today, nowSec = 0) {
    const first = dayNo(train.firstDay || today), last = train.legs[train.legs.length - 1];
    const end = dayNo(today) + (doneToday(last, nowSec) ? 1 : 0);
    let days = 0, km = 0, stops = 0, meets = 0, hand = 0;
    train.legs.forEach((l, i) => {
      const from = Math.max(first, dayNo(l.day)), to = i + 1 < train.legs.length ? dayNo(train.legs[i + 1].day) : end, n = Math.max(0, Math.min(to, end) - from);
      days += n; km += l.km * n; stops += l.stops * n; meets += (l.meets || 0) * n;
    });
    for (const h of Object.values(train.hand)) { hand += h.n; km += h.km; stops += h.stops; meets += h.meets || 0; }
    return { days, trips: days + hand, hand, km: km1(km), stops, meets };
  }

  // ── 成就：每列 31 枚＋車隊 6 枚 ───────────────
  // stat＋goal 是數字型，看 fleetStats 的累計。其他：路線與時刻類看每一趟（runHonors），第一趟跑完才給；頭班、末班按下去當下看（addHandRun）；
  // 天氣類跟車時取樣（index.html 的 ownTrainWeather）；手足看車隊互相比的結果。id 寫進存檔，改名要搬資料。
  // 獎勵一律是外觀，不給點數：mark 給同 id 的頭牌、plate 給車牌框、deco 是車庫佈置。
  const HONOR_GROUPS = [
    { id: 'tenure', name: '資歷', note: '這列車跑了多久', list: [
      { id: 'maiden', name: '首航', desc: '第一次上路', stat: 'trips', goal: 1, mark: true },
      { id: 'days10', name: '十日', desc: '跑滿 10 天', stat: 'days', goal: 10 },
      { id: 'days100', name: '百日', desc: '跑滿 100 天', stat: 'days', goal: 100 },
      { id: 'days365', name: '週年', desc: '跑滿 365 天', stat: 'days', goal: 365, plate: 'enamel' },
    ] },
    { id: 'distance', name: '里程', note: '累計公里，不會歸零', list: [
      { id: 'km1k', name: '千里', desc: '累計 1,000 公里', stat: 'km', goal: 1e3, plate: 'bronze' },
      { id: 'km10k', name: '萬里', desc: '累計 10,000 公里', stat: 'km', goal: 1e4, plate: 'silver' },
      { id: 'earth', name: '環球', desc: '累計 40,075 公里，繞地球一圈', stat: 'km', goal: 40075, plate: 'gold' },
      { id: 'moon', name: '奔月', desc: '累計 384,400 公里，到月球', stat: 'km', goal: 384400, plate: 'moon' },
    ] },
    { id: 'hand', name: '親手', note: '你親自按下發車的紀錄', list: [
      { id: 'hand100', name: '百發', desc: '親手發車 100 次', stat: 'hand', goal: 100, plate: 'glove' },
      { id: 'dawn', name: '頭班', desc: '親手發一班清晨 6 點前的車', mark: true },
      { id: 'late', name: '末班', desc: '親手發一班晚上 11 點後的車', mark: true },
    ] },
    { id: 'route', name: '路線', note: '排班走過的路', list: [
      { id: 'east', name: '東線', desc: '全程跑完臺東線', mark: true },
      { id: 'south', name: '南迴', desc: '翻過南迴線', mark: true },
      { id: 'loop', name: '環島', desc: '單趟繞完臺灣一圈', mark: true },
      { id: 'coast', name: '海線', desc: '走完竹南到彰化的海線', mark: true },
      { id: 'alishan', name: '上山', desc: '開上阿里山線', mark: true },
    ] },
    { id: 'meet', name: '相遇', note: '路上和真車的交會', list: [
      { id: 'meet1', name: '初會', desc: '第一次和真車交會', stat: 'meets', goal: 1 },
      { id: 'meet100', name: '百會', desc: '交會真車 100 次', stat: 'meets', goal: 100 },
      { id: 'meet1k', name: '千會', desc: '交會真車 1,000 次', stat: 'meets', goal: 1e3, plate: 'double' },
      { id: 'twin', name: '本尊', desc: '和同款真車交會' },
      { id: 'kin', name: '手足', desc: '和自己另一列自製車交會' },
    ] },
    { id: 'scene', name: '時刻與地景', note: '什麼時候經過哪裡', list: [
      { id: 'sunrise', name: '日出', desc: '日出時經過太麻里', mark: true },
      { id: 'sunset', name: '落日', desc: '日落時走在海線上', mark: true },
      { id: 'tropic', name: '回歸', desc: '穿過北回歸線', mark: true },
      { id: 'midnight', name: '跨夜', desc: '跑過午夜 12 點', mark: true },
    ] },
    { id: 'festival', name: '節日', note: '那一天它在線上', list: [
      { id: 'newyear', name: '跨年', desc: '12/31 午夜還在跑', mark: true },
      { id: 'lunar', name: '除夕', desc: '除夕夜在線上', mark: true },
      { id: 'birthday', name: '生日', desc: '首航週年當天在線上', mark: true },
    ] },
    { id: 'weather', name: '天氣', note: '跟著車的時候才算', source: '資料來源：中央氣象署', list: [
      { id: 'rain', name: '雨行', desc: '穿過雨區', mark: true },
      { id: 'fog', name: '霧行', desc: '在霧裡跑完一段', mark: true },
      { id: 'clear', name: '放晴', desc: '出發時下雨、抵達時放晴', mark: true },
    ] },
  ];
  const FLEET_HONORS = [
    { id: 'full', name: '滿庫', desc: '排滿 6 股', stat: 'tracks', goal: 6, deco: '招牌金字' },
    { id: 'five', name: '齊發', desc: '5 列同時在線上', stat: 'peak', goal: 5, deco: '門架紅旗' },
    { id: 'three', name: '三鐵', desc: '臺鐵、高鐵、阿里山各有一列', stat: 'systems', goal: 3, deco: '站前大鐘' },
    { id: 'dex', name: '圖鑑', desc: '6 列全是不同車款', stat: 'models', goal: 6, deco: '車款牆' },
    { id: 'km100k', name: '十萬', desc: '車隊累計 100,000 公里', stat: 'km', goal: 1e5, deco: '里程碑' },
    { id: 'sun', name: '日不落', desc: '一整天隨時都有一列在跑', stat: 'cover', goal: 1, deco: '屋頂塔燈' },
  ];
  // 路上有同款真車的車款，其他車款拿不到「本尊」。scripts/verify_my_train_honors.mjs 拿 formations.js 比對。
  const TWIN_MODELS = ['dr1000', 'emu800', 'haifeng', 'shanlan', 'e200', 'blue', 'temu1000', 'temu2000', 'e1000', 'e500', 'emu3000', 'dr3100', 'mingri', '700t', 'dl25'];
  // 畫框上那一排六枚。
  const HONOR_SHELF = ['maiden', 'days10', 'km1k', 'km10k', 'days100', 'days365'];
  const honorList = HONOR_GROUPS.flatMap(g => g.list);
  const MARK_IDS = honorList.filter(h => h.mark).map(h => h.id);
  // 車牌框：bg 底、line 框線、ink 字；base 是預設，用排班時選的車牌顏色，所以沒有固定的底色。by 是哪一枚成就給的。
  const PLATES = {
    base: { name: '原色', by: null },
    bronze: { name: '銅', bg: '#2A4A73', line: '#D0935C', ink: '#FFFDF6', by: 'km1k' },
    silver: { name: '銀', bg: '#2A4A73', line: '#DCE1E6', ink: '#FFFDF6', by: 'km10k' },
    gold: { name: '金', bg: '#2A4A73', line: '#E9B949', ink: '#FFE9B0', by: 'earth' },
    moon: { name: '月光', bg: '#171F38', line: '#CFD8F0', ink: '#EEF2FF', by: 'moon' },
    enamel: { name: '琺瑯紅', bg: '#B83226', line: '#FFFDF6', ink: '#FFFDF6', by: 'days365' },
    glove: { name: '白手套', bg: '#FFFDF6', line: '#2A4A73', ink: '#2A4A73', by: 'hand100' },
    double: { name: '雙線', bg: '#2A4A73', line: '#FFFDF6', ink: '#FFFDF6', by: 'meet1k', dbl: true },
  };

  const dayNo = d => Date.parse(d + 'T00:00:00Z') / 864e5;
  const dayOf = n => new Date(n * 864e5).toISOString().slice(0, 10);
  const dayMs = d => Date.parse(d + 'T00:00:00+08:00');
  const honorGiver = earned => (id, day) => { if (!earned[id] || day < earned[id]) earned[id] = day; };
  // 除夕的日期，農曆新年前一天。scripts/verify_my_train_honors.mjs 拿 Intl 的農曆逐日比對。
  const LUNAR_EVE = new Set(['2026-02-16', '2027-02-05', '2028-01-25', '2029-02-12', '2030-02-02', '2031-01-22', '2032-02-10', '2033-01-30', '2034-02-18',
    '2035-02-07', '2036-01-27', '2037-02-14', '2038-02-03', '2039-01-23', '2040-02-11', '2041-01-31', '2042-01-21', '2043-02-09', '2044-01-29', '2045-02-16', '2046-02-05']);
  const EVE_FROM = 18 * 3600;   // 除夕夜從晚上 6 點算
  const TROPIC_LAT = 23.4365;
  const TAIMALI = [22.619, 121.005], TONGXIAO = [24.492, 120.678];
  const HORIZON = -0.83;        // 太陽上緣切地平線的高度角（含大氣折射）
  const birthdayOf = (day, first) => day > first
    && (day.slice(5) === first.slice(5) || (first.slice(5) === '02-29' && day.slice(5) === '02-28' && dayOf(dayNo(day) + 1).slice(5) === '03-01'));
  // 環上的七段幹線都走到才算繞完一圈；山線、海線擇一，竹南到彰化中間起訖的車走不到也沒關係。
  const LOOP_TRUNKS = LOOP_LINES.filter(id => id !== '山線' && id !== '海線');
  // 路線本身的特徵。stops 是時刻表上的站，順序跟 route.stops 相同。
  function routeTraits(graph, route, stops) {
    const keys = route.stops.map(s => s.key), have = new Set(keys), dep = stops[0].depSec;
    const on = (key, id) => graph.nodes.get(key).lines[id] != null;
    const covers = id => { const all = [...graph.nodes.keys()].filter(k => on(k, id)); return all.length > 1 && all.every(k => have.has(k)); };
    const touches = id => keys.some((k, i) => i > 0 && on(k, id) && on(keys[i - 1], id));
    const tags = [];
    if (covers('臺東線')) tags.push('east');
    if (covers('南迴線')) tags.push('south');
    if (LOOP_TRUNKS.every(touches)) tags.push('loop');
    if (covers('海線')) tags.push('coast');
    if (touches('AFR_MAIN')) tags.push('alishan');
    const lats = route.stops.map(s => s.lat);
    if (Math.min(...lats) < TROPIC_LAT && Math.max(...lats) > TROPIC_LAT) tags.push('tropic');
    const rise = keys.indexOf(MyTrainPlan.stationKey(TRA, '太麻里'));
    const sea = keys.flatMap((k, i) => (i > 0 && on(k, '海線') && on(keys[i - 1], '海線') ? [i - 1, i] : []));
    return {
      tags, rise: rise >= 0 ? stops[rise].arrSec - dep : null,
      set: sea.length ? [stops[sea[0]].arrSec - dep, stops[sea[sea.length - 1]].arrSec - dep] : null,
    };
  }
  // 跑完的一趟給哪些成就。start 是發車的毫秒、dur 是全程秒。每日班次與親手趟都走這裡。
  function runHonors(give, leg, start, dur, firstDay, sun) {
    const end = start + dur * 1000, day = taipeiDay(start), endDay = taipeiDay(end);
    for (const k of leg.tags) give(k, endDay);
    if (leg.twin) give('twin', endDay);
    if (leg.kin.length) give('kin', endDay);
    if (endDay > day) {
      give('midnight', endDay);
      if (day.endsWith('-12-31')) give('newyear', endDay);
    }
    for (const eve of day === endDay ? [day] : [day, endDay]) {
      if (LUNAR_EVE.has(eve) && start < dayMs(eve) + 864e5 && end > dayMs(eve) + EVE_FROM * 1000) give('lunar', eve);
    }
    if (birthdayOf(day, firstDay)) give('birthday', day);
    if (!sun) return;
    if (leg.rise !== null) {
      const at = start + leg.rise * 1000, e = sun(at, TAIMALI[0], TAIMALI[1]).elevation;
      // 日出前幾分鐘到日出後半小時，太陽還貼著海面。早上才算，傍晚的同樣高度是日落。
      if (e >= -2 && e <= 6 && (at - dayMs(taipeiDay(at))) < 12 * 3600e3) give('sunrise', taipeiDay(at));
    }
    if (leg.set) {
      const a = start + leg.set[0] * 1000, b = start + leg.set[1] * 1000;
      if (sun(a, TONGXIAO[0], TONGXIAO[1]).elevation > HORIZON && sun(b, TONGXIAO[0], TONGXIAO[1]).elevation <= HORIZON) give('sunset', taipeiDay(b));
    }
  }
  const legOn = (legs, day) => { let hit = null; for (const l of legs) if (l.day <= day) hit = l; return hit; };
  function numberHonors(give, stats, day) {
    for (const h of honorList) if (h.stat && stats[h.stat] >= h.goal) give(h.id, day);
  }
  // 從上次判斷的隔天補算到現在。當天的班次跑完才算那一天。
  function judgeTrain(train, today, nowSec, sun) {
    const earned = { ...train.earned }, give = honorGiver(earned), first = train.firstDay || today;
    const last = dayNo(today) - (doneToday(train.legs[train.legs.length - 1], nowSec) ? 0 : 1);
    const from = train.judged ? dayNo(train.judged) + 1 : dayNo(first);
    for (let n = from; n <= last; n++) {
      const day = dayOf(n), leg = legOn(train.legs, day);
      if (leg && leg.dur > 0) runHonors(give, leg, dayMs(day) + leg.dep * 1000, leg.dur, first, sun);
      numberHonors(give, MyTrainPlan.fleetStats(train, dayOf(n + 1)), day);
    }
    numberHonors(give, MyTrainPlan.fleetStats(train, today, nowSec), today);
    return { ...train, earned, judged: last >= from ? dayOf(last) : train.judged };
  }
  // 親手趟跑完收掉，順便看這一趟給了什麼。
  function finishRun(train, sun) {
    const run = train.outRun, leg = train.legs[train.legs.length - 1];
    if (!run || !leg) return { ...train, outRun: null };
    const earned = { ...train.earned };
    runHonors(honorGiver(earned), leg, run.at, run.dur, train.firstDay || taipeiDay(run.at), sun);
    return { ...train, outRun: null, earned };
  }
  // 跟車時的天氣取樣給哪些成就。samples：[{ at 毫秒, rain 有沒有下雨, fog 0～1 }]，start、end 是這一趟的毫秒。
  function weatherHonors(samples, start, end) {
    const out = [], fogs = samples.filter(s => s.fog >= .5);
    const late = samples.filter(s => s.at >= end - 600e3);
    if (samples.some(s => s.rain)) out.push('rain');
    if (fogs.length && fogs[fogs.length - 1].at - fogs[0].at >= 300e3) out.push('fog');
    if (samples.some(s => s.rain && s.at <= start + 600e3) && late.length && !late.some(s => s.rain)) out.push('clear');
    return out;
  }
  // /api/weather 的一筆。規則跟 App 的 railcore LiveWeather 同一份：雷達 3×3 最大值 20 dBZ 以上算下雨，霧看測站能見度與天氣欄。
  const numOf = s => (s.trim() !== '' && Number.isFinite(+s) ? +s : null);
  function visibilityKm(v) {
    if (typeof v !== 'string') return null;
    const s = v.trim(), rest = numOf(s.slice(1)), parts = s.split('-');
    if (s[0] === '<') return rest === null ? null : rest / 2;
    if (s[0] === '>') return rest === null ? null : rest + 1;
    if (parts.length === 2 && numOf(parts[0]) !== null && numOf(parts[1]) !== null) return (+parts[0] + +parts[1]) / 2;
    return numOf(s);
  }
  function fogOf(weather, vis) {
    const km = visibilityKm(vis);
    let f = km === null ? null : Math.min(1, Math.max(0, (10 - km) / 9.5));
    if (typeof weather === 'string') {
      if (weather.includes('霧')) f = Math.max(f ?? 0, .85);
      else if (weather.includes('靄') || weather.includes('霾')) f = Math.max(f ?? 0, .3);
      else if (f === null) f = 0;
    }
    return f;
  }
  // 格式不對回 null，呼叫端當成沒資料。
  function weatherFrame(body) {
    const r = body && body.radar, at = r ? Date.parse(r.at) : NaN;
    if (!Number.isFinite(at)) return null;
    let cells = null;
    try { cells = Uint8Array.from(atob(r.data), c => c.charCodeAt(0)); } catch (e) { cells = null; }
    const radar = cells && r.w > 0 && r.h > 0 && r.res > 0 && cells.length === r.w * r.h ? { lon0: r.lon0, lat0: r.lat0, res: r.res, w: r.w, h: r.h, cells } : null;
    const o = body.obs || {}, f = Array.isArray(o.fields) ? o.fields : [], iLon = f.indexOf('lon'), iLat = f.indexOf('lat'), iW = f.indexOf('weather'), iV = f.indexOf('vis');
    const stations = [];
    for (const c of Array.isArray(o.rows) ? o.rows : []) {
      const fog = Array.isArray(c) ? fogOf(c[iW], c[iV]) : null;
      if (fog !== null && Number.isFinite(c[iLon]) && Number.isFinite(c[iLat])) stations.push({ lon: c[iLon], lat: c[iLat], fog });
    }
    return { at, radar, stations };
  }
  function weatherAt(frame, lon, lat) {
    const r = frame.radar;
    let dbz = 0;
    if (r) {
      const i = Math.round((lon - r.lon0) / r.res), j = Math.round((lat - r.lat0) / r.res);
      for (let y = j - 1; y <= j + 1; y++) for (let x = i - 1; x <= i + 1; x++) {
        const v = x < 0 || y < 0 || x >= r.w || y >= r.h ? 255 : r.cells[y * r.w + x];
        if (v !== 255 && v > dbz) dbz = v;
      }
    }
    // 25 公里內最近 4 站，距離平方反比；一站都沒有當成無霧。
    const kx = 111.32 * Math.cos(lat * Math.PI / 180);
    const near = frame.stations.map(s => ({ w: 1 / (((s.lon - lon) * kx) ** 2 + ((s.lat - lat) * 110.57) ** 2 + 1), fog: s.fog }))
      .filter(s => 1 / s.w - 1 <= 625).sort((a, b) => b.w - a.w).slice(0, 4);
    const sum = near.reduce((n, s) => n + s.w, 0);
    return { rain: dbz >= 20, fog: sum ? near.reduce((n, s) => n + s.w * s.fog, 0) / sum : 0 };
  }
  // 一天裡每一列在線上的時段，過午夜的切成兩段。
  function fleetSpans(trains, nowMs) {
    const spans = [];
    const add = (id, dep, dur) => {
      const end = dep + dur;
      spans.push({ id, a: dep, b: Math.min(end, 86400) });
      if (end > 86400) spans.push({ id, a: 0, b: Math.min(end - 86400, 86400) });
    };
    for (const t of trains) {
      const leg = t.legs[t.legs.length - 1];
      if (leg && leg.dur > 0) add(t.id, leg.dep, leg.dur);
      if (t.outRun && !MyTrainPlan.runEnded(t.outRun, nowMs)) add(t.id, t.outRun.dep, t.outRun.dur);
    }
    return spans;
  }
  // 車隊的現況，成就看這幾個數字。cover 是 1 代表一整天都有車在跑。
  function fleetTotals(trains, today, nowSec, nowMs) {
    const on = trains.filter(t => t.track !== null), spans = fleetSpans(on, nowMs);
    let reach = 0;
    for (const s of [...spans].sort((x, y) => x.a - y.a)) if (s.a <= reach) reach = Math.max(reach, s.b);
    return {
      tracks: on.length, peak: Math.max(0, ...spans.map(s => new Set(spans.filter(o => o.a <= s.a && o.b > s.a).map(o => o.id)).size)),
      systems: new Set(on.map(t => t.sys)).size, models: new Set(on.map(t => t.modelId)).size,
      km: km1(trains.reduce((n, t) => n + MyTrainPlan.fleetStats(t, today, nowSec).km, 0)), cover: reach >= 86400 ? 1 : 0,
    };
  }
  // 判斷整個車隊。回傳新的 trains、earned，fresh 是這一輪新拿到的 [{ train, id }]，train 是 null 代表車隊成就。
  function judgeFleet(fleet, today, nowSec, nowMs, sun) {
    let trains = fleet.trains.map(t => (t.outRun && MyTrainPlan.runEnded(t.outRun, nowMs) ? MyTrainPlan.finishRun(t, sun) : t))
      .map(t => MyTrainPlan.judgeTrain(t, today, nowSec, sun));
    // 交會是互相的：A 掃到 B，B 也算。
    const met = new Map();
    for (const t of trains) for (const k of t.legs[t.legs.length - 1]?.kin || []) met.set(k, t.earned.kin || today);
    trains = trains.map(t => {
      if (!met.has(t.id) || t.earned.kin) return t;
      return { ...t, earned: { ...t.earned, kin: met.get(t.id) } };
    });
    const earned = { ...fleet.earned }, give = honorGiver(earned), totals = fleetTotals(trains, today, nowSec, nowMs);
    for (const h of FLEET_HONORS) if (totals[h.stat] >= h.goal) give(h.id, today);
    const fresh = [];
    trains.forEach((t, i) => { for (const id of Object.keys(t.earned)) if (!fleet.trains[i].earned[id]) fresh.push({ train: t.id, id }); });
    for (const id of Object.keys(earned)) if (!fleet.earned[id]) fresh.push({ train: null, id });
    const changed = fresh.length > 0 || trains.some((t, i) => t.judged !== fleet.trains[i].judged || t.outRun !== fleet.trains[i].outRun);
    return { trains, earned, fresh, changed };
  }

  globalThis.MyTrainPlan = {
    MODELS, familyStatus, normalizeName, nameLength, validateName, stationKey, NAME_MAX,
    COLOR_PALETTE, defaultColor, normalizeColor,
    buildGraph, findRoute,
    stationTiers, applyPattern,
    haversineKm, nameLocations, aliasBaseName,
    buildRunStats, runSpeed, dwellSec, physMinSec,
    buildTimetable, planTrain,
    tripRel, scanSpan, tripDay, tripDayCheck, stopEventsBetween, addEvent,
    TRACKS, FLEET_MAX, DEVICE_RE, taipeiDay, fleetFields, assignTracks, freeTrack, fleetPut, firstRunDay, legOf, syncLegs, addHandRun, runEnded, fleetStats,
    HONOR_GROUPS, FLEET_HONORS, HONOR_SHELF, MARK_IDS, PLATES, earnedOf, routeTraits, judgeTrain, judgeFleet, finishRun, fleetTotals, weatherHonors, weatherFrame, weatherAt, TWIN_MODELS,
  };
})();
