#!/usr/bin/env node
// 全捷運／輕軌運動驗收：完全封鎖 live API，先驗純班表站間不會無故停住；
// 再對每條線注入同一組校正階梯，驗證有效時間速度恆在 0.25×–2×。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.resolve(process.env.METRO_MOTION_OUTPUT || path.join(ROOT, 'CODEX-全捷運運動-驗收.json'));
const PORT0 = Number(process.env.METRO_MOTION_PORT || 6460);
const ENGINES = (process.env.ENGINES || 'chromium,webkit').split(',').filter(Boolean);
const EXPECTED_SYSTEMS = ['mrt', 'tymc', 'ntdlrt', 'ntalrt', 'sanying', 'tmrt', 'krtc'];
const leafletRoot = process.env.TRTC_LEAFLET_DIST || '/tmp/trtc-playwright-deps/node_modules/leaflet/dist';
const leafletJs = fs.readFileSync(path.join(leafletRoot, 'leaflet.js'));
const leafletCss = fs.readFileSync(path.join(leafletRoot, 'leaflet.css'));
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

const currentHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\s+integrity="[^"]+"/g, '');
const oldDefaultHtml = currentHtml.replace('    METRO_MOTION_PROFILE);',
  '    (tr && ln._trtcTripMode ? TRTC_MOTION_PROFILE : null)); // MUTATION: 非北捷退回舊 0×／無界追回');
if (oldDefaultHtml === currentHtml) throw new Error('全捷運 motion profile 突變沒有命中');

