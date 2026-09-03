// 高捷 KR／KO 匿名看板逐班綁定驗收。
// 1. 以正式平日時刻表合成 07:00–09:00 尖峰訊號，注入分鐘量化、漏站、異常列與斷訊。
// 2. 若提供 KRTC_FIXTURE，重播實際 /api/metro-live?sys=krtc 多輪快照。
// 測試直接呼叫 index.html 的正式函式，不維護另一套影子演算法。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEngineMatrix } from './lib/engine_matrix.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 5192);
const SEEDS = +(process.env.SEEDS || 20);
const FIXTURE = process.env.KRTC_FIXTURE || '';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json' };

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname.startsWith('/api/')) { res.statusCode = 404; return res.end('offline verify'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  if (path.extname(fp) === '.html') return res.end(readFileSync(fp, 'utf8').replace(/\s+integrity="[^"]+"/g, ''));
  res.end(readFileSync(fp));
});
await new Promise(resolve => server.listen(PORT, resolve));

const matrix = await runEngineMatrix(async ({ engineUrl, check: matrixCheck }) => {
const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass });
  matrixCheck(pass, name, detail);
}
const browser = await chromium.launch();
try {
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
await page.route('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', r =>
  r.fulfill({ path: path.join(ROOT, 'app/node_modules/leaflet/dist/leaflet.js'), contentType: 'text/javascript' }));
await page.route('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css', r =>
  r.fulfill({ path: path.join(ROOT, 'app/node_modules/leaflet/dist/leaflet.css'), contentType: 'text/css' }));
await page.addInitScript(() => {
  localStorage.setItem('trainmap-howto-seen', '1');
  localStorage.setItem('trainmap-appearance', 'light');
});
await page.goto(engineUrl(`http://localhost:${PORT}/`), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof state !== 'undefined' && state.ready && state.systems &&
  state.systems.some(s => s.id === 'krtc' && s.data), null, { timeout: 30000 });

const synthetic = await page.evaluate(({ seeds }) => {
  loadSystem(state.systems.find(s => s.id === 'krtc'));
  state.ready = false;
  const lines = state.lines.filter(ln => ln.id === 'KR' || ln.id === 'KO');
  const out = { lines: {}, wrong: 0, matched: 0, skipped: 0, ghosts: 0,
    minGap: Infinity, lifecycle: [], smooth: null, duplicate: null };
  const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y);
    return s.length ? s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] : Infinity; };
  function rngOf(seed) { let x = seed >>> 0; return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; }; }
  function reset() {
    _krtcTripLive.clear(); _krtcSourceByLine.clear(); _easedShift.clear();
    for (const ln of lines) {
      delete ln._liveShift; delete ln._evIdx; delete ln._evIdxTT;
      delete ln._krtcTripIdx; delete ln._krtcTripIdxTT;
    }
  }
  function infos(ln) { return ln._tt.map(tr => { const n = tr.length;
    return { tr, key: krtcTripKey(ln, tr), dir: tr[0] <= tr[n - 2] ? 1 : -1,
      start: tr[1], term: tr[n - 2] }; }); }
  function rowsAt(ln, roster, delay, now, rnd) {
    const rows = [];
    for (let si = 0; si < ln.stations.length; si++) for (const dir of [1, -1]) {
      let best = null;
      for (const x of roster) {
        if (x.dir !== dir || si === x.term) continue;
        let k = -1;
        for (let p = 0; p < x.tr.length; p += 2) if (x.tr[p] === si) { k = p; break; }
        if (k < 0) continue;
        const actual = x.tr[k + 1] + delay.get(x.key);
        if (actual < now || actual - now > 35 * 60) continue;
        if (!best || actual < best.actual) best = { ...x, actual };
      }
      if (!best || rnd() < .20) continue;
      const roll = rnd(), st = roll < .035 ? 2 : roll < .07 ? 1 : 0;
      rows.push({ op: 'KRTC', l: ln.id === 'KR' ? 'R' : 'O', s: ln.stations[si].name,
        d: ln.stations[best.term].name, e: Math.max(0, Math.floor((best.actual - now) / 60)),
        st, _truth: best.key });
    }
    return rows;
  }
  function auditOrder(ln, nowAbs) {
    for (const events of buildKrtcTripIdx(ln).byStop.values()) {
      let prev = null;
      for (const ev of events) {
        const live = krtcTripLive(ln, ev.tr, nowAbs);
        const actual = ev.t + (live ? live.target : krtcLineShift(ln, ev.dir));
        if (prev != null) out.minGap = Math.min(out.minGap, actual - prev);
        prev = actual;
      }
    }
  }
  for (const ln of lines) out.lines[ln.id] = { trips: ln._tt.length, accepted: 0, pending: 0, errors: [], targetErrors: [] };
  for (let seed = 1; seed <= seeds; seed++) {
    reset();
    const rnd = rngOf(seed * 2654435761), rosters = new Map(lines.map(ln => [ln, infos(ln)]));
    const local = new Map(), delay = new Map();
    for (const roster of rosters.values()) for (const x of roster) local.set(x.key, (rnd() - .5) * 30);
    let common = (rnd() - .5) * 40;
    const baseAbs = Date.UTC(2026, 7, 20) + seed * 86400e3;
    for (let poll = 0; poll <= 60; poll++) {
      const now = 7 * 3600 + poll * 120, nowAbs = baseAbs + poll * 120e3;
      common = Math.max(-45, Math.min(105, common + (rnd() - .5) * 18));
      for (const roster of rosters.values()) for (const x of roster) {
        const localDelay = Math.max(-40, Math.min(40, (local.get(x.key) || 0) + (rnd() - .5) * 12));
        local.set(x.key, localDelay);
        const wave = poll >= 24 && poll <= 34 && x.start >= 7.6 * 3600 && x.start <= 8.4 * 3600
          ? (1 - Math.abs(poll - 29) / 5) * 120 : 0;
        delay.set(x.key, Math.round(common + localDelay + wave));
      }
      if (poll === 20 || poll === 21) continue;
      const rows = [];
      for (const [ln, roster] of rosters) rows.push(...rowsAt(ln, roster, delay, now, rnd));
      const reports = applyMetroLive('krtc', rows, now, nowAbs, nowAbs);
      for (const rep of reports) {
        const lr = out.lines[rep.ln]; lr.accepted += rep.accepted; lr.pending += rep.pending;
        for (const a of rep.assignments) {
          if (!a.key || !a.committed) { out.skipped++; continue; }
          out.matched++;
          if (a.truth !== a.key) { out.wrong++; lr.errors.push({ seed, poll, truth: a.truth, got: a.key }); }
        }
      }
      for (const [ln, roster] of rosters) {
        auditOrder(ln, nowAbs);
        const valid = new Set(roster.map(x => x.key));
        for (const key of _krtcTripLive.keys()) if (key.startsWith('krtc:' + ln.id + ':') && !valid.has(key)) out.ghosts++;
        for (const x of roster) {
          const live = krtcTripLive(ln, x.tr, nowAbs);
          if (live) out.lines[ln.id].targetErrors.push(Math.abs(live.target - delay.get(x.key)));
        }
      }
    }
  }
  // 同一份 source 快照不能把 pending 連續確認兩次。
  reset();
  const sampleLn = lines[0], sampleRoster = infos(sampleLn), delays = new Map(sampleRoster.map(x => [x.key, 0]));
  const rnd = () => .99, rows = rowsAt(sampleLn, sampleRoster, delays, 8 * 3600, rnd), token = Date.UTC(2026, 7, 20, 0);
  const first = applyMetroLive('krtc', rows, 8 * 3600, token, token);
  const second = applyMetroLive('krtc', rows, 8 * 3600, token, token);
  out.duplicate = { first: first[0], second: second[0] };
  // 兩方向末段都依班表最後一段的真實時長退場，不套固定 45 秒。
  reset();
  for (const ln of lines) for (const dir of [1, -1]) {
    const tr = ln._tt.find(t => (t[0] <= t[t.length - 2] ? 1 : -1) === dir && t[1] >= 7 * 3600 && t[t.length - 1] <= 10 * 3600);
    const n = tr.length, first = tr[1], prev = tr[n - 3], last = tr[n - 1];
    out.lifecycle.push({ line: ln.id, dir, span: last - prev,
      run: runBetween(ln, tr[n - 4], tr[n - 2]),
      pass: !freqTrainPosRaw(ln, tr, first - 1) && !!freqTrainPosRaw(ln, tr, first) &&
        !!freqTrainPosRaw(ln, tr, prev + 1) && !!freqTrainPosRaw(ln, tr, last - 1) &&
        !freqTrainPosRaw(ln, tr, last + 1) && last - prev > 45 });
  }
  // 正式 easedShift 運動上限：有效列車時鐘不可倒退，每秒也不可前進超過 2 秒。
  _easedShift.clear(); state.simSec = 30000;
  const gate = { on: true, ep: 1, at: -1e9 }, motion = metroMotion(lines[0]);
  let prevEff = state.simSec - easedShift('krtc-stress-smooth', 180, gate, motion), reverse = 0, jump = 0;
  for (let i = 0; i < 900; i++) {
    state.simSec++;
    const sh = easedShift('krtc-stress-smooth', i < 400 ? 180 : -120, gate, motion), eff = state.simSec - sh;
    if (eff + 1e-9 < prevEff) reverse++;
    if (eff - prevEff > 2.001) jump++;
    prevEff = eff;
  }
  out.smooth = { reverse, jump };
  for (const lr of Object.values(out.lines)) {
    lr.p95 = pct(lr.targetErrors, .95); delete lr.targetErrors;
  }
  return out;
}, { seeds: SEEDS });

