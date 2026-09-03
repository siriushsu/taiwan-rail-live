#!/usr/bin/env node
// 北捷逐班運動模型驗收：歷史 TrackInfo 語料直接注入頁面，全程只跑本機、封鎖外站。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { buildTrtcModel, resolveBoardRows, claimBoardRows, collapseClaims } from './trtc_board_ledger.mjs';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(process.env.TRTC_MOTION_ROOT || SCRIPT_ROOT);
const CORPUS = process.env.TRTC_FIXTURE_DIR || '/Users/xuxiang/Code/軌島-語料/trtc-peak-0803';
const PORT = Number(process.env.TRTC_MOTION_PORT || 6411);
const BASE_URL = `http://127.0.0.1:${PORT}/index.html`;
const ENGINES = (process.env.ENGINES || 'chromium,webkit').split(',').filter(Boolean);
const MUTATION = process.env.TRTC_MOTION_MUTATION || '';
const OUTPUT = path.resolve(process.env.TRTC_MOTION_OUTPUT || path.join(SCRIPT_ROOT, 'CODEX-北捷運動-驗收.json'));
const SPEED_FLOOR_MULTIPLIER = .25;
const SPEED_CEIL_MULTIPLIER = 2; // 判準：各線最快表定段速 × 2；不是手打的 m/s 常數。
const output = { root: ROOT, corpus: CORPUS, mutation: MUTATION || null, engines: {}, mobile: [], assertions: [] };
let failures = 0;

function check(ok, label, detail = '') {
  const rec = { pass: !!ok, label, detail };
  output.assertions.push(rec);
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
  if (!ok) failures++;
}
const percentile = (values, p) => {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] : null;
};
const dist = values => ({ n: values.length, p50: percentile(values, .5), p90: percentile(values, .9), max: percentile(values, 1) });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const epoch = value => {
  const m = String(value).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000) - 8 * 3600 : null;
};

const model = buildTrtcModel(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc.json'))),
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc_times.json'))),
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc_codes.json'))),
  { includeY: true },
);
const branchHints = new Map();
const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json')));
const tk = manifest.快照.filter(x => x.kind === 'tk').sort((a, b) => a.fetchedAtEpoch - b.fetchedAtEpoch);
const payloads = tk.map(meta => {
  const raw = JSON.parse(fs.readFileSync(path.join(CORPUS, meta.file))).rows;
  const at = Math.max(...raw.map(row => epoch(row.NowDateTime) || 0));
  const resolved = resolveBoardRows(model, raw, epoch, branchHints);
  branchHints.clear();
  for (const [no, line] of resolved.lineHints) branchHints.set(no, line);
  const claimed = claimBoardRows(model, resolved.rows, at, new Map());
  const collapsed = collapseClaims(claimed.claims);
  return { slot: meta.slot, at, rows: collapsed.map(x => ({ line: x.line, dir: x.dir, from: x.from, to: x.to,
    dest: x.destIdx, run: x.run, arrEpoch: x.arrEpoch, no: x.no || '', terminal: !!x.terminal })) };
});
let indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\s+integrity="[^"]+"/g, '');
if (MUTATION === 'no-floor') {
  indexHtml = indexHtml.replace('const TRTC_MOTION_MIN_RATE = .25;', 'const TRTC_MOTION_MIN_RATE = 0; // semantic mutation: 移除速度下限');
} else if (MUTATION === 'no-ceil') {
  indexHtml = indexHtml.replace('const TRTC_MOTION_MAX_RATE = 2;', 'const TRTC_MOTION_MAX_RATE = 1000; // semantic mutation: 移除追趕速度上界');
}
if (MUTATION && !indexHtml.includes('semantic mutation:')) throw new Error(`突變 ${MUTATION} 沒有命中受測程式碼`);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ rows: [], trains: [], list: [], boardPos: null }));
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': MIME['.html'] }); res.end(indexHtml); return;
    }
    const file = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const leafletRoot = process.env.TRTC_LEAFLET_DIST || '/tmp/trtc-playwright-deps/node_modules/leaflet/dist';
