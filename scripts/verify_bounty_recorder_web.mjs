// 路段懸賞 · 錄程端（index.html，App 的 WebView 跑的就是這一份）驗收——Playwright 真引擎（無視窗 Chromium）＋ node 靜態伺服器。
//
// 第十四批（第九輪獨立驗收 E1、E-2(b)）：沒有都卜勒速度、沒有精度的裝置，定位回呼給的是 null。舊版用 Number(x) 判，
// Number(null) 是 0——null 一路被洗成「速度 0＝停著」「精度 0 m＝很準」送上伺服器；錄製中的停靠進度也把 null 當 0，
// 高速通過的站全都亮成「停到了」。伺服器端第十三批已不把 null 當 0、第十四批的停靠判定改用位置微分，這一支驗前端跟上：
//   C  bountyCleanSample（存檔、重新整理後還原、鎖線時整批重洗都走它）：v、acc 是 null → 仍是 null；0 → 0；數字照收；
//      存檔再讀回（bountyPersistRecording → bountyLoadPersistedRecording）之後 null 也還是 null。
//   F  bountyOnFix（定位回呼）：speed、accuracy 是 null → 存 null；speed −1（iOS 沒有有效速度）→ null；accuracy −1（iOS 的無效定位）→ null；
//      0 → 0；12.345 → 12.35、8.6 → 9。
//   D  bountyUpdateDwellProgress（錄製中的停靠進度）與 Worker coverageOf() 同一條：沒有速度的裝置真的停靠 60 秒 → 亮；
//      沒有速度、30 m/s 高速通過 → 不亮、而且判「錯過」（兩側都過完了）；對照：有速度（停的時候 0）的同一趟 → 亮。兩個方向。
//      第十五批（第十輪獨立驗收 P1-2）：速度送 0（Android 沒有速度時送 0.0）或 0.3、30 m/s 通過 → 不亮且判錯過（位置微分超過 10 m/s 否決回報的低速）；
//      送 0 的真停靠 → 亮。設定檔少了 posSpeedVetoMps、或它不大於 stopSpeedMaxMps → 丟 dwell rules unavailable（跟 Worker 一樣直接中止）。
//   X  （第十五批，第十輪獨立驗收 P2-8）同一批點同時餵前端 bountyUpdateDwellProgress 與 Worker coverageOf（node 端 import worker.js），
//      逐站比「算不算停靠」：Worker 用它正式讀的 data/bounty_units.json 的山線站表，前端用它自己的 lineNetwork()（data/tra.json）。
//      山線連續四站、六種停法（停 45 秒、GPS 晃 ±0.3 或 ±2 m／20 m/s 通過／8、10、10.5 m/s 慢速通過）× 五種速度欄（都卜勒、null、全送 0、全送 0.3、一半 null）× 兩個方向。
//      位置一律錨在整數公尺、速度取 0.5 的倍數（位置微分在二進位下精確），剛好 10 m/s 的那一站才比得出否決門檻的「＞」與「≥」。
//   Y  （第十一輪獨立驗收 H）換版之後重新整理，bountyRules() 要拿到新的規則檔，不能吃瀏覽器快取裡的舊版。舊寫法是 force-cache：
//      快取裡有就直接用、不回伺服器驗證——上一版的規則檔沒有 posSpeedVetoMps，D 的守門就每一拍丟錯。
//      伺服器照正式站靜態資產的標頭送（max-age=0, must-revalidate＋ETag，條件請求命中回 304）。Playwright 掛了 route 就不走 HTTP 快取，
//      所以 Y 另開一個不掛 route 的無視窗 Chromium，外部網域用 host-resolver-rules 擋掉。對照組：同一頁用 force-cache 抓同一個網址，
//      要拿到舊版（證明快取裡真的有舊版、這個環境看得到「吃快取」）。
// 判準驗【行為】：量的是「收下的那一點存成什麼」「停靠進度亮不亮」，不是原始碼裡有沒有那串字。
// 頁面開機後直接呼叫錄程的函式（不經真的 GPS）；先證明前提成立（山線真的載入、挑到的站兩側 600 m 內沒有別站）。
// 跑法：node scripts/verify_bounty_recorder_web.mjs（自己在空的埠起靜態伺服器、跑完自己關）
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { _bounty } from '../worker.js';

