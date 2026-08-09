#!/usr/bin/env node
// 第二輪：用官方錨點的絕對到站時刻建立獨立真值，比較新舊準度與速度飽和持續時間。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { buildTrtcModel, resolveBoardRows, claimBoardRows, collapseClaims } from './trtc_board_ledger.mjs';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEW_ROOT = path.resolve(process.env.TRTC_ROUND2_NEW_ROOT || HERE);
const BASE_ROOT = path.resolve(process.env.TRTC_ROUND2_BASE_ROOT || '/Users/xuxiang/Code/軌島-北捷運動-基準');
const FIRST_COMMIT = process.env.TRTC_ROUND2_FIRST_COMMIT || 'e3d4bac';
const CORPUS = process.env.TRTC_FIXTURE_DIR || '/Users/xuxiang/Code/軌島-語料/trtc-peak-0803';
const OUTPUT = path.resolve(process.env.TRTC_ROUND2_OUTPUT || path.join(HERE, 'CODEX-北捷運動-第二輪.json'));
const ENGINES = (process.env.ENGINES || 'chromium,webkit').split(',').filter(Boolean);
const PORT0 = Number(process.env.TRTC_ROUND2_PORT || 6420);
const SELECTED_KEYS = [
  'mrt:O_XINZHUANG:0@29520>20@32328',
  'mrt:BR:0@30000>23@32680',
  'mrt:BL:0@30060>22@33052',
  'mrt:O_LUZHOU:16@30480>0@32677',
];
const FLOOR = .25, CEIL = 2, SAT_EPS = .02, CORRECTING_EPS_SEC = .01;
const CAPTURE_SPEC = { key: SELECTED_KEYS[0], center: [25.0352, 121.5298], zoom: 16,
  epochs: [1785716694, 1785716695, 1785716696, 1785716698, 1785716702, 1785716708] };

const epochOf = value => {
  const m = String(value).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000) - 8 * 3600 : null;
};
const sha256 = value => createHash('sha256').update(value).digest('hex');
const percentile = (values, p) => {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] : null;
};
const dist = values => ({ count: values.length, p50: percentile(values, .5), p90: percentile(values, .9),
  p99: percentile(values, .99), max: percentile(values, 1) });

const ledgerModel = buildTrtcModel(
  JSON.parse(fs.readFileSync(path.join(NEW_ROOT, 'data/trtc.json'))),
  JSON.parse(fs.readFileSync(path.join(NEW_ROOT, 'data/trtc_times.json'))),
  JSON.parse(fs.readFileSync(path.join(NEW_ROOT, 'data/trtc_codes.json'))),
  { includeY: true },
);
const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json')));
const branchHints = new Map();
const payloads = manifest.快照.filter(x => x.kind === 'tk').sort((a, b) => a.fetchedAtEpoch - b.fetchedAtEpoch).map(meta => {
  const raw = JSON.parse(fs.readFileSync(path.join(CORPUS, meta.file))).rows;
  const at = Math.max(...raw.map(row => epochOf(row.NowDateTime) || 0));
  const resolved = resolveBoardRows(ledgerModel, raw, epochOf, branchHints);
  branchHints.clear();
  for (const [no, line] of resolved.lineHints) branchHints.set(no, line);
  const collapsed = collapseClaims(claimBoardRows(ledgerModel, resolved.rows, at, new Map()).claims);
  return { slot: meta.slot, at, rows: collapsed.map(x => ({ line: x.line, dir: x.dir, from: x.from, to: x.to,
    dest: x.destIdx, run: x.run, arrEpoch: x.arrEpoch, no: x.no || '', terminal: !!x.terminal })) };
});

const leafletRoot = process.env.TRTC_LEAFLET_DIST || '/tmp/trtc-playwright-deps/node_modules/leaflet/dist';
const leafletJs = fs.readFileSync(path.join(leafletRoot, 'leaflet.js'));
const leafletCss = fs.readFileSync(path.join(leafletRoot, 'leaflet.css'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

function serve(root, port, htmlOverride = null) {
  const indexHtml = String(htmlOverride == null ? fs.readFileSync(path.join(root, 'index.html'), 'utf8') : htmlOverride)
    .replace(/\s+integrity="[^"]+"/g, '');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}/`);
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ rows: [], trains: [], list: [], boardPos: null })); return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': MIME['.html'] }); res.end(indexHtml); return;
    }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, indexHtml }));
  });
}

async function preparePage(page, url) {
  await page.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.hostname === 'cdnjs.cloudflare.com' && u.pathname.endsWith('leaflet.min.js'))
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: leafletJs });
    if (u.hostname === 'cdnjs.cloudflare.com' && u.pathname.endsWith('leaflet.min.css'))
      return route.fulfill({ status: 200, contentType: 'text/css', body: leafletCss });
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return route.continue();
    return route.abort('blockedbyclient');
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    ((state.decoLines || []).concat(state.lines || [])).some(ln => ln._sys === 'mrt' && ln._tt && ln._tt.length),
  null, { timeout: 30000 });
}