const leafletJs = fs.readFileSync(path.join(leafletRoot, 'leaflet.js'));
const leafletCss = fs.readFileSync(path.join(leafletRoot, 'leaflet.css'));
async function preparePage(page) {
  await page.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'cdnjs.cloudflare.com' && url.pathname.endsWith('leaflet.min.js'))
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: leafletJs });
    if (url.hostname === 'cdnjs.cloudflare.com' && url.pathname.endsWith('leaflet.min.css'))
      return route.fulfill({ status: 200, contentType: 'text/css', body: leafletCss });
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    return route.abort('blockedbyclient');
  });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    ((state.decoLines || []).concat(state.lines || [])).some(ln => ln._sys === 'mrt' && ln._tt && ln._tt.length),
  null, { timeout: 30000 });
}

async function runEngine(name) {
  const launcher = name === 'webkit' ? webkit : chromium;
  const browser = await launcher.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(String(error)));
  await preparePage(page);
  const result = await page.evaluate(({ payloads, speedFloorMultiplier, speedCeilMultiplier }) => {
    const round = (v, n = 4) => Number.isFinite(v) ? +v.toFixed(n) : null;
    const percentile = (values, p) => {
      const a = values.filter(Number.isFinite).sort((x, y) => x - y);
      return a.length ? a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] : null;
    };
    const distribution = values => ({ n: values.length, p50: percentile(values, .5), p90: percentile(values, .9), max: percentile(values, 1) });
    const havM = (a, b) => a && b ? haversineKm(a, b) * 1000 : null;
    const pool = () => metroLivePool().filter(ln => isTrtcBoardLine(ln) && ln._tt && ln._tt.length);
    const freshen = () => {
      _mlGate = true; _mlGateAt = Date.now();
      for (const ln of pool()) if (ln._trtcBoard) ln._trtcBoard.at = Date.now();
    };
    const keyOf = (ln, tr) => freqTripKey(ln, tr);
    const targetOf = (ln, tr) => {
      const board = ln._trtcBoard, own = !!(board && board.shifts.has(tr));
      return { own, target: board ? (own ? board.shifts.get(tr) : board.all) : 0 };
    };
    const assignmentMap = audit => new Map((audit.assignments || []).map(x => [x.tripKey, x]));
    const segmentAt = (ln, tr, tm) => {
      const pairs = tr.length >> 1;
      let lo = 0;
      while (lo + 1 < pairs && tr[(lo + 1) * 2 + 1] <= tm) lo++;
      if (lo === pairs - 1) return { moving: false, seg: `terminal:${lo}`, nominalKmSec: 0, ia: tr[lo * 2], ib: tr[lo * 2] };
      const ia = tr[lo * 2], ib = tr[lo * 2 + 2], ta = tr[lo * 2 + 1], tb = tr[lo * 2 + 3];
      const span = tb - ta, run = runBetween(ln, ia, ib), move = run && run < span ? run : span;
      const f = Math.min(1, span > 0 ? (tm - ta) / move : 1);
      const d = ln.hasShape ? Math.abs(ln.stations[ib].d - ln.stations[ia].d) : haversineKm(ln.stations[ia], ln.stations[ib]);
      return { moving: f > 0 && f < 1, seg: `${lo}:${ia}>${ib}`, nominalKmSec: move > 0 ? d / move : 0, ia, ib };
    };
    const chainage = (ln, pos, loD, hiD) => {
      if (!ln.shape || !ln.cum || !pos) return null;
      const latScale = 111.32, lonScale = Math.cos(pos.lat * Math.PI / 180) * 111.32;
      let best = null;
      for (let i = 0; i + 1 < ln.shape.length; i++) {
        const fromD = Math.max(loD, ln.cum[i]), toD = Math.min(hiD, ln.cum[i + 1]);
        if (toD < fromD) continue;
        const a = posAlongShape(ln, fromD), b = posAlongShape(ln, toD);
        const ax = (a.lon - pos.lon) * lonScale, ay = (a.lat - pos.lat) * latScale;
        const bx = (b.lon - pos.lon) * lonScale, by = (b.lat - pos.lat) * latScale;
        const dx = bx - ax, dy = by - ay, den = dx * dx + dy * dy;
        const f = den ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / den)) : 0;
        const x = ax + dx * f, y = ay + dy * f, q = x * x + y * y;
        if (!best || q < best.q) best = { q, d: fromD + (toD - fromD) * f };
      }
      return best ? best.d : null;
    };
    const progressOf = (ln, tr, pos, seg) => {
      const da = ln.stations[seg.ia].d, db = ln.stations[seg.ib].d;
      const d = chainage(ln, pos, Math.min(da, db), Math.max(da, db)); if (d == null) return null;
      const a = ln.stations[tr[0]].d, b = ln.stations[tr[tr.length - 2]].d;
      if (ln.loop) { const L = ln.loopLen || ln.cum[ln.cum.length - 1]; return ((d - a) % L + L) % L; }
      return b >= a ? d - a : a - d;
    };

    state.playing = false; state.ready = false; _trtcPolling = true;
    window.__map.setView([25.0478, 121.5170], 16, { animate: false });
    // 預掃：找跨槽最穩定、且橫跨多線的逐秒時間序列見證車。
    const appearances = new Map();
    _trtcNoTrip.clear(); _easedShift.clear(); _metroGateEp.on = false; _metroGateEp.at = 0;
    for (const payload of payloads) {
      state.simSec = trtcServiceSec(payload.at); state.clockAtNow = true; freshen();
      const audit = applyTrtcBoard(payload.rows, payload.at); freshen();
      const own = new Set((audit.assignments || []).map(x => x.tripKey));
      for (const ln of pool()) for (const tr of ln._tt) {
        const key = keyOf(ln, tr); if (!own.has(key)) continue;
        const rec = appearances.get(key) || { key, line: ln.id, n: 0 }; rec.n++; appearances.set(key, rec);
      }
    }
    const byLine = new Map();
    for (const rec of appearances.values()) if (!byLine.has(rec.line) || byLine.get(rec.line).n < rec.n) byLine.set(rec.line, rec);
    const witnessKeys = new Set([...byLine.values()].filter(x => x.n >= 2).map(x => x.key));

    _trtcNoTrip.clear(); _easedShift.clear(); _metroGateEp.on = false; _metroGateEp.ep = 0; _metroGateEp.at = 0;
    const previousTargets = new Map(), previousSamples = new Map(), windows = new Map(), pending = new Map();
    const categories = { a: [], b: [], c: [] }, series = Object.fromEntries([...witnessKeys].map(k => [k, []]));
    const backwards = [], stalled = [], overspeed = [], speedSamples = [], normalized = [], convergence = [], rosterFrames = [], infoParityFailures = [];
    const lineCeil = {}, lineNominalMax = {};
    // 逐線追趕上界：腳本自己依「該線梯形巡航／平均的最大值」重算一次，再與實作的 metroRateCap 對照。
    // 只共用 buildProfile 這個雙方都同意的物理原語；被測的規則（倍率要除掉那個比值）由腳本自己寫一遍。
    // D 的容量會吃這個數，所以它本身必須有具名斷言把關——否則哪天上界塌成 1，容量變 0、D 反而永遠綠。
    const lineRateCap = {}, rateCapAudit = [];
    for (const ln of pool()) {
      let worst = 1;
      for (const tr of ln._tt) {
        for (let lo = 0; lo * 2 + 3 < tr.length; lo++) {
          const ia = tr[lo * 2], ta = tr[lo * 2 + 1], ib = tr[lo * 2 + 2], tb = tr[lo * 2 + 3];
          const span = tb - ta, run = runBetween(ln, ia, ib);
          const moveT = run && run < span ? run : span;
          if (!(moveT > 0)) continue;
          const km = ln.hasShape ? Math.abs(ln.stations[ib].d - ln.stations[ia].d) : haversineKm(ln.stations[ia], ln.stations[ib]);
          const pr = buildProfile(km, moveT, TRTC_BOARD_PERF.a, TRTC_BOARD_PERF.b, TRTC_BOARD_PERF.v);
          if (pr && pr.vc > 0 && pr.L > 0) worst = Math.max(worst, pr.vc / (pr.L / moveT));
        }
      }
      const expect = Math.max(1, speedCeilMultiplier / worst);
      const actual = typeof metroRateCap === 'function' ? metroRateCap(ln) : null;
      lineRateCap[ln.id] = actual != null ? actual : expect;
      rateCapAudit.push({ line: ln.id, expect: round(expect, 4), actual: actual == null ? null : round(actual, 4),
        ok: actual != null && Math.abs(actual - expect) < 1e-9 && actual > 1 && actual <= speedCeilMultiplier + 1e-9 });
    }
    let logicalPolls = 0, payloadIndex = 0;
    const start = payloads[0].at, end = payloads[payloads.length - 1].at + 15;
    const ingestPayload = (payload, epoch) => {
      state.simSec = trtcServiceSec(epoch); state.clockAtNow = true; freshen();
      const audit = applyTrtcBoard(payload.rows, payload.at); freshen();
      const assignments = assignmentMap(audit), keys = [];
      for (const ln of pool()) for (const tr of ln._tt) {
        if (freqTrainTime(tr, state.simSec) == null) continue;
        const key = keyOf(ln, tr), cur = targetOf(ln, tr), a = assignments.get(key) || null;
        const rec = { slot: payload.slot, at: payload.at, line: ln.id, key, own: cur.own, target: cur.target,
          no: a && a.no || '', anchor: a ? `${a.from}>${a.to}` : 'median' };
        keys.push(key);
        const prev = previousTargets.get(key);
        if (prev && Math.abs(rec.target - prev.target) >= .5) {
          let cat;
          if (prev.own !== rec.own || (!prev.own && !rec.own) || (prev.no && rec.no && prev.no !== rec.no)) cat = 'a';
          else if (prev.anchor !== rec.anchor) cat = 'c';
          else cat = 'b';
          categories[cat].push({ ...rec, prevTarget: prev.target, delta: rec.target - prev.target,
            prevOwn: prev.own, prevNo: prev.no, prevAnchor: prev.anchor });
        }
        previousTargets.set(key, rec);
        const actual = freqTrainPosAt(ln, tr, state.simSec), actualShift = metroShiftSec(ln, tr);
        const info = freqTrainInfoAt(ln, tr, state.simSec);
        if (!info.pos || havM(actual, info.pos) > .01) infoParityFailures.push({ slot: payload.slot, key, line: ln.id });
        const actualTm = Math.max(tr[1], Math.min(tr[tr.length - 1], state.simSec - actualShift));
        const rawTm = Math.max(tr[1], Math.min(tr[tr.length - 1], state.simSec - rec.target));
        const implied = freqTrainPosRaw(ln, tr, rawTm);
        const actualSeg = segmentAt(ln, tr, actualTm), impliedSeg = segmentAt(ln, tr, rawTm);
        const initialM = Math.abs(progressOf(ln, tr, actual, actualSeg) - progressOf(ln, tr, implied, impliedSeg)) * 1000;
        pending.set(key, { due: epoch + 15, line: ln.id, tr, ln, target: rec.target, own: rec.own, initialM,
          initialShiftSec: Math.abs(actualShift - rec.target), initialSignedShiftSec: actualShift - rec.target });
      }
      rosterFrames.push({ slot: payload.slot, at: payload.at, keys: keys.sort() });
    };
    ingestPayload(payloads[payloadIndex++], start);
    // 同步回放幾秒就跑完 56 分鐘；把 gate 首見 5 秒窗明確關掉，否則中途新出現的 entry 會被誤當開機首拉直接 snap。
    _metroGateEp.at = performance.now() - 6000;
    for (let epoch = start; epoch <= end; epoch++) {
      if ((epoch - start) % 15 === 0) logicalPolls++;
      if (epoch !== start) {
        // 先用上一份 target 推進到本秒，再在輪詢抵達的同一位置換 target；順序本身就是「更新不可跳位」契約。
        for (let tenth = 1; tenth <= 10; tenth++) {
          state.simSec = trtcServiceSec(epoch - 1 + tenth / 10); freshen();
          for (const e of _easedShift.values()) e.at -= 100;
          for (const ln of pool()) for (const tr of ln._tt)
            if (freqTrainTime(tr, state.simSec) != null) freqTrainPosAt(ln, tr, state.simSec);
        }
      }
      state.simSec = trtcServiceSec(epoch); freshen();
      if (payloadIndex < payloads.length && epoch === payloads[payloadIndex].at)
        ingestPayload(payloads[payloadIndex++], epoch);
      for (const ln of pool()) for (const tr of ln._tt) {
        const roster = freqTrainTime(tr, state.simSec); if (roster == null) continue;
        const key = keyOf(ln, tr), tar = targetOf(ln, tr), sh = metroShiftSec(ln, tr);
        const tm = Math.max(tr[1], Math.min(tr[tr.length - 1], roster - sh));
        const pos = freqTrainPosRaw(ln, tr, tm), seg = segmentAt(ln, tr, tm), progress = progressOf(ln, tr, pos, seg);
        if (seg.nominalKmSec > 0) lineNominalMax[ln.id] = Math.max(lineNominalMax[ln.id] || 0, seg.nominalKmSec);
        const prev = previousSamples.get(key);
        if (prev && progress != null && prev.progress != null && epoch - prev.epoch === 1) {
          const deltaKm = progress - prev.progress, mps = deltaKm * 1000;
          if (deltaKm < -1e-6) backwards.push({ epoch, key, line: ln.id, deltaM: round(deltaKm * 1000) });
          if (seg.nominalKmSec > 0 && prev.seg === seg.seg) {
            const rate = mps / (seg.nominalKmSec * 1000);
            speedSamples.push({ line: ln.id, mps, rate }); normalized.push(rate);
          }
        }
        previousSamples.set(key, { epoch, progress, seg: seg.seg });
        let w = windows.get(key) || []; w.push({ epoch, progress, moving: seg.moving, seg: seg.seg });
        if (w.length > 6) w.shift(); windows.set(key, w);
        if (w.length === 6 && w.every(x => x.moving && x.seg === w[0].seg) && w[5].progress - w[0].progress <= 1e-9)
          stalled.push({ epoch, key, line: ln.id, seg: seg.seg, displacementM: round((w[5].progress - w[0].progress) * 1000) });
        if (witnessKeys.has(key)) series[key].push({ epoch, line: ln.id, target: tar.target, own: tar.own,
          eased: round(sh, 3), progressKm: round(progress, 5), moving: seg.moving, seg: seg.seg });
        const p = pending.get(key);
        if (p && p.due === epoch) {
          const impliedTm = Math.max(tr[1], Math.min(tr[tr.length - 1], roster - p.target));
          const impliedPos = freqTrainPosRaw(ln, tr, impliedTm), impliedSeg = segmentAt(ln, tr, impliedTm);
          const residualM = Math.abs(progress - progressOf(ln, tr, impliedPos, impliedSeg)) * 1000;
          const afterShiftSec = Math.abs(sh - p.target);
          // 一輪詢能吸收幾秒,取決於「這條線實際被允許的追趕倍率」。v0805c 之後畫面速度＝
          // 梯形瞬時速度 × 有效時間倍率,模型於是把倍率先除掉該線「巡航／平均」的最大值
          // (metroRateCap)。這裡若沿用寫死的 speedCeilMultiplier,就會把「上界本來就比較低」
          // 誤報成「模型停住了」——實測差距 p90 恰好 10.028 秒 = 15 − 15×(1.33−1)。
          // 逐線上界本身另有一條具名斷言把關(見下方「逐線追趕上界」),不會因為這裡改吃它而失去牙。
          const capRate = lineRateCap[ln.id] != null ? lineRateCap[ln.id] : speedCeilMultiplier;
          const capacitySec = p.initialSignedShiftSec > 0 ? 15 * (capRate - 1) : 15 * (1 - speedFloorMultiplier);
          const feasibleResidualSec = Math.max(0, p.initialShiftSec - capacitySec);
          convergence.push({ key, line: ln.id, own: p.own, initialM: round(p.initialM), after15M: round(residualM),
            ratio: p.initialM > .01 ? round(residualM / p.initialM, 4) : 0,
            initialShiftSec: round(p.initialShiftSec, 3), after15ShiftSec: round(afterShiftSec, 3),
            shiftRatio: p.initialShiftSec > .001 ? round(afterShiftSec / p.initialShiftSec, 4) : 0,
            feasibleResidualSec: round(feasibleResidualSec, 3), feasibleGapSec: round(Math.abs(afterShiftSec - feasibleResidualSec), 3) });
          pending.delete(key);
        }
      }
    }
    for (const [line, max] of Object.entries(lineNominalMax)) lineCeil[line] = max * 1000 * speedCeilMultiplier;
    // 速度上界用該線語料實際遇到的最快表定段速導出；逐筆依其線判斷。
    speedSamples.forEach((sample, i) => {
      if (sample.mps > lineCeil[sample.line] + 1e-6)
        overspeed.push({ sample: i, line: sample.line, mps: round(sample.mps, 3), ceilingMps: round(lineCeil[sample.line], 3), rate: round(sample.rate, 3) });
    });
    const categoryTotal = categories.a.length + categories.b.length + categories.c.length;
    const categorySummary = Object.fromEntries(Object.entries(categories).map(([k, a]) => [k, {
      n: a.length, pct: categoryTotal ? round(a.length * 100 / categoryTotal, 1) : 0,
      delta: { p50: round(a.map(x => Math.abs(x.delta)).sort((x, y) => x - y)[Math.floor(a.length * .5)] || 0),
        p90: round(a.map(x => Math.abs(x.delta)).sort((x, y) => x - y)[Math.floor(a.length * .9)] || 0),
        max: round(Math.max(0, ...a.map(x => Math.abs(x.delta)))) }, examples: a.slice(0, 12) }])) ;
    return { logicalPolls, observedSnapshots: payloads.length, start, end, witnessKeys: [...witnessKeys], series,
      categories: categorySummary, categoryTotal,
      backwardCount: backwards.length, backwards: backwards.slice(0, 100),
      stalledCount: stalled.length, stalled: stalled.slice(0, 100),
      overspeedCount: overspeed.length, overspeed: overspeed.slice(0, 100),
      normalizedDist: distribution(normalized), convergence,
      rateCapAudit,
      lineNominalMaxMps: Object.fromEntries(Object.entries(lineNominalMax).map(([k, v]) => [k, round(v * 1000, 3)])),
      lineCeilMps: Object.fromEntries(Object.entries(lineCeil).map(([k, v]) => [k, round(v, 3)])), rosterFrames, infoParityFailures };
  }, { payloads, speedFloorMultiplier: SPEED_FLOOR_MULTIPLIER, speedCeilMultiplier: SPEED_CEIL_MULTIPLIER });
  result.pageErrors = pageErrors;
  await context.close(); await browser.close();
  return result;
}

