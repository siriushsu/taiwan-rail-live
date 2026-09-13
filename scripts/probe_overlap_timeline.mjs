// 互穿案例的逐秒時間軸探針（診斷用，不是閘門）。
//
// 為什麼要另開一支：`verify_physical_no_overlap.mjs` 每 120 秒取樣一次、只回報「那一刻誰跟誰
// 共用股道」，看不出一場遭遇是怎麼發生的——兩車各自在哪一站停／過、模型回填的通過時刻是幾點、
// 誰先到交會點、hold 什麼時候開始頂。這支把指定的幾班車在指定視窗內逐秒（STEP 預設 1）記下：
// 車頭里程、所在 edge、停站旗標、runtime 站表索引、hold、以及兩兩共用股道公尺，並把 runtime 的
// 站表（含回填的通過站）與官方班表並排，讓「時間模型」與「進路」的責任分得開。
//
// 位置與判準跟閘門同源：位置只吃 `trainPos()`，佔用鍵是 edgeId＋edge 參數區間（同一套 occupancy）。
// hold 的演化也跟閘門一致：從 05:00 起以 STEP_REPLAY（預設 4 秒）連續重放到視窗起點，不 reset。
//
// 跑法：
//   TEST_DATE=2026-09-13 CASES='[{"from":"20:10","to":"20:40","trains":["141","143"]}]' \
//     node scripts/probe_overlap_timeline.mjs
//   可選 PORT=／STEP=（視窗內步長秒，預設 1）／STEP_REPLAY=（重放步長，預設 4）
//   FORMATION_PROBE=long 與閘門同義（只在瀏覽器換長編組）；OUT= 輸出 JSON 路徑；ENGINE=webkit。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5551);
const TEST_DATE = process.env.TEST_DATE;
if (!TEST_DATE || !/^\d{4}-\d{2}-\d{2}$/.test(TEST_DATE)) throw Error('TEST_DATE=YYYY-MM-DD 必填');
const STEP = Number(process.env.STEP || 1);
const STEP_REPLAY = Number(process.env.STEP_REPLAY || 4);
const DAY_START = 5 * 3600;
const toSec = v => { if (typeof v === 'number') return v; const [h, m, s] = String(v).split(':').map(Number); return h * 3600 + (m || 0) * 60 + (s || 0); };
const CASES = JSON.parse(process.env.CASES || '[]').map(c => ({ ...c, from: toSec(c.from), to: toSec(c.to), trains: c.trains.map(String) }))
  .sort((a, b) => a.from - b.from);
if (!CASES.length) throw Error('CASES 必填：[{"from":"HH:MM","to":"HH:MM","trains":["141","143"]}]');
const OUT = process.env.OUT || path.join(ROOT, 'output/probe-overlap-timeline.json');
const hhmmss = s => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(v => String(v).padStart(2, '0')).join(':');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));

const browser = await (process.env.ENGINE === 'webkit' ? webkit : chromium).launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
await ctx.addInitScript(() => { localStorage.setItem('trainmap-howto-seen', '1'); });
const page = await ctx.newPage();
const clockStart = new Date(TEST_DATE + 'T12:00:00+08:00');
await page.clock.install({ time: clockStart });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/api/delay-stats*', r => r.abort());
await page.route('**/*tra-live*', r => r.abort());
if (process.env.FORMATION_PROBE === 'long') {
  const source = readFileSync(path.join(ROOT, 'rail-3d/integration/formations.js'), 'utf8');
  const candidate = source.replace("commuter:unknown('emu800',repeat(3,20),2.9)", "commuter:estimated('emu800',repeat(8,20),2.9,'推估 8 節')").replace("chukuang:unknown('e200',[17,20,20],2.9)", "chukuang:estimated('e200',[17,...repeat(8,20)],2.9,'推估 9 節')");
  if (candidate === source) throw Error('長編組探針沒有改到受測編組');
  await page.route('**/rail-3d/integration/formations.js', r => r.fulfill({ contentType: 'text/javascript', body: candidate }));
}
await page.goto(`http://127.0.0.1:${PORT}/?g=all&scene=3d&lang=zh-TW&at=24.6,121.8&z=13&t=09:56`);
await page.waitForFunction(() => state.ready && state.trains?.length > 0 && window.railIslandPhysical, null, { timeout: 180000 });
await page.clock.pauseAt(new Date(clockStart.getTime() + 60000));

