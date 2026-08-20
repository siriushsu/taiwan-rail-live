#!/usr/bin/env node
// 捷運／輕軌模型式壓力測試：用獨立真值世界產生尖峰班次與官方觀測，
// 再把觀測喂進 index.html 當前的正式函式。裁判器不使用正式 vehicleId，
// 而是依物理位置與路線順序重新配對，避免「拿同一套邏輯驗自己」。
//
// 快速試跑： node scripts/stress_metro_simulation.mjs --seeds 20 --hours 0.5
// 單種重播： node scripts/stress_metro_simulation.mjs --seed 18427 --profile chaos --trace
// 當成 gate：node scripts/stress_metro_simulation.mjs --seeds 200 --gate
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const OUTPUT_DIR = process.env.METRO_STRESS_OUTPUT_DIR || path.join(ROOT, 'tmp/metro-stress');
const KM_PER_LON_DEGREE = 111.195;
const DAY = '2026-08-20';

function cliArgs(argv) {
  const out = { seeds: 20, hours: .5, profile: 'both', gate: false, trace: false,
    lines: null, interval: 15, start: 7 * 3600 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--seeds') out.seeds = Math.max(1, Number(next()) || 1);
    else if (a === '--seed') { out.seed = Number(next()) >>> 0; out.seeds = 1; }
    else if (a === '--hours') out.hours = Math.max(.05, Number(next()) || .5);
    else if (a === '--profile') out.profile = String(next() || 'both');
    else if (a === '--lines' || a === '--line') out.lines = String(next() || '').split(',').filter(Boolean);
    else if (a === '--interval') out.interval = Math.max(1, Number(next()) || 15);
    else if (a === '--start') {
      const [h, m = '0'] = String(next()).split(':'); out.start = Number(h) * 3600 + Number(m) * 60;
    }
    else if (a === '--gate') out.gate = true;
    else if (a === '--trace') out.trace = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`不認得參數 ${a}`);
  }
  if (!['clean', 'chaos', 'both'].includes(out.profile)) throw new Error('--profile 只能是 clean、chaos 或 both');
  return out;
}
const OPT = cliArgs(process.argv.slice(2));
if (OPT.help) {
  console.log(`用法: node scripts/stress_metro_simulation.mjs [options]\n\n` +
    `  --seeds N        亂數場景數（預設 20）\n` +
    `  --seed N         只重播指定 seed\n` +
    `  --hours N        每個場景的模擬小時（預設 0.5）\n` +
    `  --profile P      clean | chaos | both（預設 both）\n` +
    `  --lines A,B      只跑指定線 ID，也可用 system:line\n` +
    `  --interval N     官方觀測間隔秒（預設 15）\n` +
    `  --start HH:MM    模擬起點（預設 07:00）\n` +
    `  --trace          把失敗前後的真值／觀測／推算寫入 JSON\n` +
    `  --gate           任一硬性不變量失敗時 exit 1`);
  process.exit(0);
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`找不到 production function ${name}`);
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
  throw new Error(`production function ${name} 大括號未閉合`);
}
function between(start, end) {
  const a = HTML.indexOf(start), b = HTML.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`抽取錨點不存在：${start} / ${end}`);
  return HTML.slice(a, b);
}

