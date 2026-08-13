#!/usr/bin/env node
// 北捷「車子照官方時間到站」驗收。
// 全程使用現有班表合成 fixture；不連正式站，不打北捷主機。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const WORKER_PATH = path.join(ROOT, 'worker.js');
const LEDGER_PATH = path.join(ROOT, 'scripts/trtc_board_ledger.mjs');
const CURRENT_HTML = fs.readFileSync(INDEX_PATH, 'utf8').replace(/\s+integrity="[^"]+"/g, '');
const WORKER = fs.readFileSync(WORKER_PATH, 'utf8');
const LEDGER = fs.readFileSync(LEDGER_PATH, 'utf8');
const BASE_COMMIT = process.env.TRTC_ONTIME_BASE || 'f8a79ae';
const BASE_HTML = execFileSync('git', ['show', `${BASE_COMMIT}:index.html`], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
}).replace(/\s+integrity="[^"]+"/g, '');
const PORT0 = Number(process.env.TRTC_ONTIME_PORT || 6740);
const TICK_SEC = Number(process.env.TRTC_ONTIME_TICK_SEC || .25);
const TRACK_PROJECTION_TOLERANCE_M = Number(process.env.TRTC_ONTIME_TRACK_TOLERANCE_M || .5);
const OUTPUT = path.resolve(process.env.TRTC_ONTIME_OUTPUT || path.join(ROOT, 'tmp/verify_trtc_ontime-output.json'));
const ALLOW_BASELINE = process.env.TRTC_ONTIME_ALLOW_BASELINE === '1';
const leafletRoot = process.env.TRTC_LEAFLET_DIST || '/tmp/trtc-playwright-deps/node_modules/leaflet/dist';
const leafletJs = fs.readFileSync(path.join(leafletRoot, 'leaflet.js'));
const leafletCss = fs.readFileSync(path.join(leafletRoot, 'leaflet.css'));
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const EXPECTED_LINES = ['BR', 'R', 'R_XBT', 'G', 'G_XBT', 'O_XINZHUANG', 'O_LUZHOU', 'BL', 'Y'];

const output = {
  target: INDEX_PATH,
  targetSha256: crypto.createHash('sha256').update(CURRENT_HTML).digest('hex'),
  baseCommit: BASE_COMMIT,
  tickSec: TICK_SEC,
  assertions: [], mutations: [], models: {}, metrics: {},
};
let failures = 0;
function check(pass, label, detail = '') {
  pass = !!pass;
  output.assertions.push({ pass, label, detail });
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
  if (!pass) failures++;
  return pass;
}
function mutation(caught, label, detail = '') {
  caught = !!caught;
  output.mutations.push({ caught, label, detail });
  console.log(`${caught ? '🧬' : '❌'} mutation ${label}${detail ? `：${detail}` : ''}`);
  if (!caught) failures++;
}
function percentile(values, q) {
  const a = values.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil(q * a.length) - 1))];
}
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
      if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"') || (mode === 'template' && c === '`')) mode = 'code';
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
  throw new Error(`function ${name} 大括號未閉合`);
}
function mutateFunctionInHtml(html, name, mutate, label) {
  const before = extractFunction(html, name), after = mutate(before);
  if (!after || after === before) throw new Error(`無法建立 ${label || name} mutation`);
  const first = html.indexOf(before), last = html.lastIndexOf(before);
  if (first < 0 || first !== last) throw new Error(`${name} 在 HTML 中不是唯一命中`);
  return html.slice(0, first) + after + html.slice(first + before.length);
}
function replaceRequired(source, before, after, label) {
  const first = source.indexOf(before), last = source.lastIndexOf(before);
  if (first < 0 || first !== last) throw new Error(`${label} mutation 預期唯一命中，實際 ${first < 0 ? 0 : '多於 1'}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

// 直接執行產品 trtcBindPhysicalIdentity，重現「A 從 old reclaim 為 new，old 後來轉綁 B」。
// old track 重現時可能還帶著舊的 reverse alias；此時 forward map 才是所有權真值。
function replayFrontendIdentityMap(bindSource) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`
    const _easedShift = new Map(), _trtcPhysicalByTrip = new Map(), _trtcTripByPhysical = new Map();
    const _trtcEndpointByTrack = new Map(), _trtcLastRendered = new Map();
    function freqTripKey(ln, tr) { return tr.key; }
    function freqSysIdOf(ln) { return 'mrt'; }
    function trtcEasedMotionKey(ln, tr, physicalKey) {
      return 'mrt:' + ln.id + ':' + (physicalKey ? 'track:' + physicalKey : 'trip:' + tr.key);
    }
    ${bindSource}
    const ln = { id: 'R' }, A = { key: 'trip:A' }, B = { key: 'trip:B' };
    const day = '2026-08-13', oldKey = day + '|track:old', newKey = day + '|track:new';
    trtcBindPhysicalIdentity(ln, A, day, 'track:old');
    const step1 = { A: _trtcPhysicalByTrip.get('trip:A'), old: _trtcTripByPhysical.get(oldKey) };
    trtcBindPhysicalIdentity(ln, A, day, 'track:new');
    const step2 = { A: _trtcPhysicalByTrip.get('trip:A'), fresh: _trtcTripByPhysical.get(newKey) };
    // 後端 old track 重現時，歷史 reverse alias 仍可指 A；不得因此刪掉 A 已前進到 new 的 forward 綁定。
    _trtcTripByPhysical.set(oldKey, 'trip:A');
    trtcBindPhysicalIdentity(ln, B, day, 'track:old');
    globalThis.identityResult = {
      step1, step2,
      final: { A: _trtcPhysicalByTrip.get('trip:A') || null, B: _trtcPhysicalByTrip.get('trip:B') || null,
        old: _trtcTripByPhysical.get(oldKey) || null, fresh: _trtcTripByPhysical.get(newKey) || null },
    };
  `, context);
  return JSON.parse(JSON.stringify(context.identityResult));
}

function serve(port, html) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${port}/`);
    if (u.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ rows: [], trains: [], list: [], src: null, board: [], boardPos: null })); return;
    }
    if (u.pathname === '/' || u.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': MIME['.html'] }); res.end(html); return;
    }
    const file = path.resolve(ROOT, '.' + decodeURIComponent(u.pathname));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function prepare(page, port) {
  await page.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname === 'cdnjs.cloudflare.com' && u.pathname.endsWith('leaflet.min.js'))
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: leafletJs });
    if (u.hostname === 'cdnjs.cloudflare.com' && u.pathname.endsWith('leaflet.min.css'))
      return route.fulfill({ status: 200, contentType: 'text/css', body: leafletCss });
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return route.continue();
    return route.abort('blockedbyclient');
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => state.systems.some(s => s.id === 'mrt' && s.data && s._times), null, { timeout: 30000 });
}