const setup = await page.evaluate(async () => {
  const F = await import('/rail-3d/integration/formations.js');
  const catalog = await (await fetch('/rail-3d/assets/blender-map-v1/manifest.json')).json();
  const models = new WeakMap();
  const modelOf = tr => { if (models.has(tr)) return models.get(tr); const f = F.formationFor({ systemId: tr.sys, typeName: tr.typeName, carName: tr.carName, stockId: specialOf(tr)?.stock?.id, branchId: specialOf(tr)?.branch?.id, namedId: specialOf(tr)?.named?.id }, 'actual'); const m = f ? F.assembleFormation(f, catalog) : null; models.set(tr, m); return m; };
  const occupancy = (route, chainageM, lenM) => {
    const d = route.path.d, s0 = Math.max(0, chainageM - lenM / 2), s1 = Math.min(route.path.length, chainageM + lenM / 2), res = new Map();
    for (let i = 0; i < route.edges.length && i < d.length - 1; i++) {
      const a = d[i], b = d[i + 1]; if (b <= s0 || a >= s1) continue;
      const e = route.edges[i], span = (b - a) || 1, wspan = Math.abs(e.b - e.a) || 1, lo0 = Math.min(e.a, e.b);
      const u0 = (Math.max(a, s0) - a) / span, u1 = (Math.min(b, s1) - a) / span;
      const t0 = (e.a + (e.b - e.a) * u0 - lo0) / wspan, t1 = (e.a + (e.b - e.a) * u1 - lo0) / wspan;
      const prev = res.get(e.edgeId), cur = [Math.min(t0, t1), Math.max(t0, t1), span];
      res.set(e.edgeId, prev ? [Math.min(prev[0], cur[0]), Math.max(prev[1], cur[1]), span] : cur);
    }
    return res;
  };
  const sharedMetres = (ra, rb) => { let m = 0; const keys = [];
    for (const [k, ta] of ra) { const tb = rb.get(k); if (!tb) continue;
      const ov = Math.min(ta[1], tb[1]) - Math.max(ta[0], tb[0]); if (ov > 1e-9) { m += ov * ta[2]; keys.push(k); } }
    return { m, keys }; };
  const scalars = o => { const r = {}; if (!o) return r; for (const [k, v] of Object.entries(o)) if (v === null || ['number', 'string', 'boolean'].includes(typeof v)) r[k] = v; return r; };
  window.__reset = () => { _blockHold.clear(); _blockGap.clear(); _blockPrevD.clear(); _blockCapped.clear(); _blockSim = null; };
  window.__step = (sec) => { state.playing = false; setSimSec(sec); updateBlockHolds(); };
  const find = nos => state.trains.filter(tr => tr.sys === 'tra_sched' && !tr.loop && nos.includes(String(tr.train)));
  // 一班車的靜態描述：runtime 站表（含回填）、編組、實體路徑摘要
  window.__describe = (nos) => find(nos).map(tr => {
    const m = modelOf(tr);
    const p = trainPosAt(tr, tr.stops[0].depSec + 1);
    return { no: String(tr.train), typeName: tr.typeName, carName: tr.carName, rday: tr._rday,
      lenM: m?.lengthM, formation: m?.id, parts: m?.parts?.length,
      stops: tr.stops.map((s, i) => ({ i, ...scalars(s) })),
      trainKeys: Object.keys(tr).filter(k => !['stops'].includes(k)),
      extra: scalars(Object.fromEntries(Object.entries(tr).filter(([k]) => /^rp|prof|obs|pass|derived|hold/i.test(k)))),
      routeKeys: p?.route ? Object.keys(p.route) : null, pathKeys: p?.route?.path ? Object.keys(p.route.path) : null,
      pathLength: p?.route?.path?.length, edges: p?.route?.edges?.length, edge0: p?.route?.edges?.[0] ? scalars(p.route.edges[0]) : null,
      posKeys: p ? Object.keys(p) : null };
  });
  window.__sample = (nos) => {
    const rows = [], occ = new Map();
    for (const tr of find(nos)) {
      const t = state.simSec;
      const p = trainPos(tr, t);
      const p0 = trainPosAt(tr, t - liveDelaySec(tr));
      const g = trainSeg(tr, t - liveDelaySec(tr) - blockHoldSec(tr));
      const m = modelOf(tr);
      const res = p?.physical && m ? occupancy(p.route, p.chainageM, m.lengthM) : null;
      if (res) occ.set(String(tr.train), res);
      const edgeAt = (route, ch) => { if (!route) return null; const d = route.path.d; for (let i = 0; i < route.edges.length && i < d.length - 1; i++) if (ch >= d[i] && ch <= d[i + 1]) return route.edges[i].edgeId; return null; };
      rows.push({ no: String(tr.train), physical: !!p?.physical, chainageM: p?.chainageM ?? null, chainageNoHoldM: p0?.chainageM ?? null,
        lat: p?.lat, lon: p?.lon, dwell: !!p?.dwell, stopIndex: p?.stopIndex ?? null, stop: p?.stopIndex != null ? tr.stops[p.stopIndex]?.name : null,
        edge: p?.route ? edgeAt(p.route, p.chainageM) : null, hold: +blockHoldSec(tr).toFixed(1),
        seg: g ? { i: g.i, dwell: g.dwell, f: g.f != null ? +(+g.f).toFixed(5) : null, d: g.d != null ? +(+g.d).toFixed(4) : null, dir: g.dir ?? null } : null,
        pathLength: p?.route?.path?.length ?? null });
    }
    const pairs = [];
    const ks = [...occ.keys()];
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const { m, keys } = sharedMetres(occ.get(ks[i]), occ.get(ks[j]));
      if (m > 0.01) pairs.push({ a: ks[i], b: ks[j], sharedM: +m.toFixed(1), edges: keys });
    }
    return { s: state.simSec, rows, pairs };
  };
  return { serviceDate: state.trains.find(t => t.sys === 'tra_sched' && !t.loop && !t.stops._prevNight)?._rday, physicalKeys: Object.keys(window.railIslandPhysical || {}) };
});
console.log(`服務日 ${setup.serviceDate}（要求 ${TEST_DATE}）; railIslandPhysical keys: ${setup.physicalKeys.join(',')}`);
if (setup.serviceDate !== TEST_DATE) throw Error('班表服務日與 TEST_DATE 不一致');