const SYSTEM_FILES = [
  ['mrt', 'trtc'], ['tymc', 'tymc'], ['ntdlrt', 'ntdlrt'], ['ntalrt', 'ntalrt'],
  ['sanying', 'sanying'], ['tmrt', 'tmrt'], ['krtc', 'krtc'],
];
function readJson(file) { return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')); }
function loadLines() {
  const out = [];
  for (const [system, stem] of SYSTEM_FILES) {
    const model = readJson(`data/${stem}.json`);
    const timesPath = path.join(ROOT, `data/${stem}_times.json`);
    const times = fs.existsSync(timesPath) ? JSON.parse(fs.readFileSync(timesPath, 'utf8')) : { lines: {} };
    for (const raw of model.lines || []) {
      const line = structuredClone(raw);
      line.system = system; line.key = `${system}:${line.id}`; line.times = times.lines && times.lines[line.id];
      line.stations.forEach((s, i) => { if (!Number.isFinite(Number(s.d))) s.d = i; });
      out.push(line);
    }
  }
  return out;
}
const ALL_LINES = loadLines();
const TRTC_CODES = readJson('data/trtc_codes.json');
const TRTC_CODE_BY_LINE_STATION = new Map();
for (const [code, rec] of Object.entries(TRTC_CODES))
  for (const on of (rec && rec.on) || [])
    if (!TRTC_CODE_BY_LINE_STATION.has(`${on.ln}|${Number(on.i)}`))
      TRTC_CODE_BY_LINE_STATION.set(`${on.ln}|${Number(on.i)}`, code);
function trtcCodeAt(lineId, stationIndex) {
  return TRTC_CODE_BY_LINE_STATION.get(`${lineId}|${Number(stationIndex)}`) || null;
}
const selected = line => !OPT.lines || OPT.lines.some(x => x === line.id || x === line.key);
const LINES = ALL_LINES.filter(selected);
if (!LINES.length) throw new Error('沒有任何路線符合 --lines');

function vmLine(line) {
  const total = Number(line.loopLen) || Number(line.stations.at(-1).d) || line.stations.length - 1;
  return {
    id: line.id, key: line.key, system: line.system, loop: !!line.loop, loopLen: total,
    hasShape: true, shape: [[0, 0], [0, total / KM_PER_LON_DEGREE]], cum: [0, total],
    stations: line.stations.map((s, i) => ({ name: s.name, d: Number(s.d), dwell: Number(s.dwell) || 25,
      lat: 0, lon: Number(s.d) / KM_PER_LON_DEGREE, i })),
    segs: (line.segs || []).map(s => ({ run: Number(s.run) || 90 })),
  };
}
const VM_LINES = LINES.map(vmLine);

function buildScheduleVm() {
  const names = ['freqTrainTime', 'runBetween', 'posBetweenStations', 'buildProfile',
    'profTimeToProg', 'metroProfileFor', 'freqTrainPosRaw'];
  const source = `
const TRTC_BOARD_PERF = { a: 3.6, b: 4.3, v: 80 };
function posAlongShape(ln, d) {
  const L = Number(ln.loopLen) || ln.cum[ln.cum.length - 1];
  const q = ln.loop ? ((d % L) + L) % L : Math.max(0, Math.min(L, d));
  return { lat: 0, lon: q / ${KM_PER_LON_DEGREE} };
}
function haversineKm(a, b) { return Math.abs(Number(b.lon) - Number(a.lon)) * ${KM_PER_LON_DEGREE}; }
${names.map(n => extractFunction(HTML, n)).join('\n')}
this.api = { freqTrainPosRaw, freqTrainTime, runBetween };
`;
  const context = vm.createContext({ console, Math, Number, Map, Set, Array });
  vm.runInContext(source, context);
  return context.api;
}
const SCHEDULE_PRODUCTION = buildScheduleVm();

function buildEntityVm() {
  const models = VM_LINES.filter(line => line.system === 'mrt');
  const codes = readJson('data/trtc_codes.json');
  const context = vm.createContext({ console, Date, JSON, Math, Map, Set, Number, String, Array,
    Blob, File, URL, setTimeout, clearTimeout, models, codes });
  const prelude = `
const BUILD = 'stress', window = {}, navigator = {}, state = { lines: models, decoLines: [] };
const _trtcCodes = codes;
const document = { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } };
function showToast() {}
const _trtcCdDwell = new Map(), _trtcCdDropped = new Map();
const TRTC_BR_DWELL_FALLBACK = 29, TRTC_BR_SAME_TRAIN_RATIO = 1;
const _trtcCdDwellOf = id => _trtcCdDwell.has(id) ? _trtcCdDwell.get(id) : TRTC_BR_DWELL_FALLBACK;
function _trtcCensusNorm(v) { return String(v == null ? '' : v).trim().replace(/站$/, ''); }
function trtcCensusLine(id) { return models.find(line => line.id === id) || null; }
function trtcCensusNames(ln) { return ln.stations.map(s => _trtcCensusNorm(s.name)); }
function trtcCensusRun(ln, from, to) {
  const seg = ln.segs && ln.segs[Math.min(from, to)], v = Number(seg && seg.run); return v > 0 ? v : 90;
}
function trtcOfficialDwellAt(ln, i) { const s = ln && ln.stations && ln.stations[i]; return Number(s && s.dwell) || 25; }
function trtcCountdownFitsSegment(ln, from, to, remainSec) {
  if (!(remainSec > 0)) return true; const run = trtcCensusRun(ln, from, to);
  return !(run > 0) || remainSec <= run + trtcOfficialDwellAt(ln, from);
}
function _trtcBrSharedIdx() { return new Set(); }
function _trtcCdPrefix(id) { return id === 'BR' ? 'brseg:' : String(id).toLowerCase() + 'seg:'; }
function runBetween(ln, from, to) { return trtcCensusRun(ln, from, to); }
function posBetweenStations(ln, from, to, f) {
  const a = ln.stations[from], b = ln.stations[to];
  return { lat: 0, lon: a.lon + (b.lon - a.lon) * f };
}
`;
  const arrivedAndBuilder = between('const _trtcCdArrived = new Map();', '// 🔴 文湖線(BR)的身分與存續:');
  const along = extractFunction(HTML, '_trtcBrAlong');
  const resolver = between('const _trtcCdRosters = new Map();', 'let _trtcCensusPrior = new Map();');
  const censusResolve = extractFunction(HTML, 'trtcCensusResolve');
  const census = between('let _trtcCensusPrior = new Map();', '// 官方看板中斷多久了。');
  const coast = between('function trtcOfficialCoastCycle(vehicle, run) {', 'const _trtcCdDropped = new Map();');
  const vehiclePosition = extractFunction(HTML, 'trtcOfficialVehiclePosition');
  const expose = `
this.api = {
  fromBoard: trtcBrVehiclesFromBoard, restamp: trtcCensusRestampBr,
  census: trtcCensusVehicles,
  position: trtcOfficialVehiclePosition, along: _trtcBrAlong,
  snapshot: trtcEntityDiagnosticsSnapshot,
  reset() { _trtcCdRosters.clear(); _trtcCdDiagFrames.splice(0); _trtcCdArrived.clear(); _trtcCdDwell.clear();
    _trtcCensusPrior = new Map(); _trtcCdOnlyPrior.clear(); _trtcCodeIdx = null; },
  line(id) { return trtcCensusLine(id); },
  constants: { grace: TRTC_CD_MISSING_GRACE_SEC, maxAge: TRTC_CD_MAX_DATA_AGE_SEC }
};`;
  vm.runInContext([prelude, coast, along, arrivedAndBuilder, resolver, censusResolve, census,
    vehiclePosition, expose].join('\n'), context);
  return context.api;
}
const ENTITY_PRODUCTION = buildEntityVm();

function rngFor(seed) {
  let x = seed >>> 0;
  const next = () => { x |= 0; x = x + 0x6D2B79F5 | 0; let t = Math.imul(x ^ x >>> 15, 1 | x);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  next.int = (a, b) => Math.floor(next() * (b - a + 1)) + a;
  next.pick = a => a[Math.floor(next() * a.length)];
  next.normal = () => { const u = Math.max(1e-12, next()), v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return next;
}
function percentile(values, q) {
  const a = values.filter(Number.isFinite).slice().sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.ceil(q * a.length) - 1))] : null;
}
function fmtSec(s) {
  const h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
}
function segRun(line, a, b) {
  const n = line.stations.length;
  if (line.loop) {
    if ((a + 1) % n === b) return Number(line.segs[a] && line.segs[a].run) || 90;
    if ((a - 1 + n) % n === b) return Number(line.segs[b] && line.segs[b].run) || 90;
  }
  return Number(line.segs[Math.min(a, b)] && line.segs[Math.min(a, b)].run) || 90;
}
function segmentDistance(line, a, b) {
  const da = Number(line.stations[a].d), db = Number(line.stations[b].d);
  if (!line.loop) return Math.abs(db - da);
  const L = Number(line.loopLen) || Number(line.stations.at(-1).d);
  const f = ((db - da) % L + L) % L, r = ((da - db) % L + L) % L;
  return Math.min(f, r);
}
// 獨立物理解：用二分找巡航速度，不呼叫 production buildProfile/profTimeToProg。
function truthMoveProgress(distanceKm, seconds, elapsed) {
  if (elapsed <= 0) return 0; if (elapsed >= seconds) return 1;
  const L = distanceKm * 1000, a = 3.6 / 3.6, b = 4.3 / 3.6, vmax = 80 / 3.6;
  if (!(L > 0) || !(seconds > 0)) return elapsed / seconds;
  const distanceAt = v => v * seconds - v * v / (2 * a) - v * v / (2 * b);
  if (distanceAt(vmax) < L) return elapsed / seconds; // production 也會因需超速退等速
  let lo = 0, hi = vmax;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (distanceAt(mid) < L) lo = mid; else hi = mid; }
  const v = (lo + hi) / 2, ta = v / a, td = v / b, tc = Math.max(0, seconds - ta - td);
  let d;
  if (elapsed < ta) d = .5 * a * elapsed * elapsed;
  else if (elapsed < ta + tc) d = .5 * a * ta * ta + v * (elapsed - ta);
  else { const q = elapsed - ta - tc; d = .5 * a * ta * ta + v * tc + v * q - .5 * b * q * q; }
  return Math.max(0, Math.min(1, d / L));
}