async function replay(label, html, port) {
  const server = await serve(port, html);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  try {
    await prepare(page, port);
    const model = await page.evaluate(async ({ expectedLines, tickSec, trackToleranceM }) => {
      const round = (n, d = 4) => Number.isFinite(n) ? +n.toFixed(d) : null;
      const tripLocalKey = tr => `${tr[0]}@${tr[1]}>${tr[tr.length - 2]}@${tr[tr.length - 1]}`;
      const epochForServiceSec = sec => {
        const day = taipeiServiceDayStr();
        return Date.parse(day + 'T00:00:00+08:00') / 1000 + sec;
      };
      const metres = (a, b) => a && b ? haversineKm(a, b) * 1000 : Infinity;
      const projectShapeRange = (ln, pos, loD, hiD) => {
        if (!pos) return null;
        if (typeof trtcProjectShapeRange === 'function') return trtcProjectShapeRange(ln, pos.lat, pos.lon, loD, hiD);
        const p = projectOntoShape(ln, pos.lat, pos.lon);
        return p && Number.isFinite(p.d) ? { d: p.d, perpKm: haversineKm(pos, posAlongShape(ln, p.d)) } : null;
      };
      const g = GROUPS.find(x => x.id === 'metro');
      state.freqSel = new Set(['mrt']); state.mode = 'freq'; state.sys = null; state.sysId = 'metro';
      rebuildFreqLines(g); recomputeTrains();
      _trtcPolling = true;
      const lines = state.lines.filter(ln => isTrtcBoardLine(ln) && ln._tt && ln._tt.length);

      function candidates(ln) {
        const delayed = [], ordinary = [];
        for (const tr of ln._tt) for (let k = 1; k < tr.length / 2; k++) {
          const from = tr[(k - 1) * 2], to = tr[k * 2], dep = tr[(k - 1) * 2 + 1], next = tr[k * 2 + 1];
          const officialRun = runBetween(ln, from, to);
          // 與 freqTrainPosRaw 同口徑：segs 無 run（Y 目前即是）時用班表相鄰事件間隔。
          const run = officialRun && officialRun < next - dep ? officialRun : next - dep;
          if (!(run > 5) || from === to) continue;
          const room = tr[tr.length - 1] - (dep + run);
          const base = { tr, from, to, dep, run, room };
          ordinary.push(base);
          if (run > 80 && room >= 60) delayed.push(base);
        }
        delayed.sort((a, b) => b.run - a.run || b.room - a.room);
        ordinary.sort((a, b) => b.run - a.run || b.room - a.room);
        const picked = [], seen = new Set();
        for (const c of [...delayed.slice(0, 2), ...ordinary.slice(0, 2)]) {
          const key = tripLocalKey(c.tr) + '|' + c.from + '>' + c.to;
          if (!seen.has(key)) { seen.add(key); picked.push({ ...c, delay: c.run > 80 && c.room >= 60 ? 60 : 0 }); }
          if (picked.length >= 3) break;
        }
        return picked;
      }

      const samples = [], rosterChecks = [], rosterBoundaryChecks = [], assignmentKeys = [], orderChecks = [], releaseCases = [];
      for (const ln of lines) for (const c of candidates(ln)) {
        const { tr, from, to, dep, run, delay } = c;
        const arrSec = dep + run + delay;
        // 延誤案從「表定離站+60s」開始：舊版 eased 尚未追上，但車仍在本站間。
        const observedSec = delay ? dep + delay : dep;
        if (freqTrainTime(tr, observedSec) == null || freqTrainTime(tr, arrSec) == null) continue;
        const arrEpoch = epochForServiceSec(arrSec), observedEpoch = epochForServiceSec(observedSec);
        const dir = tr[0] < tr[tr.length - 2] ? 2 : 1;
        const eta = { from, to, run, arrEpoch };
        const row = { line: ln.id, dir, from, to, dest: tr[tr.length - 2], run, arrEpoch,
          no: `fixture-${ln.id}`, terminal: false };
        const trip = { line: ln.id, dir, key: tripLocalKey(tr), trackId: `track:${ln.id}:${tripLocalKey(tr)}`, shift: delay, eta };

        clearTrtcBoard(); _easedShift.clear();
        state.simSec = observedSec; state.clockAtNow = true; state.playing = true; state.speedMult = 1;
        _mlGate = true; _mlGateAt = Date.now();
        _metroGateEp.on = true; _metroGateEp.ep++; _metroGateEp.at = performance.now() - 6000;
        const beforeRoster = ln._tt.filter(x => freqTrainTime(x, observedSec) != null).length;
        const beforeScreen = ln._tt.filter(x => freqTrainPosAt(ln, x, observedSec) != null).length;
        let audit = null;
        try { audit = applyTrtcBoard([row], observedEpoch, [trip]); }
        catch (e) { samples.push({ line: ln.id, error: String(e), delay }); continue; }
        for (const x of lines) if (x._trtcBoard) x._trtcBoard.at = Date.now();
        _mlGate = true; _mlGateAt = Date.now();
        const afterRoster = ln._tt.filter(x => freqTrainTime(x, observedSec) != null).length;
        const afterScreen = ln._tt.filter(x => freqTrainPosAt(ln, x, observedSec) != null).length;
        rosterChecks.push({ line: ln.id, beforeRoster, beforeScreen, afterRoster, afterScreen });
        const assignment = audit && audit.assignments && audit.assignments.find(x => x.line === ln.id);
        assignmentKeys.push({ line: ln.id, expected: trip.key, actual: assignment && assignment.tripKey,
          trackId: assignment && assignment.trackId });
        const rec = ln._trtcBoard && ln._trtcBoard.positions && ln._trtcBoard.positions.get(tr);

        const target = posBetweenStations(ln, from, to, 1);
        const segmentM = ln.hasShape ? Math.abs(ln.stations[to].d - ln.stations[from].d) * 1000
          : metres(posBetweenStations(ln, from, to, 0), target);
        const nominalMps = segmentM / run;
        // B 的「該線速度上界」是產品的 TRTC_BOARD_PERF.v（80km/h）；不能拿上一個
        // 官方段的平均速度繼續管 release 後的下一班表段（Y 會被虛構成超速）。
        const maxStepM = TRTC_BOARD_PERF.v / 3.6 * tickSec + .05;
        // 到站時刻定義為「最早進入這段 motion 一個 UI tick 實際可走距離」；門檻由本段
        // 里程／motion 時長與 tick 推導。80km/h 是安全速度上界，不能拿它當到站半徑，否則
        // 慢速段會提早數個 tick 被算成到站。也不用 5cm 魔術半徑承受 shape 取樣誤差。
        const motionDurationSec = rec && rec.endpoint ? rec.endSec - rec.moveSec : run;
        const motionDistanceM = rec && rec.endpoint && Number.isFinite(rec.startD) && Number.isFinite(rec.targetD)
          ? Math.abs(rec.targetD - rec.startD) * 1000 : segmentM;
        const stationToleranceM = motionDurationSec > 0 ? motionDistanceM / motionDurationSec * tickSec + .05
          : nominalMps * tickSec + .05;
        let prev = null, prevT = null, biggestStepM = 0, biggestStepAt = null, biggestStepBefore = null, biggestStepAfter = null,
          biggestFallbackTm = null, firstArrivalSec = null, atDeadlineM = null, maxOffTrackM = 0;
        const boundarySteps = [];
        const end = Math.min(tr[tr.length - 1], arrSec + Math.max(run * 3, 180));
        for (let t = observedSec; t <= end + 1e-9; t = Math.min(end, t + tickSec)) {
          state.simSec = t;
          const pos = freqTrainPosAt(ln, tr, t);
          if (prev && pos) {
            const stepM = metres(prev, pos);
            if (stepM > biggestStepM) {
              biggestStepM = stepM; biggestStepAt = t; biggestStepBefore = prev; biggestStepAfter = pos;
              const shAt = metroShiftSec(ln, tr), rosterAt = freqTrainTime(tr, t);
              biggestFallbackTm = rosterAt == null ? null : Math.max(tr[1], Math.min(tr[tr.length - 1], rosterAt - shAt));
            }
            if (rec) for (const [kind, mark] of [['arr', rec.arrSec], ['release', rec.releaseSec]]) {
              if (Number.isFinite(mark) && (Math.abs(t - mark) < 1e-8 || Math.abs(prevT - mark) < 1e-8))
                boundarySteps.push({ kind, at: t, mark, stepM: round(stepM) });
            }
          }
          if (pos) {
            const d = metres(pos, target);
            if (firstArrivalSec == null && d <= stationToleranceM) firstArrivalSec = t;
            if (Math.abs(t - arrSec) <= tickSec / 2 + 1e-8) atDeadlineM = d;
            if (rec && rec.endpoint && ln.hasShape) {
              const secAt = trtcMotionServiceSec(t, rec.arrSec);
              const releaseAt = Number.isFinite(rec.releaseSec) ? rec.releaseSec : rec.endSec;
              if (secAt != null && secAt >= rec.startSec - 1e-8 && secAt <= releaseAt + 1e-8) {
                const projection = projectShapeRange(ln, pos,
                  Math.min(rec.startD, rec.targetD), Math.max(rec.startD, rec.targetD));
                maxOffTrackM = Math.max(maxOffTrackM, projection && Number.isFinite(projection.perpKm)
                  ? projection.perpKm * 1000 : Infinity);
              }
            }
            prev = pos;
          }
          prevT = t;
          if (t === end) break;
        }
        releaseCases.push({ line: ln.id, tripKey: trip.key, arrSec: rec && rec.arrSec,
          endSec: rec && rec.endSec, releaseSec: rec && rec.releaseSec,
          expectedReleaseSec: rec && Math.max(rec.arrSec, rec.endSec), boundarySteps, maxStepM: round(maxStepM) });
        state.simSec = arrSec;
        const orderGroups = new Map();
        for (const other of ln._tt) {
          if (freqTrainTime(other, arrSec) == null || !ln.hasShape) continue;
          const pos = freqTrainPosAt(ln, other, arrSec); if (!pos) continue;
          const projected = projectOntoShape(ln, pos.lat, pos.lon);
          if (!projected || projected.d == null) continue;
          const odir = Math.sign(ln.stations[other[other.length - 2]].d - ln.stations[other[0]].d) || 1;
          // 起訖站完全相同才比 FIFO，避免短線／跨線班次的物理區間不同卻被硬比。
          const gk = `${other[0]}>${other[other.length - 2]}|${odir}`;
          let a = orderGroups.get(gk); if (!a) orderGroups.set(gk, a = []);
          a.push({ dep: other[1], d: projected.d, dir: odir, key: tripLocalKey(other) });
        }
        let orderPairs = 0, orderInversions = 0; const inversionWitnesses = [];
        for (const a of orderGroups.values()) {
          a.sort((x, y) => x.dep - y.dep);
          for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
            orderPairs++;
            if ((a[i].d - a[j].d) * a[i].dir < -.001) {
              orderInversions++;
              if (inversionWitnesses.length < 4) inversionWitnesses.push({ early: a[i], late: a[j], gapM: round((a[i].d - a[j].d) * a[i].dir * 1000) });
            }
          }
        }
        orderChecks.push({ line: ln.id, pairs: orderPairs, inversions: orderInversions, witnesses: inversionWitnesses });
        samples.push({ line: ln.id, delay, run: round(run), sampleCount: 1, from, to,
          assigned: !!assignment, expectedTripKey: trip.key,
          actualTripKey: assignment && (assignment.backendKey || assignment.tripKey),
          arrivalErrorSec: firstArrivalSec == null ? null : round(firstArrivalSec - arrSec),
          atDeadlineM: round(atDeadlineM), stationToleranceM: round(stationToleranceM),
          deadlineToleranceM: round(stationToleranceM),
          biggestStepM: round(biggestStepM), biggestStepAt: round(biggestStepAt),
          biggestStepRelativeArrival: round(biggestStepAt - arrSec), maxStepM: round(maxStepM),
          maxOffTrackM: round(maxOffTrackM, 6), trackToleranceM,
          clamped: !!(rec && rec.clamped), unreachable: !!(rec && rec.unreachable),
          clampObserved: !!(rec && Object.prototype.hasOwnProperty.call(rec, 'clamped')),
          unreachableObserved: !!(rec && Object.prototype.hasOwnProperty.call(rec, 'unreachable')),
          trackId: rec && rec.trackId || assignment && assignment.trackId || null,
          motionDebug: rec && { releaseSec: rec.releaseSec, endSec: rec.endSec, arrSec: rec.arrSec,
            startSec: rec.startSec, moveSec: rec.moveSec, startPos: rec.startPos, targetPos: rec.targetPos },
          biggestStepBefore, biggestStepAfter, biggestFallbackTm,
        });
      }

      // 名冊雙向：缺 feed 不滅車；不存在的錨點不生車。
      // 物理上追不上的正向邊界：從起站到下站只給 10s，必須開 2× 夾限、
      // 不得在 deadline snap，且要誠實標 unreachable。
      const clampCases = [];
      const clampLine = lines.find(ln => candidates(ln).some(c => c.run > 80));
      if (clampLine) {
        const c = candidates(clampLine).find(x => x.run > 80);
        const { tr, from, to, dep, run } = c, dir = tr[0] < tr[tr.length - 2] ? 2 : 1;
        const observedSec = dep, arrSec = dep + 10, observedEpoch = epochForServiceSec(observedSec), arrEpoch = epochForServiceSec(arrSec);
        const eta = { from, to, run, arrEpoch }, trackId = 'track:unreachable', key = tripLocalKey(tr);
        clearTrtcBoard(); _easedShift.clear(); state.simSec = observedSec;
        _mlGate = true; _mlGateAt = Date.now(); _metroGateEp.on = true; _metroGateEp.at = performance.now() - 6000;
        // 先畫一格，讓新 snapshot 從真正畫面位置接手。
        freqTrainPosAt(clampLine, tr, observedSec);
        applyTrtcBoard([{ line: clampLine.id, dir, from, to, dest: tr[tr.length - 2], run, arrEpoch, no: '', terminal: false }],
          observedEpoch, [{ line: clampLine.id, dir, key, trackId, shift: 10 - run, eta }]);
        if (clampLine._trtcBoard) clampLine._trtcBoard.at = Date.now();
        const rec = clampLine._trtcBoard && clampLine._trtcBoard.positions && clampLine._trtcBoard.positions.get(tr);
        const target = posBetweenStations(clampLine, from, to, 1), segmentM = clampLine.hasShape
          ? Math.abs(clampLine.stations[to].d - clampLine.stations[from].d) * 1000
          : metres(posBetweenStations(clampLine, from, to, 0), target);
        const twoXNominalMps = segmentM / run * TRTC_MOTION_MAX_RATE;
        const lineLimitMps = TRTC_BOARD_PERF.v / 3.6;
        const maxStepM = Math.min(twoXNominalMps, lineLimitMps) * tickSec + .05;
        let prev = null, biggestStepM = 0, deadlineM = null;
        for (let t = observedSec; t <= arrSec + 1e-9; t = Math.min(arrSec, t + tickSec)) {
          state.simSec = t; const pos = freqTrainPosAt(clampLine, tr, t);
          if (prev && pos) biggestStepM = Math.max(biggestStepM, metres(prev, pos));
          if (t === arrSec && pos) deadlineM = metres(pos, target);
          if (pos) prev = pos;
          if (t === arrSec) break;
        }
        clampCases.push({ line: clampLine.id, run, deadlineSec: 10, clamped: rec && rec.clamped,
          rate: rec && round(rec.rate), unreachable: !!(rec && rec.unreachable), deadlineM: round(deadlineM),
          biggestStepM: round(biggestStepM), maxStepM: round(maxStepM),
          twoXNominalKmh: round(twoXNominalMps * 3.6), lineLimitKmh: TRTC_BOARD_PERF.v,
          clampObserved: !!(rec && Object.prototype.hasOwnProperty.call(rec, 'clamped')),
          unreachableObserved: !!(rec && Object.prototype.hasOwnProperty.call(rec, 'unreachable')) });
      }

      // 0.25× forced-low：當前已接近站點，官方 ETA 卻遠在 2個段時間之後。
      // 依視覺下界立即以0.25×前進會早到，必須標 unreachable，不得把 deadline 上的停站假裝成準時。
      const lowClampCases = [];
      const lowLine = lines.find(ln => ln.stations && ln.stations.length >= 3 && runBetween(ln, 0, 1) > 20);
      if (lowLine) {
        const from = 0, to = 1, next = 2, run = runBetween(lowLine, from, to), now = 43200;
        const dep = Math.round(now - run * .9), tr = [from, dep, to, dep + run + 20, next, now + run * 4];
        lowLine._tt.push(tr);
        try {
          const arrSec = now + run * 2, arrEpoch = epochForServiceSec(arrSec), dir = 2;
          const eta = { from, to, run, arrEpoch }, row = { line: lowLine.id, dir, from, to, dest: next,
            run, arrEpoch, no: '', terminal: false };
          clearTrtcBoard(); _easedShift.clear(); state.simSec = now;
          _mlGate = true; _mlGateAt = Date.now(); _metroGateEp.on = true; _metroGateEp.at = performance.now() - 6000;
          freqTrainPosAt(lowLine, tr, now);
          const audit = applyTrtcBoard([row], epochForServiceSec(now), [{ line: lowLine.id, dir,
            key: tripLocalKey(tr), trackId: 'track:forced-low', shift: arrSec - (dep + run), eta }]);
          if (lowLine._trtcBoard) lowLine._trtcBoard.at = Date.now();
          const rec = lowLine._trtcBoard && lowLine._trtcBoard.positions && lowLine._trtcBoard.positions.get(tr);
          const maxStepM = TRTC_BOARD_PERF.v / 3.6 * tickSec + .05;
          const boundarySteps = [];
          if (rec) {
            const marks = [...new Set([rec.endSec, rec.releaseSec].filter(Number.isFinite))];
            for (const mark of marks) for (const side of [-1, 1]) {
              const aSec = mark + (side < 0 ? -tickSec : 0), bSec = aSec + tickSec;
              state.simSec = aSec; const a = freqTrainPosAt(lowLine, tr, aSec);
              state.simSec = bSec; const b = freqTrainPosAt(lowLine, tr, bSec);
              boundarySteps.push({ mark: round(mark), side: side < 0 ? 'into' : 'out',
                fromSec: round(aSec), toSec: round(bSec), stepM: round(metres(a, b)) });
            }
          }
          state.simSec = arrSec;
          const atDeadline = freqTrainPosAt(lowLine, tr, arrSec), target = posBetweenStations(lowLine, from, to, 1);
          // feed loss 用 forced-low 的中段做 witness：此時官方 0.25× 與班表 fallback 刻意不同。
          // 正常 clear 會 carry 同一 motion；立即刪除 mutant 會在同一畫格跳回班表。
          const feedProbeSec = rec && Number.isFinite(rec.endSec) ? (now + Math.min(rec.endSec, arrSec)) / 2 : now + tickSec;
          state.simSec = feedProbeSec; const beforeFeedLoss = freqTrainPosAt(lowLine, tr, feedProbeSec);
          clearTrtcBoard();
          state.simSec = feedProbeSec; const afterFeedLoss = freqTrainPosAt(lowLine, tr, feedProbeSec);
          lowClampCases.push({ line: lowLine.id, matched: audit && audit.matched, endpoint: !!rec,
            clamped: rec && rec.clamped, rate: rec && round(rec.rate), unreachable: rec && rec.unreachable,
            endSec: rec && round(rec.endSec), arrSec, arrivalDeltaSec: rec && round(rec.endSec - arrSec),
            releaseSec: rec && round(rec.releaseSec), expectedReleaseSec: rec && round(Math.max(rec.arrSec, rec.endSec)),
            boundarySteps, maxStepM: round(maxStepM), deadlineM: round(metres(atDeadline, target)),
            feedProbeSec: round(feedProbeSec), feedLossJumpM: round(metres(beforeFeedLoss, afterFeedLoss)),
            pretendsOnTime: !!(rec && !rec.unreachable && metres(atDeadline, target) <= .05) });
        } finally { lowLine._tt.pop(); }
      }

      // backend 正常輪後，下一輪 trips=[] 只代表 binder 暫缺；已開始的 endpoint 仍須 carry 到 release。
      // forced-low 讓 endpoint 與 legacy fallback 在 probe 時刻刻意分離，可抓出「legacy 先 delete old board」。
      const legacyFallbackCases = [];
      const legacyLine = lines.find(ln => ln.hasShape && ln.stations && ln.stations.length >= 3 && runBetween(ln, 0, 1) > 20);
      if (legacyLine) {
        const from = 0, to = 1, next = 2, run = runBetween(legacyLine, from, to), now = 45000;
        const dep = Math.round(now - run * .9), tr = [from, dep, to, dep + run + 20, next, now + run * 4];
        legacyLine._tt.push(tr);
        try {
          const arrSec = now + run * 2, arrEpoch = epochForServiceSec(arrSec), dir = 2;
          const eta = { from, to, run, arrEpoch }, row = { line: legacyLine.id, dir, from, to, dest: next,
            run, arrEpoch, no: '', terminal: false };
          clearTrtcBoard(); _easedShift.clear(); state.simSec = now;
          _mlGate = true; _mlGateAt = Date.now(); _metroGateEp.on = true; _metroGateEp.ep++; _metroGateEp.at = performance.now() - 6000;
          freqTrainPosAt(legacyLine, tr, now);
          const backendAudit = applyTrtcBoard([row], epochForServiceSec(now), [{ line: legacyLine.id, dir,
            key: tripLocalKey(tr), trackId: 'track:legacy-fallback', shift: arrSec - (dep + run), eta }]);
          if (legacyLine._trtcBoard) legacyLine._trtcBoard.at = Date.now();
          const backendRec = legacyLine._trtcBoard && legacyLine._trtcBoard.positions && legacyLine._trtcBoard.positions.get(tr);
          const probeSec = backendRec && Number.isFinite(backendRec.endSec) ? (now + Math.min(backendRec.endSec, arrSec)) / 2 : now + tickSec;
          state.simSec = probeSec; const beforeLegacy = freqTrainPosAt(legacyLine, tr, probeSec);
          const legacyAudit = applyTrtcBoard([row], epochForServiceSec(probeSec), []);
          if (legacyLine._trtcBoard) legacyLine._trtcBoard.at = Date.now();
          state.simSec = probeSec; const afterLegacy = freqTrainPosAt(legacyLine, tr, probeSec);
          const carriedRec = legacyLine._trtcBoard && legacyLine._trtcBoard.positions && legacyLine._trtcBoard.positions.get(tr);
          const releaseSec = backendRec && backendRec.releaseSec, boundarySteps = [];
          if (Number.isFinite(releaseSec)) for (const side of [-1, 1]) {
            const aSec = releaseSec + (side < 0 ? -tickSec : 0), bSec = aSec + tickSec;
            state.simSec = aSec; const a = freqTrainPosAt(legacyLine, tr, aSec);
            state.simSec = bSec; const b = freqTrainPosAt(legacyLine, tr, bSec);
            boundarySteps.push({ side: side < 0 ? 'into' : 'out', fromSec: round(aSec), toSec: round(bSec),
              stepM: round(metres(a, b)) });
          }
          const maxStepM = TRTC_BOARD_PERF.v / 3.6 * tickSec + .05;
          legacyFallbackCases.push({ line: legacyLine.id, backendMatched: backendAudit && backendAudit.matched,
            legacyMatched: legacyAudit && legacyAudit.matched, endpointBefore: !!backendRec,
            carriedSameEndpoint: !!(backendRec && carriedRec === backendRec), probeSec: round(probeSec),
            refreshJumpM: round(metres(beforeLegacy, afterLegacy)), releaseSec: round(releaseSec),
            boundarySteps, maxStepM: round(maxStepM) });
        } finally { legacyLine._tt.pop(); }
      }

      // 已越過 target：官方又給舊站未來 ETA 時必須 fail closed，不建 Infinity motion、不倒走。
      const pastTargetCases = [];
      const pastLine = lines.find(ln => ln.hasShape && ln.stations && ln.stations.length >= 3 &&
        runBetween(ln, 0, 1) > 20 && runBetween(ln, 1, 2) > 20);
      if (pastLine) {
        const from = 0, to = 1, next = 2, run1 = runBetween(pastLine, from, to), run2 = runBetween(pastLine, to, next);
        const now = 46800, dep0 = now - run1 - Math.min(20, run2 / 3), dep1 = dep0 + run1;
        const tr = [from, dep0, to, dep1, next, dep1 + run2 + 30]; pastLine._tt.push(tr);
        try {
          clearTrtcBoard(); _easedShift.clear(); state.simSec = now;
          _mlGate = true; _mlGateAt = Date.now(); _metroGateEp.on = true; _metroGateEp.at = performance.now() - 6000;
          const before = freqTrainPosAt(pastLine, tr, now), beforeD = projectOntoShape(pastLine, before.lat, before.lon).d;
          const arrSec = now + 60, arrEpoch = epochForServiceSec(arrSec), dir = 2;
          const eta = { from, to, run: run1, arrEpoch }, row = { line: pastLine.id, dir, from, to, dest: next,
            run: run1, arrEpoch, no: '', terminal: false };
          const audit = applyTrtcBoard([row], epochForServiceSec(now), [{ line: pastLine.id, dir,
            key: tripLocalKey(tr), trackId: 'track:past-target', shift: arrSec - (dep0 + run1), eta }]);
          if (pastLine._trtcBoard) pastLine._trtcBoard.at = Date.now();
          const rec = pastLine._trtcBoard && pastLine._trtcBoard.positions && pastLine._trtcBoard.positions.get(tr);
          state.simSec = now + tickSec; const after = freqTrainPosAt(pastLine, tr, now + tickSec);
          const afterD = projectOntoShape(pastLine, after.lat, after.lon).d;
          const expectedDir = Math.sign(pastLine.stations[to].d - pastLine.stations[from].d) || 1;
          pastTargetCases.push({ line: pastLine.id, matched: audit && audit.matched, endpoint: !!rec,
            pastTargetAudit: audit && audit.pastTarget, endSec: rec && rec.endSec,
            finiteEndSec: !rec || Number.isFinite(rec.endSec),
            beforeD: round(beforeD, 6), afterD: round(afterD, 6),
            progressDeltaM: round((afterD - beforeD) * expectedDir * 1000),
            reversed: (afterD - beforeD) * expectedDir < -trackToleranceM / 1000 });
        } finally { pastLine._tt.pop(); }
      }

      // 兩台同線同向、同一官方站間 motion：後車 ETA 較早，無 gate 會穿過前車。
      const officialPairCases = [];
      const pairLine = lines.find(ln => ln.hasShape && ln.stations && ln.stations.length >= 2 && runBetween(ln, 0, 1) > 80);
      if (pairLine) {
        const from = 0, to = 1, run = runBetween(pairLine, from, to), now = 50400, dir = 2;
        const leadDep = Math.round(now - run * .6), rearDep = Math.round(now - run * .2);
        const lead = [from, leadDep, to, now + run * 3], rear = [from, rearDep, to, now + run * 3 + 1];
        pairLine._tt.push(lead, rear);
        try {
          clearTrtcBoard(); _easedShift.clear(); state.simSec = now;
          _mlGate = true; _mlGateAt = Date.now(); _metroGateEp.on = true; _metroGateEp.at = performance.now() - 6000;
          freqTrainPosAt(pairLine, lead, now); freqTrainPosAt(pairLine, rear, now);
          const specs = [
            { tr: lead, dep: leadDep, arrSec: now + 100, id: 'track:pair-lead' },
            { tr: rear, dep: rearDep, arrSec: now + 70, id: 'track:pair-rear' },
          ];
          const rows = specs.map(x => ({ line: pairLine.id, dir, from, to, dest: to, run,
            arrEpoch: epochForServiceSec(x.arrSec), no: '', terminal: false }));
          const trips = specs.map(x => ({ line: pairLine.id, dir, key: tripLocalKey(x.tr), trackId: x.id,
            shift: x.arrSec - (x.dep + run), eta: { from, to, run, arrEpoch: epochForServiceSec(x.arrSec) } }));
          const audit = applyTrtcBoard(rows, epochForServiceSec(now), trips);
          if (pairLine._trtcBoard) pairLine._trtcBoard.at = Date.now();
          let swaps = 0, minGapM = Infinity, linked = !!(pairLine._trtcBoard && pairLine._trtcBoard.headways &&
            pairLine._trtcBoard.headways.has(rear));
          for (let t = now; t <= now + 105; t += tickSec) {
            state.simSec = t;
            const lp = freqTrainPosAt(pairLine, lead, t), rp = freqTrainPosAt(pairLine, rear, t);
            const loD = Math.min(pairLine.stations[from].d, pairLine.stations[to].d);
            const hiD = Math.max(pairLine.stations[from].d, pairLine.stations[to].d);
            const ld = projectShapeRange(pairLine, lp, loD, hiD).d;
            const rd = projectShapeRange(pairLine, rp, loD, hiD).d;
            const gapM = (ld - rd) * 1000; minGapM = Math.min(minGapM, gapM);
            if (gapM < -trackToleranceM) swaps++;
          }
          officialPairCases.push({ line: pairLine.id, matched: audit && audit.matched, linked,
            samples: Math.floor(105 / tickSec) + 1, swaps, minGapM: round(minGapM) });
        } finally { pairLine._tt.pop(); pairLine._tt.pop(); }
      }

      // 跨輪 headway：rear 本輪已被順序 gate 限位；15 秒 refresh 必從最後「真的畫出」的位置續跑，
      // 不能從上一段未限位的 raw previousMotion 接手，否則 headway link 會換邊、同格跳位或交換身分。
      const headwayRefreshCases = [];
      const refreshLine = lines.find(ln => ln.hasShape && ln.stations && ln.stations.length >= 2 && runBetween(ln, 0, 1) > 80);
      if (refreshLine) {
        const from = 0, to = 1, run = runBetween(refreshLine, from, to), now = 52200, dir = 2;
        const leadDep = Math.round(now - run * .60), rearDep = Math.round(now - run * .55);
        const lead = [from, leadDep, to, now + run * 4], rear = [from, rearDep, to, now + run * 4 + 1];
        refreshLine._tt.push(lead, rear);
        try {
          clearTrtcBoard(); _easedShift.clear(); state.simSec = now;
          _mlGate = true; _mlGateAt = Date.now(); _metroGateEp.on = true; _metroGateEp.ep++; _metroGateEp.at = performance.now() - 6000;
          freqTrainPosAt(refreshLine, lead, now); freqTrainPosAt(refreshLine, rear, now);
          const specs = [
            { tr: lead, dep: leadDep, arrSec: now + 90, id: 'track:refresh-lead' },
            { tr: rear, dep: rearDep, arrSec: now + 20, id: 'track:refresh-rear' },
          ];
          const rows = specs.map(x => ({ line: refreshLine.id, dir, from, to, dest: to, run,
            arrEpoch: epochForServiceSec(x.arrSec), no: '', terminal: false }));
          const trips = specs.map(x => ({ line: refreshLine.id, dir, key: tripLocalKey(x.tr), trackId: x.id,
            shift: x.arrSec - (x.dep + run), eta: { from, to, run, arrEpoch: epochForServiceSec(x.arrSec) } }));
          const firstAudit = applyTrtcBoard(rows, epochForServiceSec(now), trips);
          if (refreshLine._trtcBoard) refreshLine._trtcBoard.at = Date.now();
          const refreshSec = now + 15;
          let beforeRefresh = null, limitedBeforeRefresh = false;
          for (let t = now; t <= refreshSec + 1e-9; t = Math.min(refreshSec, t + tickSec)) {
            state.simSec = t;
            freqTrainPosAt(refreshLine, lead, t);
            beforeRefresh = freqTrainPosAt(refreshLine, rear, t);
            const rearRec = refreshLine._trtcBoard && refreshLine._trtcBoard.positions.get(rear);
            limitedBeforeRefresh = limitedBeforeRefresh || !!(rearRec && rearRec.orderLimited);
            if (t === refreshSec) break;
          }
          const secondAudit = applyTrtcBoard(rows, epochForServiceSec(refreshSec), trips);
          if (refreshLine._trtcBoard) refreshLine._trtcBoard.at = Date.now();
          state.simSec = refreshSec;
          freqTrainPosAt(refreshLine, lead, refreshSec);
          const rearAfter = freqTrainPosAt(refreshLine, rear, refreshSec);
          const linkAfter = refreshLine._trtcBoard && refreshLine._trtcBoard.headways && refreshLine._trtcBoard.headways.get(rear);
          const rearRecAfter = refreshLine._trtcBoard && refreshLine._trtcBoard.positions && refreshLine._trtcBoard.positions.get(rear);
          let swapsAfter = 0, minGapM = Infinity;
          for (let t = refreshSec; t <= now + 20 + 1e-9; t = Math.min(now + 20, t + tickSec)) {
            state.simSec = t;
            const lp = freqTrainPosAt(refreshLine, lead, t), rp = freqTrainPosAt(refreshLine, rear, t);
            const loD = Math.min(refreshLine.stations[from].d, refreshLine.stations[to].d);
            const hiD = Math.max(refreshLine.stations[from].d, refreshLine.stations[to].d);
            const ld = projectShapeRange(refreshLine, lp, loD, hiD).d, rd = projectShapeRange(refreshLine, rp, loD, hiD).d;
            const gapM = (ld - rd) * 1000; minGapM = Math.min(minGapM, gapM);
            if (gapM < -trackToleranceM) swapsAfter++;
            if (t === now + 20) break;
          }
          const firstKeys = (firstAudit && firstAudit.assignments || []).map(x => x.backendKey).sort();
          const secondKeys = (secondAudit && secondAudit.assignments || []).map(x => x.backendKey).sort();
          headwayRefreshCases.push({ line: refreshLine.id, refreshSec, limitedBeforeRefresh,
            firstMatched: firstAudit && firstAudit.matched, secondMatched: secondAudit && secondAudit.matched,
            sameAssignments: JSON.stringify(firstKeys) === JSON.stringify(secondKeys),
            rearStillLinkedToLead: !!(linkAfter && linkAfter.lead === lead),
            refreshJumpM: round(metres(beforeRefresh, rearAfter)),
            startFromRenderedM: rearRecAfter ? round(metres(rearRecAfter.startPos, beforeRefresh)) : null,
            swapsAfter, minGapM: round(minGapM) });
        } finally { refreshLine._tt.pop(); refreshLine._tt.pop(); }
      }

      // 路線隱藏／切到全台同框後可能 60s 沒有真正繪制；下一輪 snapshot 不得拿
      // _trtcLastRendered 的舊畫格重跑，要以前一份 motion 在當下時刻的位置接手。
      const staleRenderedCases = [];
      const staleLine = lines.find(ln => candidates(ln).some(c => c.delay >= 60 && c.run > 80));
      if (staleLine && typeof trtcEndpointPositionValue === 'function') {
        const c = candidates(staleLine).find(x => x.delay >= 60 && x.run > 80);
        if (c) {
          const { tr, from, to, dep, run } = c, delay = 60;
          const savedTT = staleLine._tt, dir = tr[0] < tr[tr.length - 2] ? 2 : 1;
          staleLine._tt = [tr];
          try {
            const observedSec = dep + delay, refreshSec = observedSec + 60, arrSec = dep + run + delay;
            const arrEpoch = epochForServiceSec(arrSec), eta = { from, to, run, arrEpoch };
            const row = { line: staleLine.id, dir, from, to, dest: tr[tr.length - 2], run, arrEpoch,
              no: '', terminal: false };
            const trip = { line: staleLine.id, dir, key: tripLocalKey(tr), trackId: 'track:stale-rendered',
              shift: delay, eta };
            clearTrtcBoard(); _easedShift.clear(); state.simSec = observedSec;
            _mlGate = true; _mlGateAt = Date.now(); _metroGateEp.on = true;
            _metroGateEp.ep++; _metroGateEp.at = performance.now() - 6000;
            freqTrainPosAt(staleLine, tr, observedSec);
            const firstAudit = applyTrtcBoard([row], epochForServiceSec(observedSec), [trip]);
            if (staleLine._trtcBoard) staleLine._trtcBoard.at = Date.now();
            state.simSec = observedSec;
            const firstRendered = freqTrainPosAt(staleLine, tr, observedSec);
            const firstRec = staleLine._trtcBoard && staleLine._trtcBoard.positions && staleLine._trtcBoard.positions.get(tr);
            const physicalKey = trtcMotionTrackKey(staleLine, tr);
            const staleLast = _trtcLastRendered.get(physicalKey);
            // 模擬 hidden 60s：直接解析舊 motion 當下應在位置，中間不呼叫 freqTrainPosAt。
            const previousAtRefresh = firstRec && trtcEndpointPositionValue(staleLine, firstRec, refreshSec);
            state.simSec = refreshSec;
            const secondAudit = applyTrtcBoard([row], epochForServiceSec(refreshSec), [trip]);
            if (staleLine._trtcBoard) staleLine._trtcBoard.at = Date.now();
            const secondRec = staleLine._trtcBoard && staleLine._trtcBoard.positions && staleLine._trtcBoard.positions.get(tr);
            const afterRefresh = freqTrainPosAt(staleLine, tr, refreshSec);
            staleRenderedCases.push({ line: staleLine.id,
              firstMatched: firstAudit && firstAudit.matched, secondMatched: secondAudit && secondAudit.matched,
              staleAgeSec: staleLast ? round(refreshSec - staleLast.simSec) : null,
              oldMotionAdvanceM: round(metres(firstRendered, previousAtRefresh)),
              startFromPreviousM: secondRec ? round(metres(secondRec.startPos, previousAtRefresh)) : null,
              startFromStaleM: secondRec && staleLast ? round(metres(secondRec.startPos, staleLast.pos)) : null,
              refreshJumpM: round(metres(previousAtRefresh, afterRefresh)) });
          } finally { staleLine._tt = savedTT; }
        }
      }

      // 三車 chain：只有前車 A 有 endpoint，B/C 都是 unmatched roster 車。A 限住 B 後，C 必須
      // 透過 C→B→A 遞迴 chain 同步限位；若在 B/C「兩台都 unmatched」處斷鏈，C 會穿過 B。
      const rosterChainCases = [];
      const chainLine = lines.find(ln => ln.hasShape && ln.stations && ln.stations.length >= 2 && runBetween(ln, 0, 1) > 80);
      if (chainLine) {
        const from = 0, to = 1, run = runBetween(chainLine, from, to), now = 53100, dir = 2;
        const leadDep = Math.round(now - run * .60), deps = [leadDep, leadDep + 2, leadDep + 4];
        const [A, B, C] = deps.map((dep, i) => [from, dep, to, now + run * 4 + i]);
        chainLine._tt.push(A, B, C);
        try {
          clearTrtcBoard(); _easedShift.clear(); state.simSec = now;
          _mlGate = true; _mlGateAt = Date.now(); _metroGateEp.on = true; _metroGateEp.ep++; _metroGateEp.at = performance.now() - 6000;
          for (const tr of [A, B, C]) freqTrainPosAt(chainLine, tr, now);
          const arrSec = now + run * 2, arrEpoch = epochForServiceSec(arrSec), eta = { from, to, run, arrEpoch };
          const audit = applyTrtcBoard([{ line: chainLine.id, dir, from, to, dest: to, run, arrEpoch,
            no: '', terminal: false }], epochForServiceSec(now), [{ line: chainLine.id, dir,
            key: tripLocalKey(A), trackId: 'track:chain-A', shift: arrSec - (deps[0] + run), eta }]);
          if (chainLine._trtcBoard) chainLine._trtcBoard.at = Date.now();
          const linkB = chainLine._trtcBoard && chainLine._trtcBoard.headways && chainLine._trtcBoard.headways.get(B);
          const linkC = chainLine._trtcBoard && chainLine._trtcBoard.headways && chainLine._trtcBoard.headways.get(C);
          let swapsAB = 0, swapsBC = 0, minAB = Infinity, minBC = Infinity;
          const loD = Math.min(chainLine.stations[from].d, chainLine.stations[to].d);
          const hiD = Math.max(chainLine.stations[from].d, chainLine.stations[to].d);
          const end = now + Math.min(run * 1.5, 300);
          for (let t = now; t <= end + 1e-9; t = Math.min(end, t + tickSec)) {
            state.simSec = t;
            const ap = freqTrainPosAt(chainLine, A, t), bp = freqTrainPosAt(chainLine, B, t), cp = freqTrainPosAt(chainLine, C, t);
            const ad = projectShapeRange(chainLine, ap, loD, hiD).d;
            const bd = projectShapeRange(chainLine, bp, loD, hiD).d;
            const cd = projectShapeRange(chainLine, cp, loD, hiD).d;
            const gapAB = (ad - bd) * 1000, gapBC = (bd - cd) * 1000;
            minAB = Math.min(minAB, gapAB); minBC = Math.min(minBC, gapBC);
            if (gapAB < -trackToleranceM) swapsAB++;
            if (gapBC < -trackToleranceM) swapsBC++;
            if (t === end) break;
          }
          rosterChainCases.push({ line: chainLine.id, matched: audit && audit.matched,
            linkBtoA: !!(linkB && linkB.lead === A), linkCtoB: !!(linkC && linkC.lead === B),
            samples: Math.floor((end - now) / tickSec) + 1, swapsAB, swapsBC,
            minGapABM: round(minAB), minGapBCM: round(minBC) });
        } finally { chainLine._tt.pop(); chainLine._tt.pop(); chainLine._tt.pop(); }
      }

      // 折返／rebind 時同一實體 track 從班次 A 交棒到 B：eased channel 必沿 track 延續。
      // 這裡直接經 applyTrtcBoard 兩輪，不手造 Map witness；metroShiftSec 改回 trip key 時 B 會從 0 重爬。
      const easedHandoffCases = [];
      const easedLine = lines.find(ln => ln.hasShape && ln.stations && ln.stations.length >= 2 && runBetween(ln, 0, 1) > 40);
      if (easedLine) {
        const from = 0, to = 1, run = runBetween(easedLine, from, to), now = 54000, dir = 2, shift = 60;
        const aDep = Math.round(now - run * .2), bDep = Math.round(now - run * .1);
        const A = [from, aDep, to, now + run * 4], B = [from, bDep, to, now + run * 4 + 1];
        easedLine._tt.push(A, B);
        try {
          clearTrtcBoard(); _easedShift.clear(); state.simSec = now;
          _mlGate = true; _mlGateAt = Date.now(); _metroGateEp.on = true; _metroGateEp.ep++; _metroGateEp.at = performance.now() - 6000;
          const applyOne = (tr, dep, observedSec) => {
            const arrSec = dep + run + shift, arrEpoch = epochForServiceSec(arrSec), eta = { from, to, run, arrEpoch };
            state.simSec = observedSec;
            const audit = applyTrtcBoard([{ line: easedLine.id, dir, from, to, dest: to, run, arrEpoch,
              no: '', terminal: false }], epochForServiceSec(observedSec), [{ line: easedLine.id, dir,
              key: tripLocalKey(tr), trackId: 'track:eased-handoff', shift, eta }]);
            if (easedLine._trtcBoard) easedLine._trtcBoard.at = Date.now();
            return { audit, value: metroShiftSec(easedLine, tr) };
          };
          const first = applyOne(A, aDep, now), second = applyOne(B, bDep, now + tickSec);
          const firstAssignment = first.audit && first.audit.assignments && first.audit.assignments[0];
          const secondAssignment = second.audit && second.audit.assignments && second.audit.assignments[0];
          easedHandoffCases.push({ line: easedLine.id, physicalTrack: 'track:eased-handoff',
            firstMatched: first.audit && first.audit.matched, secondMatched: second.audit && second.audit.matched,
            firstTripKey: firstAssignment && firstAssignment.backendKey,
            secondTripKey: secondAssignment && secondAssignment.backendKey,
            firstShift: round(first.value), secondShift: round(second.value),
            firstTarget: firstAssignment && firstAssignment.shift, secondTarget: secondAssignment && secondAssignment.shift,
            continuous: !!(firstAssignment && secondAssignment && Math.abs(first.value - firstAssignment.shift) <= 1e-6 &&
              Math.abs(second.value - secondAssignment.shift) <= 1e-6 && Math.abs(second.value - first.value) <= 1e-6) });
        } finally { easedLine._tt.pop(); easedLine._tt.pop(); }
      }

      // 來源切換／reclaim 不得跳位：同 trip 的 trackId 更換時從上一畫格接手；
      // feed 整批中斷時也不可當場跳回班表位置。
      const transitionCases = [];
      const transitionLine = lines.find(ln => candidates(ln).some(c => c.delay >= 60));
      if (transitionLine) {
        const c = candidates(transitionLine).find(x => x.delay >= 60);
        const { tr, from, to, dep, run } = c, delay = 60, dir = tr[0] < tr[tr.length - 2] ? 2 : 1;
        const observedSec = dep + delay, arrSec = dep + run + delay;
        const arrEpoch = epochForServiceSec(arrSec), eta = { from, to, run, arrEpoch }, key = tripLocalKey(tr);
        const row = { line: transitionLine.id, dir, from, to, dest: tr[tr.length - 2], run, arrEpoch, no: '', terminal: false };
        clearTrtcBoard(); _easedShift.clear(); state.simSec = observedSec;
        _mlGate = true; _mlGateAt = Date.now(); _metroGateEp.on = true; _metroGateEp.at = performance.now() - 6000;
        freqTrainPosAt(transitionLine, tr, observedSec);
        applyTrtcBoard([row], epochForServiceSec(observedSec), [{ line: transitionLine.id, dir, key, trackId: 'track:before-reclaim', shift: delay, eta }]);
        if (transitionLine._trtcBoard) transitionLine._trtcBoard.at = Date.now();
        const switchSec = observedSec + run / 2;
        state.simSec = switchSec; const beforeReclaim = freqTrainPosAt(transitionLine, tr, switchSec);
        const reclaimAudit = applyTrtcBoard([row], epochForServiceSec(switchSec), [{ line: transitionLine.id, dir, key, trackId: 'track:after-reclaim', shift: delay, eta }]);
        if (transitionLine._trtcBoard) transitionLine._trtcBoard.at = Date.now();
        const reclaimRec = transitionLine._trtcBoard && transitionLine._trtcBoard.positions && transitionLine._trtcBoard.positions.get(tr);
        state.simSec = switchSec; const afterReclaim = freqTrainPosAt(transitionLine, tr, switchSec);
        clearTrtcBoard(); state.simSec = switchSec; const afterFeedLoss = freqTrainPosAt(transitionLine, tr, switchSec);
        const nominalMps = (transitionLine.hasShape
          ? Math.abs(transitionLine.stations[to].d - transitionLine.stations[from].d) * 1000
          : metres(posBetweenStations(transitionLine, from, to, 0), posBetweenStations(transitionLine, from, to, 1))) / run;
        const maxStepM = nominalMps * TRTC_MOTION_MAX_RATE * tickSec + .05;
        transitionCases.push({ line: transitionLine.id, reclaimJumpM: round(metres(beforeReclaim, afterReclaim)),
          feedLossJumpM: round(metres(afterReclaim, afterFeedLoss)), maxStepM: round(maxStepM),
          reclaimMatched: reclaimAudit && reclaimAudit.matched, reclaimEndpoint: !!reclaimRec,
          reclaimClamped: reclaimRec && reclaimRec.clamped, reclaimStartPos: reclaimRec && reclaimRec.startPos,
          reclaimStartD: reclaimRec && reclaimRec.startD, reclaimTargetD: reclaimRec && reclaimRec.targetD,
          reclaimStartSec: reclaimRec && reclaimRec.startSec, beforeReclaim, afterReclaim });
      }

      // dirArrow 會查 current 後立刻查 t-8；歷史查詢不得覆寫 _trtcLastRendered，否則下一輪
      // endpoint refresh 會從八秒前倒退接手。
      const historyQueryCases = [];
      const historyLine = lines.find(ln => candidates(ln).some(c => c.delay >= 60));
      if (historyLine && typeof trtcMotionTrackKey === 'function') {
        const c = candidates(historyLine).find(x => x.delay >= 60), delay = 60;
        if (c) {
          const { tr, from, to, dep, run } = c, dir = tr[0] < tr[tr.length - 2] ? 2 : 1;
          const observedSec = dep + delay, arrSec = dep + run + delay;
          const arrEpoch = epochForServiceSec(arrSec), eta = { from, to, run, arrEpoch };
          const row = { line: historyLine.id, dir, from, to, dest: tr[tr.length - 2], run, arrEpoch, no: '', terminal: false };
          const trip = { line: historyLine.id, dir, key: tripLocalKey(tr), trackId: 'track:history-query', shift: delay, eta };
          clearTrtcBoard(); _easedShift.clear(); state.simSec = observedSec;
          _mlGate = true; _mlGateAt = Date.now(); _metroGateEp.on = true; _metroGateEp.ep++; _metroGateEp.at = performance.now() - 6000;
          freqTrainPosAt(historyLine, tr, observedSec);
          applyTrtcBoard([row], epochForServiceSec(observedSec), [trip]);
          if (historyLine._trtcBoard) historyLine._trtcBoard.at = Date.now();
          const currentSec = observedSec + Math.min(20, run / 3);
          state.simSec = currentSec;
          const currentPos = freqTrainPosAt(historyLine, tr, currentSec);
          const physicalKey = trtcMotionTrackKey(historyLine, tr);
          const afterCurrent = _trtcLastRendered.get(physicalKey);
          const historyPos = freqTrainPosAt(historyLine, tr, currentSec - 8);
          const afterHistory = _trtcLastRendered.get(physicalKey);
          const beforeRefresh = currentPos;
          applyTrtcBoard([row], epochForServiceSec(currentSec), [trip]);
          if (historyLine._trtcBoard) historyLine._trtcBoard.at = Date.now();
          state.simSec = currentSec;
          const afterRefresh = freqTrainPosAt(historyLine, tr, currentSec);
          const rec = historyLine._trtcBoard && historyLine._trtcBoard.positions && historyLine._trtcBoard.positions.get(tr);
          historyQueryCases.push({ line: historyLine.id,
            currentVsHistoryM: round(metres(currentPos, historyPos)),
            lastAfterCurrentM: round(metres(afterCurrent && afterCurrent.pos, currentPos)),
            lastAfterHistoryM: round(metres(afterHistory && afterHistory.pos, currentPos)),
            refreshJumpM: round(metres(beforeRefresh, afterRefresh)),
            startFromCurrentM: rec ? round(metres(rec.startPos, currentPos)) : null });
        }
      }

      // 04:00 換營運日且首輪 trips=[]：前一日四份 physical state 與 track eased 必先清乾淨。
      const serviceDayRolloverCases = [];
      const rolloverLine = lines.find(ln => ln._tt && ln._tt.length);
      if (rolloverLine && typeof trtcPreparePhysicalServiceDay === 'function' &&
          typeof trtcMotionTrackKey === 'function') {
        const seedTrip = [0, 14380, 1, 14480], oldDay = '2026-08-12', newDay = '2026-08-13';
        rolloverLine._tt.push(seedTrip); // 04:00:01 確實仍在名冊，才能抓「昨日 endpoint 被 legacy carry」
        const tripKey = freqTripKey(rolloverLine, seedTrip), oldPhysical = oldDay + '|track:rollover-old';
        const easedKey = trtcEasedMotionKey(rolloverLine, seedTrip, oldPhysical);
        const legacyEasedKey = trtcEasedMotionKey(rolloverLine, seedTrip, null);
        _trtcPhysicalServiceDay = oldDay;
        _trtcPhysicalByTrip.set(tripKey, oldPhysical);
        _trtcTripByPhysical.set(oldPhysical, tripKey);
        _trtcEndpointByTrack.set(oldPhysical, { line: rolloverLine.id, endpoint: true });
        _trtcLastRendered.set(oldPhysical, { line: rolloverLine.id, pos: { lat: 25, lon: 121 } });
        _easedShift.set(easedKey, { cur: 60, at: performance.now(), sim: 14399, ep: _metroGateEp.ep });
        _easedShift.set(legacyEasedKey, { cur: 45, at: performance.now(), sim: 14399, ep: _metroGateEp.ep });
        const oldBoardMotion = { line: rolloverLine.id, endpoint: true, trackId: oldPhysical, from: seedTrip[0],
          to: seedTrip[2], run: 60, arrSec: 14430, startSec: 14380, moveSec: 14380, endSec: 14430,
          releaseSec: 14430, startPos: { lat: 25, lon: 121 }, targetPos: { lat: 25.001, lon: 121.001 } };
        rolloverLine._trtcBoard = { positions: new Map([[seedTrip, oldBoardMotion]]), shifts: new Map([[seedTrip, 60]]),
          tracks: new Map([[seedTrip, oldPhysical]]), headways: new Map(), all: 60, at: Date.now(), n: 1 };
        const rolloverEpoch = Date.parse(newDay + 'T04:00:01+08:00') / 1000;
        state.simSec = 14401;
        applyTrtcBoard([], rolloverEpoch, []);
        const stateAfterEmpty = {
          serviceDay: _trtcPhysicalServiceDay,
          physicalByTrip: _trtcPhysicalByTrip.has(tripKey), tripByPhysical: _trtcTripByPhysical.has(oldPhysical),
          endpoint: _trtcEndpointByTrack.has(oldPhysical), rendered: _trtcLastRendered.has(oldPhysical),
          eased: _easedShift.has(easedKey), legacyEased: _easedShift.has(legacyEasedKey),
          oldBoardPresent: !!rolloverLine._trtcBoard,
          newTripPhysical: trtcMotionTrackKey(rolloverLine, seedTrip),
        };
        const newPhysical = trtcBindPhysicalIdentity(rolloverLine, seedTrip, newDay, 'track:rollover-new');
        const newEasedKey = trtcEasedMotionKey(rolloverLine, seedTrip, newPhysical);
        const inherited = _easedShift.get(newEasedKey);
        serviceDayRolloverCases.push({ oldDay, newDay, stateAfterEmpty,
          afterBind: { physical: trtcMotionTrackKey(rolloverLine, seedTrip),
            newEasedPresent: _easedShift.has(newEasedKey), newEasedCur: inherited && inherited.cur } });
        rolloverLine._tt.pop();
      }

      // App 長開跨 04:00：Worker 已用新 serviceDay 的 trip key，前端 cached _tt 也必由同一日型重選。
      // 用週五→週六兩組刻意不同的 sets，避免「兩日班表剛好相同」造成假綠。
      const dayTypeRefreshCases = [];
      if (typeof prepFreqTimes === 'function' && typeof trtcBackendTripForLine === 'function') {
        const d1 = '2026-08-14', d2 = '2026-08-15';
        const d1Trip = [0, 14400, 1, 14500], d2Trip = [0, 14410, 1, 14510];
        const syntheticLine = { id: 'R', _sys: 'mrt', times: {
          days: ['WE', 'WD', 'WD', 'WD', 'WD', 'WD', 'WE'], sets: { WD: [d1Trip], WE: [d2Trip] },
        } };
        state.lines.push(syntheticLine);
        try {
          prepFreqTimes(syntheticLine, d1);
          const d1Key = trtcLocalTripKey(d1Trip), d2Key = trtcLocalTripKey(d2Trip);
          const d1Matched = trtcBackendTripForLine(syntheticLine, { key: d1Key, dir: 2 }) === d1Trip;
          state.freqFollow = { ln: syntheticLine, tr: d1Trip };
          _trtcPhysicalServiceDay = d1;
          state.simSec = 14401;
          const d2Epoch = Date.parse(d2 + 'T04:00:01+08:00') / 1000;
          applyTrtcBoard([], d2Epoch, []);
          dayTypeRefreshCases.push({ d1, d2, d1Matched,
            ttServiceDay: syntheticLine._ttServiceDay || null,
            d2Matched: trtcBackendTripForLine(syntheticLine, { key: d2Key, dir: 2 }) === d2Trip,
            d1StillMatches: !!trtcBackendTripForLine(syntheticLine, { key: d1Key, dir: 2 }),
            selectedWeekendSet: syntheticLine._tt === syntheticLine.times.sets.WE,
            oldFollowCleared: !state.freqFollow,
          });
        } finally {
          if (state.freqFollow && state.freqFollow.ln === syntheticLine) state.freqFollow = null;
          state.lines.pop();
        }
      }

      // poll 不得先用舊 _tt 決定要不要進 apply：舊平日型可能剛好是 []，但 Worker
      // payload 已切到新假日且有班次。成功 rows+at 必須一律交給 apply 先重建 _tt。
      const pollDayTypeCases = [];
      const pollLine = lines.find(ln => ln.hasShape && ln.stations && ln.stations.length >= 2 && runBetween(ln, 0, 1) > 5);
      if (pollLine && typeof pollTrtcLive === 'function' && typeof prepFreqTimes === 'function' &&
          typeof trtcBackendTripForLine === 'function') {
        const saved = { lines: state.lines, times: pollLine.times, tt: pollLine._tt,
          ttServiceDay: pollLine._ttServiceDay, board: pollLine._trtcBoard, fetch: window.fetch,
          simSec: state.simSec, audit: state._trtcBoardAudit, follow: state.freqFollow };
        const d1 = '2026-08-14', d2 = '2026-08-15', now = Math.round(nowSecOfDay());
        const from = 0, to = 1, run = runBetween(pollLine, from, to), dep = now - 10;
        const newTrip = [from, dep, to, dep + run + 60];
        const emptySet = [], newSet = [newTrip];
        const syntheticTimes = { days: ['WE', 'EMPTY', 'EMPTY', 'EMPTY', 'EMPTY', 'EMPTY', 'WE'],
          sets: { EMPTY: emptySet, WE: newSet } };
        let fetchCalls = 0;
        try {
          pollLine.times = syntheticTimes;
          prepFreqTimes(pollLine, d1);
          const oldEmpty = pollLine._tt === emptySet && pollLine._tt.length === 0;
          state.lines = [pollLine]; state.freqFollow = null; state.simSec = now;
          state._trtcBoardAudit = null; delete pollLine._trtcBoard; _trtcPolling = false;
          const arrSec = dep + run, arrEpoch = Date.parse(d2 + 'T00:00:00+08:00') / 1000 + arrSec;
          const atEpoch = Date.parse(d2 + 'T00:00:00+08:00') / 1000 + now;
          const dir = from < to ? 2 : 1, key = tripLocalKey(newTrip);
          const eta = { from, to, run, arrEpoch };
          const payload = { src: 'trtc', board: [], boardPos: {
            at: atEpoch,
            rows: [{ line: pollLine.id, dir, from, to, dest: to, run, arrEpoch, no: '', terminal: false }],
            trips: [{ line: pollLine.id, dir, key, trackId: 'track:poll-new-day', shift: 0, eta }],
          } };
          window.fetch = async () => { fetchCalls++; return { ok: true, json: async () => payload }; };
          await pollTrtcLive();
          const audit = state._trtcBoardAudit;
          const endpointApplied = !!(pollLine._trtcBoard && pollLine._trtcBoard.positions &&
            pollLine._trtcBoard.positions.get(newTrip));
          // 真實 network reject 要走 outer catch：不可再引用 inner block 變數造成
          // ReferenceError，finally 必須解鎖；此處種一份非 endpoint board 證明合理 clear 有發生。
          pollLine._trtcBoard = { positions: new Map([[newTrip, { endpoint: false }]]),
            shifts: new Map(), tracks: new Map(), headways: new Map(), all: 0, at: Date.now(), n: 1 };
          window.fetch = async () => { fetchCalls++; throw new Error('fixture-network-reject'); };
          let networkThrow = null;
          try { await pollTrtcLive(); } catch (e) { networkThrow = String(e); }
          pollDayTypeCases.push({ line: pollLine.id, d1, d2, oldEmpty, fetchCalls,
            ttServiceDay: pollLine._ttServiceDay || null,
            selectedNewSet: pollLine._tt === newSet,
            exactNewKey: trtcBackendTripForLine(pollLine, { key, dir }) === newTrip,
            applied: !!(audit && audit.mode === 'backend' && audit.matched === 1),
            endpointApplied,
            networkThrow, pollingUnlocked: !_trtcPolling,
            networkClearedNonEndpoint: !pollLine._trtcBoard,
          });
        } finally {
          window.fetch = saved.fetch; _trtcPolling = false; state.lines = saved.lines;
          pollLine.times = saved.times; pollLine._tt = saved.tt; pollLine._ttServiceDay = saved.ttServiceDay;
          if (saved.board) pollLine._trtcBoard = saved.board; else delete pollLine._trtcBoard;
          state.simSec = saved.simSec; state._trtcBoardAudit = saved.audit; state.freqFollow = saved.follow;
        }
      }

      const rosterEdges = [];
      for (const ln of lines) {
        const tr = ln._tt.find(x => x.length >= 4); if (!tr) continue;
        const t = tr[1], roster = ln._tt.filter(x => freqTrainTime(x, t) != null).length;
        clearTrtcBoard(); state.simSec = t;
        const missing = ln._tt.filter(x => freqTrainPosAt(ln, x, t) != null).length;
        const fakeEpoch = epochForServiceSec(t + 30);
        const fake = { line: ln.id, dir: 2, from: 9999, to: 10000, dest: 10000, run: 30,
          arrEpoch: fakeEpoch, no: 'does-not-exist', terminal: false };
        try { applyTrtcBoard([fake], epochForServiceSec(t), [{ line: ln.id, dir: 2, key: 'not-a-trip', trackId: 'fake', eta: { from: 9999, to: 10000, run: 30, arrEpoch: fakeEpoch } }]); } catch (e) {}
        const extra = ln._tt.filter(x => freqTrainPosAt(ln, x, t) != null).length;
        rosterEdges.push({ line: ln.id, roster, missing, extra });
        for (const [edge, edgeT] of [['before', tr[1] - tickSec], ['after', tr[tr.length - 1] + tickSec]]) {
          clearTrtcBoard(); state.simSec = edgeT;
          const expected = ln._tt.filter(x => freqTrainTime(x, edgeT) != null).length;
          const rendered = ln._tt.filter(x => freqTrainPosAt(ln, x, edgeT) != null).length;
          rosterBoundaryChecks.push({ line: ln.id, edge, t: round(edgeT), expected, rendered });
        }
      }

      // 改前／改後身分漂移對照：同 route 長生命 A/B 相隔一個頭距，官方 ETA 三輪從靠 A 跨到靠 B。
      // baseline legacy 只能每輪按 |shift| 重猜，應 A→B；backend payload 每輪明示 A，必須維持 A。
      const identitySwitchCases = [];
      const switchLine = lines.find(ln => ln.hasShape && ln.stations && ln.stations.length >= 2 && runBetween(ln, 0, 1) > 60);
      if (switchLine) {
        const from = 0, to = 1, run = runBetween(switchLine, from, to), now = 57600, dir = 2;
        const headway = Math.max(20, Math.min(120, Math.floor(run * .3)));
        const aDep = now - Math.floor(run * .4), bDep = aDep + headway;
        const A = [from, aDep, to, aDep + run + 600], B = [from, bDep, to, bDep + run + 600];
        const keyA = tripLocalKey(A), keyB = tripLocalKey(B), aArrival = aDep + run;
        switchLine._tt.push(A, B);
        try {
          clearTrtcBoard(); _easedShift.clear();
          _mlGate = true; _mlGateAt = Date.now(); _metroGateEp.on = true; _metroGateEp.ep++; _metroGateEp.at = performance.now() - 6000;
          const rounds = [];
          for (const [i, etaOffset] of [0, Math.ceil(headway * .75), headway].entries()) {
            const observedSec = now + i * 5, arrSec = aArrival + etaOffset, arrEpoch = epochForServiceSec(arrSec);
            const eta = { from, to, run, arrEpoch };
            state.simSec = observedSec;
            const audit = applyTrtcBoard([{ line: switchLine.id, dir, from, to, dest: to, run, arrEpoch,
              no: '', terminal: false }], epochForServiceSec(observedSec), [{ line: switchLine.id, dir,
              key: keyA, trackId: 'track:identity-switch', shift: etaOffset, eta }]);
            if (switchLine._trtcBoard) switchLine._trtcBoard.at = Date.now();
            const assignment = audit && audit.assignments && audit.assignments[0];
            const assigned = String(assignment && (assignment.backendKey || assignment.tripKey) || '');
            rounds.push({ etaOffset, assigned: assigned.endsWith(keyA) ? 'A' : assigned.endsWith(keyB) ? 'B' : 'other',
              rawTripKey: assigned, mode: audit && audit.mode || 'legacy' });
          }
          identitySwitchCases.push({ line: switchLine.id, headway, keyA, keyB, rounds,
            changes: rounds.slice(1).filter((x, i) => x.assigned !== rounds[i].assigned).length });
        } finally { switchLine._tt.pop(); switchLine._tt.pop(); }
      }

      // 身分連續的可觀測對照：後端同一 key/trackId 連續三輪不應變班次。
      const identity = [];
      const idLine = lines.find(ln => candidates(ln).some(c => c.delay >= 60)) || lines[0];
      if (idLine) {
        const c = candidates(idLine).find(x => x.delay >= 60) || candidates(idLine)[0];
        if (c) {
          const { tr, from, to, dep, run } = c, dir = tr[0] < tr[tr.length - 2] ? 2 : 1;
          const key = tripLocalKey(tr), trackId = 'track:identity';
          for (const shift of [0, 60, 120]) {
            const arrSec = dep + run + shift, now = Math.min(arrSec - 1, dep + Math.max(1, shift));
            const arrEpoch = epochForServiceSec(arrSec), eta = { from, to, run, arrEpoch };
            state.simSec = now; _mlGate = true; _mlGateAt = Date.now();
            const a = applyTrtcBoard([{ line: idLine.id, dir, from, to, dest: tr[tr.length - 2], run, arrEpoch,
              no: '', terminal: false }], epochForServiceSec(now), [{ line: idLine.id, dir, key, trackId, shift, eta }]);
            identity.push({ shift, tripKey: a && a.assignments && a.assignments[0] &&
                (a.assignments[0].backendKey || a.assignments[0].tripKey),
              trackId: a && a.assignments && a.assignments[0] && a.assignments[0].trackId });
          }
        }
      }

      // 時間邊界直接驗名冊 gate：跨午夜、首班、末班之外均不存在。
      const midnightTrip = [0, 86390, 1, 86430];
      const timeEdges = {
        crossMidnightActive: freqTrainTime(midnightTrip, 20) === 86420,
        beforeFirstAbsent: freqTrainTime(midnightTrip, 86389) == null,
        atFirstPresent: freqTrainTime(midnightTrip, 86390) === 86390,
        atLastPresent: freqTrainTime(midnightTrip, 86430) === 86430,
        afterLastAbsent: freqTrainTime(midnightTrip, 31) == null,
      };
      const midnightLine = lines.find(ln => ln.stations && ln.stations.length >= 2);
      if (midnightLine) {
        const from = 0, to = 1, synthetic = [from, 86390, to, 86430], dir = 2;
        midnightLine._tt.push(synthetic);
        try {
          clearTrtcBoard(); _easedShift.clear(); state.simSec = 5;
          _mlGate = true; _mlGateAt = Date.now(); _metroGateEp.on = true; _metroGateEp.at = performance.now() - 6000;
          freqTrainPosAt(midnightLine, synthetic, 5);
          const arrEpoch = epochForServiceSec(86430), eta = { from, to, run: 40, arrEpoch };
          applyTrtcBoard([{ line: midnightLine.id, dir, from, to, dest: to, run: 40, arrEpoch, no: '', terminal: false }],
            epochForServiceSec(86405), [{ line: midnightLine.id, dir, key: tripLocalKey(synthetic), trackId: 'track:midnight', shift: 0, eta }]);
          if (midnightLine._trtcBoard) midnightLine._trtcBoard.at = Date.now();
          state.simSec = 30;
          const pos = freqTrainPosAt(midnightLine, synthetic, 30), target = posBetweenStations(midnightLine, from, to, 1);
          const nominalMps = metres(posBetweenStations(midnightLine, from, to, 0), target) / 40;
          timeEdges.crossMidnightEndpointM = round(metres(pos, target));
          timeEdges.crossMidnightEndpointToleranceM = round(nominalMps * TRTC_MOTION_MAX_RATE * tickSec + .05);
        } finally { midnightLine._tt.pop(); }
      }

      // 08:30 同量級大名冊：每車連續查 current→t-8→current→t-8。headway memo 必須
      // 以 (board, simSec, trip) 分離，並同時保留兩個最近 simSec；否則方向箭頭會每車
      // 遞迴重算整條車隊。耗時只當診斷，hard gate 看 base/headway compute 次數與結果。
      const headwayMemoCases = [];
      if (typeof trtcHeadwayPosition === 'function' && typeof trtcHeadwayMemoRead === 'function' &&
          typeof freqTrainBaseAt === 'function' && typeof projectOntoShape === 'function') {
        const perfSec = 8 * 3600 + 30 * 60, historySec = perfSec - 8;
        const active = [];
        for (const ln of lines) {
          if (!ln.hasShape || !ln._tt) continue;
          for (const tr of ln._tt) {
            const curRoster = freqTrainTime(tr, perfSec), histRoster = freqTrainTime(tr, historySec);
            if (curRoster == null || histRoster == null) continue;
            const curPos = freqTrainPosRaw(ln, tr, curRoster), histPos = freqTrainPosRaw(ln, tr, histRoster);
            if (!curPos || !histPos) continue;
            const curPr = projectOntoShape(ln, curPos.lat, curPos.lon);
            const histPr = projectOntoShape(ln, histPos.lat, histPos.lon);
            if (!curPr || !histPr || !Number.isFinite(curPr.d) || !Number.isFinite(histPr.d)) continue;
            let from = tr[0], to = tr[tr.length - 2];
            let dir = Math.sign(ln.stations[to].d - ln.stations[from].d);
            if (!dir) dir = Math.sign(curPr.d - histPr.d);
            if (!dir) continue;
            // rec.from/to 只用來取方向；找一個真實相鄰站對，避免 loop/支線終點同里程。
            for (let k = 2; k < tr.length; k += 2) {
              const a = tr[k - 2], b = tr[k], sd = Math.sign(ln.stations[b].d - ln.stations[a].d);
              if (sd === dir) { from = a; to = b; break; }
            }
            active.push({ ln, tr, dir, from, to, curD: curPr.d, histD: histPr.d,
              key: ln.id + '|' + tripLocalKey(tr) });
          }
        }
        const savedBoards = new Map(lines.map(ln => [ln, ln._trtcBoard]));
        const savedSimSec = state.simSec, savedAudit = state._trtcBoardAudit;
        const originalBaseAt = freqTrainBaseAt, originalHeadway = trtcHeadwayPosition;
        const originalMemoRead = trtcHeadwayMemoRead;
        const originalProject = projectOntoShape;
        try {
          const byLine = new Map();
          for (const e of active) { let a = byLine.get(e.ln); if (!a) byLine.set(e.ln, a = []); a.push(e); }
          let linked = 0; const directions = new Set();
          for (const [ln, entries] of byLine) {
            const positions = new Map(), headways = new Map(), groups = new Map();
            for (const e of entries) {
              directions.add(e.dir);
              const rec = { line: ln.id, endpoint: true, trackId: 'track:memo:' + e.key,
                from: e.from, to: e.to, run: perfSec - historySec, arrSec: perfSec,
                startSec: historySec, moveSec: historySec, endSec: perfSec, releaseSec: perfSec + 60,
                startD: e.histD, targetD: e.curD, startPos: posAlongShape(ln, e.histD),
                targetPos: posAlongShape(ln, e.curD), rate: 1, requiredRate: 1,
                maxRate: TRTC_MOTION_MAX_RATE, clamped: null, unreachable: false };
              positions.set(e.tr, rec);
              let g = groups.get(e.dir); if (!g) groups.set(e.dir, g = []); g.push(e);
            }
            for (const group of groups.values()) {
              group.sort((a, b) => (b.curD - a.curD) * a.dir);
              for (let i = 1; i < group.length; i++) {
                const lead = group[i - 1], rear = group[i];
                headways.set(rear.tr, { lead: lead.tr, km: Math.max(0, (lead.curD - rear.curD) * rear.dir) });
                linked++;
              }
            }
            ln._trtcBoard = { positions, shifts: new Map(), tracks: new Map(), headways,
              all: 0, at: Date.now(), n: positions.size, rows: positions.size, backend: true };
          }
          _mlGate = true; _mlGateAt = Date.now(); state._trtcBoardAudit = { runtimeOrderLimited: 0 };
          let baseCalls = 0, headwayCalls = 0, projectCalls = 0, memoHits = 0, memoMisses = 0;
          freqTrainBaseAt = function(...args) { baseCalls++; return originalBaseAt(...args); };
          trtcHeadwayPosition = function(...args) { headwayCalls++; return originalHeadway(...args); };
          projectOntoShape = function(...args) { projectCalls++; return originalProject(...args); };
          trtcHeadwayMemoRead = function(...args) {
            const value = originalMemoRead(...args);
            if (value.hit) memoHits++; else memoMisses++;
            return value;
          };
          const counts = () => ({ base: baseCalls, headway: headwayCalls, project: projectCalls,
            memoHit: memoHits, memoMiss: memoMisses });
          const delta = (a, b) => ({ base: b.base - a.base, headway: b.headway - a.headway,
            project: b.project - a.project, compute: (b.project - a.project) / 2,
            memoHit: b.memoHit - a.memoHit, memoMiss: b.memoMiss - a.memoMiss });
          const runQuery = simSec => {
            state.simSec = perfSec; // t-8 是 dirArrow 歷史查詢，current frame 仍是 08:30。
            const before = counts(), started = performance.now();
            const positions = active.map(e => {
              const p = freqTrainPosAt(e.ln, e.tr, simSec);
              return p ? [round(p.lat, 9), round(p.lon, 9)] : null;
            });
            const elapsedMs = performance.now() - started, after = counts();
            return { simSec, elapsedMs: round(elapsedMs, 3), counts: delta(before, after), positions };
          };
          const scans = [runQuery(perfSec), runQuery(historySec), runQuery(perfSec), runQuery(historySec)];
          freqTrainBaseAt = originalBaseAt; trtcHeadwayPosition = originalHeadway;
          projectOntoShape = originalProject; trtcHeadwayMemoRead = originalMemoRead;
          let swaps = 0, fifoPairs = 0;
          for (const [ln, entries] of byLine) {
            const board = ln._trtcBoard;
            for (const rear of entries) {
              const link = board.headways.get(rear.tr); if (!link) continue;
              const rearIndex = active.indexOf(rear), leadIndex = active.findIndex(e => e.ln === ln && e.tr === link.lead);
              const rp = scans[2].positions[rearIndex], lp = scans[2].positions[leadIndex];
              if (!rp || !lp) continue;
              const rd = originalProject(ln, rp[0], rp[1]).d, ld = originalProject(ln, lp[0], lp[1]).d;
              fifoPairs++; if ((ld - rd) * rear.dir < -trackToleranceM / 1000) swaps++;
            }
          }
          const totalCounts = counts();
          const memoSlots = [...byLine.keys()].map(ln => {
            const slots = ln._trtcBoard && ln._trtcBoard._headwayMemo;
            return { line: ln.id, active: byLine.get(ln).length,
              count: slots instanceof Map ? slots.size : 0,
              times: slots instanceof Map ? [...slots.keys()] : [],
              sizes: slots instanceof Map ? [...slots.values()].map(slot => slot.positions.size) : [] };
          });
          let livePartition = null;
          const partitionEntry = active.find(e => !e.ln._trtcBoard.headways.has(e.tr));
          if (partitionEntry) {
            const { ln, tr } = partitionEntry, board = ln._trtcBoard, rec = board.positions.get(tr);
            const oldTargetD = rec.targetD, oldTargetPos = rec.targetPos, oldAt = board.at;
            const totalD = ln.cum[ln.cum.length - 1];
            const shiftedD = rec.targetD + .15 <= totalD ? rec.targetD + .15 : rec.targetD - .15;
            rec.targetD = shiftedD; rec.targetPos = posAlongShape(ln, shiftedD);
            board._headwayMemo = new Map(); delete board._headwayMemoLive;
            state.simSec = perfSec; _mlGate = true; _mlGateAt = Date.now(); board.at = Date.now();
            const livePos = freqTrainPosAt(ln, tr, perfSec);
            const liveFlag = board._headwayMemoLive;
            board.at = Date.now() - 1801e3; // 同 simSec 跨過 30 分 freshness 邊界
            const expectedStale = originalBaseAt(ln, tr, perfSec, freqTrainTime(tr, perfSec)).pos;
            const stalePos = freqTrainPosAt(ln, tr, perfSec);
            livePartition = { line: ln.id, sameSimSec: perfSec, liveFlag,
              staleFlag: board._headwayMemoLive,
              liveVsExpectedStaleM: round(metres(livePos, expectedStale)),
              staleVsExpectedM: round(metres(stalePos, expectedStale)),
              staleVsLiveM: round(metres(stalePos, livePos)) };
            rec.targetD = oldTargetD; rec.targetPos = oldTargetPos; board.at = oldAt;
          }
          headwayMemoCases.push({ perfSec, historySec, active: active.length, linked, directions: [...directions].sort(),
            scans: scans.map(({ simSec, elapsedMs, counts }) => ({ simSec, elapsedMs, counts })),
            totalCounts: { ...totalCounts, compute: totalCounts.project / 2,
              recursiveReuse: Math.max(0, totalCounts.headway - totalCounts.project / 2) },
            currentStable: JSON.stringify(scans[0].positions) === JSON.stringify(scans[2].positions),
            historyStable: JSON.stringify(scans[1].positions) === JSON.stringify(scans[3].positions),
            fifoPairs, swaps, memoSlots, livePartition,
            result: scans.map(s => s.positions),
          });
        } finally {
          freqTrainBaseAt = originalBaseAt; trtcHeadwayPosition = originalHeadway;
          projectOntoShape = originalProject; trtcHeadwayMemoRead = originalMemoRead;
          for (const [ln, board] of savedBoards) { if (board) ln._trtcBoard = board; else delete ln._trtcBoard; }
          state.simSec = savedSimSec; state._trtcBoardAudit = savedAudit;
        }
      }
      return { lines: lines.map(x => x.id).sort(), samples, rosterChecks, rosterBoundaryChecks, rosterEdges,
        assignmentKeys, orderChecks, releaseCases, clampCases, lowClampCases, legacyFallbackCases,
        pastTargetCases, officialPairCases, headwayRefreshCases, staleRenderedCases, rosterChainCases, easedHandoffCases, transitionCases,
        historyQueryCases, serviceDayRolloverCases, dayTypeRefreshCases, pollDayTypeCases,
        identitySwitchCases, identity, timeEdges, headwayMemoCases,
        motionLimits: { minRate: typeof TRTC_MOTION_MIN_RATE === 'number' ? TRTC_MOTION_MIN_RATE : null,
          maxRate: typeof TRTC_MOTION_MAX_RATE === 'number' ? TRTC_MOTION_MAX_RATE : null,
          lineKmh: typeof TRTC_BOARD_PERF === 'object' ? TRTC_BOARD_PERF.v : null },
        pageBuild: typeof BUILD === 'string' ? BUILD : null };
    }, { expectedLines: EXPECTED_LINES, tickSec: TICK_SEC, trackToleranceM: TRACK_PROJECTION_TOLERANCE_M });
    model.label = label; model.pageErrors = pageErrors;
    return model;
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

// ── 結構契約：先抓「實作接錯線」，行為數字在下方獨立回放 ──
const applySource = extractFunction(CURRENT_HTML, 'applyTrtcBoard');
const baseAtSource = extractFunction(CURRENT_HTML, 'freqTrainBaseAt');
const shiftSource = extractFunction(CURRENT_HTML, 'metroShiftSec');
const pollSource = extractFunction(CURRENT_HTML, 'pollTrtcLive');
const threeArgApply = /function\s+applyTrtcBoard\s*\(\s*rows\s*,\s*observedEpoch\s*,\s*trips\s*\)/.test(applySource);
check(threeArgApply, '`applyTrtcBoard(rows, observedEpoch, trips)` 吃後端綁定陣列');
check(/boardPos\.trips/.test(pollSource) && /applyTrtcBoard\([^;]*\.trips/.test(pollSource),
  'poll 將 `boardPos.trips` 原樣交給動畫層');
check(/trips/.test(applySource) && /trtcLocalTripKey|\.key/.test(applySource),
  '正常後端 trips 路徑直查 trip key（legacy fallback 可獨立保留）');
check(/officialEndpoint/.test(baseAtSource) && /anchored0/.test(baseAtSource),
  '後端官方端點軌跡明確 bypass 25m gate（legacy 防錯配 gate 不受影響）');
check(/trackId/.test(applySource) && /physicalKey|trtcMotionTrackKey/.test(shiftSource),
  'eased 狀態使用後端實體車 trackId');
check(/trackId\s*[,}:]/.test(LEDGER.slice(LEDGER.indexOf('joinBoardRowsToTrips'))) && /joinBoardRowsToTrips/.test(WORKER.slice(0, 500)) &&
  /trips\s*=\s*joinBoardRowsToTrips\(/.test(WORKER),
  'ledger join 輸出 trackId，Worker import／call 後原樣送出');
check(!/\.shift[^\n]*(?:arrSec|eta|sort)|(?:arrSec|eta|sort)[^\n]*\.shift/.test(extractFunction(CURRENT_HTML, 'trtcBoardPosition')),
  '端點位置不把 `trips[].shift` 偷加回官方 ETA');

const identityBindSource = extractFunction(CURRENT_HTML, 'trtcBindPhysicalIdentity');
const forwardOwnershipGuard = ' && _trtcPhysicalByTrip.get(formerTrip) === physicalKey';
check(identityBindSource.includes(forwardOwnershipGuard),
  '實體車 reverse alias 刪除前會先核對 forward 所有權');
const identityMapProduction = replayFrontendIdentityMap(identityBindSource);
const identityMapMutantSource = identityBindSource.replace(forwardOwnershipGuard, '');
if (identityMapMutantSource === identityBindSource) throw new Error('無法建立 delete-without-forward-check mutation');
const identityMapMutant = replayFrontendIdentityMap(identityMapMutantSource);
const identityMapPass = rec => String(rec.step1.A || '').endsWith('|track:old') && String(rec.step2.A || '').endsWith('|track:new') &&
  String(rec.final.A || '').endsWith('|track:new') && String(rec.final.B || '').endsWith('|track:old') &&
  rec.final.fresh === 'trip:A' && rec.final.old === 'trip:B';
check(identityMapPass(identityMapProduction),
  'frontend identity map 三步：A→old、A reclaim→new、old 重現綁 B 後兩班均保留',
  JSON.stringify(identityMapProduction));
mutation(identityMapPass(identityMapProduction) && !identityMapPass(identityMapMutant),
  'old track delete 若不核對 forward 所有權會誤刪 A→new', JSON.stringify(identityMapMutant));
output.metrics.frontendIdentityMap = { production: identityMapProduction, mutant: identityMapMutant };

// 下列 control 全都直接改「實際出貨函式」後載入完整頁面重播；不以手填座標／假數字冒充紅燈。
const chordMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'trtcEndpointPositionValue', () => `function trtcEndpointPositionValue(ln, rec, simSec) {
  const f = trtcEndpointFraction(rec, simSec);
  const a = rec.startPos, b = rec.targetPos; if (!a || !b) return null;
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}`, '端點改走站間 chord');

const officialHeadwayMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'freqTrainPosAt', source =>
  replaceRequired(source,
    'const pos = trtcHeadwayPosition(ln, tr, t, base.pos);',
    'const pos = base.pos;',
    '官方 motion 拿掉 headway gate'), '官方 motion 拿掉 headway gate');

const pastTargetMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'trtcBuildEndpointMotion', source =>
  replaceRequired(source,
    "return { endpoint: false, rejected: 'pastTarget', clamped: 'pastTarget', unreachable: true };",
    `return { line: ln.id, trackId: physicalKey, endpoint: true, startPos, targetPos, startD, targetD,
      from: edge.from, to: edge.to, run: edge.run, arrSec: edge.arrSec, startSec: sec, moveSec: sec,
      endSec: Infinity, rate: 0, requiredRate: 0, clamped: 'pastTarget', unreachable: true };`,
    'past-target 建立 Infinity motion'), 'past-target 建立 Infinity motion');

const lowClampMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'trtcBuildEndpointMotion', source =>
  replaceRequired(source,
    'const moveSec = sec, endSec = moveSec + travelSec;',
    "const moveSec = clamped === 'low' ? edge.arrSec - travelSec : sec, endSec = moveSec + travelSec;",
    'forced-low 等到剛好準時'), 'forced-low 等到剛好準時');

const releaseMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'applyTrtcBoard', source =>
  replaceRequired(source,
    'motion.releaseSec = Math.max(motion.endSec, handoffSec);',
    'motion.releaseSec = motion.endSec;',
    'release 預設為 motion.endSec'), 'release 預設為 motion.endSec');

const feedLossMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'clearTrtcBoard', () => `function clearTrtcBoard() {
  for (const ln of metroLivePool()) if (isTrtcBoardLine(ln)) {
    ln._trtcTripMode = true;
    delete ln._trtcBoard;
    delete ln._liveShift;
  }
}`, 'feed loss 立即刪官方 motion');

const easedKeyMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'metroShiftSec', source =>
  replaceRequired(source,
    "dch = physicalKey ? 'track:' + physicalKey : 'trip:' + freqTripKey(ln, tr);",
    "dch = 'trip:' + freqTripKey(ln, tr);",
    'eased key 退回 trip'), 'eased key 退回 trip');

const rosterMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'freqTrainPosAt', source =>
  replaceRequired(source,
    `const rosterTime = freqTrainTime(tr, t);
  if (rosterTime == null) return null;`,
    `let rosterTime = freqTrainTime(tr, t);
  if (rosterTime == null) rosterTime = Math.max(tr[1], Math.min(tr[tr.length - 1], t));`,
    '名冊外班次夾回首末站'), '名冊外班次夾回首末站');

const snapMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'trtcEndpointFraction', source =>
  replaceRequired(source,
    'if (sec >= rec.endSec) return 1;',
    `if (sec >= rec.arrSec) return 1;
  if (sec >= rec.endSec) return 1;`,
    'arrEpoch 強制 snap'), 'arrEpoch 強制 snap');