// 官方班表（回填前）給並排用
const official = JSON.parse(readFileSync(path.join(ROOT, 'data/tra_schedule.json'), 'utf8')).trains;
const officialOf = no => official.find(t => String(t.train) === no)?.stops?.map(s => ({ name: s.name, arrSec: s.arrSec, depSec: s.depSec })) || null;

await page.evaluate(([f]) => { __reset(); __step(f); }, [DAY_START]);
let cursor = DAY_START;
const results = [];
for (const c of CASES) {
  // 連續重放到視窗起點（hold 演化與閘門同源）
  if (c.from > cursor) {
    await page.evaluate(([from, to, step]) => { for (let s = from + step; s <= to; s += step) __step(s); }, [cursor, c.from, STEP_REPLAY]);
    cursor = c.from;
  }
  const describe = await page.evaluate(nos => __describe(nos), c.trains);
  const samples = await page.evaluate(([from, to, step, nos]) => { const out = []; for (let s = from; s <= to; s += step) { __step(s); out.push(__sample(nos)); } return out; }, [c.from, c.to, STEP, c.trains]);
  cursor = c.to;
  // 共用股道區間摘要
  const intervals = new Map();
  for (const smp of samples) for (const p of smp.pairs) {
    const k = p.a + '/' + p.b; const cur = intervals.get(k);
    if (cur && smp.s - cur.end <= STEP) { cur.end = smp.s; cur.max = Math.max(cur.max, p.sharedM); cur.n++; }
    else { const list = intervals.get(k + '#list') || []; list.push({ start: smp.s, end: smp.s, max: p.sharedM, n: 1 }); intervals.set(k + '#list', list); intervals.set(k, list[list.length - 1]); }
  }
  const summary = [...intervals.entries()].filter(([k]) => k.endsWith('#list')).map(([k, list]) => ({ pair: k.replace('#list', ''), intervals: list.map(v => ({ start: hhmmss(v.start), end: hhmmss(v.end), secs: v.end - v.start + STEP, maxSharedM: v.max })) }));
  results.push({ from: hhmmss(c.from), to: hhmmss(c.to), trains: c.trains, describe: describe.map(d => ({ ...d, official: officialOf(d.no) })), summary, samples });
  console.log(`\n=== 視窗 ${hhmmss(c.from)}–${hhmmss(c.to)} ${c.trains.join('/')}`);
  for (const d of describe) console.log(`  ${d.no} ${d.typeName} ${d.carName} 編組=${d.formation} ${d.lenM}m 站表 ${d.stops.length} 站（官方 ${officialOf(d.no)?.length ?? '?'} 站） 路徑 ${d.pathLength?.toFixed?.(0)}m/${d.edges} edges`);
  for (const s of summary) for (const iv of s.intervals) console.log(`  共用股道 ${s.pair}: ${iv.start}–${iv.end}（${iv.secs}s，最大 ${iv.maxSharedM}m）`);
  if (!summary.length) console.log('  （視窗內無共用股道）');
}
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ serviceDate: TEST_DATE, step: STEP, stepReplay: STEP_REPLAY, formationProbe: process.env.FORMATION_PROBE || 'production', errors, cases: results }, null, 1));
console.log(`\n寫入 ${OUT}${errors.length ? `；頁面例外 ${errors.length} 筆：${errors[0]}` : ''}`);
await browser.close();
server.close();