function routeSequence(line, dir, startIndex = null) {
  const n = line.stations.length;
  if (line.loop) {
    const s = startIndex == null ? 0 : startIndex;
    return Array.from({ length: n + 1 }, (_, i) => (s + i) % n);
  }
  return dir === 2 ? Array.from({ length: n }, (_, i) => i) : Array.from({ length: n }, (_, i) => n - 1 - i);
}
function buildTruthTrip(line, id, dir, departure, rng, perturb = true, startIndex = null) {
  const seq = routeSequence(line, dir, startIndex), legs = [], events = [];
  let dep = departure, unwrapped = Number(line.stations[seq[0]].d);
  events.push({ station: seq[0], arrival: dep, departure: dep, d: unwrapped });
  for (let i = 0; i + 1 < seq.length; i++) {
    const from = seq[i], to = seq[i + 1], nominal = segRun(line, from, to);
    const run = Math.max(20, nominal * (perturb ? Math.max(.82, Math.min(1.22, 1 + rng.normal() * .07)) : 1));
    const distance = segmentDistance(line, from, to);
    const arr = dep + run, dwell0 = Number(line.stations[to].dwell) || 25;
    // 終點也保留資料檔的停站秒：畫面看得到車進站，停滿才收。
    // 若真值在抵達那格立刻刪掉，會把正常的終點停靠誤報成幽靈車。
    const dwell = Math.max(10, dwell0 * (perturb ? Math.max(.7, Math.min(1.4, 1 + rng.normal() * .1)) : 1));
    let toD = Number(line.stations[to].d);
    if (line.loop && toD <= Number(line.stations[from].d)) toD += Number(line.loopLen);
    if (line.loop && unwrapped >= Number(line.loopLen)) toD += Math.floor(unwrapped / Number(line.loopLen)) * Number(line.loopLen);
    legs.push({ from, to, dep, arr, run, nominal, distance, fromD: unwrapped, toD });
    unwrapped = toD; dep = arr + dwell;
    events.push({ station: to, arrival: arr, departure: dep, d: unwrapped });
  }
  return { id, line: line.key, dir, dest: seq.at(-1), departure, end: events.at(-1).departure, seq, legs, events };
}
function truthState(trip, now, line) {
  if (now < trip.departure || now > trip.end) return null;
  for (let i = 0; i < trip.legs.length; i++) {
    const leg = trip.legs[i], event = trip.events[i + 1];
    if (now <= leg.arr) {
      const f = truthMoveProgress(leg.distance, leg.run, now - leg.dep);
      const unwrappedD = leg.fromD + (leg.toD - leg.fromD) * f;
      let d = unwrappedD;
      if (line.loop) d = ((d % line.loopLen) + line.loopLen) % line.loopLen;
      return { d, unwrappedD, progress: trip.dir === 2 ? unwrappedD : -unwrappedD,
        from: leg.from, to: leg.to, moving: f > 0 && f < 1 };
    }
    if (now < event.departure) {
      const unwrappedD = Number(event.d), d = line.loop
        ? ((unwrappedD % line.loopLen) + line.loopLen) % line.loopLen : unwrappedD;
      return { d, unwrappedD, progress: trip.dir === 2 ? unwrappedD : -unwrappedD,
        from: event.station, to: event.station, moving: false };
    }
  }
  const unwrappedD = Number(trip.events.at(-1).d), d = line.loop
    ? ((unwrappedD % line.loopLen) + line.loopLen) % line.loopLen : unwrappedD;
  return { d, unwrappedD, progress: trip.dir === 2 ? unwrappedD : -unwrappedD,
    from: trip.dest, to: trip.dest, moving: false };
}
function syntheticTrips(line, seed, start, end, load = 1, perturb = true) {
  const rng = rngFor(seed), trips = [];
  const base = Math.max(45, (Number(line.peakHeadwaySec) || 360) * load);
  const nominalDuration = (line.segs || []).reduce((n, s) => n + (Number(s.run) || 90), 0) +
    line.stations.reduce((n, s) => n + (Number(s.dwell) || 25), 0);
  const dirs = line.loop ? [2] : [1, 2];
  for (const dir of dirs) {
    let dep = start - nominalDuration - base + (dir === 1 ? base / 2 : 0), seq = 0;
    while (dep < end) {
      const jitter = seq ? Math.max(.72, Math.min(1.28, 1 + rng.normal() * .08)) : 1;
      // 環線統一從同一站派車，「發車先後」才能當物理前後的獨立參考。
      const startIndex = line.loop ? 0 : null;
      trips.push(buildTruthTrip(line, `${line.key}:${dir}:${seq}`, dir, dep, rng, perturb, startIndex));
      dep += base * jitter; seq++;
    }
  }
  return trips;
}
function flattenTrip(trip) {
  const out = [];
  for (const event of trip.events) out.push(event.station, Math.round(event.departure));
  return out;
}
function circularError(line, a, b) {
  const d = Math.abs(a - b); if (!line.loop) return d;
  const L = Number(line.loopLen); return Math.min(d, Math.abs(L - d));
}