// 等價恢復舊優先序：只要有 previousMotion 就先抹掉「最後真的畫出」座標，逼 refresh 從未限位 raw motion 接手。
const previousMotionPriorityMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'trtcBuildEndpointMotion', source =>
  replaceRequired(source,
    'function trtcBuildEndpointMotion(ln, tr, edge, physicalKey, nowSec) {',
    `function trtcBuildEndpointMotion(ln, tr, edge, physicalKey, nowSec) {
  const priorityPrevious = ln && ln._trtcBoard && ln._trtcBoard.positions && ln._trtcBoard.positions.get(tr);
  if (priorityPrevious && priorityPrevious.endpoint) _trtcLastRendered.delete(physicalKey);`,
  'previousMotion 恢復優先'), 'previousMotion 恢復優先');

// 在 trips=[] dispatch 前先刪舊 board，等價於舊版 legacy fallback 的破壞性換輪順序。
const legacyDeleteMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'applyTrtcBoard', source =>
  replaceRequired(source,
    'if (!Array.isArray(trips) || !trips.length) return applyTrtcBoardLegacy(rows, observedEpoch);',
    `if (!Array.isArray(trips) || !trips.length) {
    for (const mutantLn of metroLivePool()) if (isTrtcBoardLine(mutantLn)) delete mutantLn._trtcBoard;
    return applyTrtcBoardLegacy(rows, observedEpoch);
  }`,
    'legacy fallback 先刪 old board'), 'legacy fallback 先刪 old board');

const rosterChainMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'trtcHeadwayLinksForMotions', source =>
  replaceRequired(source,
    `if (!a.some(x => x.endpoint)) continue;
      a.sort`,
    `if (!a.some(x => x.endpoint)) continue;
      a.sort`,
    '三車 chain 定位排序').replace(
      `for (let i = 1; i < a.length; i++) {
        const km =`,
      `for (let i = 1; i < a.length; i++) {
        if (!a[i - 1].endpoint && !a[i].endpoint) continue;
        const km =`), '三車 chain 恢復 both-unmatched 截斷');

const rolloverAfterEmptyMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'applyTrtcBoard', source => {
  const line = 'trtcPreparePhysicalServiceDay(serviceDay); // 即使 04:00 後首輪 trips 暫空，也不能沿用前一營運日 track/eased';
  let out = replaceRequired(source, line, '', '跨日 cleanup 拿掉 empty 前 prepare');
  out = replaceRequired(out,
    'if (!Array.isArray(trips) || !trips.length) return applyTrtcBoardLegacy(rows, observedEpoch);',
    `if (!Array.isArray(trips) || !trips.length) return applyTrtcBoardLegacy(rows, observedEpoch);
  trtcPreparePhysicalServiceDay(serviceDay);`,
    '跨日 cleanup 移到 empty return 後');
  return out;
}, '跨日 cleanup 移到 empty return 後');

const rolloverLegacyEasedMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'trtcPreparePhysicalServiceDay', source =>
  replaceRequired(source,
    `if (value.includes(':track:' + priorDay + '|') ||
        (value.startsWith('mrt:') && value.includes(':trip:mrt:'))) _easedShift.delete(key);`,
    `if (value.includes(':track:' + priorDay + '|')) _easedShift.delete(key);`,
    '跨日少清 legacy trip eased'), '跨日少清 legacy trip eased');

const rolloverKeepBoardMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'trtcPreparePhysicalServiceDay', source =>
  replaceRequired(source,
    'for (const ln of seenLines) if (isTrtcBoardLine(ln)) delete ln._trtcBoard;',
    'for (const ln of []) delete ln._trtcBoard;',
    '跨日不清舊 board endpoint'), '跨日不清舊 board endpoint');

const historyRememberMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'freqTrainPosAt', source =>
  replaceRequired(source,
    'if (Math.abs(Number(t) - Number(state.simSec)) < 1e-6) trtcRememberRenderedPosition(ln, tr, t, pos);',
    'trtcRememberRenderedPosition(ln, tr, t, pos);',
    '歷史查詢無條件覆寫 last rendered'), '歷史查詢無條件覆寫 last rendered');

const staleRenderedMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'trtcBuildEndpointMotion', source =>
  replaceRequired(source,
    `if (last && last.line === ln.id && last.pos && lastSec != null && Math.abs(lastSec - sec) <= 1)
    startPos = { ...last.pos };`,
    `if (last && last.line === ln.id && last.pos)
    startPos = { ...last.pos };`,
    'hidden 期間無條件取 stale lastRendered'), 'hidden 期間無條件取 stale lastRendered');

const dayTypeStaleMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'prepFreqTimes', source =>
  replaceRequired(source,
    'const serviceDay = String(serviceDayOverride || taipeiServiceDayStr());',
    'const serviceDay = taipeiServiceDayStr();',
    'prepFreqTimes 忽略 payload serviceDay'), 'prepFreqTimes 忽略 payload serviceDay');

const speedCapMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'trtcBuildEndpointMotion', source =>
  replaceRequired(source,
    `const visualMaxRate = Math.max(TRTC_MOTION_MIN_RATE, Math.min(TRTC_MOTION_MAX_RATE,
    (TRTC_BOARD_PERF.v / 3600) / nominalSpeedKmSec));`,
    'const visualMaxRate = TRTC_MOTION_MAX_RATE;',
    'endpoint 移除 80km/h hard cap'), 'endpoint 移除 80km/h hard cap');

const pollOldTimetableGateMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'pollTrtcLive', source => {
  let out = replaceRequired(source,
    `const pool = metroLivePool();
  if (_trtcPolling || document.hidden || !pool.some(isTrtcBoardLine)) return;`,
    `const pool = metroLivePool();
  if (_trtcPolling || document.hidden || !pool.some(isTrtcBoardLine)) return;
  const oldAnimationEligible = pool.some(ln => isTrtcBoardLine(ln) && ln._tt && ln._tt.length);`,
    'poll 恢復 fetch 前舊名冊資格');
  out = replaceRequired(out,
    'if (Math.abs(rawWallDelta) <= 120) try {',
    'if (oldAnimationEligible && Math.abs(rawWallDelta) <= 120) try {',
    'poll 恢復舊名冊整段擋住 apply/prepare');
  return out;
}, 'poll 用舊 _tt 先擋住新日型 prepare');

const pollOuterCatchScopeMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'pollTrtcLive', source =>
  replaceRequired(source,
    `if (Math.abs(rawWallDelta) <= 120 &&
        metroLivePool().some(ln => isTrtcBoardLine(ln) && (OFFICIAL_ROSTER_ENABLED || ln._tt))) {`,
    `if (animationEligible && Math.abs(rawWallDelta) <= 120) {`,
    'network catch 引用 inner animationEligible'), 'network catch 引用 inner animationEligible');

const headwayMemoMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'trtcHeadwayMemoSlot', () =>
  `function trtcHeadwayMemoSlot(board, simSec, create = true) {
  return null;
}`, 'headway memo 完全移除');

const headwayMemoLivePartitionMutantHtml = mutateFunctionInHtml(CURRENT_HTML, 'trtcHeadwayMemoRead', source =>
  replaceRequired(source,
    'const slot = trtcHeadwayMemoSlot(board, simSec, false, liveState);',
    'const slot = trtcHeadwayMemoSlot(board, simSec, false);',
    'headway memo 忽略 live/stale partition'), 'headway memo 忽略 live/stale partition');

output.models.baseline = await replay('25m-gate-baseline', BASE_HTML, PORT0);
output.models.current = await replay('backend-identity-endpoint', CURRENT_HTML, PORT0 + 1);
output.models.chordMutant = await replay('mutant-endpoint-chord', chordMutantHtml, PORT0 + 2);
output.models.officialHeadwayMutant = await replay('mutant-official-no-headway', officialHeadwayMutantHtml, PORT0 + 3);
output.models.pastTargetMutant = await replay('mutant-past-target-infinity', pastTargetMutantHtml, PORT0 + 4);
output.models.lowClampMutant = await replay('mutant-low-wait-until-eta', lowClampMutantHtml, PORT0 + 5);
output.models.releaseMutant = await replay('mutant-release-at-end', releaseMutantHtml, PORT0 + 6);
output.models.feedLossMutant = await replay('mutant-feed-loss-delete', feedLossMutantHtml, PORT0 + 7);
output.models.easedKeyMutant = await replay('mutant-eased-trip-key', easedKeyMutantHtml, PORT0 + 8);
output.models.rosterMutant = await replay('mutant-roster-resurrection', rosterMutantHtml, PORT0 + 9);
output.models.snapMutant = await replay('mutant-deadline-snap', snapMutantHtml, PORT0 + 10);
output.models.previousMotionPriorityMutant = await replay('mutant-previous-motion-priority', previousMotionPriorityMutantHtml, PORT0 + 11);
output.models.legacyDeleteMutant = await replay('mutant-legacy-delete-old-board', legacyDeleteMutantHtml, PORT0 + 12);
output.models.rosterChainMutant = await replay('mutant-roster-chain-break', rosterChainMutantHtml, PORT0 + 13);
output.models.rolloverAfterEmptyMutant = await replay('mutant-rollover-cleanup-after-empty', rolloverAfterEmptyMutantHtml, PORT0 + 14);
output.models.rolloverLegacyEasedMutant = await replay('mutant-rollover-keep-legacy-eased', rolloverLegacyEasedMutantHtml, PORT0 + 15);
output.models.historyRememberMutant = await replay('mutant-history-overwrites-rendered', historyRememberMutantHtml, PORT0 + 16);
output.models.rolloverKeepBoardMutant = await replay('mutant-rollover-keep-old-board', rolloverKeepBoardMutantHtml, PORT0 + 17);
output.models.dayTypeStaleMutant = await replay('mutant-service-day-stale-timetable', dayTypeStaleMutantHtml, PORT0 + 18);
output.models.speedCapMutant = await replay('mutant-endpoint-without-80kmh-cap', speedCapMutantHtml, PORT0 + 19);
output.models.staleRenderedMutant = await replay('mutant-hidden-uses-stale-rendered', staleRenderedMutantHtml, PORT0 + 20);
output.models.pollOldTimetableGateMutant = await replay('mutant-poll-old-timetable-gate', pollOldTimetableGateMutantHtml, PORT0 + 21);
output.models.pollOuterCatchScopeMutant = await replay('mutant-poll-outer-catch-scope', pollOuterCatchScopeMutantHtml, PORT0 + 22);
output.models.headwayMemoMutant = await replay('mutant-headway-without-memo', headwayMemoMutantHtml, PORT0 + 23);
output.models.headwayMemoLivePartitionMutant = await replay('mutant-headway-without-live-partition', headwayMemoLivePartitionMutantHtml, PORT0 + 24);

