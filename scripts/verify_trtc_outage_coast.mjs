#!/usr/bin/env node
// 北捷斷線續推驗收：拿 2026-08-15 06:27:31–07:00 真實斷線語料，逐分鐘重放官方名冊的續推位置。
//
// 這支存在的理由（別重新發明）：斷線時後端照契約 hold 住名冊，前端讓每台車照「自己最後一段
// 量到的速度」推完剩下全程。同一條線上各車的 coastCycle 實測散布在 91～1681 秒/站（差 18 倍），
// 於是 20 分鐘就能把車距推到互相超車——214（192 秒/站）被晚 7 分半發車的 217（100 秒/站）超過去，
// 使用者截圖是兩台擠在國父紀念館前後一站。正解是「每站之間用該線固定的站間行車秒」。
//
// 判準刻意不綁任何一個魔術數字（心得 35）：只驗兩件物理事實——
//   (1) 同線同方向的車，沿線先後次序在整段斷線期間不得交換（不得超車）
//   (2) 續推每一段耗時 == 該線該段的固定段秒（＋固定停站秒），而不是該車自己的 coastCycle
// 反向對照：環狀線 Y 沒有段秒資料（segs 為空），必須仍走原本的 per-vehicle 路徑而不是整條不見。

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const TRTC = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'trtc.json'), 'utf8'));
const FIXTURE_DIR = path.join(ROOT, 'fixtures', 'trtc-outage-20260815');

let failures = 0;
const check = (pass, label, detail = '') => {
  if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
};

// ── 從 index.html 抽產品真函式（與 verify_official_roster_frontend 同一套抽法） ──────────
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`找不到 function ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0, mode = 'code', escaped = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (mode === 'line') { if (c === '\n') mode = 'code'; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; i++; } continue; }
    if (mode === 'single' || mode === 'double' || mode === 'template') {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"') ||
          (mode === 'template' && c === '`')) mode = 'code';
      continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === "'") { mode = 'single'; continue; }
    if (c === '"') { mode = 'double'; continue; }
    if (c === '`') { mode = 'template'; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`function ${name} 未閉合`);
}
function extractConst(source, name) {
  const m = source.match(new RegExp(`const\\s+${name}\\s*=\\s*[^;]+;`));
  if (!m) throw new Error(`找不到 const ${name}`);
  return m[0];
}

const FUNCTIONS = [
  'runBetween', 'posAlongShape', 'posBetweenStations',
  'trtcOfficialCoastCycle', 'trtcOfficialCoastByCycle', 'trtcOfficialCoastPosition',
  'trtcOfficialDeparturePosition',
  'trtcOfficialTimelinePosition', 'trtcOfficialVehiclePosition',
  'trtcOfficialPositionProgress', 'trtcOfficialMotionStep', 'trtcOfficialPositionAtProgress',
  'trtcOfficialSegmentSeconds', 'trtcOfficialForwardLimit', 'trtcOfficialDwellAt', 'trtcGapUnitsAt',
  'trtcOfficialArrivalTarget', 'trtcOfficialDwellUntil', 'trtcOfficialStopState',
  'trtcCdTrackDisplayOverlap', 'trtcOfficialDisplaySet', 'trtcOfficialDisplayPosition',
];
const CONSTS = ['TRTC_OFFICIAL_COAST_DWELL_MIN_SEC', 'TRTC_OFFICIAL_COAST_DWELL_DEFAULT_SEC',
  'TRTC_OFFICIAL_COAST_DWELL_SEC', 'TRTC_OFFICIAL_RESYNC_MIN_COAST_SEC', '_trtcOfficialResync',
  'TRTC_MIN_GAP_KM', 'TRTC_OFFICIAL_SNAP_FORWARD_M', 'TRTC_OFFICIAL_CATCHUP_FACTOR', '_trtcOfficialCorrect'];