function newScheduleMetrics() { return { samples: 0, errorsM: [], reverse: 0, order: 0, maxErrorM: 0, failures: [] }; }
function runScheduleStress(line, seed, metrics, ring) {
  const load = [.5, .65, .8, 1][seed % 4];
  const trips = syntheticTrips(line, seed ^ 0x51f15e, OPT.start, OPT.start + OPT.hours * 3600, load, false);
  const productionLine = VM_LINES.find(x => x.key === line.key);
  const prior = new Map();
  for (let now = OPT.start; now <= OPT.start + OPT.hours * 3600; now += Math.max(3, OPT.interval)) {
    const byDir = new Map();
    for (const trip of trips) {
      const truth = truthState(trip, now, line); if (!truth) continue;
      const flat = flattenTrip(trip), pos = SCHEDULE_PRODUCTION.freqTrainPosRaw(productionLine, flat, now);
      if (!pos) {
        metrics.failures.push({ type: 'schedule-missing', seed, line: line.key, at: now, truth: trip.id });
        continue;
      }
      const gotD = Number(pos.lon) * KM_PER_LON_DEGREE;
      const errorM = circularError(line, gotD, truth.d) * 1000;
      metrics.samples++; metrics.errorsM.push(errorM); metrics.maxErrorM = Math.max(metrics.maxErrorM, errorM);
      const gotUnwrapped = line.loop
        ? gotD + Math.round((Number(truth.unwrappedD) - gotD) / Number(line.loopLen)) * Number(line.loopLen) : gotD;
      const progress = trip.dir === 2 ? gotUnwrapped : -gotUnwrapped, old = prior.get(trip.id);
      if (old != null && progress + 1e-7 < old) {
        metrics.reverse++; if (metrics.failures.length < 30)
          metrics.failures.push({ type: 'schedule-reverse', seed, line: line.key, at: now, truth: trip.id, old, progress });
      }
      prior.set(trip.id, progress);
      let a = byDir.get(trip.dir); if (!a) byDir.set(trip.dir, a = []);
      a.push({ departure: trip.departure, progress, id: trip.id });
      if (errorM > 20 && metrics.failures.length < 30)
        metrics.failures.push({ type: 'schedule-position', seed, line: line.key, at: now,
          truth: trip.id, expectedKm: truth.d, actualKm: gotD, errorM });
    }
    for (const a of byDir.values()) {
      a.sort((x, y) => x.departure - y.departure);
      for (let i = 1; i < a.length; i++) if (a[i].progress > a[i - 1].progress + 1e-7) {
        metrics.order++; if (metrics.failures.length < 30)
          metrics.failures.push({ type: 'schedule-overtake', seed, line: line.key, at: now, rear: a[i].id, lead: a[i - 1].id });
      }
    }
  }
  if (ring) ring.push({ layer: 'schedule', seed, line: line.key, trips: trips.length, load });
}

function buildBoardRows(line, trips, now, rng, profile, faultState) {
  if (profile === 'chaos' && faultState.outageUntil > now) return { rows: [], evidence: [] };
  if (profile === 'chaos' && rng() < .008) {
    faultState.outageUntil = now + rng.pick([30, 45, 60, 90]); return { rows: [], evidence: [] };
  }
  const rows = [], evidence = [];
  for (const dir of [1, 2]) {
    const step = dir === 2 ? 1 : -1, dest = dir === 2 ? line.stations.length - 1 : 0;
    for (let i = dir === 2 ? 1 : 0; dir === 2 ? i < line.stations.length : i < line.stations.length - 1; i++) {
      let best = null;
      for (const trip of trips) {
        if (trip.dir !== dir) continue;
        const event = trip.events.find(e => e.station === i); if (!event) continue;
        const dwell = Number(line.stations[i].dwell) || 25;
        if (event.arrival < now - dwell || event.arrival > now + 900) continue;
        if (!best || event.arrival < best.event.arrival) best = { trip, event, dwell };
      }
      if (!best) continue;
      if (profile === 'chaos' && rng() < .055) continue; // 單列漏報
      let eta = best.event.arrival;
      if (profile === 'chaos') {
        eta += Math.round(rng.normal() * 4);
        if (rng() < .018) eta += rng.pick([-30, -15, 15, 30, 60]);
      }
      let at = now;
      if (profile === 'chaos' && rng() < .012) at = now - rng.pick([61, 75, 120]);
      // 正在進站時官方會持續把 eta 刷成大約 now-1。
      if (best.event.arrival <= now && now <= best.event.arrival + best.dwell) eta = now - 1;
      const row = { name: line.stations[i].name, dest: line.stations[dest].name, eta, at, no: '',
        _truthId: best.trip.id, _station: i };
      rows.push(row);
      const run = segRun(line, i - step, i), fresh = now - at <= 60;
      if (fresh && eta - now <= run + (Number(line.stations[i - step].dwell) || 25)) evidence.push(best.trip.id);
      if (profile === 'chaos' && rng() < .01) rows.push({ ...row }); // 重複列
    }
  }
  if (profile === 'chaos' && faultState.lastRows.length && rng() < .012) {
    // 亂序／重播前一批；at 保留原值，production 必須自己判齡。
    return { rows: faultState.lastRows.map(r => ({ ...r })), evidence: [] };
  }
  faultState.lastRows = rows.map(r => ({ ...r }));
  return { rows, evidence };
}