for (const id of ['KR', 'KO']) {
  const r = synthetic.lines[id];
  check(`${id} 使用完整平日班表`, r.trips > 250, `trips=${r.trips}`);
  check(`${id} 匿名看板身份零錯配`, r.errors.length === 0, `錯配=${r.errors.length}`);
  check(`${id} 逐班偏移 P95 ≤ 90 秒`, r.p95 <= 90, `P95=${r.p95}s`);
  check(`${id} 尖峰有足夠逐班綁定`, r.accepted > 100, `accepted=${r.accepted} pending=${r.pending}`);
}
check('合成尖峰不產生幽靈身份', synthetic.ghosts === 0, `ghosts=${synthetic.ghosts}`);
check('相鄰班不交換／不超車', synthetic.minGap >= 45, `最小班距=${synthetic.minGap}s`);
check('位置校正不倒退、不大幅前跳', synthetic.smooth.reverse === 0 && synthetic.smooth.jump === 0, JSON.stringify(synthetic.smooth));
check('KR／KO 兩方向末段依真實路段時間退場', synthetic.lifecycle.length === 4 && synthetic.lifecycle.every(x => x.pass), JSON.stringify(synthetic.lifecycle));
check('相同上游快照不重複確認', synthetic.duplicate.second && synthetic.duplicate.second.duplicate === true && synthetic.duplicate.second.accepted === 0);