function buildApi(source = INDEX) {
  const consts = CONSTS.map(n => { try { return extractConst(source, n); } catch { return ''; } }).join('\n');
  const bundle = `
    ${consts}
    ${extractConst(source, '_trtcOfficialDisplay')}
    ${FUNCTIONS.map(n => extractFunction(source, n)).join('\n')}
    globalThis.__api = { ${FUNCTIONS.join(',')}, displayCache: _trtcOfficialDisplay };
  `;
  const context = { Date, Math, Number, String, Array, Map, Set, Object };
  vm.createContext(context);
  vm.runInContext(bundle, context, { filename: 'outage.product.js' });
  return context.__api;
}

// ── 線路物件：直接用產品資料，不自己捏假線（判準與實作不可同源，心得 29） ────────────────
const LINES = new Map();
{
  const raw = TRTC.lines || TRTC;
  const arr = Array.isArray(raw) ? raw : Object.entries(raw).map(([id, v]) => ({ id, ...v }));
  for (const l of arr) LINES.set(l.id, l);
}

// ── 語料 ────────────────────────────────────────────────────────────────────────
const sample = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'outage_0649.json'), 'utf8'));
const vehicles = sample.boardPos.vehicles || [];
const SAMPLE_AT = Number(sample.boardPos.at);

// 語料自我檢查：這份必須真的是「斷線中」的樣本，否則整支驗的是別的東西（心得 32）
{
  const trtcAges = vehicles.filter(v => v.line !== 'Y').map(v => SAMPLE_AT - Number(v.observedEpoch));
  const freshest = Math.min(...trtcAges);
  check(freshest > 600,
    '語料自我檢查：outage_0649 真的是斷線中的樣本',
    `北捷最新一筆官方觀測距今 ${freshest} 秒（>600 才算斷線）`);
  check(sample.board.every(r => !/松山機場|忠孝復興|台北車站|西門/.test(r.name)),
    '語料自我檢查：斷線期間官方看板已無北捷列',
    `board ${sample.board.length} 列`);
}

// ── 重放：斷線起算每 30 秒取一次位置，換算成沿線里程 ────────────────────────────
// 沿線進度＝站索引 + 段內比例，再用資料檔的站間里程(d)換成公里。
//
// 🔴 為什麼不用「把畫出來的 lat/lon 投影到 shape 折線」那種更獨立的量法：試過，不可靠。
// R 線關渡段折線幾乎 180° 折回、兩支疊在一起，投影會在兩支之間跳，量出**根本沒發生的**超車
// （實測那兩台車的 motionFrom/motionTo/fraction 全程都沒有交換次序，是判準自己在跳）。
// 收窄搜尋窗到 ±1.2km、加 100m 殘差門檻都無效，因為兩支的殘差都接近 0。
//
// 兩條路徑對 atStation 的錨點語意不同，這裡明確分開處理（不分開就會每次停站抖一站）：
//   續推路徑：motionFrom=here-step, motionTo=here ⇒ 車在 motionTo
//   時間軸路徑：等發車時 motionFrom=本段起站 ⇒ 車在 motionFrom
function routeProgress(pos, ln) {
  if (!pos || !ln) return null;
  const from = Number(pos.motionFrom), to = Number(pos.motionTo);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  const st = ln.stations;
  const dAt = i => {
    const s = st[Math.max(0, Math.min(st.length - 1, i))];
    return s && Number.isFinite(Number(s.d)) ? Number(s.d) : i;
  };
  if (pos.atStation) return dAt(pos.coasted ? to : from);
  const f = Math.max(0, Math.min(1, Number(pos.fraction) || 0));
  return dAt(from) + (dAt(to) - dAt(from)) * f;
}
// 官方時間軸最後一筆到站——之後才是「續推」的領域，判準 2/3 只量那一段
function timelineEnd(v) {
  const tl = Array.isArray(v.timeline) ? v.timeline : [];
  let end = Number(v.arrEpoch);
  for (const s of tl) {
    const a = Number(s.arrEpoch);
    if (Number.isFinite(a) && a > end) end = a;
  }
  return end;
}