function orderedMatch(expected, actual, maxSegKm) {
  const A = expected.slice().sort((a, b) => a.progress - b.progress);
  const B = actual.slice().sort((a, b) => a.progress - b.progress);
  const n = A.length, m = B.length, skip = Math.max(.15, maxSegKm * .7), INF = 1e99;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF));
  const bt = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0)); dp[0][0] = 0;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
    const base = dp[i][j]; if (base === INF) continue;
    if (i < n && j < m) { const c = Math.abs(A[i].progress - B[j].progress);
      if (base + c < dp[i + 1][j + 1]) { dp[i + 1][j + 1] = base + c; bt[i + 1][j + 1] = 1; } }
    if (i < n && base + skip < dp[i + 1][j]) { dp[i + 1][j] = base + skip; bt[i + 1][j] = 2; }
    if (j < m && base + skip < dp[i][j + 1]) { dp[i][j + 1] = base + skip; bt[i][j + 1] = 3; }
  }
  const pairs = [], missing = [], ghosts = []; let i = n, j = m;
  while (i || j) {
    const b = bt[i][j];
    if (b === 1) { pairs.push({ truth: A[i - 1], render: B[j - 1], errorKm: Math.abs(A[i - 1].d - B[j - 1].d) }); i--; j--; }
    else if (b === 2) { missing.push(A[i - 1]); i--; }
    else if (b === 3) { ghosts.push(B[j - 1]); j--; }
    else { if (i) missing.push(A[--i]); else if (j) ghosts.push(B[--j]); }
  }
  return { pairs: pairs.reverse(), missing: missing.reverse(), ghosts: ghosts.reverse() };
}
function newEntityMetrics() {
  return { frames: 0, expected: 0, rendered: 0, errorsM: [], maxErrorM: 0, ghosts: 0, missing: 0,
    identityChanges: 0, swaps: 0, reverse: 0, jumps: 0, followWrong: 0, followDropped: 0,
    failures: [], failureSnapshots: [] };
}
function compactFrame(now, rows, expected, actual, matched) {
  return { at: now, clock: fmtSec(now), rows: rows.map(r => ({ station: r._station, eta: Math.round(r.eta - now),
      age: Math.round(now - r.at), truth: r._truthId })),
    truth: expected.map(x => ({ id: x.id, dir: x.dir, d: +x.d.toFixed(4), evidenceAge: Math.round(now - x.evidenceAt) })),
    rendered: actual.map(x => ({ id: x.id, dir: x.dir, d: +x.d.toFixed(4), from: x.vehicle.from, to: x.vehicle.to,
      source: x.vehicle.source })),
    pairs: matched.pairs.map(p => ({ truth: p.truth.id, render: p.render.id, errorM: Math.round(p.errorKm * 1000) })),
    missing: matched.missing.map(x => x.id), ghosts: matched.ghosts.map(x => x.id) };
}
function entityFailure(metrics, type, seed, line, now, detail, ring) {
  // 單一類（例如連續漏車）不能把 sample 額度全吃掉，否則後面才出現的
  // 逆行／跟錯會被報表藏起來。每類留 5 筆，完整次數另由 metrics 計數。
  if (metrics.failures.filter(x => x.type === type).length >= 5) return;
  metrics.failures.push({ type, seed, line: line.key, at: now, clock: fmtSec(now), ...detail });
  if (OPT.trace && !metrics.failureSnapshots.some(x => x.type === type))
    metrics.failureSnapshots.push({ type, seed, line: line.key, at: now, frames: structuredClone(ring) });
}
function runEntityStress(line, seed, profile, metrics) {
  ENTITY_PRODUCTION.reset();
  const rng = rngFor(seed ^ (profile === 'chaos' ? 0xc4a05 : 0xc1ea5));
  // clean 是「正常尖峰＋乾淨資料」的硬 gate；chaos 才把班距壓到 45–90%、
  // 再叠加區間速度差與漏報。否則「正常基準」也會出現多車同段，而官方每站
  // 只給最近一班，獨立裁判器會把上游結構性不可見誤當 production 漏車。
  const load = profile === 'clean' ? 1 : [.45, .6, .75, .9][seed % 4];
  const trips = syntheticTrips(line, seed ^ 0xe1717, OPT.start, OPT.start + OPT.hours * 3600,
    load, profile === 'chaos');
  const evidenceAt = new Map(), truthToRender = new Map(), lastRender = new Map(), lastPairAt = new Map();
  const priorPos = new Map(), faultState = { outageUntil: -Infinity, lastRows: [] }, ring = [];
  let follow = null, followCooldownUntil = -Infinity;
  const warmup = OPT.start + 60;
  const maxSeg = Math.max(...line.segs.map(s => Number(s.run) || 90).map((_, i) =>
    i + 1 < line.stations.length ? Math.abs(Number(line.stations[i + 1].d) - Number(line.stations[i].d)) : 0));
  for (let now = OPT.start; now <= OPT.start + OPT.hours * 3600; now += OPT.interval) {
    const board = buildBoardRows(line, trips, now, rng, profile, faultState);
    for (const id of board.evidence) evidenceAt.set(id, now);
    const input = ENTITY_PRODUCTION.fromBoard(line.id, board.rows.map(({ _truthId, _station, ...r }) => r), now, DAY) || [];
    ENTITY_PRODUCTION.restamp(line.id, input, now, DAY, true);
    const actual = [];
    for (const vehicle of input) {
      const pos = ENTITY_PRODUCTION.position(ENTITY_PRODUCTION.line(line.id), vehicle, now); if (!pos) continue;
      const d = Number(pos.lon) * KM_PER_LON_DEGREE, progress = Number(vehicle.dir) === 2 ? d : -d;
      actual.push({ id: String(vehicle.vehicleId), dir: Number(vehicle.dir), d, progress, vehicle });
      const old = priorPos.get(String(vehicle.vehicleId));
      if (old && old.dir === Number(vehicle.dir)) {
        const delta = progress - old.progress;
        if (delta < -1e-6) { metrics.reverse++; entityFailure(metrics, 'entity-reverse', seed, line, now,
          { render: vehicle.vehicleId, deltaKm: delta }, ring); }
        const localMax = maxSeg * 1.25;
        if (delta > localMax) { metrics.jumps++; entityFailure(metrics, 'entity-jump', seed, line, now,
          { render: vehicle.vehicleId, deltaKm: delta, from: vehicle.from, to: vehicle.to }, ring); }
      }
      priorPos.set(String(vehicle.vehicleId), { progress, dir: Number(vehicle.dir), at: now });
    }
    const expected = [];
    for (const trip of trips) {
      const at = evidenceAt.get(trip.id); if (at == null || now - at > 45) continue;
      const state = truthState(trip, now, line); if (!state) continue;
      expected.push({ id: trip.id, dir: trip.dir, d: state.d, progress: state.progress, evidenceAt: at, state });
    }
    const aggregate = { pairs: [], missing: [], ghosts: [] };
    for (const dir of [1, 2]) {
      const m = orderedMatch(expected.filter(x => x.dir === dir), actual.filter(x => x.dir === dir), maxSeg);
      aggregate.pairs.push(...m.pairs); aggregate.missing.push(...m.missing); aggregate.ghosts.push(...m.ghosts);
    }
    metrics.frames++; metrics.expected += expected.length; metrics.rendered += actual.length;
    if (now >= warmup) {
      metrics.ghosts += aggregate.ghosts.length;
      for (const x of aggregate.ghosts) {
        // 輪詢最多晚一格才第一次看到「進站中」，終點收車因此可以比
        // 真值晚 interval 秒。這是觀測量化，不是永久幽靈；超過停站＋一格才報錯。
        const dest = Number(x.vehicle.dest), destD = Number(line.stations[dest] && line.stations[dest].d);
        const arr = Number(x.vehicle.arrEpoch), dwell = Number(line.stations[dest] && line.stations[dest].dwell) || 25;
        const terminalGrace = Number.isFinite(destD) && Math.abs(x.d - destD) < .005 &&
          Number.isFinite(arr) && now <= arr + dwell + OPT.interval;
        if (terminalGrace) { metrics.ghosts--; continue; }
        entityFailure(metrics, 'ghost', seed, line, now,
          { render: x.id, d: x.d, source: x.vehicle.source, arrEpoch: arr }, ring);
      }
      for (const x of aggregate.missing) {
        // 候選確認允許第一個 15s frame 暂時不出生；超過才是漏車。
        if (now - x.evidenceAt < OPT.interval * 1.5) continue;
        metrics.missing++;
        entityFailure(metrics, 'missing', seed, line, now, { truth: x.id, d: x.d, evidenceAge: now - x.evidenceAt }, ring);
      }
    }
    const renderIds = new Set(actual.map(x => x.id));
    for (const pair of aggregate.pairs) {
      const errorM = pair.errorKm * 1000; metrics.errorsM.push(errorM); metrics.maxErrorM = Math.max(metrics.maxErrorM, errorM);
      const prevId = truthToRender.get(pair.truth.id), lastAt = lastPairAt.get(pair.truth.id);
      if (prevId && prevId !== pair.render.id && lastAt != null && now - lastAt <= 45) {
        metrics.identityChanges++;
        const swapped = renderIds.has(prevId);
        if (swapped) metrics.swaps++;
        entityFailure(metrics, swapped ? 'identity-swap' : 'identity-rekey', seed, line, now,
          { truth: pair.truth.id, before: prevId, after: pair.render.id, errorM }, ring);
      }
      truthToRender.set(pair.truth.id, pair.render.id); lastPairAt.set(pair.truth.id, now);
      lastRender.set(pair.render.id, pair.truth.id);
    }
    if (!follow && now >= warmup && now >= followCooldownUntil) {
      const cand = aggregate.pairs.find(p => trips.find(t => t.id === p.truth.id)?.end > now + 180);
      if (cand) follow = { truth: cand.truth.id, render: cand.render.id };
    }
    if (follow) {
      const truth = expected.find(x => x.id === follow.truth), rendered = actual.find(x => x.id === follow.render);
      if (!truth) follow = null;
      else if (!rendered) {
        if (now - truth.evidenceAt <= 30) {
          metrics.followDropped++; entityFailure(metrics, 'follow-dropped', seed, line, now,
            { truth: follow.truth, render: follow.render, evidenceAge: now - truth.evidenceAt }, ring);
          // 真網頁在目標 ID 離開名冊後會結束這次跟隨；同一事件不每 15s 重複算一次。
          follow = null; followCooldownUntil = now + 60;
        }
      } else {
        const pair = aggregate.pairs.find(p => p.render.id === follow.render);
        if (pair && pair.truth.id !== follow.truth) { metrics.followWrong++; entityFailure(metrics, 'follow-wrong-train', seed, line, now,
          { wanted: follow.truth, got: pair.truth.id, render: follow.render }, ring); }
      }
    }
    const compact = compactFrame(now, board.rows, expected, actual, aggregate);
    ring.push(compact); while (ring.length > 7) ring.shift();
  }
}