function summarise(model) {
  const valid = model.samples.filter(x => !x.error && Number.isFinite(x.arrivalErrorSec));
  const delayed = valid.filter(x => x.delay >= 60);
  const byLine = {};
  for (const line of EXPECTED_LINES) {
    const a = valid.filter(x => x.line === line), d = a.filter(x => x.delay >= 60);
    byLine[line] = { n: a.length, p50: percentile(a.map(x => Math.abs(x.arrivalErrorSec)), .5),
      p90: percentile(a.map(x => Math.abs(x.arrivalErrorSec)), .9), delayedN: d.length,
      delayedP90: percentile(d.map(x => Math.abs(x.arrivalErrorSec)), .9),
      maxDeadlineM: a.length ? Math.max(...a.map(x => x.atDeadlineM || 0)) : null };
  }
  return {
    n: valid.length,
    p50: percentile(valid.map(x => Math.abs(x.arrivalErrorSec)), .5),
    p90: percentile(valid.map(x => Math.abs(x.arrivalErrorSec)), .9),
    delayedN: delayed.length,
    delayedP50: percentile(delayed.map(x => Math.abs(x.arrivalErrorSec)), .5),
    delayedP90: percentile(delayed.map(x => Math.abs(x.arrivalErrorSec)), .9),
    maxStepViolations: valid.filter(x => x.biggestStepM > x.maxStepM).length,
    endpointMisses: valid.filter(x => x.atDeadlineM > x.deadlineToleranceM).length,
    clamped: model.samples.filter(x => x.clamped).length,
    unreachable: model.samples.filter(x => x.unreachable).length,
    byLine,
  };
}
const before = summarise(output.models.baseline), after = summarise(output.models.current);
output.metrics.arrivalBefore = before;
output.metrics.arrivalAfter = after;
const currentLines = new Set(output.models.current.samples.filter(x => !x.error).map(x => x.line));
const derivedArrivalLimitSec = TICK_SEC + 1e-6;
check(EXPECTED_LINES.every(x => currentLines.has(x)), '準時端點逐線覆蓋',
  `covered=${[...currentLines].sort().join(',')}，n=${after.n}`);
check(after.n > 0 && after.p50 <= derivedArrivalLimitSec && after.p90 <= derivedArrivalLimitSec,
  '有錨點班次的抵站誤差 p50/p90 不超過一個 UI tick',
  `n=${after.n}, p50=${after.p50}s, p90=${after.p90}s, tick=${TICK_SEC}s`);
check(after.delayedN > 0 && after.delayedP90 <= derivedArrivalLimitSec,
  '誤點 60 秒以上子群仍照官方 arrEpoch 抵站',
  `n=${after.delayedN}, p50=${after.delayedP50}s, p90=${after.delayedP90}s`);
check(after.endpointMisses === 0, 'arrEpoch 畫格的站點殘差不超過一個 UI tick 可走距離',
  `n=${after.n}, misses=${after.endpointMisses}`);
mutation(before.delayedN > 0 && before.delayedP90 > derivedArrivalLimitSec,
  '恢復 25m gate 會讓 >=60s 誤點案超過端點門檻',
  `baseline n=${before.delayedN}, p90=${before.delayedP90}s; current=${after.delayedP90}s`);

check(after.maxStepViolations === 0, '相鄰畫格零瞬移（北捷產品線速 80 km/h 上界）',
  `n=${after.n}, violations=${after.maxStepViolations}`);
const maxOffTrackM = Math.max(...output.models.current.samples.map(x => x.maxOffTrackM || 0));
const chordMaxOffTrackM = Math.max(...output.models.chordMutant.samples.map(x => x.maxOffTrackM || 0));
check(output.models.current.samples.every(x => !x.error && x.maxOffTrackM <= TRACK_PROJECTION_TOLERANCE_M),
  '官方 motion 每一畫格都投影在該站間軌道門檻內',
  `n=${output.models.current.samples.length}, max=${maxOffTrackM}m, gate=${TRACK_PROJECTION_TOLERANCE_M}m`);
mutation(maxOffTrackM <= TRACK_PROJECTION_TOLERANCE_M && chordMaxOffTrackM > TRACK_PROJECTION_TOLERANCE_M,
  '將沿 shape 里程插值改回站點 chord 會離軌',
  `production=${maxOffTrackM}m, mutant=${chordMaxOffTrackM}m`);
const snapProduction = output.models.current.clampCases[0], snapMutant = output.models.snapMutant.clampCases[0];
mutation(!!snapProduction && !!snapMutant && snapProduction.biggestStepM <= snapProduction.maxStepM &&
  snapMutant.biggestStepM > snapMutant.maxStepM,
  '在 arrEpoch 強制 snap 到站會被相鄰畫格速度上界抓紅',
  `production=${snapProduction && snapProduction.biggestStepM}m, mutant=${snapMutant && snapMutant.biggestStepM}m`);

const badRoster = [...output.models.current.rosterChecks, ...output.models.current.rosterEdges,
  ...output.models.current.rosterBoundaryChecks].filter(x =>
  ('beforeRoster' in x && (x.beforeRoster !== x.beforeScreen || x.afterRoster !== x.afterScreen || x.beforeRoster !== x.afterRoster)) ||
  ('roster' in x && (x.roster !== x.missing || x.roster !== x.extra)) ||
  ('expected' in x && x.expected !== x.rendered));
check(badRoster.length === 0, '名冊雙向守恆：feed 缺席不滅車，不存在錨點不生車',
  `checks=${output.models.current.rosterChecks.length + output.models.current.rosterEdges.length + output.models.current.rosterBoundaryChecks.length}, bad=${badRoster.length}`);
const rosterMutantBad = output.models.rosterMutant.rosterBoundaryChecks.filter(x => x.expected !== x.rendered);
mutation(badRoster.length === 0 && rosterMutantBad.length > 0,
  '拿掉名冊 gate、把名冊外班次夾回首末站會生出幽靈車',
  `production bad=${badRoster.length}, mutant bad=${rosterMutantBad.length}`);

const modelIdentityChanges = model => {
  const a = model.identity.map(x => x.tripKey).filter(Boolean);
  return a.slice(1).filter((x, i) => x !== a[i]).length;
};
const identityChanges = modelIdentityChanges(output.models.current);
const trackIds = new Set(output.models.current.identity.map(x => x.trackId).filter(Boolean));
const identitySwitchBefore = output.models.baseline.identitySwitchCases[0];
const identitySwitchAfter = output.models.current.identitySwitchCases[0];
output.metrics.identity = { rounds: output.models.current.identity.length,
  beforeTripChanges: identitySwitchBefore && identitySwitchBefore.changes,
  afterTripChanges: identitySwitchAfter && identitySwitchAfter.changes, trackIds: [...trackIds],
  beforeRounds: identitySwitchBefore && identitySwitchBefore.rounds,
  afterRounds: identitySwitchAfter && identitySwitchAfter.rounds };
check(output.models.current.identity.length === 3 && identityChanges === 0 && trackIds.size === 1,
  '非折返同一實體車跨輪身分變更 0 次',
  `rounds=${output.models.current.identity.length}, after=${identityChanges}, trackIds=${[...trackIds].join(',')}`);
check(!!identitySwitchAfter && identitySwitchAfter.rounds.length === 3 && identitySwitchAfter.changes === 0 &&
  identitySwitchAfter.rounds.every(x => x.assigned === 'A'),
  '同一實體跨半頭距三輪仍依 backend key 固定 A，不受較近班次 B 影響', JSON.stringify(identitySwitchAfter || null));
mutation(!!identitySwitchBefore && !!identitySwitchAfter && identitySwitchBefore.changes >= 1 &&
  identitySwitchBefore.rounds.some(x => x.assigned === 'B') && identitySwitchAfter.changes === 0,
  '改回 legacy 每輪 |shift| winner-search 會讓同一實體 A→B',
  `before=${identitySwitchBefore && identitySwitchBefore.rounds.map(x => x.assigned).join('→')} (${identitySwitchBefore && identitySwitchBefore.changes}), ` +
  `after=${identitySwitchAfter && identitySwitchAfter.rounds.map(x => x.assigned).join('→')} (${identitySwitchAfter && identitySwitchAfter.changes})`);
const easedHandoff = output.models.current.easedHandoffCases[0];
const easedHandoffMutant = output.models.easedKeyMutant.easedHandoffCases[0];
check(!!easedHandoff && easedHandoff.firstMatched === 1 && easedHandoff.secondMatched === 1 &&
  easedHandoff.firstTripKey !== easedHandoff.secondTripKey && easedHandoff.continuous,
  '折返／rebind 交棒一次，實體 track 的 eased 狀態不中斷', JSON.stringify(easedHandoff || null));
mutation(!!easedHandoff && !!easedHandoffMutant && easedHandoff.continuous && !easedHandoffMutant.continuous &&
  easedHandoffMutant.secondShift !== easedHandoffMutant.secondTarget,
  'metroShiftSec 改回 trip key 會讓交棒後從 0 重爬',
  `production=${easedHandoff && easedHandoff.secondShift}/${easedHandoff && easedHandoff.secondTarget}, ` +
  `mutant=${easedHandoffMutant && easedHandoffMutant.secondShift}/${easedHandoffMutant && easedHandoffMutant.secondTarget}`);
const transition = output.models.current.transitionCases[0];
check(!!transition && transition.reclaimJumpM <= transition.maxStepM && transition.feedLossJumpM <= transition.maxStepM,
  'reclaim 更換 trackId 與 feed 整批中斷的來源切換均不跳位', JSON.stringify(transition || null));
const feedLoss = output.models.current.lowClampCases[0], feedLossMutant = output.models.feedLossMutant.lowClampCases[0];
check(!!feedLoss && feedLoss.feedLossJumpM <= feedLoss.maxStepM,
  'feed 整批中斷會 carry 已開始的官方 motion，不在同畫格跳回班表', JSON.stringify(feedLoss || null));
mutation(!!feedLoss && !!feedLossMutant && feedLoss.feedLossJumpM <= feedLoss.maxStepM &&
  feedLossMutant.feedLossJumpM > feedLossMutant.maxStepM,
  'clearTrtcBoard 改成 feed 中斷立即刪 motion 會被實際畫格位移抓紅',
  `production=${feedLoss && feedLoss.feedLossJumpM}m, mutant=${feedLossMutant && feedLossMutant.feedLossJumpM}m`);
const legacyFallback = output.models.current.legacyFallbackCases[0];
const legacyFallbackMutant = output.models.legacyDeleteMutant.legacyFallbackCases[0];
check(!!legacyFallback && legacyFallback.backendMatched === 1 && legacyFallback.endpointBefore &&
  legacyFallback.carriedSameEndpoint && legacyFallback.refreshJumpM <= TRACK_PROJECTION_TOLERANCE_M &&
  legacyFallback.boundarySteps.length === 2 && legacyFallback.boundarySteps.every(x => x.stepM <= legacyFallback.maxStepM),
  'backend 正常輪後 trips=[] 降級 legacy，已開始 endpoint 仍 carry 到 release 且同格連續',
  JSON.stringify(legacyFallback || null));
mutation(!!legacyFallbackMutant && legacyFallback.carriedSameEndpoint &&
  (!legacyFallbackMutant.carriedSameEndpoint || legacyFallbackMutant.refreshJumpM > legacyFallbackMutant.maxStepM),
  'legacy fallback 若先刪 old board，會攔腰切斷 endpoint 並跳回班表', JSON.stringify(legacyFallbackMutant || null));
const productionReleaseCases = [...output.models.current.releaseCases, ...output.models.current.lowClampCases];
const badRelease = productionReleaseCases.filter(x => !Number.isFinite(x.releaseSec) ||
  Math.abs(x.releaseSec - x.expectedReleaseSec) > 1e-6 ||
  (x.boundarySteps || []).some(s => s.stepM > x.maxStepM));
check(productionReleaseCases.length > output.models.current.releaseCases.length && badRelease.length === 0,
  'arr→release→fallback 相鄰畫格連續，release 不早於端點／官方交棒秒',
  `cases=${productionReleaseCases.length}, bad=${badRelease.length}`);
const releaseMutantCase = output.models.releaseMutant.lowClampCases[0];
mutation(!!releaseMutantCase && (Math.abs(releaseMutantCase.releaseSec - releaseMutantCase.expectedReleaseSec) > 1e-6 ||
  releaseMutantCase.boundarySteps.some(s => s.stepM > releaseMutantCase.maxStepM)),
  'releaseSec 預設回 motion.endSec 會在 forced-low 端點後跳回 fallback',
  JSON.stringify(releaseMutantCase || null));

const te = output.models.current.timeEdges;
check(te.crossMidnightActive && te.beforeFirstAbsent && te.atFirstPresent && te.atLastPresent && te.afterLastAbsent &&
  Number.isFinite(te.crossMidnightEndpointM) && te.crossMidnightEndpointM <= te.crossMidnightEndpointToleranceM,
  '邊界：跨午夜、首班、末班的班表名冊 gate 皆符合不變量',
  JSON.stringify(output.models.current.timeEdges));
mutation(output.models.current.timeEdges.crossMidnightActive && output.models.current.timeEdges.afterLastAbsent,
  '拿掉跨午夜 +86400 或把末班後當存在會被邊界對照抓紅');

check(output.models.current.pageErrors.length === 0, 'Chromium fixture 回放零 pageerror',
  output.models.current.pageErrors.join(' | ') || 'none');
check(output.models.current.samples.every(x => !x.error), '所有合成錨點回放零 throw',
  output.models.current.samples.filter(x => x.error).map(x => `${x.line}:${x.error}`).join(' | ') || 'none');

// 順序守恆：實際回放數位與凍結的防穿越入口雙重關卡。
const beforeOrder = output.models.baseline.orderChecks.reduce((n, x) => n + x.inversions, 0);
const afterOrder = output.models.current.orderChecks.reduce((n, x) => n + x.inversions, 0);
const afterOrderPairs = output.models.current.orderChecks.reduce((n, x) => n + x.pairs, 0);
output.metrics.order = { beforeInversions: beforeOrder, afterInversions: afterOrder, pairs: afterOrderPairs };
check(afterOrderPairs > 0 && afterOrder === 0, '同線同向班表 FIFO 與畫面沿線里程零交換',
  `pairs=${afterOrderPairs}, before=${beforeOrder}, after=${afterOrder}`);
const headwaySource = extractFunction(CURRENT_HTML, 'trtcHeadwayPosition');
check(/lead/.test(headwaySource) && /wanted/.test(headwaySource) && /posAlongShape/.test(headwaySource),
  '順序守恆防穿越仍在實際位置入口');
const officialPair = output.models.current.officialPairCases[0];
const officialPairMutant = output.models.officialHeadwayMutant.officialPairCases[0];
check(!!officialPair && officialPair.matched === 2 && officialPair.linked && officialPair.swaps === 0 &&
  officialPair.minGapM >= -TRACK_PROJECTION_TOLERANCE_M,
  '兩台同線同向同時吃官方 motion，逐畫格 FIFO 零交換', JSON.stringify(officialPair || null));
mutation(!!officialPairMutant && officialPair.swaps === 0 && officialPairMutant.swaps > 0,
  '官方 motion 繞過 trtcHeadwayPosition 會發生實際沿線交換', JSON.stringify(officialPairMutant || null));
const rosterChain = output.models.current.rosterChainCases[0];
const rosterChainMutant = output.models.rosterChainMutant.rosterChainCases[0];
check(!!rosterChain && rosterChain.matched === 1 && rosterChain.linkBtoA && rosterChain.linkCtoB &&
  rosterChain.swapsAB === 0 && rosterChain.swapsBC === 0,
  '三車 chain：僅 A 有 endpoint，unmatched B/C 仍形成 C→B→A 且零交換', JSON.stringify(rosterChain || null));
mutation(!!rosterChainMutant && rosterChain.swapsBC === 0 &&
  (!rosterChainMutant.linkCtoB || rosterChainMutant.swapsBC > 0),
  '恢復 both-unmatched continue 會截斷 C→B chain', JSON.stringify(rosterChainMutant || null));
const headwayRefresh = output.models.current.headwayRefreshCases[0];
const headwayRefreshMutant = output.models.previousMotionPriorityMutant.headwayRefreshCases[0];
check(!!headwayRefresh && headwayRefresh.limitedBeforeRefresh && headwayRefresh.firstMatched === 2 &&
  headwayRefresh.secondMatched === 2 && headwayRefresh.sameAssignments && headwayRefresh.rearStillLinkedToLead &&
  headwayRefresh.refreshJumpM <= TRACK_PROJECTION_TOLERANCE_M &&
  headwayRefresh.startFromRenderedM <= TRACK_PROJECTION_TOLERANCE_M && headwayRefresh.swapsAfter === 0,
  'rear 被 headway 限位後，15 秒 refresh 從最後實畫位置續跑、同格不跳且 FIFO 身分不換',
  JSON.stringify(headwayRefresh || null));
mutation(!!headwayRefreshMutant && headwayRefresh.refreshJumpM <= TRACK_PROJECTION_TOLERANCE_M &&
  (headwayRefreshMutant.refreshJumpM > TRACK_PROJECTION_TOLERANCE_M ||
   headwayRefreshMutant.startFromRenderedM > TRACK_PROJECTION_TOLERANCE_M ||
   !headwayRefreshMutant.rearStillLinkedToLead || headwayRefreshMutant.swapsAfter > 0),
  'refresh 恢復 previousMotion 優先會跳離上一畫格或破壞跨輪 FIFO', JSON.stringify(headwayRefreshMutant || null));

const staleRendered = output.models.current.staleRenderedCases[0];
const staleRenderedMutant = output.models.staleRenderedMutant.staleRenderedCases[0];
check(!!staleRendered && staleRendered.firstMatched === 1 && staleRendered.secondMatched === 1 &&
  staleRendered.staleAgeSec >= 60 && staleRendered.oldMotionAdvanceM > TRACK_PROJECTION_TOLERANCE_M &&
  staleRendered.startFromPreviousM <= TRACK_PROJECTION_TOLERANCE_M &&
  staleRendered.refreshJumpM <= TRACK_PROJECTION_TOLERANCE_M,
  '路線 hidden 60s 未繪制後，snapshot refresh 從舊 motion 當下位置接手，不重用 stale lastRendered',
  JSON.stringify(staleRendered || null));