async function replay(root, label, engineName, port, htmlOverride = null, captureSpec = null) {
  const { server, indexHtml } = await serve(root, port, htmlOverride);
  const url = `http://127.0.0.1:${port}/index.html`;
  const launcher = engineName === 'webkit' ? webkit : chromium;
  const browser = await launcher.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = []; page.on('pageerror', e => pageErrors.push(String(e)));
  try {
    await preparePage(page, url);
    const result = await page.evaluate(({ payloads, selectedKeys, floor, ceil, satEps, correctingEpsSec, captureSpec }) => {
      const round = (v, n = 4) => Number.isFinite(v) ? +v.toFixed(n) : null;
      const percentile = (values, p) => {
        const a = values.filter(Number.isFinite).sort((x, y) => x - y);
        return a.length ? a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] : null;
      };
      const distribution = values => ({ count: values.length, p50: percentile(values, .5), p90: percentile(values, .9),
        p99: percentile(values, .99), max: percentile(values, 1) });
      const pool = () => metroLivePool().filter(ln => isTrtcBoardLine(ln) && ln._tt && ln._tt.length);
      const freshen = () => { _mlGate = true; _mlGateAt = Date.now(); for (const ln of pool()) if (ln._trtcBoard) ln._trtcBoard.at = Date.now(); };
      const keyOf = (ln, tr) => freqTripKey(ln, tr);
      const targetOf = (ln, tr) => {
        const board = ln._trtcBoard, own = !!(board && board.shifts.has(tr));
        const target = board ? (own
          ? (typeof trtcBoardShiftTarget === 'function' ? trtcBoardShiftTarget(ln, tr) : board.shifts.get(tr))
          : board.all) : 0;
        return { own, target };
      };
      const segmentAt = (ln, tr, tm) => {
        const pairs = tr.length >> 1; let lo = 0;
        while (lo + 1 < pairs && tr[(lo + 1) * 2 + 1] <= tm) lo++;
        if (lo === pairs - 1) return { moving: false, seg: `terminal:${lo}`, nominalKmSec: 0, ia: tr[lo * 2], ib: tr[lo * 2], run: 0 };
        const ia = tr[lo * 2], ib = tr[lo * 2 + 2], ta = tr[lo * 2 + 1], tb = tr[lo * 2 + 3];
        const span = tb - ta, run = runBetween(ln, ia, ib), move = run && run < span ? run : span;
        const f = Math.min(1, span > 0 ? (tm - ta) / move : 1);
        const d = ln.hasShape ? Math.abs(ln.stations[ib].d - ln.stations[ia].d) : haversineKm(ln.stations[ia], ln.stations[ib]);
        return { moving: f > 0 && f < 1, seg: `${lo}:${ia}>${ib}`, nominalKmSec: move > 0 ? d / move : 0, ia, ib, run: move };
      };
      const chainage = (ln, pos, loD, hiD) => {
        if (!ln.shape || !ln.cum || !pos) return null;
        const latScale = 111.32, lonScale = Math.cos(pos.lat * Math.PI / 180) * 111.32; let best = null;
        for (let i = 0; i + 1 < ln.shape.length; i++) {
          const fromD = Math.max(loD, ln.cum[i]), toD = Math.min(hiD, ln.cum[i + 1]); if (toD < fromD) continue;
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
      const truthTrapFraction = (km, totalSec, elapsedSec) => {
        const L = km * 1000, T = totalSec, a = 3.6 / 3.6, b = 4.3 / 3.6, vmax = 80 / 3.6;
        const linear = Math.max(0, Math.min(1, elapsedSec / T));
        if (!(L > 0) || !(T > 0)) return linear;
        const k = 1 / a + 1 / b, disc = T * T - 2 * k * L;
        if (disc < 0) return linear;
        const vc = (T - Math.sqrt(disc)) / k; if (!(vc > 0) || vc > vmax) return linear;
        const tAcc = vc / a, tCru = Math.sqrt(disc), dAcc = vc * vc / (2 * a), dCru = vc * tCru;
        const t = Math.max(0, Math.min(T, elapsedSec)); let d;
        if (t < tAcc) d = .5 * a * t * t;
        else if (t < tAcc + tCru) d = dAcc + vc * (t - tAcc);
        else { const td = t - tAcc - tCru; d = dAcc + dCru + vc * td - .5 * b * td * td; }
        return Math.max(0, Math.min(1, d / L));
      };
      const truthProgress = (ln, tr, truth, nowSec, trapezoid) => {
        const elapsed = nowSec - (truth.arrSec - truth.run);
        const km = ln.hasShape ? Math.abs(ln.stations[truth.to].d - ln.stations[truth.from].d)
          : haversineKm(ln.stations[truth.from], ln.stations[truth.to]);
        const f = trapezoid ? truthTrapFraction(km, truth.run, elapsed)
          : Math.max(0, Math.min(1, elapsed / truth.run));
        const d0 = ln.stations[truth.from].d, d1 = ln.stations[truth.to].d, d = d0 + (d1 - d0) * f;
        const a = ln.stations[tr[0]].d, b = ln.stations[tr[tr.length - 2]].d;
        if (ln.loop) { const L = ln.loopLen || ln.cum[ln.cum.length - 1]; return ((d - a) % L + L) % L; }
        return b >= a ? d - a : a - d;
      };

      state.playing = false; state.ready = false; _trtcPolling = true;
      map.setView([25.0478, 121.5170], 16, { animate: false });
      _trtcNoTrip.clear(); _easedShift.clear(); _metroGateEp.on = false; _metroGateEp.ep = 0; _metroGateEp.at = 0;
      const previous = new Map(), previousTarget = new Map(), lastJump = new Map(), truths = new Map();
      const accuracy = { steady: [], correcting: [], all: [] }, accuracyLinear = { steady: [], correcting: [], all: [] }, sampleIds = [];
      const curveSet = new Set(selectedKeys), curves = Object.fromEntries(selectedKeys.map(k => [k, []]));
      const episodes = { floor: [], ceil: [] }, openEpisodes = new Map(), rosterFrames = [], targetJumps = [],
        anchorTrace = [], captureFrames = [], pollCorrectionJumps = [], orderViolations = [];
      let orderComparisons = 0;
      let validMovingIntervals = 0, saturatedIntervals = 0, payloadIndex = 0;
      const closeEpisode = key => {
        const ep = openEpisodes.get(key); if (!ep) return;
        episodes[ep.type].push(ep); openEpisodes.delete(key);
      };
      const ingest = (payload, epoch) => {
        state.simSec = trtcServiceSec(epoch); state.clockAtNow = true; freshen();
        const before = new Map(), hadPrior = pool().some(ln => ln._trtcBoard);
        if (hadPrior) for (const ln of pool()) for (const tr of ln._tt) if (freqTrainTime(tr, state.simSec) != null) {
          const pos = freqTrainPosAt(ln, tr, state.simSec); if (pos) before.set(keyOf(ln, tr), { pos, line: ln.id });
        }
        const audit = applyTrtcBoard(payload.rows, payload.at); freshen();
        const byKey = new Map(); for (const ln of pool()) for (const tr of ln._tt) byKey.set(keyOf(ln, tr), { ln, tr });
        if (hadPrior) for (const [key, hit] of byKey) {
          const prev = before.get(key); if (!prev || freqTrainTime(hit.tr, state.simSec) == null) continue;
          const pos = freqTrainPosAt(hit.ln, hit.tr, state.simSec); if (!pos) continue;
          pollCorrectionJumps.push({ slot: payload.slot, epoch, key, line: hit.ln.id,
            meters: round(haversineKm(prev.pos, pos) * 1000) });
        }
        rosterFrames.push({ slot: payload.slot, epoch, keys: [...byKey].filter(([, hit]) =>
          freqTrainTime(hit.tr, state.simSec) != null).map(([key]) => key).sort() });
        for (const a of audit.assignments || []) {
          if (!(a.run > 0)) continue;
          const hit = byKey.get(a.tripKey); if (!hit) continue;
          truths.set(a.tripKey, { slot: payload.slot, observedEpoch: epoch, from: a.from, to: a.to, run: a.run, arrSec: a.arrSec });
          if (curveSet.has(a.tripKey)) {
            const seq = typeof _trtcAnchorWarp !== 'undefined' ? _trtcAnchorWarp.get(a.tripKey) : null;
            anchorTrace.push({ slot: payload.slot, epoch, key: a.tripKey, event: a.scheduledEvent, arrSec: a.arrSec,
              shift: a.shift, target: targetOf(hit.ln, hit.tr).target,
              seq: seq ? JSON.parse(JSON.stringify(seq)) : null });
          }
        }
      };

      const start = payloads[0].at, end = payloads[payloads.length - 1].at + 15;
      ingest(payloads[payloadIndex++], start); _metroGateEp.at = performance.now() - 6000;
      for (let epoch = start; epoch <= end; epoch++) {
        if (epoch !== start) for (let tenth = 1; tenth <= 10; tenth++) {
          state.simSec = trtcServiceSec(epoch - 1 + tenth / 10); freshen();
          for (const e of _easedShift.values()) e.at -= 100;
          for (const ln of pool()) for (const tr of ln._tt)
            if (freqTrainTime(tr, state.simSec) != null) metroShiftSec(ln, tr);
        }
        state.simSec = trtcServiceSec(epoch); freshen();
        if (payloadIndex < payloads.length && epoch === payloads[payloadIndex].at) ingest(payloads[payloadIndex++], epoch);
        const seen = new Set(), orderGroups = new Map();
        for (const ln of pool()) for (const tr of ln._tt) {
          const roster = freqTrainTime(tr, state.simSec); if (roster == null) continue;
          const key = keyOf(ln, tr), tar = targetOf(ln, tr), sh = metroShiftSec(ln, tr);
          const priorTarget = previousTarget.get(key);
          if (priorTarget != null && Math.abs(tar.target - priorTarget) >= .5) {
            const jump = { key, line: ln.id, epoch, from: priorTarget, to: tar.target, delta: tar.target - priorTarget };
            lastJump.set(key, jump); targetJumps.push(jump);
          }
          previousTarget.set(key, tar.target);
          const tm = Math.max(tr[1], Math.min(tr[tr.length - 1], roster - sh));
          const anchored = typeof trtcBoardPosition === 'function' ? trtcBoardPosition(ln, tr, state.simSec) : null;
          const pos = freqTrainPosAt(ln, tr, state.simSec);
          const seg = anchored ? (() => {
            const d = ln.hasShape ? Math.abs(ln.stations[anchored.to].d - ln.stations[anchored.from].d)
              : haversineKm(ln.stations[anchored.from], ln.stations[anchored.to]);
            return { moving: anchored.moving, seg: `board:${anchored.from}>${anchored.to}`,
              nominalKmSec: anchored.run > 0 ? d / anchored.run : 0,
              ia: anchored.from, ib: anchored.to, run: anchored.run };
          })() : segmentAt(ln, tr, tm);
          const progress = progressOf(ln, tr, pos, seg);
          if (progress != null) {
            const dir = tr[0] <= tr[tr.length - 2] ? 1 : -1;
            const route = ln.id + '|' + dir + '|' + tr[0] + '>' + tr[tr.length - 2];
            let a = orderGroups.get(route); if (!a) orderGroups.set(route, a = []);
            a.push({ key, start: tr[1], progress, seg: seg.seg });
          }
          const prev = previous.get(key); let visualRate = null;
          if (prev && epoch - prev.epoch === 1 && prev.seg === seg.seg && prev.moving && seg.moving && seg.nominalKmSec > 0 && progress != null && prev.progress != null) {
            visualRate = (progress - prev.progress) / seg.nominalKmSec;
            validMovingIntervals++;
            let type = null;
            if (Math.abs(visualRate - floor) <= satEps) type = 'floor';
            else if (Math.abs(visualRate - ceil) <= satEps) type = 'ceil';
            const open = openEpisodes.get(key);
            if (!type) closeEpisode(key);
            else {
              saturatedIntervals++; seen.add(key);
              if (!open || open.type !== type || open.endEpoch !== epoch - 1) {
                closeEpisode(key);
                const jump = lastJump.get(key) || null;
                openEpisodes.set(key, { type, key, line: ln.id, startEpoch: epoch - 1, endEpoch: epoch,
                  durationSec: 1, target: tar.target, targetJump: jump, segment: seg.seg, segmentRunSec: seg.run });
              } else {
                open.endEpoch = epoch; open.durationSec++;
                const jump = lastJump.get(key);
                if (jump && (!open.targetJump || Math.abs(jump.delta) > Math.abs(open.targetJump.delta))) open.targetJump = jump;
              }
            }
          } else closeEpisode(key);
          previous.set(key, { epoch, progress, seg: seg.seg, moving: seg.moving, sh });

          const truth = truths.get(key), nowSec = state.simSec;
          if (truth && epoch >= truth.observedEpoch && nowSec >= truth.arrSec - truth.run && nowSec <= truth.arrSec && progress != null) {
            const expected = truthProgress(ln, tr, truth, nowSec, true), expectedLinear = truthProgress(ln, tr, truth, nowSec, false);
            const errorM = Math.abs(progress - expected) * 1000, linearErrorM = Math.abs(progress - expectedLinear) * 1000;
            const phase = Math.abs(sh - tar.target) > correctingEpsSec ? 'correcting' : 'steady';
            const rec = { id: `${truth.slot}|${key}|${epoch}|${truth.from}>${truth.to}`, key, line: ln.id, epoch,
              slot: truth.slot, errorM: round(errorM), linearErrorM: round(linearErrorM), phase,
              residualShiftSec: round(Math.abs(sh - tar.target), 3) };
            accuracy[phase].push(rec); accuracy.all.push(rec); sampleIds.push(rec.id);
            accuracyLinear[phase].push(rec); accuracyLinear.all.push(rec);
          }
          if (curveSet.has(key)) curves[key].push({ epoch, line: ln.id, target: tar.target, eased: round(sh, 3),
            progressKm: round(progress, 5), normalizedSpeed: round(visualRate, 4), moving: seg.moving, seg: seg.seg });
        }
        for (const [route, a] of orderGroups) {
          a.sort((x, y) => x.start - y.start);
          for (let i = 1; i < a.length; i++) {
            orderComparisons++;
            if (a[i].progress > a[i - 1].progress + .001)
              orderViolations.push({ epoch, route, front: a[i - 1], rear: a[i] });
          }
        }
        for (const key of [...openEpisodes.keys()]) if (!seen.has(key)) closeEpisode(key);
        if (captureSpec && captureSpec.epochs.includes(epoch)) {
          map.setView(captureSpec.center, captureSpec.zoom, { animate: false }); draw();
          let marked = null;
          for (const ln of pool()) for (const tr of ln._tt) if (keyOf(ln, tr) === captureSpec.key) {
            const roster = freqTrainTime(tr, state.simSec); if (roster == null) continue;
            const sh = metroShiftSec(ln, tr), pos = freqTrainPosAt(ln, tr, state.simSec);
            if (pos) marked = { pos, sh, target: targetOf(ln, tr).target };
          }
          const cv = document.getElementById('overlay');
          const out = document.createElement('canvas'); out.width = 560; out.height = 300;
          const oc = out.getContext('2d'); oc.fillStyle = '#f3f0e8'; oc.fillRect(0, 0, out.width, out.height);
          const centerPx = map.latLngToContainerPoint(captureSpec.center);
          oc.drawImage(cv, centerPx.x - out.width / 2, centerPx.y - out.height / 2, out.width, out.height, 0, 0, out.width, out.height);
          if (marked) {
            const p = map.latLngToContainerPoint(marked.pos), x = p.x - centerPx.x + out.width / 2, y = p.y - centerPx.y + out.height / 2;
            oc.save(); oc.strokeStyle = '#ff2d7a'; oc.lineWidth = 4; oc.beginPath(); oc.arc(x, y, 14, 0, Math.PI * 2); oc.stroke();
            oc.fillStyle = '#ff2d7a'; oc.font = '700 14px system-ui'; oc.textAlign = 'left'; oc.fillText('比較車', x + 19, y + 5); oc.restore();
          }
          captureFrames.push({ epoch, eased: marked ? round(marked.sh, 3) : null,
            target: marked ? round(marked.target, 3) : null, dataUrl: out.toDataURL('image/png') });
        }
      }
      for (const key of [...openEpisodes.keys()]) closeEpisode(key);
      const summarizeEpisodes = type => {
        const list = episodes[type], durations = list.map(x => x.durationSec), longest = list.slice().sort((a, b) => b.durationSec - a.durationSec)[0] || null;
        return { samples: list.reduce((n, x) => n + x.durationSec, 0), shareOfMovingTime: validMovingIntervals ? list.reduce((n, x) => n + x.durationSec, 0) / validMovingIntervals : 0,
          entries: list.length, entriesPerTrainMinute: validMovingIntervals ? list.length / (validMovingIntervals / 60) : 0,
          durationSec: distribution(durations), longest };
      };
      const accuracySummary = Object.fromEntries(Object.entries(accuracy).map(([k, list]) => [k, distribution(list.map(x => x.errorM))]));
      const accuracyLinearSummary = Object.fromEntries(Object.entries(accuracyLinear).map(([k, list]) => [k, distribution(list.map(x => x.linearErrorM))]));
      const curveWindows = {};
      for (const [key, list] of Object.entries(curves)) {
        let best = null;
        for (let i = 1; i < list.length; i++) {
          const delta = list[i].target - list[i - 1].target;
          if (!best || Math.abs(delta) > Math.abs(best.delta)) best = { epoch: list[i].epoch, from: list[i - 1].target, to: list[i].target, delta };
        }
        curveWindows[key] = { jump: best, points: best ? list.filter(x => x.epoch >= best.epoch - 5 && x.epoch <= best.epoch + 120) : [] };
      }
      // 用真實線形與站間秒，合成兩班同區間列車；後車的新倒數故意推到前車前方。
      // 驗證沿里程遞增、遞減兩方向都沿用 snapshot 的前後順序並擋在前車後方。
      const headwayChecks = [];
      if (typeof trtcHeadwayPosition === 'function') {
        const savedSim = state.simSec, savedGate = _mlGate, savedGateAt = _mlGateAt;
        for (const wantedDir of [1, -1]) {
          let hit = null;
          for (const ln of pool()) {
            if (!ln.hasShape) continue;
            for (let i = 0; i < ln.stations.length - 1; i++) {
              const a = ln.stations[i], b = ln.stations[i + 1], sign = Math.sign(b.d - a.d);
              if (sign === wantedDir) { hit = { ln, from: i, to: i + 1 }; break; }
              if (-sign === wantedDir) { hit = { ln, from: i + 1, to: i }; break; }
            }
            if (hit) break;
          }
          if (!hit) { headwayChecks.push({ direction: wantedDir, pass: false, reason: '找不到真實方向案例' }); continue; }
          const { ln, from, to } = hit, run = Math.max(60, Number(runBetween(ln, from, to)) || 120), sim = 43200;
          const frontElapsed = run * .70, rearElapsed = run * .80;
          const front = [from, sim - frontElapsed, to, sim - frontElapsed + run + 25];
          const rear = [from, sim - rearElapsed, to, sim - rearElapsed + run + 25];
          const km = Math.abs(ln.stations[to].d - ln.stations[from].d), profile = buildProfile(km, run,
            TRTC_BOARD_PERF.a, TRTC_BOARD_PERF.b, TRTC_BOARD_PERF.v);
          const savedBoard = ln._trtcBoard, savedTripMode = ln._trtcTripMode;
          ln._trtcTripMode = true; state.simSec = sim; _mlGate = true; _mlGateAt = Date.now();
          ln._trtcBoard = { at: Date.now(), all: 0, shifts: new Map([[front, 0], [rear, 0]]),
            positions: new Map([[front, { from, to, run, arrSec: front[1] + run, profile }],
              [rear, { from, to, run, arrSec: rear[1] + run, profile }]]),
            headways: new Map([[rear, { lead: front, km: .18 }]]) };
          const frontPos = freqTrainBaseAt(ln, front, sim).pos, rearRaw = freqTrainBaseAt(ln, rear, sim).pos;
          const rearPos = trtcHeadwayPosition(ln, rear, sim, rearRaw);
          const frontD = projectOntoShape(ln, frontPos.lat, frontPos.lon).d;
          const rawD = projectOntoShape(ln, rearRaw.lat, rearRaw.lon).d;
          const finalD = projectOntoShape(ln, rearPos.lat, rearPos.lon).d;
          const dir = Math.sign(ln.stations[to].d - ln.stations[from].d) || 1;
          const rawGapM = (frontD - rawD) * dir * 1000, finalGapM = (frontD - finalD) * dir * 1000;
          headwayChecks.push({ direction: wantedDir, line: ln.id,
            segment: (ln.stations[from].name || from) + '→' + (ln.stations[to].name || to),
            rawGapM: round(rawGapM), finalGapM: round(finalGapM), expectedGapM: 20,
            pass: rawGapM < 0 && finalGapM >= 19.5 });
          ln._trtcBoard = savedBoard; ln._trtcTripMode = savedTripMode;
        }
        state.simSec = savedSim; _mlGate = savedGate; _mlGateAt = savedGateAt;
      }
      return { accuracy: accuracySummary, accuracyLinear: accuracyLinearSummary, accuracyRecords: accuracy.all, accuracyExamples: {
        steady: accuracy.steady.slice().sort((a, b) => b.errorM - a.errorM).slice(0, 20),
        correcting: accuracy.correcting.slice().sort((a, b) => b.errorM - a.errorM).slice(0, 20),
      }, sampleIds: sampleIds.sort(), validMovingIntervals, saturatedIntervals,
      saturation: { floor: summarizeEpisodes('floor'), ceil: summarizeEpisodes('ceil') }, curves: curveWindows,
      targetJumps: { absDeltaSec: distribution(targetJumps.map(x => Math.abs(x.delta))),
        largest: targetJumps.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0] || null },
      pollCorrectionJumps: { meters: distribution(pollCorrectionJumps.map(x => x.meters)),
        largest: pollCorrectionJumps.slice().sort((a, b) => b.meters - a.meters)[0] || null },
      ordering: { comparisons: orderComparisons, violations: orderViolations.slice(0, 100), headwayChecks },
      rosterFrames, anchorTrace, captureFrames };
    }, { payloads, selectedKeys: SELECTED_KEYS, floor: FLOOR, ceil: CEIL, satEps: SAT_EPS,
      correctingEpsSec: CORRECTING_EPS_SEC, captureSpec });
    result.pageErrors = pageErrors;
    result.hash = sha256(indexHtml);
    result.root = root; result.label = label; result.engine = engineName;
    return result;
  } finally {
    await context.close(); await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

const currentHtml = fs.readFileSync(path.join(NEW_ROOT, 'index.html'), 'utf8');
const firstHtml = execFileSync('git', ['show', `${FIRST_COMMIT}:index.html`], { cwd: NEW_ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const positionOffHtml = currentHtml.replace('function trtcBoardPosition(ln, tr, simSec) {',
  'function trtcBoardPosition(ln, tr, simSec) {\n  return null; // ROUND2_MUTATION: 關掉倒數直算位置，退回 shift 模型');
const unguardedSnapHtml = currentHtml.replace(
  'const anchored = anchored0 && fallback && haversineKm(anchored0.pos, fallback) <= .025 ? anchored0 : null;',
  'const anchored = anchored0 && fallback ? anchored0 : null; // ROUND2_MUTATION: 無視平順接手門檻，倒數位置直接瞬移接管');
if (positionOffHtml === currentHtml || unguardedSnapHtml === currentHtml) throw new Error('ROUND2_MUTATION 注入失敗，原始碼標記已變更');

const output = { corpus: CORPUS, firstCommit: FIRST_COMMIT, truth: {
  description: '每個已配對實體錨點以 arrSec-run 為上站出發、arrSec 為下站到達；主口徑用獨立實作的 3.6/4.3 km/h/s、80km/h 停→停梯形換算沿線里程。只取 observedEpoch 之後且仍在該段內的秒。',
  retainedOldGate: '同一批樣本另保留線性站間真值（原 §1 判準），輸出在 accuracyLinear 與 commonLinearTruthPhaseByFirstModel；沒有為了讓梯形版本變綠而刪除舊結果。',
  independentBecause: '真值不呼叫產品的 buildProfile、profTimeToProg、freqTrainPosRaw，也不讀 eased/raw shift；只用官方絕對到站時刻、錨點 from/to、官方或班表段秒與軌道里程，並在驗收腳本內獨立解梯形方程。tripKey 僅確認實體錨點配到哪班。',
}, selectedKeys: SELECTED_KEYS, selectionRule: '沿用第一輪七條線的 witness；依其最大 |target 跳幅| 由大到小排序，事先取前四班，不看本輪準度結果。',
models: {}, comparisons: {}, mutations: {}, assertions: [] };

const rosterComparison = records => {
  const names = Object.keys(records), lead = records[names[0]].rosterFrames, mismatches = [];
  for (let i = 0; i < lead.length; i++) {
    for (const name of names.slice(1)) {
      const other = records[name].rosterFrames[i], a = lead[i], same = !!other && a.slot === other.slot &&
        a.keys.length === other.keys.length && a.keys.every((key, k) => key === other.keys[k]);
      if (!same) mismatches.push({ frame: i, reference: names[0], model: name, slot: a.slot,
        missing: a.keys.filter(key => !other?.keys.includes(key)).slice(0, 20),
        extra: (other?.keys || []).filter(key => !a.keys.includes(key)).slice(0, 20) });
    }
  }
  return { sameAtKeyLevel: !mismatches.length, frameCount: lead.length,
    frames: lead.map((frame, i) => ({ slot: frame.slot, epoch: frame.epoch, count: frame.keys.length,
      keyHash: sha256(frame.keys.join('\n')), modelCounts: Object.fromEntries(names.map(name => [name, records[name].rosterFrames[i]?.keys.length ?? null])) })),
    mismatches };
};
const phasePartition = (partition, records, field = 'errorM') => {
  const names = Object.keys(records), peers = Object.fromEntries(names.map(name => [name,
    new Map(records[name].accuracyRecords.map(x => [x.id, x]))]));
  const out = { steady: {}, correcting: {} };
  for (const phase of Object.keys(out)) for (const name of names) out[phase][name] = [];
  for (const rec of records[partition].accuracyRecords) for (const name of names) {
    const peer = peers[name].get(rec.id); if (peer) out[rec.phase][name].push(peer[field]);
  }
  return Object.fromEntries(Object.entries(out).map(([phase, values]) => [phase,
    Object.fromEntries(Object.entries(values).map(([name, list]) => [name, dist(list)]))]));
};

let port = PORT0;
for (const engine of ENGINES) {
  const records = {
    baseline: output.models[`baseline_${engine}`] = await replay(BASE_ROOT, 'baseline', engine, port++, null, engine === 'chromium' ? CAPTURE_SPEC : null),
    first: output.models[`first_${engine}`] = await replay(NEW_ROOT, 'first', engine, port++, firstHtml, engine === 'chromium' ? CAPTURE_SPEC : null),
    second: output.models[`second_${engine}`] = await replay(NEW_ROOT, 'second', engine, port++, currentHtml, engine === 'chromium' ? CAPTURE_SPEC : null),
  };
  const ids = Object.fromEntries(Object.entries(records).map(([name, rec]) => [name, rec.sampleIds]));
  const sameSamples = ids.baseline.length === ids.first.length && ids.first.length === ids.second.length &&
    ids.baseline.every((x, i) => x === ids.first[i] && x === ids.second[i]);
  const roster = rosterComparison(records);
  output.comparisons[engine] = { sameSamples,
    sampleCounts: Object.fromEntries(Object.entries(ids).map(([name, list]) => [name, list.length])),
    commonPhaseByFirstModel: phasePartition('first', records),
    commonLinearTruthPhaseByFirstModel: phasePartition('first', records, 'linearErrorM'),
    commonPhaseBySecondModel: phasePartition('second', records), roster };
  output.assertions.push({ pass: sameSamples, label: `${engine} 三欄真值取樣集合相同`,
    detail: `baseline=${ids.baseline.length}, first=${ids.first.length}, second=${ids.second.length}` });
  output.assertions.push({ pass: roster.sameAtKeyLevel, label: `${engine} 三欄逐 frame 名冊 key 完全一致`,
    detail: `frames=${roster.frameCount}, mismatches=${roster.mismatches.length}` });
  const headwayChecks = records.second.ordering.headwayChecks;
  output.assertions.push({ pass: headwayChecks.length === 2 && headwayChecks.every(x => x.pass),
    label: `${engine} 同區間前後順序在里程遞增／遞減兩方向都不被新倒數反轉`,
    detail: headwayChecks.map(x => `${x.direction > 0 ? '增' : '減'}:${x.rawGapM}m→${x.finalGapM}m`).join(', ') });
  output.assertions.push({ pass: records.second.ordering.violations.length === 0,
    label: `${engine} 語料回放同線同向列車零順序反轉`,
    detail: `comparisons=${records.second.ordering.comparisons}, violations=${records.second.ordering.violations.length}` });
}

for (const [name, html] of Object.entries({ position_off: positionOffHtml, unguarded_snap: unguardedSnapHtml }))
  output.mutations[name] = await replay(NEW_ROOT, `mutation_${name}`, 'chromium', port++, html);
const secondC = output.models.second_chromium, firstC = output.models.first_chromium;
for (const [name, rec] of Object.entries(output.mutations)) {
  const accuracyRed = (rec.accuracy.all.p90 || 0) > (secondC.accuracy.all.p90 || 0) + 50;
  const floorRed = (rec.saturation.floor.durationSec.max || 0) > (secondC.saturation.floor.durationSec.max || 0) + 30;
  const jumpRed = (rec.pollCorrectionJumps.meters.p90 || 0) > (secondC.pollCorrectionJumps.meters.p90 || 0) + 50;
  output.assertions.push({ pass: accuracyRed || floorRed || jumpRed, expectedFailure: true,
    label: `語意突變 ${name} 會被倒數直算位置驗收抓紅`, detail: `allP90=${rec.accuracy.all.p90}, second=${secondC.accuracy.all.p90}; floorMax=${rec.saturation.floor.durationSec.max}, second=${secondC.saturation.floor.durationSec.max}; pollJumpP90=${rec.pollCorrectionJumps.meters.p90}, second=${secondC.pollCorrectionJumps.meters.p90}` });
}
const selectedSpeedMax = rec => Math.max(...Object.values(rec.curves).flatMap(x => x.points.map(p => p.normalizedSpeed).filter(Number.isFinite)));
output.control = { baselineRedAgainstMotionFix: {
  pass: selectedSpeedMax(output.models.baseline_chromium) > 2.02 && selectedSpeedMax(firstC) <= 2.02,
  baselineSelectedMaxSpeed: selectedSpeedMax(output.models.baseline_chromium),
  firstSelectedMaxSpeed: selectedSpeedMax(firstC), secondSelectedMaxSpeed: selectedSpeedMax(secondC),
  note: '基準樹在事先選定的大跳樣本必須超過 2×，第一輪必須守住 2×；完整 A–D 控制另由 verify_trtc_motion.mjs 重跑。' } };

for (const rec of [...Object.values(output.models), ...Object.values(output.mutations)]) {
  delete rec.sampleIds; delete rec.accuracyRecords;
  rec.rosterFrames = rec.rosterFrames.map(frame => ({ slot: frame.slot, epoch: frame.epoch, count: frame.keys.length,
    keyHash: sha256(frame.keys.join('\n')) }));
}
fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
for (const a of output.assertions) console.log(`${a.pass ? '✅' : '❌'} ${a.label}：${a.detail}`);
for (const [name, rec] of Object.entries(output.models))
  console.log(`${name} accuracy=${JSON.stringify(rec.accuracy)} saturation=${JSON.stringify(rec.saturation)}`);
console.log(`輸出：${OUTPUT}`);
process.exit(output.assertions.every(x => x.pass) && output.control.baselineRedAgainstMotionFix.pass ? 0 : 1);