// 高運量 R/G/O/BL 的逐車路徑：車號是官方穩定身分，但站碼、方向與 path
// 仍可能落後或缺漏。這裡直接呼叫 production trtcCensusVehicles，不在測試器重寫建車規則。
function censusObservation(line, trip, now, rng, profile) {
  const state = truthState(trip, now, line);
  const destD = Number(line.stations[trip.dest].d);
  if (!state || state.from === trip.dest || Math.abs(state.d - destD) < .005) return null;
  // 終點收車另由 BR/Y 生命週期層測，這裡專測線上運行。距終點 5m 內是
  // 秒值四捨五入邊界：production 可能已判抵達，truth 的連續物理還剩小數秒。
  let eventIndex = 0;
  if (state.from === state.to) eventIndex = trip.events.findIndex(e => e.station === state.from && e.arrival <= now && now < e.departure);
  else eventIndex = trip.legs.findIndex(leg => leg.from === state.from && leg.to === state.to);
  if (eventIndex < 0) return null;
  const station = state.from, code = trtcCodeAt(line.id, station); if (!code) return null;
  const future = trip.events.slice(eventIndex + 1).filter(e => e.arrival > now - 1)
    .map(e => ({ name: line.stations[e.station].name, eta: e.arrival }));
  const no = trip.id.slice(trip.id.lastIndexOf(':') + 1) + (trip.dir === 2 ? '2' : '1');
  let dir = trip.dir, stn = code, at = now, dest = line.stations[trip.dest].name, pathRows = future;
  if (profile === 'chaos') {
    if (rng() < .035) pathRows = [];                         // TrackInfo 突然沒有 path
    if (rng() < .02) dir = dir === 2 ? 1 : 2;               // 終點折返時 dir 落後
    if (rng() < .015) at = now - 901;                       // 過期 CarWeight，應 hold 而不是跳車
    if (rng() < .025) {                                     // 站碼落後一站
      const back = station + (trip.dir === 2 ? -1 : 1), c = trtcCodeAt(line.id, back);
      if (c) stn = c;
    }
    if (rng() < .012) dest = '';                            // 終點漏欄
  }
  return { no, sys: 'hw', dir, stn, at, dest, path: pathRows, _truthId: trip.id };
}
function runCensusStress(line, seed, profile, metrics) {
  ENTITY_PRODUCTION.reset();
  const rng = rngFor(seed ^ (profile === 'chaos' ? 0xc3a505 : 0xc3e405));
  const load = profile === 'clean' ? 1 : [.6, .75, .9, 1][seed % 4];
  const trips = syntheticTrips(line, seed ^ 0xc3515, OPT.start, OPT.start + OPT.hours * 3600,
    load, profile === 'chaos');
  const truthToRender = new Map(), lastPairAt = new Map(), priorPos = new Map(), ring = [];
  let follow = null, followCooldownUntil = -Infinity;
  const warmup = OPT.start + 30;
  const maxSeg = Math.max(...line.stations.slice(0, -1).map((s, i) =>
    Math.abs(Number(line.stations[i + 1].d) - Number(s.d))));
  for (let now = OPT.start; now <= OPT.start + OPT.hours * 3600; now += OPT.interval) {
    const observations = trips.map(trip => censusObservation(line, trip, now, rng, profile)).filter(Boolean);
    const truthByOfficialNo = new Map(observations.map(x => [String(x.no), x._truthId]));
    const input = observations.map(({ _truthId, ...row }) => row);
    const vehicles = ENTITY_PRODUCTION.census(input, now, DAY) || [];
    const actual = [];
    for (const vehicle of vehicles) {
      const vehicleLine = ENTITY_PRODUCTION.line(String(vehicle.line)); if (!vehicleLine) continue;
      // 中和新蘆線在南勢角↔大橋頭是同一條實體軌道；南下車終點也在共線上時，
      // production 允許將 O_XINZHUANG/O_LUZHOU 任擇其一作畫圖容器。裁判器要認物理車，
      // 不能因容器 line id 不同把同軌車誤報成漏車。
      const oSibling = line.id.startsWith('O_') && String(vehicle.line).startsWith('O_');
      if (String(vehicle.line) !== line.id && !oSibling) continue;
      const pos = ENTITY_PRODUCTION.position(vehicleLine, vehicle, now); if (!pos) continue;
      const d = Number(pos.lon) * KM_PER_LON_DEGREE, progress = Number(vehicle.dir) === 2 ? d : -d;
      actual.push({ id: String(vehicle.vehicleId), officialNo: String(vehicle.officialNo || ''),
        truthId: truthByOfficialNo.get(String(vehicle.officialNo || '')) || null,
        dir: Number(vehicle.dir), d, progress, vehicle, vehicleLine: vehicle.line });
      const old = priorPos.get(String(vehicle.vehicleId));
      if (old && old.dir === Number(vehicle.dir) && progress < old.progress - 1e-6) {
        metrics.reverse++; entityFailure(metrics, 'census-reverse', seed, line, now,
          { render: vehicle.vehicleId, deltaKm: progress - old.progress }, ring);
      }
      priorPos.set(String(vehicle.vehicleId), { progress, dir: Number(vehicle.dir), at: now });
    }
    const expected = [];
    for (const trip of trips) {
      const state = truthState(trip, now, line);
      const destD = Number(line.stations[trip.dest].d);
      if (!state || state.from === trip.dest || Math.abs(state.d - destD) < .005) continue;
      expected.push({ id: trip.id, dir: trip.dir, d: state.d, progress: state.progress, evidenceAt: now, state });
    }
    // 這條路徑本來就有官方車號，它是可用的獨立身分真值。若還用最近位置
    // 配對，一台暫缺會讓後面整串平移，反而製造假交換；物理誤差仍依獨立真值位置計算。
    const matched = { pairs: [], missing: [], ghosts: [] }, actualByTruth = new Map();
    for (const render of actual) {
      if (!render.truthId || actualByTruth.has(render.truthId)) { matched.ghosts.push(render); continue; }
      actualByTruth.set(render.truthId, render);
    }
    for (const truth of expected) {
      const render = actualByTruth.get(truth.id);
      if (!render || render.dir !== truth.dir) { matched.missing.push(truth); if (render) matched.ghosts.push(render); continue; }
      matched.pairs.push({ truth, render, errorKm: Math.abs(truth.d - render.d) });
    }
    const expectedIds = new Set(expected.map(x => x.id));
    for (const render of actual) if (render.truthId && !expectedIds.has(render.truthId) && !matched.ghosts.includes(render))
      matched.ghosts.push(render);
    metrics.frames++; metrics.expected += expected.length; metrics.rendered += actual.length;
    if (now >= warmup) {
      metrics.ghosts += matched.ghosts.length; metrics.missing += matched.missing.length;
      for (const x of matched.ghosts) entityFailure(metrics, 'census-ghost', seed, line, now,
        { render: x.id, d: x.d, source: x.vehicle.source }, ring);
      for (const x of matched.missing) entityFailure(metrics, 'census-missing', seed, line, now,
        { truth: x.id, d: x.d }, ring);
    }
    const renderIds = new Set(actual.map(x => x.id));
    for (const pair of matched.pairs) {
      const errorM = pair.errorKm * 1000; metrics.errorsM.push(errorM); metrics.maxErrorM = Math.max(metrics.maxErrorM, errorM);
      const prevId = truthToRender.get(pair.truth.id), lastAt = lastPairAt.get(pair.truth.id);
      if (prevId && prevId !== pair.render.id && lastAt != null && now - lastAt <= 45) {
        metrics.identityChanges++; const swapped = renderIds.has(prevId); if (swapped) metrics.swaps++;
        entityFailure(metrics, swapped ? 'census-identity-swap' : 'census-identity-rekey', seed, line, now,
          { truth: pair.truth.id, before: prevId, after: pair.render.id, errorM }, ring);
      }
      truthToRender.set(pair.truth.id, pair.render.id); lastPairAt.set(pair.truth.id, now);
    }
    if (!follow && now >= warmup && now >= followCooldownUntil) {
      const cand = matched.pairs.find(p => trips.find(t => t.id === p.truth.id)?.end > now + 180);
      if (cand) follow = { truth: cand.truth.id, render: cand.render.id };
    }
    if (follow) {
      const truth = expected.find(x => x.id === follow.truth), rendered = actual.find(x => x.id === follow.render);
      if (!truth) follow = null;
      else if (!rendered) {
        metrics.followDropped++; entityFailure(metrics, 'census-follow-dropped', seed, line, now,
          { truth: follow.truth, render: follow.render }, ring);
        follow = null; followCooldownUntil = now + 60;
      } else {
        const pair = matched.pairs.find(p => p.render.id === follow.render);
        if (pair && pair.truth.id !== follow.truth) {
          metrics.followWrong++; entityFailure(metrics, 'census-follow-wrong-train', seed, line, now,
            { wanted: follow.truth, got: pair.truth.id, render: follow.render }, ring);
        }
      }
    }
    ring.push({ at: now, clock: fmtSec(now), observations: observations.map(x => ({ truth: x._truthId,
      no: x.no, stn: x.stn, dir: x.dir, dest: x.dest, path: x.path.length })),
      truth: expected.map(x => ({ id: x.id, dir: x.dir, d: +x.d.toFixed(4) })),
      rendered: actual.map(x => ({ id: x.id, dir: x.dir, d: +x.d.toFixed(4), from: x.vehicle.from,
        to: x.vehicle.to, source: x.vehicle.source, hold: x.vehicle.holdReason })),
      pairs: matched.pairs.map(x => ({ truth: x.truth.id, render: x.render.id, errorM: Math.round(x.errorKm * 1000) })),
      missing: matched.missing.map(x => x.id), ghosts: matched.ghosts.map(x => x.id) });
    while (ring.length > 7) ring.shift();
  }
}