mutation(!!staleRenderedMutant && staleRendered.refreshJumpM <= TRACK_PROJECTION_TOLERANCE_M &&
  (staleRenderedMutant.startFromPreviousM > TRACK_PROJECTION_TOLERANCE_M ||
   staleRenderedMutant.refreshJumpM > TRACK_PROJECTION_TOLERANCE_M) &&
  staleRenderedMutant.startFromStaleM <= TRACK_PROJECTION_TOLERANCE_M,
  '取消 lastRendered 的 1s freshness gate 會在 hidden 60s 後從舊畫格倒退重跑',
  JSON.stringify(staleRenderedMutant || null));

const rollover = output.models.current.serviceDayRolloverCases[0];
const rolloverAfterEmpty = output.models.rolloverAfterEmptyMutant.serviceDayRolloverCases[0];
const rolloverLegacyEased = output.models.rolloverLegacyEasedMutant.serviceDayRolloverCases[0];
const rolloverKeepBoard = output.models.rolloverKeepBoardMutant.serviceDayRolloverCases[0];
const rolloverClean = x => x && x.stateAfterEmpty.serviceDay === x.newDay &&
  !x.stateAfterEmpty.physicalByTrip && !x.stateAfterEmpty.tripByPhysical && !x.stateAfterEmpty.endpoint &&
  !x.stateAfterEmpty.rendered && !x.stateAfterEmpty.eased && !x.stateAfterEmpty.legacyEased &&
  !x.stateAfterEmpty.oldBoardPresent && x.stateAfterEmpty.newTripPhysical == null &&
  String(x.afterBind.physical || '').startsWith(x.newDay + '|') && !x.afterBind.newEasedPresent;
check(rolloverClean(rollover),
  '04:00 首輪 trips=[] 仍先清前日四 maps、track/legacy eased 與舊 board，新 bind 不繼承昨日值',
  JSON.stringify(rollover || null));
mutation(rolloverClean(rollover) && !rolloverClean(rolloverAfterEmpty),
  'cleanup 移到 empty return 後會讓前日 physical/eased/board 穿越 04:00', JSON.stringify(rolloverAfterEmpty || null));
mutation(rolloverClean(rollover) && !rolloverClean(rolloverLegacyEased) &&
  !!(rolloverLegacyEased && rolloverLegacyEased.stateAfterEmpty.legacyEased),
  '跨日若少清 mrt legacy trip eased，新 track 會繼承昨日誤點', JSON.stringify(rolloverLegacyEased || null));
mutation(rolloverClean(rollover) && !rolloverClean(rolloverKeepBoard) &&
  !!(rolloverKeepBoard && rolloverKeepBoard.stateAfterEmpty.oldBoardPresent),
  '跨日若不清 ln._trtcBoard，legacy 可能 carry 昨日 endpoint', JSON.stringify(rolloverKeepBoard || null));

const dayTypeRefresh = output.models.current.dayTypeRefreshCases[0];
const dayTypeStale = output.models.dayTypeStaleMutant.dayTypeRefreshCases[0];
const dayTypeRefreshPass = x => !!x && x.d1Matched && x.ttServiceDay === x.d2 && x.d2Matched &&
  !x.d1StillMatches && x.selectedWeekendSet && x.oldFollowCleared;
check(dayTypeRefreshPass(dayTypeRefresh),
  'App 長開跨 04:00 會以 Worker 的新 serviceDay 重選 weekday/weekend _tt，舊 follow 一併清除',
  JSON.stringify(dayTypeRefresh || null));
mutation(dayTypeRefreshPass(dayTypeRefresh) && !dayTypeRefreshPass(dayTypeStale),
  'prepFreqTimes 若固定查瀏覽器當日而不依 payload serviceDay，跨日會留在舊日型並無法 exact match 新 key',
  JSON.stringify(dayTypeStale || null));

const pollDayType = output.models.current.pollDayTypeCases[0];
const pollOldTimetableGate = output.models.pollOldTimetableGateMutant.pollDayTypeCases[0];
const pollOuterCatchScope = output.models.pollOuterCatchScopeMutant.pollDayTypeCases[0];
const pollDayTypePass = x => !!x && x.oldEmpty && x.fetchCalls === 2 && x.ttServiceDay === x.d2 &&
  x.selectedNewSet && x.exactNewKey && x.applied && x.endpointApplied;
const pollNetworkPass = x => !!x && !x.networkThrow && x.pollingUnlocked && x.networkClearedNonEndpoint;
check(pollDayTypePass(pollDayType),
  'poll 舊日 _tt=[] 仍會用 boardPos.at 切新日型，exact match Worker key 並套用 endpoint',
  JSON.stringify(pollDayType || null));
mutation(pollDayTypePass(pollDayType) && !pollDayTypePass(pollOldTimetableGate),
  'poll 若先用舊 _tt 做 animation eligibility，新日班表永遠沒機會 prepare/apply',
  JSON.stringify(pollOldTimetableGate || null));
check(pollNetworkPass(pollDayType),
  'poll fetch reject 零外溢例外，finally 解鎖並依當下名冊合理 clear 非 endpoint board',
  JSON.stringify(pollDayType || null));
mutation(pollNetworkPass(pollDayType) && !pollNetworkPass(pollOuterCatchScope),
  'network catch 若引用 inner-block animationEligible 會 ReferenceError，且跳過合理 clear',
  JSON.stringify(pollOuterCatchScope || null));

const historyQuery = output.models.current.historyQueryCases[0];
const historyQueryMutant = output.models.historyRememberMutant.historyQueryCases[0];
check(!!historyQuery && historyQuery.currentVsHistoryM > TRACK_PROJECTION_TOLERANCE_M &&
  historyQuery.lastAfterCurrentM <= TRACK_PROJECTION_TOLERANCE_M &&
  historyQuery.lastAfterHistoryM <= TRACK_PROJECTION_TOLERANCE_M &&
  historyQuery.refreshJumpM <= TRACK_PROJECTION_TOLERANCE_M &&
  historyQuery.startFromCurrentM <= TRACK_PROJECTION_TOLERANCE_M,
  'dirArrow current→t-8 查詢不覆寫 last rendered，refresh 仍從 current 同格接手', JSON.stringify(historyQuery || null));
mutation(!!historyQueryMutant && historyQuery.refreshJumpM <= TRACK_PROJECTION_TOLERANCE_M &&
  (historyQueryMutant.lastAfterHistoryM > TRACK_PROJECTION_TOLERANCE_M ||
   historyQueryMutant.refreshJumpM > TRACK_PROJECTION_TOLERANCE_M ||
   historyQueryMutant.startFromCurrentM > TRACK_PROJECTION_TOLERANCE_M),
  'freqTrainPosAt 無條件 remember 會讓 t-8 歷史查詢覆寫 current 並使 refresh 倒退',
  JSON.stringify(historyQueryMutant || null));

const headwayMemo = output.models.current.headwayMemoCases[0];
const headwayNoMemo = output.models.headwayMemoMutant.headwayMemoCases[0];
const headwayNoLivePartition = output.models.headwayMemoLivePartitionMutant.headwayMemoCases[0];
const memoScan = (x, i) => x && x.scans && x.scans[i] && x.scans[i].counts;
const memoSlotsKeepBoth = x => !!x && x.memoSlots.length > 0 && x.memoSlots.every(slot =>
  slot.count >= 2 && slot.times.includes(x.perfSec) && slot.times.includes(x.historySec) &&
  slot.sizes.filter(size => size === slot.active).length >= 2);
check(!!headwayMemo && headwayMemo.active >= 100 && headwayMemo.linked >= headwayMemo.active / 2 &&
  headwayMemo.directions.includes(-1) && headwayMemo.directions.includes(1) &&
  memoScan(headwayMemo, 0).base <= headwayMemo.active &&
  memoScan(headwayMemo, 0).headway <= headwayMemo.active &&
  memoScan(headwayMemo, 1).base <= headwayMemo.active &&
  memoScan(headwayMemo, 1).headway <= headwayMemo.active &&
  memoScan(headwayMemo, 0).compute === headwayMemo.linked &&
  memoScan(headwayMemo, 0).memoHit + memoScan(headwayMemo, 0).memoMiss === headwayMemo.active &&
  memoScan(headwayMemo, 1).compute === headwayMemo.linked &&
  memoScan(headwayMemo, 1).memoHit + memoScan(headwayMemo, 1).memoMiss === headwayMemo.active &&
  memoScan(headwayMemo, 2).base === 0 && memoScan(headwayMemo, 2).headway === 0 &&
  memoScan(headwayMemo, 2).project === 0 && memoScan(headwayMemo, 2).memoHit === headwayMemo.active &&
  memoScan(headwayMemo, 2).memoMiss === 0 && memoScan(headwayMemo, 3).base === 0 &&
  memoScan(headwayMemo, 3).headway === 0 && memoScan(headwayMemo, 3).project === 0 &&
  memoScan(headwayMemo, 3).memoHit === headwayMemo.active && memoScan(headwayMemo, 3).memoMiss === 0 &&
  memoSlotsKeepBoth(headwayMemo),
  '08:30 大名冊的 (board,simSec,trip) headway 各算一次，current/t-8 同時留存且重查全命中',
  JSON.stringify(headwayMemo && { active: headwayMemo.active, linked: headwayMemo.linked,
    directions: headwayMemo.directions, scans: headwayMemo.scans, memoSlots: headwayMemo.memoSlots }));
check(!!headwayMemo && !!headwayNoMemo && headwayMemo.currentStable && headwayMemo.historyStable &&
  JSON.stringify(headwayMemo.result) === JSON.stringify(headwayNoMemo.result) &&
  headwayMemo.fifoPairs === headwayMemo.linked && headwayMemo.swaps === 0 && headwayNoMemo.swaps === 0,
  'headway memo 與無 memo 實際位置等價，雙向 endpoint/FIFO 零交換',
  JSON.stringify({ production: headwayMemo && { fifoPairs: headwayMemo.fifoPairs, swaps: headwayMemo.swaps },
    mutant: headwayNoMemo && { fifoPairs: headwayNoMemo.fifoPairs, swaps: headwayNoMemo.swaps } }));
const memoComputeAmplified = !!headwayMemo && !!headwayNoMemo &&
  headwayNoMemo.totalCounts.base > headwayMemo.totalCounts.base * 2 &&
  headwayNoMemo.totalCounts.headway > headwayMemo.totalCounts.headway * 2 &&
  headwayNoMemo.totalCounts.compute > headwayMemo.totalCounts.compute * 2 &&
  headwayMemo.totalCounts.memoHit >= headwayMemo.active * 2 &&
  headwayMemo.totalCounts.memoMiss <= headwayMemo.active * 2 && headwayNoMemo.totalCounts.memoHit === 0 &&
  headwayNoMemo.totalCounts.memoMiss === headwayMemo.active * 4 &&
  memoScan(headwayNoMemo, 2).headway > 0 && memoScan(headwayNoMemo, 3).headway > 0;
mutation(memoComputeAmplified,
  '移除 board-local headway memo 會讓 current/t-8 連續查詢的 base/headway compute 顯著放大',
  JSON.stringify({ production: headwayMemo && { scans: headwayMemo.scans, total: headwayMemo.totalCounts },
    mutant: headwayNoMemo && { scans: headwayNoMemo.scans, total: headwayNoMemo.totalCounts } }));
output.metrics.headwayMemo = headwayMemo && { active: headwayMemo.active, linked: headwayMemo.linked,
  production: { scans: headwayMemo.scans, total: headwayMemo.totalCounts },
  noMemo: headwayNoMemo && { scans: headwayNoMemo.scans, total: headwayNoMemo.totalCounts } };
const livePartitionPass = x => !!(x && x.livePartition) && x.livePartition.liveFlag === true &&
  x.livePartition.staleFlag === false &&
  x.livePartition.liveVsExpectedStaleM > TRACK_PROJECTION_TOLERANCE_M &&
  x.livePartition.staleVsExpectedM <= TRACK_PROJECTION_TOLERANCE_M &&
  x.livePartition.staleVsLiveM > TRACK_PROJECTION_TOLERANCE_M;
check(livePartitionPass(headwayMemo),
  '同 simSec 跨 live→stale freshness 會失效 endpoint memo，重算成班表 fallback',
  JSON.stringify(headwayMemo && headwayMemo.livePartition));
mutation(livePartitionPass(headwayMemo) && !livePartitionPass(headwayNoLivePartition),
  '移除 headway memo live/stale partition 會讓過期 endpoint 在暫停同秒永久命中',
  JSON.stringify(headwayNoLivePartition && headwayNoLivePartition.livePartition));

output.metrics.clamp = { samples: output.models.current.samples.length, clamped: after.clamped,
  unreachable: after.unreachable, rate: output.models.current.samples.length ? after.clamped / output.models.current.samples.length : 0,
  forcedUnreachable: output.models.current.clampCases };
check(output.models.current.samples.every(x => x.clampObserved && x.unreachableObserved),
  '夾限開火／追不上均有可觀測計數', JSON.stringify(output.metrics.clamp));
const forcedClamp = output.models.current.clampCases[0];
const forcedClampSpeedMutant = output.models.speedCapMutant.clampCases[0];
check(!!forcedClamp && forcedClamp.clamped === 'high' && forcedClamp.unreachable &&
  forcedClamp.twoXNominalKmh > forcedClamp.lineLimitKmh && forcedClamp.deadlineM > forcedClamp.maxStepM &&
  forcedClamp.biggestStepM <= forcedClamp.maxStepM,
  '物理上追不上時開 high 夾限、不 snap，且相鄰幀 hard cap 於 80km/h 並明確計 unreachable',
  JSON.stringify(forcedClamp || null));
mutation(!!forcedClampSpeedMutant && forcedClamp.biggestStepM <= forcedClamp.maxStepM &&
  forcedClampSpeedMutant.biggestStepM > forcedClampSpeedMutant.maxStepM,
  '移除 endpoint 的 TRTC_BOARD_PERF.v=80km/h hard cap 會讓 forced-high 超過每 tick 線速上界',
  JSON.stringify(forcedClampSpeedMutant || null));
const forcedLow = output.models.current.lowClampCases[0], forcedLowMutant = output.models.lowClampMutant.lowClampCases[0];
const minRate = output.models.current.motionLimits.minRate;
check(!!forcedLow && forcedLow.matched === 1 && forcedLow.endpoint && forcedLow.clamped === 'low' &&
  Math.abs(forcedLow.rate - minRate) <= 1e-9 && forcedLow.unreachable &&
  forcedLow.arrivalDeltaSec < -TICK_SEC && !forcedLow.pretendsOnTime,
  'forced-low 直接以 0.25× 前進、提早到站並誠實標 unreachable', JSON.stringify(forcedLow || null));
mutation(!!forcedLowMutant && forcedLow.unreachable &&
  (!forcedLowMutant.unreachable || forcedLowMutant.pretendsOnTime || Math.abs(forcedLowMutant.arrivalDeltaSec) <= TICK_SEC),
  'forced-low 改成停等到 ETA 會假裝準時且吞掉 unreachable', JSON.stringify(forcedLowMutant || null));

const pastTarget = output.models.current.pastTargetCases[0], pastTargetMutant = output.models.pastTargetMutant.pastTargetCases[0];
check(!!pastTarget && pastTarget.matched === 1 && !pastTarget.endpoint && pastTarget.pastTargetAudit === 1 &&
  pastTarget.finiteEndSec && !pastTarget.reversed && pastTarget.progressDeltaM >= -TRACK_PROJECTION_TOLERANCE_M,
  '畫面已越過 target 時 fail closed：不建 endpoint、不倒走、不留下 Infinity', JSON.stringify(pastTarget || null));
mutation(!!pastTargetMutant && !pastTarget.endpoint &&
  (pastTargetMutant.endpoint || !pastTargetMutant.finiteEndSec || pastTargetMutant.reversed),
  'past-target 改回 Infinity endpoint 會被 fail-closed gate 抓紅', JSON.stringify(pastTargetMutant || null));

const mutationModelNames = ['chordMutant', 'officialHeadwayMutant', 'pastTargetMutant', 'lowClampMutant',
  'releaseMutant', 'feedLossMutant', 'easedKeyMutant', 'rosterMutant', 'snapMutant',
  'previousMotionPriorityMutant', 'legacyDeleteMutant', 'rosterChainMutant',
  'rolloverAfterEmptyMutant', 'rolloverLegacyEasedMutant', 'historyRememberMutant', 'rolloverKeepBoardMutant',
  'dayTypeStaleMutant', 'speedCapMutant', 'staleRenderedMutant', 'pollOldTimetableGateMutant',
  'pollOuterCatchScopeMutant', 'headwayMemoMutant', 'headwayMemoLivePartitionMutant'];
const mutationCrashes = mutationModelNames.flatMap(name => output.models[name].pageErrors.map(error => ({ name, error })));
check(mutationCrashes.length === 0, '所有 actual-source mutation 均完成重播，紅在預期不變量而非 crash',
  mutationCrashes.length ? JSON.stringify(mutationCrashes) : `models=${mutationModelNames.length}`);

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
console.log(`\n準時到站：改前 n=${before.n} p50=${before.p50}s p90=${before.p90}s；改後 n=${after.n} p50=${after.p50}s p90=${after.p90}s`);
console.log(`>=60s 誤點：改前 n=${before.delayedN} p90=${before.delayedP90}s；改後 n=${after.delayedN} p90=${after.delayedP90}s`);
console.log(`輸出：${OUTPUT}`);
if (ALLOW_BASELINE && failures) {
  console.log(`⚠️ baseline 模式：保留 ${failures} 項紅燈作為實作動機，不令腳本失敗。`);
  process.exit(0);
}
process.exit(failures ? 1 : 0);