// G0 自檢：ROOT 由本檔自身路徑推導，不吃任何 --root／env 參數，結構上不會誤驗到別的 worktree。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex')}`);

const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const attempt = async (name, fn) => {
  try { await fn(); }
  catch (e) { ok(`${name}（流程丟例外）`, false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
};
const J = JSON.stringify;
const THSR = readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json'));
const RULES_NODE = JSON.parse(readFileSync(path.join(ROOT, 'data/bounty_rules.json'), 'utf8'));
const UNITS_NODE = JSON.parse(readFileSync(path.join(ROOT, 'data/bounty_units.json'), 'utf8'));

// ── 靜態伺服器：照 verify_bounty_merge_web.mjs（node http，backlog 511；只服 ROOT 底下的檔、/ 給 index.html、找不到 404）──
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.geojson': 'application/geo+json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8', '.xml': 'text/xml', '.webmanifest': 'application/manifest+json' };
const served = { n: 0, missing: new Set() };
// Y 用：規則檔換版前後的內容（null＝照磁碟送）。rulesLog 記每一次規則檔請求帶的 If-None-Match 與送出的版本。
let rulesServe = null;
const rulesLog = [];
const server = createServer((req, res) => {
  served.n++;
  let f = null, p = req.url;
  try {
    p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    f = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (!f.startsWith(ROOT + path.sep) || !statSync(f).isFile()) f = null;
  } catch (e) { f = null; }
  if (rulesServe && p === '/data/bounty_rules.json') {
    const inm = req.headers['if-none-match'] || null;
    rulesLog.push({ inm, etag: rulesServe.etag });
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'max-age=0, must-revalidate');
    res.setHeader('etag', rulesServe.etag);
    if (inm === rulesServe.etag) { res.statusCode = 304; return res.end(); }
    return res.end(rulesServe.body);
  }
  if (!f) { served.missing.add(p); res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', MIME[path.extname(f).toLowerCase()] || 'application/octet-stream');
  createReadStream(f).on('error', () => res.destroy()).pipe(res);
});
const port = await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', () => res(server.address().port)); });
const BASE = `http://127.0.0.1:${port}`;
let browser = null;
try {
  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  await ctx.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.hostname !== '127.0.0.1') return route.abort();                                  // 地圖磚、字型等外部資源一律不連
    if (u.pathname === '/api/thsr-schedule') return route.fulfill({ status: 200, contentType: 'application/json', body: THSR });
    if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.continue();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  await page.goto(BASE + '/');
  await page.waitForFunction(() => { try { return !!lineNetwork().get('tra_sched|山線'); } catch (e) { return false; } }, null, { timeout: 60000 });

  // 挑山線上一個「兩側 600 m 內沒有別站、而且有經緯度」的站（D 的軌跡從站前 600 m 跑到站後 600 m；停靠判定的站窗 250 m，窗裡不能混進別站的點）
  const ST = await page.evaluate(() => {
    const sts = lineNetwork().get('tra_sched|山線').ln.stations.filter(s => s.name && s.d != null).slice().sort((a, b) => a.d - b.d);
    for (let i = 1; i < sts.length - 1; i++) {
      const s = sts[i];
      if (Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.d - sts[i - 1].d > 0.6 && sts[i + 1].d - s.d > 0.6)
        return { name: s.name, d: s.d, lat: s.lat, lon: s.lon, n: sts.length };
    }
    return null;
  });
  ok('W0 [fixture] 開機後 lineNetwork() 有山線，挑到一個兩側 600 m 內沒有別站、有經緯度的站', !!ST, J(ST));

  await attempt('C', async () => {
    const got = await page.evaluate(() => {
      const one = [{ d: 1, t: 2, v: null, acc: null }, { d: 1, t: 2, v: 0, acc: 0 }, { d: 1, t: 2, v: 3.5, acc: 7 }, { d: 1, t: 2 }].map(bountyCleanSample);
      const r = { card: null, sys: 'tra_sched', lnId: '山線', trainNo: '', dir: 0, tripDate: '2026-09-30', startedAt: Date.now(), dNow: 5, segs: {}, _cov: {},
        points: 0, quality: 'none', _buf: [{ d: 10, t: 100, v: null, acc: null }, { d: 20, t: 101, v: 0, acc: 0 }], _candidateBuf: {}, _perp: {},
        _recent: [{ d: 10, t: 100, v: null, acc: null }], _lastFix: 0, _lastFlush: Date.now(), _batch: 0, demo: false };
      bountyPersistRecording(r);
      const back = bountyLoadPersistedRecording();
      bountyClearPersistedRecording();
      return { one, buf: back && back._buf, recent: back && back._recent };
    });
    const want = [{ d: 1, t: 2, v: null, acc: null }, { d: 1, t: 2, v: 0, acc: 0 }, { d: 1, t: 2, v: 3.5, acc: 7 }, { d: 1, t: 2, v: null, acc: null }];
    ok('C [第十四批 V9 E1] bountyCleanSample：v／acc 是 null → 仍是 null、0 → 0、數字照收；存檔再讀回之後 null 仍是 null、0 仍是 0（舊版 Number(null)＝0，一洗就成了「停著」「精度 0 m」）',
      J(got.one) === J(want) && J(got.buf) === J([{ d: 10, t: 100, v: null, acc: null }, { d: 20, t: 101, v: 0, acc: 0 }]) &&
        J(got.recent) === J([{ d: 10, t: 100, v: null, acc: null }]), J(got));
  });

  await attempt('F', async () => {
    const got = await page.evaluate(st => {
      state.recording = { card: null, sys: 'tra_sched', lnId: '山線', trainNo: '', dir: 0, tripDate: '2026-09-30', startedAt: Date.now(),
        dNow: null, segs: {}, _cov: {}, points: 0, quality: 'none', _buf: [], _candidateBuf: {}, _perp: {}, _recent: [], _lastFix: 0,
        _lastFlush: Date.now(), _batch: 0, demo: false, _weakSince: 0, _nagOff: false, _dwellMissed: false, _dwellNagOff: false };
      const out = [];
      for (const [speed, accuracy] of [[null, null], [-1, 8], [0, 0], [12.345, 8.6], [undefined, undefined], [3.2, -1]]) {
        state.recording._lastFix = 0;                     // 900 ms 節流：每一發都當成離上一點夠久
        bountyOnFix({ latitude: st.lat, longitude: st.lon, speed, accuracy });
        const b = state.recording._buf, s = b[b.length - 1];
        out.push({ n: b.length, v: s ? s.v : 'none', acc: s ? s.acc : 'none', dKm: s ? Math.round(s.d) / 1000 : null });
      }
      state.recording = null;
      bountyClearPersistedRecording();
      return out;
    }, ST);
    const vs = got.map(g => [g.n, g.v, g.acc]);
    ok('F [第十四批 V9 E1] bountyOnFix：speed／accuracy 是 null → 存 null；speed −1 → null；accuracy −1 → null；0 → 0；12.345／8.6 → 12.35／9；沒給（undefined）→ null（每一發都收下、落在挑到的那一站）',
      J(vs) === J([[1, null, null], [2, null, 8], [3, 0, 0], [4, 12.35, 9], [5, null, null], [6, 3.2, null]]) && got.every(g => Math.abs(g.dKm - ST.d) < 0.05), J(got));
  });

  await attempt('D', async () => {
    const got = await page.evaluate(async st => {
      const rules = await bountyRules(), c = st.d * 1000, key = `tra_sched|山線|${st.name}|${st.name}`;
      // sg＝1 往里程遞增、−1 遞減。停：20 m/s 跑 30 秒到站 → 停 60 秒（GPS 每秒晃 ±0.3 m）→ 20 m/s 跑 30 秒離站；不停：30 m/s 從前方 600 m 跑到後方 600 m。
      // vm：'v' 都卜勒（停的時候 0）、'null' 沒有速度、'zero' 每點送 0（Android 沒有速度）、'small' 每點送 0.3。
      const trip = (sg, stop, vm) => {
        const pts = [];
        const push = (x, v) => pts.push({ d: Math.round((c + sg * x) * 10) / 10, t: 30000 + pts.length,
          v: vm === 'v' ? v : vm === 'zero' ? 0 : vm === 'small' ? 0.3 : null, acc: 8 });
        if (stop) {
          for (let k = 0; k <= 30; k++) push(-600 + 20 * k, 20);
          for (let k = 1; k < 60; k++) push(k % 2 ? 0.3 : -0.3, 0);
          for (let k = 0; k <= 30; k++) push(20 * k, 20);
        } else for (let k = 0; k <= 40; k++) push(-600 + 30 * k, 30);
        return pts;
      };
      const run = pts => {
        const ds = pts.map(p => p.d);
        const r = { card: { kind: 'dwell', unitKeys: [key] }, sys: 'tra_sched', lnId: '山線', _recent: pts, _dLo: Math.min(...ds), _dHi: Math.max(...ds), _cov: {} };
        bountyUpdateDwellProgress(r, rules);
        return { cov: r._cov[key] || 0, missed: r._dwellMissed };
      };
      const out = {};
      const veto = x => ({ ...rules, quality: { ...rules.quality, dwell: { ...rules.quality.dwell, posSpeedVetoMps: x } } });
      const threw = rs => { try { bountyUpdateDwellProgress({ card: { kind: 'dwell', unitKeys: [key] }, sys: 'tra_sched', lnId: '山線', _recent: [], _cov: {} }, rs); return 'no-throw'; }
        catch (e) { return String(e && e.message); } };
      out.guard = { missing: threw(veto(undefined)), equal: threw(veto(rules.quality.dwell.stopSpeedMaxMps)), real: threw(rules) };
      for (const sg of [1, -1]) {
        out[`nullStop${sg}`] = run(trip(sg, true, 'null'));
        out[`nullFast${sg}`] = run(trip(sg, false, 'null'));
        out[`vStop${sg}`] = run(trip(sg, true, 'v'));
        out[`zeroStop${sg}`] = run(trip(sg, true, 'zero'));
        out[`zeroFast${sg}`] = run(trip(sg, false, 'zero'));
        out[`smallFast${sg}`] = run(trip(sg, false, 'small'));
      }
      return out;
    }, ST);
    const want = { cov: 1, missed: false }, fast = { cov: 0, missed: true };
    ok('D [第十四批 V9 E-2(b)、第十五批 V10 P1-2] 停靠進度與 Worker 同一條：沒有速度的裝置停 60 秒 → 亮；沒有速度、30 m/s 通過 → 不亮且判錯過；對照：有速度的同一趟停靠 → 亮；速度送 0 或 0.3、30 m/s 通過 → 不亮且判錯過，送 0 的真停靠 → 亮（兩個方向；舊版 Number(null)＝0、送 0 照信，高速通過也亮）',
      [1, -1].every(sg => J(got[`nullStop${sg}`]) === J(want) && J(got[`nullFast${sg}`]) === J(fast) && J(got[`vStop${sg}`]) === J(want) &&
        J(got[`zeroStop${sg}`]) === J(want) && J(got[`zeroFast${sg}`]) === J(fast) && J(got[`smallFast${sg}`]) === J(fast)) &&
        J(got.guard) === J({ missing: 'dwell rules unavailable', equal: 'dwell rules unavailable', real: 'no-throw' }), J(got));
  });

  await attempt('X', async () => {
    // 山線上挑連續四站、相鄰站距都 ≥ 1.2 km（站窗 250 m 不會混進別站的點），站表取前端 lineNetwork()。
    const FE_STS = await page.evaluate(() => lineNetwork().get('tra_sched|山線').ln.stations.filter(s => s.name && s.d != null)
      .map(s => ({ name: s.name, d: s.d })).sort((a, b) => a.d - b.d));
    let i0 = -1;
    for (let i = 0; i + 3 < FE_STS.length && i0 < 0; i++) if ([1, 2, 3].every(k => FE_STS[i + k].d - FE_STS[i + k - 1].d >= 1.2)) i0 = i;
    const four = i0 >= 0 ? FE_STS.slice(i0, i0 + 4) : [];
    const LINE_W = UNITS_NODE.lines['tra_sched|山線'];
    const PLANS = [['stop', 'pass', 'slow', 'jstop'], ['pass', 'jstop', 'stop', 'slow'], ['slow', 'stop', 'pass', 'stop'], ['p10', 'stop', 'p105', 'pass']];
    const SLOW = { slow: 8, p10: 10, p105: 10.5 };
    const VMODES = ['v', 'null', 'zero', 'small', 'half'];
    // u＝沿行進方向的座標（sg＝1 就是里程公尺；sg＝−1 用 −里程），每秒一點；d 照上傳端取整到 0.1 m。
    const mk = (plan, sg, vm) => {
      const cs = (sg > 0 ? four.map(s => Math.round(s.d * 1000)) : four.map(s => -Math.round(s.d * 1000)).reverse());
      const pl = sg > 0 ? plan : plan.slice().reverse();
      const pts = [];
      let u = cs[0] - 400;
      const push = spd => {
        const k = pts.length, vv = vm === 'v' ? spd : vm === 'zero' ? 0 : vm === 'small' ? 0.3 : vm === 'half' ? (k % 2 ? null : spd) : null;
        pts.push({ d: Math.round(sg * u * 10) / 10, t: 30000 + k, v: vv, acc: 8 });
      };
      const moveTo = (target, spd) => { while (u + spd < target) { u += spd; push(spd); } u = target; push(spd); };
      push(20);
      cs.forEach((c, k) => {
        const how = pl[k];
        if (how === 'stop' || how === 'jstop') {
          moveTo(c, 20);
          const amp = how === 'stop' ? 0.3 : 2;
          for (let j = 1; j <= 45; j++) { u = c + (j % 2 ? amp : -amp); push(0); }
          u = c;
        } else if (SLOW[how]) { moveTo(c - 300, 20); moveTo(c + 300, SLOW[how]); }
        else moveTo(c + 300, 20);
      });
      moveTo(cs[cs.length - 1] + 400, 20);
      return pts;
    };
    const cases = [];
    for (let p = 0; p < PLANS.length; p++) for (const vm of VMODES) for (const sg of [1, -1]) cases.push({ id: `P${p}/${vm}/${sg > 0 ? 'up' : 'down'}`, sg, pts: mk(PLANS[p], sg, vm) });
    const fe = await page.evaluate(async cs => {
      const rules = await bountyRules();
      const keys = lineNetwork().get('tra_sched|山線').ln.stations.filter(s => s.name && s.d != null).map(s => `tra_sched|山線|${s.name}|${s.name}`);
      return cs.map(({ pts }) => {
        const ds = pts.map(p => p.d);
        const r = { card: { kind: 'dwell', unitKeys: keys }, sys: 'tra_sched', lnId: '山線', _recent: pts, _dLo: Math.min(...ds), _dHi: Math.max(...ds), _cov: {} };
        bountyUpdateDwellProgress(r, rules);
        return Object.keys(r._cov).filter(k => r._cov[k] >= 1).map(k => k.split('|')[2]).sort();
      });
    }, cases.map(c => ({ pts: c.pts })));
    const wk = cases.map(c => _bounty.coverageOf({ pts: c.pts, tripDate: '2026-07-26', dir: c.sg > 0 ? 0 : 1, sys: 'tra_sched', lnId: '山線' },
      LINE_W, RULES_NODE, UNITS_NODE.peakHoursBySys).filter(x => x.kind === 'dwell').map(x => x.key.split('|')[2]).sort());
    const diff = cases.map((c, i) => ({ id: c.id, fe: fe[i], wk: wk[i] })).filter(x => J(x.fe) !== J(x.wk));
    const lit = wk.reduce((n, a) => n + a.length, 0), dark = cases.length * 4 - lit;
    ok('X [第十五批 V10 P2-8] 同一批點同時餵前端 bountyUpdateDwellProgress 與 Worker coverageOf：40 趟（四種停法組合 × 五種速度欄 × 兩個方向）逐站的停靠判定完全相同（Worker 用 bounty_units.json 的站表、前端用 lineNetwork()）',
      four.length === 4 && !!LINE_W && cases.length === 40 && diff.length === 0 && lit >= 40 && dark >= 40,
      J({ four: four.map(s => s.name), lit, dark, diff: diff.slice(0, 3) }));
  });

  await attempt('Y', async () => {
    const real = readFileSync(path.join(ROOT, 'data/bounty_rules.json'), 'utf8');
    const old = JSON.parse(real);
    delete old.quality.dwell.posSpeedVetoMps;                                   // 上一版（第十四批）的規則檔沒有這個鍵
    const b2 = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'] });
    try {
      const p2 = await (await b2.newContext()).newPage();
      const ready = () => p2.waitForFunction(() => typeof bountyRules === 'function', null, { timeout: 60000 });
      const vetoOf = () => p2.evaluate(async () => (await bountyRules()).quality.dwell.posSpeedVetoMps ?? null);
      rulesServe = { etag: '"old"', body: J(old) };
      await p2.goto(BASE + '/'); await ready();
      const first = await vetoOf();
      rulesServe = { etag: '"new"', body: real };                              // 部署了新版
      const n0 = rulesLog.length;
      await p2.reload(); await ready();
      const bootReq = rulesLog.length - n0;                                     // 開機本身不抓規則檔；抓了的話對照組就沒意義
      const ctrl = await p2.evaluate(async () =>
        (await (await fetch('./data/bounty_rules.json', { cache: 'force-cache' })).json()).quality.dwell.posSpeedVetoMps ?? null);
      const n1 = rulesLog.length;
      const after = await vetoOf();
      const reval = rulesLog.slice(n1);
      ok('Y [第十一輪 H] 規則檔換版之後重新整理：bountyRules() 帶上一版的 ETag 回伺服器驗證、拿到新版（有 posSpeedVetoMps）；對照組：同一頁用 force-cache 抓同一個網址仍是舊版（舊寫法就是這樣一直吃舊規則）',
        first === null && bootReq === 0 && ctrl === null && n1 === n0 + bootReq &&
          after === RULES_NODE.quality.dwell.posSpeedVetoMps && reval.length === 1 && reval[0].inm === '"old"',
        J({ first, bootReq, ctrl, after, reval }));
    } finally {
      rulesServe = null;
      await b2.close().catch(() => {});
    }
  });

  ok('W9 整個過程頁面沒有丟出未處理的例外', errors.length === 0, J(errors.slice(0, 3)));
  await ctx.close();
} finally {
  if (browser) await browser.close().catch(() => {});
  server.closeAllConnections(); server.close();                        // 只關本輪自己起的這一個伺服器
  console.log(`[G0] 靜態伺服器：${served.n} 個請求、404 ${served.missing.size} 個路徑${served.missing.size ? '：' + [...served.missing].sort().join(' ') : ''}`);
}

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