function scheduleSummary(m) {
  return { samples: m.samples, p95ErrorM: percentile(m.errorsM, .95), maxErrorM: m.maxErrorM,
    reverse: m.reverse, order: m.order, failures: m.failures };
}
function entitySummary(m) {
  return { frames: m.frames, expected: m.expected, rendered: m.rendered,
    p50ErrorM: percentile(m.errorsM, .5), p95ErrorM: percentile(m.errorsM, .95), maxErrorM: m.maxErrorM,
    ghosts: m.ghosts, missing: m.missing, identityChanges: m.identityChanges, swaps: m.swaps,
    reverse: m.reverse, jumps: m.jumps, followWrong: m.followWrong, followDropped: m.followDropped,
    failures: m.failures, failureSnapshots: m.failureSnapshots };
}

const seedList = Array.from({ length: OPT.seeds }, (_, i) => OPT.seed != null ? OPT.seed : (0x820000 + i * 7919) >>> 0);
const output = { schema: 1, generatedAt: new Date().toISOString(), config: OPT, seedList,
  coverage: [], schedule: {}, entity: {}, verdict: null };
const started = performance.now();
console.log(`捷運壓測：${LINES.length} 條線 × ${seedList.length} seeds × ${OPT.hours}h，profile=${OPT.profile}\n`);