function replay(api, { label }) {
  const overtakes = [];
  const evaporated = new Map();
  const groups = new Map();
  for (const v of vehicles) {
    const key = `${v.line}|${v.dir}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }
  for (const [key, group] of groups) {
    const [lineId] = key.split('|');
    const ln = LINES.get(lineId);
    if (!ln || group.length < 2) continue;
    let prevOrder = null;
    for (let t = 0; t <= 1800; t += 30) {
      const now = SAMPLE_AT + t;
      const live = [];
      for (const v of group) {
        const pos = api.trtcOfficialVehiclePosition(ln, v, now);
        const p = routeProgress(pos, ln);
        if (p != null) live.push({ id: v.vehicleId, no: v.officialNo, p });
      }
      // 只比「兩個時刻都還在線上」的那些車的相對次序。GAP 是投影誤差的容忍帶（公尺級）：
      // 兩車在 20 公尺內時不判定先後，避免把折線投影的數值雜訊當成超車。
      const GAP = 0.02;
      if (prevOrder) {
        for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
          const a = live[i], b = live[j];
          const pa = prevOrder.get(a.id), pb = prevOrder.get(b.id);
          if (pa == null || pb == null) continue;
          const wasAhead = pa - pb, nowAhead = a.p - b.p;
          if (Math.abs(wasAhead) > GAP && Math.abs(nowAhead) > GAP &&
              Math.sign(wasAhead) !== Math.sign(nowAhead))
            overtakes.push({ line: lineId, dir: key.split('|')[1], t,
              a: a.no || a.id, b: b.no || b.id,
              before: `${pa.toFixed(2)} vs ${pb.toFixed(2)}`, after: `${a.p.toFixed(2)} vs ${b.p.toFixed(2)}` });
        }
      }
      prevOrder = new Map(live.map(x => [x.id, x.p]));
      if (t === 1800) evaporated.set(key, { total: group.length, left: live.length });
    }
  }
  return { overtakes, evaporated, label };
}

const api = buildApi();

// ── 判準 1：斷線期間不得發生超車 ────────────────────────────────────────────────
{
  const { overtakes } = replay(api, { label: 'fixed' });
  const hasSegs = id => { const l = LINES.get(id); return !!(l && l.segs && l.segs.length); };
  const fixed = overtakes.filter(o => hasSegs(o.line));
  const noSegs = overtakes.filter(o => !hasSegs(o.line));
  const txt = list => list.slice(0, 3).map(o =>
    `${o.line} dir${o.dir} +${o.t}s ${o.a} vs ${o.b}（${o.before} → ${o.after}）`).join('；');
  check(fixed.length === 0,
    '斷線 30 分鐘重放：有固定段秒的線零超車',
    fixed.length ? `${fixed.length} 次超車，例：${txt(fixed)}` : '0 次（BR/R/G/O/BL 全線）');
  // 已知限制，明講不藏：環狀線沒有段秒資料 ⇒ 只能走 per-vehicle 週期，仍可能超車。
  // 它走新北捷另一支上游、這次全程沒斷，所以不是現行風險；要根治得先補 Y 的段秒。
  console.log(`ℹ️  環狀線 Y（無段秒、仍走 per-vehicle 週期）重放中 ${noSegs.length} 次超車${noSegs.length ? `，例：${txt(noSegs)}` : ''}`);
}

// ── 判準 2：續推每段耗時 == 該線固定段秒（不是該車自己的 coastCycle） ──────────────
{
  const bad = [];
  for (const v of vehicles) {
    const ln = LINES.get(v.line);
    if (!ln || !ln.segs || !ln.segs.length) continue;       // Y 無段秒，見判準 4
    const step = Number(v.dir) === 2 ? 1 : -1;
    const to = Number(v.to), dest = Number(v.dest);
    if (!Number.isInteger(to) || !Number.isInteger(dest)) continue;
    if ((dest - to) * step < 2) continue;                    // 至少要有兩段才驗得到節奏
    // 量「連續兩次抵站」的間隔。起點必須落在官方時間軸之後——時間軸那一段走的是官方 ETA，
    // 本來就不等於固定段秒，把它算進來等於在驗錯東西。
    const base = timelineEnd(v);
    const arrivals = [];
    let last = null;
    for (let t = 0; t <= 3600; t += 1) {
      const pos = api.trtcOfficialVehiclePosition(ln, v, base + t);
      if (!pos) break;
      if (!pos.coasted) continue;
      const cur = Number(pos.motionTo);
      if (pos.atStation && last !== cur) { arrivals.push({ at: t, station: cur }); last = cur; }
    }
    for (let i = 1; i < arrivals.length && i < 6; i++) {
      const seg = api.runBetween(ln, arrivals[i - 1].station, arrivals[i].station);
      if (!(seg > 0)) continue;
      const gap = arrivals[i].at - arrivals[i - 1].at;
      // 停站秒取該站的官方值(臺北捷運「相鄰兩站間之行駛時間及停靠站時間」),沒有才退回 25。
      const dw = Array.isArray(ln.dwellSec) ? Number(ln.dwellSec[arrivals[i - 1].station]) : NaN;
      const expect = seg + (dw > 0 ? dw : 25);                // 固定段秒 + 該站官方停站秒
      if (Math.abs(gap - expect) > 2)
        bad.push(`${v.line} ${v.officialNo || v.vehicleId} 第${i}段 實測${gap}s 應為${expect}s（段秒${seg}）`);
    }
  }
  check(bad.length === 0,
    '續推節奏 == 該線固定段秒 + 固定停站秒',
    bad.length ? `${bad.length} 段不符，例：${bad.slice(0, 3).join('；')}` : '全部相符');
}

// ── 判準 3：同一段路，不同車走同樣久（節奏不再隨車而異） ─────────────────────────
{
  const perLine = new Map();
  for (const v of vehicles) {
    const ln = LINES.get(v.line);
    if (!ln || !ln.segs || !ln.segs.length) continue;
    const step = Number(v.dir) === 2 ? 1 : -1;
    const to = Number(v.to), dest = Number(v.dest);
    if (!Number.isInteger(to) || !Number.isInteger(dest) || (dest - to) * step < 2) continue;
    const base = timelineEnd(v);
    let first = null, second = null, last = null;
    for (let t = 0; t <= 3600; t += 1) {
      const pos = api.trtcOfficialVehiclePosition(ln, v, base + t);
      if (!pos) break;
      if (!pos.coasted) continue;
      const cur = Number(pos.motionTo);
      if (pos.atStation && last !== cur) {
        if (first == null) first = { at: t, station: cur };
        else if (second == null) { second = { at: t, station: cur }; break; }
        last = cur;
      }
    }
    if (!first || !second) continue;
    const seg = api.runBetween(ln, first.station, second.station);
    if (!(seg > 0)) continue;
    const key = `${v.line}|${first.station}->${second.station}`;
    if (!perLine.has(key)) perLine.set(key, new Set());
    perLine.get(key).add(second.at - first.at);
  }
  // 掃描粒度是 1 秒，同一段允許 ±1 秒的取樣誤差
  const varied = [...perLine].filter(([, s]) => Math.max(...s) - Math.min(...s) > 1);
  check(varied.length === 0,
    '同一段路不同車耗時一致',
    varied.length ? varied.slice(0, 3).map(([k, s]) => `${k}: ${[...s].join('/')}`).join('；') : `${perLine.size} 段皆一致`);
}

// ── 判準 4：反向對照——環狀線 Y 沒有段秒，不得因此整條不見 ──────────────────────
{
  const y = vehicles.filter(v => v.line === 'Y');
  const ln = LINES.get('Y');
  // 🔴 2026-08-18:環狀線當天補進了官方段秒,原本「Y 沒有段秒」的前提就此消失。
  // 這條測的契約是「線上沒有段秒資料時不准整條車消失」,所以改成自己把段秒拿掉來測,
  // 判準不再綁在「某條線剛好缺資料」這個會漂移的事實上(judgment 心得 35)。
  const bare = { ...ln, segs: [] };
  const drawn = y.filter(v => api.trtcOfficialVehiclePosition(bare, v, SAMPLE_AT + 60));
  check(!bare.segs.length, '前提：反向對照用的線物件已把段秒清空', `segs=${bare.segs.length}`);
  check(drawn.length > 0,
    '線上沒有段秒資料時仍走原路徑、不整條消失（以環狀線車輛實測）',
    `${drawn.length}/${y.length} 台仍畫得出來`);
}

// ── 判準 5：斷訊回歸正軌——官方資料一回來，續推推過頭的位置必須立刻讓位 ──────────
// 「不倒退」護欄管的是官方 ETA 後修；續推是我們自己的推估，不得靠它把錯位置凍到退場。
function resyncProbe(source) {
  const api2 = buildApi(source);          // 每次都要乾淨的 display cache
  const ln = LINES.get('BL');
  const t0 = 1000000;
  // 一台剛到索引 8、往索引 22 方向的車；官方時間軸只給到這裡就斷訊
  const during = { vehicleId: 'resync', line: 'BL', dir: 2, dest: 22, from: 7, to: 8, run: 100,
    arrEpoch: t0, officialNo: '999', coastCycle: 100,
    timeline: [{ from: 7, to: 8, depEpoch: t0 - 100, arrEpoch: t0 }] };
  let last = null;
  for (let t = 0; t <= 1500; t += 30) last = api2.trtcOfficialDisplayPosition(ln, during, t0 + t);
  const coastedTo = last ? Number(last.motionTo) : null;
  // 官方回來：這台車其實只到索引 10，正在 10→11
  const after = { ...during, from: 10, to: 11, arrEpoch: t0 + 1560,
    timeline: [{ from: 9, to: 10, depEpoch: t0 + 1400, arrEpoch: t0 + 1500 },
               { from: 10, to: 11, depEpoch: t0 + 1530, arrEpoch: t0 + 1560 }] };
  const back = api2.trtcOfficialDisplayPosition(ln, after, t0 + 1545);
  return { coastedTo, backTo: back ? Number(back.motionTo) : null, backCoasted: !!(back && back.coasted) };
}
{
  const r = resyncProbe(INDEX);
  check(r.coastedTo != null && r.coastedTo > 11,
    '前提：斷訊 25 分鐘確實把車續推過頭', `續推到索引 ${r.coastedTo}（官方其實只到 11）`);
  check(r.backTo === 11,
    '斷訊回歸：官方時間軸一回來就改採官方位置',
    `回歸後 motionTo=${r.backTo}（應為 11）`);
}

// ── 突變測試：拿掉回歸分支，判準 5 必須轉紅 ────────────────────────────────────
{
  const anchor = 'if (prior.coasted && !coasted) {';
  const mutated = INDEX.includes(anchor) ? INDEX.replace(anchor, 'if (false) {') : null;
  if (!mutated || mutated === INDEX) check(false, '回歸突變錨點存在', `找不到 ${anchor}`);
  else {
    const r = resyncProbe(mutated);
    check(r.backTo !== 11, '突變（拿掉回歸分支）必須讓「回歸正軌」轉紅',
      `突變後 motionTo=${r.backTo}（被護欄凍在續推位置）`);
  }
}

// ── 突變測試：把續推改回「該車自己的 coastCycle」，判準 1/2/3 必須轉紅 ─────────────
{
  const anchor = 'const legSec = legSecs[leg];';
  const mutated = INDEX.includes(anchor)
    ? INDEX.replace(anchor, 'const legSec = Math.max(1, Number(vehicle.coastCycle) - 25);')
    : null;
  if (!mutated || mutated === INDEX) {
    check(false, '突變測試錨點存在', `找不到錨點 ${anchor}`);
  } else {
    const mapi = buildApi(mutated);
    const { overtakes } = replay(mapi, { label: 'mutant' });
    check(overtakes.length > 0,
      '突變（退回 per-vehicle coastCycle）必須讓「零超車」轉紅',
      `突變後 ${overtakes.length} 次超車`);
  }
}

console.log(`\n${failures ? '❌' : '✅'} 北捷斷線續推：${failures ? `${failures} 項未通過` : '全數通過'}`);
process.exit(failures ? 1 : 0);