function serve(port, html) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${port}/`);
    if (u.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ rows: [], trains: [], list: [], src: null, boardPos: null })); return;
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
  await page.waitForFunction(ids => ids.every(id => state.systems.some(s => s.id === id && s.data && s._times)),
    EXPECTED_SYSTEMS, { timeout: 30000 });
}

async function replay(label, engineName, port, html) {
  const server = await serve(port, html);
  const launcher = engineName === 'webkit' ? webkit : chromium;
  const browser = await launcher.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = []; page.on('pageerror', e => pageErrors.push(String(e)));
  try {
    await prepare(page, port);
    const result = await page.evaluate(expectedSystems => {
      const round = (n, d = 4) => Number.isFinite(n) ? +n.toFixed(d) : null;
      const g = GROUPS.find(x => x.id === 'metro');
      state.freqSel = new Set(expectedSystems); state.mode = 'freq'; state.sys = null; state.sysId = 'metro';
      rebuildFreqLines(g); recomputeTrains();
      _trtcPolling = true; _easedShift.clear();
      for (const ln of state.lines) { delete ln._trtcBoard; delete ln._liveShift; ln._trtcTripMode = false; }

      const pure = [];
      for (const ln of state.lines) {
        const dirs = new Map();
        for (const tr of ln._tt || []) {
          const dir = Math.sign(ln.stations[tr[tr.length - 2]].d - ln.stations[tr[0]].d) || 1;
          if (!dirs.has(dir)) dirs.set(dir, tr);
        }
        const metric = { system: ln._sys, line: ln.id, directions: [...dirs.keys()], movingSteps: 0,
          stalls: [], backwards: [], maxKmh: 0, trapezoidSegments: 0, linearFallbackSegments: 0 };
        for (const [dir, tr] of dirs) {
          for (let k = 0; k + 3 < tr.length; k += 2) {
            const ia = tr[k], ib = tr[k + 2], ta = tr[k + 1], tb = tr[k + 3], span = tb - ta;
            const run = runBetween(ln, ia, ib), moveT = run && run < span ? run : span;
            if (!(moveT > 2)) continue;
            let segDir = Math.sign(ln.stations[ib].d - ln.stations[ia].d) || dir;
            if (ln.loop) {
              const L = ln.loopLen || ln.cum[ln.cum.length - 1], da = ln.stations[ia].d, db = ln.stations[ib].d;
              const fwd = ((db - da) % L + L) % L, bwd = ((da - db) % L + L) % L;
              segDir = fwd <= bwd ? 1 : -1;
            }
            const step = Math.max(1, Math.floor(moveT / 90));
            let prev = null;
            for (let elapsed = 0; elapsed <= moveT; elapsed = Math.min(moveT, elapsed + step)) {
              const pos = freqTrainPosRaw(ln, tr, ta + elapsed);
              const p = pos && projectOntoShape(ln, pos.lat, pos.lon);
              if (prev && p && p.d != null) {
                const dt = elapsed - prev.elapsed, deltaKm = (p.d - prev.d) * segDir;
                const visualMeters = haversineKm(prev.pos, pos) * 1000;
                metric.movingSteps++;
                // 環線首尾是同一地理點，最近投影可在 d=0／d=L 間跳 22km；視覺停死仍由座標位移照常驗。
                if (!ln.loop && deltaKm < -.001) metric.backwards.push({ dir: segDir, from: ia, to: ib, elapsed, meters: round(deltaKm * 1000) });
                if (elapsed < moveT && visualMeters < .001) metric.stalls.push({ dir: segDir, from: ia, to: ib, elapsed, dt, visualMeters: round(visualMeters, 6) });
                metric.maxKmh = Math.max(metric.maxKmh, deltaKm / dt * 3600);
              }
              if (p && p.d != null) prev = { elapsed, d: p.d, pos };
              if (elapsed === moveT) break;
            }
            const profile = ln._metroProfiles && ln._metroProfiles.get(ia + '>' + ib + '@' + moveT);
            if (profile) metric.trapezoidSegments++; else metric.linearFallbackSegments++;
          }
        }
        metric.maxKmh = round(metric.maxKmh);
        pure.push(metric);
      }

      const correction = [];
      for (const ln of state.lines) {
        const tr = (ln._tt || []).find(x => x.length >= 4);
        if (!tr) { correction.push({ system: ln._sys, line: ln.id, skipped: 'no trip' }); continue; }
        delete ln._trtcBoard; ln._trtcTripMode = false; _easedShift.clear();
        _mlGate = true; _mlGateAt = Date.now(); _metroGateEp.on = true; _metroGateEp.ep++;
        _metroGateEp.at = performance.now() - 6000;
        let sim = tr[1] + 60, prevEff = null;
        state.simSec = sim;
        const setTarget = target => {
          ln._liveShift = { f: target, b: target, all: target, at: Date.now(), n: 8, src: 'fixture' };
        };
        setTarget(0); metroShiftSec(ln, tr);
        const rates = [], phases = [];
        for (const [phase, target] of [['delay', 240], ['advance', -240], ['settle', 0]]) {
          setTarget(target);
          for (let i = 0; i < 80; i++) {
            sim += .1; state.simSec = sim;
            for (const e of _easedShift.values()) e.at -= 100;
            const sh = metroShiftSec(ln, tr), eff = sim - sh;
            if (prevEff != null) { const rate = (eff - prevEff) / .1; rates.push(rate); phases.push({ phase, i, rate, sh, sim }); }
            prevEff = eff;
          }
        }
        const finite = rates.filter(Number.isFinite);
        correction.push({ system: ln._sys, line: ln.id, direction: tr[0] <= tr[tr.length - 2] ? 1 : -1,
          samples: finite.length, minRate: round(Math.min(...finite)), maxRate: round(Math.max(...finite)),
          belowFloor: phases.filter(x => x.rate < .249).length, aboveCeil: phases.filter(x => x.rate > 2.001).length,
          badSamples: phases.filter(x => x.rate < .249 || x.rate > 2.001).map(x => ({ ...x, rate: round(x.rate), sh: round(x.sh), sim: round(x.sim) })).slice(0, 12) });
        delete ln._liveShift;
      }
      return { pure, correction, systems: [...new Set(state.lines.map(ln => ln._sys))].sort(),
        lines: state.lines.length, pageBuild: typeof BUILD === 'string' ? BUILD : null };
    }, EXPECTED_SYSTEMS);
    result.label = label; result.engine = engineName; result.pageErrors = pageErrors;
    return result;
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

const output = { expectedSystems: EXPECTED_SYSTEMS, models: {}, assertions: [] };
let port = PORT0;
for (const engine of ENGINES)
  output.models[`current_${engine}`] = await replay('current', engine, port++, currentHtml);
output.models.mutation_chromium = await replay('old-default-mutation', 'chromium', port++, oldDefaultHtml);

for (const engine of ENGINES) {
  const rec = output.models[`current_${engine}`];
  const missing = EXPECTED_SYSTEMS.filter(x => !rec.systems.includes(x));
  const pureBad = rec.pure.filter(x => x.stalls.length || x.backwards.length);
  const correctionBad = rec.correction.filter(x => !x.skipped && (x.belowFloor || x.aboveCeil));
  output.assertions.push({ pass: !missing.length, label: `${engine} 七個捷運／輕軌系統全覆蓋`,
    detail: `systems=${rec.systems.join(',')}, lines=${rec.lines}` });
  output.assertions.push({ pass: !pureBad.length, label: `${engine} 關閉所有 live API 後，純班表站間零停死／零倒退`,
    detail: `movingSteps=${rec.pure.reduce((n,x)=>n+x.movingSteps,0)}, bad=${pureBad.map(x=>x.system+':'+x.line).join(',')||'none'}` });
  output.assertions.push({ pass: !correctionBad.length, label: `${engine} 所有線的 live 校正速度皆在 0.25×–2×`,
    detail: `lines=${rec.correction.length}, bad=${correctionBad.map(x=>x.system+':'+x.line).join(',')||'none'}` });
  output.assertions.push({ pass: rec.pageErrors.length === 0, label: `${engine} 頁面零例外`, detail: rec.pageErrors.join(' | ') || 'none' });
}
const danhaiMutation = output.models.mutation_chromium.correction.filter(x => x.system === 'ntdlrt');
output.assertions.push({ pass: danhaiMutation.length > 0 && danhaiMutation.some(x => x.belowFloor || x.aboveCeil),
  expectedFailure: true, label: '控制組：淡海輕軌退回舊預設必須重現停住／衝刺',
  detail: JSON.stringify(danhaiMutation) });

fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
for (const a of output.assertions) console.log(`${a.pass ? '✅' : '❌'} ${a.label}：${a.detail}`);
for (const [name, rec] of Object.entries(output.models))
  console.log(`${name}: ${rec.pure.map(x => `${x.system}:${x.line} steps=${x.movingSteps} stalls=${x.stalls.length} back=${x.backwards.length} trap=${x.trapezoidSegments}/${x.trapezoidSegments+x.linearFallbackSegments}`).join(' | ')}`);
console.log(`輸出：${OUTPUT}`);
process.exit(output.assertions.every(x => x.pass) ? 0 : 1);