for (const line of LINES) {
  const sm = newScheduleMetrics();
  for (const seed of seedList) runScheduleStress(line, seed, sm, null);
  output.schedule[line.key] = scheduleSummary(sm);
  const adapters = ['synthetic-peak', 'production-freq-position'];
  if (line.system === 'mrt' && ['BR', 'Y'].includes(line.id)) adapters.push('countdown-entity');
  if (line.system === 'mrt' && ['R', 'G', 'O_XINZHUANG', 'O_LUZHOU', 'BL'].includes(line.id))
    adapters.push('official-number-census');
  output.coverage.push({ system: line.system, line: line.id, name: line.name, loop: !!line.loop,
    directions: line.loop ? 1 : 2, adapters });
  console.log(`${sm.failures.length ? '❌' : '✅'} ${line.key.padEnd(19)} 班表物理 ${sm.samples.toLocaleString()} 點` +
    `｜P95 ${Math.round(percentile(sm.errorsM, .95) || 0)}m｜max ${Math.round(sm.maxErrorM)}m｜逆行 ${sm.reverse}｜超車 ${sm.order}`);
}

const profiles = OPT.profile === 'both' ? ['clean', 'chaos'] : [OPT.profile];
for (const line of LINES.filter(x => x.system === 'mrt' && ['BR', 'Y'].includes(x.id))) {
  for (const profile of profiles) {
    const em = newEntityMetrics();
    for (const seed of seedList) runEntityStress(line, seed, profile, em);
    const key = `${line.key}:${profile}`; output.entity[key] = entitySummary(em);
    console.log(`${em.failures.length ? '⚠️' : '✅'} ${key.padEnd(25)} 實體 ${em.frames.toLocaleString()} frames` +
      `｜幽靈 ${em.ghosts}｜漏車 ${em.missing}｜換 ID ${em.identityChanges}｜交換 ${em.swaps}` +
      `｜逆行 ${em.reverse}｜跳段 ${em.jumps}｜跟錯 ${em.followWrong}｜跟丟 ${em.followDropped}` +
      `｜P95 ${Math.round(percentile(em.errorsM, .95) || 0)}m`);
  }
}
for (const line of LINES.filter(x => x.system === 'mrt' &&
    ['R', 'G', 'O_XINZHUANG', 'O_LUZHOU', 'BL'].includes(x.id))) {
  for (const profile of profiles) {
    const em = newEntityMetrics();
    for (const seed of seedList) runCensusStress(line, seed, profile, em);
    const key = `${line.key}:census:${profile}`; output.entity[key] = entitySummary(em);
    console.log(`${em.failures.length ? '⚠️' : '✅'} ${key.padEnd(25)} 逐車 ${em.frames.toLocaleString()} frames` +
      `｜幽靈 ${em.ghosts}｜漏車 ${em.missing}｜換 ID ${em.identityChanges}｜交換 ${em.swaps}` +
      `｜逆行 ${em.reverse}｜跳段 ${em.jumps}｜跟錯 ${em.followWrong}｜跟丟 ${em.followDropped}` +
      `｜P95 ${Math.round(percentile(em.errorsM, .95) || 0)}m`);
  }
}

const scheduleHard = Object.values(output.schedule).flatMap(x => x.failures)
  .filter(x => ['schedule-missing', 'schedule-reverse', 'schedule-overtake', 'schedule-position'].includes(x.type));
const entityFindingCount = x => x.ghosts + x.missing + x.identityChanges + x.reverse + x.jumps +
  x.followWrong + x.followDropped;
const cleanHard = Object.entries(output.entity).filter(([k]) => k.endsWith(':clean'))
  .reduce((n, [, x]) => n + entityFindingCount(x), 0);
const chaosFindings = Object.entries(output.entity).filter(([k]) => k.endsWith(':chaos'))
  .reduce((n, [, x]) => n + entityFindingCount(x), 0);
output.verdict = { pass: scheduleHard.length === 0 && cleanHard === 0,
  scheduleHard: scheduleHard.length, cleanHard, chaosFindings,
  elapsedSec: (performance.now() - started) / 1000 };
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const outputPath = path.join(OUTPUT_DIR, OPT.seed != null ? `seed-${OPT.seed}.json` : 'last-run.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`\n${output.verdict.pass ? '✅ clean gate 通過' : '❌ clean gate 失敗'}` +
  `｜班表硬錯 ${scheduleHard.length}｜clean 實體事件 ${cleanHard}｜chaos 找到 ${chaosFindings} 個失敗事件`);
console.log(`完整結果：${outputPath}`);
if (chaosFindings) console.log(`重播示例：node scripts/stress_metro_simulation.mjs --seed ${output.entity[Object.keys(output.entity).find(k => k.endsWith(':chaos'))].failures[0]?.seed || seedList[0]} --profile chaos --trace`);
if (OPT.gate && !output.verdict.pass) process.exit(1);
