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
// 判準驗【行為】：量的是「收下的那一點存成什麼」「停靠進度亮不亮」，不是原始碼裡有沒有那串字。
// 頁面開機後直接呼叫錄程的函式（不經真的 GPS）；先證明前提成立（山線真的載入、挑到的站兩側 600 m 內沒有別站）。
// 跑法：node scripts/verify_bounty_recorder_web.mjs（自己在空的埠起靜態伺服器、跑完自己關）
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

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

// ── 靜態伺服器：照 verify_bounty_merge_web.mjs（node http，backlog 511；只服 ROOT 底下的檔、/ 給 index.html、找不到 404）──
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.geojson': 'application/geo+json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8', '.xml': 'text/xml', '.webmanifest': 'application/manifest+json' };
const served = { n: 0, missing: new Set() };
const server = createServer((req, res) => {
  served.n++;
  let f = null, p = req.url;
  try {
    p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    f = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (!f.startsWith(ROOT + path.sep) || !statSync(f).isFile()) f = null;
  } catch (e) { f = null; }
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
      const trip = (sg, stop, withV) => {
        const pts = [];
        const push = (x, v) => pts.push({ d: Math.round((c + sg * x) * 10) / 10, t: 30000 + pts.length, v: withV ? v : null, acc: 8 });
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
      for (const sg of [1, -1]) {
        out[`nullStop${sg}`] = run(trip(sg, true, false));
        out[`nullFast${sg}`] = run(trip(sg, false, false));
        out[`vStop${sg}`] = run(trip(sg, true, true));
      }
      return out;
    }, ST);
    const want = { cov: 1, missed: false }, fast = { cov: 0, missed: true };
    ok('D [第十四批 V9 E-2(b)] 停靠進度與 Worker 同一條：沒有速度的裝置停 60 秒 → 亮；沒有速度、30 m/s 通過 → 不亮且判錯過；對照：有速度的同一趟停靠 → 亮（兩個方向；舊版 Number(null)＝0，高速通過也亮）',
      [1, -1].every(sg => J(got[`nullStop${sg}`]) === J(want) && J(got[`nullFast${sg}`]) === J(fast) && J(got[`vStop${sg}`]) === J(want)), J(got));
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