async function mobileMatrix(name) {
  const launcher = name === 'webkit' ? webkit : chromium;
  for (const width of [360, 375, 414, 768]) {
    const browser = await launcher.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width, height: width === 768 ? 1024 : 800 },
      isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const page = await context.newPage(); await preparePage(page);
    const selector = 'button.gtab[title="捷運與輕軌"]:visible';
    await page.waitForSelector(selector, { state: 'visible' });
    const hit = await page.$eval(selector, el => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return top === el || !!(top && top.closest('button') === el); });
    await page.tap(selector);
    await page.waitForFunction(() => state.mode === 'freq', null, { timeout: 10000 });
    const layout = await page.evaluate(() => ({ mode: state.mode,
      noHorizontalScroll: document.documentElement.scrollWidth <= innerWidth + 1,
      viewport: { width: innerWidth, height: innerHeight } }));
    output.mobile.push({ engine: name, width, hit, ...layout });
    await context.close(); await browser.close();
  }
}

let server;
try {
  server = await startServer();
  const served = await (await fetch(BASE_URL)).text();
  output.hashes = { disk: sha256(fs.readFileSync(path.join(ROOT, 'index.html'))), expectedServed: sha256(indexHtml), served: sha256(served), mutation: MUTATION || null };
  check(output.hashes.expectedServed === output.hashes.served && (!MUTATION || served.includes('semantic mutation:')),
    '服務內容自檢', JSON.stringify(output.hashes));
  for (const engine of ENGINES) {
    console.log(`\n===== ${engine} =====`);
    const r = await runEngine(engine); output.engines[engine] = r;
    const conv = r.convergence.filter(x => x.initialM > .01);
    check(r.backwardCount === 0, `${engine} A 單調性`, `倒退=${r.backwardCount}`);
    check(r.stalledCount === 0, `${engine} B 兩站間任意連續 5 秒不假死`, `違規窗=${r.stalledCount}`);
    check(r.overspeedCount === 0, `${engine} C 速度上界`,
      `上界=各線最快表定段速×${SPEED_CEIL_MULTIPLIER}；違規=${r.overspeedCount}；rate=${JSON.stringify(r.normalizedDist)}`);
    check(conv.length > 0 && percentile(conv.map(x => x.feasibleGapSec), .9) <= .02, `${engine} D 一輪詢週期用物理上限完整吸收可吸收誤差`,
      `有誤差樣本=${conv.length}；沿線位置 ratio=${JSON.stringify(dist(conv.map(x => x.ratio)))}；` +
      `shift ratio=${JSON.stringify(dist(conv.map(x => x.shiftRatio)))}；可行殘差差距=${JSON.stringify(dist(conv.map(x => x.feasibleGapSec)))}；` +
      `after15m=${JSON.stringify(dist(conv.map(x => x.after15M)))}`);
    check(r.rateCapAudit.length > 0 && r.rateCapAudit.every(x => x.ok),
      `${engine} 逐線追趕上界＝${SPEED_CEIL_MULTIPLIER} ÷ 該線梯形「巡航／平均」最大值`,
      JSON.stringify(r.rateCapAudit));
    check(r.infoParityFailures.length === 0, `${engine} 跟隨卡位置與地圖共用同一運動時間軸`, `差異=${r.infoParityFailures.length}`);
    check(r.logicalPolls >= 10 && r.observedSnapshots >= 10 && r.witnessKeys.length >= 3,
      `${engine} 覆蓋至少 10 輪、多線多車`, `polls=${r.logicalPolls}, snapshots=${r.observedSnapshots}, witnesses=${r.witnessKeys.length}`);
    check(r.pageErrors.length === 0, `${engine} 無 pageerror`, r.pageErrors.slice(0, 3).join(' | '));
  }
  if (!process.env.SKIP_MOBILE) for (const engine of ENGINES) await mobileMatrix(engine);
  if (!process.env.SKIP_MOBILE) check(output.mobile.every(x => x.hit && x.mode === 'freq' && x.noHorizontalScroll),
    '手機 360/375/414/768 真觸控與水平溢出', JSON.stringify(output.mobile));
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
}
console.log(`\n輸出：${OUTPUT}`);
process.exit(failures ? 1 : 0);