if (FIXTURE) {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const live = await page.evaluate(({ snapshots }) => {
    const lines = state.lines.filter(ln => ln.id === 'KR' || ln.id === 'KO');
    _krtcTripLive.clear(); _krtcSourceByLine.clear(); _easedShift.clear();
    for (const ln of lines) { delete ln._liveShift; delete ln._evIdx; delete ln._evIdxTT; delete ln._krtcTripIdx; delete ln._krtcTripIdxTT; }
    const out = { KR: [], KO: [] }, baseAbs = Date.now() - snapshots.length * 120e3;
    snapshots.forEach((snap, i) => {
      const source = Date.parse(snap.sourceAt), d = new Date(source + 8 * 3600e3);
      const atSec = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
      const reports = applyMetroLive('krtc', snap.rows, atSec, baseAbs + i * 120e3, source);
      for (const id of ['KR', 'KO']) {
        const ln = lines.find(x => x.id === id), rep = reports.find(x => x.ln === id) || { accepted: 0, pending: 0, assignments: [] };
        let minGap = Infinity, maxResid = 0;
        for (const a of rep.assignments) if (a.resid != null) maxResid = Math.max(maxResid, a.resid);
        for (const events of buildKrtcTripIdx(ln).byStop.values()) {
          let prev = null;
          for (const ev of events) {
            const live = krtcTripLive(ln, ev.tr, baseAbs + i * 120e3);
            const actual = ev.t + (live ? live.target : krtcLineShift(ln, ev.dir));
            if (prev != null) minGap = Math.min(minGap, actual - prev);
            prev = actual;
          }
        }
        out[id].push({ accepted: rep.accepted, pending: rep.pending, minGap, maxResid,
          rows: snap.rows.filter(r => r.op === 'KRTC' && r.l === (id === 'KR' ? 'R' : 'O')).length,
          shift: ln._liveShift && { f: ln._liveShift.f, b: ln._liveShift.b, all: ln._liveShift.all } });
      }
    });
    return out;
  }, { snapshots: fixture.snapshots });
  for (const id of ['KR', 'KO']) {
    const rounds = live[id];
    check(`${id} 真實尖峰每輪都有逐站資料`, rounds.every(x => x.rows >= 20), rounds.map(x => x.rows).join(','));
    check(`${id} 真實尖峰有提交逐班身份`, rounds.reduce((n, x) => n + x.accepted, 0) > 0, `accepted=${rounds.reduce((n, x) => n + x.accepted, 0)}`);
    check(`${id} 真實尖峰不交換順序`, rounds.every(x => x.minGap >= 45), `min=${Math.min(...rounds.map(x => x.minGap))}s`);
    check(`${id} 真實尖峰殘差在門檻內`, rounds.every(x => x.maxResid <= 105), `max=${Math.max(...rounds.map(x => x.maxResid))}s`);
    check(`${id} 線級相位沒有落到下一班`, rounds.every(x => !x.shift ||
      (x.shift.f == null || x.shift.f >= -90) && (x.shift.b == null || x.shift.b >= -90)),
      rounds.map(x => JSON.stringify(x.shift)).join(' / '));
  }
}

check('瀏覽器執行無未捕捉錯誤', pageErrors.length === 0, pageErrors.join(' | '));
console.log(`總配對 ${synthetic.matched}、保守略過 ${synthetic.skipped}、錯配 ${synthetic.wrong}；seeds=${SEEDS}`);
} finally {
  await browser.close();
}
});
await new Promise(resolve => server.close(resolve));
if (!matrix.passed) process.exitCode = 1;
